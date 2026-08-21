// BOT NORMAL V1 — inteligência heurística (ETAPA 2A: SÓ as 6 mãos negativas).
//
// Decide EXCLUSIVAMENTE a partir de `BotView` (projeção pública + a própria mão). NÃO importa
// `MatchState`, mãos alheias, baralho, RNG nem estado privado. Recebe `legalCards` já calculadas
// pelo motor — nunca reimplementa legalidade. Reaproveita `resolveTrick` (regra oficial pública de
// quem vence a vaza) para NÃO criar regra paralela. Puro e determinístico: sem aleatoriedade;
// empate resolvido por ordem CANÔNICA explícita.
import type { Card } from "./cards.js";
import { RANK_ORDER, SUITS, isKingOfHearts } from "./cards.js";
import type { ContractKind } from "./contracts.js";
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
 * ETAPA 2A: só mãos NEGATIVAS. Contrato positivo lança erro explícito (implementação na ETAPA 2B),
 * o que é seguro porque o bot ainda NÃO está ligado à Mesa.
 */
export function chooseNormalCard(view: BotView): Card {
  const legal = view.legalCards;
  if (legal.length === 0) throw new Error("chooseNormalCard: sem cartas legais (não é a vez do bot?)");
  if (view.contract.isPositive) {
    throw new Error("chooseNormalCard: mãos positivas ainda não implementadas (ETAPA 2B)");
  }
  if (legal.length === 1) return legal[0]; // jogada forçada (ex.: K♥ obrigatório na Mão 5)
  return pickBest(view, scoreNegative);
}
