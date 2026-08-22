// KingRoom — a sala autoritativa: lobby (Fase 2) + partida real governada pelo motor (Fase 3).
//
// ═══════════════════ A REGRA DE SEGURANÇA CENTRAL DESTE ARQUIVO ═══════════════════
//
// O Colyseus sincroniza automaticamente — e SÓ — o que estiver dentro do `Schema` passado a
// `setState()`. Qualquer outro campo da classe é um campo TypeScript comum: fica no processo do
// servidor e **nunca** é serializado para ninguém.
//
// Por isso a separação é física, não disciplinar:
//
//   this.state      → EstadoPublicoDaSala (Schema) → sincronizado: roomId, assentos, ready
//   this.autoridade → MatchState lá dentro         → campo privado comum: NUNCA sai daqui
//
// O `MatchState` carrega as mãos completas e a semente (que sozinha reconstrói o baralho inteiro
// — ver `playerView.ts`). Ele não pode estar dentro de um `Schema` em hipótese alguma. A ÚNICA
// saída de estado é `autoridade.visaoDe(seat)` → `redactFor`, enviada individualmente a cada
// cliente. Nunca há broadcast de uma visão comum.
//
// A Room é transporte e fan-out; a validação vive em `match/autoridade.ts`, pura e sem Colyseus;
// e a REGRA vive só em `@king/engine`. Nada de KING é reimplementado aqui.
import { Room, ServerError, generateId, type Client } from "colyseus";
import { ArraySchema, schema } from "@colyseus/schema";
import type { Seat } from "@king/engine";
import { AutoridadeDaPartida, type Resultado } from "../match/autoridade.js";
import {
  CODIGO, PROTOCOL_VERSION, difundir, enviar,
  type Causa, type DefinirPronto, type EscolherTrunfo,
  type JogarCarta, type OpcoesDeEntrada, type ProntoParaProximaMao,
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
   * SERVER-ONLY. Guarda o `MatchState` autoritativo (mãos completas + semente) num campo privado
   * de classe — **fora** do `Schema`, portanto jamais sincronizado. A única saída de estado é
   * `visaoDe(seat)`, que passa por `redactFor`.
   * NUNCA mover para dentro de um `Schema`.
   */
  private autoridade = new AutoridadeDaPartida();

  /** Há partida em curso? Só o BOOLEANO — nunca o estado. */
  partidaIniciada(): boolean {
    return this.autoridade.iniciada;
  }

  /** Acesso SERVER-ONLY para os testes e, adiante, para os bots. Nunca serializado. */
  autoridadeDaPartida(): AutoridadeDaPartida {
    return this.autoridade;
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

    // ── gameplay (Fase 3) ─────────────────────────────────────────────────────
    // Todo handler segue o MESMO roteiro: o assento sai da SESSÃO (nunca do payload), a
    // autoridade valida e aplica pelo motor, e o resultado vira ou fan-out de visões
    // individuais, ou uma recusa endereçada a quem tentou.

    this.onMessage("CLIENT_START_MATCH", (client: ClienteDoKing) => {
      const dados = client.userData;
      if (!dados) return;
      if (dados.seat !== 0) return this.#recusar(client, "", "NOT_HOST", "Só o anfitrião inicia");
      if (this.state.seats.some((a) => a.playerId === ASSENTO_VAZIO)) {
        return this.#recusar(client, "", "ROOM_NOT_FULL", "A sala ainda não tem quatro jogadores");
      }
      const nomes = this.state.seats.map((a) => a.nick);
      // A SEMENTE é do servidor. Nunca do cliente nem das opções da sala: quem escolhe a semente
      // escolhe a distribuição.
      const semente = Math.floor(Math.random() * 0xffffffff) >>> 0;
      const r = this.autoridade.iniciar(nomes, generateId(), semente);
      this.#responder(client, "", r, "MATCH_STARTED");
    });

    this.onMessage("CLIENT_PLAY_CARD", (client: ClienteDoKing, msg: JogarCarta) => {
      const dados = client.userData;
      if (!dados) return;
      const r = this.autoridade.jogarCarta(dados.seat, dados.playerId, msg);
      this.#responder(client, msg?.actionId ?? "", r, "CARD_PLAYED");
    });

    this.onMessage("CLIENT_SELECT_TRUMP", (client: ClienteDoKing, msg: EscolherTrunfo) => {
      const dados = client.userData;
      if (!dados) return;
      const r = this.autoridade.escolherTrunfo(dados.seat, dados.playerId, msg);
      this.#responder(client, msg?.actionId ?? "", r, "TRUMP_SELECTED");
    });

    this.onMessage("CLIENT_READY_NEXT_HAND", (client: ClienteDoKing, msg: ProntoParaProximaMao) => {
      const dados = client.userData;
      if (!dados) return;
      const r = this.autoridade.marcarPronto(dados.seat, dados.playerId, msg);
      if (!r.ok) return this.#recusar(client, msg?.actionId ?? "", r.code, r.message);
      if (r.avancou) return this.#publicar("HAND_ADVANCED");
      // consenso ainda incompleto: ninguém avança, e todos veem quem já pediu
      difundir(this, "READY_STATE", {
        handNumber: this.autoridade.estadoAutoritativo()?.hand?.handNumber ?? 0,
        ready: r.prontos,
      });
    });
  }

  /**
   * Resultado de uma intenção.
   *
   * IDEMPOTÊNCIA — política adotada: uma `actionId` repetida **não reexecuta nada**, e o servidor
   * reenvia o estado corrente SÓ para quem repetiu. Escolhi reenviar em vez de ignorar em silêncio
   * porque a causa quase sempre é resposta perdida na rede: reenviar faz o cliente convergir; o
   * silêncio o deixaria travado esperando.
   */
  #responder(client: ClienteDoKing, actionId: string, r: Resultado, causa: Causa): void {
    if (!r.ok) return this.#recusar(client, actionId, r.code, r.message);
    if (r.duplicada) return this.#publicarPara(client, "RESYNC");
    this.#publicar(causa);
  }

  #recusar(client: ClienteDoKing, actionId: string, code: string, message: string): void {
    enviar(client, "ACTION_REJECTED", {
      actionId,
      code,
      message, // humano e curto: NUNCA stack trace, nunca informação de outro assento
      stateVersion: this.autoridade.stateVersion,
    });
  }

  /** Fan-out: cada cliente recebe a SUA visão redigida. Nunca uma visão comum difundida. */
  #publicar(causa: Causa): void {
    for (const c of this.clients) this.#publicarPara(c as ClienteDoKing, causa);
  }

  #publicarPara(client: ClienteDoKing, causa: Causa): void {
    const dados = client.userData;
    if (!dados) return;
    const view = this.autoridade.visaoDe(dados.seat);
    if (view === null) return;
    enviar(client, "STATE_UPDATE", {
      matchId: this.autoridade.matchId,
      stateVersion: this.autoridade.stateVersion,
      view,
      cause: causa,
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
    // a sala morreu: nada de estado autoritativo sobrevivendo ao processo
    this.autoridade = new AutoridadeDaPartida();
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
