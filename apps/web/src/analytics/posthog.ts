// ADAPTADOR POSTHOG — a parte que fica no pacote inicial é só uma FILA e uma VALIDAÇÃO.
//
// COMO ENTRA: por `import()` dinâmico de `posthogSdk.ts`, e só quando `VITE_POSTHOG_KEY` e
// `VITE_POSTHOG_HOST` são válidas (ver `iniciar.ts`). Sem elas, nem esse arquivo nem o SDK são
// baixados. Com elas, os dois chegam juntos num arquivo SEPARADO, depois da Home — o pacote
// inicial do jogo não carrega o SDK, a configuração nem o filtro de saída.
//
// NUNCA BLOQUEIA: `enviar` devolve na hora. Enquanto o SDK não chegou, os eventos esperam numa
// fila curta; se ele não chegar (bloqueado, fora do ar, sem rede), a fila é descartada e o jogo
// nem percebe.
import type { Adaptador, Evento, Payload } from "./analytics.js";

/** O que o adaptador usa do SDK já iniciado: capturar, e mais nada. */
export interface ClientePostHog {
  capture(evento: Evento, propriedades: Payload): void;
}

/** Baixa o SDK, inicia com a configuração do KING e devolve o cliente. */
export type CarregadorDoSdk = (chave: string, host: string) => Promise<ClientePostHog>;

export const carregarSdkDoPostHog: CarregadorDoSdk = (chave, host) =>
  import("./posthogSdk.js").then((m) => m.abrirPostHog(chave, host));

/**
 * O token de projeto do PostHog começa com `phc_` e é PÚBLICO por desenho: identifica o projeto
 * e só permite enviar eventos. A chave pessoal (`phx_`) dá acesso de leitura e escrita à conta
 * inteira e NUNCA pode ir para o pacote — por isso só `phc_` é aceito.
 */
export function validarConfiguracaoDoPostHog(chave: unknown, host: unknown): { chave: string; host: string } | null {
  if (typeof chave !== "string" || typeof host !== "string") return null;
  const k = chave.trim();
  if (!/^phc_[A-Za-z0-9_-]{20,80}$/.test(k)) return null;
  let url: URL;
  try { url = new URL(host.trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  return { chave: k, host: `${url.origin}${url.pathname.replace(/\/+$/, "")}` };
}

export interface AdaptadorPostHog extends Adaptador {
  /** Resolve quando o SDK carregou (`true`) ou desistiu (`false`). Só testes esperam por isto. */
  pronto(): Promise<boolean>;
}

/** Quantos eventos esperam o SDK chegar. O `app_open` e o começo de partida cabem com folga. */
const LIMITE_DA_FILA = 50;

export function criarAdaptadorPostHog(opcoes: {
  chave: string;
  host: string;
  carregar?: CarregadorDoSdk;
  limiteDaFila?: number;
}): AdaptadorPostHog {
  const limite = opcoes.limiteDaFila ?? LIMITE_DA_FILA;
  const fila: [Evento, Payload][] = [];
  let cliente: ClientePostHog | null = null;
  let desistiu = false;
  let carregando: Promise<boolean> | null = null;

  const capturar = (evento: Evento, payload: Payload) => {
    try { cliente?.capture(evento, payload); } catch { /* SDK quebrado: o evento se perde, o jogo não */ }
  };

  // UMA carga e UM init por adaptador, e `iniciar.ts` cria um adaptador por página.
  const carregar = (): Promise<boolean> => {
    carregando ??= Promise.resolve()
      .then(() => (opcoes.carregar ?? carregarSdkDoPostHog)(opcoes.chave, opcoes.host))
      .then((c) => {
        if (!c || typeof c.capture !== "function") throw new Error("SDK inválido");
        cliente = c;
        for (const [e, p] of fila.splice(0)) capturar(e, p);
        return true;
      })
      .catch(() => {
        desistiu = true;
        fila.length = 0;
        return false;
      });
    return carregando;
  };

  return {
    nome: "posthog",
    enviar(evento, payload) {
      if (desistiu) return;
      if (cliente) { capturar(evento, payload); return; }
      if (fila.length < limite) fila.push([evento, payload]);
      void carregar();
    },
    pronto: carregar,
  };
}
