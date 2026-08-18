// Adaptador / camada de estado da aplicação.
//   packages/engine  →  KingGame (estado da app)  →  Presentation (React)
// A UI NUNCA reimplementa regra: pergunta ao motor o estado, as cartas legais, o resultado da
// vaza, a pontuação e as transições de mão. Toda a lógica de KING vive em @king/engine.
import {
  createMatch, startNextHand, selectTrump, legalCardsFor, playCard, publicView,
  rankings, matchWinners, chooseBotCard, chooseBotTrump,
  type Card, type Trump, type Seat, type MatchState, type RankRow,
} from "@king/engine";

export type Phase = "trump" | "play" | "handEnd" | "matchEnd";

export class KingGame {
  readonly humanSeat: Seat = 0;
  private m: MatchState;

  constructor(players: string[], seed: number) {
    this.m = createMatch(players, seed);
    startNextHand(this.m);
  }

  // ---- leitura (só o que é público para o humano) ----
  players(): string[] { return this.m.players.slice(); }
  view() { return publicView(this.m, this.humanSeat); }
  handNumber(): number { return this.m.handNumber; }
  finished(): boolean { return this.m.finished; }
  cumulative(): number[] { return this.m.cumulative.slice(); }
  negatives(): number[] { return this.m.negatives.slice(); }
  positives(): number[] { return this.m.positives.slice(); }
  rankings(): RankRow[] { return rankings(this.m); }
  winners(): Seat[] { return matchWinners(this.m); }
  history() { return this.m.history.map((h) => ({ ...h, handScores: h.handScores.slice() })); }
  lastHandScores(): number[] | null {
    const last = this.m.history[this.m.history.length - 1];
    return last ? last.handScores.slice() : null;
  }
  turn(): Seat | null { return this.m.hand?.turn ?? null; }
  lastCompletedTrick() {
    const h = this.m.hand;
    if (!h || h.completedTricks.length === 0) return null;
    const t = h.completedTricks[h.completedTricks.length - 1];
    return { number: t.number, leader: t.leader, winner: t.winner, cards: t.cards.slice() };
  }
  trickNumber(): number { return this.m.hand?.trickNumber ?? 0; }
  currentTrick() { return this.m.hand ? this.m.hand.currentTrick.slice() : []; }
  handCounts(): number[] { return this.m.hand ? this.m.hand.handCounts.slice() : [13, 13, 13, 13]; }
  awaitingTrumpFrom(): Seat | null { return this.m.hand?.awaitingTrumpFrom ?? null; }
  trump(): Trump | null { return this.m.hand?.trump ?? null; }
  contract() {
    const h = this.m.hand;
    return h ? { hand: h.handNumber, kind: h.contract.kind, label: h.contract.label, isPositive: h.contract.isPositive } : null;
  }

  phase(): Phase {
    if (this.m.finished) return "matchEnd";
    const h = this.m.hand!;
    if (h.handScores !== null) return "handEnd";
    if (h.awaitingTrumpFrom !== null) return "trump";
    return "play";
  }

  // ---- ações do humano ----
  isHumanTurn(): boolean { return this.phase() === "play" && this.turn() === this.humanSeat; }
  humanChoosesTrump(): boolean { return this.phase() === "trump" && this.awaitingTrumpFrom() === this.humanSeat; }
  legalCards(): Card[] { return legalCardsFor(this.m, this.humanSeat); }
  playHuman(card: Card): void { playCard(this.m, this.humanSeat, card); }
  chooseTrumpHuman(trump: Trump): void { selectTrump(this.m, this.humanSeat, trump); }

  // ---- passos dos bots (síncronos; a UI adiciona o timing) ----
  needsBotTrump(): boolean { return this.phase() === "trump" && this.awaitingTrumpFrom() !== this.humanSeat; }
  stepBotTrump(): void { const seat = this.awaitingTrumpFrom()!; selectTrump(this.m, seat, chooseBotTrump(this.m, seat)); }
  needsBotPlay(): boolean { return this.phase() === "play" && this.turn() !== this.humanSeat; }
  stepBotPlay(): { seat: Seat; card: Card } {
    const seat = this.turn()!;
    const card = chooseBotCard(this.m, seat);
    playCard(this.m, seat, card);
    return { seat, card };
  }

  // ---- transição de mão ----
  handOver(): boolean { return this.phase() === "handEnd"; }
  advanceHand(): void { if (this.phase() === "handEnd" && !this.m.finished) startNextHand(this.m); }
}
