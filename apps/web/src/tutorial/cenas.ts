// CENÁRIOS DO TUTORIAL — situações de ensino montadas pelo MOTOR DE VERDADE.
//
// A regra que este arquivo existe para respeitar: **o tutorial não pode ensinar nada que o motor
// não permita**. Por isso nada aqui é fabricado à mão. Não há mão montada, não há carta colocada
// na mesa por fora, não há regra reimplementada "só para explicar".
//
// O que o tutorial escolhe é só o QUE É DELE ESCOLHER: a semente e o número da mão. Todo o resto
// — o embaralhamento, quem abre, o que é legal, quem vence, quanto custa — sai de
// `createMatch` / `startNextHand` / `playCard` / `legalCardsFor`, exatamente como numa partida.
//
// As sementes abaixo NÃO foram inventadas: uma busca varreu milhares delas procurando a situação
// didática de cada cena. Se um dia o embaralhamento mudar, os testes deste módulo quebram — que é
// o comportamento certo, porque a lição teria mudado junto.
import {
  buildBotView, chooseNormalCard, createMatch, legalCardsFor, playCard, resolveTrick, startNextHand,
  type Card, type MatchState, type Seat,
} from "@king/engine";
import { NOMES_DA_MESA_LOCAL } from "../game/adversarios.js";

/** O assento de quem está aprendendo. Sempre 0 — a Mesa gira em torno dele. */
export const ALUNO: Seat = 0;

/**
 * Os mesmos quatro do modo local, e não uma mesa própria.
 *
 * O tutorial ensina na Mesa de verdade; ensinar com adversários que não existem em lugar nenhum
 * do jogo seria uma inconsistência gratuita — a pessoa sai do tutorial e encontra outra gente.
 */
export const JOGADORES_DO_TREINO = NOMES_DA_MESA_LOCAL;

export type CenaId =
  | "servir" | "negar" | "copas" | "damas" | "reis-valetes" | "king" | "duas-ultimas" | "positiva";

export interface DefinicaoDeCena {
  seed: number;
  /** Mão 1..10. Define o contrato — é o motor que diz qual é. */
  mao: number;
  /** O que esta cena existe para ensinar. Documentação, não comportamento. */
  porque: string;
}

export const CENAS: Record<CenaId, DefinicaoDeCena> = {
  // 2♦ 4♦ 9♦ na mesa; o aluno tem K♦, 8♦ e 6♦. É obrigado a servir ouros e a escolha importa:
  // o Rei ganha a vaza (péssimo numa mão negativa), o 6 escapa.
  servir: { seed: 1, mao: 1, porque: "servir o naipe, e a menor carta como escolha certa" },

  // Copas puxadas, o aluno não tem nenhuma: o leque inteiro acende. É o que NEGAR significa.
  negar: { seed: 26, mao: 1, porque: "negar quando falta o naipe puxado" },

  // ── AS MÃOS QUE O ALUNO SÓ PRECISA RECONHECER ──
  //
  // Passos de leitura, e mesmo assim cada um monta a SUA mão. O motivo é uma queixa concreta: a
  // versão anterior explicava as mãos 2, 3, 4 e 6 com o card do contrato mostrando "Mão 5" o
  // tempo todo. O aluno lia uma coisa e via outra, e a mão 5 parecia não existir na sequência.
  // Agora o card do canto mostra exatamente a mão de que o Rei está falando, e o aluno pode
  // tocar nele para ver as dez de uma vez.
  //
  // Aqui a semente não precisa procurar situação nenhuma: ninguém joga nestes passos. O que
  // importa é a mão certa, montada pelo motor, com a mesa coerente.
  copas: { seed: 1, mao: 2, porque: "reconhecer a mão 2 no card do contrato" },
  damas: { seed: 1, mao: 3, porque: "reconhecer a mão 3 no card do contrato" },
  "reis-valetes": { seed: 1, mao: 4, porque: "reconhecer a mão 4 no card do contrato" },

  // 2♠ 10♠ K♥ na mesa. Sete espadas na mão: quatro comem o Rei de Copas, três escapam.
  // Decisão de verdade, com −160 em jogo e saída fácil para quem entendeu.
  king: { seed: 337, mao: 5, porque: "o Rei de Copas vale -160 e dá para não pegá-lo" },

  "duas-ultimas": { seed: 1, mao: 6, porque: "reconhecer a mão 6 no card do contrato" },

  // Mão 7: a rotação do motor manda o assento 0 escolher o trunfo. Cinco PAUS com o Ás — e,
  // escolhido paus, a vaza seguinte vem com o Rei de paus na mesa: só o Ás ganha.
  //
  // A semente 1 chegou a ser usada aqui e foi DESCARTADA por um teste: lá, depois do trunfo,
  // nenhuma carta legal do aluno vencia a vaza. O passo "agora você QUER a vaza" pediria o
  // impossível — exatamente o tipo de mentira que o tutorial não pode contar.
  positiva: { seed: 9, mao: 7, porque: "fase positiva, escolha de trunfo e +25 por vaza" },
};

/**
 * Monta a cena e deixa o estado exatamente na vez do aluno.
 *
 * `handNumber` é ajustado antes de `startNextHand` porque o tutorial precisa começar na mão 5 sem
 * jogar as quatro anteriores. É a única coisa que este módulo escreve no estado — e é escolha de
 * roteiro, não de regra: qual mão treinar. O contrato, a distribuição e o dealer continuam vindo
 * do motor a partir dela.
 */
export function montarCena(id: CenaId): MatchState {
  const { seed, mao } = CENAS[id];
  const m = createMatch(JOGADORES_DO_TREINO, seed);
  m.handNumber = mao - 1;
  startNextHand(m);
  avancarBots(m);
  return m;
}

/**
 * Deixa os bots jogarem até a vez do aluno.
 *
 * É o BOT NORMAL de verdade — o mesmo da partida contra a máquina. Como ele é determinístico,
 * a cena inteira é reprodutível sem roteirizar carta nenhuma: mesma semente, mesmas jogadas,
 * sempre. E o aluno nunca vê um lance que um bot de verdade não faria.
 */
export function avancarBots(m: MatchState): void {
  // O laço tem teto porque um bug de turno no motor não pode virar travamento de tela.
  for (let passo = 0; passo < 8; passo++) {
    const h = m.hand;
    if (!h || h.handScores !== null) return;
    if (h.awaitingTrumpFrom !== null) return; // a mão positiva espera o trunfo do aluno
    if (h.turn === null || h.turn === ALUNO) return;
    playCard(m, h.turn, chooseNormalCard(buildBotView(m, h.turn)));
  }
}

// ───────────────────────── leitura da situação, para a didática ─────────────────────────
//
// As funções abaixo respondem "qual seria a boa jogada aqui?" a partir do ESTADO, nunca de uma
// lista fixa de cartas. Assim a microcopy do Rei e o alvo do exercício não podem divergir do que
// a mesa está mostrando.

/** As cartas que o motor aceita agora. Fonte única: `legalCardsFor`. */
export const legaisDoAluno = (m: MatchState): Card[] => legalCardsFor(m, ALUNO);

/** Esta carta faria o aluno VENCER a vaza em curso? */
export function venceriaAVaza(m: MatchState, carta: Card): boolean {
  const h = m.hand;
  if (!h) return false;
  return resolveTrick([...h.currentTrick, { seat: ALUNO, card: carta }], h.trump) === ALUNO;
}

/** Cartas legais que NÃO levam a vaza — o que se quer numa mão negativa. */
export const legaisQueEscapam = (m: MatchState): Card[] =>
  legaisDoAluno(m).filter((c) => !venceriaAVaza(m, c));

/** Cartas legais que LEVAM a vaza — o que se quer numa mão positiva. */
export const legaisQueGanham = (m: MatchState): Card[] =>
  legaisDoAluno(m).filter((c) => venceriaAVaza(m, c));

/** O naipe puxado na vaza em curso, ou `null` se ninguém abriu ainda. */
export const naipePuxado = (m: MatchState): Card["suit"] | null =>
  m.hand?.currentTrick[0]?.card.suit ?? null;
