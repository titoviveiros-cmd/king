// QUEM CAPTUROU O K♥ — prova de que o HISTÓRICO do motor identifica o capturador em todas as condições.
//
// O fato vira XP, então não basta "o destaque do Placar costuma acertar": aqui se compara, partida a
// partida, o que `capturadorDoRei` lê do histórico com o que de fato aconteceu NA MESA — o vencedor da
// vaza que contém o K♥, observado jogada a jogada. Inclui o K♥ na ÚLTIMA vaza (13ª), montado à mão,
// partida incompleta (sem fato) e histórico adulterado (sem fato).
import { describe, expect, it } from "vitest";
import {
  createMatch, createRng, isKingOfHearts, legalCardsFor, matchStats, playCard, selectTrump, simulateHand, startNextHand,
  chooseTrumpByMajority, type Card, type MatchState, type Rank, type Seat, type Suit,
} from "@king/engine";
import { capturadorDoRei } from "./capturaDoRei.js";

const JOGADORES = ["a", "b", "c", "d"];

/** O vencedor da vaza do K♥ na mão em curso, se ele já caiu. */
function vazaDoRei(m: MatchState): { winner: Seat; number: number; dono: Seat } | null {
  for (const t of m.hand?.completedTricks ?? []) {
    const p = t.cards.find((x) => isKingOfHearts(x.card));
    if (p) return { winner: t.winner, number: t.number, dono: p.seat };
  }
  return null;
}

/** Joga a mão em curso com cartas legais sorteadas, devolvendo o que se viu do K♥ (só na mão 5). */
function jogarMao(m: MatchState, rng: () => number): ReturnType<typeof vazaDoRei> {
  const h = m.hand!;
  if (h.awaitingTrumpFrom !== null) selectTrump(m, h.awaitingTrumpFrom, chooseTrumpByMajority(h.hands[h.awaitingTrumpFrom]));
  let visto: ReturnType<typeof vazaDoRei> = null;
  while (m.hand!.handScores === null) {
    const seat = m.hand!.turn as Seat;
    const legais = legalCardsFor(m, seat);
    playCard(m, seat, legais[Math.floor(rng() * legais.length)]);
    if (m.hand!.handNumber === 5) visto = vazaDoRei(m) ?? visto;
  }
  return visto;
}

describe("capturadorDoRei: o histórico do motor × o que aconteceu na mesa", () => {
  it("300 partidas sorteadas: SEMPRE o vencedor da vaza do K♥ — seja ele o dono da carta ou outro assento", () => {
    const vazas = new Set<number>();
    let doProprioDono = 0;
    let deOutro = 0;
    const porAssento = [0, 0, 0, 0];
    for (let semente = 1; semente <= 300; semente++) {
      const m = createMatch(JOGADORES, semente);
      const rng = createRng(semente * 7919);
      let visto: ReturnType<typeof vazaDoRei> = null;
      while (!m.finished) {
        startNextHand(m);
        const v = jogarMao(m, rng);
        if (m.handNumber === 5) {
          visto = v;
          // ainda no fim da MÃO 5 (antes da 6): o fato já é estabelecido
          expect(capturadorDoRei(m)).toBe(v!.winner);
        }
      }
      expect(visto).not.toBeNull();
      expect(capturadorDoRei(m)).toBe(visto!.winner);
      expect(matchStats(m).kingTaker).toBe(visto!.winner); // a mesma fonte do destaque do Placar
      vazas.add(visto!.number);
      porAssento[visto!.winner] += 1;
      if (visto!.dono === visto!.winner) doProprioDono += 1; else deOutro += 1;
    }
    // a amostra cobre de verdade: vazas variadas, os quatro assentos, os dois jeitos de capturar
    expect(vazas.size).toBeGreaterThanOrEqual(6);
    expect(porAssento.every((n) => n > 0)).toBe(true);
    expect(doProprioDono).toBeGreaterThan(0);
    expect(deOutro).toBeGreaterThan(0);
  });

  it("K♥ na ÚLTIMA vaza (13ª): o capturador é quem a levou, não quem segurou a carta", () => {
    const m = createMatch(JOGADORES, 42);
    const rng = createRng(4242);
    for (let i = 1; i <= 4; i++) { startNextHand(m); simulateHand(m, rng); }
    startNextHand(m);
    expect(m.hand!.handNumber).toBe(5);
    // Mão montada: o assento 0 tem 12 espadas (A..3) e o K♥; o 1 tem o 2♠ e 12 copas (com o A♥); o 2,
    // só ouros; o 3, só paus. O 0 puxa espadas e leva as 12 primeiras vazas; o 1 guarda o A♥ até o fim.
    const naipe = (s: Suit, ranks: Rank[]): Card[] => ranks.map((rank) => ({ suit: s, rank }));
    const TODOS: Rank[] = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
    m.hand!.hands = [
      [...naipe("spades", TODOS.slice(0, 12)), { suit: "hearts", rank: "K" }],
      [{ suit: "spades", rank: "2" }, ...naipe("hearts", TODOS.filter((r) => r !== "K"))],
      naipe("diamonds", TODOS),
      naipe("clubs", TODOS),
    ];
    m.hand!.handCounts = [13, 13, 13, 13];
    m.hand!.trickLeader = 0;
    m.hand!.turn = 0;
    const escolher = (seat: Seat): Card => {
      const legais = legalCardsFor(m, seat);
      // o 1 descarta copas BAIXAS e guarda o A♥ para a última vaza
      const ordenadas = [...legais].sort((a, b) => (a.rank === "A" ? 1 : 0) - (b.rank === "A" ? 1 : 0));
      return ordenadas[0];
    };
    while (m.hand!.handScores === null) {
      const seat = m.hand!.turn as Seat;
      const carta = escolher(seat);
      expect(legalCardsFor(m, seat)).toContainEqual(carta);
      playCard(m, seat, carta);
    }
    const v = vazaDoRei(m)!;
    expect(v.number).toBe(13);
    expect(v.dono).toBe(0);
    expect(v.winner).toBe(1);
    expect(capturadorDoRei(m)).toBe(1);
    while (!m.finished) { startNextHand(m); simulateHand(m, rng); }
    expect(capturadorDoRei(m)).toBe(1);
  });

  it("partida INCOMPLETA não tem fato: antes da mão 5, e com a mão 5 ainda em jogo", () => {
    const m = createMatch(JOGADORES, 7);
    const rng = createRng(77);
    expect(capturadorDoRei(m)).toBeNull();
    for (let i = 1; i <= 4; i++) { startNextHand(m); simulateHand(m, rng); expect(capturadorDoRei(m)).toBeNull(); }
    startNextHand(m);
    // a mão 5 em andamento: nenhuma carta do histórico ainda
    const seat = m.hand!.turn as Seat;
    playCard(m, seat, legalCardsFor(m, seat)[0]);
    expect(capturadorDoRei(m)).toBeNull();
  });

  it("histórico que não é inequívoco não vira fato (dois assentos pontuando, valor errado, mão 5 repetida)", () => {
    const m = createMatch(JOGADORES, 9);
    const rng = createRng(99);
    while (!m.finished) { startNextHand(m); simulateHand(m, rng); }
    const quem = capturadorDoRei(m)!;
    expect(quem).not.toBeNull();
    const mao5 = m.history.find((h) => h.kind === "no-king")!;
    const original = [...mao5.handScores];
    mao5.handScores = original.map((p, i) => (i === (quem + 1) % 4 ? -160 : p));
    expect(capturadorDoRei(m)).toBeNull();
    mao5.handScores = original.map((p) => (p === -160 ? -150 : p));
    expect(capturadorDoRei(m)).toBeNull();
    mao5.handScores = original;
    m.history.push({ ...mao5 });
    expect(capturadorDoRei(m)).toBeNull();
    m.history.pop();
    expect(capturadorDoRei(m)).toBe(quem);
  });
});
