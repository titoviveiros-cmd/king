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
 *
 * ══ 2 — E POR QUE ESTE NÚMERO PRECISOU MUDAR ══
 *
 * Ele ficou em 1 enquanto três mensagens novas de cliente entraram no contrato
 * (`CLIENT_SET_TABLE_THEME`, `CLIENT_SET_AVATAR` e o `ready:false` de `CLIENT_READY_NEXT_HAND`).
 * Parecia inofensivo: quem não conhece a mensagem simplesmente a ignora.
 *
 * NÃO É ISSO QUE ACONTECE. Em produção, o Colyseus responde a uma mensagem sem handler com
 * `client.leave(CloseCode.WITH_ERROR)` — ele EXPULSA a conexão da sala. Foi exatamente o defeito
 * relatado como "mesa verde impede o início da partida": o anfitrião escolhia a mesa verde, o
 * servidor implantado não conhecia `CLIENT_SET_TABLE_THEME`, e o anfitrião era desconectado no
 * lobby. A sala perdia o dono e a partida nunca começava. Não tinha nada a ver com verde — só
 * acontecia ali porque a outra mesa é o padrão e ninguém precisa clicar nela.
 *
 * A regra que faltava, e que passa a valer: **mensagem nova no contrato = versão nova**. Assim um
 * frontend novo contra um servidor velho é recusado NA PORTA, com mensagem legível, em vez de
 * derrubar jogador no meio do lobby.
 */
export const PROTOCOL_VERSION = 2;

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
  /**
   * Etiqueta do avatar escolhido. O servidor VALIDA contra um conjunto fechado — o cliente não
   * injeta texto livre num campo que todos os outros vão renderizar. Ausente ou inválido vira o
   * padrão. Ver rooms/identidade.ts.
   */
  avatar?: string;
}

export interface DefinirPronto {
  ready: boolean;
}

/**
 * O ANFITRIÃO pede um BOT NORMAL num assento vazio, ou o remove antes de começar.
 *
 * Só carrega o assento — nunca "qual bot" nem "que dificuldade". Quem valida que quem pediu é o
 * anfitrião é o SERVIDOR: esconder o botão na interface não é autorização, é decoração.
 */
export interface GerirBot {
  seat: Seat;
}

/**
 * Uma mensagem social. Só a ETIQUETA viaja — nunca texto. Ver rooms/social.ts.
 */
export interface EnviarMensagemSocial {
  messageId: string;
}

/**
 * Trocar o próprio avatar, dentro da sala.
 *
 * O avatar da entrada vem nas `OpcoesDeEntrada`, escolhido na Home — onde ainda não se sabe quem
 * mais está na sala. Esta mensagem é o segundo momento: já dentro do lobby, vendo quem escolheu o
 * quê. Muda o avatar do PRÓPRIO assento e de nenhum outro; o assento sai da sessão, nunca do
 * payload.
 */
export interface DefinirAvatar {
  /** Etiqueta do conjunto fechado `AVATARES`. Nunca imagem, nunca URL. */
  avatar: string;
}

/** Cosmético da sala. Só o anfitrião; o servidor recusa de qualquer outro. */
export interface DefinirTemaDaMesa {
  /** Etiqueta do conjunto fechado `TEMAS_DA_MESA`. Nunca cor, nunca CSS, nunca texto livre. */
  theme: string;
}

export interface ClienteParaServidor {
  CLIENT_SET_READY: DefinirPronto;
  CLIENT_PLAY_CARD: JogarCarta;
  CLIENT_SELECT_TRUMP: EscolherTrunfo;
  CLIENT_READY_NEXT_HAND: ProntoParaProximaMao;
  CLIENT_ADD_BOT: GerirBot;
  CLIENT_REMOVE_BOT: GerirBot;
  CLIENT_SOCIAL_MESSAGE: EnviarMensagemSocial;
  CLIENT_SET_TABLE_THEME: DefinirTemaDaMesa;
  CLIENT_SET_AVATAR: DefinirAvatar;
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
    /**
     * CREDENCIAL DE RETORNO — `roomCode:token`. Guardar no cliente e reapresentar após uma queda
     * para recuperar **o mesmo assento**. É segredo do dono: nunca é difundida nem entra no
     * estado sincronizado. Quem a tem, é o jogador.
     */
    recoveryToken: string;
  };
}

export interface EventoDeJogador {
  seat: Seat;
  playerId: string;
  nick: string;
}

/** Alguém caiu ou voltou. A Mesa usa isto para esmaecer/reacender o avatar — sem texto técnico. */
export interface ConexaoDeJogador {
  seat: Seat;
  connected: boolean;
}

export interface Falha {
  code: Codigo;
  message: string;
}

/**
 * Alguém mandou uma mensagem. Evento pontual e efêmero: não entra no `Schema`, não sobrevive ao
 * reconnect e não vira histórico. Quem chegou depois não vê o que foi dito — como numa mesa.
 */
export interface MensagemSocialDifundida {
  seat: Seat;
  messageId: string;
  /** Por quantos ms o balão deve ficar. Vem do servidor para as quatro telas concordarem. */
  duracaoMs: number;
}

export interface ServidorParaCliente {
  SERVER_WELCOME: BoasVindas;
  PLAYER_JOINED: EventoDeJogador;
  PLAYER_LEFT: EventoDeJogador;
  SERVER_ERROR: Falha;
  STATE_UPDATE: AtualizacaoDeEstado;
  ACTION_REJECTED: AcaoRecusada;
  READY_STATE: EstadoDeConsenso;
  PLAYER_CONNECTION: ConexaoDeJogador;
  TURN_CLOCK: RelogioDaDecisao;
  AUTO_ACTION: AcaoAutomatica;
  SOCIAL_MESSAGE: MensagemSocialDifundida;
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
export interface ProntoParaProximaMao extends IntencaoBase {
  /**
   * `false` DESFAZ o pedido da próxima mão. Ausente vale `true`, que é como todo cliente antigo
   * se comporta — o campo é aditivo e não quebra nenhuma versão já publicada.
   *
   * Desfazer só vale enquanto a transição não foi consumada. Depois que a mão virou, não há o
   * que desfazer: o servidor recusa, e é ele quem sabe, não a tela.
   */
  ready?: boolean;
}

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
export type Causa = "MATCH_STARTED" | "CARD_PLAYED" | "TRUMP_SELECTED" | "HAND_ADVANCED" | "RESYNC" | "RECONNECTED";

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

// ══════════════════════ FASE 7 — RELÓGIO E ASSISTÊNCIA ══════════════════════

/** O que a partida está esperando agora. */
export type TipoDeDecisao = "PLAY" | "TRUMP" | "READY";

export type FaseDoRelogio = "NORMAL" | "WARNING" | "CRITICAL";

/**
 * Relógio autoritativo. Enviado no início da decisão e a cada mudança de fase — **não** a cada
 * segundo: um tique por segundo seria banda desperdiçada e ainda assim aproximado. O cliente
 * conta localmente entre as mensagens, e o servidor o realinha em cada transição.
 *
 * `restanteMs` em vez de instante absoluto: assim não é preciso sincronizar relógios, e a
 * mensagem continua correta para quem acabou de reconectar.
 */
export interface RelogioDaDecisao {
  tipo: TipoDeDecisao;
  /** De quem é a decisão. `null` em READY, que é de todos. */
  seat: Seat | null;
  fase: FaseDoRelogio;
  restanteMs: number;
}

/** O servidor agiu por um assento. É o que a Mesa usa para dizer "jogou automaticamente". */
export interface AcaoAutomatica {
  seat: Seat;
  tipo: TipoDeDecisao;
  /** O assento está em assistência contínua (jogador ausente), não só um estouro isolado. */
  assistido: boolean;
}
