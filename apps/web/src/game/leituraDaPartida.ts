// CAMADA DE LEITURA DA PARTIDA — o modelo de apresentação que a Mesa consome.
//
//   packages/engine  →  LeituraDaPartida  →  Presentation (React)
//
// Existe UMA implementação de leitura para os dois modos do KING:
//
//   KingGame       (local/bots)  → dono de um MatchState que ele mesmo muta pelo motor
//   PartidaRemota  (multiplayer) → alimentada pelo PlayerView autoritativo do servidor
//
// As duas herdam daqui. Isso não é elegância: é a garantia de que a Mesa vê exatamente a mesma
// coisa nos dois modos. Se um método de leitura mudasse só num lado, a outra tela derivaria em
// silêncio — o tipo de defeito que só aparece com quatro pessoas jogando.
//
// POR QUE ISSO FUNCIONA PARA O MULTIPLAYER
// `PlayerView` **é** um `MatchState` (ver `playerView.ts`): mesma forma, com as mãos alheias
// vazias e a semente zerada. Portanto todas as funções derivadas do motor — cartas legais,
// placar ao vivo, ranking, resumo da mão, estatísticas — operam sobre a visão redigida sem
// nenhuma adaptação, e sem que o cliente reimplemente uma linha de regra.
//
// A UI NUNCA reimplementa regra: pergunta ao motor o estado, as cartas legais, o resultado da
// vaza, a pontuação e as transições de mão. Toda a lógica de KING vive em @king/engine.
import {
  legalCardsFor, publicView, rankings, matchWinners, handSummary, handBreakdown, matchStats,
  trumpChooserFor, liveScores,
  type Card, type Trump, type Seat, type MatchState, type RankRow, type HandSummary,
  type HandBreakdown, type MatchStats,
} from "@king/engine";

export type Phase = "trump" | "play" | "handEnd" | "matchEnd";

/**
 * Tudo que a apresentação pode PERGUNTAR sobre a partida. Nada aqui muta estado.
 *
 * `humanSeat` deixou de ser 0 fixo: no multiplayer o servidor é quem atribui o assento, e a Mesa
 * gira a mesa em torno dele (ver `assentos.ts`). No modo local continua sendo 0, e por isso o
 * comportamento local não muda em nada.
 */
export abstract class LeituraDaPartida {
  readonly humanSeat: Seat;
  protected m: MatchState;

  protected constructor(m: MatchState, humanSeat: Seat) {
    this.m = m;
    this.humanSeat = humanSeat;
  }

  // ---- leitura (só o que é público para o humano) ----
  players(): string[] { return this.m.players.slice(); }

  /**
   * Etiqueta do avatar de um assento, quando a partida sabe.
   *
   * O motor não guarda avatar — identidade é assunto da apresentação. No MULTIPLAYER quem sabe é
   * o estado sincronizado da sala, e a Mesa lê de lá. No modo LOCAL não havia ninguém sabendo, e
   * era essa a origem de um bug: o mini perfil resolvia avatar por etiqueta, recebia `undefined`
   * para os quatro assentos e desenhava o Leão em todos.
   *
   * O padrão é `undefined`, e é deliberado: "não sei" é diferente de "é o leão". Quem sabe
   * responde; quem não sabe deixa a decisão para quem tem a informação melhor.
   */
  avatarDoAssento(_seat: Seat): string | undefined { return undefined; }
  view() { return publicView(this.m, this.humanSeat); }
  handNumber(): number { return this.m.handNumber; }
  finished(): boolean { return this.m.finished; }
  cumulative(): number[] { return this.m.cumulative.slice(); }
  /**
   * Pontuação PÚBLICA ao vivo por assento (cumulativo consolidado + parcial da mão em curso,
   * ambos do motor). É a fonte dos cards da Mesa: o card do vencedor incorpora o delta assim que
   * a vaza é resolvida, sem esperar o fim da mão/fase. Ver `liveScores` em @king/engine.
   */
  liveScores(): number[] { return liveScores(this.m); }
  /** Quantas vazas da mão corrente já foram resolvidas (0..13) — usado pelas regressões. */
  completedTrickCount(): number { return this.m.hand?.completedTricks.length ?? 0; }
  negatives(): number[] { return this.m.negatives.slice(); }
  positives(): number[] { return this.m.positives.slice(); }
  rankings(): RankRow[] { return rankings(this.m); }
  winners(): Seat[] { return matchWinners(this.m); }
  history() { return this.m.history.map((h) => ({ ...h, handScores: h.handScores.slice() })); }
  /**
   * Resumo autoritativo da mão encerrada — tudo que o Placar entre-mãos mostra
   * (o que cada um capturou, delta, ranking antes/depois, próximo contrato).
   * `null` enquanto a mão está em andamento.
   */
  summary(): HandSummary | null { return handSummary(this.m); }
  /** Destaques da partida (melhor mão, negativas ilesas, quem levou o K♥, margem). */
  stats(): MatchStats { return matchStats(this.m); }
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
  /** Detalhamento SÓ da última vaza (o motor é quem diz o que ela custou) — usado pelo áudio. */
  lastTrickBreakdown(): HandBreakdown | null {
    const h = this.m.hand;
    if (!h || h.completedTricks.length === 0) return null;
    return handBreakdown(h.contract.kind, [h.completedTricks[h.completedTricks.length - 1]]);
  }

  /**
   * Detalhamento ACUMULADO da mão em curso — o total que cada assento já pegou até aqui.
   * É o que o selo do castigo mostra: "Nara pegou 2 Damas" na segunda, e não "1 Dama" de novo.
   */
  handBreakdownSoFar(): HandBreakdown | null {
    const h = this.m.hand;
    if (!h || h.completedTricks.length === 0) return null;
    return handBreakdown(h.contract.kind, h.completedTricks);
  }
  currentTrick() { return this.m.hand ? this.m.hand.currentTrick.slice() : []; }
  handCounts(): number[] { return this.m.hand ? this.m.hand.handCounts.slice() : [13, 13, 13, 13]; }
  awaitingTrumpFrom(): Seat | null { return this.m.hand?.awaitingTrumpFrom ?? null; }
  trump(): Trump | null { return this.m.hand?.trump ?? null; }
  /** Assento que escolhe o trunfo da mão positiva em curso (rotação M7→P0 … M10→P3). */
  trumpChooser(): Seat | null {
    const h = this.m.hand;
    return h && h.contract.isPositive ? trumpChooserFor(h.handNumber) : null;
  }
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

  // ---- perguntas sobre a vez do humano ----
  isHumanTurn(): boolean { return this.phase() === "play" && this.turn() === this.humanSeat; }
  humanChoosesTrump(): boolean { return this.phase() === "trump" && this.awaitingTrumpFrom() === this.humanSeat; }
  legalCards(): Card[] { return legalCardsFor(this.m, this.humanSeat); }
  handOver(): boolean { return this.phase() === "handEnd"; }
}
