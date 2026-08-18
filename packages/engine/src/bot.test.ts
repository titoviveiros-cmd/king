import { describe, it, expect } from "vitest";
import { createMatch, startNextHand, legalCardsFor, playCard, chooseBotCard, chooseBotTrump, cardId } from "./index.js";
import type { Seat } from "./contracts.js";

const P = ["A", "B", "C", "D"];

describe("chooseBotCard / chooseBotTrump", () => {
  it("o bot sempre devolve uma carta que está no conjunto LEGAL do motor", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = createMatch(P, seed);
      startNextHand(m);
      // joga a mão 1 inteira só com bots, checando legalidade a cada jogada
      let guard = 0;
      while (m.hand && m.hand.handScores === null) {
        const seat = m.hand.turn as Seat;
        const legal = legalCardsFor(m, seat).map(cardId);
        const card = chooseBotCard(m, seat);
        expect(legal).toContain(cardId(card));
        playCard(m, seat, card);
        if (++guard > 60) throw new Error("loop");
      }
    }
  });

  it("chooseBotTrump devolve um naipe válido nas positivas", () => {
    const m = createMatch(P, 9);
    // avança até uma positiva (mão 7)
    for (let hn = 1; hn <= 7; hn++) {
      startNextHand(m);
      if (hn < 7) {
        // encerra a mão negativa jogando só com bots
        while (m.hand && m.hand.handScores === null) {
          const seat = m.hand.turn as Seat;
          playCard(m, seat, chooseBotCard(m, seat));
        }
      }
    }
    expect(m.hand!.awaitingTrumpFrom).not.toBeNull();
    const seat = m.hand!.awaitingTrumpFrom as Seat;
    const t = chooseBotTrump(m, seat);
    expect(["spades", "hearts", "diamonds", "clubs", "no-trump"]).toContain(t);
  });
});
