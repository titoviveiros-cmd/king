// Máquina de estado da partida KING — 100% simulável por código, sem renderizar tela.
// Autoridade única sobre distribuição, vazas, turnos, trunfo e pontuação (multiplayer-first).
import type { Card } from "./cards.js";
import { createRng, deal, makeDeck, sameCard, shuffle } from "./cards.js";
import {
  HAND_CONTRACTS,
  trumpChooserFor,
  scoreHand,
  type CompletedTrick,
  type ContractDef,
  type ContractKind,
  type PlayedCard,
  type Seat,
  type Trump,
} from "./contracts.js";
import { getLegalCards, resolveTrick } from "./rules.js";

export interface HandState {
  handNumber: number;
  contract: ContractDef;
  dealer: Seat;
  trump: Trump | null;
  awaitingTrumpFrom: Seat | null;
  /** Mãos completas (informação privada do servidor — nunca enviar inteira ao cliente). */
  hands: Card[][];
  /** Público: quantas cartas cada assento ainda tem. */
  handCounts: number[];
  currentTrick: PlayedCard[];
  trickLeader: Seat;
  trickNumber: number; // 1..13
  completedTricks: CompletedTrick[];
  turn: Seat | null; // null enquanto aguarda trunfo ou mão encerrada
  handScores: number[] | null;
}

export interface HandHistoryEntry {
  handNumber: number;
  kind: ContractKind;
  trump: Trump | null;
  chooser: Seat | null; // quem escolheu o trunfo (mãos positivas)
  handScores: number[];
}

export interface MatchState {
  seed: number;
  players: string[]; // ordem = assentos 0..3; players[0] é o P0
  startDealer: Seat;
  handNumber: number; // 0 antes de começar, depois 1..10
  cumulative: number[]; // saldo total por assento
  negatives: number[]; // soma dos negativos (mãos 1–6)
  positives: number[]; // soma dos positivos (mãos 7–10)
  hand: HandState | null;
  finished: boolean;
  history: HandHistoryEntry[];
}

export interface RankRow {
  seat: Seat;
  player: string;
  score: number;
  negatives: number;
  positives: number;
  position: number; // 1..4; assentos com mesma pontuação recebem a MESMA posição
  tied: boolean;
}

const nextSeat = (s: Seat): Seat => (((s + 1) % 4) as Seat);

/**
 * Cria a partida. Os 4 jogadores são sentados na ORDEM do array recebido:
 * players[0] = assento 0 = **P0**, players[1] = P1, etc. Essa ordem é determinística e
 * definida pela camada que cria a partida (servidor/matchmaking; fixa em solo com bots).
 * O dealer inicial é P0; a rotação de dealer e a de trunfo derivam disso.
 */
export function createMatch(players: string[], seed: number): MatchState {
  if (players.length !== 4) throw new Error("KING exige exatamente 4 jogadores");
  return {
    seed: seed >>> 0,
    players: players.slice(),
    startDealer: 0,
    handNumber: 0,
    cumulative: [0, 0, 0, 0],
    negatives: [0, 0, 0, 0],
    positives: [0, 0, 0, 0],
    hand: null,
    finished: false,
    history: [],
  };
}

/** Inicia a próxima mão (1..10): embaralha de forma determinística e distribui 13 cartas. */
export function startNextHand(m: MatchState): void {
  if (m.finished) throw new Error("Partida encerrada");
  if (m.hand && m.hand.handScores === null) throw new Error("Mão em andamento");
  const hn = m.handNumber + 1;
  if (hn > 10) throw new Error("Todas as 10 mãos já foram jogadas");

  const contract = HAND_CONTRACTS[hn];
  const dealer: Seat = (((m.startDealer + (hn - 1)) % 4) as Seat);
  // Semente por mão: determinística e reproduzível (essencial para testes e autoridade).
  const rng = createRng((m.seed ^ Math.imul(hn, 0x9e3779b1)) >>> 0);
  const deck = shuffle(makeDeck(), rng);
  const { hands } = deal(deck, 4, 13);

  const leader: Seat = (((dealer + 1) % 4) as Seat); // abre a 1ª vaza quem está à esquerda do dealer

  const hand: HandState = {
    handNumber: hn,
    contract,
    dealer,
    trump: null,
    awaitingTrumpFrom: contract.isPositive ? trumpChooserFor(hn) : null,
    hands,
    handCounts: hands.map((h) => h.length),
    currentTrick: [],
    trickLeader: leader,
    trickNumber: 1,
    completedTricks: [],
    turn: contract.isPositive ? null : leader, // positiva: espera trunfo antes de jogar
    handScores: null,
  };

  m.hand = hand;
  m.handNumber = hn;
}

/** Define o trunfo da mão positiva (só o assento sorteado pela rotação pode escolher). */
export function selectTrump(m: MatchState, seat: Seat, trump: Trump): void {
  const h = m.hand;
  if (!h) throw new Error("Nenhuma mão ativa");
  if (h.awaitingTrumpFrom === null) throw new Error("Esta mão não aguarda escolha de trunfo");
  if (seat !== h.awaitingTrumpFrom) throw new Error("Este jogador não escolhe o trunfo nesta mão");
  h.trump = trump;
  h.awaitingTrumpFrom = null;
  h.turn = h.trickLeader;
}

/** Cartas legais para um assento (só retorna algo se for a vez dele). */
export function legalCardsFor(m: MatchState, seat: Seat): Card[] {
  const h = m.hand;
  if (!h || h.turn !== seat) return [];
  return getLegalCards(h.hands[seat], h.currentTrick, h.contract);
}

/** Joga uma carta. Valida tudo (autoridade). Lança erro em jogada ilegal — nunca corrige em silêncio. */
export function playCard(m: MatchState, seat: Seat, card: Card): void {
  const h = m.hand;
  if (!h) throw new Error("Nenhuma mão ativa");
  if (h.handScores !== null) throw new Error("Mão já encerrada");
  if (h.awaitingTrumpFrom !== null) throw new Error("Aguardando escolha de trunfo");
  if (h.turn === null) throw new Error("Não há turno ativo");
  if (seat !== h.turn) throw new Error(`Não é a vez do assento ${seat}`);

  const legal = getLegalCards(h.hands[seat], h.currentTrick, h.contract);
  if (!legal.some((c) => sameCard(c, card))) throw new Error("Jogada ilegal");

  // Remove a carta da mão do jogador.
  const idx = h.hands[seat].findIndex((c) => sameCard(c, card));
  h.hands[seat].splice(idx, 1);
  h.handCounts[seat] = h.hands[seat].length;
  h.currentTrick.push({ seat, card });

  if (h.currentTrick.length < 4) {
    h.turn = nextSeat(seat);
    return;
  }

  // Vaza completa: resolve, registra e avança.
  const winner = resolveTrick(h.currentTrick, h.trump);
  h.completedTricks.push({
    number: h.trickNumber,
    leader: h.trickLeader,
    cards: h.currentTrick.slice(),
    winner,
  });
  h.currentTrick = [];

  if (h.trickNumber === 13) {
    endHand(m);
  } else {
    h.trickNumber += 1;
    h.trickLeader = winner;
    h.turn = winner; // quem vence abre a próxima vaza
  }
}

function endHand(m: MatchState): void {
  const h = m.hand!;
  const scores = scoreHand(h.contract.kind, h.completedTricks);
  h.handScores = scores;
  h.turn = null;

  for (let i = 0; i < 4; i++) {
    m.cumulative[i] += scores[i];
    if (h.contract.isPositive) m.positives[i] += scores[i];
    else m.negatives[i] += scores[i];
  }
  m.history.push({
    handNumber: h.handNumber,
    kind: h.contract.kind,
    trump: h.trump,
    chooser: h.contract.isPositive ? trumpChooserFor(h.handNumber) : null,
    handScores: scores,
  });

  if (h.handNumber === 10) m.finished = true;
}

/** Ranking final/parcial. Empate na pontuação => MESMA posição (não inventamos desempate). */
export function rankings(m: MatchState): RankRow[] {
  const rows = [0, 1, 2, 3].map((seat) => ({
    seat: seat as Seat,
    player: m.players[seat],
    score: m.cumulative[seat],
    negatives: m.negatives[seat],
    positives: m.positives[seat],
    position: 1,
    tied: false,
  }));
  rows.sort((a, b) => b.score - a.score);
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && rows[i].score === rows[i - 1].score) {
      rows[i].position = rows[i - 1].position;
    } else {
      rows[i].position = i + 1;
    }
  }
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(r.position, (counts.get(r.position) ?? 0) + 1);
  for (const r of rows) r.tied = (counts.get(r.position) ?? 0) > 1;
  return rows;
}

/** Assentos campeões (mais de um em caso de empate — registrado como empate). */
export function matchWinners(m: MatchState): Seat[] {
  const max = Math.max(...m.cumulative);
  return [0, 1, 2, 3].filter((s) => m.cumulative[s] === max) as Seat[];
}

/**
 * Visão pública para um assento — o que o cliente PODE receber (informação oculta, seção 38).
 * Nunca inclui as mãos dos adversários; só a própria mão, contagens e o que já é público.
 */
export function publicView(m: MatchState, seat: Seat) {
  const h = m.hand;
  return {
    handNumber: m.handNumber,
    finished: m.finished,
    cumulative: m.cumulative.slice(),
    yourSeat: seat,
    contract: h ? { hand: h.handNumber, kind: h.contract.kind, label: h.contract.label } : null,
    trump: h ? h.trump : null,
    awaitingTrumpFrom: h ? h.awaitingTrumpFrom : null,
    turn: h ? h.turn : null,
    trickNumber: h ? h.trickNumber : null,
    currentTrick: h ? h.currentTrick.slice() : [],
    handCounts: h ? h.handCounts.slice() : [0, 0, 0, 0],
    yourHand: h ? h.hands[seat].slice() : [],
    yourLegalCards: legalCardsFor(m, seat),
  };
}
