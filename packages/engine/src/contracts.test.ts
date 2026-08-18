import { describe, it, expect } from "vitest";
import type { Card, Rank, Suit } from "./cards.js";
import { KING_OF_HEARTS } from "./cards.js";
import {
  scoreHand,
  trumpChooserFor,
  type CompletedTrick,
  type Seat,
} from "./contracts.js";

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });
const trick = (number: number, winner: Seat, cards: Card[]): CompletedTrick => ({
  number,
  leader: 0,
  winner,
  cards: cards.map((card, i) => ({ seat: i as Seat, card })),
});
const filler = (): Card[] => [c("2", "clubs"), c("3", "clubs"), c("4", "clubs"), c("5", "clubs")];

describe("scoreHand — contratos negativos", () => {
  it("no-tricks: −20 por vaza ao vencedor", () => {
    const s = scoreHand("no-tricks", [trick(1, 0, filler()), trick(2, 0, filler()), trick(3, 1, filler())]);
    expect(s).toEqual([-40, -20, 0, 0]);
  });

  it("no-hearts: −20 por carta de Copas capturada", () => {
    const t = trick(1, 0, [c("A", "hearts"), c("2", "hearts"), c("3", "spades"), c("4", "spades")]);
    expect(scoreHand("no-hearts", [t])).toEqual([-40, 0, 0, 0]);
  });

  it("no-queens: −50 por Dama", () => {
    const t = trick(1, 2, [c("Q", "spades"), c("2", "clubs"), c("3", "clubs"), c("4", "clubs")]);
    expect(scoreHand("no-queens", [t])).toEqual([0, 0, -50, 0]);
  });

  it("no-men: −30 por Rei ou Valete", () => {
    const t = trick(1, 3, [c("K", "spades"), c("J", "clubs"), c("3", "clubs"), c("4", "clubs")]);
    expect(scoreHand("no-men", [t])).toEqual([0, 0, 0, -60]);
  });

  it("no-king: −160 só na vaza que contém o K♥", () => {
    const t1 = trick(1, 1, [KING_OF_HEARTS, c("2", "hearts"), c("3", "spades"), c("4", "spades")]);
    const t2 = trick(2, 0, filler());
    expect(scoreHand("no-king", [t1, t2])).toEqual([0, -160, 0, 0]);
  });

  it("no-last-two: −90 só nas vazas 12 e 13", () => {
    const s = scoreHand("no-last-two", [trick(11, 2, filler()), trick(12, 0, filler()), trick(13, 1, filler())]);
    expect(s).toEqual([-90, -90, 0, 0]);
  });
});

describe("scoreHand — positiva", () => {
  it("+25 por vaza ao vencedor", () => {
    const s = scoreHand("positive", [trick(1, 0, filler()), trick(2, 0, filler()), trick(3, 3, filler())]);
    expect(s).toEqual([50, 0, 0, 25]);
  });
});

describe("trumpChooserFor — rotação das positivas", () => {
  it("M7→P0, M8→P1, M9→P2, M10→P3", () => {
    expect([7, 8, 9, 10].map(trumpChooserFor)).toEqual([0, 1, 2, 3]);
  });
});
