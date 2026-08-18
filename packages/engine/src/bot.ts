// Bot legal simples (usa a legalidade OFICIAL do motor — não reimplementa regra alguma).
// Política mínima: joga a menor carta legal (tende a evitar vencer vazas e pegar penalidades).
// "Bot Normal" mais esperto fica para etapa futura.
import type { Card } from "./cards.js";
import { RANK_ORDER } from "./cards.js";
import type { Seat, Trump } from "./contracts.js";
import { legalCardsFor, type MatchState } from "./match.js";
import { chooseTrumpByMajority } from "./sim.js";

/** Escolhe uma carta LEGAL para o bot da vez (a legalidade vem do motor). */
export function chooseBotCard(m: MatchState, seat: Seat): Card {
  const legal = legalCardsFor(m, seat);
  if (legal.length === 0) throw new Error(`bot ${seat} sem carta legal`);
  return legal.slice().sort((a, b) => RANK_ORDER[a.rank] - RANK_ORDER[b.rank])[0];
}

/** Escolha de trunfo do bot (naipe mais numeroso da mão). Reaproveita a heurística do sim. */
export function chooseBotTrump(m: MatchState, seat: Seat): Trump {
  const h = m.hand;
  if (!h) throw new Error("sem mão ativa");
  return chooseTrumpByMajority(h.hands[seat]);
}
