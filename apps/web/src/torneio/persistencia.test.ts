/**
 * PERSISTÊNCIA — retomada íntegra, reinício sem resultado duplicado, e dado ruim descartado.
 */
import { describe, it, expect } from "vitest";
import { jogarMesaDeBots } from "./simulacao.js";
import {
  avancarFase, criarTorneio, nomesDaMesa, registrarResultado, situacao, mesasDaFase, campeao, type Torneio,
} from "./orquestrador.js";
import {
  apagarTorneio, CHAVE_DO_TORNEIO, gravarTorneio, haTorneioParaContinuar, lerTorneio, paraSalvar, restaurar,
  type Armazenamento,
} from "./persistencia.js";

function memoria(): Armazenamento & { dados: Map<string, string> } {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => { dados.set(k, v); },
    removeItem: (k) => { dados.delete(k); },
  };
}

/** Avança até o humano precisar jogar (bots simulados, fases montadas). */
function ateAVezDoHumano(t0: Torneio): Torneio {
  let t = t0;
  for (;;) {
    const s = situacao(t);
    if (s.tipo === "simular") for (const m of s.mesas) t = registrarResultado(t, m.id, jogarMesaDeBots(nomesDaMesa(t, m), m.semente));
    else if (s.tipo === "avancar") t = avancarFase(t);
    else return t;
  }
}

function jogarHumanoComoBot(t: Torneio): Torneio {
  const s = situacao(t);
  if (s.tipo !== "jogar") throw new Error("não é a vez do humano");
  return registrarResultado(t, s.mesa.id, jogarMesaDeBots(nomesDaMesa(t, s.mesa), s.mesa.semente));
}

describe("ida e volta", () => {
  it("o torneio restaurado é idêntico ao gravado — fase por fase", () => {
    let t = ateAVezDoHumano(criarTorneio("copa32", 314, "macaco"));
    for (let i = 0; i < 2 && situacao(t).tipo === "jogar"; i++) t = ateAVezDoHumano(jogarHumanoComoBot(t));
    const arm = memoria();
    expect(gravarTorneio(t, null, arm)).toBe(true);
    const l = lerTorneio(arm);
    expect(l.tipo).toBe("ok");
    if (l.tipo === "ok") {
      expect(JSON.stringify(l.restaurado.torneio)).toBe(JSON.stringify(t));
      expect(l.restaurado.partidaReiniciada).toBeNull();
    }
  });

  it("o save é pequeno e não carrega nada além do necessário", () => {
    let t = criarTorneio("copa32", 1, "leao");
    while (situacao(t).tipo !== "encerrado") {
      const s = situacao(t);
      if (s.tipo === "avancar") t = avancarFase(t);
      else if (s.tipo === "simular") for (const m of s.mesas) t = registrarResultado(t, m.id, jogarMesaDeBots(nomesDaMesa(t, m), m.semente));
      else t = jogarHumanoComoBot(t);
    }
    const json = JSON.stringify(paraSalvar(t, null));
    expect(json.length).toBeLessThan(4096);
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(
      ["avatar", "emPartida", "formato", "maoInicial", "qa", "resultados", "semente", "v"],
    );
    expect(json).not.toMatch(/Você|nome|conta|email|@/);
  });
});

describe("partida do humano em andamento", () => {
  it("reload no meio: a MESMA mesa volta a ser jogada do início, sem resultado e sem vitória falsa", () => {
    const t = ateAVezDoHumano(criarTorneio("mini16", 8, "leao"));
    const s = situacao(t);
    expect(s.tipo).toBe("jogar");
    if (s.tipo !== "jogar") return;
    const arm = memoria();
    gravarTorneio(t, s.mesa.id, arm);
    const l = lerTorneio(arm);
    expect(l.tipo).toBe("ok");
    if (l.tipo !== "ok") return;
    expect(l.restaurado.partidaReiniciada).toBe(s.mesa.id);
    const depois = situacao(l.restaurado.torneio);
    expect(depois).toMatchObject({ tipo: "jogar", mesa: { id: s.mesa.id, semente: s.mesa.semente, resultado: null } });
  });

  it("reinício não duplica: registrar, gravar e registrar de novo a mesma mesa conta uma vez", () => {
    let t = ateAVezDoHumano(criarTorneio("mini16", 9, "leao"));
    const s = situacao(t);
    if (s.tipo !== "jogar") throw new Error("esperava a vez do humano");
    t = jogarHumanoComoBot(t);
    const arm = memoria();
    gravarTorneio(t, s.mesa.id, arm); // o flag de "em partida" para uma mesa JÁ registrada é ignorado
    const l = lerTorneio(arm);
    expect(l.tipo).toBe("ok");
    if (l.tipo !== "ok") return;
    expect(l.restaurado.partidaReiniciada).toBeNull();
    const t2 = jogarHumanoComoBotSeDer(l.restaurado.torneio, s.mesa.id);
    expect(t2.mesas.filter((m) => m.id === s.mesa.id)).toHaveLength(1);
    expect(t2.mesas.find((m) => m.id === s.mesa.id)!.resultado).toEqual(t.mesas.find((m) => m.id === s.mesa.id)!.resultado);
  });
});

function jogarHumanoComoBotSeDer(t: Torneio, id: string): Torneio {
  const m = t.mesas.find((x) => x.id === id)!;
  return registrarResultado(t, id, jogarMesaDeBots(nomesDaMesa(t, m), m.semente + 1));
}

describe("dado corrompido ou adulterado é descartado inteiro", () => {
  const valido = () => {
    const t = ateAVezDoHumano(criarTorneio("mini16", 21, "leao"));
    return paraSalvar(t, null) as unknown as Record<string, unknown>;
  };
  const casos: Array<[string, (o: Record<string, unknown>) => unknown]> = [
    ["JSON quebrado", () => "{nao é json"],
    ["versão futura", (o) => ({ ...o, v: 2 })],
    ["formato desconhecido", (o) => ({ ...o, formato: "copa64" })],
    ["avatar fora da coleção", (o) => ({ ...o, avatar: "dragao" })],
    ["semente negativa", (o) => ({ ...o, semente: -1 })],
    ["resultado de mesa que não existe", (o) => ({ ...o, resultados: { ...(o.resultados as object), f2m0: { pontos: [0, 0, 0, 0], negativas: [-325, -325, -325, -325], ilesas: [0, 0, 0, 0] } } })],
    ["vitória fabricada (checksum quebrado)", (o) => {
      const r = structuredClone(o.resultados) as Record<string, { pontos: number[] }>;
      const k = Object.keys(r)[0];
      r[k].pontos[0] += 500;
      return { ...o, resultados: r };
    }],
    ["resultados não é objeto", (o) => ({ ...o, resultados: [1, 2] })],
    ["mesa em andamento inexistente", (o) => ({ ...o, emPartida: "f7m3" })],
    ["qa mentiroso", (o) => ({ ...o, maoInicial: 10, qa: false })],
  ];
  it.each(casos)("%s", (_nome, estragar) => {
    const arm = memoria();
    const bruto = estragar(valido());
    arm.setItem(CHAVE_DO_TORNEIO, typeof bruto === "string" ? bruto : JSON.stringify(bruto));
    expect(lerTorneio(arm).tipo).toBe("corrompido");
    expect(haTorneioParaContinuar(arm)).toBe(false);
  });

  it("restaurar(lixo) nunca lança", () => {
    for (const lixo of [null, undefined, 0, "x", [], {}, { v: 1 }, { v: 1, formato: "mini16", semente: 1 }]) {
      expect(() => restaurar(lixo)).not.toThrow();
      expect(restaurar(lixo)).toBeNull();
    }
  });
});

describe("armazenamento ausente ou hostil", () => {
  it("sem armazenamento: grava false, lê vazio, apagar não lança", () => {
    const t = criarTorneio("mini16", 1, "leao");
    expect(gravarTorneio(t, null, null)).toBe(false);
    expect(lerTorneio(null).tipo).toBe("vazio");
    expect(() => apagarTorneio(null)).not.toThrow();
  });

  it("armazenamento que LANÇA em tudo (cota, modo privado)", () => {
    const hostil: Armazenamento = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => { throw new Error("SecurityError"); },
    };
    expect(gravarTorneio(criarTorneio("mini16", 1, "leao"), null, hostil)).toBe(false);
    expect(lerTorneio(hostil).tipo).toBe("corrompido");
    expect(() => apagarTorneio(hostil)).not.toThrow();
    expect(haTorneioParaContinuar(hostil)).toBe(false);
  });
});

describe("continuar torneio", () => {
  it("é oferecido em andamento e some depois do campeão", () => {
    const arm = memoria();
    let t = criarTorneio("mini16", 3, "leao");
    gravarTorneio(t, null, arm);
    expect(haTorneioParaContinuar(arm)).toBe(true);
    while (campeao(t) === null) {
      const s = situacao(t);
      if (s.tipo === "avancar") t = avancarFase(t);
      else if (s.tipo === "simular") for (const m of s.mesas) t = registrarResultado(t, m.id, jogarMesaDeBots(nomesDaMesa(t, m), m.semente));
      else t = jogarHumanoComoBot(t);
    }
    gravarTorneio(t, null, arm);
    expect(lerTorneio(arm).tipo).toBe("ok");
    expect(haTorneioParaContinuar(arm)).toBe(false);
    apagarTorneio(arm);
    expect(lerTorneio(arm).tipo).toBe("vazio");
    expect(mesasDaFase(t, 2)).toHaveLength(1);
  });
});
