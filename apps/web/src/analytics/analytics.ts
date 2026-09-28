// ANALYTICS — camada NEUTRA. O fornecedor é um detalhe atrás de um adaptador.
//
// O jogo chama `analytics.track(evento, payload)` e pronto; para onde isso vai (ou se vai a lugar
// nenhum) é problema de um ADAPTADOR, trocável numa linha. Sem configuração, o adaptador é o
// silêncio. Com `VITE_POSTHOG_KEY` + `VITE_POSTHOG_HOST`, é o PostHog (ver `posthog.ts`). Nenhum
// componente React conhece o SDK: todos passam por aqui ou pelos módulos desta pasta.
//
// QUATRO REGRAS, e as quatro estão codificadas, não só documentadas:
//
//   1. ANALYTICS NUNCA BLOQUEIA O JOGO. Toda chamada é `try/catch` e devolve `void`. Um adaptador
//      que lança, que trava, que demora — nada disso chega ao jogador. Falha de medição é
//      silenciosa para quem está jogando e visível só no console de desenvolvimento.
//   2. NENHUMA PII. O apelido NÃO é identificador: é texto livre digitado pela pessoa, muitas
//      vezes o primeiro nome, às vezes o nome inteiro. Nenhum id de conta, de jogador, de sala, de
//      partida ou de lançamento de XP sai daqui. O que passa é contagem e categoria.
//   3. CÓDIGO DE SALA NÃO É EVENTO. Quatro dígitos são a chave de entrar numa partida privada de
//      outras pessoas. Nunca sai daqui.
//   4. ESQUEMA FECHADO. Cada evento declara as propriedades que aceita e o formato de cada uma.
//      Chave fora do esquema é descartada; valor fora do formato é descartado. A lista de chaves
//      proibidas continua como segunda barreira — e um teste garante que nenhuma chave do esquema
//      cai nela, para que alargar o esquema não abra a porta por engano.
import { MENSAGENS } from "../ui/social.js";

/**
 * Os eventos que o KING conhece. Conjunto fechado: erro de digitação não compila, e evento fora
 * da lista não sai nem por um adaptador que o aceitasse.
 *
 * Cada um responde a uma pergunta de produto — ver `docs/KING-ANALYTICS.md`. `invite_shared`
 * NÃO está aqui de propósito: o KING ainda não tem link de convite nem folha de compartilhar o
 * convite, e um evento declarado que nunca dispara é um zero enganoso num painel.
 */
export const EVENTOS = [
  "app_open",
  "tutorial_started",
  "tutorial_completed",
  "first_match_started",
  "match_started",
  "match_finished",
  "room_created",
  "room_joined",
  "invite_code_copied",
  "result_shared",
  "disconnect",
  "reconnect",
  "rematch_clicked",
  "social_message_sent",
] as const;
export type Evento = (typeof EVENTOS)[number];

export type ValorSimples = string | number | boolean;
export type Payload = Record<string, ValorSimples>;

/** O formato aceito de UMA propriedade. */
export type Regra =
  /** Rótulo curto, minúsculo, sem espaço. Com `valores`, só os do conjunto. */
  | { tipo: "rotulo"; max: number; valores?: readonly string[] }
  | { tipo: "inteiro"; min: number; max: number }
  | { tipo: "booleano" };

const rotulo = (max: number, valores?: readonly string[]): Regra => ({ tipo: "rotulo", max, valores });

export const MODOS = ["local", "online"] as const;
export type Modo = (typeof MODOS)[number];
export const METODOS_DE_COMPARTILHAR = ["native_share", "clipboard"] as const;
export type MetodoDeCompartilhar = (typeof METODOS_DE_COMPARTILHAR)[number];
export const PLATAFORMAS = ["web", "capacitor_android", "capacitor_ios"] as const;
export const AMBIENTES = ["production", "preview", "development"] as const;
export const TRAFEGOS = ["real", "test"] as const;

const MODO = rotulo(8, MODOS);
const POSICAO: Regra = { tipo: "inteiro", min: 1, max: 4 };
/** Origem de campanha: rótulo livre, mas curto e sem cara de identificador. */
const ORIGEM = rotulo(64);
/** Host de quem mandou a pessoa: só o domínio, nunca o caminho nem a query. */
const HOST = rotulo(100);

/** O que cada evento aceita. Tudo que não estiver aqui não sai. */
export const ESQUEMA: { readonly [E in Evento]: Readonly<Record<string, Regra>> } = {
  app_open: {
    first_open: { tipo: "booleano" },
    utm_source: ORIGEM,
    utm_medium: ORIGEM,
    utm_campaign: ORIGEM,
    utm_content: ORIGEM,
    referrer_host: HOST,
  },
  tutorial_started: { passo: { tipo: "inteiro", min: 0, max: 99 } },
  tutorial_completed: {},
  first_match_started: { modo: MODO },
  match_started: {
    modo: MODO,
    humanos: { tipo: "inteiro", min: 1, max: 4 },
    bots: { tipo: "inteiro", min: 0, max: 3 },
  },
  match_finished: { modo: MODO, posicao: POSICAO, empate: { tipo: "booleano" } },
  room_created: {},
  room_joined: {},
  invite_code_copied: {},
  result_shared: { method: rotulo(16, METODOS_DE_COMPARTILHAR) },
  disconnect: { modo: MODO },
  reconnect: { modo: MODO },
  rematch_clicked: { modo: MODO, posicao: POSICAO },
  // A etiqueta pode ir: é do conjunto fechado do servidor, não é texto de ninguém.
  social_message_sent: { mensagem: rotulo(32, MENSAGENS.map((m) => m.id)) },
};

/**
 * O CONTEXTO: vai em TODO evento. Quem está medindo (plataforma, ambiente, tráfego real ou de
 * teste) e de onde a pessoa veio da PRIMEIRA vez neste aparelho. O primeiro toque vai em todo
 * evento porque o analytics é anônimo: sem perfil de pessoa, a origem só pode ser recortada se
 * estiver no próprio evento — em `match_finished`, por exemplo, para saber que campanha traz
 * gente que TERMINA partida, e não só gente que abre o app.
 */
export const ESQUEMA_DO_CONTEXTO: Readonly<Record<string, Regra>> = {
  platform: rotulo(24, PLATAFORMAS),
  environment: rotulo(16, AMBIENTES),
  traffic_type: rotulo(8, TRAFEGOS),
  first_utm_source: ORIGEM,
  first_utm_medium: ORIGEM,
  first_utm_campaign: ORIGEM,
  first_referrer_host: HOST,
};

/**
 * Chaves que NUNCA saem, mesmo que alguém as passe por engano ou as ponha no esquema. É a segunda
 * barreira — a primeira é não coletar, a do meio é o esquema. Comparação sem maiúsculas e sem
 * separadores: `roomCode`, `room_code` e `room-code` são a mesma chave.
 */
const PROIBIDAS = new Set([
  "nick", "nickname", "apelido", "nome", "name", "player", "jogador", "usuario", "user",
  "email", "telefone", "phone", "cpf", "senha", "password",
  "roomcode", "codigo", "code", "roomid", "sala", "room",
  "token", "recoverytoken", "sessiontoken", "accesstoken", "refreshtoken", "jwt", "apikey",
  "playerid", "userid", "uid", "sub", "authid", "id", "distinctid",
  "matchid", "partidaid", "partida", "ledgerid", "xpeventoid", "eventoid",
  "ip", "lat", "lon", "latitude", "longitude",
  "url", "href", "link", "currenturl", "referrer", "texto", "text",
]);
/** Radicais que condenam a chave onde quer que apareçam (`player_nick`, `userEmail`, …). */
const RADICAIS_PROIBIDOS = ["nick", "email", "token", "senha", "password", "roomcode", "playerid", "userid", "url", "href"];

export function chaveProibida(chave: string): boolean {
  const k = chave.toLowerCase().replace(/[^a-z]/g, "");
  return PROIBIDAS.has(k) || RADICAIS_PROIBIDOS.some((r) => k.includes(r));
}

const FORMATO_DE_ROTULO = /^[a-z0-9_.:-]+$/;

/**
 * Um rótulo livre (sem conjunto fechado) que tem CARA DE IDENTIFICADOR não passa, mesmo curto e
 * minúsculo: só dígitos (código de sala, telefone, id numérico), uma sequência hexadecimal longa
 * (uuid, token, hash) ou algo com arroba. Uma campanha chamada "2026" é perdida; um código de sala
 * que alguém pendurou numa utm, não escapa.
 */
export function pareceIdentificador(v: string): boolean {
  return /^\d+$/.test(v) || /[0-9a-f]{12,}/.test(v) || /[0-9a-f]{8}-[0-9a-f]{4}/.test(v) || v.includes("@");
}

function valorValido(valor: unknown, regra: Regra): ValorSimples | undefined {
  switch (regra.tipo) {
    case "booleano":
      return typeof valor === "boolean" ? valor : undefined;
    case "inteiro":
      return typeof valor === "number" && Number.isInteger(valor) && valor >= regra.min && valor <= regra.max
        ? valor : undefined;
    case "rotulo": {
      if (typeof valor !== "string" || valor.length === 0 || valor.length > regra.max) return undefined;
      if (!FORMATO_DE_ROTULO.test(valor)) return undefined;
      if (regra.valores) return regra.valores.includes(valor) ? valor : undefined;
      return pareceIdentificador(valor) ? undefined : valor;
    }
  }
}

/** Aplica um esquema: devolve só o que ele aceita, no formato que ele aceita. */
export function aplicarEsquema(esquema: Readonly<Record<string, Regra>>, bruto: unknown, rotuloDoAviso: string): Payload {
  const limpo: Payload = {};
  if (!bruto || typeof bruto !== "object") return limpo;
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (chaveProibida(chave)) {
      aviso(`analytics: chave "${chave}" descartada em ${rotuloDoAviso} (identifica pessoa, sala ou partida)`);
      continue;
    }
    const regra = Object.prototype.hasOwnProperty.call(esquema, chave) ? esquema[chave] : undefined;
    if (!regra) {
      aviso(`analytics: chave "${chave}" fora do esquema de ${rotuloDoAviso}`);
      continue;
    }
    const v = valorValido(valor, regra);
    if (v === undefined) {
      aviso(`analytics: valor de "${chave}" descartado em ${rotuloDoAviso} (fora do formato)`);
      continue;
    }
    limpo[chave] = v;
  }
  return limpo;
}

export function ehEvento(nome: unknown): nome is Evento {
  return typeof nome === "string" && (EVENTOS as readonly string[]).includes(nome);
}

/** As propriedades de UM evento, limpas pelo esquema dele. Evento desconhecido: nada. */
export function sanitizar(evento: Evento, payload: unknown): Payload {
  if (!ehEvento(evento)) return {};
  return aplicarEsquema(ESQUEMA[evento], payload, evento);
}

export function sanitizarContexto(contexto: unknown): Payload {
  return aplicarEsquema(ESQUEMA_DO_CONTEXTO, contexto, "contexto");
}

/** Para onde os eventos vão. Um provedor implementa isto e nada mais muda. */
export interface Adaptador {
  nome: string;
  enviar(evento: Evento, payload: Payload): void;
}

/** O padrão: não vai a lugar nenhum. Sem configuração, o KING não mede nada. */
export const adaptadorSilencioso: Adaptador = { nome: "silencioso", enviar() {} };

/**
 * Adaptador de desenvolvimento: imprime no console. Serve para conferir o funil sem contratar
 * ninguém — e é a prova viva de que a instrumentação está no lugar certo.
 */
export const adaptadorDeConsole: Adaptador = {
  nome: "console",
  enviar(evento, payload) {
    // eslint-disable-next-line no-console
    console.info(`[analytics] ${evento}`, payload);
  },
};

export function aviso(msg: string): void {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn(msg);
    }
  } catch { /* ambiente sem import.meta: silêncio */ }
}

class Analytics {
  #adaptador: Adaptador = adaptadorSilencioso;
  #contexto: Payload = {};

  /** Troca o destino. Chamado uma vez na inicialização — nunca no meio de uma partida. */
  usar(adaptador: Adaptador): void {
    this.#adaptador = adaptador;
  }

  get destino(): string {
    return this.#adaptador.nome;
  }

  /** O contexto que vai em todo evento (ver `ESQUEMA_DO_CONTEXTO`). Passa pelo esquema também. */
  definirContexto(contexto: Payload): void {
    try {
      this.#contexto = sanitizarContexto(contexto);
    } catch { /* contexto inválido: segue sem contexto, nunca sem jogo */ }
  }

  get contexto(): Payload {
    return { ...this.#contexto };
  }

  /**
   * Registra um evento. **Nunca lança, nunca devolve promessa, nunca espera rede.**
   *
   * O `try` não é zelo excessivo: o adaptador é código de terceiro por definição, e o dia em que
   * um SDK de métrica lançar dentro de um `onClick` do leque, a carta tem de ser jogada mesmo
   * assim.
   */
  track(evento: Evento, payload?: Payload): void {
    try {
      if (!ehEvento(evento)) {
        aviso(`analytics: evento "${String(evento)}" fora do conjunto fechado`);
        return;
      }
      this.#adaptador.enviar(evento, { ...this.#contexto, ...sanitizar(evento, payload) });
    } catch (e) {
      aviso(`analytics: adaptador "${this.#adaptador.nome}" falhou em "${evento}": ${String(e)}`);
    }
  }
}

/** A instância que o jogo usa. */
export const analytics = new Analytics();
