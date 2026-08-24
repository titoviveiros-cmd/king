// ANALYTICS — as três regras, cobradas.
//
//   1. mede o que precisa ser medido;
//   2. NUNCA derruba o jogo;
//   3. NUNCA carrega dado pessoal.
//
// A terceira é a que exige teste de verdade: "não coletamos PII" é uma frase fácil de escrever
// num documento e fácil de furar num `track` distraído seis meses depois.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENTOS, adaptadorDeConsole, adaptadorSilencioso, analytics, sanitizar,
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

beforeEach(() => analytics.usar(adaptadorSilencioso));

describe("o conjunto de eventos", () => {
  it("cobre o funil que o produto pediu", () => {
    for (const e of [
      "app_open", "tutorial_started", "tutorial_completed", "room_created", "room_joined",
      "match_started", "match_finished", "disconnect", "reconnect", "rematch_clicked",
      "social_message_sent",
    ]) {
      expect(EVENTOS as readonly string[]).toContain(e);
    }
  });

  it("não tem repetidos e usa snake_case", () => {
    expect(new Set(EVENTOS).size).toBe(EVENTOS.length);
    for (const e of EVENTOS) expect(e).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
});

describe("mede", () => {
  it("entrega evento e payload ao adaptador", () => {
    const e = espiao();
    analytics.usar(e);
    analytics.track("match_finished", { maos: 10, bots: 2 });
    expect(e.recebidos).toEqual([{ evento: "match_finished", payload: { maos: 10, bots: 2 } }]);
  });

  it("payload ausente vira objeto vazio, não undefined", () => {
    const e = espiao();
    analytics.usar(e);
    analytics.track("app_open");
    expect(e.recebidos[0].payload).toEqual({});
  });

  it("o destino padrão é o SILÊNCIO — nenhum fornecedor foi contratado", () => {
    expect(analytics.destino).toBe("silencioso");
    expect(() => analytics.track("app_open")).not.toThrow();
  });
});

describe("nunca derruba o jogo", () => {
  it("adaptador que LANÇA não propaga o erro", () => {
    analytics.usar({ nome: "explosivo", enviar() { throw new Error("SDK morreu"); } });
    expect(() => analytics.track("match_started", { bots: 3 })).not.toThrow();
  });

  it("track não devolve promessa: ninguém pode esperar por métrica", () => {
    const e = espiao();
    analytics.usar(e);
    expect(analytics.track("reconnect")).toBeUndefined();
  });

  it("uma falha não cala as próximas chamadas", () => {
    let n = 0;
    analytics.usar({ nome: "instavel", enviar() { n++; if (n === 1) throw new Error("oops"); } });
    analytics.track("disconnect");
    analytics.track("reconnect");
    expect(n).toBe(2);
  });
});

describe("nenhuma PII, nenhum código de sala", () => {
  it("o APELIDO nunca é identificador analítico", () => {
    expect(sanitizar({ nick: "Tito" } as unknown as Payload)).toEqual({});
    expect(sanitizar({ nickname: "Tito" } as unknown as Payload)).toEqual({});
    expect(sanitizar({ apelido: "Tito" } as unknown as Payload)).toEqual({});
    expect(sanitizar({ nome: "Tito Viveiros" } as unknown as Payload)).toEqual({});
  });

  it("o CÓDIGO DA SALA nunca sai — é a chave da partida privada de outras pessoas", () => {
    for (const chave of ["roomCode", "room_code", "codigo", "code", "roomId"]) {
      expect(sanitizar({ [chave]: "0315" }), chave).toEqual({});
    }
  });

  it("credenciais e identificadores de pessoa são descartados", () => {
    for (const chave of ["token", "recoveryToken", "sessionToken", "playerId", "userId", "email", "ip"]) {
      expect(sanitizar({ [chave]: "qualquer-coisa" }), chave).toEqual({});
    }
  });

  it("TEXTO LIVRE não vira métrica, mesmo em chave inocente", () => {
    expect(sanitizar({ comentario: "meu telefone é 11 99999-9999" })).toEqual({});
    expect(sanitizar({ obs: "Tito Viveiros" })).toEqual({});
    expect(sanitizar({ x: "a".repeat(100) })).toEqual({});
  });

  it("o que PASSA é contagem e categoria", () => {
    expect(sanitizar({ maos: 10, bots: 2, venceu: true, contrato: "no-king", origem: "lobby" }))
      .toEqual({ maos: 10, bots: 2, venceu: true, contrato: "no-king", origem: "lobby" });
  });

  it("número inválido não passa disfarçado de métrica", () => {
    expect(sanitizar({ a: NaN, b: Infinity, c: 3 })).toEqual({ c: 3 });
  });

  it("a lista proibida ignora maiúsculas e separadores", () => {
    expect(sanitizar({ NICK: "Tito" } as unknown as Payload)).toEqual({});
    expect(sanitizar({ "room-code": "0315" })).toEqual({});
    expect(sanitizar({ Room_Id: "0315" })).toEqual({});
  });

  it("nada escapa por engano num evento real do jogo", () => {
    const e = espiao();
    analytics.usar(e);
    // como alguém distraído chamaria: com tudo que tinha à mão
    analytics.track("room_joined", {
      roomCode: "0315", nick: "Tito", bots: 2, humanos: 2,
    } as unknown as Payload);
    expect(e.recebidos[0].payload).toEqual({ bots: 2, humanos: 2 });
  });
});

describe("adaptador de console", () => {
  it("imprime sem quebrar — é o que permite conferir o funil sem contratar ninguém", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    analytics.usar(adaptadorDeConsole);
    analytics.track("tutorial_completed", { passos: 16 });
    expect(info).toHaveBeenCalledWith("[analytics] tutorial_completed", { passos: 16 });
    info.mockRestore();
  });
});
