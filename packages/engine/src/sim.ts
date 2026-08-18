// Driver de simulação: joga cartas legais de forma determinística (semente) para exercitar
// o motor de ponta a ponta. Base para a "Fase 3 — Bot Simulation" e para os testes de checksum.
// NÃO é o bot final do jogo (esse considera o contrato e evita penalidades); aqui só validamos
// que o motor conduz uma partida completa sem estados inválidos.
import type { Suit } from "./cards.js";
import { SUITS } from "./cards.js";
import type { Seat, Trump } from "./contracts.js";
import {
  legalCardsFor,
  playCard,
  selectTrump,
  startNextHand,
  type MatchState,
} from "./match.js";

/** Escolhe como trunfo o naipe mais numeroso da mão do escolhedor (desempate: ordem canônica). */
export function chooseTrumpByMajority(hand: { suit: Suit }[]): Trump {
  const count: Record<Suit, number> = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  for (const c of hand) count[c.suit]++;
  let best: Suit = SUITS[0];
  for (const s of SUITS) if (count[s] > count[best]) best = s;
  return best;
}

/** Joga uma mão inteira até o fim, com jogadas legais pseudoaleatórias. */
export function simulateHand(m: MatchState, rng: () => number): void {
  const h = m.hand;
  if (!h) throw new Error("Nenhuma mão ativa para simular");

  // Escolha de trunfo (mãos positivas).
  if (h.awaitingTrumpFrom !== null) {
    const chooser = h.awaitingTrumpFrom;
    selectTrump(m, chooser, chooseTrumpByMajority(h.hands[chooser]));
  }

  let guard = 0;
  while (m.hand && m.hand.handScores === null) {
    const seat = m.hand.turn;
    if (seat === null) throw new Error("Turno nulo com mão em andamento");
    const legal = legalCardsFor(m, seat as Seat);
    if (legal.length === 0) throw new Error(`Sem cartas legais para o assento ${seat}`);
    const pick = legal[Math.floor(rng() * legal.length)];
    playCard(m, seat as Seat, pick);
    if (++guard > 100) throw new Error("Loop de segurança: mão não terminou em 52 jogadas");
  }
}

/** Joga a partida inteira (10 mãos) do estado atual até o fim. */
export function simulateMatch(m: MatchState, rng: () => number): void {
  while (!m.finished) {
    startNextHand(m);
    simulateHand(m, rng);
  }
}
