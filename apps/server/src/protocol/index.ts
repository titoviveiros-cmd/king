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
import type { Seat } from "@king/engine";

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
}

// ───────────────────────── SERVIDOR → CLIENTE ─────────────────────────

/**
 * Identidade da conexão + assento atribuído. `playerId` e `sessionToken` já existem como TIPO para
 * que a Fase de reconexão não precise mudar o envelope — mas nesta fase são apenas identificadores
 * opacos gerados por conexão. **Não há conta, perfil nem XP.**
 */
export interface BoasVindas {
  protocolVersion: number;
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
