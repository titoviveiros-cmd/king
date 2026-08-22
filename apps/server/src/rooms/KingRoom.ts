// KingRoom — esqueleto da sala autoritativa (Fase 2: lifecycle e assentos, SEM gameplay).
//
// ═══════════════════ A REGRA DE SEGURANÇA CENTRAL DESTE ARQUIVO ═══════════════════
//
// O Colyseus sincroniza automaticamente — e SÓ — o que estiver dentro do `Schema` passado a
// `setState()`. Qualquer outro campo da classe é um campo TypeScript comum: fica no processo do
// servidor e **nunca** é serializado para ninguém.
//
// Por isso a separação é física, não disciplinar:
//
//   this.state  → EstadoPublicoDaSala (Schema)  → sincronizado a todos: roomId, assentos, ready
//   this.match  → MatchState                    → campo privado comum: NUNCA sai daqui
//
// O `MatchState` carrega as mãos completas e a semente (que sozinha reconstrói o baralho inteiro
// — ver `playerView.ts`). Ele não pode estar dentro de um `Schema` em hipótese alguma. Quando a
// Fase 3 preencher `this.match`, o caminho de saída será `redactFor(match, seat)` enviado
// individualmente, nunca o broadcast automático do framework.
//
// `KingRoom.test.ts` prova isso injetando um `MatchState` real e distribuído neste campo e
// varrendo tudo que o cliente observa em busca de carta.
import { Room, ServerError, generateId, type Client } from "colyseus";
import { ArraySchema, schema } from "@colyseus/schema";
import type { MatchState, Seat } from "@king/engine";
import {
  CODIGO, PROTOCOL_VERSION, difundir, enviar,
  type DefinirPronto, type OpcoesDeEntrada,
} from "../protocol/index.js";

/** KING é sempre 4 assentos. Não é configurável — é regra do jogo. */
export const ASSENTOS = 4;

/**
 * Um assento, do ponto de vista PÚBLICO. Nada aqui é secreto: quem está sentado, com que apelido,
 * conectado e pronto. É o que o lobby precisa desenhar — e é o teto do que a sala sincroniza.
 */
export const AssentoPublico = schema({
  seat: "number",
  playerId: "string",
  nick: "string",
  connected: "boolean",
  ready: "boolean",
}, "AssentoPublico");
export type AssentoPublico = InstanceType<typeof AssentoPublico>;

/**
 * Estado PÚBLICO da sala — o único objeto que o Colyseus sincroniza.
 * Contém exclusivamente informação de lobby. Sem `MatchState`, sem mãos, sem baralho, sem semente.
 */
export const EstadoPublicoDaSala = schema({
  protocolVersion: "number",
  roomId: "string",
  seats: [AssentoPublico],
}, "EstadoPublicoDaSala");
export type EstadoPublicoDaSala = InstanceType<typeof EstadoPublicoDaSala>;

/**
 * Dados por conexão. Ficam em `client.userData`, que o Colyseus documenta como **não
 * sincronizado** com o cliente — é memória do servidor sobre aquela conexão.
 */
export interface DadosDaConexao {
  playerId: string;
  sessionToken: string;
  seat: Seat;
}

type ClienteDoKing = Client<{ userData: DadosDaConexao }>;

const ASSENTO_VAZIO = "";

export class KingRoom extends Room<{
  state: EstadoPublicoDaSala;
  client: ClienteDoKing;
}> {
  /** O 5º cliente é recusado pelo próprio matchmaking do framework. */
  maxClients = ASSENTOS;

  /**
   * SERVER-ONLY. Reservado para a Fase 3 — permanece `null` nesta fase, que não cria partida.
   * Declarado aqui de propósito: é o campo cuja não-serialização o teste anti-vazamento verifica.
   * NUNCA mover para dentro de um `Schema`.
   */
  private match: MatchState | null = null;

  /**
   * Há partida em curso? Só expõe o BOOLEANO — nunca o estado. A Fase 3 usará isto para recusar
   * ação de gameplay antes do início da partida.
   */
  partidaIniciada(): boolean {
    return this.match !== null;
  }

  onCreate(): void {
    const estado = new EstadoPublicoDaSala();
    estado.protocolVersion = PROTOCOL_VERSION;
    estado.roomId = this.roomId;
    estado.seats = new ArraySchema<AssentoPublico>();
    for (let s = 0; s < ASSENTOS; s++) estado.seats.push(assentoVazio(s));
    this.setState(estado);

    this.onMessage("CLIENT_SET_READY", (client: ClienteDoKing, msg: DefinirPronto) => {
      const dados = client.userData;
      if (!dados) return;
      this.state.seats[dados.seat].ready = !!msg?.ready;
    });
  }

  /**
   * Handshake + atribuição de assento.
   *
   * A atribuição é DETERMINÍSTICA: sempre o menor índice livre. Quatro entradas em sequência numa
   * sala vazia produzem 0, 1, 2, 3 — sem sorteio, sem duplicidade, e reprodutível em teste.
   * Quando alguém sai, o assento volta a ser o menor livre e é reaproveitado.
   */
  onJoin(client: ClienteDoKing, options?: Partial<OpcoesDeEntrada>): void {
    const versao = options?.protocolVersion ?? PROTOCOL_VERSION;
    if (versao !== PROTOCOL_VERSION) {
      throw new ServerError(
        CODIGO.PROTOCOLO_INCOMPATIVEL,
        `Protocolo incompatível: cliente ${versao}, servidor ${PROTOCOL_VERSION}`,
      );
    }

    const seat = this.primeiroAssentoLivre();
    if (seat === null) {
      // Rede de segurança: o `maxClients` já barra o 5º antes de chegar aqui.
      throw new ServerError(CODIGO.SALA_CHEIA, "A sala já tem quatro jogadores");
    }

    const dados: DadosDaConexao = {
      playerId: generateId(),
      sessionToken: generateId(),
      seat,
    };
    client.userData = dados;

    const nick = options?.nick?.trim() || `Jogador ${seat + 1}`;
    const assento = this.state.seats[seat];
    assento.playerId = dados.playerId;
    assento.nick = nick;
    assento.connected = true;
    assento.ready = false;

    enviar(client, "SERVER_WELCOME", {
      protocolVersion: PROTOCOL_VERSION,
      roomId: this.roomId,
      you: { playerId: dados.playerId, sessionToken: dados.sessionToken, seat },
    });
    difundir(this, "PLAYER_JOINED", { seat, playerId: dados.playerId, nick }, { except: client });
  }

  /**
   * Saída. Nesta fase o assento é liberado de imediato: não há reconexão ainda (Fase 6), e manter
   * assento reservado sem quem o reclame só criaria sala travada.
   */
  onLeave(client: ClienteDoKing): void {
    const dados = client.userData;
    if (!dados) return;
    const assento = this.state.seats[dados.seat];
    const evento = { seat: dados.seat, playerId: dados.playerId, nick: assento.nick };
    // Campo a campo, NUNCA `Object.assign` de outra instância: copiar um `Schema` por cima de
    // outro sobrescreve os internos de rastreamento e o cliente passa a decodificar campo
    // inexistente ("definition mismatch").
    assento.playerId = ASSENTO_VAZIO;
    assento.nick = "";
    assento.connected = false;
    assento.ready = false;
    difundir(this, "PLAYER_LEFT", evento, { except: client });
  }

  onDispose(): void {
    this.match = null; // a sala morreu: nada de estado autoritativo sobrevivendo ao processo
  }

  /** Menor índice livre, ou `null` se os quatro estiverem ocupados. */
  private primeiroAssentoLivre(): Seat | null {
    for (let s = 0; s < ASSENTOS; s++) {
      if (this.state.seats[s].playerId === ASSENTO_VAZIO) return s as Seat;
    }
    return null;
  }
}

function assentoVazio(seat: number): AssentoPublico {
  const a = new AssentoPublico();
  a.seat = seat;
  a.playerId = ASSENTO_VAZIO;
  a.nick = "";
  a.connected = false;
  a.ready = false;
  return a;
}
