// BOT NORMAL V1 — inteligência heurística (ETAPA 2A: SÓ as 6 mãos negativas).
//
// Decide EXCLUSIVAMENTE a partir de `BotView` (projeção pública + a própria mão). NÃO importa
// `MatchState`, mãos alheias, baralho, RNG nem estado privado. Recebe `legalCards` já calculadas
// pelo motor — nunca reimplementa legalidade. Reaproveita `resolveTrick` (regra oficial pública de
// quem vence a vaza) para NÃO criar regra paralela. Puro e determinístico: sem aleatoriedade;
// empate resolvido por ordem CANÔNICA explícita.
import type { Card, Rank, Suit } from "./cards.js";
import { RANK_ORDER, RANKS, SUITS, cardId, isKingOfHearts } from "./cards.js";
import type { ContractKind, Trump } from "./contracts.js";
import { resolveTrick } from "./rules.js";
import type { BotView } from "./botView.js";

// Faixas de decisão (bem separadas para que a categoria domine o ajuste fino, sempre < 1e6):
//   SAFE  = a carta NÃO vence esta vaza (garantidamente segura).
//   RISK  = a carta assume a liderança agora mas a vitória não é certa (liderar, ou assumir sem ser
//           o último) — preferimos a mais baixa, para ser passada por cima.
//   WIN   = a carta vence com certeza (último a jogar e assume a liderança) — minimiza o capturado.
const SAFE_TIER = 3_000_000;
const RISK_TIER = 2_000_000;
const WIN_TIER = 1_000_000;

/** Penalidade OFICIAL (mesma de `scoreHand`) que capturar estas cartas custaria neste contrato. */
function trickPenalty(kind: ContractKind, cards: Card[], trickNumber: number): number {
  switch (kind) {
    case "no-tricks": return 20;
    case "no-hearts": return 20 * cards.filter((c) => c.suit === "hearts").length;
    case "no-queens": return 50 * cards.filter((c) => c.rank === "Q").length;
    case "no-men": return 30 * cards.filter((c) => c.rank === "K" || c.rank === "J").length;
    case "no-king": return cards.some(isKingOfHearts) ? 160 : 0;
    case "no-last-two": return trickNumber === 12 || trickNumber === 13 ? 90 : 0;
    default: return 0;
  }
}

/** "Passivo" de UMA carta: quanto ela pesa como carta PENALIZADA do contrato (0 se não for). */
function cardLiability(kind: ContractKind, card: Card): number {
  switch (kind) {
    case "no-hearts": return card.suit === "hearts" ? 20 : 0;
    case "no-queens": return card.rank === "Q" ? 50 : 0;
    case "no-men": return card.rank === "K" || card.rank === "J" ? 30 : 0;
    case "no-king": return isKingOfHearts(card) ? 160 : 0;
    default: return 0; // no-tricks / no-last-two: sem carta penalizada específica
  }
}

/** Esta carta assumiria a liderança da vaza NESTE instante? (regra oficial `resolveTrick`.) */
function takesLead(view: BotView, card: Card): boolean {
  const played = [...view.currentTrick, { seat: view.seat, card }];
  return resolveTrick(played, view.trump) === view.seat;
}

/** Chave canônica p/ desempate determinístico: ordem de naipe (SUITS) e depois valor. */
function canonicalKey(card: Card): number {
  return SUITS.indexOf(card.suit) * 100 + RANK_ORDER[card.rank];
}

/**
 * Score de uma carta legal numa mão NEGATIVA (maior = melhor).
 *  - Mão 6, vazas 1–9: vencer é inócuo → descarregar FORÇA (preferir a maior carta).
 *  - Demais: SAFE ≫ RISK ≫ WIN; dentro de SAFE, largar primeiro a carta penalizada de maior risco
 *    e depois a mais alta; dentro de WIN, minimizar o capturado e então largar a mais alta; dentro
 *    de RISK, preferir a mais baixa e não-penalizada.
 */
function scoreNegative(view: BotView, card: Card): number {
  const kind = view.contract.kind;
  const rank = RANK_ORDER[card.rank];

  // Mão 6 na fase inicial: descarregar cartas altas enquanto vencer não custa nada.
  if (kind === "no-last-two" && view.trickNumber <= 9) return rank;

  if (!takesLead(view, card)) {
    // SAFE — não vence a vaza: ótimo para largar liability e força futura.
    return SAFE_TIER + cardLiability(kind, card) * 10 + rank;
  }

  const isLast = view.currentTrick.length === 3;
  if (isLast) {
    // WIN certo — minimiza a penalidade capturada; empate → larga a mais alta.
    const captured = trickPenalty(kind, [...view.currentTrick.map((p) => p.card), card], view.trickNumber);
    return WIN_TIER - captured * 10 + rank;
  }

  // RISK — liderando ou assumindo sem ser o último: preferir a mais baixa e não-penalizada.
  return RISK_TIER - rank * 10 - cardLiability(kind, card);
}

/** Escolhe o melhor score; empate por ordem canônica (menor chave). Determinístico. */
function pickBest(view: BotView, score: (v: BotView, c: Card) => number): Card {
  const legal = view.legalCards;
  let best = legal[0];
  let bestScore = score(view, best);
  for (let i = 1; i < legal.length; i++) {
    const s = score(view, legal[i]);
    if (s > bestScore || (s === bestScore && canonicalKey(legal[i]) < canonicalKey(best))) {
      best = legal[i];
      bestScore = s;
    }
  }
  return best;
}

/**
 * Escolhe uma carta para o Bot Normal V1 a partir da visão pública.
 * Negativas (2A) e positivas (2B). `legalCards` é a autoridade; `resolveTrick` decide o vencedor.
 */
export function chooseNormalCard(view: BotView): Card {
  const legal = view.legalCards;
  if (legal.length === 0) throw new Error("chooseNormalCard: sem cartas legais (não é a vez do bot?)");
  if (legal.length === 1) return legal[0]; // jogada forçada (ex.: K♥ obrigatório na Mão 5)
  if (view.contract.isPositive) return choosePositive(view);
  return pickBest(view, scoreNegative);
}

// ════════════════════════════ ETAPA 2B — POSITIVAS + TRUNFO ════════════════════════════
//
// Postura invertida: nas positivas cada vaza vale +25 → CONQUISTAR (guloso por vaza, sem busca).
// Reaproveita `takesLead`/`resolveTrick`; nunca localiza cartas ocultas (usa só o público + a
// própria mão + a composição fixa do baralho). Determinístico; empate por `canonicalKey`.

/** Pontos de honra (Milton-Work) — um COMPONENTE, nunca decide sozinho. */
const HCP: Record<Rank, number> = {
  A: 4, K: 3, Q: 2, J: 1, "10": 0, "9": 0, "8": 0, "7": 0, "6": 0, "5": 0, "4": 0, "3": 0, "2": 0,
};
/** Pesos do TRUNFO — nomeados e centralizados (calibração fina virá da bateria). */
const TRUMP_W = { HCP_BASE: 0.3, TLEN: 3, TCTRL: 1, TSEQ: 1, RUFF: 1 } as const;
/** Pesos do SEM TRUNFO + margem mínima para vencer o melhor naipe de forma convincente. */
const NT_W = { ACE: 2, LONG: 2, COVER: 1.5, SHORT: 1.5, MARGIN: 2 } as const;
/** Não sendo o último, só corta com trunfo ≤ este valor (não queimar trunfo alto num corte vulnerável). */
const LOW_TRUMP_MAX = 9;

const rank = (c: Card): number => RANK_ORDER[c.rank];
const isTrumpCard = (view: BotView, c: Card): boolean =>
  view.trump !== null && view.trump !== "no-trump" && c.suit === view.trump;

function lowestByRank(cards: Card[]): Card {
  return cards.reduce((b, c) =>
    rank(c) < rank(b) || (rank(c) === rank(b) && canonicalKey(c) < canonicalKey(b)) ? c : b);
}
function highestByRank(cards: Card[]): Card {
  return cards.reduce((b, c) =>
    rank(c) > rank(b) || (rank(c) === rank(b) && canonicalKey(c) < canonicalKey(b)) ? c : b);
}

/** Cartas já jogadas PUBLICAMENTE (vazas anteriores + vaza atual). */
function seenCards(view: BotView): Card[] {
  const out: Card[] = [];
  for (const t of view.completedTricks) for (const p of t.plays) out.push(p.card);
  for (const p of view.currentTrick) out.push(p.card);
  return out;
}

/**
 * Quantas cartas do MESMO naipe, de valor SUPERIOR a `card`, ainda NÃO são conhecidas —
 * derivado só da composição fixa do baralho, da própria mão e das cartas públicas. `0` ⇒ a carta
 * é a MÁXIMA conhecida restante do seu naipe. (Ex.: tenho K♠; se A♠ já saiu ⇒ 0; se não ⇒ 1.)
 */
function higherUnseenCount(view: BotView, card: Card): number {
  const known = new Set<string>();
  for (const c of seenCards(view)) known.add(cardId(c));
  for (const c of view.hand) known.add(cardId(c));
  let n = 0;
  for (const r of RANKS) {
    if (RANK_ORDER[r] > RANK_ORDER[card.rank] && !known.has(cardId({ suit: card.suit, rank: r }))) n++;
  }
  return n;
}

/** Trunfos que PODEM estar com adversários (13 do naipe − vistos − meus). Nunca localiza onde. */
function remainingPossibleTrumps(view: BotView): number {
  const t = view.trump;
  if (t === null || t === "no-trump") return 0;
  const known = new Set<string>();
  for (const c of seenCards(view)) if (c.suit === t) known.add(cardId(c));
  for (const c of view.hand) if (c.suit === t) known.add(cardId(c));
  return 13 - known.size;
}

/**
 * "Master conhecido": maior carta restante do seu naipe. Para naipe LATERAL com trunfo em jogo,
 * deixa de ser master se um adversário está COMPROVADAMENTE void nesse naipe E ainda há trunfos
 * fora — conclusão permitida = "ele PODE cortar", jamais "ele tem trunfo".
 */
function isKnownMaster(view: BotView, card: Card): boolean {
  if (higherUnseenCount(view, card) > 0) return false;
  const t = view.trump;
  if (t !== null && t !== "no-trump" && card.suit !== t) {
    const trumpsOut = remainingPossibleTrumps(view);
    const oppVoid = view.voids.some((vs, s) => s !== view.seat && vs.includes(card.suit));
    if (trumpsOut > 0 && oppVoid) return false; // risco legítimo de corte
  }
  return true;
}

/** Regra V1 objetiva/conservadora para puxar trunfo. Não conta trunfos por adversário. */
function shouldPullTrump(view: BotView): boolean {
  const t = view.trump;
  if (t === null || t === "no-trump") return false;
  const mine = view.hand.filter((c) => c.suit === t);
  if (mine.length < 3) return false;
  if (remainingPossibleTrumps(view) <= 0) return false; // ninguém mais tem trunfo p/ sacar
  const iHoldTop = higherUnseenCount(view, highestByRank(mine)) === 0;
  return mine.length >= 4 || iHoldTop;
}

// ---- as quatro situações da jogada positiva ----

/** Abrindo a vaza: A master → B puxar trunfo → C desenvolver naipe longo (baixo, sem gastar honra). */
function leadPositive(view: BotView): Card {
  const legal = view.legalCards;
  const masters = legal.filter((c) => isKnownMaster(view, c));
  if (masters.length > 0) return highestByRank(masters);
  if (shouldPullTrump(view)) {
    const trumps = legal.filter((c) => isTrumpCard(view, c));
    if (trumps.length > 0) return highestByRank(trumps);
  }
  const longest = longestSuit(legal);
  return lowestByRank(legal.filter((c) => c.suit === longest));
}
function longestSuit(cards: Card[]): Suit {
  const count: Record<Suit, number> = { spades: 0, hearts: 0, diamonds: 0, clubs: 0 };
  for (const c of cards) count[c.suit]++;
  let best: Suit = SUITS[0];
  for (const s of SUITS) if (count[s] > count[best]) best = s; // empate → naipe canônico mais cedo
  return best;
}

/** Seguindo o naipe: último → menor carta suficiente para vencer; senão só vence se for master. */
function followPositive(view: BotView): Card {
  const legal = view.legalCards;
  const winners = legal.filter((c) => takesLead(view, c));
  if (view.currentTrick.length === 3) return winners.length > 0 ? lowestByRank(winners) : lowestByRank(legal);
  const secure = winners.filter((c) => isKnownMaster(view, c));
  if (secure.length > 0) return lowestByRank(secure);
  return lowestByRank(legal); // não desperdiça: guarda as altas, joga a mais baixa
}

/** Sem o naipe puxado: cortar/sobretrunfar barato quando vale; senão descartar preservando força. */
function discardOrRuffPositive(view: BotView): Card {
  const legal = view.legalCards;
  const t = view.trump;
  const isLast = view.currentTrick.length === 3;
  if (t !== null && t !== "no-trump") {
    const trumpWinners = legal.filter((c) => c.suit === t && takesLead(view, c));
    if (trumpWinners.length > 0) {
      const cheap = lowestByRank(trumpWinners);
      if (isLast || rank(cheap) <= LOW_TRUMP_MAX) return cheap; // menor trunfo suficiente
    }
  }
  // descarte: preserva trunfos; joga a carta baixa de menor utilidade
  const nonTrump = legal.filter((c) => !isTrumpCard(view, c));
  return lowestByRank(nonTrump.length > 0 ? nonTrump : legal);
}

function choosePositive(view: BotView): Card {
  if (view.currentTrick.length === 0) return leadPositive(view);
  const led = view.currentTrick[0].card.suit;
  const followingSuit = view.legalCards.some((c) => c.suit === led);
  return followingSuit ? followPositive(view) : discardOrRuffPositive(view);
}

// ---- escolha de trunfo (só a própria mão) ----

const hcpOf = (cards: readonly Card[]): number => cards.reduce((s, c) => s + HCP[c.rank], 0);
const suitOf = (hand: readonly Card[], s: Suit): Card[] => hand.filter((c) => c.suit === s);

/** Honras em sequência a partir do Ás (A, A-K, A-K-Q, A-K-Q-J) — reduz risco de perder p/ carta faltante. */
function honorSeq(cards: readonly Card[]): number {
  const has = (r: Rank) => cards.some((c) => c.rank === r);
  let run = 0;
  for (const r of ["A", "K", "Q", "J"] as Rank[]) { if (has(r)) run++; else break; }
  return run;
}
/** Potencial de corte: naipes laterais curtos, limitado pela quantidade de trunfos. */
function ruffValue(hand: readonly Card[], T: Suit): number {
  let raw = 0;
  for (const s of SUITS) {
    if (s === T) continue;
    const len = suitOf(hand, s).length;
    raw += len === 0 ? 3 : len === 1 ? 2 : len === 2 ? 1 : 0;
  }
  return Math.min(raw, suitOf(hand, T).length);
}
function trumpScore(hand: readonly Card[], T: Suit): number {
  const inT = suitOf(hand, T);
  return TRUMP_W.HCP_BASE * hcpOf(hand)
    + TRUMP_W.TLEN * Math.max(0, inT.length - 4)
    + TRUMP_W.TCTRL * hcpOf(inT)
    + TRUMP_W.TSEQ * honorSeq(inT)
    + TRUMP_W.RUFF * ruffValue(hand, T);
}
function noTrumpScore(hand: readonly Card[]): number {
  let longExcess = 0, shortCount = 0, cover = 0;
  for (const s of SUITS) {
    const cs = suitOf(hand, s);
    longExcess += Math.max(0, cs.length - 4);
    if (cs.length <= 1) shortCount++;
    if (cs.some((c) => c.rank === "A" || c.rank === "K")) cover++;
  }
  const aces = hand.filter((c) => c.rank === "A").length;
  return TRUMP_W.HCP_BASE * hcpOf(hand)
    + NT_W.ACE * aces + NT_W.LONG * longExcess + NT_W.COVER * cover - NT_W.SHORT * shortCount;
}

/**
 * Escolhe o trunfo a partir SÓ das 13 cartas próprias (fronteira mínima; cheat impossível por tipo).
 * Avalia os quatro naipes e o Sem Trunfo; Sem Trunfo só vence o melhor naipe por uma MARGEM mínima.
 * Determinístico: empate de naipe → ordem canônica (SUITS); Sem Trunfo é a opção de último desempate.
 */
export function chooseNormalTrump(hand: readonly Card[]): Trump {
  let best: Suit = SUITS[0];
  let bestScore = -Infinity;
  for (const s of SUITS) {
    const sc = trumpScore(hand, s);
    if (sc > bestScore) { bestScore = sc; best = s; } // '>' estrito → empate mantém o naipe mais cedo
  }
  return noTrumpScore(hand) >= bestScore + NT_W.MARGIN ? "no-trump" : best;
}
