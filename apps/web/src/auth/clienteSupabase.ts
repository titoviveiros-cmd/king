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
  /** Só a recuperação de conta usa: é ele que passa da sessão isolada para a principal. */
  refresh_token?: string;
  user?: UsuarioSupabase | null;
}

/** O usuário, no que o KING lê dele. `created_at` e as identidades provam de onde a conta veio. */
export interface UsuarioSupabase {
  id?: string;
  created_at?: string;
  is_anonymous?: boolean;
  identities?: (IdentidadeVinculada & { created_at?: string })[] | null;
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
  /**
   * TROCA a sessão guardada por outra já obtida. Só `recuperacaoDeConta.ts` chama — depois de o
   * jogador confirmar, com a sessão que o cliente ISOLADO conseguiu. Se falhar, a atual fica.
   */
  setSession(sessao: { access_token: string; refresh_token: string }): Promise<{
    data: { session: SessaoSupabase | null } | null;
    error: ErroDoProvedor | null;
  }>;
  /** Sai DESTE aparelho (`local`): a sessão deste aparelho é revogada; as de outros aparelhos, não. */
  signOut(opcoes: { scope: "local" }): Promise<{ error: ErroDoProvedor | null }>;
}

/**
 * A PORTA DO CLIENTE ISOLADO — "Já tenho uma conta".
 *
 * Um cliente à parte, SEM persistência e sem renovação automática, que existe só para descobrir se
 * aquele Google/Apple já é de um jogador. É AQUI, e só aqui, que `signInWithIdToken` existe: na porta
 * principal ele não existe de propósito (lá, "entrar" criaria outro usuário por cima do convidado).
 * Nada do que acontece neste cliente toca a sessão guardada no aparelho.
 */
export interface PortaIsolada {
  signInWithIdToken(credenciais: {
    provider: "google" | "apple";
    token: string;
    nonce?: string;
    access_token?: string;
  }): Promise<{
    data: { session: SessaoSupabase | null; user: UsuarioSupabase | null } | null;
    error: (ErroDoProvedor & { status?: number; name?: string }) | null;
  }>;
  signOut(opcoes: { scope: "local" }): Promise<{ error: ErroDoProvedor | null }>;
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

/**
 * 429 NA RENOVAÇÃO NÃO É "SESSÃO MORTA" (red team da Fase 9). O SDK trata 5xx como passageiro —
 * guarda a sessão e tenta de novo —, mas 429 não: com o token de acesso vencido, ele APAGA a sessão,
 * e o próximo `token()` criaria outro convidado por cima. Muitos jogadores atrás do mesmo IP (o CGNAT
 * das operadoras) bastam para estourar o limite por IP do Supabase. Só na renovação, 429 vira 503.
 */
export async function fetchDaSessao(entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const resposta = await fetch(entrada, init);
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  if (resposta.status !== 429 || !url.includes("/auth/v1/token?grant_type=refresh_token")) return resposta;
  return new Response(resposta.body, { status: 503, statusText: "Service Unavailable", headers: resposta.headers });
}

/** Onde fica o aviso (sem segredo) de que a sessão do aparelho foi encerrada pelo servidor. */
export const MARCA_DE_SESSAO_PERDIDA = "king:sessao-perdida";
let saidaDeProposito = false;

/**
 * Sair DE PROPÓSITO (excluir a conta): a saída que vier dentro de `acao` não é "sessão perdida".
 * Qualquer outra (token reutilizado, revogado, conta apagada noutro aparelho) deixa o aviso — o
 * jogador não troca de conta calado.
 */
export async function sairDeProposito<T>(acao: () => Promise<T>): Promise<T> {
  saidaDeProposito = true;
  try { return await acao(); } finally { saidaDeProposito = false; }
}

/** Lê e APAGA o aviso de sessão perdida (mostra-se uma vez). */
export function lerSessaoPerdida(): boolean {
  try {
    const local = globalThis.localStorage;
    const havia = local?.getItem(MARCA_DE_SESSAO_PERDIDA) === "1";
    if (havia) local?.removeItem(MARCA_DE_SESSAO_PERDIDA);
    return havia;
  } catch {
    return false;
  }
}

function anotarSaida(): void {
  if (saidaDeProposito) return;
  try { globalThis.localStorage?.setItem(MARCA_DE_SESSAO_PERDIDA, "1"); } catch { /* sem localStorage */ }
}

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
    .then(([{ createClient }, storage]) => {
      const cliente = createClient(cfg.url, cfg.anonKey, {
        global: { fetch: fetchDaSessao },
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: "pkce",
          ...(storage ? { storage } : {}),
        },
      });
      // A sessão que o SDK apaga sozinho (renovação recusada) deixa o aviso; a nossa saída, não. Um
      // aviso que falha não pode custar o cliente: sem ele, o jogo perderia a identidade inteira.
      try {
        cliente.auth.onAuthStateChange((evento) => { if (evento === "SIGNED_OUT") anotarSaida(); });
      } catch { /* sem o aviso, com o cliente */ }
      return cliente;
    })
    .catch(() => null);
  return compartilhado;
}

/** A parte de AUTENTICAÇÃO do cliente único. */
export function portaDeAutenticacao(cfg: ConfiguracaoDeIdentidade): Promise<PortaDeAutenticacao | null> {
  return clienteCompartilhado(cfg).then((c) => (c ? (c.auth as unknown as PortaDeAutenticacao) : null));
}

/**
 * Um cliente ISOLADO novo, a cada tentativa de "Já tenho uma conta": memória própria, nada gravado,
 * nada renovado sozinho (uma renovação paralela giraria o refresh token que ainda vai ser entregue
 * ao cliente principal). Quando a tentativa acaba, ele é simplesmente esquecido.
 */
export async function portaIsolada(cfg: ConfiguracaoDeIdentidade): Promise<PortaIsolada | null> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const memoria = new Map<string, string>();
    const cliente = createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "king-recuperacao-isolada",
        storage: {
          getItem: (k: string) => memoria.get(k) ?? null,
          setItem: (k: string, v: string) => { memoria.set(k, v); },
          removeItem: (k: string) => { memoria.delete(k); },
        },
      },
    });
    return cliente.auth as unknown as PortaIsolada;
  } catch {
    return null;
  }
}

/** Só para teste: esquece a instância. Nunca chamado pelo aplicativo. */
export function esquecerPortaDeAutenticacao(): void {
  compartilhado = null;
  configuracaoEmUso = null;
  armazenamentoDaSessao = Promise.resolve(null);
}
