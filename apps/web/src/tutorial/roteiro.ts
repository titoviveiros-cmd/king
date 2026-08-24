// APRENDA KING — o roteiro.
//
// Dezesseis conceitos, quatro cenas, uma regra de ouro: **ensinar jogando**. Nada aqui é uma
// página de texto com um botão "próximo" — cada conceito ou aparece na mesa enquanto o Rei fala
// uma linha, ou é a própria jogada que o aluno faz.
//
// SEGUNDA REGRA: NINGUÉM FICA PRESO. Jogada errada não repete o passo nem bloqueia o avanço — o
// Rei explica o que aconteceu e a partida segue. Tutorial que trava é tutorial que se abandona,
// e quem abandona o tutorial abandona o jogo.
//
// Os números de pontuação abaixo (−20, −50, −30, −160, −90, +25) foram conferidos linha a linha
// contra `scoreHand` do motor. Se algum mudar lá, o teste `roteiro.test.ts` reprova aqui.
import type { Card, MatchState, Trump } from "@king/engine";
import { legaisDoAluno, legaisQueEscapam, legaisQueGanham, type CenaId } from "./cenas.js";

/** Os dezesseis conceitos que o tutorial promete ensinar. A lista é o contrato com o produto. */
export const CONCEITOS = [
  "objetivo", "vaza", "fase-negativa", "servir", "vencer-vaza", "negar",
  "copas", "damas", "reis-valetes", "duas-ultimas", "king",
  "fase-positiva", "trunfo", "sem-trunfo", "mais-25", "maior-vence",
] as const;
export type Conceito = (typeof CONCEITOS)[number];

/** O que o passo espera do aluno antes de seguir. */
export type Acao = "toque" | "jogar" | "trunfo";

export interface Passo {
  id: Conceito;
  /** Cena a montar ANTES deste passo. Ausente = continua na cena anterior. */
  cena?: CenaId;
  /** A fala do Rei. Curta: ele orienta, não domina a tela. */
  fala: string;
  acao: Acao;
  /**
   * As cartas que o passo considera acerto. É DIDÁTICA, não regra — qualquer carta legal é
   * aceita pelo motor e pelo tutorial. Serve só para o Rei responder com elogio ou correção.
   */
  alvo?: (m: MatchState) => Card[];
  /** Naipe esperado no passo de trunfo. Mesma ideia: didática, não obrigação. */
  trunfoAlvo?: Trump;
  acerto?: string;
  erro?: string;
}

export const ROTEIRO: readonly Passo[] = [
  // ───────── CENA 1 · a vaza, o naipe, quem ganha (mão 1: não pegar vazas) ─────────
  {
    id: "objetivo",
    cena: "servir",
    fala: "KING são 10 mãos. Nas 6 primeiras você foge de cartas. Nas 4 últimas, corre atrás delas.",
    acao: "toque",
  },
  {
    id: "vaza",
    fala: "Cada rodada é uma VAZA: quatro cartas na mesa, uma de cada jogador.",
    acao: "toque",
  },
  {
    id: "fase-negativa",
    fala: "Esta mão é negativa. Olhe o topo da tela: quem pegar a vaza perde 20 pontos.",
    acao: "toque",
  },
  {
    id: "servir",
    fala: "Puxaram ouros e você tem ouros: é obrigado a servir. Só as válidas acendem no leque.",
    acao: "jogar",
    // A menor entre as legais: a que não leva a vaza.
    alvo: (m) => legaisQueEscapam(m),
    acerto: "Isso. Carta baixa, a vaza é de outro — e você não perde nada.",
    erro: "Essa levou a vaza, e a vaza custa −20. Numa mão negativa, ganhar é perder.",
  },
  {
    id: "vencer-vaza",
    fala: "Vence a maior carta DO NAIPE PUXADO. Carta de outro naipe não ganha — nem o Ás.",
    acao: "toque",
  },

  // ───────── CENA 2 · negar ─────────
  {
    id: "negar",
    cena: "negar",
    fala: "Agora puxaram copas e você não tem nenhuma. Sem o naipe, você NEGA: joga qualquer carta.",
    acao: "jogar",
    alvo: (m) => legaisDoAluno(m),
    acerto: "Isso. Negar é a hora de se livrar de uma carta perigosa sem levar a vaza.",
  },

  // ───────── CENA 3 · as mãos negativas e o Rei de Copas ─────────
  {
    id: "copas",
    cena: "king",
    fala: "São cinco perigos diferentes. Na mão 2, cada copas que você pegar custa −20.",
    acao: "toque",
  },
  {
    id: "damas",
    fala: "Na mão 3, cada DAMA custa −50. São quatro na mesa.",
    acao: "toque",
  },
  {
    id: "reis-valetes",
    fala: "Na mão 4, cada REI e cada VALETE custam −30. São oito no baralho.",
    acao: "toque",
  },
  {
    id: "duas-ultimas",
    fala: "Na mão 6, as DUAS ÚLTIMAS vazas custam −90 cada. O fim da mão fica tenso.",
    acao: "toque",
  },
  {
    id: "king",
    fala: "E esta é a mão 5. O REI DE COPAS está na mesa: uma carta só, −160. Não leve esta vaza.",
    acao: "jogar",
    alvo: (m) => legaisQueEscapam(m),
    acerto: "Perfeito. Carta baixa, a vaza é de outro — e o Rei é problema dele.",
    erro: "Levou a vaza com o Rei de Copas dentro: −160 de uma vez. É a carta mais cara do jogo.",
  },

  // ───────── CENA 4 · a fase positiva ─────────
  {
    id: "fase-positiva",
    cena: "positiva",
    fala: "Da mão 7 em diante o jogo vira: cada vaza que você pegar vale +25.",
    acao: "toque",
  },
  {
    id: "trunfo",
    fala: "E é você quem escolhe o TRUNFO: o naipe que ganha de todos os outros. Olhe sua mão.",
    acao: "trunfo",
    trunfoAlvo: "clubs",
    acerto: "Boa escolha: paus é seu naipe mais longo, e você tem o Ás.",
    erro: "Vale. Mas você tinha cinco paus com o Ás — trunfo costuma ser o naipe mais longo.",
  },
  {
    id: "sem-trunfo",
    fala: "Dava para escolher SEM TRUNFO. Aí nenhum naipe manda: vence a maior do naipe puxado.",
    acao: "toque",
  },
  {
    id: "mais-25",
    fala: "Sua vez. Agora você QUER a vaza — pegue esta.",
    acao: "jogar",
    alvo: (m) => legaisQueGanham(m),
    acerto: "É isso. +25 no seu placar.",
    erro: "Essa não levou a vaza. Na fase positiva, vaza perdida é ponto que não vem.",
  },
  {
    id: "maior-vence",
    fala: "No fim das 10 mãos, quem tiver mais pontos vence. Só isso. Bom jogo.",
    acao: "toque",
  },
];

/** Quantos passos o tutorial tem. Usado pelo indicador de progresso e pela persistência. */
export const TOTAL_DE_PASSOS = ROTEIRO.length;

/**
 * O passo de um índice, saturado nas pontas.
 *
 * Nunca devolve `undefined`: um índice salvo de uma versão antiga do roteiro (o jogador parou no
 * passo 14 e o roteiro encolheu para 12) tem de abrir o tutorial mesmo assim, e não numa tela
 * branca.
 */
export function passoEm(indice: number): Passo {
  const i = Math.min(Math.max(Math.trunc(indice) || 0, 0), ROTEIRO.length - 1);
  return ROTEIRO[i];
}

/** A cena vigente num índice: a última declarada até ali. */
export function cenaEm(indice: number): CenaId {
  for (let i = Math.min(indice, ROTEIRO.length - 1); i >= 0; i--) {
    const c = ROTEIRO[i].cena;
    if (c) return c;
  }
  return "servir";
}
