// Testes do BOT NORMAL V1 — mãos POSITIVAS (7–10) + escolha de trunfo (ETAPA 2B).
import { describe, it, expect } from "vitest";
import type { Card, Rank, Suit } from "./cards.js";
import { sameCard, cardId } from "./cards.js";
import type { Seat, Trump } from "./contracts.js";
import { HAND_CONTRACTS } from "./contracts.js";
import { createMatch, startNextHand, selectTrump, playCard, legalCardsFor, type MatchState } from "./match.js";
import { chooseBotCard } from "./bot.js";
import { buildBotView, type BotView, type PublicPlay } from "./botView.js";
import { chooseNormalCard, chooseNormalTrump } from "./botNormal.js";

const C = (rank: Rank, suit: Suit): Card => ({ rank, suit });
const hand = (...cards: Card[]): Card[] => cards;
const play = (seat: Seat, card: Card): PublicPlay => ({ seat, card });

/** BotView positiva mínima (assento 0 = bot). `seen` alimenta o histórico público. */
function mkPos(o: {
  legal: Card[];
  currentTrick?: PublicPlay[];
  trump?: Trump;
  seen?: Card[];
  voids?: Suit[][];
  hand?: Card[];
  trickNumber?: number;
}): BotView {
  const ct = o.currentTrick ?? [];
  const completedTricks = (o.seen ?? []).length
    ? [{ number: 1, leader: 1 as Seat, winner: 1 as Seat, plays: (o.seen ?? []).map((c, i) => play((i % 4) as Seat, c)) }]
    : [];
  return {
    seat: 0,
    hand: o.hand ?? o.legal,
    legalCards: o.legal,
    contract: { kind: "positive", isPositive: true, noLeadHearts: false },
    handNumber: 7,
    trickNumber: o.trickNumber ?? 3,
    dealer: 0,
    leader: ct.length > 0 ? ct[0].seat : 0,
    trump: o.trump ?? "no-trump",
    turn: 0,
    currentTrick: ct,
    completedTricks,
    handCounts: [13, 13, 13, 13],
    scores: [0, 0, 0, 0],
    voids: o.voids ?? [[], [], [], []],
  };
}

// ───────────────────────── escolha de trunfo (A–H) ─────────────────────────
describe("chooseNormalTrump", () => {
  it("A · 7 Espadas com boa força → Espadas", () => {
    const h = hand(C("A", "spades"), C("K", "spades"), C("Q", "spades"), C("J", "spades"), C("5", "spades"), C("4", "spades"), C("3", "spades"), C("6", "hearts"), C("5", "hearts"), C("4", "diamonds"), C("3", "diamonds"), C("3", "clubs"), C("2", "clubs"));
    expect(chooseNormalTrump(h)).toBe("spades");
  });

  it("B · mão equilibrada, honras espalhadas → Sem Trunfo", () => {
    const h = hand(C("A", "spades"), C("7", "spades"), C("4", "spades"), C("A", "hearts"), C("6", "hearts"), C("3", "hearts"), C("K", "diamonds"), C("5", "diamonds"), C("2", "diamonds"), C("K", "clubs"), C("8", "clubs"), C("4", "clubs"), C("3", "clubs"));
    expect(chooseNormalTrump(h)).toBe("no-trump");
  });

  it("C · naipe longo fraco × curto fortíssimo (A/K/Q) → o forte prevalece (Copas)", () => {
    const h = hand(C("9", "spades"), C("8", "spades"), C("7", "spades"), C("6", "spades"), C("5", "spades"), C("4", "spades"), C("3", "spades"), C("A", "hearts"), C("K", "hearts"), C("Q", "hearts"), C("5", "diamonds"), C("4", "diamonds"), C("2", "clubs"));
    expect(chooseNormalTrump(h)).toBe("hearts");
  });

  it("D · 5 A/K/Q/x/x contra 5 baixas → o forte prevalece (Espadas)", () => {
    const h = hand(C("A", "spades"), C("K", "spades"), C("Q", "spades"), C("5", "spades"), C("4", "spades"), C("9", "hearts"), C("8", "hearts"), C("7", "hearts"), C("6", "hearts"), C("5", "hearts"), C("3", "diamonds"), C("2", "diamonds"), C("4", "clubs"));
    expect(chooseNormalTrump(h)).toBe("spades");
  });

  it("E · Sem Trunfo NÃO vence por diferença marginal → escolhe o naipe (Espadas)", () => {
    const h = hand(C("A", "spades"), C("K", "spades"), C("4", "spades"), C("3", "spades"), C("K", "hearts"), C("Q", "hearts"), C("3", "hearts"), C("A", "diamonds"), C("5", "diamonds"), C("9", "clubs"), C("8", "clubs"), C("7", "clubs"), C("6", "clubs"));
    expect(chooseNormalTrump(h)).toBe("spades");
  });

  it("F · mesma mão em ordem diferente → mesmo trunfo", () => {
    const h = hand(C("A", "spades"), C("K", "spades"), C("Q", "spades"), C("J", "spades"), C("5", "spades"), C("4", "spades"), C("3", "spades"), C("6", "hearts"), C("5", "hearts"), C("4", "diamonds"), C("3", "diamonds"), C("3", "clubs"), C("2", "clubs"));
    const shuffled = [...h].reverse();
    expect(chooseNormalTrump(shuffled)).toBe(chooseNormalTrump(h));
  });

  it("G · 100 execuções → sempre o mesmo resultado (determinístico)", () => {
    const h = hand(C("A", "hearts"), C("K", "hearts"), C("Q", "hearts"), C("2", "hearts"), C("A", "spades"), C("7", "spades"), C("4", "diamonds"), C("3", "diamonds"), C("2", "diamonds"), C("9", "clubs"), C("8", "clubs"), C("7", "clubs"), C("6", "clubs"));
    const first = chooseNormalTrump(h);
    for (let i = 0; i < 100; i++) expect(chooseNormalTrump(h)).toBe(first);
  });

  it("H · não tem acesso a estado adversário (assinatura só recebe a própria mão)", () => {
    // prova estrutural: a função aceita apenas Card[]; duas 'partidas' com a mesma mão do chooser → mesmo trunfo (ver M).
    const h = hand(C("A", "clubs"), C("K", "clubs"), C("Q", "clubs"), C("J", "clubs"), C("9", "clubs"), C("2", "spades"), C("3", "spades"), C("4", "hearts"), C("5", "hearts"), C("6", "diamonds"), C("7", "diamonds"), C("8", "diamonds"), C("9", "diamonds"));
    expect(chooseNormalTrump(h)).toBe("clubs");
  });
});

// ───────────────────────── jogada positiva (I–T) ─────────────────────────
describe("chooseNormalCard — positivas", () => {
  it("I · último, 8 e A vencem → joga a menor suficiente (8)", () => {
    const v = mkPos({ trump: "clubs", currentTrick: [play(1, C("6", "spades")), play(2, C("2", "spades")), play(3, C("4", "spades"))], legal: [C("8", "spades"), C("A", "spades")] });
    expect(chooseNormalCard(v)).toEqual(C("8", "spades"));
  });

  it("J · não consegue vencer → preserva o Rei (joga a mais baixa)", () => {
    const v = mkPos({ trump: "clubs", currentTrick: [play(1, C("A", "spades")), play(2, C("3", "spades")), play(3, C("5", "spades"))], legal: [C("K", "spades"), C("2", "spades")] });
    expect(chooseNormalCard(v)).toEqual(C("2", "spades"));
  });

  it("K · void no naipe, corta com trunfo baixo e ganha", () => {
    const v = mkPos({ trump: "hearts", currentTrick: [play(1, C("K", "spades")), play(2, C("Q", "spades")), play(3, C("J", "spades"))], legal: [C("3", "hearts"), C("7", "diamonds"), C("8", "clubs")] });
    expect(chooseNormalCard(v)).toEqual(C("3", "hearts"));
  });

  it("L · adversário já cortou → sobretrunfa com o menor suficiente (9♥ sobre 5♥)", () => {
    const v = mkPos({ trump: "hearts", currentTrick: [play(1, C("K", "spades")), play(2, C("5", "hearts")), play(3, C("J", "spades"))], legal: [C("3", "hearts"), C("9", "hearts"), C("8", "clubs")] });
    expect(chooseNormalCard(v)).toEqual(C("9", "hearts"));
  });

  it("M · não consegue sobretrunfar → não desperdiça trunfo alto (descarta 8♣)", () => {
    const v = mkPos({ trump: "hearts", currentTrick: [play(1, C("K", "spades")), play(2, C("Q", "hearts")), play(3, C("J", "spades"))], legal: [C("3", "hearts"), C("9", "hearts"), C("8", "clubs")] });
    expect(chooseNormalCard(v)).toEqual(C("8", "clubs"));
  });

  it("N · A♠ já saiu → K♠ reconhecido como master e é puxado", () => {
    const v = mkPos({ trump: "no-trump", seen: [C("A", "spades")], legal: [C("K", "spades"), C("3", "diamonds"), C("2", "diamonds")], hand: [C("K", "spades"), C("3", "diamonds"), C("2", "diamonds")] });
    expect(chooseNormalCard(v)).toEqual(C("K", "spades"));
  });

  it("O · A♠ NÃO saiu → K♠ não é master; desenvolve o naipe longo (2♦)", () => {
    const v = mkPos({ trump: "no-trump", seen: [C("7", "clubs")], legal: [C("K", "spades"), C("3", "diamonds"), C("2", "diamonds")], hand: [C("K", "spades"), C("3", "diamonds"), C("2", "diamonds")] });
    expect(chooseNormalCard(v)).toEqual(C("2", "diamonds"));
  });

  it("P · adversário void no naipe → risco de corte tira o 'master' (não puxa K♠)", () => {
    const v = mkPos({
      trump: "hearts",
      seen: [C("A", "spades")], // K♠ seria a maior conhecida...
      voids: [[], [], ["spades"], []], // ...mas o assento 2 está void em ♠ e há trunfos fora
      legal: [C("K", "spades"), C("4", "diamonds"), C("3", "diamonds")],
      hand: [C("K", "spades"), C("4", "diamonds"), C("3", "diamonds")],
    });
    const chosen = chooseNormalCard(v);
    expect(chosen).not.toEqual(C("K", "spades")); // respeita o risco de corte
    expect(chosen).toEqual(C("3", "diamonds"));
  });

  it("Q · Sem Trunfo → nenhuma lógica de corte (descarta baixo ao ficar void)", () => {
    const v = mkPos({ trump: "no-trump", currentTrick: [play(1, C("A", "spades"))], legal: [C("9", "hearts"), C("2", "diamonds"), C("K", "clubs")] });
    expect(chooseNormalCard(v)).toEqual(C("2", "diamonds"));
  });

  it("R · abre com carta master (Ás)", () => {
    const v = mkPos({ trump: "no-trump", legal: [C("A", "spades"), C("3", "diamonds")], hand: [C("A", "spades"), C("3", "diamonds")] });
    expect(chooseNormalCard(v)).toEqual(C("A", "spades"));
  });

  it("S · força clara de trunfo → puxa trunfo ao abrir (lidera Espadas)", () => {
    const h = [C("K", "spades"), C("Q", "spades"), C("J", "spades"), C("5", "spades"), C("4", "spades"), C("3", "spades"), C("9", "hearts"), C("8", "hearts"), C("7", "diamonds"), C("6", "diamonds"), C("3", "clubs"), C("2", "clubs"), C("4", "clubs")];
    const v = mkPos({ trump: "spades", legal: h, hand: h });
    expect(chooseNormalCard(v).suit).toBe("spades");
  });

  it("T · trunfo fraco → NÃO puxa trunfo, desenvolve o naipe longo lateral", () => {
    const h = [C("4", "spades"), C("3", "spades"), C("K", "hearts"), C("Q", "hearts"), C("5", "hearts"), C("4", "hearts"), C("3", "hearts"), C("6", "diamonds"), C("5", "diamonds"), C("4", "diamonds"), C("8", "clubs"), C("7", "clubs"), C("9", "clubs")];
    const v = mkPos({ trump: "spades", legal: h, hand: h });
    expect(chooseNormalCard(v).suit).not.toBe("spades"); // não gastou trunfo
    expect(chooseNormalCard(v)).toEqual(C("3", "hearts")); // baixa do naipe mais longo (Copas)
  });
});

// ───────────────────────── anti-cheat no nível da decisão ─────────────────────────
describe("Bot Normal positivo — anti-cheat de decisão", () => {
  it("redistribuir as mãos ocultas não muda a carta nem o trunfo escolhidos", () => {
    const m1 = createMatch(["A", "B", "C", "D"], 314);
    for (let hn = 1; hn <= 7; hn++) {
      startNextHand(m1);
      while (m1.hand!.awaitingTrumpFrom !== null) {
        const ch = m1.hand!.awaitingTrumpFrom as Seat;
        selectTrump(m1, ch, chooseNormalTrump(buildBotView(m1, ch).hand));
      }
      if (hn < 7) while (m1.hand!.handScores === null) { const s = m1.hand!.turn as Seat; playCard(m1, s, chooseBotCard(m1, s)); }
    }
    // mão 7 (positiva), meio de jogo
    for (let i = 0; i < 5; i++) { const s = m1.hand!.turn as Seat; playCard(m1, s, chooseNormalCard(buildBotView(m1, s))); }
    const seat = m1.hand!.turn as Seat;

    const m2 = JSON.parse(JSON.stringify(m1)) as MatchState;
    const others = ([0, 1, 2, 3] as Seat[]).filter((s) => s !== seat);
    const pool = others.flatMap((s) => m2.hand!.hands[s]);
    const permuted = [...pool].reverse();
    let idx = 0;
    for (const s of others) { const n = m2.hand!.hands[s].length; m2.hand!.hands[s] = permuted.slice(idx, idx + n); idx += n; }
    expect(others.flatMap((s) => m2.hand!.hands[s].map(cardId)).join(","))
      .not.toBe(others.flatMap((s) => m1.hand!.hands[s].map(cardId)).join(","));

    expect(chooseNormalCard(buildBotView(m2, seat))).toEqual(chooseNormalCard(buildBotView(m1, seat)));
    // trunfo (só a própria mão): idêntico por construção
    expect(chooseNormalTrump(buildBotView(m2, seat).hand)).toBe(chooseNormalTrump(buildBotView(m1, seat).hand));
  });
});

// ───────────────────────── driver positivo (N/O do enunciado 22) ─────────────────────────
describe("Bot Normal — driver positivo (trunfo + jogo)", () => {
  it("dirige as 4 positivas: nunca ilegal, 13 vazas, +325 cada; e final da partida = 0", () => {
    for (const seed of [1, 7, 42, 2024]) {
      const m = createMatch(["A", "B", "C", "D"], seed);
      for (let hn = 1; hn <= 10; hn++) {
        startNextHand(m);
        while (m.hand!.awaitingTrumpFrom !== null) {
          const ch = m.hand!.awaitingTrumpFrom as Seat;
          selectTrump(m, ch, chooseNormalTrump(buildBotView(m, ch).hand));
        }
        let guard = 0;
        while (m.hand!.handScores === null) {
          const s = m.hand!.turn as Seat;
          const legal = legalCardsFor(m, s);
          const card = chooseNormalCard(buildBotView(m, s));
          expect(legal.some((l) => sameCard(l, card)), `ilegal na mão ${hn} seed ${seed}`).toBe(true);
          playCard(m, s, card);
          if (++guard > 100) throw new Error("mão não terminou");
        }
        expect(m.hand!.handScores!.reduce((a, b) => a + b, 0)).toBe(HAND_CONTRACTS[hn].handTotal);
        if (HAND_CONTRACTS[hn].isPositive) {
          expect(m.hand!.completedTricks.length).toBe(13); // positivas jogam as 13 vazas
          expect(m.hand!.handScores!.reduce((a, b) => a + b, 0)).toBe(325);
        }
      }
      expect(m.positives.reduce((a, b) => a + b, 0)).toBe(1300); // +1300 nas positivas
      expect(m.cumulative.reduce((a, b) => a + b, 0)).toBe(0);   // checksum final
    }
  });
});
