// O PLACAR DA MÃO DO REI — o tempo mínimo de leitura depois da cena "O REI FOI CAPTURADO".
//
// A captura do K♥ encerra a mão 5 e a mesa fica 6,5s parada na cena (`leituraDaVazaKing`). Só
// depois o Placar entra. Nas outras nove mãos ninguém espera nada aqui: o solo avança quando o
// jogador toca, o online quando o servidor libera (piso geral de 8s, do servidor).
//
// QUEM SEGURA:
//   • SOLO — este arquivo. "Próxima mão" não responde antes de `leituraDoPlacarDoRei()` de Placar
//     na tela (5s = 11,5s − 6,5s): o botão nasce desabilitado e o hook ignora o pedido cedo.
//   • ONLINE — o servidor (`apps/server/src/match/pisoDoPlacar.ts`), com o MESMO número. O cliente
//     online não segura nada: "Estou pronto" é um voto, e votar cedo não encurta o piso. Por isso um
//     cliente ANTIGO, que não conhece esta regra, recebe o mesmo comportamento de um novo.
//
// Função pura sobre a leitura da partida: o modo local e o remoto respondem igual.
import type { LeituraDaPartida } from "./leituraDaPartida.js";
import { TEMPOS } from "./timings.js";

/** O Placar na tela é o da mão do Rei? (mão encerrada, partida em curso, "Não pegar o Rei de Copas") */
export function ehPlacarDoRei(g: LeituraDaPartida | null): boolean {
  return !!g && g.handOver() && g.contract()?.kind === "no-king";
}

/**
 * Quanto tempo o Placar da mão do Rei fica na tela antes de "Próxima mão" responder, contado da
 * entrada do Placar (= fim da pausa do King). Derivado, nunca copiado: piso − pausa.
 */
export const leituraDoPlacarDoRei = (): number => TEMPOS.pisoDoPlacarDoRei - TEMPOS.leituraDaVazaKing;

/**
 * SOLO: o pedido de próxima mão pode ser atendido agora?
 *
 * @param placarEntrouEm quando o Placar entrou (fim da pausa de leitura; `pausaAte()` da
 *   apresentação). Fora da mão do Rei responde sempre `true` — as outras nove mãos não mudam.
 */
export function podeAvancarDoPlacar(g: LeituraDaPartida | null, placarEntrouEm: number, agora: number): boolean {
  if (!ehPlacarDoRei(g)) return true;
  // Sem instante conhecido (pausa "infinita" de uma tela por cima): não libera.
  if (!Number.isFinite(placarEntrouEm)) return false;
  return agora >= placarEntrouEm + leituraDoPlacarDoRei();
}
