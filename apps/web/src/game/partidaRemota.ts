// MODO MULTIPLAYER — a partida roda no SERVIDOR; aqui só existe a última visão recebida.
//
//   servidor (autoridade) → STATE_UPDATE { view } → PartidaRemota → Presentation
//
// Toda a LEITURA é herdada de `LeituraDaPartida`, a mesma que o modo local usa. Isso é possível
// porque `PlayerView` **é** um `MatchState` (ver `playerView.ts`): as mãos alheias vêm vazias e a
// semente vem zerada, mas a forma é idêntica, então as funções derivadas do motor — cartas
// legais, placar ao vivo, ranking, resumo da mão, estatísticas — funcionam sem adaptação.
//
// O QUE ESTA CLASSE NÃO FAZ, POR DECISÃO (item 7 da Fase 8):
// não decide vencedor de vaza, não pontua, não vira mão, não escolhe trunfo, não define turno,
// não julga legalidade final, não encerra mão antecipadamente e não declara game over. Tudo isso
// chega pronto do servidor. As "ações" aqui são INTENÇÕES: viram mensagem e esperam confirmação.
import { cardId, type Card, type PlayerView, type Seat, type Trump } from "@king/engine";
import { LeituraDaPartida } from "./leituraDaPartida.js";
import type { AtualizacaoDeEstado, ClienteParaServidor, MensagemDoCliente } from "../net/protocolo.js";

export type EnviarIntencao = <T extends MensagemDoCliente>(tipo: T, payload: ClienteParaServidor[T]) => void;

/** Identificador único por ação — base da idempotência do servidor. */
function novaAcao(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return "a" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class PartidaRemota extends LeituraDaPartida {
  #enviar: EnviarIntencao;
  #stateVersion: number;
  #matchId: string;

  /**
   * OTIMISMO VISUAL LIMITADO (decisão 6): a carta tocada NÃO sai da mão por conta do cliente.
   * Ela fica marcada como "em voo" — a Mesa a mantém elevada e tranca o leque — e só deixa a mão
   * quando o servidor confirma, porque a visão nova simplesmente não a contém mais. Se o servidor
   * recusar, `emVoo` é limpo e nada precisa ser desfeito: a carta nunca chegou a sair.
   */
  #emVoo: { cardId: string; actionId: string } | null = null;
  /** A intenção de trunfo também espera confirmação, para o painel não piscar de volta. */
  #trunfoEmVoo: string | null = null;
  /** Já pedi a próxima mão? O botão do Placar vira "aguardando" (decisão 4). */
  #pediProximaMao = false;

  constructor(inicial: AtualizacaoDeEstado, humanSeat: Seat, enviar: EnviarIntencao) {
    super(inicial.view, humanSeat);
    this.#enviar = enviar;
    this.#stateVersion = inicial.stateVersion;
    this.#matchId = inicial.matchId;
  }

  get stateVersion(): number { return this.#stateVersion; }
  get matchId(): string { return this.#matchId; }
  /** `cardId` da carta aguardando confirmação, ou `null`. */
  cartaEmVoo(): string | null { return this.#emVoo?.cardId ?? null; }
  trunfoEmVoo(): string | null { return this.#trunfoEmVoo; }
  pediProximaMao(): boolean { return this.#pediProximaMao; }
  /** Há uma intenção esperando resposta? Enquanto houver, o leque fica travado. */
  aguardandoServidor(): boolean { return this.#emVoo !== null || this.#trunfoEmVoo !== null; }

  /**
   * Absorve uma atualização autoritativa. Visão mais VELHA que a corrente é descartada — a rede
   * pode reordenar, o estado do jogo não pode andar para trás.
   */
  aplicar(u: AtualizacaoDeEstado): boolean {
    if (u.stateVersion < this.#stateVersion) return false;
    const virouMao = u.cause === "HAND_ADVANCED" || u.cause === "MATCH_STARTED";
    this.m = u.view as PlayerView;
    this.#stateVersion = u.stateVersion;
    this.#matchId = u.matchId;
    // Confirmado (ou ressincronizado): nada mais está em voo. A carta jogada já saiu da mão pela
    // própria visão nova — não há remoção local a fazer.
    this.#emVoo = null;
    this.#trunfoEmVoo = null;
    if (virouMao) this.#pediProximaMao = false;
    return true;
  }

  /** O servidor recusou uma intenção. Se era a que está em voo, ela some — sem desfazer nada. */
  recusar(actionId: string): void {
    if (this.#emVoo?.actionId === actionId) this.#emVoo = null;
    if (this.#trunfoEmVoo === actionId) this.#trunfoEmVoo = null;
    if (this.#pediProximaMao) this.#pediProximaMao = false;
  }

  /** Quem já pediu a próxima mão, segundo o último `READY_STATE`. */
  refletirProntos(prontos: Seat[]): void {
    this.#pediProximaMao = prontos.includes(this.humanSeat);
  }

  // ---- intenções (nunca estado) ----

  playHuman(card: Card): void {
    if (!this.isHumanTurn() || this.aguardandoServidor()) return;
    const id = cardId(card);
    const actionId = novaAcao();
    this.#emVoo = { cardId: id, actionId };
    this.#enviar("CLIENT_PLAY_CARD", {
      actionId,
      cardId: id,
      // proteção contra duplo-toque durante a ida e volta: o servidor responde STALE_ACTION
      expectedStateVersion: this.#stateVersion,
    });
  }

  chooseTrumpHuman(trump: Trump): void {
    if (!this.humanChoosesTrump() || this.aguardandoServidor()) return;
    const actionId = novaAcao();
    this.#trunfoEmVoo = actionId;
    this.#enviar("CLIENT_SELECT_TRUMP", { actionId, trump, expectedStateVersion: this.#stateVersion });
  }

  /**
   * "Continuar" do Placar. No multiplayer isto é um VOTO: a mão só vira com os quatro, e ainda
   * assim só depois do piso de leitura de 8s — quem decide o momento é o servidor.
   */
  advanceHand(): void {
    if (!this.handOver() || this.#pediProximaMao) return;
    this.#pediProximaMao = true;
    this.#enviar("CLIENT_READY_NEXT_HAND", {
      actionId: novaAcao(),
      expectedStateVersion: this.#stateVersion,
      ready: true,
    });
  }

  /**
   * DESFAZ o pedido da próxima mão.
   *
   * Existe porque tocar "Estou pronto" por engano deixava a pessoa presa: o botão virava um aviso
   * de espera e não havia caminho de volta. Enquanto a mão não virou, arrepender-se é legítimo.
   *
   * A marca local cai na hora para o botão responder ao dedo, mas ela é só otimismo de
   * apresentação: a lista de quem está pronto continua vindo do `READY_STATE` do servidor, e é
   * ela que todos os clientes desenham. Se o servidor recusar (a transição já foi consumada, por
   * exemplo), o próximo `READY_STATE` corrige a tela sozinho.
   */
  cancelarProximaMao(): void {
    if (!this.handOver() || !this.#pediProximaMao) return;
    this.#pediProximaMao = false;
    this.#enviar("CLIENT_READY_NEXT_HAND", {
      actionId: novaAcao(),
      expectedStateVersion: this.#stateVersion,
      ready: false,
    });
  }
}
