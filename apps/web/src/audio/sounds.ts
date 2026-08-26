// Sons SEMÂNTICOS do KING — cada função é um evento do jogo, não um "beep".
// Paleta sonora alinhada à visual: turquesa = positivo (intervalos maiores, brilho),
// magenta = tensão/King (grave, dissonante, impacto), ouro = vitória (motivo da coroa).
//
// Regras de gosto aplicadas aqui:
// • ondas cruas (square/sawtooth) sempre com passa-baixa — sem elas o som fica estridente;
// • o que toca muitas vezes por partida é curto, seco e discreto; o que é raro pode brilhar;
// • `space` controla o quanto cada som vai para o reverb: eventos íntimos ficam perto,
//   momentos heróicos ficam distantes e grandes.
import { audio } from "./engine.js";

/** Motivo da coroa: Ré–Lá–Fá♯–Ré (arpejo maior ascendente) — assinatura sonora do KING. */
const CROWN = [293.66, 440.0, 554.37, 587.33];

/** Toque de UI (botões, abas). */
export function sfxTap(): void {
  audio.tone({ freq: 460, to: 620, dur: 0.075, gain: 0.1, wave: "triangle", cutoff: 3000, space: 0.1 });
  audio.vibrate(8);
}

/** Distribuição das 13 cartas — stagger curto, acompanha a animação. */
export function sfxDeal(): void {
  for (let i = 0; i < 10; i++) {
    audio.noise({
      freq: 2400 - i * 60, to: 900, q: 0.9, dur: 0.075,
      gain: 0.045 + (i % 3) * 0.006, delay: i * 0.052, space: 0.2,
    });
  }
  audio.tone({ freq: 174.61, dur: 0.5, gain: 0.05, wave: "triangle", attack: 0.02, cutoff: 700, delay: 0.5, space: 0.4 });
  audio.vibrate(12);
}

/** Carta jogada (própria ou de adversário) — sopro de papel + toque de mesa. */
export function sfxCardPlay(): void {
  audio.noise({ freq: 2800, to: 700, q: 0.8, dur: 0.085, gain: 0.062, space: 0.14 });
  audio.tone({ freq: 165, to: 96, dur: 0.075, gain: 0.05, wave: "triangle", cutoff: 500, space: 0.12 });
}

/** Carta selecionada no leque (antes de confirmar). */
export function sfxCardSelect(): void {
  audio.tone({ freq: 660, dur: 0.06, gain: 0.055, wave: "sine", space: 0.16 });
  audio.tone({ freq: 990, dur: 0.045, gain: 0.022, wave: "sine", delay: 0.018, space: 0.2 });
  audio.vibrate(6);
}

/** Vaza recolhida por um adversário, sem penalidade envolvida. */
export function sfxTrickNeutral(): void {
  audio.noise({ freq: 1300, to: 380, q: 1.3, dur: 0.19, gain: 0.055, space: 0.3 });
  audio.tone({ freq: 130.81, dur: 0.2, gain: 0.035, wave: "sine", cutoff: 450, space: 0.25 });
}

/** Vaza boa: positiva sua, ou negativa que você conseguiu evitar. Fá maior, arejado. */
export function sfxTrickGood(): void {
  audio.duck(0.6, 0.35);
  audio.noise({ freq: 1500, to: 500, q: 1.2, dur: 0.16, gain: 0.035, space: 0.25 });
  const notas = [349.23, 440.0, 523.25]; // Fá – Lá – Dó
  notas.forEach((f, i) => {
    audio.tone({ freq: f, dur: 0.26 + i * 0.06, gain: 0.1 - i * 0.012, wave: "triangle", cutoff: 2600, delay: i * 0.07, sustain: 0.35, space: 0.45 });
    audio.tone({ freq: f * 2, dur: 0.2, gain: 0.02, wave: "sine", delay: i * 0.07 + 0.01, space: 0.5 });
  });
  audio.vibrate(14);
}

/** Você levou penalidade nesta vaza — grave e curto, sem punir o ouvido. */
export function sfxPenalty(): void {
  audio.duck(0.55, 0.4);
  audio.tone({ freq: 220, to: 174.61, dur: 0.34, gain: 0.11, wave: "sawtooth", cutoff: 900, sustain: 0.35, space: 0.35 });
  audio.tone({ freq: 110, dur: 0.3, gain: 0.07, wave: "sine", cutoff: 400, space: 0.3 });
  audio.noise({ freq: 260, q: 1.8, dur: 0.24, gain: 0.05, space: 0.35 });
  audio.vibrate([18, 40, 18]);
}

/** K♥ capturado — o impacto mais forte do jogo. Acompanha screen-shake + flash. */
export function sfxKingCaptured(): void {
  audio.duck(0.16, 1.3);
  // impacto: corpo grave + estouro de ar
  audio.noise({ freq: 800, to: 70, q: 0.8, dur: 0.6, gain: 0.17, space: 0.55 });
  audio.tone({ freq: 98, to: 49, dur: 0.85, gain: 0.2, wave: "sine", cutoff: 320, sustain: 0.3, space: 0.4 });
  audio.tone({ freq: 146.83, to: 73.42, dur: 0.7, gain: 0.11, wave: "sawtooth", cutoff: 600, space: 0.45 });
  // segunda menor: a dissonância que marca a perda (filtrada, não estridente)
  audio.tone({ freq: 233.08, dur: 0.62, gain: 0.06, wave: "triangle", cutoff: 1100, delay: 0.04, sustain: 0.45, space: 0.6 });
  audio.tone({ freq: 246.94, dur: 0.62, gain: 0.06, wave: "triangle", cutoff: 1100, delay: 0.04, sustain: 0.45, space: 0.6 });
  // cauda longa e distante: o golpe ecoa na sala
  audio.tone({ freq: 73.42, dur: 1.6, gain: 0.05, wave: "sine", attack: 0.15, sustain: 0.5, delay: 0.2, space: 0.8 });
  audio.vibrate([40, 60, 120]);
}

/** Trunfo confirmado na mão positiva. */
export function sfxTrump(): void {
  audio.duck(0.5, 0.6);
  CROWN.slice(0, 3).forEach((f, i) => {
    audio.tone({ freq: f, dur: 0.38, gain: 0.095, wave: "triangle", cutoff: 2800, delay: i * 0.075, attack: 0.02, sustain: 0.4, space: 0.5 });
  });
  audio.tone({ freq: CROWN[0] / 2, dur: 0.9, gain: 0.07, wave: "sine", attack: 0.04, cutoff: 500, sustain: 0.4, space: 0.4 });
  audio.vibrate(20);
}

/** Última vaza da mão — tensão curta antes de resolver. */
export function sfxLastTrick(): void {
  audio.tone({ freq: 146.83, to: 293.66, dur: 0.75, gain: 0.075, wave: "sawtooth", cutoff: 950, attack: 0.3, sustain: 0.6, space: 0.5 });
  audio.noise({ freq: 400, to: 2400, q: 1.4, dur: 0.7, gain: 0.03, space: 0.5 });
}

/** Fim de mão: resolve e entrega o Placar. */
export function sfxHandEnd(): void {
  audio.duck(0.5, 0.8);
  audio.tone({ freq: 293.66, dur: 0.3, gain: 0.09, wave: "triangle", cutoff: 2200, sustain: 0.4, space: 0.5 });
  audio.tone({ freq: 440.0, dur: 0.44, gain: 0.075, wave: "triangle", cutoff: 2400, delay: 0.13, sustain: 0.4, space: 0.55 });
  audio.tone({ freq: 146.83, dur: 1.0, gain: 0.055, wave: "sine", cutoff: 500, attack: 0.03, sustain: 0.45, space: 0.45 });
  audio.vibrate(16);
}

/** Vitória na partida — motivo da coroa completo, com brilho e sala grande. */
export function sfxVictory(): void {
  audio.duck(0.22, 2.4);
  CROWN.forEach((f, i) => {
    const d = i * 0.135;
    audio.tone({ freq: f, dur: 0.5, gain: 0.12, wave: "triangle", cutoff: 3200, delay: d, attack: 0.015, sustain: 0.45, space: 0.55 });
    audio.tone({ freq: f * 2, dur: 0.38, gain: 0.04, wave: "sine", delay: d + 0.02, space: 0.65 });
    audio.tone({ freq: f / 2, dur: 0.6, gain: 0.05, wave: "sine", cutoff: 600, delay: d, space: 0.4 });
  });
  // acorde final sustentado (Ré maior) + cintilância
  [587.33, 739.99, 880.0].forEach((f, i) => {
    audio.tone({ freq: f, dur: 1.8, gain: 0.075 - i * 0.014, wave: "triangle", cutoff: 3000, delay: 0.58, attack: 0.04, sustain: 0.55, space: 0.7 });
  });
  audio.tone({ freq: 146.83, dur: 2.2, gain: 0.08, wave: "sine", cutoff: 420, delay: 0.58, attack: 0.05, sustain: 0.6, space: 0.5 });
  audio.noise({ freq: 6000, to: 2200, q: 0.5, dur: 1.1, gain: 0.032, delay: 0.55, space: 0.8 });
  audio.vibrate([30, 50, 30, 50, 120]);
}

/** Fim de partida sem vitória sua — digno, não punitivo. */
export function sfxDefeat(): void {
  audio.duck(0.3, 1.8);
  [293.66, 246.94, 220.0].forEach((f, i) => {
    audio.tone({ freq: f, dur: 0.7 + i * 0.2, gain: 0.09, wave: "triangle", cutoff: 1800, delay: i * 0.26, attack: 0.03, sustain: 0.45, space: 0.5 });
  });
  audio.tone({ freq: 110, dur: 1.6, gain: 0.07, wave: "sine", cutoff: 380, delay: 0.5, attack: 0.06, sustain: 0.5, space: 0.45 });
  audio.vibrate(30);
}

// ---- encerramento da partida (Placar Final) ----

/** A última vaza cai e a partida "vira": swell que corta a mesa e abre o encerramento. */
export function sfxFinalSwell(): void {
  audio.duck(0.12, 2.6);
  audio.noise({ freq: 300, to: 5200, q: 0.7, dur: 1.15, gain: 0.06, space: 0.7 });
  audio.tone({ freq: 73.42, dur: 2.2, gain: 0.11, wave: "sine", cutoff: 340, attack: 0.5, sustain: 0.5, space: 0.5 });
  audio.tone({ freq: 146.83, to: 293.66, dur: 1.2, gain: 0.06, wave: "triangle", cutoff: 1600, attack: 0.4, sustain: 0.5, space: 0.65 });
  audio.vibrate([25, 70, 25]);
}

/** Tique da contagem de pontos. Chamado dezenas de vezes: precisa ser mínimo. */
export function sfxCountTick(step: number): void {
  const f = 520 + (step % 6) * 42; // sobe em degraus: dá sensação de acúmulo
  audio.tone({ freq: f, dur: 0.035, gain: 0.032, wave: "sine", space: 0.25 });
}

/** As linhas do ranking trocam de lugar. */
export function sfxRankShuffle(): void {
  audio.noise({ freq: 900, to: 2600, q: 1.1, dur: 0.4, gain: 0.05, space: 0.5 });
  audio.tone({ freq: 220, to: 440, dur: 0.42, gain: 0.045, wave: "triangle", cutoff: 2000, attack: 0.05, sustain: 0.4, space: 0.5 });
  audio.vibrate(14);
}

/** A coroa desce sobre o campeão — o impacto heroico do encerramento. */
export function sfxCrownLand(): void {
  audio.duck(0.14, 2.2);
  audio.noise({ freq: 5000, to: 1400, q: 0.6, dur: 0.55, gain: 0.055, space: 0.75 });
  audio.tone({ freq: 110, dur: 1.1, gain: 0.14, wave: "sine", cutoff: 400, attack: 0.008, sustain: 0.35, space: 0.5 });
  audio.tone({ freq: 293.66, dur: 0.9, gain: 0.08, wave: "triangle", cutoff: 2600, attack: 0.006, sustain: 0.4, space: 0.6 });
  audio.vibrate([60, 40, 140]);
}

/**
 * ÚLTIMA MÃO DO JOGO — o motivo da coroa, uma vez por partida.
 *
 * Toca exatamente uma vez em dez mãos, então pode ser o gesto mais cheio do jogo sem cansar
 * ninguém: a tríade sobe, o grave assenta embaixo e a vibração faz o "tum-tá" curto do anúncio.
 * Com efeitos desligados, `audio.tone` sai cedo e o anúncio continua inteiro na tela — o texto é
 * que carrega a informação; isto aqui é a moldura.
 */
export function sfxUltimaMao(): void {
  audio.duck(0.16, 1.6);
  audio.tone({ freq: 392.00, dur: 0.5, gain: 0.075, wave: "triangle", cutoff: 2600, attack: 0.005, sustain: 0.35, space: 0.5 });
  audio.tone({ freq: 493.88, dur: 0.55, gain: 0.065, wave: "triangle", cutoff: 2800, attack: 0.006, delay: 0.09, sustain: 0.4, space: 0.55 });
  audio.tone({ freq: 587.33, dur: 0.8, gain: 0.07, wave: "sine", cutoff: 3200, attack: 0.006, delay: 0.18, sustain: 0.45, space: 0.65 });
  audio.tone({ freq: 146.83, dur: 1.0, gain: 0.11, wave: "sine", cutoff: 420, attack: 0.01, sustain: 0.4, space: 0.4 });
  audio.vibrate([40, 60, 90]);
}

/** É a sua vez. Discreto — toca muitas vezes por partida. */
export function sfxYourTurn(): void {
  audio.tone({ freq: 880, dur: 0.09, gain: 0.055, wave: "sine", space: 0.3 });
  audio.tone({ freq: 1174.66, dur: 0.13, gain: 0.038, wave: "sine", delay: 0.07, space: 0.35 });
  audio.vibrate(10);
}

/**
 * ÚLTIMOS 10 SEGUNDOS do seu turno. Toca UMA vez, na virada 11 → 10 — nunca a cada segundo:
 * um tique repetido vira ruído, e ruído deixa de ser aviso.
 *
 * Terça menor descendente, curta e seca: lê como "atenção" sem soar alarme de incêndio. Segue a
 * paleta de tensão (magenta) do resto do jogo. Respeita o toggle de efeitos automaticamente,
 * porque `audio.tone` sai cedo quando os efeitos estão desligados.
 */
export function sfxTempoAcabando(): void {
  audio.tone({ freq: 622.25, dur: 0.07, gain: 0.05, wave: "triangle", space: 0.15 });
  audio.tone({ freq: 466.16, dur: 0.11, gain: 0.045, wave: "triangle", delay: 0.08, space: 0.2 });
  audio.vibrate(14);
}

/**
 * Mensagem social — a sua e a dos outros.
 *
 * Curto e agudo, sem peso: precisa fazer a cabeça levantar sem competir com o som da carta nem
 * assustar quem está decidindo. Duas notas ascendentes — a inflexão de quem chamou seu nome.
 */
export function sfxSocial(): void {
  audio.tone({ freq: 587.33, dur: 0.05, gain: 0.04, wave: "sine", space: 0.18 });
  audio.tone({ freq: 880.0, dur: 0.07, gain: 0.032, wave: "sine", delay: 0.055, space: 0.24 });
  audio.vibrate(10);
}
