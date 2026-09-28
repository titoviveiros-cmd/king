// AQUISIÇÃO — de onde a pessoa veio, reduzido ao que é categoria.
//
// A URL de entrada é território do visitante: qualquer um pode escrever qualquer coisa nela. Por
// isso NADA dela sai inteiro. Só cinco campos, cada um normalizado e limitado:
//
//   utm_source, utm_medium, utm_campaign, utm_content  → rótulos curtos, minúsculos, sem acento;
//   referrer_host                                      → só o DOMÍNIO de quem mandou, sem caminho.
//
// Valor que não vira rótulo limpo é DESCARTADO, não cortado: um texto longo cortado ainda é texto
// livre, e um id cortado ainda é um pedaço de id. `utm_term` fica de fora de propósito — costuma
// ser a busca que a pessoa digitou.
import { pareceIdentificador } from "./analytics.js";

export interface Toque {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  referrer_host?: string;
}

const CAMPOS_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;
const MAX_ORIGEM = 64;
const MAX_HOST = 100;

/** "Promoção de Verão" → "promocao_de_verao". O que não couber no formato some. */
export function normalizarOrigem(bruto: string | null | undefined): string | undefined {
  if (typeof bruto !== "string") return undefined;
  const s = bruto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase()
    .replace(/[\s+]+/g, "_");
  if (s.length === 0 || s.length > MAX_ORIGEM) return undefined;
  if (!/^[a-z0-9_.-]+$/.test(s)) return undefined;
  if (pareceIdentificador(s)) return undefined;
  return s;
}

const semWww = (h: string) => h.replace(/^www\./, "");

/**
 * O domínio de quem mandou. Vazio quando não há referrer, quando o referrer é o próprio KING
 * (navegação interna não é aquisição) ou quando não é um endereço web. `android-app://` passa:
 * é como o Android informa que a visita veio de um app (Gmail, WhatsApp).
 */
export function hostDoReferrer(referrer: string | null | undefined, hostProprio: string): string | undefined {
  if (!referrer) return undefined;
  let url: URL;
  try { url = new URL(referrer); } catch { return undefined; }
  if (!["http:", "https:", "android-app:"].includes(url.protocol)) return undefined;
  const host = semWww(url.hostname.toLowerCase());
  if (!host || host === semWww(hostProprio.toLowerCase())) return undefined;
  if (host.length > MAX_HOST || !/^[a-z0-9.-]+$/.test(host)) return undefined;
  return host;
}

/** O toque DESTA abertura: as utm da URL e o domínio do referrer, já limpos. */
export function lerToque(search: string, referrer: string, hostProprio: string): Toque {
  const toque: Toque = {};
  let q: URLSearchParams;
  try { q = new URLSearchParams(search); } catch { q = new URLSearchParams(); }
  for (const campo of CAMPOS_UTM) {
    const v = normalizarOrigem(q.get(campo));
    if (v) toque[campo] = v;
  }
  const host = hostDoReferrer(referrer, hostProprio);
  if (host) toque.referrer_host = host;
  return toque;
}

/** O primeiro toque, com os nomes do contexto (`first_*`). `utm_content` fica só no evento. */
export function contextoDoPrimeiroToque(t: Toque | undefined): Record<string, string> {
  const c: Record<string, string> = {};
  if (!t) return c;
  if (t.utm_source) c.first_utm_source = t.utm_source;
  if (t.utm_medium) c.first_utm_medium = t.utm_medium;
  if (t.utm_campaign) c.first_utm_campaign = t.utm_campaign;
  if (t.referrer_host) c.first_referrer_host = t.referrer_host;
  return c;
}
