// FRONTEIRA ANTI-CHEAT do Bot Normal (ETAPA 1).
//
// Um bot só pode decidir a partir do que um JOGADOR HUMANO ATENTO conheceria. Este módulo é a
// ÚNICA ponte entre o `MatchState` (que carrega informação privada — mãos alheias, ordem interna)
// e a decisão do bot. `buildBotView` projeta um objeto **público e sanitizado** (`BotView`); a
// futura função de escolha terá a assinatura `chooseNormalCard(view: BotView): Card` — nunca
// `(m: MatchState, seat)`. Assim é **estruturalmente impossível** (por tipagem) o bot ler o que é
// oculto: mãos adversárias, baralho restante, cartas futuras e o próprio `MatchState` não existem
// dentro de `BotView`.
//
// Puro e determinístico: nenhuma aleatoriedade; qualquer ordenação usa ordem CANÔNICA explícita
// (nunca a ordem incidental de Set/Map/propriedades).
import type { Card, Suit } from "./cards.js";
import { SUITS } from "./cards.js";
import type { ContractKind, PlayedCard, Seat, Trump } from "./contracts.js";
import { legalCardsFor, type MatchState } from "./match.js";

/** Uma carta jogada publicamente: quem jogou e qual carta (sem nada privado). */
export interface PublicPlay {
  seat: Seat;
  card: Card;
}

/** Uma vaza anterior, 100% pública: número, quem abriu, quem venceu e as 4 cartas na ordem de jogo. */
export interface PublicTrick {
  number: number;
  leader: Seat;
  winner: Seat;
  /** Ordem de jogo; `plays[0]` é a carta que ABRIU a vaza (define o naipe puxado). */
  plays: PublicPlay[];
}

/** Só a parte pública do contrato da mão (o que qualquer jogador sabe). */
export interface PublicContract {
  kind: ContractKind;
  isPositive: boolean;
  /** Proibido abrir Copas tendo outro naipe (mãos 2 e 5). */
  noLeadHearts: boolean;
}

/**
 * Visão PÚBLICA e sanitizada entregue ao bot — o teto do que ele pode saber.
 * Contém a própria mão (legítima) e apenas informação pública; NUNCA mãos alheias, baralho oculto,
 * cartas futuras, `legalCards` de outros ou referência ao `MatchState`.
 */
export interface BotView {
  /** Assento do próprio bot. */
  seat: Seat;
  /** Própria mão (cópia — mutar não afeta o motor). */
  hand: Card[];
  /** Jogadas legais próprias (autoridade do motor). Vazio se não for a vez do bot. */
  legalCards: Card[];
  contract: PublicContract;
  handNumber: number;
  trickNumber: number;
  dealer: Seat;
  /** Quem abriu a vaza atual (público). */
  leader: Seat;
  /** Trunfo confirmado (só nas positivas); `null` caso contrário. */
  trump: Trump | null;
  /** De quem é a vez (público). */
  turn: Seat | null;
  /** Cartas já jogadas na vaza atual, na ordem (sanitizado). */
  currentTrick: PublicPlay[];
  /** Histórico público das vazas anteriores da mão (sanitizado). */
  completedTricks: PublicTrick[];
  /** Cartas restantes por assento (contagem pública). */
  handCounts: number[];
  /** Pontuações públicas (cumulativo consolidado por assento). */
  scores: number[];
  /** Por assento: naipes em que está COMPROVADAMENTE void, deduzido só de jogadas públicas. Ordem canônica. */
  voids: Suit[][];
}

const copyCard = (c: Card): Card => ({ suit: c.suit, rank: c.rank });
const copyPlays = (plays: readonly PlayedCard[]): PublicPlay[] =>
  plays.map((p) => ({ seat: p.seat, card: copyCard(p.card) }));

/**
 * Dedução de void SÓ a partir de jogadas públicas.
 *
 * Regra do KING (garantida por `getLegalCards`): um jogador é OBRIGADO a servir o naipe puxado se
 * o tiver. Logo, **jogar fora do naipe puxado ⟺ não ter aquele naipe** — a única dedução legítima
 * e sempre verdadeira. Nunca se deduz void por "uma carta apareceu/sumiu": olha-se apenas quem
 * deixou de servir o naipe puxado numa vaza pública. O primeiro a jogar (leader) define o naipe e
 * nunca gera dedução. Saída ordenada por `SUITS` (canônica) — sem depender de ordem de Set.
 */
export function deduceVoids(tricks: readonly PublicPlay[][]): Suit[][] {
  const known: Array<Set<Suit>> = [new Set(), new Set(), new Set(), new Set()];
  for (const plays of tricks) {
    if (plays.length === 0) continue;
    const led = plays[0].card.suit;
    for (let i = 1; i < plays.length; i++) {
      if (plays[i].card.suit !== led) known[plays[i].seat].add(led);
    }
  }
  return known.map((set) => SUITS.filter((s) => set.has(s)));
}

/**
 * Projeta a visão pública do bot a partir do estado autoritativo. É a ÚNICA função que toca o
 * `MatchState`; tudo que devolve é cópia sanitizada de dados públicos + a própria mão. O objeto
 * resultante não guarda referência ao motor nem a mãos ocultas.
 */
export function buildBotView(m: MatchState, seat: Seat): BotView {
  const h = m.hand;
  if (!h) throw new Error("buildBotView: nenhuma mão ativa");

  const completedTricks: PublicTrick[] = h.completedTricks.map((t) => ({
    number: t.number,
    leader: t.leader,
    winner: t.winner,
    plays: copyPlays(t.cards),
  }));
  const currentTrick = copyPlays(h.currentTrick);

  // vazas para dedução de void: as anteriores + a atual (se já tem cartas)
  const trickPlayArrays: PublicPlay[][] = completedTricks.map((t) => t.plays);
  if (currentTrick.length > 0) trickPlayArrays.push(currentTrick);

  return {
    seat,
    hand: h.hands[seat].map(copyCard),
    legalCards: legalCardsFor(m, seat).map(copyCard),
    contract: {
      kind: h.contract.kind,
      isPositive: h.contract.isPositive,
      noLeadHearts: h.contract.noLeadHearts,
    },
    handNumber: h.handNumber,
    trickNumber: h.trickNumber,
    dealer: h.dealer,
    leader: h.trickLeader,
    trump: h.trump,
    turn: h.turn,
    currentTrick,
    completedTricks,
    handCounts: h.handCounts.slice(),
    scores: m.cumulative.slice(),
    voids: deduceVoids(trickPlayArrays),
  };
}
