// PROTOCOLO V1 — envelope base do Multiplayer (Fase 2).
//
// Duas direções, SEPARADAS por tipo. Um mapa por direção transforma cada nome de mensagem no
// formato do seu payload, e os auxiliares `enviar`/`difundir` só aceitam pares (nome, payload)
// que existam no mapa do SERVIDOR → CLIENTE. Mandar um nome inexistente, ou o payload errado
// para um nome válido, **não compila**.
//
// CAMPOS QUE AINDA NÃO EXISTEM, E POR QUÊ
// A Fase 2 é bootstrap: não há partida, ação de gameplay nem estado versionado. Incluir campos
// agora seria adivinhação, então ficam registrados aqui com o momento exato em que entram:
//   `matchId`      → quando a Room passar a criar um MatchState (Fase 3)
//   `actionId`     → junto da primeira ação idempotente (PLAY_CARD, Fase 3)
//   `stateVersion` → junto do primeiro snapshot autoritativo (Fase 3)
// `protocolVersion`, `playerId`, `sessionToken` e `seat` entram agora porque a Fase 2 já precisa
// deles: negociar compatibilidade, identificar a conexão e devolver o assento atribuído.
import type { PlayerView, Seat, Trump } from "@king/engine";

/**
 * Versão do protocolo. O cliente informa a sua no `join`; divergência é recusada na porta, e não
 * mais adiante com uma mensagem incompreensível.
 */
export const PROTOCOL_VERSION = 1;

/** Motivos de recusa. Numérico para caber no `code` do `ServerError` do Colyseus. */
export const CODIGO = {
  PROTOCOLO_INCOMPATIVEL: 4001,
  SALA_CHEIA: 4002,
} as const;
export type Codigo = (typeof CODIGO)[keyof typeof CODIGO];

// ───────────────────────── CLIENTE → SERVIDOR ─────────────────────────

/** Enviado nas opções do `join` (não como mensagem): é o handshake. */
export interface OpcoesDeEntrada {
  protocolVersion: number;
  nick?: string;
}

export interface DefinirPronto {
  ready: boolean;
}

export interface ClienteParaServidor {
  CLIENT_SET_READY: DefinirPronto;
  CLIENT_PLAY_CARD: JogarCarta;
  CLIENT_SELECT_TRUMP: EscolherTrunfo;
  CLIENT_READY_NEXT_HAND: ProntoParaProximaMao;
}

// ───────────────────────── SERVIDOR → CLIENTE ─────────────────────────

/**
 * Identidade da conexão + assento atribuído. `playerId` e `sessionToken` já existem como TIPO para
 * que a Fase de reconexão não precise mudar o envelope — mas nesta fase são apenas identificadores
 * opacos gerados por conexão. **Não há conta, perfil nem XP.**
 */
export interface BoasVindas {
  protocolVersion: number;
  /** O código que se compartilha para os outros entrarem. É o próprio `roomId`. */
  roomCode: string;
  roomId: string;
  you: {
    playerId: string;
    sessionToken: string;
    seat: Seat;
  };
}

export interface EventoDeJogador {
  seat: Seat;
  playerId: string;
  nick: string;
}

export interface Falha {
  code: Codigo;
  message: string;
}

export interface ServidorParaCliente {
  SERVER_WELCOME: BoasVindas;
  PLAYER_JOINED: EventoDeJogador;
  PLAYER_LEFT: EventoDeJogador;
  SERVER_ERROR: Falha;
  STATE_UPDATE: AtualizacaoDeEstado;
  ACTION_REJECTED: AcaoRecusada;
  READY_STATE: EstadoDeConsenso;
}

export type MensagemDoCliente = keyof ClienteParaServidor;
export type MensagemDoServidor = keyof ServidorParaCliente;

// ───────────────────────── envio tipado ─────────────────────────
//
// O estado PÚBLICO da sala não viaja por aqui: o Colyseus sincroniza o `Schema` da Room sozinho.
// Estas mensagens são os EVENTOS pontuais (entrou, saiu, recusado) que a apresentação precisa
// para som e animação — o `Schema` diz "como está", as mensagens dizem "o que acabou de mudar".

/** Alvo mínimo de envio — evita acoplar o protocolo ao tipo `Client` do framework. */
export interface AlvoDeEnvio {
  send(type: string, message?: unknown): void;
}

/** Alvo mínimo de difusão. `opcoes` é repassado ao framework (ex.: `{ except: client }`). */
export interface AlvoDeDifusao {
  broadcast(type: string, message?: unknown, options?: unknown): void;
}

export function enviar<T extends MensagemDoServidor>(
  alvo: AlvoDeEnvio,
  tipo: T,
  payload: ServidorParaCliente[T],
): void {
  alvo.send(tipo, payload);
}

export function difundir<T extends MensagemDoServidor>(
  alvo: AlvoDeDifusao,
  tipo: T,
  payload: ServidorParaCliente[T],
  opcoes?: unknown,
): void {
  alvo.broadcast(tipo, payload, opcoes);
}

// ══════════════════════ FASE 3 — GAMEPLAY ══════════════════════
//
// O cliente envia INTENÇÃO, nunca estado. Repare no que NÃO existe nestes payloads: `seat`,
// `score`, `turn`, `winner`, `legalCards`, `stateVersion` autoritativa. O assento sai da sessão
// no servidor; todo o resto é calculado pelo motor.

/** Campos comuns a toda intenção de gameplay. */
export interface IntencaoBase {
  /** Identificador único da ação, gerado pelo cliente. Base da idempotência. */
  actionId: string;
  /** Opcional: a versão sobre a qual o cliente acredita estar agindo. */
  expectedStateVersion?: number;
}

export interface JogarCarta extends IntencaoBase {
  /** `cardId(carta)` do motor — `"${rank}-${suit}"`. Nunca o objeto carta. */
  cardId: string;
}

export interface EscolherTrunfo extends IntencaoBase {
  trump: Trump;
}

/** "Estou pronto para a próxima mão." Só o consenso dos quatro avança a partida. */
export type ProntoParaProximaMao = IntencaoBase;

/** Quem já pediu a próxima mão. O Placar entre-mãos usa isto para dizer "aguardando Bia…". */
export interface EstadoDeConsenso {
  handNumber: number;
  ready: Seat[];
}

/**
 * Estado da sala. `lobby` = ninguém recebeu carta ainda; `playing` = partida em curso;
 * `finished` = as 10 mãos acabaram.
 */
export type StatusDaSala = "lobby" | "playing" | "finished";

/** Por que o estado mudou. É dica de apresentação — o estado autoritativo é a `view`. */
export type Causa = "MATCH_STARTED" | "CARD_PLAYED" | "TRUMP_SELECTED" | "HAND_ADVANCED" | "RESYNC";

export interface AtualizacaoDeEstado {
  matchId: string;
  stateVersion: number;
  /** Visão redigida DESTE assento — cada cliente recebe a sua. */
  view: PlayerView;
  cause: Causa;
}

export interface AcaoRecusada {
  actionId: string;
  code: string;
  message: string;
  /** Versão corrente, para o cliente se realinhar sem pedir resync. */
  stateVersion: number;
}
