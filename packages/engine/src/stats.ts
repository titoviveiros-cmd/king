// Estatísticas derivadas de uma partida encerrada — matéria-prima do "destaque memorável"
// do Placar Final. Puro e determinístico: lê o histórico, não recalcula regra nem pontuação.
import { HAND_CONTRACTS, type Seat } from "./contracts.js";
import { rankings, type MatchState } from "./match.js";

export interface HandRef {
  handNumber: number;
  score: number;
}

export interface SeatStats {
  seat: Seat;
  /** Melhor e pior mão do assento (maior e menor delta). */
  bestHand: HandRef | null;
  worstHand: HandRef | null;
  /** Mãos negativas em que o assento saiu ileso (zero ponto perdido). */
  cleanNegatives: number;
  /** Quantas negativas foram jogadas até aqui (base do "N de 6"). */
  negativeHands: number;
  /** Vazas positivas convertidas em pontos (positivos ÷ 25). */
  positiveTricks: number;
}

export interface MatchStats {
  perSeat: SeatStats[];
  /** Quem levou o Rei de Copas na mão 5 (null se a mão ainda não foi jogada). */
  kingTaker: Seat | null;
  /** Maior pontuação de mão da partida inteira. */
  biggestHand: { seat: Seat; handNumber: number; score: number } | null;
  /**
   * Distância da liderança para o melhor score ESTRITAMENTE abaixo dela.
   * Havendo empate na ponta, continua medindo até o primeiro score diferente — quem decide
   * se faz sentido dizer "venceu por X" é a apresentação, que já trata o empate à parte.
   */
  margin: number;
}

const SEATS: Seat[] = [0, 1, 2, 3];

/** Agrega o histórico de mãos concluídas. Seguro em partida parcial. */
export function matchStats(m: MatchState): MatchStats {
  const perSeat: SeatStats[] = SEATS.map((seat) => {
    let best: HandRef | null = null;
    let worst: HandRef | null = null;
    let cleanNegatives = 0;
    let negativeHands = 0;

    for (const h of m.history) {
      const score = h.handScores[seat];
      const ref = { handNumber: h.handNumber, score };
      if (best === null || score > best.score) best = ref;
      if (worst === null || score < worst.score) worst = ref;
      if (!HAND_CONTRACTS[h.handNumber].isPositive) {
        negativeHands++;
        if (score === 0) cleanNegatives++;
      }
    }
    return {
      seat,
      bestHand: best,
      worstHand: worst,
      cleanNegatives,
      negativeHands,
      positiveTricks: Math.round(m.positives[seat] / 25),
    };
  });

  const kingHand = m.history.find((h) => h.kind === "no-king");
  const kingTaker = kingHand
    ? ((kingHand.handScores.findIndex((s) => s !== 0) as Seat | -1) === -1
        ? null
        : (kingHand.handScores.findIndex((s) => s !== 0) as Seat))
    : null;

  let biggestHand: MatchStats["biggestHand"] = null;
  for (const h of m.history) {
    for (const seat of SEATS) {
      const score = h.handScores[seat];
      if (biggestHand === null || score > biggestHand.score) {
        biggestHand = { seat, handNumber: h.handNumber, score };
      }
    }
  }

  // margem: liderança menos o melhor score ABAIXO dela (ver contrato do campo)
  const rows = rankings(m);
  const top = rows[0].score;
  const runnerUp = rows.find((r) => r.score < top);
  const margin = runnerUp ? top - runnerUp.score : 0;

  return { perSeat, kingTaker, biggestHand, margin };
}
