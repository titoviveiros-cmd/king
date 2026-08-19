import { describe, it, expect } from "vitest";
import type { RankRow } from "@king/engine";
import { createMatch, createRng, rankings, startNextHand, handSummary } from "@king/engine";
import { simulateHand } from "@king/engine";
import { interpolar, saldosAntes, scoresPorAssento } from "./placarFinalDados.js";

/** Linhas na ORDEM DO RANKING, com assentos deliberadamente fora de ordem — o caso do bug. */
const RANKING: RankRow[] = [
  { seat: 0, player: "Você", score: 400, negatives: -200, positives: 600, position: 1, tied: false },
  { seat: 2, player: "Léo", score: -10, negatives: -310, positives: 300, position: 2, tied: false },
  { seat: 1, player: "Bia", score: -125, negatives: -400, positives: 275, position: 3, tied: false },
  { seat: 3, player: "Nara", score: -265, negatives: -390, positives: 125, position: 4, tied: false },
];

describe("dados do Placar Final — sempre por assento", () => {
  it("scoresPorAssento não confunde posição no ranking com assento", () => {
    // regressão: `finais.map(r => r.score)` daria [400, -10, -125, -265] (por POSIÇÃO),
    // exibindo o número do Léo no lugar do da Bia.
    expect(scoresPorAssento(RANKING)).toEqual([400, -125, -10, -265]);
  });

  it("cada assento recebe o próprio saldo, não o do vizinho de posição", () => {
    const v = scoresPorAssento(RANKING);
    for (const r of RANKING) expect(v[r.seat]).toBe(r.score);
  });

  it("saldosAntes desconta o delta da última mão do assento certo", () => {
    const deltas = [100, 75, 50, 100]; // por assento
    const antes = saldosAntes(RANKING, deltas);
    expect(antes).toEqual([300, -200, -60, -365]);
    for (const r of RANKING) expect(antes[r.seat] + deltas[r.seat]).toBe(r.score);
  });

  it("sem deltas, o ponto de partida é o próprio saldo final", () => {
    expect(saldosAntes(RANKING)).toEqual(scoresPorAssento(RANKING));
  });

  it("a interpolação sai do saldo anterior e chega exatamente no final", () => {
    const deltas = [100, 75, 50, 100];
    const de = saldosAntes(RANKING, deltas);
    const ate = scoresPorAssento(RANKING);
    expect(interpolar(de, ate, 0)).toEqual(de);
    expect(interpolar(de, ate, 1)).toEqual(ate);
    const meio = interpolar(de, ate, 0.5);
    for (let s = 0; s < 4; s++) {
      expect(meio[s]).toBeGreaterThanOrEqual(Math.min(de[s], ate[s]));
      expect(meio[s]).toBeLessThanOrEqual(Math.max(de[s], ate[s]));
    }
  });

  it("numa partida real do motor, o total exibido bate com o cumulative de cada assento", () => {
    const m = createMatch(["Você", "Bia", "Léo", "Nara"], 4);
    for (let hn = 1; hn <= 10; hn++) {
      startNextHand(m);
      simulateHand(m, createRng(hn * 31 + 5));
    }
    const finais = rankings(m);
    const resumo = handSummary(m)!;
    const ate = scoresPorAssento(finais);
    const de = saldosAntes(finais, resumo.scores);

    expect(ate).toEqual(m.cumulative);
    for (let s = 0; s < 4; s++) expect(de[s] + resumo.scores[s]).toBe(m.cumulative[s]);
    expect(ate.reduce((a, b) => a + b, 0)).toBe(0); // checksum final
  });
});
