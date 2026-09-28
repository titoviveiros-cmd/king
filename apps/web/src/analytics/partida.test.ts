// PARTIDAS — começo e fim nos dois modos, `first_match_started` uma vez por instalação, e a mesma
// partida online nunca contada duas vezes (reload na Mesa ou no Placar). O id dela fica no
// aparelho e nunca sai em evento.
import { beforeEach, describe, expect, it } from "vitest";
import { adaptadorSilencioso, analytics, type Adaptador, type Evento, type Payload } from "./analytics.js";
import { criarMemoria, CHAVE_DA_MEMORIA, type ArmazenamentoSimples } from "./memoria.js";
import { anunciarFimDePartida, anunciarInicioDePartida, contarAssentos } from "./partida.js";

function espiao(): Adaptador & { recebidos: { evento: Evento; payload: Payload }[] } {
  const recebidos: { evento: Evento; payload: Payload }[] = [];
  return { nome: "espiao", recebidos, enviar(evento, payload) { recebidos.push({ evento, payload }); } };
}

function armazenamento(): ArmazenamentoSimples & { dados: Map<string, string> } {
  const dados = new Map<string, string>();
  return { dados, getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => { dados.set(k, v); } };
}

const MATCH = "ca1380b2-1111-4111-8111-111111111111";
let e: ReturnType<typeof espiao>;

beforeEach(() => {
  e = espiao();
  analytics.usar(e);
  analytics.definirContexto({});
});
const nomes = () => e.recebidos.map((r) => r.evento);

describe("match_started e first_match_started", () => {
  it("local: modo, humanos e bots; a PRIMEIRA partida também anuncia first_match_started", () => {
    const mem = criarMemoria(armazenamento);
    anunciarInicioDePartida({ modo: "local", humanos: 1, bots: 3 }, mem);
    expect(e.recebidos).toEqual([
      { evento: "match_started", payload: { modo: "local", humanos: 1, bots: 3 } },
      { evento: "first_match_started", payload: { modo: "local" } },
    ]);
  });

  it("first_match_started UMA vez por instalação — nas partidas seguintes, e depois de recarregar", () => {
    const disco = armazenamento();
    anunciarInicioDePartida({ modo: "local", humanos: 1, bots: 3 }, criarMemoria(() => disco));
    anunciarInicioDePartida({ modo: "local", humanos: 1, bots: 3 }, criarMemoria(() => disco));
    // "recarregar a página": memória nova sobre o MESMO armazenamento
    anunciarInicioDePartida({ modo: "online", humanos: 2, bots: 2, partidaId: MATCH }, criarMemoria(() => disco));
    expect(nomes()).toEqual(["match_started", "first_match_started", "match_started", "match_started"]);
  });

  it("duas chamadas coladas (StrictMode, clique duplo) não repetem first_match_started", () => {
    const mem = criarMemoria(armazenamento);
    anunciarInicioDePartida({ modo: "local", humanos: 1, bots: 3 }, mem);
    anunciarInicioDePartida({ modo: "local", humanos: 1, bots: 3 }, mem);
    expect(nomes().filter((n) => n === "first_match_started")).toHaveLength(1);
  });

  it("online: a MESMA partida (reload no meio) não conta de novo", () => {
    const disco = armazenamento();
    anunciarInicioDePartida({ modo: "online", humanos: 2, bots: 2, partidaId: MATCH }, criarMemoria(() => disco));
    anunciarInicioDePartida({ modo: "online", humanos: 2, bots: 2, partidaId: MATCH }, criarMemoria(() => disco));
    expect(nomes().filter((n) => n === "match_started")).toHaveLength(1);
    anunciarInicioDePartida({ modo: "online", humanos: 2, bots: 2, partidaId: "outra-partida" }, criarMemoria(() => disco));
    expect(nomes().filter((n) => n === "match_started")).toHaveLength(2);
  });

  it("sem armazenamento, first_match_started ainda sai só uma vez por página", () => {
    const mem = criarMemoria(() => null);
    anunciarInicioDePartida({ modo: "local", humanos: 1, bots: 3 }, mem);
    anunciarInicioDePartida({ modo: "local", humanos: 1, bots: 3 }, mem);
    expect(nomes()).toEqual(["match_started", "first_match_started", "match_started"]);
  });

  it("armazenamento que LANÇA não derruba a partida", () => {
    const mem = criarMemoria(() => ({ getItem() { throw new Error("quota"); }, setItem() { throw new Error("quota"); } }));
    expect(() => anunciarInicioDePartida({ modo: "local", humanos: 1, bots: 3 }, mem)).not.toThrow();
    expect(nomes()).toContain("match_started");
  });
});

describe("match_finished", () => {
  it("local: modo, posição e empate", () => {
    anunciarFimDePartida({ modo: "local", posicao: 3, empate: false }, criarMemoria(armazenamento));
    expect(e.recebidos).toEqual([{ evento: "match_finished", payload: { modo: "local", posicao: 3, empate: false } }]);
  });

  it("online: reload no Placar Final não repete o fim", () => {
    const disco = armazenamento();
    anunciarFimDePartida({ modo: "online", posicao: 1, empate: true, partidaId: MATCH }, criarMemoria(() => disco));
    anunciarFimDePartida({ modo: "online", posicao: 1, empate: true, partidaId: MATCH }, criarMemoria(() => disco));
    expect(e.recebidos).toEqual([{ evento: "match_finished", payload: { modo: "online", posicao: 1, empate: true } }]);
  });

  it("sem posição conhecida, o evento sai sem ela — nunca com uma inventada", () => {
    anunciarFimDePartida({ modo: "local", empate: false }, criarMemoria(armazenamento));
    expect(e.recebidos[0].payload).toEqual({ modo: "local", empate: false });
  });
});

describe("o id da partida NUNCA sai", () => {
  it("nem no começo, nem no fim — fica só na memória do aparelho", () => {
    const disco = armazenamento();
    anunciarInicioDePartida({ modo: "online", humanos: 2, bots: 2, partidaId: MATCH }, criarMemoria(() => disco));
    anunciarFimDePartida({ modo: "online", posicao: 2, empate: false, partidaId: MATCH }, criarMemoria(() => disco));
    expect(JSON.stringify(e.recebidos)).not.toContain(MATCH);
    expect(disco.dados.get(CHAVE_DA_MEMORIA)).toContain(MATCH);
  });

  it("a memória lembra no máximo 20 partidas por lista", () => {
    const disco = armazenamento();
    const mem = criarMemoria(() => disco);
    for (let i = 0; i < 30; i++) mem.marcarPartida("inicios", `p-${i}`);
    expect(mem.ler().inicios).toHaveLength(20);
    expect(mem.ler().inicios?.[0]).toBe("p-10");
  });
});

describe("contarAssentos", () => {
  it("humanos sentados e bots; assento vazio não conta", () => {
    expect(contarAssentos([
      { playerId: "a", bot: false }, { playerId: "b", bot: false }, { playerId: "", bot: true }, { playerId: "", bot: false },
    ])).toEqual({ humanos: 2, bots: 1 });
    expect(contarAssentos(undefined)).toEqual({ humanos: 0, bots: 0 });
  });
});

describe("silêncio por padrão", () => {
  it("com o adaptador silencioso, anunciar não faz nada visível e não lança", () => {
    analytics.usar(adaptadorSilencioso);
    expect(() => anunciarInicioDePartida({ modo: "local", humanos: 1, bots: 3 }, criarMemoria(armazenamento))).not.toThrow();
  });
});
