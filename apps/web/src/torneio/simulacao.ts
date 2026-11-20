// AS MESAS SÓ DE BOTS — partidas DE VERDADE, sem tela.
//
// Nenhum resultado de bot é inventado: cada mesa sem o humano é uma partida inteira do KING,
// jogada pelo motor oficial com o Bot Normal nos quatro assentos — o mesmo `chooseNormalCard` /
// `chooseNormalTrump` que joga contra você na mesa solo (ver `KingGame.stepBotPlay`). A diferença
// é só que ninguém assiste: não há animação, pausa de leitura nem som.
//
// DETERMINISMO: o motor embaralha pela semente da partida e o Bot Normal não sorteia nada. Mesma
// semente e mesmos nomes → mesma partida, jogada por jogada. É o que deixa a persistência conferir
// um resultado salvo refazendo a partida, e o teste provar que nada mudou de uma execução a outra.
//
// FATIAS: a simulação é um GERADOR que cede o controle ao fim de cada mão. Quem a conduz
// (`executor.ts`) devolve a vez ao navegador entre uma fatia e outra, e a interface não congela
// enquanto oito mesas de Copa são jogadas.
import {
  createMatch, startNextHand, selectTrump, playCard, buildBotView, chooseNormalCard, chooseNormalTrump,
  matchStats, type MatchState, type Seat,
} from "@king/engine";
import type { FatosDaMesa } from "./desempate.js";

/** Os fatos que o torneio usa, lidos do estado do motor — nunca recalculados. */
export function fatosDoEstado(m: MatchState): FatosDaMesa {
  return {
    pontos: m.cumulative.slice(),
    negativas: m.negatives.slice(),
    ilesas: matchStats(m).perSeat.map((s) => s.cleanNegatives),
  };
}

/** Joga UMA mão inteira com o Bot Normal nos quatro assentos. */
function jogarMaoDeBots(m: MatchState): void {
  startNextHand(m);
  const h = m.hand!;
  if (h.awaitingTrumpFrom !== null) {
    const quem = h.awaitingTrumpFrom;
    selectTrump(m, quem, chooseNormalTrump(buildBotView(m, quem).hand));
  }
  let guarda = 0;
  while (m.hand && m.hand.handScores === null) {
    const seat = m.hand.turn as Seat;
    playCard(m, seat, chooseNormalCard(buildBotView(m, seat)));
    // 52 jogadas fecham qualquer mão; passar disso é defeito, não partida longa.
    if (++guarda > 52) throw new Error("Mesa do torneio: a mão não terminou em 52 jogadas");
  }
}

/**
 * A partida de uma mesa de bots, em fatias. Cada `yield` devolve o número da mão que acabou de
 * terminar (1..10); o valor de retorno são os fatos da partida completa.
 */
export function* partidaDeBots(nomes: readonly string[], semente: number): Generator<number, FatosDaMesa, void> {
  const m = createMatch(nomes.slice(), semente);
  while (!m.finished) {
    jogarMaoDeBots(m);
    yield m.handNumber;
  }
  return fatosDoEstado(m);
}

/** A mesma partida, de uma vez. Para testes e para conferência — a interface usa as fatias. */
export function jogarMesaDeBots(nomes: readonly string[], semente: number): FatosDaMesa {
  const g = partidaDeBots(nomes, semente);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}
