import { describe, it, expect } from "vitest";
import { createRng, cardId } from "./cards.js";
import {
  HAND_CONTRACTS,
  NEGATIVE_CHECKSUM,
  POSITIVE_CHECKSUM,
  FINAL_CHECKSUM,
} from "./contracts.js";
import {
  createMatch,
  startNextHand,
  playCard,
  legalCardsFor,
  rankings,
  type MatchState,
} from "./match.js";
import { simulateHand, simulateMatch } from "./sim.js";

const PLAYERS = ["P0", "P1", "P2", "P3"];
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function playedMatch(seed: number): MatchState {
  const m = createMatch(PLAYERS, seed);
  simulateMatch(m, createRng(seed * 7 + 1));
  return m;
}

describe("distribuição e estado inicial da mão", () => {
  it("distribui 4×13 = 52 cartas únicas e prepara 13 vazas", () => {
    const m = createMatch(PLAYERS, 123);
    startNextHand(m);
    const h = m.hand!;
    expect(h.hands.map((x) => x.length)).toEqual([13, 13, 13, 13]);
    const all = h.hands.flat().map(cardId);
    expect(new Set(all).size).toBe(52);
    expect(h.trickNumber).toBe(1);
    expect(h.completedTricks).toHaveLength(0);
  });

  it("exige exatamente 4 jogadores", () => {
    expect(() => createMatch(["A", "B", "C"], 1)).toThrow();
  });
});

describe("invariantes da partida completa (checksums)", () => {
  it("soma final dos 4 jogadores = 0 em muitas sementes", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const m = playedMatch(seed);
      expect(m.finished).toBe(true);
      expect(sum(m.cumulative)).toBe(FINAL_CHECKSUM);
    }
  });

  it("negativas somam −1300 e positivas somam +1300", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const m = playedMatch(seed);
      expect(sum(m.negatives)).toBe(NEGATIVE_CHECKSUM);
      expect(sum(m.positives)).toBe(POSITIVE_CHECKSUM);
    }
  });

  it("cada mão distribui exatamente o total do seu contrato", () => {
    const m = playedMatch(42);
    expect(m.history).toHaveLength(10);
    for (const entry of m.history) {
      expect(sum(entry.handScores)).toBe(HAND_CONTRACTS[entry.handNumber].handTotal);
    }
  });

  it("mão 5 aplica o King exatamente uma vez (−160 a um só jogador)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = playedMatch(seed);
      const h5 = m.history.find((h) => h.handNumber === 5)!;
      expect(h5.handScores.filter((x) => x === -160)).toHaveLength(1);
      expect(h5.handScores.filter((x) => x === 0)).toHaveLength(3);
    }
  });

  it("mão 5 encerra assim que o K♥ é capturado (não joga as 13 vazas)", () => {
    let terminouAntes = false;
    for (let seed = 1; seed <= 40; seed++) {
      const m = createMatch(PLAYERS, seed);
      for (let hn = 1; hn <= 5; hn++) {
        startNextHand(m);
        simulateHand(m, createRng(hn * 13 + seed));
      }
      const h = m.hand!;
      expect(h.handScores).not.toBeNull(); // mão 5 encerrada
      const last = h.completedTricks[h.completedTricks.length - 1];
      // a última vaza da mão 5 sempre contém o K♥ (foi o que encerrou)
      expect(last.cards.some((p) => p.card.rank === "K" && p.card.suit === "hearts")).toBe(true);
      // não há vaza após a captura do King
      expect(h.completedTricks.every((t, i) => i === h.completedTricks.length - 1 || !t.cards.some((p) => p.card.rank === "K" && p.card.suit === "hearts"))).toBe(true);
      if (h.completedTricks.length < 13) terminouAntes = true;
    }
    expect(terminouAntes).toBe(true); // ao menos uma partida terminou antes da 13ª vaza
  });

  it("mãos 3 e 4 também encerram cedo quando todas as penalizadas caem (sem perder pontos)", () => {
    let e3 = false, e4 = false;
    for (let seed = 1; seed <= 200 && !(e3 && e4); seed++) {
      const m = createMatch(PLAYERS, seed);
      for (let hn = 1; hn <= 4; hn++) {
        startNextHand(m);
        simulateHand(m, createRng(hn * 29 + seed));
        const h = m.hand!;
        // o total distribuído sempre bate — nada é perdido no encerramento antecipado
        expect(sum(h.handScores!)).toBe(HAND_CONTRACTS[hn].handTotal);
        if (hn === 3 && h.completedTricks.length < 13) e3 = true;
        if (hn === 4 && h.completedTricks.length < 13) e4 = true;
      }
    }
    expect(e3).toBe(true);
    expect(e4).toBe(true);
  });

  it("cada positiva soma +325", () => {
    const m = playedMatch(9);
    for (const hn of [7, 8, 9, 10]) {
      const e = m.history.find((h) => h.handNumber === hn)!;
      expect(sum(e.handScores)).toBe(325);
    }
  });

  it("rotação das positivas: cada jogador escolhe o trunfo exatamente uma vez", () => {
    const m = playedMatch(5);
    const choosers = [7, 8, 9, 10].map((hn) => m.history.find((h) => h.handNumber === hn)!.chooser);
    expect(choosers).toEqual([0, 1, 2, 3]);
    expect(new Set(choosers).size).toBe(4);
  });
});

describe("autoridade e determinismo", () => {
  it("mesma semente => mesmo resultado final", () => {
    const a = playedMatch(77).cumulative;
    const b = playedMatch(77).cumulative;
    expect(a).toEqual(b);
  });

  it("rejeita jogada fora de turno", () => {
    const m = createMatch(PLAYERS, 3);
    startNextHand(m);
    const turn = m.hand!.turn!;
    const wrong = ((turn + 1) % 4) as 0 | 1 | 2 | 3;
    const anyCard = m.hand!.hands[wrong][0];
    expect(() => playCard(m, wrong, anyCard)).toThrow();
  });

  it("mão positiva bloqueia jogadas até o trunfo ser escolhido", () => {
    const m = createMatch(PLAYERS, 11);
    for (let hn = 1; hn <= 6; hn++) {
      startNextHand(m);
      simulateHand(m, createRng(hn * 13 + 1));
    }
    startNextHand(m); // mão 7 (positiva)
    expect(m.hand!.awaitingTrumpFrom).toBe(0);
    expect(m.hand!.turn).toBeNull();
    expect(legalCardsFor(m, 0)).toHaveLength(0);
    const someCard = m.hand!.hands[0][0];
    expect(() => playCard(m, 0, someCard)).toThrow();
  });
});

describe("ranking", () => {
  it("empate na pontuação recebe a mesma posição (sem inventar desempate)", () => {
    const m = createMatch(PLAYERS, 1);
    m.cumulative = [10, 10, 5, 0];
    const rows = rankings(m);
    const byScore = (v: number) => rows.find((r) => r.score === v)!;
    expect(byScore(10).position).toBe(1);
    expect(byScore(10).tied).toBe(true);
    expect(byScore(5).position).toBe(3);
    expect(byScore(0).position).toBe(4);
  });
});
