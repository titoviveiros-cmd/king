// ANALYTICS — as quatro regras, cobradas.
//
//   1. mede o que precisa ser medido, no formato combinado;
//   2. NUNCA derruba o jogo;
//   3. NUNCA carrega dado pessoal, código de sala, id de partida ou URL;
//   4. o esquema é FECHADO — e alargá-lo não pode abrir a porta por engano.
//
// A terceira é a que exige teste de verdade: "não coletamos PII" é uma frase fácil de escrever
// num documento e fácil de furar num `track` distraído seis meses depois.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ESQUEMA, ESQUEMA_DO_CONTEXTO, EVENTOS, adaptadorDeConsole, adaptadorSilencioso, analytics,
  chaveProibida, pareceIdentificador, sanitizar, sanitizarContexto,
  type Adaptador, type Evento, type Payload,
} from "./analytics.js";

/** Adaptador de teste: guarda o que recebeu. */
function espiao(): Adaptador & { recebidos: { evento: Evento; payload: Payload }[] } {
  const recebidos: { evento: Evento; payload: Payload }[] = [];
  return {
    nome: "espiao",
    recebidos,
    enviar(evento, payload) { recebidos.push({ evento, payload }); },
  };
}

/** O que alguém distraído passaria: tudo que tinha à mão. */
const TUDO_QUE_NAO_PODE_SAIR = {
  nick: "Tito", apelido: "Tito", nome: "Tito Viveiros",
  roomCode: "0315", room_code: "0315", codigo: "0315",
  playerId: "b7a1c2d3-0000-4000-8000-000000000000", userId: "u-1", user_id: "u-1", sub: "u-1",
  email: "tito@example.com", token: "eyJhbGciOi", recoveryToken: "r-1", accessToken: "a-1",
  matchId: "ca1380b2-1111-4111-8111-111111111111", partidaId: "p-1", ledgerId: "l-1",
  url: "https://playkingcards.com.br/?utm_source=x&nick=Tito", href: "https://x.y/z", currentUrl: "https://a.b/c",
  ip: "200.1.2.3",
};

beforeEach(() => {
  analytics.usar(adaptadorSilencioso);
  analytics.definirContexto({});
});

describe("o conjunto de eventos", () => {
  it("cobre o funil pedido: aquisição → ativação → partida → retenção → multiplayer → convite", () => {
    for (const e of [
      "app_open", "tutorial_started", "tutorial_completed", "first_match_started",
      "match_started", "match_finished", "room_created", "room_joined",
      "invite_code_copied", "result_shared", "disconnect", "reconnect", "rematch_clicked",
      "social_message_sent",
    ]) {
      expect(EVENTOS as readonly string[]).toContain(e);
    }
  });

  it("NÃO inventa eventos: sem second_session/D1/D7 (são métricas derivadas) e sem invite_shared (não há fluxo)", () => {
    for (const e of ["second_session", "d1", "d7", "retention", "invite_shared", "page_view"]) {
      expect(EVENTOS as readonly string[]).not.toContain(e);
    }
  });

  it("não tem repetidos e usa snake_case", () => {
    expect(new Set(EVENTOS).size).toBe(EVENTOS.length);
    for (const e of EVENTOS) expect(e).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });

  it("todo evento tem esquema, e nenhum esquema existe sem evento", () => {
    expect(Object.keys(ESQUEMA).sort()).toEqual([...EVENTOS].sort());
  });
});

describe("o esquema não abre a porta", () => {
  it("nenhuma chave de evento ou de contexto cai na lista proibida", () => {
    const todas = [...Object.values(ESQUEMA).flatMap((e) => Object.keys(e)), ...Object.keys(ESQUEMA_DO_CONTEXTO)];
    for (const k of todas) expect(chaveProibida(k), k).toBe(false);
  });

  it("contexto e evento não disputam a mesma chave", () => {
    for (const [evento, esquema] of Object.entries(ESQUEMA)) {
      for (const k of Object.keys(esquema)) expect(Object.keys(ESQUEMA_DO_CONTEXTO), `${evento}.${k}`).not.toContain(k);
    }
  });

  it("match_started e match_finished não aceitam placar bruto", () => {
    for (const e of ["match_started", "match_finished"] as const) {
      expect(Object.keys(ESQUEMA[e])).not.toContain("score");
      expect(Object.keys(ESQUEMA[e])).not.toContain("pontos");
    }
  });
});

describe("mede", () => {
  it("entrega evento e payload limpos ao adaptador, com o contexto junto", () => {
    const e = espiao();
    analytics.usar(e);
    analytics.definirContexto({ platform: "web", environment: "production", traffic_type: "real" });
    analytics.track("match_finished", { modo: "online", posicao: 2, empate: false });
    expect(e.recebidos).toEqual([{
      evento: "match_finished",
      payload: { platform: "web", environment: "production", traffic_type: "real", modo: "online", posicao: 2, empate: false },
    }]);
  });

  it("payload ausente vira só o contexto, não undefined", () => {
    const e = espiao();
    analytics.usar(e);
    analytics.track("app_open");
    expect(e.recebidos[0].payload).toEqual({});
  });

  it("o destino padrão é o SILÊNCIO", () => {
    expect(analytics.destino).toBe("silencioso");
    expect(() => analytics.track("app_open")).not.toThrow();
  });

  it("evento fora do conjunto não sai, nem por um adaptador que aceitaria", () => {
    const e = espiao();
    analytics.usar(e);
    analytics.track("$pageview" as Evento, {});
    analytics.track("second_session" as Evento, {});
    expect(e.recebidos).toEqual([]);
  });
});

describe("formatos fechados", () => {
  it("modo só local|online; posição só 1..4 inteira; empate só booleano", () => {
    expect(sanitizar("match_finished", { modo: "offline", posicao: 5, empate: "sim" })).toEqual({});
    expect(sanitizar("match_finished", { modo: "local", posicao: 0 })).toEqual({ modo: "local" });
    expect(sanitizar("match_finished", { posicao: 2.5 })).toEqual({});
    expect(sanitizar("match_finished", { modo: "online", posicao: 4, empate: true }))
      .toEqual({ modo: "online", posicao: 4, empate: true });
  });

  it("method do compartilhamento só native_share|clipboard", () => {
    expect(sanitizar("result_shared", { method: "whatsapp" })).toEqual({});
    expect(sanitizar("result_shared", { method: "native_share" })).toEqual({ method: "native_share" });
    expect(sanitizar("result_shared", { method: "clipboard" })).toEqual({ method: "clipboard" });
  });

  it("a etiqueta social só passa se for do catálogo fechado", () => {
    expect(sanitizar("social_message_sent", { mensagem: "boa" })).toEqual({ mensagem: "boa" });
    expect(sanitizar("social_message_sent", { mensagem: "vem-pro-meu-grupo" })).toEqual({});
  });

  it("contexto: plataforma, ambiente e tráfego só dos conjuntos", () => {
    expect(sanitizarContexto({ platform: "windows", environment: "staging", traffic_type: "bot" })).toEqual({});
    expect(sanitizarContexto({ platform: "capacitor_ios", environment: "preview", traffic_type: "test" }))
      .toEqual({ platform: "capacitor_ios", environment: "preview", traffic_type: "test" });
  });

  it("chave fora do esquema do evento não sai, mesmo inocente", () => {
    expect(sanitizar("room_created", { bots: 2, humanos: 2 })).toEqual({});
    expect(sanitizar("match_started", { maos: 10 })).toEqual({});
  });

  it("número inválido não passa disfarçado de métrica", () => {
    expect(sanitizar("match_started", { humanos: NaN, bots: Infinity })).toEqual({});
  });
});

describe("nenhuma PII, nenhum código de sala, nenhum id, nenhuma URL", () => {
  it("nada da lista escapa em NENHUM evento", () => {
    for (const evento of EVENTOS) {
      expect(sanitizar(evento, TUDO_QUE_NAO_PODE_SAIR), evento).toEqual({});
    }
    expect(sanitizarContexto(TUDO_QUE_NAO_PODE_SAIR)).toEqual({});
  });

  it("nem misturado com o que é legítimo", () => {
    const e = espiao();
    analytics.usar(e);
    analytics.track("match_started", { ...TUDO_QUE_NAO_PODE_SAIR, modo: "online", humanos: 2, bots: 2 } as unknown as Payload);
    expect(e.recebidos[0].payload).toEqual({ modo: "online", humanos: 2, bots: 2 });
  });

  it("a lista proibida ignora maiúsculas, separadores e prefixos", () => {
    for (const k of ["NICK", "room-code", "Room_Id", "player_nick", "userEmail", "x_access_token", "pageUrl", "match_id"]) {
      expect(chaveProibida(k), k).toBe(true);
    }
  });

  it("rótulo livre com cara de identificador não passa (código de sala, uuid, token, e-mail)", () => {
    for (const v of ["0315", "1234567", "b7a1c2d3-0000-4000", "deadbeefcafe1234", "a@b.com"]) {
      expect(pareceIdentificador(v), v).toBe(true);
      expect(sanitizar("app_open", { utm_campaign: v }), v).toEqual({});
    }
    expect(sanitizar("app_open", { utm_campaign: "black_friday" })).toEqual({ utm_campaign: "black_friday" });
  });

  it("URL, texto com espaço e maiúsculas não viram rótulo", () => {
    expect(sanitizar("app_open", { referrer_host: "https://l.instagram.com/?u=x" })).toEqual({});
    expect(sanitizar("app_open", { utm_source: "Tito Viveiros" })).toEqual({});
    expect(sanitizar("app_open", { utm_source: "Instagram" })).toEqual({});
  });
});

describe("nunca derruba o jogo", () => {
  it("adaptador que LANÇA não propaga o erro", () => {
    analytics.usar({ nome: "explosivo", enviar() { throw new Error("SDK morreu"); } });
    expect(() => analytics.track("match_started", { modo: "local" })).not.toThrow();
  });

  it("track não devolve promessa: ninguém pode esperar por métrica", () => {
    analytics.usar(espiao());
    expect(analytics.track("reconnect")).toBeUndefined();
  });

  it("uma falha não cala as próximas chamadas", () => {
    let n = 0;
    analytics.usar({ nome: "instavel", enviar() { n++; if (n === 1) throw new Error("oops"); } });
    analytics.track("disconnect");
    analytics.track("reconnect");
    expect(n).toBe(2);
  });

  it("payload hostil (getter que lança) não derruba", () => {
    const e = espiao();
    analytics.usar(e);
    const hostil = Object.defineProperty({}, "modo", { enumerable: true, get() { throw new Error("armadilha"); } });
    expect(() => analytics.track("match_started", hostil as Payload)).not.toThrow();
  });
});

describe("adaptador de console", () => {
  it("imprime sem quebrar — é o que permite conferir o funil sem contratar ninguém", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    analytics.usar(adaptadorDeConsole);
    analytics.track("tutorial_completed");
    expect(info).toHaveBeenCalledWith("[analytics] tutorial_completed", {});
    info.mockRestore();
  });
});
