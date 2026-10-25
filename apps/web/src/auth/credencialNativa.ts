// A CREDENCIAL DO APP NATIVO — Google e Apple dentro do Capacitor, sem OAuth no WebView.
//
// ══ POR QUE O FLUXO DA WEB NÃO SERVE NO APP ══
//
// No navegador, vincular o Google é um redirecionamento (OAuth com PKCE) que volta para
// `https://playkingcards.com.br/?conta=google`. Dentro do app isso quebra por dois lados: o Google
// RECUSA login em WebView embutido (`disallowed_useragent`), e a origem do app é `https://localhost`
// (Android) ou `capacitor://localhost` (iOS) — não é um endereço de retorno da web.
//
// O caminho do app é outro: um plugin nativo abre a tela do sistema (Credential Manager no
// Android, Sign in with Apple / Google Sign-In no iOS) e devolve um ID TOKEN; o KING entrega esse
// token ao Supabase com `linkIdentity`, sobre a sessão do convidado. O plugin é o
// `@capgo/capacitor-social-login` (ver `nativo/loginSocial.ts`), registrado no arranque do app;
// sem os client IDs do Google (e, no iPhone, sem a Apple) a fonte não existe e a conta não aparece.
//
// ══ O NONCE ══
//
// Cada pedido leva um número aleatório de uso único. O provedor recebe o HASH (SHA-256) e o grava
// dentro do ID token; o Supabase recebe o valor BRUTO e confere que o hash bate. Um token roubado
// de outro pedido não passa.

export type ProvedorNativo = "google" | "apple";

/** O que o plugin nativo devolve. Nunca é guardado — vai direto para o `linkIdentity`. */
export interface CredencialNativa {
  idToken: string;
  /** Alguns ID tokens trazem `at_hash`; aí o Supabase precisa do access token para conferir. */
  accessToken?: string;
  /**
   * Só Apple: o código de autorização (uso único, 5 minutos). Não serve para entrar — serve para a
   * exclusão da conta REVOGAR o acesso do KING ao Apple ID (diretriz 5.1.1(v)). Nunca é guardado.
   */
  codigoDeAutorizacao?: string;
}

export type ResultadoDaCredencial =
  | { tipo: "credencial"; credencial: CredencialNativa }
  | { tipo: "cancelado" }
  | { tipo: "erro" };

/**
 * A PONTE com o plugin nativo (a escolher quando as credenciais existirem). Recebe o hash do nonce
 * e devolve a credencial, ou diz que o jogador desistiu.
 */
export interface FonteDeCredencialNativa {
  /** Os provedores que este app oferece, na ordem de exibição (no iPhone, a Apple vem primeiro). */
  provedores?: readonly ProvedorNativo[];
  obter(provedor: ProvedorNativo, hashDoNonce: string): Promise<ResultadoDaCredencial>;
  /**
   * Esquece a credencial guardada pelo SDK nativo. O Google Sign-In do iOS pode devolver um token
   * EM CACHE, emitido com o nonce de outro pedido — o Supabase recusa, e sem esquecer a próxima
   * tentativa receberia o mesmo token.
   */
  esquecer?(provedor: ProvedorNativo): Promise<void>;
}

/** O `nonce` gravado dentro do ID token (só leitura do payload; quem confere a assinatura é o Supabase). */
export function nonceDoIdToken(idToken: string): string | undefined {
  try {
    const parte = idToken.split(".")[1] ?? "";
    const base64 = parte.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parte.length / 4) * 4, "=");
    const nonce = (JSON.parse(atob(base64)) as { nonce?: unknown }).nonce;
    return typeof nonce === "string" ? nonce : undefined;
  } catch {
    return undefined;
  }
}

let fonteRegistrada: FonteDeCredencialNativa | null = null;
const ouvintesDaFonte = new Set<() => void>();

/** O adaptador do plugin se registra aqui no arranque do app. Na web, nunca há fonte. */
export function registrarFonteNativa(fonte: FonteDeCredencialNativa | null): void {
  fonteRegistrada = fonte;
  for (const o of ouvintesDaFonte) { try { o(); } catch { /* um ouvinte não derruba os outros */ } }
}

/**
 * Avisa quando a fonte muda. O arranque não segura a primeira tela por mais de um instante: se o
 * plugin terminar DEPOIS, a tela que já se montou sem conta precisa saber — senão a conta sumiria
 * naquela execução inteira. Devolve o cancelamento.
 */
export function aoMudarFonteNativa(ouvinte: () => void): () => void {
  ouvintesDaFonte.add(ouvinte);
  return () => { ouvintesDaFonte.delete(ouvinte); };
}

export function fonteNativa(): FonteDeCredencialNativa | null {
  return fonteRegistrada;
}

/**
 * Rodando dentro do app (Capacitor)? A ponte nativa injeta `window.Capacitor` antes do app carregar;
 * ler o global evita trazer `@capacitor/core` para o pacote da web.
 */
export function ehAppNativo(alvo: unknown = globalThis): boolean {
  const cap = (alvo as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  try { return cap?.isNativePlatform?.() === true; } catch { return false; }
}

/** "ios", "android" — ou `null` fora do app. */
export function plataformaNativa(alvo: unknown = globalThis): "ios" | "android" | null {
  if (!ehAppNativo(alvo)) return null;
  const cap = (alvo as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  try {
    const p = cap?.getPlatform?.();
    return p === "ios" || p === "android" ? p : null;
  } catch {
    return null;
  }
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** Um nonce novo: o bruto (vai ao Supabase) e o hash SHA-256 em hex (vai ao provedor). */
export async function gerarNonce(cripto: Crypto = globalThis.crypto): Promise<{ bruto: string; hash: string }> {
  const bruto = hex(cripto.getRandomValues(new Uint8Array(32)));
  const resumo = await cripto.subtle.digest("SHA-256", new TextEncoder().encode(bruto));
  return { bruto, hash: hex(new Uint8Array(resumo)) };
}
