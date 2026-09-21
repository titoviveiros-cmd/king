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
  getSession(): Promise<{ data: { session: SessaoSupabase | null } }>;
  signInAnonymously(): Promise<{ data: { session: SessaoSupabase | null } }>;
  getUserIdentities(): Promise<{
    data: { identities: IdentidadeVinculada[] } | null;
    error: ErroDoProvedor | null;
  }>;
  linkIdentity(credenciais: {
    provider: string;
    options?: { redirectTo?: string; skipBrowserRedirect?: boolean; scopes?: string };
  }): Promise<{ data: { url?: string | null } | null; error: ErroDoProvedor | null }>;
  exchangeCodeForSession(codigo: string): Promise<{
    data: { session: SessaoSupabase | null; user?: { id?: string } | null } | null;
    error: ErroDoProvedor | null;
  }>;
}

export interface ConfiguracaoDeIdentidade { url: string; anonKey: string }

let compartilhado: Promise<PortaDeAutenticacao | null> | null = null;
let configuracaoEmUso: string | null = null;

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
export function portaDeAutenticacao(cfg: ConfiguracaoDeIdentidade): Promise<PortaDeAutenticacao | null> {
  if (compartilhado && configuracaoEmUso !== cfg.url) return Promise.resolve(null);
  configuracaoEmUso = cfg.url;
  compartilhado ??= import("@supabase/supabase-js")
    .then(({ createClient }) => createClient(cfg.url, cfg.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    }).auth as unknown as PortaDeAutenticacao)
    .catch(() => null);
  return compartilhado;
}

/** Só para teste: esquece a instância. Nunca chamado pelo aplicativo. */
export function esquecerPortaDeAutenticacao(): void {
  compartilhado = null;
  configuracaoEmUso = null;
}
