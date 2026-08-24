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

/** O assento de quem está aprendendo. Sempre 0 — a Mesa gira em torno dele. */
export const ALUNO: Seat = 0;

export const JOGADORES_DO_TREINO = ["Você", "Bia", "Léo", "Nara"];

export type CenaId = "servir" | "baldar" | "king" | "positiva";

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

  // Copas puxadas, o aluno não tem nenhuma: o leque inteiro acende. É o que "baldar" significa.
  baldar: { seed: 26, mao: 1, porque: "baldar quando falta o naipe puxado" },

  // 2♠ 10♠ K♥ na mesa. Sete espadas na mão: quatro comem o Rei de Copas, três escapam.
  // Decisão de verdade, com −160 em jogo e saída fácil para quem entendeu.
  king: { seed: 337, mao: 5, porque: "o Rei de Copas vale -160 e dá para não pegá-lo" },

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
