// A INICIALIZAÇÃO — destino, contexto e a abertura. Sem configuração é silêncio de verdade: nem o
// SDK é carregado. E a abertura sai uma vez por página, carregando a origem da visita.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adaptadorSilencioso, analytics, type Adaptador, type Evento, type Payload } from "./analytics.js";
import { anunciarAbertura, iniciarAnalytics, reiniciarParaTestes } from "./iniciar.js";
import { criarMemoria, type ArmazenamentoSimples } from "./memoria.js";
import type { ClientePostHog } from "./posthog.js";
import { abrirPostHog, type SdkPostHog } from "./posthogSdk.js";

const CHAVE = "phc_" + "B".repeat(40);
const HOST = "https://us.i.posthog.com";
const ENV_OK = { VITE_POSTHOG_KEY: CHAVE, VITE_POSTHOG_HOST: HOST };

function espiao(): Adaptador & { recebidos: { evento: Evento; payload: Payload }[] } {
  const recebidos: { evento: Evento; payload: Payload }[] = [];
  return { nome: "espiao", recebidos, enviar(evento, payload) { recebidos.push({ evento, payload }); } };
}
function disco(): ArmazenamentoSimples {
  const d = new Map<string, string>();
  return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => { d.set(k, v); } };
}
const janela = (search = "", referrer = "", extra: object = {}) =>
  ({ location: { search, hostname: "playkingcards.com.br" }, document: { referrer }, navigator: { webdriver: false }, ...extra });

beforeEach(() => {
  reiniciarParaTestes();
  analytics.usar(adaptadorSilencioso);
  analytics.definirContexto({});
});

describe("destino", () => {
  it("SEM VITE_POSTHOG_*: silêncio, e o SDK NUNCA é carregado", () => {
    const carregar = vi.fn();
    iniciarAnalytics({ env: {}, janela: janela(), memoria: criarMemoria(disco), carregar });
    analytics.track("app_open", {});
    expect(analytics.destino).toBe("silencioso");
    expect(carregar).not.toHaveBeenCalled();
  });

  it("só a chave, ou só o host, também é silêncio", () => {
    iniciarAnalytics({ env: { VITE_POSTHOG_KEY: CHAVE }, janela: janela(), memoria: criarMemoria(disco) });
    expect(analytics.destino).toBe("silencioso");
    reiniciarParaTestes();
    iniciarAnalytics({ env: { VITE_POSTHOG_HOST: HOST }, janela: janela(), memoria: criarMemoria(disco) });
    expect(analytics.destino).toBe("silencioso");
  });

  it("chave PESSOAL no lugar do token: silêncio, nunca envio", () => {
    iniciarAnalytics({ env: { VITE_POSTHOG_KEY: "phx_" + "C".repeat(40), VITE_POSTHOG_HOST: HOST }, janela: janela(), memoria: criarMemoria(disco) });
    expect(analytics.destino).toBe("silencioso");
  });

  it("com as duas válidas: PostHog", () => {
    iniciarAnalytics({ env: ENV_OK, janela: janela(), memoria: criarMemoria(disco), carregar: vi.fn() });
    expect(analytics.destino).toBe("posthog");
  });

  it("INIT ÚNICO: iniciar duas vezes (StrictMode, HMR) carrega e inicia o SDK uma vez", async () => {
    const sdk = { init: vi.fn(), capture: vi.fn() };
    const carregar = vi.fn(async (c: string, h: string): Promise<ClientePostHog> => abrirPostHog(c, h, sdk as SdkPostHog));
    iniciarAnalytics({ env: ENV_OK, janela: janela(), memoria: criarMemoria(disco), carregar });
    iniciarAnalytics({ env: ENV_OK, janela: janela(), memoria: criarMemoria(disco), carregar });
    analytics.track("app_open", {});
    analytics.track("match_started", { modo: "local" });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(carregar).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.capture).toHaveBeenCalledTimes(2);
  });

  it("janela sem nada (ambiente estranho) não derruba", () => {
    expect(() => iniciarAnalytics({ env: ENV_OK, janela: {}, memoria: criarMemoria(disco), carregar: vi.fn() })).not.toThrow();
  });
});

describe("contexto", () => {
  it("web, ambiente do build, tráfego real sem sinais de teste", () => {
    iniciarAnalytics({ env: {}, janela: janela(), memoria: criarMemoria(disco), vercelEnv: "production" });
    expect(analytics.contexto).toEqual({ platform: "web", environment: "production", traffic_type: "real" });
  });

  it("build de e2e (VITE_KING_TRAFEGO=test) é tráfego de teste", () => {
    iniciarAnalytics({ env: { VITE_KING_TRAFEGO: "test" }, janela: janela(), memoria: criarMemoria(disco), vercelEnv: "production" });
    expect(analytics.contexto.traffic_type).toBe("test");
  });

  it("Preview é tráfego de teste mesmo sem nenhum outro sinal", () => {
    iniciarAnalytics({ env: {}, janela: janela(), memoria: criarMemoria(disco), vercelEnv: "preview" });
    expect(analytics.contexto).toEqual({ platform: "web", environment: "preview", traffic_type: "test" });
  });

  it("navegador automatizado é tráfego de teste", () => {
    iniciarAnalytics({ env: {}, janela: { ...janela(), navigator: { webdriver: true } }, memoria: criarMemoria(disco), vercelEnv: "production" });
    expect(analytics.contexto.traffic_type).toBe("test");
  });

  it("?trafego=teste marca o navegador — e a marca vale nas próximas aberturas, até ?trafego=real", () => {
    const d = disco();
    iniciarAnalytics({ env: {}, janela: janela("?trafego=teste"), memoria: criarMemoria(() => d), vercelEnv: "production" });
    expect(analytics.contexto.traffic_type).toBe("test");
    reiniciarParaTestes();
    iniciarAnalytics({ env: {}, janela: janela(""), memoria: criarMemoria(() => d), vercelEnv: "production" });
    expect(analytics.contexto.traffic_type).toBe("test");
    reiniciarParaTestes();
    iniciarAnalytics({ env: {}, janela: janela("?trafego=real"), memoria: criarMemoria(() => d), vercelEnv: "production" });
    expect(analytics.contexto.traffic_type).toBe("real");
  });

  it("app nativo: a plataforma vem do runtime do Capacitor", () => {
    iniciarAnalytics({ env: { VITE_KING_AMBIENTE: "production" }, janela: janela("", "", { Capacitor: { getPlatform: () => "android" } }), memoria: criarMemoria(disco) });
    expect(analytics.contexto).toMatchObject({ platform: "capacitor_android", environment: "production" });
  });

  it("o PRIMEIRO toque fica gravado e vai em todo evento — mesmo quando a pessoa volta por outro caminho", () => {
    const d = disco();
    iniciarAnalytics({ env: {}, janela: janela("?utm_source=Instagram&utm_campaign=Lancamento", "https://l.instagram.com/"), memoria: criarMemoria(() => d) });
    expect(analytics.contexto).toMatchObject({ first_utm_source: "instagram", first_utm_campaign: "lancamento", first_referrer_host: "l.instagram.com" });
    reiniciarParaTestes();
    iniciarAnalytics({ env: {}, janela: janela("?utm_source=tiktok", "https://www.tiktok.com/"), memoria: criarMemoria(() => d) });
    expect(analytics.contexto).toMatchObject({ first_utm_source: "instagram", first_referrer_host: "l.instagram.com" });
  });
});

describe("app_open", () => {
  it("UMA vez por página, com first_open e o toque DESTA abertura", () => {
    const d = disco();
    const e = espiao();
    iniciarAnalytics({ env: {}, janela: janela("?utm_source=Instagram&nick=Tito&codigo=0315", "https://l.instagram.com/x?y=z"), memoria: criarMemoria(() => d) });
    analytics.usar(e);
    anunciarAbertura(criarMemoria(() => d));
    anunciarAbertura(criarMemoria(() => d));
    expect(e.recebidos).toHaveLength(1);
    expect(e.recebidos[0].evento).toBe("app_open");
    expect(e.recebidos[0].payload).toMatchObject({ first_open: true, utm_source: "instagram", referrer_host: "l.instagram.com" });
    expect(JSON.stringify(e.recebidos)).not.toMatch(/Tito|0315|x\?y=z/);
  });

  it("na abertura seguinte do mesmo aparelho, first_open é falso — é disso que sai a retenção", () => {
    const d = disco();
    const e = espiao();
    iniciarAnalytics({ env: {}, janela: janela(), memoria: criarMemoria(() => d) });
    analytics.usar(e);
    anunciarAbertura(criarMemoria(() => d));
    reiniciarParaTestes();
    iniciarAnalytics({ env: {}, janela: janela(), memoria: criarMemoria(() => d) });
    analytics.usar(e);
    anunciarAbertura(criarMemoria(() => d));
    expect(e.recebidos.map((r) => r.payload.first_open)).toEqual([true, false]);
  });
});
