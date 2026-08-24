// A PARTIDA DO TUTORIAL.
//
// Mesma camada de leitura do jogo local e do multiplayer (`LeituraDaPartida`), então a Mesa não
// sabe que está num tutorial: ela desenha cartas, vaza, HUD e placar exatamente como sempre.
// É o que garante que o aluno aprende na tela em que vai jogar, e não numa maquete dela.
//
// A diferença para `KingGame` é só o começo: aqui o estado nasce de uma CENA (semente + mão
// escolhidas pelo roteiro) em vez de uma partida do zero. Depois disso, tudo é motor.
import { playCard, selectTrump, type Card, type MatchState, type Trump } from "@king/engine";
import { LeituraDaPartida } from "../game/leituraDaPartida.js";
import { ALUNO, avancarBots, montarCena, type CenaId } from "./cenas.js";

export class PartidaDeTreino extends LeituraDaPartida {
  constructor(cena: CenaId) {
    super(montarCena(cena), ALUNO);
  }

  /** O estado cru — o roteiro precisa dele para calcular o alvo didático de cada passo. */
  estado(): MatchState {
    return this.m;
  }

  /**
   * Joga pelo aluno. Passa por `playCard`, então jogada ilegal lança — como deve ser. A tela só
   * oferece cartas legais, mas quem valida continua sendo o motor, não a apresentação.
   */
  jogar(carta: Card): void {
    playCard(this.m, ALUNO, carta);
    avancarBots(this.m);
  }

  escolherTrunfo(trunfo: Trump): void {
    selectTrump(this.m, ALUNO, trunfo);
    avancarBots(this.m);
  }
}
