// ANÚNCIO DA VAZA — o que a mesa mostra e toca quando uma vaza fecha.
//
// Função PURA: recebe a partida (local ou remota) e devolve o que apresentar. Não toca som, não
// mexe no React, não olha o relógio. Assim os dois modos anunciam exatamente igual e isto pode
// ser testado sem montar componente.
//
// Nada é recontado aqui: quem diz o que a vaza custou é o motor (`lastTrickBreakdown`), e quem
// diz o acumulado da mão é o motor (`handBreakdownSoFar`).
import type { Seat } from "@king/engine";
import type { LeituraDaPartida } from "./leituraDaPartida.js";
import { TEMPOS } from "./timings.js";

/**
 * O "castigo" de uma vaza: quem levou bucha, o quê e quanto custou. É o que a Mesa exibe
 * enquanto a mesa está parada, para todos verem quem se deu mal.
 */
export interface Castigo {
  seat: Seat;
  jogador: string;
  /** Já formatado pelo motor: "2 Damas", "1 K de Copas", "3 Copas". */
  oQue: string;
  pontos: number;
  king: boolean;
  voce: boolean;
  /** Muda a cada anúncio para a animação tocar de novo. */
  nonce: number;
}

/** Qual som a vaza pede. A tradução para a função de áudio fica na camada React. */
export type SomDaVaza = "good" | "neutral" | "penalty" | "king";

export interface Anuncio {
  /** `null` quando não há bucha a destacar — a mesa segue no ritmo normal. */
  castigo: Castigo | null;
  som: SomDaVaza;
  /** Tremor de tela: toda bucha treme, não só o King. */
  shake: boolean;
  /** Quanto tempo a mesa fica parada antes de recolher as cartas. */
  pausa: number;
}

/**
 * Decide o anúncio da vaza recém-fechada. `nonce` entra de fora para a função continuar pura
 * (a camada React passa `Date.now()`).
 *
 * `null` = não há vaza fechada para anunciar; a apresentação não deve mexer em nada.
 */
export function anunciarVaza(g: LeituraDaPartida, nonce: number): Anuncio | null {
  const neutro = (som: SomDaVaza, pausa: number): Anuncio => ({ castigo: null, som, shake: false, pausa });

  const last = g.lastCompletedTrick();
  const contract = g.contract();
  const bd = g.lastTrickBreakdown();
  // acumulado da MÃO: é o que o selo anuncia ("2 Damas" na segunda, não "1 Dama" de novo)
  const total = g.handBreakdownSoFar();
  if (!last || !contract || !bd || !total) return null;

  const linha = bd.rows[last.winner];
  const acumulado = total.rows[last.winner];
  const units = linha.units;
  const mine = last.winner === g.humanSeat;
  // a última vaza da mão precisa de ar: o Placar só entra depois desta pausa
  const piso = g.handOver() ? TEMPOS.fimDeMao : 0;
  const normal = Math.max(TEMPOS.leituraDaVaza, piso);

  // Positivas: a vaza É o ponto. Sem castigo a anunciar.
  if (contract.isPositive) return neutro(mine ? "good" : "neutral", normal);

  // Negativa SEM bucha nesta vaza: alívio, ritmo normal.
  if (units === 0) return neutro(mine ? "neutral" : "good", normal);

  // "Não pegar Vazas": TODA vaza custa e o vencedor é evidente na mesa. Anunciar as 13 só
  // arrastaria a mão. O suspense existe onde a bucha é uma CARTA específica — Copas, Damas,
  // Reis/Valetes, K de Copas, as duas últimas —, que é o que ninguém consegue acompanhar.
  if (contract.kind === "no-tricks") return neutro(mine ? "penalty" : "neutral", normal);

  // Alguém pegou bucha: a mesa para e mostra QUEM e QUANTO custou.
  const king = contract.kind === "no-king";
  return {
    castigo: {
      seat: last.winner,
      jogador: g.players()[last.winner],
      // ACUMULADO da mão, não só desta vaza: na segunda Dama o selo diz "2 Damas".
      oQue: `${acumulado.units} ${acumulado.units === 1 ? total.unit : total.unitPlural}`,
      pontos: acumulado.points,
      king,
      voce: mine,
      nonce,
    },
    som: king ? "king" : "penalty",
    shake: true,
    pausa: Math.max(king ? TEMPOS.leituraDaVazaKing : TEMPOS.leituraDaVazaCastigo, piso),
  };
}
