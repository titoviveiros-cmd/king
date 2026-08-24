// ANALYTICS — camada NEUTRA, sem fornecedor.
//
// Decisão de produto: medir sim, casar com um fornecedor não — ainda não. O jogo chama
// `analytics.track(evento, payload)` e pronto; para onde isso vai (ou se vai a lugar nenhum) é
// problema de um ADAPTADOR, trocável numa linha. Hoje o adaptador padrão é o silêncio.
//
// TRÊS REGRAS, e as três estão codificadas, não só documentadas:
//
//   1. ANALYTICS NUNCA BLOQUEIA O JOGO. Toda chamada é `try/catch` e devolve `void`. Um adaptador
//      que lança, que trava, que demora — nada disso chega ao jogador. Falha de medição é
//      silenciosa para quem está jogando e visível só no console de desenvolvimento.
//   2. NENHUMA PII. O apelido NÃO é identificador: é texto livre digitado pela pessoa, muitas
//      vezes o primeiro nome, às vezes o nome inteiro. `sanitizar` derruba qualquer chave da
//      lista proibida e qualquer valor que não seja número, booleano ou texto curto de conjunto
//      conhecido. O que passa é contagem e categoria.
//   3. CÓDIGO DE SALA NÃO É EVENTO. Quatro dígitos são a chave de entrar numa partida privada de
//      outras pessoas. Nunca sai daqui.

/** Os eventos que o KING conhece. Conjunto fechado: erro de digitação não compila. */
export const EVENTOS = [
  "app_open",
  "tutorial_started",
  "tutorial_completed",
  "room_created",
  "room_joined",
  "match_started",
  "match_finished",
  "disconnect",
  "reconnect",
  "rematch_clicked",
  "social_message_sent",
] as const;
export type Evento = (typeof EVENTOS)[number];

export type ValorSimples = string | number | boolean;
export type Payload = Record<string, ValorSimples>;

/**
 * Chaves que NUNCA saem, mesmo que alguém as passe por engano. A lista é a última linha de
 * defesa — a primeira é não coletar. Se um dia uma delas aparecer num `track`, some em silêncio
 * e o desenvolvedor vê o aviso no console.
 */
const PROIBIDAS = [
  "nick", "nickname", "apelido", "nome", "name", "player", "jogador",
  "email", "e_mail", "telefone", "phone", "cpf",
  "roomcode", "room_code", "codigo", "code", "roomid", "room_id",
  "token", "recoverytoken", "recovery_token", "sessiontoken", "playerid", "player_id",
  "ip", "lat", "lon", "latitude", "longitude", "userid", "user_id",
];

/** Texto livre não passa: só rótulo curto, minúsculo, de conjunto conhecido. */
const ROTULO_ACEITO = /^[a-z0-9_.:-]{1,32}$/;

export function sanitizar(payload: Payload | undefined): Payload {
  const limpo: Payload = {};
  if (!payload) return limpo;
  for (const [chave, valor] of Object.entries(payload)) {
    if (PROIBIDAS.includes(chave.toLowerCase().replace(/[^a-z_]/g, ""))) {
      aviso(`analytics: chave "${chave}" descartada (identifica pessoa ou sala)`);
      continue;
    }
    if (typeof valor === "number") {
      if (Number.isFinite(valor)) limpo[chave] = valor;
      continue;
    }
    if (typeof valor === "boolean") { limpo[chave] = valor; continue; }
    if (typeof valor === "string") {
      if (ROTULO_ACEITO.test(valor)) limpo[chave] = valor;
      else aviso(`analytics: valor de "${chave}" descartado (texto livre não é métrica)`);
    }
  }
  return limpo;
}

/** Para onde os eventos vão. Um provedor futuro implementa isto e nada mais muda. */
export interface Adaptador {
  nome: string;
  enviar(evento: Evento, payload: Payload): void;
}

/** O padrão: não vai a lugar nenhum. Nenhum fornecedor foi contratado nem configurado. */
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

function aviso(msg: string): void {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.warn(msg);
    }
  } catch { /* ambiente sem import.meta: silêncio */ }
}

class Analytics {
  #adaptador: Adaptador = adaptadorSilencioso;

  /** Troca o destino. Chamado uma vez na inicialização — nunca no meio de uma partida. */
  usar(adaptador: Adaptador): void {
    this.#adaptador = adaptador;
  }

  get destino(): string {
    return this.#adaptador.nome;
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
      this.#adaptador.enviar(evento, sanitizar(payload));
    } catch (e) {
      aviso(`analytics: adaptador "${this.#adaptador.nome}" falhou em "${evento}": ${String(e)}`);
    }
  }
}

/** A instância que o jogo usa. */
export const analytics = new Analytics();
