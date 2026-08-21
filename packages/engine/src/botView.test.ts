// Testes da FRONTEIRA ANTI-CHEAT (ETAPA 1): `buildBotView` só entrega informação pública + a
// própria mão. Nenhuma inteligência de bot aqui — só a garantia estrutural contra cheat.
import { describe, it, expect } from "vitest";
import { cardId, type Suit } from "./cards.js";
import { createMatch, startNextHand, playCard, type MatchState } from "./match.js";
import { chooseBotCard } from "./bot.js";
import { buildBotView, deduceVoids, type BotView, type PublicPlay } from "./botView.js";
import type { Seat } from "./contracts.js";

const PLAYERS = ["A", "B", "C", "D"];
const others = (seat: Seat) => ([0, 1, 2, 3] as Seat[]).filter((s) => s !== seat);

/** Joga `n` cartas legais de forma determinística (baseline = menor carta legal). */
function playN(m: MatchState, n: number): void {
  for (let i = 0; i < n && m.hand && m.hand.handScores === null; i++) {
    const s = m.hand.turn as Seat;
    playCard(m, s, chooseBotCard(m, s));
  }
}

/** Todas as cartas que aparecem em qualquer campo de cartas da view. */
function cardsInView(v: BotView) {
  return [
    ...v.hand,
    ...v.legalCards,
    ...v.currentTrick.map((p) => p.card),
    ...v.completedTricks.flatMap((t) => t.plays.map((p) => p.card)),
  ];
}

const EXPECTED_KEYS = [
  "seat", "hand", "legalCards", "contract", "handNumber", "trickNumber", "dealer",
  "leader", "trump", "turn", "currentTrick", "completedTricks", "handCounts", "scores", "voids",
].sort();

describe("BotView — construção", () => {
  it("expõe exatamente o conjunto de chaves públicas esperado (sem 'hands'/'draw'/'deck')", () => {
    const m = createMatch(PLAYERS, 7);
    startNextHand(m);
    const view = buildBotView(m, m.hand!.turn as Seat);
    expect(Object.keys(view).sort()).toEqual(EXPECTED_KEYS);
    for (const forbidden of ["hands", "draw", "deck", "m", "match", "rng", "seed"]) {
      expect(view).not.toHaveProperty(forbidden);
    }
  });

  it("A · a própria mão aparece corretamente (cópia, não referência)", () => {
    const m = createMatch(PLAYERS, 7);
    startNextHand(m);
    const seat = m.hand!.turn as Seat;
    const view = buildBotView(m, seat);
    expect(view.hand).toEqual(m.hand!.hands[seat]);
    // é cópia: mutar a view não afeta o motor
    const antes = m.hand!.hands[seat].length;
    view.hand.push({ suit: "spades", rank: "A" });
    expect(m.hand!.hands[seat].length).toBe(antes);
  });
});

describe("BotView — fronteira anti-cheat", () => {
  it("B · nenhuma mão adversária aparece na view (início da mão: só cartas próprias)", () => {
    const m = createMatch(PLAYERS, 7);
    startNextHand(m);
    const seat = m.hand!.turn as Seat;
    const view = buildBotView(m, seat);
    const ownIds = new Set(m.hand!.hands[seat].map(cardId));
    for (const c of cardsInView(view)) expect(ownIds.has(cardId(c))).toBe(true);
  });

  it("B/D · no meio da mão, toda carta da view é própria OU comprovadamente pública", () => {
    const m = createMatch(PLAYERS, 13);
    startNextHand(m);
    playN(m, 9); // ~2 vazas completas + parcial
    const seat = m.hand!.turn as Seat;
    const view = buildBotView(m, seat);
    const publicIds = new Set(
      [...m.hand!.completedTricks.flatMap((t) => t.cards), ...m.hand!.currentTrick].map((p) => cardId(p.card)),
    );
    const allowed = new Set([...m.hand!.hands[seat].map(cardId), ...publicIds]);
    for (const c of cardsInView(view)) expect(allowed.has(cardId(c))).toBe(true);
    // e nenhuma carta OCULTA de adversário vaza para a serialização
    const hiddenOpp = others(seat)
      .flatMap((s) => m.hand!.hands[s])
      .filter((c) => !publicIds.has(cardId(c)));
    const viewIds = new Set(cardsInView(view).map(cardId));
    for (const c of hiddenOpp) expect(viewIds.has(cardId(c))).toBe(false);
  });

  it("C · a view é serializável e não guarda referência ao motor (deep copy)", () => {
    const m = createMatch(PLAYERS, 7);
    startNextHand(m);
    playN(m, 5);
    const seat = m.hand!.turn as Seat;
    const view = buildBotView(m, seat);
    expect(() => JSON.parse(JSON.stringify(view))).not.toThrow();
    // mutar campos da view não altera o motor
    view.handCounts[0] = -999;
    view.scores[1] = -999;
    expect(m.hand!.handCounts[0]).not.toBe(-999);
    expect(m.cumulative[1]).not.toBe(-999);
  });

  it("D · o histórico da view reproduz fielmente as vazas públicas do motor", () => {
    const m = createMatch(PLAYERS, 21);
    startNextHand(m);
    playN(m, 12); // pelo menos 2 vazas completas
    const seat = m.hand!.turn as Seat;
    const view = buildBotView(m, seat);
    expect(view.completedTricks.length).toBe(m.hand!.completedTricks.length);
    view.completedTricks.forEach((t, i) => {
      const src = m.hand!.completedTricks[i];
      expect(t.number).toBe(src.number);
      expect(t.leader).toBe(src.leader);
      expect(t.winner).toBe(src.winner);
      expect(t.plays).toEqual(src.cards.map((p) => ({ seat: p.seat, card: p.card })));
    });
  });
});

describe("deduceVoids — dedução só do público", () => {
  it("E · deduz void quando um seguidor NÃO serve o naipe puxado (observável)", () => {
    // seat0 abre ♠; seat1 serve ♠; seat2 joga ♥ (fora do naipe ⇒ void em ♠); seat3 serve ♠
    const trick: PublicPlay[] = [
      { seat: 0, card: { suit: "spades", rank: "5" } },
      { seat: 1, card: { suit: "spades", rank: "9" } },
      { seat: 2, card: { suit: "hearts", rank: "3" } },
      { seat: 3, card: { suit: "spades", rank: "K" } },
    ];
    const voids = deduceVoids([trick]);
    expect(voids[2]).toEqual(["spades"]);
    expect(voids[0]).toEqual([]);
    expect(voids[1]).toEqual([]);
    expect(voids[3]).toEqual([]);
  });

  it("F · NÃO deduz void por carta que apareceu/sumiu — só por falha de servir", () => {
    // todos servem ♠ (cartas altas específicas aparecem) ⇒ nenhum void
    const allServe: PublicPlay[] = [
      { seat: 0, card: { suit: "spades", rank: "2" } },
      { seat: 1, card: { suit: "spades", rank: "A" } },
      { seat: 2, card: { suit: "spades", rank: "K" } },
      { seat: 3, card: { suit: "spades", rank: "Q" } },
    ];
    expect(deduceVoids([allServe])).toEqual([[], [], [], []]);
    // o líder define o naipe e nunca gera void, mesmo abrindo ♥
    const leadHearts: PublicPlay[] = [
      { seat: 2, card: { suit: "hearts", rank: "7" } },
      { seat: 3, card: { suit: "hearts", rank: "9" } },
      { seat: 0, card: { suit: "hearts", rank: "2" } },
      { seat: 1, card: { suit: "hearts", rank: "A" } },
    ];
    expect(deduceVoids([leadHearts])).toEqual([[], [], [], []]);
  });

  it("acumula voids por assento em várias vazas, em ordem canônica de naipes", () => {
    const t1: PublicPlay[] = [
      { seat: 0, card: { suit: "clubs", rank: "4" } },
      { seat: 1, card: { suit: "spades", rank: "3" } }, // seat1 void em ♣
      { seat: 2, card: { suit: "clubs", rank: "8" } },
      { seat: 3, card: { suit: "clubs", rank: "K" } },
    ];
    const t2: PublicPlay[] = [
      { seat: 3, card: { suit: "hearts", rank: "5" } },
      { seat: 0, card: { suit: "hearts", rank: "9" } },
      { seat: 1, card: { suit: "diamonds", rank: "2" } }, // seat1 void em ♥
      { seat: 2, card: { suit: "hearts", rank: "A" } },
    ];
    const voids = deduceVoids([t1, t2]);
    // ordem canônica de SUITS = spades, hearts, diamonds, clubs
    expect(voids[1]).toEqual(["hearts", "clubs"]);
    expect(voids[0]).toEqual([]);
    expect(voids[2]).toEqual([]);
    expect(voids[3]).toEqual([]);
  });
});

describe("G · redistribuição das mãos ocultas NÃO muda a BotView", () => {
  it("mesma info pública + mesma mão própria ⇒ mesma BotView, mesmo trocando as cartas ocultas", () => {
    const m1 = createMatch(PLAYERS, 123);
    startNextHand(m1);
    playN(m1, 6); // gera histórico + vaza parcial
    const botSeat = m1.hand!.turn as Seat;

    // clone puro (dados JSON) e redistribui as cartas ocultas dos 3 outros assentos, preservando tamanhos
    const m2 = JSON.parse(JSON.stringify(m1)) as MatchState;
    const rest = others(botSeat);
    const pool = rest.flatMap((s) => m2.hand!.hands[s]);
    const permuted = [...pool].reverse(); // permutação determinística
    let idx = 0;
    for (const s of rest) {
      const n = m2.hand!.hands[s].length;
      m2.hand!.hands[s] = permuted.slice(idx, idx + n);
      idx += n;
    }

    // garantia de que realmente redistribuímos algo diferente
    const hidden1 = rest.flatMap((s) => m1.hand!.hands[s].map(cardId)).join(",");
    const hidden2 = rest.flatMap((s) => m2.hand!.hands[s].map(cardId)).join(",");
    expect(hidden2).not.toBe(hidden1);

    // mesma mão própria, mesmo histórico público, mesma vaza atual, mesmas contagens/pontuações
    const v1 = buildBotView(m1, botSeat);
    const v2 = buildBotView(m2, botSeat);
    expect(v2).toEqual(v1);
  });
});
