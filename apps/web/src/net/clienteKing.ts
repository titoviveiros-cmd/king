// CLIENTE MULTIPLAYER — o ÚNICO lugar do app que conhece Colyseus.
//
// Acima daqui só existe `SessaoKing`: uma sala aberta, com envio tipado pelo protocolo e alguns
// eventos. Nenhum componente importa `@colyseus/sdk`, e por isso os testes do hook rodam com uma
// sessão falsa, sem servidor e sem rede.
//
// O que este módulo NÃO faz: não decide regra, não guarda estado de jogo, não interpreta a
// `PlayerView`. Ele transporta.
import { Client, type Room } from "@colyseus/sdk";
import { PROTOCOL_VERSION } from "./protocolo.js";
import type {
  ClienteParaServidor, MensagemDoCliente, MensagemDoServidor, ServidorParaCliente, StatusDaSala,
} from "./protocolo.js";
import { SALA_KING } from "./constantes.js";

/** Um assento como o lobby o vê. Espelho do `AssentoPublico` sincronizado pela sala. */
export interface AssentoLido {
  seat: number;
  playerId: string;
  nick: string;
  connected: boolean;
  ready: boolean;
  /** O servidor está jogando por este assento agora? */
  assisted: boolean;
  /** Assento de BOT NORMAL — o servidor joga por ele o tempo todo, por definição. */
  bot: boolean;
  /** Anfitrião da sala: o único que adiciona e remove bots. */
  host: boolean;
  /** Avatar escolhido. Vem do estado autoritativo — é o MESMO em todos os aparelhos. */
  avatar: string;
}

/** Estado PÚBLICO da sala. Nunca contém mão, baralho nem semente — isso é lei do servidor. */
export interface EstadoDaSalaLido {
  protocolVersion: number;
  roomCode: string;
  roomId: string;
  status: StatusDaSala;
  /** Cosmético da mesa, do estado autoritativo: todos os aparelhos veem a mesma. */
  tableTheme: string;
  seats: AssentoLido[];
}

/** Uma sala aberta. É tudo que as camadas de cima enxergam da rede. */
export interface SessaoKing {
  readonly roomCode: string;
  /** Assina uma mensagem do servidor. Devolve a função que cancela a assinatura. */
  ao<T extends MensagemDoServidor>(tipo: T, fn: (payload: ServidorParaCliente[T]) => void): () => void;
  aoMudarEstado(fn: (estado: EstadoDaSalaLido) => void): void;
  /** A conexão caiu; o SDK vai tentar voltar sozinho. */
  aoCair(fn: () => void): void;
  aoVoltar(fn: () => void): void;
  /** Saída definitiva (sala encerrada, expulso, ou saímos nós). */
  aoSair(fn: (codigo: number, motivo?: string) => void): void;
  aoErro(fn: (codigo: number, motivo?: string) => void): void;
  enviar<T extends MensagemDoCliente>(tipo: T, payload: ClienteParaServidor[T]): void;
  sair(): void;
  estado(): EstadoDaSalaLido | null;
}

export type Pedido =
  | { tipo: "criar"; nick: string; avatar: string }
  | { tipo: "entrar"; codigo: string; nick: string; avatar: string }
  | { tipo: "voltar"; recoveryToken: string };

/** Abre uma sessão. A implementação real fala Colyseus; os testes injetam uma falsa. */
export type AbridorDeSessao = (pedido: Pedido) => Promise<SessaoKing>;

// ───────────────────────── leitura tolerante do estado sincronizado ─────────────────────────
//
// O estado chega decodificado por REFLEXÃO (o servidor manda a definição do schema no handshake),
// então não é preciso duplicar as classes de Schema aqui — o que seria uma segunda fonte de
// verdade fadada a divergir. Em troca, a leitura é defensiva.

function texto(v: unknown, padrao = ""): string { return typeof v === "string" ? v : padrao; }
function numero(v: unknown, padrao = 0): number { return typeof v === "number" ? v : padrao; }
function booleano(v: unknown): boolean { return v === true; }

/** ArraySchema, array comum ou nada — sai sempre um array de verdade. */
function comoLista(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof (v as { toArray?: () => unknown[] }).toArray === "function") {
    return (v as { toArray: () => unknown[] }).toArray();
  }
  if (v && typeof (v as Iterable<unknown>)[Symbol.iterator] === "function") return [...(v as Iterable<unknown>)];
  return [];
}

export function lerEstadoDaSala(bruto: unknown): EstadoDaSalaLido | null {
  if (!bruto || typeof bruto !== "object") return null;
  const e = bruto as Record<string, unknown>;
  const status = texto(e.status, "lobby");
  return {
    protocolVersion: numero(e.protocolVersion),
    roomCode: texto(e.roomCode),
    roomId: texto(e.roomId),
    status: (status === "playing" || status === "finished" ? status : "lobby") satisfies StatusDaSala,
    // Etiqueta crua: quem traduz para desenho é o cliente, e um valor desconhecido cai no padrão
    // lá, não aqui. Esta camada só lê o que o servidor sincronizou.
    tableTheme: texto(e.tableTheme, "imperial"),
    seats: comoLista(e.seats).map((s, i) => {
      const a = (s ?? {}) as Record<string, unknown>;
      return {
        seat: numero(a.seat, i),
        playerId: texto(a.playerId),
        nick: texto(a.nick),
        connected: booleano(a.connected),
        ready: booleano(a.ready),
        assisted: booleano(a.assisted),
        bot: booleano(a.bot),
        host: booleano(a.host),
        avatar: texto(a.avatar),
      };
    }),
  };
}

// ───────────────────────── implementação Colyseus ─────────────────────────

/** Exportado para teste: liga um objeto com a forma de `Room` à interface `SessaoKing`. */
export function envolverSala(sala: Room): SessaoKing {
  let ultimo: EstadoDaSalaLido | null = lerEstadoDaSala(sala.state);
  sala.onStateChange((s) => { ultimo = lerEstadoDaSala(s); });

  return {
    get roomCode() { return sala.roomId; },
    ao(tipo, fn) {
      return sala.onMessage(tipo as string, fn as (p: unknown) => void);
    },
    aoMudarEstado(fn) { sala.onStateChange((s) => fn(lerEstadoDaSala(s) ?? vazio())); },
    aoCair(fn) { sala.onDrop(() => fn()); },
    aoVoltar(fn) { sala.onReconnect(() => fn()); },
    aoSair(fn) { sala.onLeave((codigo, motivo) => fn(codigo, motivo)); },
    aoErro(fn) { sala.onError((codigo, motivo) => fn(codigo, motivo)); },
    enviar(tipo, payload) { sala.send(tipo as string, payload); },
    sair() { void sala.leave(true); },
    estado() { return ultimo; },
  };
}

function vazio(): EstadoDaSalaLido {
  return {
    protocolVersion: PROTOCOL_VERSION, roomCode: "", roomId: "",
    status: "lobby", tableTheme: "imperial", seats: [],
  };
}

/**
 * Fabrica o abridor real, ligado a uma URL. É aqui — e só aqui — que `@colyseus/sdk` é usado.
 *
 * Reconexão automática de queda transitória é do PRÓPRIO SDK (habilitada por padrão, com
 * backoff): a sessão só precisa expor `aoCair`/`aoVoltar` para a UI contar a história. O
 * `recoveryToken` cobre o outro caso — recarregar a página ou esgotar as tentativas.
 */
export function abridorColyseus(url: string): AbridorDeSessao {
  const client = new Client(url);
  return async (pedido) => {
    if (pedido.tipo === "voltar") {
      return envolverSala(await client.reconnect(pedido.recoveryToken));
    }
    const opcoes = { protocolVersion: PROTOCOL_VERSION, nick: pedido.nick, avatar: pedido.avatar };
    const sala = pedido.tipo === "criar"
      ? await client.create(SALA_KING, opcoes)
      : await client.joinById(pedido.codigo, opcoes);
    return envolverSala(sala);
  };
}
