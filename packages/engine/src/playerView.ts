// FRONTEIRA DE REDAÇÃO — a ÚNICA porta pela qual o estado sai do servidor (Multiplayer, Fase 1).
//
// O servidor é dono do `MatchState` completo. Antes de enviar qualquer coisa a um cliente, o
// estado passa por `redactFor(m, seat)`, que devolve um `PlayerView`: **a mesma forma do
// `MatchState`**, porém sem nada que aquele assento não tenha o direito de saber.
//
// POR QUE A MESMA FORMA, E NÃO UM DTO NOVO
// Todas as funções derivadas do motor — `rankings`, `handSummary`, `handBreakdown`, `matchStats`,
// `liveScores`, `publicView`, `buildBotView` — leem só campos públicos + a própria mão. Mantendo a
// forma, elas rodam sobre a visão redigida **sem uma linha de adaptação**, e a apresentação já
// validada (Mesa, Placares, áudio, timings) não precisa ser reescrita. Os testes
// `playerView.test.ts` provam essa equivalência função a função — é o que garante que não existe
// (nem é preciso) uma segunda fonte de redação no projeto.
//
// GARANTIA POR TIPAGEM
// `PlayerView` é `MatchState` **mais** a marca `redactedFor`. Um `MatchState` cru NÃO é atribuível
// a `PlayerView`, então uma função de envio declarada como `send(view: PlayerView)` **não compila**
// se alguém tentar mandar o estado completo. O único jeito de obter um `PlayerView` é passar por
// aqui. O caminho inverso é livre: `PlayerView` É um `MatchState`, então todo o motor o aceita.
//
// GARANTIA POR CONSTRUÇÃO
// A cópia abaixo é escrita **campo a campo**, deliberadamente. Se um dia alguém acrescentar um
// campo privado ao `MatchState`, este arquivo **para de compilar** — o campo novo não vaza em
// silêncio; alguém tem que decidir, aqui, se ele é público.
//
// Puro e determinístico: sem aleatoriedade, sem relógio, sem I/O. Cópia profunda — a visão nunca
// compartilha referência com o estado vivo do servidor.
import type { Card } from "./cards.js";
import type { CompletedTrick, ContractDef, PlayedCard, Seat } from "./contracts.js";
import type { HandHistoryEntry, HandState, MatchState } from "./match.js";

/**
 * Visão de UM assento. Tem a forma de `MatchState`, mas só carrega o que aquele assento pode ver.
 * `redactedFor` é ao mesmo tempo a marca de tipo (impede enviar estado cru) e um dado útil ao
 * cliente: o assento a que a visão pertence.
 */
export type PlayerView = MatchState & { readonly redactedFor: Seat };

const copyCard = (c: Card): Card => ({ suit: c.suit, rank: c.rank });
const copyPlay = (p: PlayedCard): PlayedCard => ({ seat: p.seat, card: copyCard(p.card) });
const copyTrick = (t: CompletedTrick): CompletedTrick => ({
  number: t.number,
  leader: t.leader,
  cards: t.cards.map(copyPlay),
  winner: t.winner,
});
const copyContract = (c: ContractDef): ContractDef => ({
  hand: c.hand,
  kind: c.kind,
  label: c.label,
  noLeadHearts: c.noLeadHearts,
  isPositive: c.isPositive,
  handTotal: c.handTotal,
});
const copyHistory = (e: HandHistoryEntry): HandHistoryEntry => ({
  handNumber: e.handNumber,
  kind: e.kind,
  trump: e.trump,
  chooser: e.chooser,
  handScores: e.handScores.slice(),
});

/**
 * Redige a mão em curso. **Único campo privado do `HandState` é `hands`**: o assento dono recebe
 * as próprias cartas; os demais recebem array vazio. `handCounts` continua verdadeiro — quantas
 * cartas cada um tem é informação pública na mesa, e é dele que a UI desenha os versos.
 */
function redactHand(h: HandState, seat: Seat): HandState {
  return {
    handNumber: h.handNumber,
    contract: copyContract(h.contract),
    dealer: h.dealer,
    trump: h.trump,
    awaitingTrumpFrom: h.awaitingTrumpFrom,
    hands: h.hands.map((cartas, s) => (s === seat ? cartas.map(copyCard) : [])),
    handCounts: h.handCounts.slice(),
    currentTrick: h.currentTrick.map(copyPlay),
    trickLeader: h.trickLeader,
    trickNumber: h.trickNumber,
    completedTricks: h.completedTricks.map(copyTrick),
    turn: h.turn,
    handScores: h.handScores === null ? null : h.handScores.slice(),
  };
}

/**
 * Projeta a visão de um assento a partir do estado autoritativo.
 *
 * DOIS campos são redigidos, e o segundo é o menos óbvio dos dois:
 *
 * 1. `hand.hands[outro]` — as cartas alheias, o caso evidente.
 * 2. `seed` — **a semente reconstrói o baralho inteiro**. `startNextHand` deriva a distribuição de
 *    `createRng(seed ^ hash(mão))`, então quem tem a semente recalcula as quatro mãos de todas as
 *    dez mãos da partida. Enviá-la seria entregar o jogo aberto sem que nenhuma carta aparecesse
 *    no pacote — um vazamento que um teste ingênuo de "procurar objetos carta" não pegaria.
 *    O servidor guarda a semente; o cliente nunca precisa dela (quem distribui é o servidor).
 */
export function redactFor(m: MatchState, seat: Seat): PlayerView {
  return {
    redactedFor: seat,
    seed: 0, // REDIGIDO — ver nota 2 acima
    players: m.players.slice(),
    startDealer: m.startDealer,
    handNumber: m.handNumber,
    cumulative: m.cumulative.slice(),
    negatives: m.negatives.slice(),
    positives: m.positives.slice(),
    hand: m.hand === null ? null : redactHand(m.hand, seat),
    finished: m.finished,
    history: m.history.map(copyHistory),
  };
}
