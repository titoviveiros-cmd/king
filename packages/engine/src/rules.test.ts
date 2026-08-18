import { describe, it, expect } from "vitest";
import type { Card, Rank, Suit } from "./cards.js";
import { cardId, KING_OF_HEARTS } from "./cards.js";
import { HAND_CONTRACTS, type PlayedCard, type Seat } from "./contracts.js";
import { getLegalCards, resolveTrick } from "./rules.js";

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });
const ids = (cards: Card[]) => cards.map(cardId).sort();
const pc = (seat: Seat, card: Card): PlayedCard => ({ seat, card });

const NO_TRICKS = HAND_CONTRACTS[1];
const NO_HEARTS = HAND_CONTRACTS[2];
const NO_KING = HAND_CONTRACTS[5];
const POSITIVE = HAND_CONTRACTS[7];

describe("getLegalCards — servir e baldar", () => {
  it("obriga a servir o naipe puxado quando o jogador o possui", () => {
    const hand = [c("A", "spades"), c("3", "spades"), c("K", "hearts")];
    const trick = [pc(0, c("5", "spades"))];
    const legal = getLegalCards(hand, trick, NO_TRICKS);
    expect(ids(legal)).toEqual(ids([c("A", "spades"), c("3", "spades")]));
  });

  it("permite baldar qualquer carta quando não tem o naipe puxado", () => {
    const hand = [c("A", "diamonds"), c("2", "clubs")];
    const trick = [pc(0, c("5", "spades"))];
    const legal = getLegalCards(hand, trick, NO_TRICKS);
    expect(ids(legal)).toEqual(ids(hand));
  });
});

describe("getLegalCards — não abrir Copas (mãos 2 e 5)", () => {
  it("remove Copas da abertura quando há carta de outro naipe", () => {
    const hand = [c("A", "hearts"), c("3", "spades")];
    const legal = getLegalCards(hand, [], NO_HEARTS);
    expect(ids(legal)).toEqual(ids([c("3", "spades")]));
  });

  it("permite abrir com Copas quando só há Copas na mão", () => {
    const hand = [c("A", "hearts"), c("3", "hearts")];
    const legal = getLegalCards(hand, [], NO_HEARTS);
    expect(ids(legal)).toEqual(ids(hand));
  });

  it("mão 1 (sem restrição) permite abrir com Copas normalmente", () => {
    const hand = [c("A", "hearts"), c("3", "spades")];
    const legal = getLegalCards(hand, [], NO_TRICKS);
    expect(ids(legal)).toEqual(ids(hand));
  });
});

describe("getLegalCards — regra do Rei de Copas (mão 5)", () => {
  it("FORÇA jogar o K♥ quando Copas é puxada e o jogador o tem", () => {
    const hand = [KING_OF_HEARTS, c("2", "hearts"), c("9", "hearts")];
    const trick = [pc(0, c("4", "hearts"))];
    const legal = getLegalCards(hand, trick, NO_KING);
    expect(ids(legal)).toEqual(ids([KING_OF_HEARTS]));
  });

  it("FORÇA descartar o K♥ na primeira vez em que não pode servir", () => {
    const hand = [KING_OF_HEARTS, c("2", "hearts"), c("9", "diamonds")];
    const trick = [pc(0, c("4", "spades"))]; // jogador não tem espadas
    const legal = getLegalCards(hand, trick, NO_KING);
    expect(ids(legal)).toEqual(ids([KING_OF_HEARTS]));
  });

  it("sem o K♥, segue o naipe normalmente", () => {
    const hand = [c("2", "hearts"), c("9", "hearts")];
    const trick = [pc(0, c("4", "hearts"))];
    const legal = getLegalCards(hand, trick, NO_KING);
    expect(ids(legal)).toEqual(ids(hand));
  });

  it("Copas não puxada e servindo outro naipe: o K♥ não é forçado", () => {
    const hand = [KING_OF_HEARTS, c("5", "spades")];
    const trick = [pc(0, c("4", "spades"))];
    const legal = getLegalCards(hand, trick, NO_KING);
    expect(ids(legal)).toEqual(ids([c("5", "spades")]));
  });
});

describe("resolveTrick — sem trunfo", () => {
  it("vence a maior carta do naipe puxado; baldas não vencem", () => {
    const trick = [
      pc(0, c("5", "spades")),
      pc(1, c("K", "spades")),
      pc(2, c("A", "hearts")), // balda alta, mas não vence
      pc(3, c("2", "spades")),
    ];
    expect(resolveTrick(trick, null)).toBe(1);
  });

  it('"Sem Trunfo" comporta-se como o naipe puxado mais alto', () => {
    const trick = [pc(0, c("9", "clubs")), pc(1, c("J", "clubs")), pc(2, c("A", "diamonds")), pc(3, c("3", "clubs"))];
    expect(resolveTrick(trick, "no-trump")).toBe(1);
  });
});

describe("resolveTrick — com trunfo", () => {
  it("um trunfo vence uma carta mais alta do naipe puxado", () => {
    const trick = [pc(0, c("A", "spades")), pc(1, c("2", "clubs")), pc(2, c("3", "spades")), pc(3, c("4", "spades"))];
    expect(resolveTrick(trick, "clubs")).toBe(1); // 2♣ trunfo vence o A♠
  });

  it("entre vários trunfos, vence o mais alto", () => {
    const trick = [pc(0, c("A", "spades")), pc(1, c("2", "clubs")), pc(2, c("K", "clubs")), pc(3, c("5", "clubs"))];
    expect(resolveTrick(trick, "clubs")).toBe(2);
  });
});
