// Primitivas de baralho reaproveitáveis por praticamente qualquer jogo de cartas.
// Puro TypeScript, sem UI e determinístico (embaralhamento por semente) para que o
// mesmo código valide jogadas no cliente e no servidor autoritativo.

export type Suit = "spades" | "hearts" | "diamonds" | "clubs";
export type Rank =
  | "A" | "2" | "3" | "4" | "5" | "6" | "7"
  | "8" | "9" | "10" | "J" | "Q" | "K";

export interface Card {
  suit: Suit;
  rank: Rank;
}

export const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
export const RANKS: Rank[] = [
  "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K",
];

export const SUIT_SYMBOL: Record<Suit, string> = {
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

export const isRed = (suit: Suit): boolean =>
  suit === "hearts" || suit === "diamonds";

/**
 * Força das cartas (KING): A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4 > 3 > 2.
 * Números maiores vencem.
 */
export const RANK_ORDER: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

/** Compara duas cartas pela força do valor (positivo se a > b). */
export const compareRank = (a: Card, b: Card): number =>
  RANK_ORDER[a.rank] - RANK_ORDER[b.rank];

/** O Rei de Copas — o "KING", carta-ícone e mais penalizada do jogo. */
export const KING_OF_HEARTS: Card = { suit: "hearts", rank: "K" };

export const isKingOfHearts = (c: Card): boolean =>
  c.suit === "hearts" && c.rank === "K";

export const sameCard = (a: Card, b: Card): boolean =>
  a.suit === b.suit && a.rank === b.rank;

/** Baralho padrão de 52 cartas, em ordem canônica. */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/**
 * Gerador pseudoaleatório determinístico (mulberry32).
 * Mesma semente => mesma sequência, o que torna partidas reproduzíveis e testáveis.
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. Não muta o array de entrada. */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface DealResult {
  hands: Card[][];
  draw: Card[];
}

/**
 * Distribui `perPlayer` cartas para `players` jogadores a partir do topo do baralho.
 * O restante fica na pilha de compra (`draw`). Não muta o baralho de entrada.
 */
export function deal(
  deck: readonly Card[],
  players: number,
  perPlayer: number,
): DealResult {
  if (players <= 0) throw new Error("players deve ser > 0");
  if (perPlayer < 0) throw new Error("perPlayer deve ser >= 0");
  if (players * perPlayer > deck.length) {
    throw new Error("Cartas insuficientes para distribuir");
  }
  const hands: Card[][] = Array.from({ length: players }, () => []);
  let idx = 0;
  // Distribui uma carta por vez para cada jogador (como na vida real).
  for (let round = 0; round < perPlayer; round++) {
    for (let p = 0; p < players; p++) {
      hands[p].push(deck[idx++]);
    }
  }
  const draw = deck.slice(idx);
  return { hands, draw };
}

export const cardId = (c: Card): string => `${c.rank}-${c.suit}`;
