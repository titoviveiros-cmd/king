// A FONTE DE CREDENCIAL DO APP — Google e Apple pelo `@capgo/capacitor-social-login` 8.x.
//
// O plugin abre a tela do SISTEMA (Credential Manager no Android, Sign in with Apple e Google
// Sign-In no iOS) e devolve um ID token. Quem decide o que fazer com ele é `auth/conta.ts` (vincular)
// ou `auth/recuperacao.ts` (entrar numa conta que já existe) — este arquivo só obtém a credencial.
//
// ══ AS GARANTIAS DESTE ADAPTADOR ══
//
//   • NONCE: o provedor recebe o HASH (SHA-256 em hex); o valor bruto fica com o KING e vai ao
//     Supabase. Um ID token emitido para outro pedido não passa.
//   • ESCOPO MÍNIMO: da Apple, só `email` — o KING não usa nome nem e-mail, mas o Supabase precisa
//     de uma identidade completa; o "Ocultar meu e-mail" (relay privado) funciona do mesmo jeito.
//   • CANCELAR NÃO MUDA NADA: `USER_CANCELLED` vira "cancelado", sem aviso de erro.
//   • O PLUGIN GUARDA UMA CÓPIA DO TOKEN em texto puro (UserDefaults no iOS, SharedPreferences no
//     Android — lido no código do plugin em 25/10/2026). Por isso, depois de CADA pedido — deu
//     certo, falhou ou foi cancelado —, `logout` apaga essa cópia (e, na Apple, o nome em cache).
//     O arquivo do Google no Android ainda fica fora do backup (ver scripts/preparar-mobile.mjs).
//   • UM PEDIDO POR VEZ: um segundo toque com a tela do provedor aberta não abre outra.
import type {
  CredencialNativa,
  FonteDeCredencialNativa,
  ProvedorNativo,
  ResultadoDaCredencial,
} from "../auth/credencialNativa.js";

/** O que o KING usa do plugin. Uma porta, para o teste trocar por uma dublê. */
export interface PluginDeLoginSocial {
  initialize(opcoes: {
    google?: { webClientId?: string; iOSClientId?: string; mode: "online" };
    apple?: { useProperTokenExchange: boolean };
  }): Promise<void>;
  login(pedido: { provider: ProvedorNativo; options: Record<string, unknown> }): Promise<{ result?: unknown }>;
  logout(pedido: { provider: ProvedorNativo; clearCachedUserInfo?: boolean }): Promise<void>;
}

export interface ConfiguracaoDoLoginSocial {
  plataforma: "ios" | "android";
  /** O client ID do tipo "Aplicativo da Web" do Google Cloud — o `aud` do token no Android. */
  googleWebClientId?: string;
  /** O client ID do tipo "iOS" do Google Cloud — o `aud` do token no iPhone. */
  googleIosClientId?: string;
}

/** Quanto esperar o plugin apagar a cópia do token antes de seguir. */
const LIMITE_DO_ESQUECIMENTO_MS = 3000;

/**
 * QUAIS PROVEDORES ESTE APP OFERECE.
 *
 *   • Android: Google, se houver o client ID web. (Apple no Android exigiria um servidor de
 *     redirecionamento — fora desta fase.)
 *   • iPhone: Apple SEMPRE (API do sistema; o direito de uso vem do entitlement, conferido por
 *     `mobile:validar`); Google só com o client ID iOS. Google NUNCA aparece sozinho no iPhone
 *     (diretriz 4.8 da App Store) — e aqui ele nunca aparece sem a Apple, por construção.
 */
export function provedoresNativos(cfg: ConfiguracaoDoLoginSocial): ProvedorNativo[] {
  const temGoogleWeb = !!cfg.googleWebClientId?.trim();
  const temGoogleIos = !!cfg.googleIosClientId?.trim();
  if (cfg.plataforma === "android") return temGoogleWeb ? ["google"] : [];
  return temGoogleIos ? ["apple", "google"] : ["apple"];
}

const ehCancelamento = (e: unknown): boolean => {
  const erro = e as { code?: unknown; message?: unknown } | null;
  if (erro?.code === "USER_CANCELLED") return true;
  return typeof erro?.message === "string" && /cancel/i.test(erro.message);
};

const texto = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Extrai a credencial do resultado do plugin, sem confiar no formato. */
function credencialDo(provedor: ProvedorNativo, bruto: unknown): CredencialNativa | null {
  const r = (bruto ?? {}) as { idToken?: unknown; accessToken?: { token?: unknown } | null; authorizationCode?: unknown };
  const idToken = texto(r.idToken);
  if (!idToken) return null;
  // Google no iPhone pode emitir o ID token com `at_hash`; aí o Supabase confere contra o access token.
  const accessToken = provedor === "google" ? texto(r.accessToken?.token) : undefined;
  // Apple: o código de autorização (5 minutos, uso único) é o que permite REVOGAR na exclusão da conta.
  const codigoDeAutorizacao = provedor === "apple" ? texto(r.authorizationCode) : undefined;
  return {
    idToken,
    ...(accessToken ? { accessToken } : {}),
    ...(codigoDeAutorizacao ? { codigoDeAutorizacao } : {}),
  };
}

/**
 * A FONTE, pronta para `registrarFonteNativa`. `null` quando este app não oferece provedor nenhum
 * (ex.: Android sem o client ID do Google) — e aí a conta simplesmente não aparece.
 */
export async function criarFonteDeLoginSocial(
  plugin: PluginDeLoginSocial,
  cfg: ConfiguracaoDoLoginSocial,
): Promise<FonteDeCredencialNativa | null> {
  const provedores = provedoresNativos(cfg);
  if (provedores.length === 0) return null;
  await plugin.initialize({
    ...(provedores.includes("google")
      ? { google: { webClientId: cfg.googleWebClientId?.trim(), iOSClientId: cfg.googleIosClientId?.trim(), mode: "online" as const } }
      : {}),
    ...(provedores.includes("apple") ? { apple: { useProperTokenExchange: true } } : {}),
  });

  const esquecer = async (provedor: ProvedorNativo): Promise<void> => {
    await Promise.race([
      plugin.logout({ provider: provedor, clearCachedUserInfo: true }).catch(() => undefined),
      new Promise((r) => setTimeout(r, LIMITE_DO_ESQUECIMENTO_MS)),
    ]);
  };

  let emCurso = false;
  return {
    provedores,
    async obter(provedor, hashDoNonce): Promise<ResultadoDaCredencial> {
      if (!provedores.includes(provedor) || emCurso) return { tipo: "erro" };
      emCurso = true;
      try {
        const resposta = await plugin.login(
          provedor === "google"
            ? {
                provider: "google",
                // Sem escolher sozinho e sem filtrar contas: quem vincula escolhe a conta, sempre.
                options: { nonce: hashDoNonce, filterByAuthorizedAccounts: false, autoSelectEnabled: false },
              }
            : { provider: "apple", options: { scopes: ["email"], nonce: hashDoNonce } },
        );
        const credencial = credencialDo(provedor, resposta?.result);
        return credencial ? { tipo: "credencial", credencial } : { tipo: "erro" };
      } catch (e) {
        return ehCancelamento(e) ? { tipo: "cancelado" } : { tipo: "erro" };
      } finally {
        await esquecer(provedor);
        emCurso = false;
      }
    },
    esquecer,
  };
}

/** As variáveis públicas do build (client IDs não são segredo: vão dentro de qualquer app). */
export function configuracaoDoAmbiente(plataforma: "ios" | "android"): ConfiguracaoDoLoginSocial {
  const env = import.meta.env as { VITE_KING_GOOGLE_WEB_CLIENT_ID?: string; VITE_KING_GOOGLE_IOS_CLIENT_ID?: string };
  return {
    plataforma,
    googleWebClientId: env.VITE_KING_GOOGLE_WEB_CLIENT_ID,
    googleIosClientId: env.VITE_KING_GOOGLE_IOS_CLIENT_ID,
  };
}
