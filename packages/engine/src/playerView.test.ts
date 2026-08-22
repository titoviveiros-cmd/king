// TESTES DE VAZAMENTO da fronteira de redação (Multiplayer, Fase 1).
//
// O teste central NÃO se contenta em verificar que sumiu uma propriedade chamada `hands`. Ele
// **varre a estrutura serializada** — exatamente o que iria pelo fio — recolhe TODO objeto com
// forma de carta em qualquer profundidade, e exige que cada carta encontrada seja (a) do próprio
// assento ou (b) já pública na mesa. Qualquer campo novo que carregue carta alheia, com qualquer
// nome, em qualquer nível de aninhamento, quebra este teste.
import { describe, it, expect } from "vitest";
import type { Card, Rank, Suit } from "./cards.js";
import { createRng, deal, makeDeck, shuffle } from "./cards.js";
import type { Seat } from "./contracts.js";
import {
  createMatch, legalCardsFor, liveScores, playCard, publicView, rankings, selectTrump,
  startNextHand, handSummary, type MatchState,
} from "./match.js";
import { chooseTrumpByMajority } from "./sim.js";
import { buildBotView } from "./botView.js";
import { matchStats } from "./stats.js";
import { redactFor, type PlayerView } from "./playerView.js";

const P = ["P0", "P1", "P2", "P3"];
const SEATS: Seat[] = [0, 1, 2, 3];
const id = (c: Card) => `${c.rank}${c.suit[0]}`;
const ids = (cs: readonly Card[]) => cs.map(id);

// ───────────────────────── varredura estrutural ─────────────────────────

/** Recolhe TODA carta ({suit, rank}) em qualquer profundidade da estrutura. */
function cartasEm(x: unknown, achadas: Card[] = []): Card[] {
  if (x === null || typeof x !== "object") return achadas;
  if (Array.isArray(x)) {
    for (const item of x) cartasEm(item, achadas);
    return achadas;
  }
  const o = x as Record<string, unknown>;
  if (typeof o.suit === "string" && typeof o.rank === "string") {
    achadas.push({ suit: o.suit as Suit, rank: o.rank as Rank });
    return achadas;
  }
  for (const v of Object.values(o)) cartasEm(v, achadas);
  return achadas;
}

/** Cartas que QUALQUER jogador na mesa já viu (jogadas publicamente). */
function cartasPublicas(m: MatchState): Set<string> {
  const s = new Set<string>();
  const h = m.hand;
  if (!h) return s;
  for (const t of h.completedTricks) for (const p of t.cards) s.add(id(p.card));
  for (const p of h.currentTrick) s.add(id(p.card));
  return s;
}

/**
 * A asserção que importa: na visão de `seat`, toda carta serializada é própria ou pública —
 * e nenhuma carta ainda oculta de outro assento aparece em lugar algum.
 */
function exigirSemVazamento(m: MatchState, seat: Seat): void {
  const view = redactFor(m, seat);
  const naRede = JSON.parse(JSON.stringify(view)) as unknown; // o que iria pelo fio
  const encontradas = new Set(cartasEm(naRede).map(id));

  const proprias = new Set(m.hand ? ids(m.hand.hands[seat]) : []);
  const publicas = cartasPublicas(m);

  for (const c of encontradas) {
    expect(
      proprias.has(c) || publicas.has(c),
      `VAZAMENTO: carta ${c} apareceu na visão do assento ${seat} sem ser própria nem pública`,
    ).toBe(true);
  }

  // e o caminho inverso: nenhuma carta OCULTA de outro assento está presente
  if (m.hand) {
    for (const outro of SEATS) {
      if (outro === seat) continue;
      for (const c of m.hand.hands[outro]) {
        expect(
          encontradas.has(id(c)),
          `VAZAMENTO: carta ${id(c)} do assento ${outro} apareceu na visão do assento ${seat}`,
        ).toBe(false);
      }
    }
  }
}

// ───────────────────────── cenários ─────────────────────────

function resolverTrunfo(m: MatchState): void {
  const h = m.hand;
  if (h && h.awaitingTrumpFrom !== null) {
    selectTrump(m, h.awaitingTrumpFrom, chooseTrumpByMajority(h.hands[h.awaitingTrumpFrom]));
  }
}

/** Joga N cartas legais (a primeira legal), respeitando a escolha de trunfo. */
function jogar(m: MatchState, n: number): void {
  resolverTrunfo(m);
  for (let i = 0; i < n; i++) {
    if (!m.hand || m.hand.handScores !== null) return;
    const s = m.hand.turn as Seat;
    playCard(m, s, legalCardsFor(m, s)[0]);
  }
}

function completarMao(m: MatchState): void {
  resolverTrunfo(m);
  let guard = 0;
  while (m.hand && m.hand.handScores === null) {
    if (++guard > 200) throw new Error("loop de segurança");
    const s = m.hand.turn as Seat;
    playCard(m, s, legalCardsFor(m, s)[0]);
  }
}

/** Leva a partida até o início da mão `alvo` (1..10), sem jogar nenhuma carta dessa mão. */
function irAteMao(m: MatchState, alvo: number): void {
  while (m.handNumber < alvo) {
    if (m.hand && m.hand.handScores === null) completarMao(m);
    if (m.handNumber < alvo) startNextHand(m);
  }
}

interface Cenario { nome: string; montar: (seed: number) => MatchState }

const CENARIOS: Cenario[] = [
  {
    nome: "antes de começar (nenhuma mão distribuída)",
    montar: (seed) => createMatch(P, seed),
  },
  {
    nome: "estado inicial da mão 1 (13 cartas, nada jogado)",
    montar: (seed) => { const m = createMatch(P, seed); startNextHand(m); return m; },
  },
  {
    nome: "vaza em andamento (2 cartas na mesa)",
    montar: (seed) => { const m = createMatch(P, seed); startNextHand(m); jogar(m, 2); return m; },
  },
  {
    nome: "meio de mão (várias vazas resolvidas)",
    montar: (seed) => { const m = createMatch(P, seed); startNextHand(m); jogar(m, 22); return m; },
  },
  {
    nome: "mão encerrada (handScores preenchido)",
    montar: (seed) => { const m = createMatch(P, seed); startNextHand(m); completarMao(m); return m; },
  },
  {
    nome: "positiva aguardando trunfo (mão 7)",
    montar: (seed) => { const m = createMatch(P, seed); irAteMao(m, 7); return m; },
  },
  {
    nome: "positiva com trunfo escolhido, vaza em andamento",
    montar: (seed) => { const m = createMatch(P, seed); irAteMao(m, 7); jogar(m, 3); return m; },
  },
  {
    nome: "partida encerrada (10 mãos)",
    montar: (seed) => { const m = createMatch(P, seed); irAteMao(m, 10); completarMao(m); return m; },
  },
];

const SEEDS = [1, 7, 42, 12345];

// ═══════════════════════════ VAZAMENTO ═══════════════════════════

describe("vazamento — varredura da estrutura serializada", () => {
  for (const c of CENARIOS) {
    it(`${c.nome}: nenhuma carta alheia em nenhum assento, em ${SEEDS.length} sementes`, () => {
      for (const seed of SEEDS) {
        for (const seat of SEATS) {
          exigirSemVazamento(c.montar(seed), seat);
        }
      }
    });
  }
});

describe("vazamento — o caso explícito pedido na auditoria", () => {
  it("a visão do assento 0 contém a mão 0 e NÃO contém as mãos 1, 2 e 3", () => {
    const m = createMatch(P, 21);
    startNextHand(m);
    const view = redactFor(m, 0);

    expect(ids(view.hand!.hands[0])).toEqual(ids(m.hand!.hands[0]));
    expect(view.hand!.hands[0]).toHaveLength(13);
    expect(view.hand!.hands[1]).toEqual([]);
    expect(view.hand!.hands[2]).toEqual([]);
    expect(view.hand!.hands[3]).toEqual([]);

    const naRede = new Set(cartasEm(JSON.parse(JSON.stringify(view))).map(id));
    expect(naRede.size).toBe(13); // exatamente as próprias, nada além
    for (const outro of [1, 2, 3] as Seat[]) {
      for (const c of m.hand!.hands[outro]) expect(naRede.has(id(c))).toBe(false);
    }
  });

  it("vale para os quatro assentos: cada um vê 13 cartas, e são as suas", () => {
    const m = createMatch(P, 99);
    startNextHand(m);
    for (const seat of SEATS) {
      const view = redactFor(m, seat);
      expect(ids(view.hand!.hands[seat])).toEqual(ids(m.hand!.hands[seat]));
      for (const outro of SEATS) if (outro !== seat) expect(view.hand!.hands[outro]).toEqual([]);
      expect(cartasEm(JSON.parse(JSON.stringify(view)))).toHaveLength(13);
    }
  });

  it("as quatro visões juntas nunca revelam mais do que já é público", () => {
    // uma visão isolada é segura; o teste abaixo garante que também não há sobreposição indevida
    const m = createMatch(P, 7);
    startNextHand(m);
    jogar(m, 6);
    const publicas = cartasPublicas(m);
    for (const seat of SEATS) {
      const encontradas = cartasEm(JSON.parse(JSON.stringify(redactFor(m, seat)))).map(id);
      const proprias = new Set(ids(m.hand!.hands[seat]));
      for (const c of encontradas) expect(proprias.has(c) || publicas.has(c)).toBe(true);
    }
  });
});

describe("vazamento — o seed reconstrói o baralho, por isso é redigido", () => {
  it("com o seed é possível recalcular TODAS as mãos (demonstração do risco)", () => {
    const seed = 12345;
    const m = createMatch(P, seed);
    startNextHand(m);
    // exatamente o que `startNextHand` faz — qualquer cliente com o seed faria o mesmo
    const rng = createRng((seed ^ Math.imul(1, 0x9e3779b1)) >>> 0);
    const { hands } = deal(shuffle(makeDeck(), rng), 4, 13);
    for (const seat of SEATS) expect(ids(hands[seat])).toEqual(ids(m.hand!.hands[seat]));
  });

  it("a visão NÃO carrega o seed real", () => {
    for (const seed of SEEDS) {
      const m = createMatch(P, seed);
      startNextHand(m);
      for (const seat of SEATS) {
        expect(redactFor(m, seat).seed).toBe(0);
        expect(redactFor(m, seat).seed).not.toBe(m.seed);
      }
    }
  });
});

// ═══════════════════ SUFICIÊNCIA (fonte única de redação) ═══════════════════

describe("suficiência — nada a jusante precisa do estado completo", () => {
  const casos = CENARIOS.filter((c) => c.nome !== "antes de começar (nenhuma mão distribuída)");

  it("buildBotView(redigido) ≡ buildBotView(completo) — a BotView continua válida sobre a visão", () => {
    for (const c of casos) {
      const m = c.montar(42);
      if (!m.hand || m.hand.handScores !== null) continue; // buildBotView exige mão ativa
      for (const seat of SEATS) {
        expect(buildBotView(redactFor(m, seat), seat)).toEqual(buildBotView(m, seat));
      }
    }
  });

  it("publicView(redigido) ≡ publicView(completo) — publicView não depende de informação oculta", () => {
    for (const c of casos) {
      const m = c.montar(42);
      for (const seat of SEATS) {
        expect(publicView(redactFor(m, seat), seat)).toEqual(publicView(m, seat));
      }
    }
  });

  it("as funções derivadas dão o MESMO resultado sobre a visão redigida", () => {
    for (const c of casos) {
      const m = c.montar(7);
      const v = redactFor(m, 0);
      expect(rankings(v)).toEqual(rankings(m));
      expect(liveScores(v)).toEqual(liveScores(m));
      expect(matchStats(v)).toEqual(matchStats(m));
      expect(handSummary(v)).toEqual(handSummary(m));
    }
  });

  it("legalCards do próprio assento sobrevivem; os dos outros ficam vazios (correto)", () => {
    const m = createMatch(P, 3);
    startNextHand(m);
    const dono = m.hand!.turn as Seat;
    expect(ids(legalCardsFor(redactFor(m, dono), dono))).toEqual(ids(legalCardsFor(m, dono)));
    for (const outro of SEATS) {
      if (outro === dono) continue;
      expect(legalCardsFor(redactFor(m, outro), dono)).toEqual([]);
    }
  });
});

// ═══════════════════════════ ISOLAMENTO ═══════════════════════════

describe("isolamento — a visão é cópia profunda, nunca referência ao estado vivo", () => {
  it("mutar a visão não afeta o estado do servidor", () => {
    const m = createMatch(P, 5);
    startNextHand(m);
    const antes = ids(m.hand!.hands[0]);
    const view = redactFor(m, 0);
    view.hand!.hands[0].pop();
    view.hand!.hands[0][0].rank = "2";
    view.cumulative[0] = 9999;
    view.hand!.handCounts[1] = 0;
    expect(ids(m.hand!.hands[0])).toEqual(antes);
    expect(m.cumulative[0]).toBe(0);
    expect(m.hand!.handCounts[1]).toBe(13);
  });

  it("avançar o servidor não altera uma visão já emitida (snapshot congelado)", () => {
    const m = createMatch(P, 5);
    startNextHand(m);
    const snapshot = redactFor(m, 0);
    const antes = JSON.stringify(snapshot);
    jogar(m, 8);
    expect(JSON.stringify(snapshot)).toBe(antes);
  });

  it("a visão é serializável (vai pelo fio sem perder nada)", () => {
    const m = createMatch(P, 5);
    startNextHand(m);
    jogar(m, 5);
    for (const seat of SEATS) {
      const v = redactFor(m, seat);
      expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    }
  });
});

// ═══════════════════════ RECONSTRUÇÃO DA MESA ═══════════════════════

describe("suficiência para a Mesa — inclusive depois de reconectar", () => {
  it("a visão sustenta tudo que a Mesa lê, em cada momento do ciclo", () => {
    const momentos = CENARIOS.filter((c) => c.nome !== "antes de começar (nenhuma mão distribuída)");
    for (const c of momentos) {
      const m = c.montar(21);
      const v = redactFor(m, 0);
      const h = v.hand!;
      // identidade e contexto
      expect(v.redactedFor).toBe(0);
      expect(v.players).toEqual(m.players);
      expect(v.handNumber).toBe(m.handNumber);
      // contrato, trunfo, turno
      expect(h.contract).toEqual(m.hand!.contract);
      expect(h.trump).toBe(m.hand!.trump);
      expect(h.awaitingTrumpFrom).toBe(m.hand!.awaitingTrumpFrom);
      expect(h.turn).toBe(m.hand!.turn);
      // mesa: vaza atual, histórico, contagens (versos dos adversários)
      expect(h.currentTrick).toEqual(m.hand!.currentTrick);
      expect(h.completedTricks).toEqual(m.hand!.completedTricks);
      expect(h.handCounts).toEqual(m.hand!.handCounts);
      // placares
      expect(v.cumulative).toEqual(m.cumulative);
      expect(v.history).toEqual(m.history);
      expect(v.finished).toBe(m.finished);
    }
  });

  it("reconectar no meio da mão devolve exatamente o mesmo estado visível", () => {
    const m = createMatch(P, 33);
    startNextHand(m);
    jogar(m, 17);
    const durante = redactFor(m, 2);
    const aoReconectar = redactFor(m, 2); // servidor reemite o snapshot corrente
    expect(aoReconectar).toEqual(durante);
    exigirSemVazamento(m, 2);
  });

  it("handCounts continua verdadeiro mesmo com as mãos alheias vazias", () => {
    const m = createMatch(P, 8);
    startNextHand(m);
    jogar(m, 9);
    const v = redactFor(m, 1);
    expect(v.hand!.handCounts).toEqual(m.hand!.handCounts);
    for (const outro of SEATS) {
      if (outro === 1) continue;
      expect(v.hand!.hands[outro]).toEqual([]);
      expect(v.hand!.handCounts[outro]).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════ TIPAGEM ═══════════════════════════

describe("tipagem — a marca impede enviar estado cru", () => {
  it("PlayerView é aceito onde se pede MatchState (o motor continua funcionando)", () => {
    const m = createMatch(P, 4);
    startNextHand(m);
    const v: MatchState = redactFor(m, 0); // compila: PlayerView É um MatchState
    expect(v.players).toHaveLength(4);
  });

  it("só redactFor produz a marca — um MatchState cru não passa por uma porta tipada", () => {
    const m = createMatch(P, 4);
    startNextHand(m);
    const enviar = (view: PlayerView) => view.redactedFor;
    expect(enviar(redactFor(m, 3))).toBe(3);
    // @ts-expect-error — MatchState cru NÃO é PlayerView: o compilador barra o vazamento
    expect(() => enviar(m)).toBeDefined();
  });
});
