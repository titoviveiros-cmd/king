// INTEGRAÇÃO BOT NORMAL V1 → MESA.
//
// Prova que a Mesa real (`KingGame`) decide as jogadas E o trunfo dos bots com o Bot Normal
// validado no holdout, atravessando a fronteira anti-cheat (`buildBotView`), e que o Baseline
// deixou de decidir no fluxo normal.
//
// FRONTEIRA PRESERVADA NO PRÓPRIO TESTE: nada aqui lê informação privada da Mesa. O `MatchState`
// da `KingGame` continua inacessível de fora; o que precisa de verdade-terreno é observado num
// **oráculo** — um `MatchState` que o próprio teste constrói e portanto já conhece de direito.
// Mesmo no oráculo, a mão de um assento é lida via `buildBotView`, nunca via `m.hand.hands[]`.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Card, MatchState, Seat, Trump } from "@king/engine";

// Espiões finos sobre o motor REAL (tudo é repassado): permitem contar chamadas do Baseline e
// inspecionar cada `BotView` efetivamente entregue ao bot pela Mesa.
vi.mock("@king/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@king/engine")>();
  return {
    ...actual,
    buildBotView: vi.fn(actual.buildBotView),
    chooseBotCard: vi.fn(actual.chooseBotCard),
    chooseBotTrump: vi.fn(actual.chooseBotTrump),
  };
});

import * as engine from "@king/engine";
import { KingGame } from "./kingGame.js";
import { trumpLabel } from "../ui/contractText.js";

const PLAYERS = ["Você", "Bia", "Léo", "Nara"];
const HUMAN: Seat = 0;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const id = (c: Card) => `${c.rank}${c.suit[0]}`;

interface Play { seat: Seat; card: Card }
const seq = (p: Play[]) => p.map((x) => `${x.seat}:${id(x.card)}`).join(" ");

/** Conduz a partida INTEIRA pela Mesa real, exatamente como a UI faz (só métodos do adaptador). */
function driveMesa(seed: number) {
  const g = new KingGame(PLAYERS, seed);
  const plays: Play[] = [];
  const trumps: (Trump | null)[] = []; // índice h-1 = trunfo da mão h
  let guard = 0;
  while (!g.finished()) {
    if (++guard > 20000) throw new Error("loop de segurança");
    const ph = g.phase();
    if (ph === "handEnd") { trumps.push(g.trump()); g.advanceHand(); continue; }
    if (ph === "trump") {
      // O humano NÃO é o Bot Normal: usa a heurística antiga sobre a PRÓPRIA mão (pública p/ ele).
      if (g.humanChoosesTrump()) g.chooseTrumpHuman(engine.chooseTrumpByMajority(g.view().yourHand));
      else g.stepBotTrump();
      continue;
    }
    if (g.isHumanTurn()) {
      const c = g.legalCards()[0];
      g.playHuman(c);
      plays.push({ seat: HUMAN, card: c });
    } else {
      plays.push(g.stepBotPlay());
    }
  }
  trumps.push(g.trump()); // a 10ª mão termina em "matchEnd", não passa por "handEnd"
  return { g, plays, trumps };
}

type BotCard = (m: MatchState, seat: Seat) => Card;
type BotTrump = (m: MatchState, seat: Seat) => Trump;

/** Oráculo: mesma partida conduzida direto no motor, com o bot passado por parâmetro. */
function driveEngine(seed: number, botCard: BotCard, botTrump: BotTrump) {
  const m = engine.createMatch(PLAYERS, seed);
  engine.startNextHand(m);
  const plays: Play[] = [];
  let guard = 0;
  while (!m.finished) {
    if (++guard > 20000) throw new Error("loop de segurança");
    const h = m.hand!;
    if (h.handScores !== null) { engine.startNextHand(m); continue; }
    if (h.awaitingTrumpFrom !== null) {
      const ch = h.awaitingTrumpFrom;
      const t = ch === HUMAN
        ? engine.chooseTrumpByMajority(engine.buildBotView(m, ch).hand)
        : botTrump(m, ch);
      engine.selectTrump(m, ch, t);
      continue;
    }
    const s = h.turn as Seat;
    const card = s === HUMAN ? engine.legalCardsFor(m, s)[0] : botCard(m, s);
    engine.playCard(m, s, card);
    plays.push({ seat: s, card });
  }
  return { m, plays };
}

const normalCard: BotCard = (m, s) => engine.chooseNormalCard(engine.buildBotView(m, s));
const normalTrump: BotTrump = (m, s) => engine.chooseNormalTrump(engine.buildBotView(m, s).hand);
const baseCard: BotCard = (m, s) => engine.chooseBotCard(m, s);
const baseTrump: BotTrump = (m, s) => engine.chooseBotTrump(m, s);

/** Todas as `BotView` que a Mesa entregou aos bots desde o último `clearAllMocks`. */
function capturedViews(): engine.BotView[] {
  const spy = engine.buildBotView as unknown as { mock: { results: { type: string; value: engine.BotView }[] } };
  return spy.mock.results.filter((r) => r.type === "return").map((r) => r.value);
}

beforeEach(() => vi.clearAllMocks());

describe("A · a Mesa decide com o Bot Normal", () => {
  it("a sequência de cartas da Mesa é IDÊNTICA à do oráculo Bot Normal, jogada a jogada", () => {
    for (const seed of [1, 7, 21, 42, 99]) {
      const mesa = driveMesa(seed);
      const oracle = driveEngine(seed, normalCard, normalTrump);
      expect(seq(mesa.plays)).toBe(seq(oracle.plays));
      expect(mesa.plays.length).toBe(oracle.plays.length);
    }
  });

  it("os trunfos escolhidos pela Mesa são os do Bot Normal (mãos 8–10, escolhidas por bot)", () => {
    for (const seed of [1, 7, 21, 42, 99]) {
      const mesa = driveMesa(seed);
      const oracle = driveEngine(seed, normalCard, normalTrump);
      for (let h = 8; h <= 10; h++) {
        expect(mesa.trumps[h - 1]).toBe(oracle.m.history[h - 1].trump);
      }
    }
  });
});

describe("B · o Baseline não decide mais no fluxo da Mesa", () => {
  it("uma partida completa da Mesa não chama chooseBotCard nem chooseBotTrump nenhuma vez", () => {
    driveMesa(21);
    expect(engine.chooseBotCard).toHaveBeenCalledTimes(0);
    expect(engine.chooseBotTrump).toHaveBeenCalledTimes(0);
  });

  it("a sequência da Mesa DIFERE da do oráculo Baseline (comportamento, não só chamadas)", () => {
    for (const seed of [1, 7, 21, 42, 99]) {
      const mesa = driveMesa(seed);
      const baseline = driveEngine(seed, baseCard, baseTrump);
      expect(seq(mesa.plays)).not.toBe(seq(baseline.plays));
    }
  });

  it("o Baseline continua existindo e funcional no motor (não foi removido)", () => {
    const baseline = driveEngine(3, baseCard, baseTrump);
    expect(baseline.m.finished).toBe(true);
    expect(sum(baseline.m.cumulative)).toBe(0);
  });
});

describe("C · o Bot Normal recebe uma BotView sanitizada", () => {
  const PUBLICAS = [
    "completedTricks", "contract", "currentTrick", "dealer", "hand", "handCounts",
    "handNumber", "leader", "legalCards", "scores", "seat", "trickNumber", "trump", "turn", "voids",
  ];

  it("toda BotView entregue pela Mesa tem exatamente as chaves públicas — sem hands/deck/draw", () => {
    driveMesa(21);
    const views = capturedViews();
    expect(views.length).toBeGreaterThan(300); // ~3 bots × ~13 vazas × 10 mãos
    for (const v of views) {
      expect(Object.keys(v).sort()).toEqual(PUBLICAS);
      const raw = v as unknown as Record<string, unknown>;
      expect(raw.hands).toBeUndefined();
      expect(raw.deck).toBeUndefined();
      expect(raw.draw).toBeUndefined();
      expect(raw.m).toBeUndefined();
    }
  });

  it("a BotView é serializável — não guarda referência ao motor", () => {
    driveMesa(7);
    for (const v of capturedViews()) {
      expect(() => JSON.stringify(v)).not.toThrow();
    }
  });

  it("a Mesa nunca constrói a BotView do assento humano para decidir por bot", () => {
    driveMesa(42);
    for (const v of capturedViews()) expect(v.seat).not.toBe(HUMAN);
  });
});

describe("D · nenhuma mão adversária chega ao Bot Normal", () => {
  it("a mão da view nunca contém carta já jogada publicamente", () => {
    driveMesa(21);
    for (const v of capturedViews()) {
      const publicas = new Set<string>();
      for (const t of v.completedTricks) for (const p of t.plays) publicas.add(id(p.card));
      for (const p of v.currentTrick) publicas.add(id(p.card));
      for (const c of v.hand) expect(publicas.has(id(c))).toBe(false);
    }
  });

  it("na mesma vaza, as mãos vistas por bots diferentes são disjuntas", () => {
    driveMesa(21);
    const porVaza = new Map<string, engine.BotView[]>();
    for (const v of capturedViews()) {
      const k = `${v.handNumber}/${v.trickNumber}`;
      (porVaza.get(k) ?? porVaza.set(k, []).get(k)!).push(v);
    }
    for (const grupo of porVaza.values()) {
      for (let i = 0; i < grupo.length; i++) {
        for (let j = i + 1; j < grupo.length; j++) {
          if (grupo[i].seat === grupo[j].seat) continue;
          const a = new Set(grupo[i].hand.map(id));
          for (const c of grupo[j].hand) expect(a.has(id(c))).toBe(false);
        }
      }
    }
  });

  it("o tamanho da mão da view bate com a contagem pública do próprio assento", () => {
    driveMesa(42);
    for (const v of capturedViews()) expect(v.hand.length).toBe(v.handCounts[v.seat]);
  });
});

describe("E · toda decisão resulta em jogada legal", () => {
  it("a carta escolhida pertence sempre a legalCards (autoridade do motor)", () => {
    for (let seed = 1; seed <= 25; seed++) {
      driveEngine(seed, (m, s) => {
        const legal = engine.legalCardsFor(m, s);
        const c = engine.chooseNormalCard(engine.buildBotView(m, s));
        expect(legal.some((l) => l.rank === c.rank && l.suit === c.suit)).toBe(true);
        return c;
      }, normalTrump);
    }
  });

  it("25 partidas completas pela Mesa sem exceção — playCard rejeitaria qualquer ilegal", () => {
    for (let seed = 1; seed <= 25; seed++) {
      expect(() => driveMesa(seed)).not.toThrow();
    }
  });
});

describe("F/G · a partida completa e os invariantes se mantêm", () => {
  it("50 partidas: 10 mãos, sem deadlock, e checksums −1300 / +1300 / 0", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { g, plays } = driveMesa(seed);
      expect(g.finished()).toBe(true);
      expect(g.history()).toHaveLength(10);
      expect(sum(g.negatives())).toBe(-1300);
      expect(sum(g.positives())).toBe(1300);
      expect(sum(g.cumulative())).toBe(0);
      expect(g.winners().length).toBeGreaterThanOrEqual(1);
      expect(plays.length).toBeGreaterThan(0);
    }
  });
});

describe("H · os bots escolhem trunfo nas mãos positivas", () => {
  it("mãos 7–10 sempre têm trunfo definido; 1–6 nunca têm", () => {
    for (const seed of [1, 7, 21, 42, 99]) {
      const { trumps } = driveMesa(seed);
      expect(trumps).toHaveLength(10);
      for (let h = 1; h <= 6; h++) expect(trumps[h - 1]).toBeNull();
      for (let h = 7; h <= 10; h++) expect(trumps[h - 1]).not.toBeNull();
    }
  });

  it("o Bot Normal escolhe trunfo a partir SÓ da própria mão (13 cartas)", () => {
    driveMesa(21);
    // durante a fase de trunfo ainda não foi jogada carta alguma: a view tem 13 cartas
    const naFaseDeTrunfo = capturedViews().filter((v) => v.trickNumber === 1 && v.currentTrick.length === 0 && v.turn === null);
    expect(naFaseDeTrunfo.length).toBe(3); // M8, M9, M10 — os três bots
    for (const v of naFaseDeTrunfo) {
      expect(v.hand).toHaveLength(13);
      expect(v.legalCards).toHaveLength(0); // não é a vez de ninguém ainda
    }
  });
});

describe("I · Sem Trunfo é suportado no fluxo da Mesa", () => {
  it("existe semente em que um BOT escolhe Sem Trunfo, e a mão corre normalmente", () => {
    let achado: { seed: number; hand: number } | null = null;
    for (let seed = 1; seed <= 300 && !achado; seed++) {
      const { trumps } = driveMesa(seed);
      for (let h = 8; h <= 10; h++) { // 7 é do humano; 8–10 são dos bots
        if (trumps[h - 1] === "no-trump") { achado = { seed, hand: h }; break; }
      }
    }
    expect(achado).not.toBeNull();

    const { g, trumps } = driveMesa(achado!.seed);
    const h = achado!.hand;
    expect(trumps[h - 1]).toBe("no-trump");
    expect(trumpLabel("no-trump")).toBe("Sem Trunfo"); // é o que a Mesa renderiza no slot

    const mao = g.history()[h - 1];
    expect(mao.trump).toBe("no-trump");
    expect(sum(mao.handScores)).toBe(325); // 13 vazas × 25 — a mão positiva foi inteira
    expect(g.finished()).toBe(true);
    expect(sum(g.cumulative())).toBe(0);
  });
});
