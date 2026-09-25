// O RESULTADO QUE VAI AO BANCO — participação, elenco e o que nunca vai.
import { describe, expect, it } from "vitest";
import { participou, resultadoParaCredito, type AssentoAoFim, type PartidaEncerrada } from "./resultado.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PARTIDA = "33333333-3333-4333-8333-333333333333";

function assento(seat: number, extra: Partial<AssentoAoFim> = {}): AssentoAoFim {
  return {
    seat, playerId: `bot:${seat}`, bot: true, permanente: false, conectado: true,
    jogadasTotais: 30, jogadasProprias: 0, ...extra,
  };
}
const humano = (seat: number, playerId: string, extra: Partial<AssentoAoFim> = {}) =>
  assento(seat, { playerId, bot: false, permanente: true, jogadasProprias: 30, ...extra });

function partida(assentos: AssentoAoFim[]): PartidaEncerrada {
  return {
    partidaId: PARTIDA,
    iniciadaEm: new Date("2026-09-24T12:00:00Z"),
    terminadaEm: new Date("2026-09-24T12:12:00Z"),
    assentos,
    posicoes: { 0: 1, 1: 2, 2: 3, 3: 4 },
  };
}

describe("participação: ≥ 60% das PRÓPRIAS cartas, e conectado no fim", () => {
  it.each([
    [59, 100, false],
    [60, 100, true],
    [61, 100, true],
    [100, 100, true],
  ])("%i de %i cartas próprias → participou = %s", (proprias, totais, esperado) => {
    expect(participou(humano(0, A, { jogadasProprias: proprias, jogadasTotais: totais }))).toBe(esperado);
  });

  it("a borda é exata: 3 de 5 é 60% e passa, 17 de 29 (58,6%) não", () => {
    expect(participou(humano(0, A, { jogadasProprias: 3, jogadasTotais: 5 }))).toBe(true);
    expect(participou(humano(0, A, { jogadasProprias: 17, jogadasTotais: 29 }))).toBe(false);
  });

  it("100% das cartas, mas DESCONECTADO no fim → não participou", () => {
    expect(participou(humano(0, A, { conectado: false }))).toBe(false);
  });

  it("nenhuma carta contada não é participação", () => {
    expect(participou(humano(0, A, { jogadasTotais: 0, jogadasProprias: 0 }))).toBe(false);
  });
});

describe("o resultado do crédito", () => {
  it("leva só humanos, com posição do motor — bots ficam de fora e só são contados", () => {
    const r = resultadoParaCredito(partida([humano(0, A), assento(1), humano(2, B), assento(3)]))!;
    expect(r.bots).toBe(2);
    expect(r.humanos).toEqual([
      { playerId: A, posicao: 1, participou: true },
      { playerId: B, posicao: 3, participou: true },
    ]);
    expect(JSON.stringify(r)).not.toContain("bot:");
  });

  it("NÃO carrega XP em lugar nenhum — o banco é que calcula", () => {
    const r = resultadoParaCredito(partida([humano(0, A), assento(1), humano(2, B), assento(3)]))!;
    expect(Object.keys(r).sort()).toEqual(["bots", "humanos", "iniciadaEm", "partidaId", "terminadaEm"]);
    for (const h of r.humanos) expect(Object.keys(h).sort()).toEqual(["participou", "playerId", "posicao"]);
    expect(JSON.stringify(r)).not.toMatch(/xp/i);
  });

  it("identidade SORTEADA (legacy) → nada a gravar", () => {
    expect(resultadoParaCredito(partida([humano(0, A), assento(1), humano(2, B, { permanente: false }), assento(3)]))).toBeNull();
  });

  it("abaixo de 60% vai ao banco como participou=false — o banco lança zero, não o jogo", () => {
    const r = resultadoParaCredito(partida([humano(0, A, { jogadasProprias: 17, jogadasTotais: 29 }), assento(1), humano(2, B), assento(3)]))!;
    expect(r.humanos.find((h) => h.playerId === A)?.participou).toBe(false);
  });

  it("empate usa a posição dividida que o motor atribuiu", () => {
    const p = partida([humano(0, A), assento(1), humano(2, B), assento(3)]);
    p.posicoes = { 0: 1, 1: 3, 2: 1, 3: 4 };
    const r = resultadoParaCredito(p)!;
    expect(r.humanos.map((h) => h.posicao)).toEqual([1, 1]);
  });
});
