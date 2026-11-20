// O PISO DO PLACAR ENTRE-MÃOS — quando, no mais cedo, a mão seguinte pode começar.
//
// ══ A REGRA GERAL (nove das dez mãos) ══
//
// `pisoDoPlacar` (8s) contado do instante em que a mão acabou no servidor. Ninguém avança antes,
// nem com os quatro prontos de imediato, nem com auto-ready.
//
// ══ A MÃO DO REI (mão 5, "Não pegar o Rei de Copas") ══
//
// A captura do K♥ ENCERRA a mão 5, e a mesa fica 6,5s parada na cena "O REI FOI CAPTURADO"
// (`leituraDaVazaKing`) antes de o Placar entrar. Com o piso geral, sobrava ~1,5s de Placar — os
// quatro confirmavam por reflexo e a tela sumia sem ninguém ler quem perdeu os 160.
//
// Nesta mão vale `pisoDoPlacarDoRei` (11,5s = 6,5s de cena + 4,6s de leitura + 0,4s de folga), e
// ele conta de outro instante: quando a vaza do K♥ ENTRA na mesa do cliente, segundo o espelho da
// fila (`publicarNoEspelho`). Se a carta que fechou a vaza esperou a cadência atrás de outras, a
// cena começou depois — e o Placar também. Contar do servidor deixaria esse atraso sair da leitura.
//
// A LATÊNCIA DE REDE NÃO ENTRA NA CONTA, e não precisa: o Placar chega ao cliente com o mesmo
// atraso que o avanço da mão. O que o jogador vê entre um e outro é a distância entre os dois
// instantes do servidor — e é essa distância que este piso garante.
//
// Função PURA: sem relógio, sem Room. A Room passa os instantes; os testes também.
import type { MatchState } from "@king/engine";
import { TEMPOS } from "./tempos.js";

/**
 * A mão que acabou é a do Rei? Mão encerrada (há placar), partida ainda em curso (na última mão
 * quem entra é o Placar Final, que tem encenação própria) e contrato "Não pegar o Rei de Copas".
 *
 * Pelo CONTRATO e não pelo número da mão: a regra é da cena, e a cena é deste contrato. Que ele é
 * sempre a mão 5 é o motor quem diz (`HAND_CONTRACTS`), e o `cinematica.test.ts` prova em partidas
 * inteiras que a captura do K♥ sempre encerra a mão.
 */
export function ehPlacarDoRei(m: MatchState | null): boolean {
  const h = m?.hand;
  return !!m && !m.finished && !!h && h.handScores !== null && h.contract.kind === "no-king";
}

/**
 * O instante (ms, relógio do servidor) a partir do qual a mão seguinte pode começar.
 *
 * @param maoTerminouEm quando a mão acabou no servidor (origem do piso geral).
 * @param vazaFinalEntraEm quando a vaza que encerrou a mão entra na mesa do cliente (espelho da
 *   fila). `null`/0 = desconhecido; vale o fim da mão. Nunca ANTES do fim da mão.
 */
export function placarLiberadoEm(p: {
  m: MatchState | null;
  maoTerminouEm: number;
  vazaFinalEntraEm: number | null;
}): number {
  const geral = p.maoTerminouEm + TEMPOS.pisoDoPlacar;
  if (!ehPlacarDoRei(p.m)) return geral;
  const origem = Math.max(p.maoTerminouEm, p.vazaFinalEntraEm || 0);
  // `max` com o geral: se um dia o piso geral passar do do Rei, a mão do Rei não fica MENOR.
  return Math.max(geral, origem + TEMPOS.pisoDoPlacarDoRei);
}
