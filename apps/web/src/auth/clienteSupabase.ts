// UM CLIENTE SUPABASE, E SÓ UM.
//
// Antes deste arquivo, quem precisasse do provedor chamava `identidadeSupabase(...)`, e cada
// chamada criava o seu próprio cliente. Enquanto o único consumidor era `token()`, isso não
// custava nada. Com vínculo de conta, custa tudo: o PKCE guarda o `code_verifier` no storage do
// cliente que INICIOU o fluxo, e quem volta do Google tem de ser o MESMO cliente, ou a troca do
// código falha por verificador ausente — um erro que parece do Google e é nosso.
//
// Por isso a instância é de módulo, criada sob demanda e compartilhada por todos:
// `token()`, convidado, leitura de sessão, `linkIdentity`, retorno do OAuth e `getUserIdentities`.
//
// O `import` continua DINÂMICO: quem só joga contra bots nunca baixa o SDK.
//
// A LEITURA DO PROGRESSO (`progresso.ts`) usa esta MESMA instância. O objeto do SDK não sai da
// pasta `auth/`: quem está fora dela recebe operações de domínio, nunca o cliente.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArmazenamentoDaSessao } from "./sessaoNativa.js";

/** O que o KING usa de uma sessão. O resto do objeto do SDK não interessa a ninguém aqui. */
export interface SessaoSupabase {
  access_token: string;
  user?: { id?: string } | null;
}

/** Uma identidade vinculada ao usuário — é ela que prova o vínculo, não `user_metadata`. */
export interface IdentidadeVinculada {
  provider?: string;
  user_id?: string;
  identity_id?: string;
}

export interface ErroDoProvedor { message?: string; code?: string }

/**
 * A PORTA. Escrita à mão, com exatamente os métodos que o KING chama.
 *
 * Serve a dois propósitos: o tipo do SDK não vaza para o resto do aplicativo, e o teste substitui
 * a porta inteira por uma dublê determinística — sem rede, sem navegador, sem Google.
 */
export interface PortaDeAutenticacao {
  /** `error` vem quando a renovação falhou — a sessão continua guardada; NÃO é "sem convidado". */
  getSession(): Promise<{ data: { session: SessaoSupabase | null }; error?: ErroDoProvedor | null }>;
  signInAnonymously(): Promise<{ data: { session: SessaoSupabase | null } }>;
  getUserIdentities(): Promise<{
    data: { identities: IdentidadeVinculada[] } | null;
    error: ErroDoProvedor | null;
  }>;
  linkIdentity(credenciais: {
    provider: string;
    options?: { redirectTo?: string; skipBrowserRedirect?: boolean; scopes?: string };
  }): Promise<{ data: { url?: string | null } | null; error: ErroDoProvedor | null }>;
  /**
   * O vínculo do APP NATIVO: o ID token que o Google ou a Apple entregaram ao plugin nativo. O SDK
   * manda o JWT da sessão atual com `link_identity: true` — a identidade nova entra no MESMO
   * usuário. (`signInWithIdToken` NÃO está nesta porta, de propósito: aquilo é "entrar", e criaria
   * outro usuário.)
   */
  linkIdentity(credenciais: {
    provider: "google" | "apple";
    token: string;
    nonce?: string;
    access_token?: string;
  }): Promise<{
    data: { session?: SessaoSupabase | null; user?: { id?: string } | null } | null;
    error: ErroDoProvedor | null;
  }>;
  exchangeCodeForSession(codigo: string): Promise<{
    data: { session: SessaoSupabase | null; user?: { id?: string } | null } | null;
    error: ErroDoProvedor | null;
  }>;
}

export interface ConfiguracaoDeIdentidade { url: string; anonKey: string }

let compartilhado: Promise<SupabaseClient | null> | null = null;
let configuracaoEmUso: string | null = null;

/**
 * ONDE A SESSÃO VIVE. Na web, `null`: o SDK usa o `localStorage`, como sempre. No app, o arranque
 * nativo registra aqui o cofre do sistema (ver `sessaoNativa.ts`) — e registra uma PROMESSA, porque
 * preparar o cofre é assíncrono: o cliente só nasce depois de ela resolver, para que nenhuma sessão
 * seja lida do lugar errado nem gravada em texto puro no meio do caminho.
 */
let armazenamentoDaSessao: Promise<ArmazenamentoDaSessao | null> = Promise.resolve(null);

/** O app nativo diz onde guardar a sessão. Chamado UMA vez, antes de qualquer cliente existir. */
export function registrarArmazenamentoDaSessao(pronto: Promise<ArmazenamentoDaSessao | null>): void {
  armazenamentoDaSessao = pronto;
}

/**
 * A instância compartilhada.
 *
 * `flowType: "pkce"` é o que faz `linkIdentity` sair com `code_challenge` e voltar com um código
 * de uso único, em vez de devolver tokens no fragmento da URL. O fluxo implícito (padrão do SDK)
 * colocaria `access_token` na barra de endereços, onde ele entra em histórico, em Referer e em
 * captura de tela.
 *
 * `detectSessionInUrl` fica FALSO de propósito. Ligá-lo faria o SDK processar qualquer URL com
 * `code=` durante o arranque, calado, antes de o KING saber se aquilo era uma transação sua. O
 * retorno é reconhecido por nós, num ponto só, e a URL é limpa logo depois — ver `conta.ts`.
 */
export function clienteCompartilhado(cfg: ConfiguracaoDeIdentidade): Promise<SupabaseClient | null> {
  if (compartilhado && configuracaoEmUso !== cfg.url) return Promise.resolve(null);
  configuracaoEmUso = cfg.url;
  compartilhado ??= Promise.all([import("@supabase/supabase-js"), armazenamentoDaSessao.catch(() => null)])
    .then(([{ createClient }, storage]) => createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        ...(storage ? { storage } : {}),
      },
    }))
    .catch(() => null);
  return compartilhado;
}

/** A parte de AUTENTICAÇÃO do cliente único. */
export function portaDeAutenticacao(cfg: ConfiguracaoDeIdentidade): Promise<PortaDeAutenticacao | null> {
  return clienteCompartilhado(cfg).then((c) => (c ? (c.auth as unknown as PortaDeAutenticacao) : null));
}

/** Só para teste: esquece a instância. Nunca chamado pelo aplicativo. */
export function esquecerPortaDeAutenticacao(): void {
  compartilhado = null;
  configuracaoEmUso = null;
  armazenamentoDaSessao = Promise.resolve(null);
}
