// Os 10 contratos do KING (6 negativos + 4 positivos) e a pontuação de cada mão.
// Fonte de verdade: PROMPT MESTRE V2 — KING. Não usar variantes da internet.
import type { Card, Suit } from "./cards.js";
import { isKingOfHearts } from "./cards.js";

export type Seat = 0 | 1 | 2 | 3;

/** Trunfo escolhido nas mãos positivas. */
export type Trump = Suit | "no-trump";

export type ContractKind =
  | "no-tricks" // Mão 1 — não fazer vazas
  | "no-hearts" // Mão 2 — não fazer Copas
  | "no-queens" // Mão 3 — não fazer Damas
  | "no-men" // Mão 4 — não fazer Homens (Reis e Valetes)
  | "no-king" // Mão 5 — não fazer o King (Rei de Copas)
  | "no-last-two" // Mão 6 — não fazer as duas últimas
  | "positive"; // Mãos 7–10 — positiva (+25 por vaza)

export interface ContractDef {
  hand: number; // 1..10
  kind: ContractKind;
  label: string;
  /** Proibido ABRIR vaza com Copas enquanto tiver outro naipe (só mãos 2 e 5). */
  noLeadHearts: boolean;
  isPositive: boolean;
  /** Total de pontos em disputa na mão (negativo ou positivo). Usado nos checksums. */
  handTotal: number;
}

export interface PlayedCard {
  seat: Seat;
  card: Card;
}

export interface CompletedTrick {
  number: number; // 1..13
  leader: Seat;
  cards: PlayedCard[]; // 4 cartas, na ordem de jogo
  winner: Seat;
}

/** Definição fixa dos 10 contratos, indexados por número da mão (1..10). */
export const HAND_CONTRACTS: Record<number, ContractDef> = {
  1: { hand: 1, kind: "no-tricks", label: "Não pegar Vazas", noLeadHearts: false, isPositive: false, handTotal: -260 },
  2: { hand: 2, kind: "no-hearts", label: "Não pegar Copas", noLeadHearts: true, isPositive: false, handTotal: -260 },
  3: { hand: 3, kind: "no-queens", label: "Não pegar Damas", noLeadHearts: false, isPositive: false, handTotal: -200 },
  4: { hand: 4, kind: "no-men", label: "Não pegar Reis e Valetes", noLeadHearts: false, isPositive: false, handTotal: -240 },
  5: { hand: 5, kind: "no-king", label: "Não pegar o Rei de Copas", noLeadHearts: true, isPositive: false, handTotal: -160 },
  6: { hand: 6, kind: "no-last-two", label: "Não pegar as duas últimas", noLeadHearts: false, isPositive: false, handTotal: -180 },
  7: { hand: 7, kind: "positive", label: "Positiva", noLeadHearts: false, isPositive: true, handTotal: 325 },
  8: { hand: 8, kind: "positive", label: "Positiva", noLeadHearts: false, isPositive: true, handTotal: 325 },
  9: { hand: 9, kind: "positive", label: "Positiva", noLeadHearts: false, isPositive: true, handTotal: 325 },
  10: { hand: 10, kind: "positive", label: "Positiva", noLeadHearts: false, isPositive: true, handTotal: 325 },
};

export const TOTAL_HANDS = 10;
export const TRICKS_PER_HAND = 13;
export const NEGATIVE_CHECKSUM = -1300; // soma das 6 negativas
export const POSITIVE_CHECKSUM = 1300; // soma das 4 positivas
export const FINAL_CHECKSUM = 0; // invariante da partida completa

const isQueen = (c: Card) => c.rank === "Q";
const isMan = (c: Card) => c.rank === "K" || c.rank === "J"; // Reis e Valetes

/**
 * Pontua UMA mão a partir das 13 vazas concluídas.
 * Retorna o delta por assento (índice 0..3). Determinístico e sem estado.
 * O total distribuído é sempre igual a `contract.handTotal` (garantido pelos testes de checksum).
 */
export function scoreHand(kind: ContractKind, tricks: CompletedTrick[]): number[] {
  const s = [0, 0, 0, 0];
  for (const trick of tricks) {
    const w = trick.winner;
    const cards = trick.cards.map((p) => p.card);
    switch (kind) {
      case "no-tricks":
        s[w] -= 20;
        break;
      case "no-hearts":
        s[w] -= 20 * cards.filter((c) => c.suit === "hearts").length;
        break;
      case "no-queens":
        s[w] -= 50 * cards.filter(isQueen).length;
        break;
      case "no-men":
        s[w] -= 30 * cards.filter(isMan).length;
        break;
      case "no-king":
        if (cards.some(isKingOfHearts)) s[w] -= 160;
        break;
      case "no-last-two":
        if (trick.number === 12) s[w] -= 90;
        if (trick.number === 13) s[w] -= 90;
        break;
      case "positive":
        s[w] += 25;
        break;
    }
  }
  return s;
}

/**
 * Assento que escolhe o trunfo em cada mão positiva.
 * Rotação determinística: M7→P0, M8→P1, M9→P2, M10→P3 (cada jogador escolhe exatamente uma vez).
 */
export function trumpChooserFor(handNumber: number): Seat {
  return ((handNumber - 7) % 4) as Seat;
}

/** Uma linha do detalhamento da mão (o que cada assento capturou e quanto valeu). */
export interface HandBreakdownRow {
  seat: Seat;
  /** Vazas vencidas na mão (informativo em todos os contratos). */
  tricks: number;
  /** Itens contados pelo contrato que o assento capturou (copas, damas, homens, King…). */
  units: number;
  /** Delta da mão para o assento. Sempre igual a `units * perUnit`. */
  points: number;
}

/** Detalhamento legível de UMA mão: o que cada assento capturou e o porquê da pontuação. */
export interface HandBreakdown {
  kind: ContractKind;
  /** Pontos por unidade contada (ex.: −50 por Dama, +25 por vaza). */
  perUnit: number;
  /** Rótulo da unidade, singular e plural (pt-BR), para a UI não reinventar textos. */
  unit: string;
  unitPlural: string;
  /** Vazas efetivamente jogadas (pode ser < 13 no encerramento antecipado das negativas). */
  tricksPlayed: number;
  rows: HandBreakdownRow[];
}

const UNIT_LABEL: Record<ContractKind, { unit: string; unitPlural: string; perUnit: number }> = {
  "no-tricks": { unit: "vaza", unitPlural: "vazas", perUnit: -20 },
  "no-hearts": { unit: "copa", unitPlural: "copas", perUnit: -20 },
  "no-queens": { unit: "dama", unitPlural: "damas", perUnit: -50 },
  "no-men": { unit: "homem", unitPlural: "homens", perUnit: -30 },
  "no-king": { unit: "King", unitPlural: "King", perUnit: -160 },
  "no-last-two": { unit: "última", unitPlural: "últimas", perUnit: -90 },
  positive: { unit: "vaza", unitPlural: "vazas", perUnit: 25 },
};

/** Quantas unidades do contrato uma vaza entrega a quem a venceu. */
function unitsInTrick(kind: ContractKind, trick: CompletedTrick): number {
  const cards = trick.cards.map((p) => p.card);
  switch (kind) {
    case "no-tricks":
    case "positive":
      return 1;
    case "no-hearts":
      return cards.filter((c) => c.suit === "hearts").length;
    case "no-queens":
      return cards.filter(isQueen).length;
    case "no-men":
      return cards.filter(isMan).length;
    case "no-king":
      return cards.some(isKingOfHearts) ? 1 : 0;
    case "no-last-two":
      return trick.number === 12 || trick.number === 13 ? 1 : 0;
  }
}

/**
 * Explica a pontuação de UMA mão (mesma fonte de verdade de `scoreHand`).
 * Puro e determinístico: a UI apenas apresenta, nunca recalcula regra.
 */
export function handBreakdown(kind: ContractKind, tricks: CompletedTrick[]): HandBreakdown {
  const { unit, unitPlural, perUnit } = UNIT_LABEL[kind];
  const rows: HandBreakdownRow[] = [0, 1, 2, 3].map((seat) => ({
    seat: seat as Seat,
    tricks: 0,
    units: 0,
    points: 0,
  }));
  for (const trick of tricks) {
    const r = rows[trick.winner];
    r.tricks += 1;
    r.units += unitsInTrick(kind, trick);
  }
  // `|| 0` evita -0 quando nada foi capturado (ruído em comparações e na UI).
  for (const r of rows) r.points = r.units * perUnit || 0;
  return { kind, perUnit, unit, unitPlural, tricksPlayed: tricks.length, rows };
}
