// A PARTIDA DO ANALYTICS — roda UMA vez, antes da primeira tela.
//
// Decide três coisas e sai do caminho:
//
//   1. o CONTEXTO que vai em todo evento (plataforma, ambiente, tráfego, primeiro toque);
//   2. o DESTINO: PostHog quando `VITE_POSTHOG_KEY` + `VITE_POSTHOG_HOST` são válidas; silêncio
//      em qualquer outro caso — faltando, vazias, chave pessoal no lugar do token, host sem https;
//   3. o toque DESTA abertura, que o `app_open` carrega.
//
// COMO DESLIGAR SEM MEXER EM CÓDIGO: tirar `VITE_POSTHOG_KEY` do ambiente e publicar de novo. O
// build sai com o adaptador silencioso e o SDK nem entra no pacote de download.
//
// Tudo aqui é idempotente por página: chamar duas vezes (StrictMode, remontagem, HMR) não inicia
// o SDK duas vezes nem anuncia duas aberturas.
import { analytics } from "./analytics.js";
import { contextoDoPrimeiroToque, lerToque, type Toque } from "./aquisicao.js";
import { detectarAmbiente, detectarPlataforma, detectarTrafego, marcaDeTrafegoNaUrl, temGanchosDeTeste } from "./contexto.js";
import { memoria as memoriaDoNavegador, type Memoria } from "./memoria.js";
import { criarAdaptadorPostHog, validarConfiguracaoDoPostHog, type CarregadorDoSdk } from "./posthog.js";

export interface VariaveisDoAnalytics {
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
  VITE_KING_AMBIENTE?: string;
  VITE_KING_TRAFEGO?: string;
}

export interface JanelaDoAnalytics {
  location?: { search?: string; hostname?: string };
  document?: { referrer?: string };
  navigator?: { webdriver?: boolean };
  Capacitor?: unknown;
}

/** O `VERCEL_ENV` do build, injetado pelo `vite.config.ts`. Fora da Vercel, vazio. */
function vercelEnvDoBuild(): string | undefined {
  try { return typeof __KING_VERCEL_ENV__ === "string" ? __KING_VERCEL_ENV__ : undefined; } catch { return undefined; }
}

let iniciado = false;
let aberturaAnunciada = false;
let toqueDestaAbertura: Toque = {};

export function iniciarAnalytics(o: {
  env?: VariaveisDoAnalytics;
  janela?: JanelaDoAnalytics;
  memoria?: Memoria;
  vercelEnv?: string;
  carregar?: CarregadorDoSdk;
} = {}): void {
  if (iniciado) return;
  iniciado = true;
  try {
    const env = o.env ?? (import.meta.env as VariaveisDoAnalytics);
    const janela = o.janela ?? (typeof window !== "undefined" ? (window as unknown as JanelaDoAnalytics) : {});
    const mem = o.memoria ?? memoriaDoNavegador;
    const search = janela.location?.search ?? "";

    const marca = marcaDeTrafegoNaUrl(search);
    if (marca) mem.atualizar((m) => ({ ...m, trafegoDeTeste: marca === "teste" }));

    toqueDestaAbertura = lerToque(search, janela.document?.referrer ?? "", janela.location?.hostname ?? "");
    let m = mem.ler();
    // O PRIMEIRO toque é gravado uma vez e nunca mais muda — nem quando a pessoa volta por outra
    // campanha. Um toque vazio também conta: é a visita direta.
    if (!m.primeiroToque) m = mem.atualizar((x) => ({ ...x, primeiroToque: toqueDestaAbertura }));

    const ambiente = detectarAmbiente(env.VITE_KING_AMBIENTE, o.vercelEnv ?? vercelEnvDoBuild());
    analytics.definirContexto({
      platform: detectarPlataforma(janela),
      environment: ambiente,
      traffic_type: detectarTrafego({
        ambiente,
        declarado: env.VITE_KING_TRAFEGO,
        webdriver: janela.navigator?.webdriver === true,
        marcado: m.trafegoDeTeste === true,
        ganchosDeTeste: temGanchosDeTeste(search),
      }),
      ...contextoDoPrimeiroToque(m.primeiroToque),
    });

    const cfg = validarConfiguracaoDoPostHog(env.VITE_POSTHOG_KEY, env.VITE_POSTHOG_HOST);
    if (cfg) analytics.usar(criarAdaptadorPostHog({ ...cfg, carregar: o.carregar }));
  } catch { /* sem analytics, com jogo */ }
}

/**
 * `app_open`: UMA vez por abertura do app. É a fonte da retenção — segunda sessão, D1 e D7 são
 * contas feitas sobre ele no PostHog, e não eventos inventados aqui.
 */
export function anunciarAbertura(mem: Memoria = memoriaDoNavegador): void {
  if (aberturaAnunciada) return;
  aberturaAnunciada = true;
  try {
    const primeira = mem.ler().abriu !== true;
    if (primeira) mem.atualizar((m) => ({ ...m, abriu: true }));
    analytics.track("app_open", { first_open: primeira, ...toqueDestaAbertura });
  } catch { /* nunca derruba a abertura do jogo */ }
}

/** Só para testes: devolve o módulo ao estado de página recém-carregada. */
export function reiniciarParaTestes(): void {
  iniciado = false;
  aberturaAnunciada = false;
  toqueDestaAbertura = {};
}
