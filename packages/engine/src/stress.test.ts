// Fase 3 — simulação em massa. Roda milhares de partidas legais-aleatórias procurando
// estados inválidos, deadlocks, checksums errados, mãos incompletas e pontuação impossível.
import { describe, it, expect } from "vitest";
import { createRng } from "./cards.js";
import { HAND_CONTRACTS } from "./contracts.js";
import { createMatch } from "./match.js";
import { simulateMatch } from "./sim.js";

const PLAYERS = ["P0", "P1", "P2", "P3"];
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const MATCHES = 2000;

describe("estresse — milhares de partidas mantêm todas as invariantes", () => {
  it(`${MATCHES} partidas: checksums, King único, rotação e sinais corretos`, () => {
    for (let seed = 1; seed <= MATCHES; seed++) {
      const m = createMatch(PLAYERS, seed);
      // Não deve lançar nenhuma exceção ao longo da partida completa.
      simulateMatch(m, createRng(seed * 2654435761));

      // Partida completa e checksum final zero.
      expect(m.finished).toBe(true);
      expect(sum(m.cumulative)).toBe(0);
      expect(sum(m.negatives)).toBe(-1300);
      expect(sum(m.positives)).toBe(1300);
      expect(m.history).toHaveLength(10);

      let kingHits = 0;
      const choosers: (number | null)[] = [];
      for (const e of m.history) {
        const def = HAND_CONTRACTS[e.handNumber];
        // Cada mão distribui exatamente o total do seu contrato.
        expect(sum(e.handScores)).toBe(def.handTotal);
        if (def.isPositive) {
          // Positiva: ninguém perde pontos; alguém escolheu o trunfo.
          expect(e.handScores.every((s) => s >= 0)).toBe(true);
          choosers.push(e.chooser);
        } else {
          // Negativa: ninguém ganha pontos.
          expect(e.handScores.every((s) => s <= 0)).toBe(true);
        }
        if (e.handNumber === 5) {
          kingHits += e.handScores.filter((s) => s === -160).length;
        }
      }
      // King aplicado exatamente uma vez na partida.
      expect(kingHits).toBe(1);
      // Cada um dos 4 jogadores escolheu o trunfo exatamente uma vez.
      expect([...choosers].sort()).toEqual([0, 1, 2, 3]);
    }
  });
});
