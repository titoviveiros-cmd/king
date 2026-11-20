// OS DOIS FORMATOS DO MINI-TORNEIO — e a única coisa que muda entre eles é o tamanho da chave.
//
// A mesa é SEMPRE a mesa oficial do KING: 4 assentos, 10 mãos, a pontuação das cartas. O torneio
// não inventa variante nenhuma — ele só decide quem senta com quem e quem segue adiante. Por isso
// os formatos são descritos por quantas mesas cada fase tem, e o resto (2 classificados por mesa,
// mesas de 4) é constante do torneio, não do formato.

export type FormatoId = "mini16" | "copa32";

/** Quantos de cada mesa seguem para a fase seguinte. Constante do torneio, não do formato. */
export const CLASSIFICADOS_POR_MESA = 2;
/** O contrato oficial: toda mesa tem quatro assentos. */
export const ASSENTOS_POR_MESA = 4;

export interface Formato {
  id: FormatoId;
  /** O nome que a pessoa vê ao escolher. */
  nome: string;
  /** "do mini-torneio" / "da Copa Completa": o nome no meio da frase, com o artigo certo. */
  doNome: string;
  /**
   * O título da celebração — o mesmo texto aparece sem som e sem movimento. Escrito em caixa
   * normal (é o que o leitor de tela lê); a caixa alta da celebração e da tela final é só CSS.
   */
  tituloDoCampeao: string;
  /** A frase da vitória do humano, abaixo do título. */
  fraseDaVitoria: string;
  participantes: number;
  /** Nome de cada fase, da primeira à final. O comprimento é o número de partidas no caminho. */
  fases: readonly string[];
}

export const FORMATOS: Record<FormatoId, Formato> = {
  mini16: {
    id: "mini16",
    nome: "Mini-torneio",
    doNome: "do mini-torneio",
    tituloDoCampeao: "Campeão do mini-torneio!",
    fraseDaVitoria: "Você venceu o mini-torneio!",
    participantes: 16,
    fases: ["Mesas iniciais", "Semifinal", "Final"],
  },
  copa32: {
    id: "copa32",
    nome: "Copa Completa",
    doNome: "da Copa Completa",
    tituloDoCampeao: "Campeão da Copa!",
    fraseDaVitoria: "Você venceu a Copa Completa!",
    participantes: 32,
    fases: ["Mesas iniciais", "Quartas de final", "Semifinal", "Final"],
  },
};

export const ehFormato = (v: unknown): v is FormatoId => v === "mini16" || v === "copa32";

/**
 * Quantas mesas a fase `f` tem.
 *
 * Cada mesa manda 2 adiante, e a fase seguinte junta duas mesas numa só (2 + 2 = 4). Por isso o
 * número de mesas cai pela metade a cada fase — 4 → 2 → 1 no mini-torneio, 8 → 4 → 2 → 1 na Copa.
 */
export function mesasNaFase(formato: Formato, f: number): number {
  return (formato.participantes / ASSENTOS_POR_MESA) / 2 ** f;
}

export const ultimaFase = (formato: Formato): number => formato.fases.length - 1;
