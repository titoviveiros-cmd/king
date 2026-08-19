import { describe, it, expect } from "vitest";
import { createRng } from "./cards.js";
import { createMatch, startNextHand, rankings, type MatchState } from "./match.js";
import { simulateHand, simulateMatch } from "./sim.js";
import { matchStats } from "./stats.js";

const PLAYERS = ["P0", "P1", "P2", "P3"];

function playedMatch(seed: number): MatchState {
  const m = createMatch(PLAYERS, seed);
  simulateMatch(m, createRng(seed * 7 + 1));
  return m;
}

describe("matchStats — destaques da partida", () => {
  it("partida sem mãos jogadas não inventa destaque", () => {
    const s = matchStats(createMatch(PLAYERS, 1));
    expect(s.biggestHand).toBeNull();
    expect(s.kingTaker).toBeNull();
    expect(s.margin).toBe(0);
    for (const row of s.perSeat) {
      expect(row.bestHand).toBeNull();
      expect(row.negativeHands).toBe(0);
    }
  });

  it("melhor/pior mão de cada assento saem do histórico real", () => {
    const m = playedMatch(31);
    const s = matchStats(m);
    for (const row of s.perSeat) {
      const scores = m.history.map((h) => h.handScores[row.seat]);
      expect(row.bestHand!.score).toBe(Math.max(...scores));
      expect(row.worstHand!.score).toBe(Math.min(...scores));
      const h = m.history.find((x) => x.handNumber === row.bestHand!.handNumber)!;
      expect(h.handScores[row.seat]).toBe(row.bestHand!.score);
    }
  });

  it("conta as negativas ilesas dentro do total de negativas jogadas", () => {
    const m = playedMatch(77);
    const s = matchStats(m);
    for (const row of s.perSeat) {
      expect(row.negativeHands).toBe(6);
      expect(row.cleanNegatives).toBeGreaterThanOrEqual(0);
      expect(row.cleanNegatives).toBeLessThanOrEqual(6);
      const zeradas = m.history.filter((h) => h.handNumber <= 6 && h.handScores[row.seat] === 0).length;
      expect(row.cleanNegatives).toBe(zeradas);
    }
  });

  it("o Rei de Copas tem exatamente um dono e ele perdeu 160", () => {
    const m = playedMatch(2024);
    const s = matchStats(m);
    const mao5 = m.history.find((h) => h.kind === "no-king")!;
    expect(s.kingTaker).not.toBeNull();
    expect(mao5.handScores[s.kingTaker!]).toBe(-160);
    expect(mao5.handScores.filter((x) => x !== 0)).toHaveLength(1);
  });

  it("vazas positivas derivam do total positivo (25 por vaza) e somam 52", () => {
    const m = playedMatch(9);
    const s = matchStats(m);
    const total = s.perSeat.reduce((a, r) => a + r.positiveTricks, 0);
    expect(total).toBe(52); // 4 mãos positivas × 13 vazas
  });

  it("a margem é a distância do 1º para o próximo score diferente", () => {
    const m = playedMatch(5);
    const s = matchStats(m);
    const rows = rankings(m);
    const abaixo = rows.find((r) => r.score < rows[0].score);
    expect(s.margin).toBe(abaixo ? rows[0].score - abaixo.score : 0);
    expect(s.margin).toBeGreaterThanOrEqual(0);
  });

  it("empate na liderança mede até o primeiro score diferente", () => {
    const m = playedMatch(3);
    m.cumulative = [120, 120, -100, -140];
    expect(matchStats(m).margin).toBe(220);
  });

  it("quatro empatados zeram a margem (não há score abaixo da liderança)", () => {
    const m = playedMatch(3);
    m.cumulative = [0, 0, 0, 0];
    expect(matchStats(m).margin).toBe(0);
  });

  it("a maior mão da partida existe no histórico daquele assento", () => {
    const m = createMatch(PLAYERS, 13);
    for (let hn = 1; hn <= 8; hn++) {
      startNextHand(m);
      simulateHand(m, createRng(hn * 41 + 7));
    }
    const s = matchStats(m);
    const h = m.history.find((x) => x.handNumber === s.biggestHand!.handNumber)!;
    expect(h.handScores[s.biggestHand!.seat]).toBe(s.biggestHand!.score);
    const todos = m.history.flatMap((x) => x.handScores);
    expect(s.biggestHand!.score).toBe(Math.max(...todos));
  });
});
