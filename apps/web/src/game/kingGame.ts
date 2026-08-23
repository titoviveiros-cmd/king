// MODO LOCAL / BOTS — a partida roda inteira dentro do navegador.
//   packages/engine  →  LeituraDaPartida  →  KingGame (muta o MatchState)  →  Presentation
//
// Toda a LEITURA vive em `LeituraDaPartida`, compartilhada com o multiplayer. Aqui ficam só as
// MUTAÇÕES locais: criar a partida, jogar pelo humano, dar o passo dos bots e virar a mão.
// No multiplayer nada disto existe — quem muta é o servidor (ver `partidaRemota.ts`).
import {
  createMatch, startNextHand, selectTrump, playCard, buildBotView, chooseNormalCard, chooseNormalTrump,
  type Card, type Trump, type Seat, type MatchState,
} from "@king/engine";
import { LeituraDaPartida } from "./leituraDaPartida.js";

export type { Phase } from "./leituraDaPartida.js";

/** A partida já começa com a primeira mão distribuída — é o estado inicial da Mesa. */
function partidaNova(players: string[], seed: number): MatchState {
  const m = createMatch(players, seed);
  startNextHand(m);
  return m;
}

export class KingGame extends LeituraDaPartida {
  /**
   * `humanSeat` é parâmetro (e não mais a constante 0) porque a Mesa passou a girar em torno do
   * assento do jogador para suportar o multiplayer. No modo local ele continua sendo 0 — o
   * comportamento é idêntico ao de antes, byte a byte.
   */
  constructor(players: string[], seed: number, humanSeat: Seat = 0) {
    super(partidaNova(players, seed), humanSeat);
  }

  // ---- ações do humano ----
  playHuman(card: Card): void { playCard(this.m, this.humanSeat, card); }
  chooseTrumpHuman(trump: Trump): void { selectTrump(this.m, this.humanSeat, trump); }

  // ---- passos dos bots (síncronos; a UI adiciona o timing) ----
  needsBotTrump(): boolean { return this.phase() === "trump" && this.awaitingTrumpFrom() !== this.humanSeat; }
  stepBotTrump(): void { const seat = this.awaitingTrumpFrom()!; selectTrump(this.m, seat, chooseNormalTrump(buildBotView(this.m, seat).hand)); }
  needsBotPlay(): boolean { return this.phase() === "play" && this.turn() !== this.humanSeat; }
  stepBotPlay(): { seat: Seat; card: Card } {
    const seat = this.turn()!;
    const card = chooseNormalCard(buildBotView(this.m, seat));
    playCard(this.m, seat, card);
    return { seat, card };
  }

  // ---- transição de mão ----
  advanceHand(): void { if (this.phase() === "handEnd" && !this.m.finished) startNextHand(this.m); }
}
