// APRENDA KING — o roteiro.
//
// Dezesseis passos, oito cenas, uma regra de ouro: ensinar jogando. Nada aqui é uma página de
// texto com um botão "próximo". Cada conceito ou aparece na mesa enquanto o Rei fala uma linha,
// ou é a própria jogada que o aluno faz.
//
// SEGUNDA REGRA: NINGUÉM FICA PRESO. Jogada errada não repete o passo nem bloqueia o avanço. O
// Rei explica o que aconteceu e a partida segue. Tutorial que trava é tutorial que se abandona,
// e quem abandona o tutorial abandona o jogo.
//
// TERCEIRA REGRA, e esta veio de uma auditoria: A SEQUÊNCIA É A DO JOGO. A versão anterior
// falava em "cinco perigos" (são seis mãos negativas), pulava a mão 5 na ordem e explicava as
// mãos 2, 3, 4 e 6 com o card do contrato preso na mão 5. Agora cada passo monta a mão de que
// está falando, e o card do canto confirma o que o Rei diz.
//
// Os números de pontuação abaixo (−20, −50, −30, −160, −90, +25) foram conferidos linha a linha
// contra `scoreHand` do motor. Se algum mudar lá, o teste `roteiro.test.ts` reprova aqui.
import type { Card, MatchState, Trump } from "@king/engine";
import { legaisDoAluno, legaisQueEscapam, legaisQueGanham, type CenaId } from "./cenas.js";

/** Os dezesseis passos que o tutorial promete ensinar. A lista é o contrato com o produto. */
export const CONCEITOS = [
  "objetivo", "vaza", "servir", "negar", "maior-vence",
  "mao-1", "mao-2", "mao-3", "mao-4", "mao-5", "mao-6",
  "positivas", "trunfo", "trunfo-vence", "mais-25", "fim",
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
   * As cartas que o passo considera acerto. É DIDÁTICA, não regra: qualquer carta legal é
   * aceita pelo motor e pelo tutorial. Serve só para o Rei responder com elogio ou correção.
   */
  alvo?: (m: MatchState) => Card[];
  /** Naipe esperado no passo de trunfo. Mesma ideia: didática, não obrigação. */
  trunfoAlvo?: Trump;
  acerto?: string;
  erro?: string;
}

export const ROTEIRO: readonly Passo[] = [
  // ───────── O jogo, a vaza e as duas regras que valem a partida inteira ─────────
  {
    id: "objetivo",
    cena: "servir",
    fala: "KING tem 10 mãos. Nas 6 primeiras você evita pontos negativos. Nas 4 últimas, vai atrás das vazas.",
    acao: "toque",
  },
  {
    id: "vaza",
    fala: "Cada jogador recebe 13 cartas. Uma mão pode ter até 13 vazas.",
    acao: "toque",
  },
  {
    id: "servir",
    fala: "A primeira carta define o naipe da vaza. Você tem ouros, então precisa jogar ouros.",
    acao: "jogar",
    // A menor entre as legais: a que não leva a vaza.
    alvo: (m) => legaisQueEscapam(m),
    acerto: "Isso. Carta baixa, a vaza fica com outro, e você não perde nada.",
    erro: "Essa levou a vaza, e a vaza custa −20. Numa mão negativa, ganhar é perder.",
  },
  {
    id: "negar",
    cena: "negar",
    fala: "Se não tiver o naipe puxado, você pode jogar outro. No KING, isso é negar.",
    acao: "jogar",
    alvo: (m) => legaisDoAluno(m),
    acerto: "Isso. Negar é a hora de se livrar de uma carta perigosa sem levar a vaza.",
  },
  {
    id: "maior-vence",
    fala: "Vence a maior carta do naipe que abriu a vaza.",
    acao: "toque",
  },

  // ───────── As seis mãos negativas, uma a uma, cada uma na sua mesa ─────────
  {
    id: "mao-1",
    fala: "Mão 1. Evite ganhar vazas. Cada uma vale −20.",
    acao: "toque",
  },
  {
    id: "mao-2",
    cena: "copas",
    fala: "Mão 2. Evite Copas. Cada Copa capturada vale −20.",
    acao: "toque",
  },
  {
    id: "mao-3",
    cena: "damas",
    fala: "Mão 3. Evite as Damas. Cada Dama vale −50.",
    acao: "toque",
  },
  {
    id: "mao-4",
    cena: "reis-valetes",
    fala: "Mão 4. Evite Reis e Valetes. Cada um vale −30.",
    acao: "toque",
  },
  {
    id: "mao-5",
    cena: "king",
    fala: "Mão 5. Fuja do K de Copas. Quem capturar essa carta recebe −160. Ele está na mesa agora.",
    acao: "jogar",
    alvo: (m) => legaisQueEscapam(m),
    acerto: "Perfeito. Carta baixa, a vaza fica com outro, e o Rei de Copas é problema dele.",
    erro: "Levou a vaza com o Rei de Copas dentro: −160 de uma vez. É a carta mais cara do jogo.",
  },
  {
    id: "mao-6",
    cena: "duas-ultimas",
    fala: "Mão 6. Cuidado com as duas últimas vazas. A 12ª e a 13ª valem −90 cada.",
    acao: "toque",
  },

  // ───────── As quatro positivas, a rotação do trunfo e o +25 ─────────
  {
    id: "positivas",
    // SEM CENA PRÓPRIA, e é a correção de um defeito achado em uso.
    //
    // Este passo montava a mão 7. Só que a mão 7 NASCE esperando o trunfo do aluno: o painel dos
    // cinco naipes aparecia aqui, um passo antes do passo que pede a escolha, e clicar nele não
    // fazia nada — o tutorial só aceita a ação no passo dela. Um controle que parece acionável e
    // não responde é pior que controle nenhum.
    //
    // A correção não é esconder o painel: é não criar a situação. Este passo ANUNCIA o que vem
    // pela frente e continua na mesa da mão 6, onde não há trunfo a escolher. A cena positiva
    // entra no passo seguinte, junto com o pedido — e aí o painel aparece já utilizável.
    fala: "Depois começam as 4 mãos positivas. Em cada uma, um jogador diferente escolhe o trunfo ou joga Sem Trunfo.",
    acao: "toque",
  },
  {
    id: "trunfo",
    cena: "positiva",
    fala: "Nesta mão é a sua vez de escolher. Pegue um naipe para trunfo, ou jogue Sem Trunfo.",
    acao: "trunfo",
    trunfoAlvo: "clubs",
    acerto: "Boa escolha: paus é seu naipe mais longo, e você tem o Ás.",
    erro: "Vale. Mas você tinha cinco paus com o Ás, e trunfo costuma ser o naipe mais longo.",
  },
  {
    id: "trunfo-vence",
    fala: "Com trunfo na vaza, vence o trunfo mais alto. Você continua obrigado a seguir o naipe puxado quando puder.",
    acao: "toque",
  },
  {
    id: "mais-25",
    fala: "Nas mãos positivas, cada vaza conquistada vale +25. Pegue esta.",
    acao: "jogar",
    alvo: (m) => legaisQueGanham(m),
    acerto: "É isso. +25 no seu placar.",
    erro: "Essa não levou a vaza. Na fase positiva, vaza perdida é ponto que não vem.",
  },
  {
    id: "fim",
    fala: "Pronto, você já sabe o essencial. Na partida, toque no card da mão para rever as 10 quando quiser.",
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
