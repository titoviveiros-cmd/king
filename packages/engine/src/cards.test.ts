import { describe, it, expect } from "vitest";
import {
  makeDeck, shuffle, deal, createRng, cardId, SUITS, RANKS,
} from "./cards.js";

describe("makeDeck", () => {
  it("cria 52 cartas únicas", () => {
    const deck = makeDeck();
    expect(deck).toHaveLength(52);
    const ids = new Set(deck.map(cardId));
    expect(ids.size).toBe(52);
  });

  it("cobre todos os naipes e valores", () => {
    const deck = makeDeck();
    expect(deck).toHaveLength(SUITS.length * RANKS.length);
  });
});

describe("shuffle", () => {
  it("preserva todas as cartas e não muta a entrada", () => {
    const deck = makeDeck();
    const rng = createRng(42);
    const shuffled = shuffle(deck, rng);
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map(cardId)).size).toBe(52);
    // entrada intacta
    expect(deck[0]).toEqual({ suit: "spades", rank: "A" });
  });

  it("é determinístico para a mesma semente", () => {
    const deck = makeDeck();
    const a = shuffle(deck, createRng(7)).map(cardId);
    const b = shuffle(deck, createRng(7)).map(cardId);
    expect(a).toEqual(b);
  });

  it("difere entre sementes distintas", () => {
    const deck = makeDeck();
    const a = shuffle(deck, createRng(1)).map(cardId).join();
    const b = shuffle(deck, createRng(2)).map(cardId).join();
    expect(a).not.toEqual(b);
  });
});

describe("deal", () => {
  it("distribui a quantidade certa e mantém a pilha de compra", () => {
    const deck = makeDeck();
    const { hands, draw } = deal(deck, 4, 7);
    expect(hands).toHaveLength(4);
    hands.forEach((h) => expect(h).toHaveLength(7));
    expect(draw).toHaveLength(52 - 4 * 7);
  });

  it("não sobrepõe cartas entre mãos e pilha", () => {
    const deck = makeDeck();
    const { hands, draw } = deal(deck, 3, 5);
    const all = [...hands.flat(), ...draw].map(cardId);
    expect(new Set(all).size).toBe(52);
  });

  it("recusa distribuir mais cartas do que existem", () => {
    expect(() => deal(makeDeck(), 5, 11)).toThrow();
  });
});
