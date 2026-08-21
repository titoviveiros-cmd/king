// Testes do BOT NORMAL V1 — inteligência das 6 mãos NEGATIVAS (ETAPA 2A).
// Cenários deliberados onde a escolha racional é evidente + prova anti-cheat no nível da decisão.
import { describe, it, expect } from "vitest";
import type { Card, Rank, Suit } from "./cards.js";
import { sameCard, cardId } from "./cards.js";
import type { ContractKind, Seat, Trump } from "./contracts.js";
import { HAND_CONTRACTS } from "./contracts.js";
import { createMatch, startNextHand, playCard, legalCardsFor, type MatchState } from "./match.js";
import { chooseBotCard } from "./bot.js";
import { buildBotView, type BotView, type PublicPlay } from "./botView.js";
import { chooseNormalCard } from "./botNormal.js";

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });
const noLead = (k: ContractKind) => k === "no-hearts" || k === "no-king";

/** Monta uma BotView pública mínima (assento 0 = bot) com defaults sãos + os campos do cenário. */
function mkView(o: {
  kind: ContractKind;
  legal: Card[];
  currentTrick?: PublicPlay[];
  trickNumber?: number;
  trump?: Trump | null;
  hand?: Card[];
}): BotView {
  const currentTrick = o.currentTrick ?? [];
  return {
    seat: 0,
    hand: o.hand ?? o.legal,
    legalCards: o.legal,
    contract: { kind: o.kind, isPositive: false, noLeadHearts: noLead(o.kind) },
    handNumber: 1,
    trickNumber: o.trickNumber ?? 1,
    dealer: 0,
    leader: currentTrick.length > 0 ? currentTrick[0].seat : 0,
    trump: o.trump ?? null,
    turn: 0,
    currentTrick,
    completedTricks: [],
    handCounts: [13, 13, 13, 13],
    scores: [0, 0, 0, 0],
    voids: [[], [], [], []],
  };
}

const play = (seat: Seat, card: Card): PublicPlay => ({ seat, card });

describe("Bot Normal — Mão 1 (não pegar Vazas)", () => {
  it("A · 4/8/K seguindo ♠ sob 10♠: 8 é a MAIOR carta que ainda perde → joga 8♠", () => {
    const view = mkView({ kind: "no-tricks", currentTrick: [play(1, c("10", "spades"))], legal: [c("4", "spades"), c("8", "spades"), c("K", "spades")] });
    expect(chooseNormalCard(view)).toEqual(c("8", "spades"));
  });

  it("B · todas vencem e ainda há adversários por jogar → conservador (a mais baixa)", () => {
    const view = mkView({ kind: "no-tricks", currentTrick: [play(1, c("3", "spades"))], legal: [c("J", "spades"), c("Q", "spades"), c("K", "spades")] });
    expect(chooseNormalCard(view)).toEqual(c("J", "spades"));
  });

  it("C · último e vitória inevitável → descarrega a mais alta (9♠ vs K♠ → K♠)", () => {
    const view = mkView({
      kind: "no-tricks",
      currentTrick: [play(1, c("5", "spades")), play(2, c("2", "spades")), play(3, c("4", "spades"))],
      legal: [c("9", "spades"), c("K", "spades")],
    });
    expect(chooseNormalCard(view)).toEqual(c("K", "spades"));
  });
});

describe("Bot Normal — Mão 2 (não pegar Copas)", () => {
  it("D · void, baldando: larga a Copa de MAIOR risco (Q♥ vs 3♥ vs 5♣ → Q♥)", () => {
    const view = mkView({ kind: "no-hearts", currentTrick: [play(1, c("K", "spades"))], legal: [c("Q", "hearts"), c("3", "hearts"), c("5", "clubs")] });
    expect(chooseNormalCard(view)).toEqual(c("Q", "hearts"));
  });

  it("E · vaza com 2 Copas e há carta que não vence → NÃO captura (duca com 3♠)", () => {
    const view = mkView({
      kind: "no-hearts",
      currentTrick: [play(1, c("8", "spades")), play(2, c("A", "hearts")), play(3, c("9", "hearts"))],
      legal: [c("3", "spades"), c("10", "spades")],
    });
    expect(chooseNormalCard(view)).toEqual(c("3", "spades"));
  });
});

describe("Bot Normal — Mão 3 (não pegar Damas)", () => {
  it("F · void, baldando: prioriza descartar a Dama (Q♦)", () => {
    const view = mkView({ kind: "no-queens", currentTrick: [play(1, c("K", "hearts"))], legal: [c("Q", "diamonds"), c("5", "clubs"), c("2", "spades")] });
    expect(chooseNormalCard(view)).toEqual(c("Q", "diamonds"));
  });

  it("G · Dama na vaza, opções vencedora/perdedora → escolhe a perdedora (5♠)", () => {
    const view = mkView({
      kind: "no-queens",
      currentTrick: [play(1, c("K", "spades")), play(2, c("Q", "spades"))],
      legal: [c("5", "spades"), c("A", "spades")],
    });
    expect(chooseNormalCard(view)).toEqual(c("5", "spades"));
  });

  it("H · pode largar a Dama com segurança sob o Ás → faz esse descarte (Q♠)", () => {
    const view = mkView({ kind: "no-queens", currentTrick: [play(1, c("A", "spades"))], legal: [c("Q", "spades"), c("3", "spades")] });
    expect(chooseNormalCard(view)).toEqual(c("Q", "spades"));
  });
});

describe("Bot Normal — Mão 4 (não pegar Reis/Valetes)", () => {
  it("I · void, baldando: prioriza uma carta penalizada (K♦ entre K♦/J♣/4♦)", () => {
    const view = mkView({ kind: "no-men", currentTrick: [play(1, c("A", "hearts"))], legal: [c("K", "diamonds"), c("J", "clubs"), c("4", "diamonds")] });
    const chosen = chooseNormalCard(view);
    expect(chosen.rank === "K" || chosen.rank === "J").toBe(true);
    expect(chosen).toEqual(c("K", "diamonds"));
  });

  it("J · vaza contém K♠ → evita assumir (3♠ em vez de A♠)", () => {
    const view = mkView({
      kind: "no-men",
      currentTrick: [play(1, c("10", "spades")), play(2, c("K", "spades"))],
      legal: [c("3", "spades"), c("A", "spades")],
    });
    expect(chooseNormalCard(view)).toEqual(c("3", "spades"));
  });
});

describe("Bot Normal — Mão 5 (fuja do King)", () => {
  it("K · K♥ já na vaza → evita vencê-la (3♥ em vez de A♥)", () => {
    const view = mkView({ kind: "no-king", currentTrick: [play(1, c("K", "hearts"))], legal: [c("3", "hearts"), c("A", "hearts")] });
    expect(chooseNormalCard(view)).toEqual(c("3", "hearts"));
  });

  it("M · K♥ próprio e o motor obriga (única legal) → respeita legalCards, joga K♥", () => {
    const view = mkView({ kind: "no-king", currentTrick: [play(1, c("5", "spades"))], legal: [c("K", "hearts")] });
    expect(chooseNormalCard(view)).toEqual(c("K", "hearts"));
  });
});

describe("Bot Normal — Mão 6 (não pegar as 2 últimas)", () => {
  it("N · mesma mão/vaza: vaza 5 descarrega força (A♠) e vaza 12 preserva baixa (2♠)", () => {
    const legal = [c("2", "spades"), c("A", "spades")];
    expect(chooseNormalCard(mkView({ kind: "no-last-two", legal, trickNumber: 5 }))).toEqual(c("A", "spades"));
    expect(chooseNormalCard(mkView({ kind: "no-last-two", legal, trickNumber: 12 }))).toEqual(c("2", "spades"));
  });

  it("O · na 12ª, opção que perde vs que vence → escolhe a que perde (4♠ sob 7♠)", () => {
    const view = mkView({ kind: "no-last-two", currentTrick: [play(1, c("7", "spades"))], legal: [c("4", "spades"), c("K", "spades")], trickNumber: 12 });
    expect(chooseNormalCard(view)).toEqual(c("4", "spades"));
  });
});

describe("Bot Normal — contrato/robustez", () => {
  it("mão positiva ainda NÃO implementada: lança erro explícito (ETAPA 2B)", () => {
    const view = mkView({ kind: "positive", legal: [c("2", "spades"), c("A", "spades")] });
    // força isPositive = true (mkView cria negativa por padrão)
    view.contract = { kind: "positive", isPositive: true, noLeadHearts: false };
    expect(() => chooseNormalCard(view)).toThrow(/positiv/i);
  });

  it("nas 6 negativas dirigidas pelo Bot Normal: nunca joga ilegal, mão termina, e o total bate o contrato", () => {
    for (const seed of [1, 7, 42, 100, 2024]) {
      const m = createMatch(["A", "B", "C", "D"], seed);
      for (let hn = 1; hn <= 6; hn++) {
        startNextHand(m);
        let guard = 0;
        while (m.hand!.handScores === null) {
          const seat = m.hand!.turn as Seat;
          const legal = legalCardsFor(m, seat);
          const card = chooseNormalCard(buildBotView(m, seat));
          expect(legal.some((l) => sameCard(l, card)), `carta ilegal na mão ${hn} seed ${seed}`).toBe(true);
          playCard(m, seat, card);
          if (++guard > 100) throw new Error("mão não terminou");
        }
        expect(m.hand!.handScores!.reduce((a, b) => a + b, 0)).toBe(HAND_CONTRACTS[hn].handTotal);
      }
      // soma das 6 negativas = −1300 (checksum negativo), com o Bot Normal jogando
      expect(m.negatives.reduce((a, b) => a + b, 0)).toBe(-1300);
    }
  });
});

describe("Bot Normal — anti-cheat no nível da DECISÃO", () => {
  it("L · redistribuir as mãos ocultas (inclui o K♥) não muda a decisão, se o público é idêntico", () => {
    // estado mid-mão negativa; K♥ ainda oculto entre adversários
    const m1 = createMatch(["A", "B", "C", "D"], 909);
    startNextHand(m1); // mão 1 (negativa)
    for (let i = 0; i < 5; i++) {
      const s = m1.hand!.turn as Seat;
      playCard(m1, s, chooseBotCard(m1, s));
    }
    const seat = m1.hand!.turn as Seat;

    const m2 = JSON.parse(JSON.stringify(m1)) as MatchState;
    const others = ([0, 1, 2, 3] as Seat[]).filter((s) => s !== seat);
    const pool = others.flatMap((s) => m2.hand!.hands[s]);
    const permuted = [...pool].reverse();
    let idx = 0;
    for (const s of others) {
      const n = m2.hand!.hands[s].length;
      m2.hand!.hands[s] = permuted.slice(idx, idx + n);
      idx += n;
    }
    // garante que as mãos ocultas ficaram mesmo diferentes
    expect(others.flatMap((s) => m2.hand!.hands[s].map(cardId)).join(","))
      .not.toBe(others.flatMap((s) => m1.hand!.hands[s].map(cardId)).join(","));

    const d1 = chooseNormalCard(buildBotView(m1, seat));
    const d2 = chooseNormalCard(buildBotView(m2, seat));
    expect(d2).toEqual(d1);
  });
});
