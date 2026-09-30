// ADAPTADOR POSTHOG — sem rede. O SDK é substituído por um falso que registra tudo; o que se prova
// aqui é o CONTRATO: configuração restritiva, init uma vez só, fila até o SDK chegar, falha
// absorvida, e o `before_send` como última barreira. O SDK de verdade é exercitado no e2e
// (`tests-analytics/`), contra um host fictício interceptado.
//
// `posthogSdk.ts` (carregado sob demanda) guarda configuração e filtro; `posthog.ts` (no pacote
// inicial) guarda a fila e a validação. Os dois lados são cobrados aqui.
import { describe, expect, it, vi } from "vitest";
import type { CaptureResult } from "posthog-js/dist/module.slim.no-external.js";
import { criarAdaptadorPostHog, validarConfiguracaoDoPostHog, type ClientePostHog } from "./posthog.js";
import {
  PROPRIEDADES_DO_SDK, abrirPostHog, configuracaoDoPostHog, filtrarEventoDoPostHog, type SdkPostHog,
} from "./posthogSdk.js";

const CHAVE = "phc_" + "A".repeat(40);
const HOST = "https://us.i.posthog.com";

function sdkFalso() {
  const sdk = {
    init: vi.fn(),
    capture: vi.fn(),
    // O que o KING NUNCA pode chamar. Se aparecer chamada, o teste acusa.
    identify: vi.fn(),
    alias: vi.fn(),
    setPersonProperties: vi.fn(),
    group: vi.fn(),
    register: vi.fn(),
  };
  return sdk;
}

describe("configuração restritiva", () => {
  const c = configuracaoDoPostHog(HOST);

  it("nenhuma coleta automática", () => {
    expect(c).toMatchObject({
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      capture_exceptions: false,
      disable_scroll_properties: true,
    });
  });

  it("sem replay, surveys, tours, conversas, experimentos", () => {
    expect(c).toMatchObject({
      disable_session_recording: true,
      disable_surveys: true,
      disable_surveys_automatic_display: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
    });
  });

  it("nada de fora: sem script externo, sem /flags, sem config remota", () => {
    expect(c).toMatchObject({
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      advanced_disable_feature_flags: true,
    });
  });

  it("anônimo: sem perfil de pessoa, sem cookie, sem referrer nem campanha guardados", () => {
    expect(c).toMatchObject({
      person_profiles: "identified_only",
      persistence: "localStorage",
      save_referrer: false,
      save_campaign_params: false,
      mask_personal_data_properties: true,
      debug: false,
    });
    for (const p of ["nick", "email", "codigo", "token"]) expect(c.custom_personal_data_properties).toContain(p);
  });

  it("o before_send é o filtro do KING e o host é o configurado", () => {
    expect(c.before_send).toBe(filtrarEventoDoPostHog);
    expect(c.api_host).toBe(HOST);
    expect(c.request_batching).toBe(false);
  });
});

describe("validarConfiguracaoDoPostHog", () => {
  it("aceita token de projeto (phc_) e host https", () => {
    expect(validarConfiguracaoDoPostHog(CHAVE, "https://us.i.posthog.com/")).toEqual({ chave: CHAVE, host: "https://us.i.posthog.com" });
    expect(validarConfiguracaoDoPostHog(` ${CHAVE} `, "https://playkingcards.com.br/ingest/")).toEqual({ chave: CHAVE, host: "https://playkingcards.com.br/ingest" });
  });

  it("RECUSA a chave pessoal (phx_) — ela dá acesso à conta e nunca pode ir para o pacote", () => {
    expect(validarConfiguracaoDoPostHog("phx_" + "A".repeat(40), HOST)).toBeNull();
  });

  it("recusa o que não é configuração completa e segura", () => {
    expect(validarConfiguracaoDoPostHog(undefined, HOST)).toBeNull();
    expect(validarConfiguracaoDoPostHog(CHAVE, undefined)).toBeNull();
    expect(validarConfiguracaoDoPostHog("", HOST)).toBeNull();
    expect(validarConfiguracaoDoPostHog("phc_curta", HOST)).toBeNull();
    expect(validarConfiguracaoDoPostHog(CHAVE, "http://us.i.posthog.com")).toBeNull();
    expect(validarConfiguracaoDoPostHog(CHAVE, "https://u:p@us.i.posthog.com")).toBeNull();
    expect(validarConfiguracaoDoPostHog(CHAVE, "https://us.i.posthog.com/?x=1")).toBeNull();
    expect(validarConfiguracaoDoPostHog(CHAVE, "não é url")).toBeNull();
  });
});

describe("filtrarEventoDoPostHog — a última barreira", () => {
  const ev = (event: string, properties: Record<string, unknown>, extra: Partial<CaptureResult> = {}): CaptureResult =>
    ({ uuid: "u-1", event, properties, ...extra }) as CaptureResult;

  it("evento que não é do KING não sai ($pageview, $identify, $autocapture, $exception, $web_vitals…)", () => {
    for (const nome of ["$pageview", "$pageleave", "$identify", "$autocapture", "$exception", "$web_vitals", "$snapshot", "$set", "qualquer"]) {
      expect(filtrarEventoDoPostHog(ev(nome, {})), nome).toBeNull();
    }
    expect(filtrarEventoDoPostHog(null)).toBeNull();
  });

  it("URL, referrer e propriedades de pessoa somem; o que o SDK precisa fica", () => {
    const r = filtrarEventoDoPostHog(ev("app_open", {
      token: "phc_x", distinct_id: "019a-anon", $device_id: "019a-anon", $session_id: "s", $window_id: "w",
      $insert_id: "i", $time: 1, $lib: "web", $lib_version: "1.434.17", $os: "Android", $browser: "Chrome", $device_type: "Mobile",
      $current_url: "https://playkingcards.com.br/?utm_source=x&nick=Tito", $host: "playkingcards.com.br", $pathname: "/",
      $referrer: "https://l.instagram.com/?u=abc", $referring_domain: "l.instagram.com", $initial_referrer: "x",
      $raw_user_agent: "Mozilla/5.0", $screen_height: 393, $timezone: "America/Sao_Paulo",
      gclid: "abc", fbclid: "IwAR", utm_source: "instagram", first_open: true,
      traffic_type: "real", platform: "web", environment: "production",
    }, { $set: { email: "a@b.com" }, $set_once: { $initial_current_url: "https://x" }, $unset: ["x"] }));
    expect(r).not.toBeNull();
    const p = r!.properties as Record<string, unknown>;
    for (const k of ["$current_url", "$host", "$pathname", "$referrer", "$referring_domain", "$initial_referrer", "$raw_user_agent", "$screen_height", "$timezone", "gclid", "fbclid"]) {
      expect(p, k).not.toHaveProperty(k);
    }
    expect(p).toMatchObject({ token: "phc_x", distinct_id: "019a-anon", $session_id: "s", $os: "Android", utm_source: "instagram", first_open: true, traffic_type: "real" });
    expect(r).not.toHaveProperty("$set");
    expect(r).not.toHaveProperty("$set_once");
    expect(r).not.toHaveProperty("$unset");
  });

  it("$process_person_profile é SEMPRE falso — nenhum perfil de pessoa nasce destes eventos", () => {
    const r = filtrarEventoDoPostHog(ev("match_started", { $process_person_profile: true, modo: "local" }));
    expect((r!.properties as Record<string, unknown>).$process_person_profile).toBe(false);
  });

  it("GeoIP DESLIGADO em TODO evento do KING — e ninguém consegue religar pelo evento", () => {
    for (const nome of ["app_open", "match_started", "match_finished", "room_created", "reconnect"]) {
      const r = filtrarEventoDoPostHog(ev(nome, { $geoip_disable: false, modo: "online" }));
      expect((r!.properties as Record<string, unknown>).$geoip_disable, nome).toBe(true);
    }
  });

  it("nenhuma propriedade de localização passa, venha de onde vier", () => {
    const r = filtrarEventoDoPostHog(ev("app_open", {
      $geoip_city_name: "Salvador", $geoip_subdivision_1_name: "Bahia", $geoip_postal_code: "40000",
      $geoip_latitude: -12.8, $geoip_longitude: -38.4, $geoip_country_name: "Brazil", $geoip_time_zone: "America/Bahia",
      $ip: "200.1.2.3", $timezone: "America/Bahia",
    }));
    const chaves = Object.keys(r!.properties as Record<string, unknown>);
    expect(chaves.filter((k) => /geoip|^\$ip$|timezone|latitude|longitude|postal|city|subdivision/i.test(k))).toEqual(["$geoip_disable"]);
  });

  it("as NOSSAS propriedades são revalidadas pelo esquema na saída", () => {
    const r = filtrarEventoDoPostHog(ev("match_finished", {
      modo: "online", posicao: 9, empate: "sim", nick: "Tito", roomCode: "0315", matchId: "ca1380b2-1111", score: -450,
    }));
    const p = r!.properties as Record<string, unknown>;
    expect(p.modo).toBe("online");
    for (const k of ["posicao", "empate", "nick", "roomCode", "matchId", "score"]) expect(p, k).not.toHaveProperty(k);
  });

  it("a lista de propriedades do SDK não traz nada com URL, referrer ou pessoa", () => {
    for (const k of PROPRIEDADES_DO_SDK) expect(k).not.toMatch(/url|referr|host|path|set|initial|ip|agent|screen|email|name/i);
  });

  it("evento malformado não sai e não lança", () => {
    const hostil = { uuid: "u", event: "app_open", get properties() { throw new Error("x"); } } as unknown as CaptureResult;
    expect(filtrarEventoDoPostHog(hostil)).toBeNull();
  });
});

describe("abrirPostHog — o init do SDK", () => {
  it("inicia UMA vez, com a configuração do KING, e só expõe capture", () => {
    const sdk = sdkFalso();
    const cliente = abrirPostHog(CHAVE, HOST, sdk as unknown as SdkPostHog);
    expect(sdk.init).toHaveBeenCalledTimes(1);
    expect(sdk.init).toHaveBeenCalledWith(CHAVE, configuracaoDoPostHog(HOST));
    expect(Object.keys(cliente)).toEqual(["capture"]);
    cliente.capture("app_open", { first_open: true });
    expect(sdk.capture).toHaveBeenCalledWith("app_open", { first_open: true });
  });

  it("NUNCA identifica, apelida nem cria perfil de pessoa", () => {
    const sdk = sdkFalso();
    const cliente = abrirPostHog(CHAVE, HOST, sdk as unknown as SdkPostHog);
    cliente.capture("match_started", { modo: "local" });
    for (const m of [sdk.identify, sdk.alias, sdk.setPersonProperties, sdk.group, sdk.register]) expect(m).not.toHaveBeenCalled();
  });
});

describe("criarAdaptadorPostHog — a fila no pacote inicial", () => {
  const clienteFalso = () => ({ capture: vi.fn() });

  it("carrega uma vez, e entrega a fila na ordem", async () => {
    const cliente = clienteFalso();
    const carregar = vi.fn(async () => cliente as ClientePostHog);
    const a = criarAdaptadorPostHog({ chave: CHAVE, host: HOST, carregar });
    a.enviar("app_open", { first_open: true });
    a.enviar("match_started", { modo: "local" });
    expect(cliente.capture).not.toHaveBeenCalled(); // ainda carregando: enviar não esperou nada
    await a.pronto();
    a.enviar("match_finished", { modo: "local", posicao: 1, empate: false });
    await a.pronto();
    expect(carregar).toHaveBeenCalledTimes(1);
    expect(carregar).toHaveBeenCalledWith(CHAVE, HOST);
    expect(cliente.capture.mock.calls.map((c) => c[0])).toEqual(["app_open", "match_started", "match_finished"]);
  });

  it("SDK que não carrega (bloqueado, offline): desiste em silêncio e descarta a fila", async () => {
    const carregar = vi.fn(async (): Promise<ClientePostHog> => { throw new Error("ERR_BLOCKED_BY_CLIENT"); });
    const a = criarAdaptadorPostHog({ chave: CHAVE, host: HOST, carregar });
    expect(() => a.enviar("app_open", {})).not.toThrow();
    expect(await a.pronto()).toBe(false);
    expect(() => a.enviar("match_started", { modo: "local" })).not.toThrow();
    expect(carregar).toHaveBeenCalledTimes(1); // não fica tentando a cada evento
  });

  it("carregador que lança SÍNCRONO também é absorvido", async () => {
    const a = criarAdaptadorPostHog({ chave: CHAVE, host: HOST, carregar: () => { throw new Error("sync"); } });
    expect(() => a.enviar("app_open", {})).not.toThrow();
    expect(await a.pronto()).toBe(false);
  });

  it("SDK que lança no init ou no capture não derruba nada", async () => {
    const quebraInit = { init: () => { throw new Error("init"); }, capture: vi.fn() };
    const a = criarAdaptadorPostHog({ chave: CHAVE, host: HOST, carregar: async (c, h) => abrirPostHog(c, h, quebraInit) });
    a.enviar("app_open", {});
    expect(await a.pronto()).toBe(false);

    const quebraCapture = { init: vi.fn(), capture: () => { throw new Error("capture"); } };
    const b = criarAdaptadorPostHog({ chave: CHAVE, host: HOST, carregar: async (c, h) => abrirPostHog(c, h, quebraCapture) });
    b.enviar("app_open", {});
    expect(await b.pronto()).toBe(true);
    expect(() => b.enviar("match_started", { modo: "local" })).not.toThrow();
  });

  it("módulo sem a forma esperada é tratado como falha", async () => {
    const a = criarAdaptadorPostHog({ chave: CHAVE, host: HOST, carregar: async () => ({}) as unknown as ClientePostHog });
    a.enviar("app_open", {});
    expect(await a.pronto()).toBe(false);
  });

  it("a fila tem teto: SDK que demora não acumula memória sem fim", async () => {
    const cliente = clienteFalso();
    let liberar!: () => void;
    const carregar = () => new Promise<ClientePostHog>((r) => { liberar = () => r(cliente); });
    const a = criarAdaptadorPostHog({ chave: CHAVE, host: HOST, carregar, limiteDaFila: 3 });
    for (let i = 0; i < 10; i++) a.enviar("reconnect", { modo: "online" });
    await Promise.resolve();
    await Promise.resolve();
    liberar();
    await a.pronto();
    expect(cliente.capture).toHaveBeenCalledTimes(3);
  });
});
