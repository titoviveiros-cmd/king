// Regras de jogada legal e resolução de vaza. Puro e determinístico.
// A UI deve tornar cartas ilegais indisponíveis; o motor (autoridade) revalida sempre.
import type { Card } from "./cards.js";
import { compareRank, isKingOfHearts } from "./cards.js";
import type { ContractDef, PlayedCard, Seat, Trump } from "./contracts.js";

/**
 * Cartas que `hand` pode jogar legalmente, dado o estado da vaza e o contrato.
 *
 * Regras:
 *  - Servir: se o jogador tem o naipe puxado, só pode jogar cartas desse naipe.
 *  - Baldar: sem o naipe puxado, pode jogar qualquer carta (salvo restrições do contrato).
 *  - noLeadHearts (mãos 2 e 5): não pode ABRIR vaza com Copas se tiver carta de outro naipe.
 *  - Mão 5 (no-king): o Rei de Copas deve ser jogado na primeira oportunidade legal —
 *      (a) se Copas é puxada e o jogador tem o K♥, é FORÇADO a jogar o K♥;
 *      (b) se o jogador está sem o naipe puxado (vai descartar) e tem o K♥, é FORÇADO a descartá-lo.
 */
export function getLegalCards(
  hand: Card[],
  trick: PlayedCard[],
  contract: ContractDef,
): Card[] {
  const hasKH = hand.some(isKingOfHearts);
  const kh = hand.filter(isKingOfHearts);

  // Abertura da vaza (jogador é o primeiro a jogar).
  if (trick.length === 0) {
    if (contract.noLeadHearts) {
      const hasNonHearts = hand.some((c) => c.suit !== "hearts");
      if (hasNonHearts) return hand.filter((c) => c.suit !== "hearts");
    }
    return hand.slice();
  }

  const led = trick[0].card.suit;
  const sameSuit = hand.filter((c) => c.suit === led);

  if (sameSuit.length > 0) {
    // Obrigado a servir. Exceção mão 5: Copas puxada + K♥ na mão => forçado a jogar o K♥.
    if (contract.kind === "no-king" && led === "hearts" && hasKH) return kh;
    return sameSuit;
  }

  // Sem o naipe puxado: pode baldar qualquer carta.
  // Exceção mão 5: primeira oportunidade legal de descarte com K♥ => forçado a descartá-lo.
  if (contract.kind === "no-king" && hasKH) return kh;
  return hand.slice();
}

/**
 * Assento vencedor da vaza.
 *  - Com trunfo em jogo: vence o maior trunfo.
 *  - Sem trunfo (ou "Sem Trunfo"/mãos negativas): vence a maior carta do naipe puxado.
 * Cartas baldadas de outros naipes nunca vencem.
 */
export function resolveTrick(cards: PlayedCard[], trump: Trump | null): Seat {
  if (cards.length === 0) throw new Error("Vaza vazia não pode ser resolvida");
  const led = cards[0].card.suit;
  const useTrump = trump && trump !== "no-trump" ? trump : null;

  if (useTrump) {
    const trumps = cards.filter((p) => p.card.suit === useTrump);
    if (trumps.length > 0) return highest(trumps);
  }
  const ofLed = cards.filter((p) => p.card.suit === led);
  return highest(ofLed);
}

function highest(cards: PlayedCard[]): Seat {
  let best = cards[0];
  for (const p of cards) if (compareRank(p.card, best.card) > 0) best = p;
  return best.seat;
}
