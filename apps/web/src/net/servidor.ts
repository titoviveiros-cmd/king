// ENDEREÇO DO SERVIDOR MULTIPLAYER.
//
// Regra de configuração (Fase 8):
//   • `VITE_KING_SERVER_URL` mandou → é ela, sempre.
//   • desenvolvimento sem a variável → assume o servidor local na porta padrão do Colyseus,
//     usando o MESMO host que serviu a página (assim o iPhone no Wi-Fi funciona, coerente com
//     `server.host: true` do Vite).
//   • produção/preview sem a variável → NÃO inventa endereço. O multiplayer fica indisponível
//     e a Home diz isso com todas as letras.
//
// Nenhum endereço de produção é escrito em código. Quando o servidor existir no Colyseus Cloud,
// a única mudança é a variável de ambiente.
import { PORTA_DEV_PADRAO } from "./constantes.js";

export type ResultadoDoServidor =
  | { ok: true; url: string; origem: "variavel" | "desenvolvimento" }
  | { ok: false; motivo: string };

/** `https://x` → `wss://x`. Aceita a variável já em ws/wss e não mexe. */
export function paraWebSocket(url: string): string {
  const limpa = url.trim().replace(/\/+$/, "");
  if (/^wss?:\/\//i.test(limpa)) return limpa;
  if (/^https:\/\//i.test(limpa)) return "wss://" + limpa.slice("https://".length);
  if (/^http:\/\//i.test(limpa)) return "ws://" + limpa.slice("http://".length);
  return "wss://" + limpa; // sem esquema: assume TLS, que é o que o Colyseus Cloud entrega
}

export interface AmbienteDoServidor {
  /** `import.meta.env.VITE_KING_SERVER_URL` */
  variavel?: string;
  /** `import.meta.env.DEV` */
  dev: boolean;
  /** `window.location.hostname` */
  host: string;
  /** `window.location.protocol` — define se o fallback local usa ws ou wss. */
  protocolo: string;
}

/** Puro, para poder ser testado sem `import.meta` nem `window`. */
export function resolverServidor(env: AmbienteDoServidor): ResultadoDoServidor {
  const bruta = env.variavel?.trim();
  if (bruta) return { ok: true, url: paraWebSocket(bruta), origem: "variavel" };

  if (env.dev) {
    const esquema = env.protocolo === "https:" ? "wss" : "ws";
    const host = env.host || "localhost";
    return { ok: true, url: `${esquema}://${host}:${PORTA_DEV_PADRAO}`, origem: "desenvolvimento" };
  }

  return {
    ok: false,
    motivo:
      "Multiplayer indisponível: a variável VITE_KING_SERVER_URL não está configurada nesta " +
      "publicação. Enquanto isso, o modo com bots funciona normalmente.",
  };
}

/** Leitura do ambiente real do Vite/browser. */
export function servidorConfigurado(): ResultadoDoServidor {
  const env = import.meta.env as { VITE_KING_SERVER_URL?: string; DEV?: boolean };
  return resolverServidor({
    variavel: env.VITE_KING_SERVER_URL,
    dev: !!env.DEV,
    host: typeof window === "undefined" ? "localhost" : window.location.hostname,
    protocolo: typeof window === "undefined" ? "http:" : window.location.protocol,
  });
}
