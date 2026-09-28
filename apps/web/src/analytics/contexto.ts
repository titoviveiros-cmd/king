// CONTEXTO — quem está medindo, e se a medição vale.
//
// Três propriedades vão em todo evento:
//
//   platform      web | capacitor_android | capacitor_ios
//   environment   production | preview | development
//   traffic_type  real | test
//
// A PLATAFORMA sai do objeto `Capacitor` que o próprio runtime nativo injeta na WebView. Não há
// import de `@capacitor/core` aqui: o pacote web não carrega nada de Capacitor por causa disto, e
// no navegador o objeto simplesmente não existe.
//
// O AMBIENTE vem do build: `VITE_KING_AMBIENTE` quando declarado (é o caminho do build de loja,
// que não passa pela Vercel), senão o `VERCEL_ENV` que a Vercel informa no build. Sem nenhum dos
// dois, é "development" — um build feito à mão nunca se passa por produção.
//
// O TRÁFEGO é "test" quando QUALQUER sinal disser que não é uma pessoa de verdade:
//   • o build declarou `VITE_KING_TRAFEGO=test` (todos os builds de e2e);
//   • o navegador é automatizado (`navigator.webdriver`);
//   • este navegador foi marcado com `?trafego=teste` (fica marcado até `?trafego=real`);
//   • a URL traz os ganchos de teste do jogo (`?seed=` ou `?mao=`).
// Nos dashboards, o filtro é sempre `traffic_type = real`. Prova, QA e smoke não contaminam.
import { AMBIENTES, PLATAFORMAS, TRAFEGOS } from "./analytics.js";

export type Plataforma = (typeof PLATAFORMAS)[number];
export type Ambiente = (typeof AMBIENTES)[number];
export type Trafego = (typeof TRAFEGOS)[number];

interface CapacitorGlobal {
  getPlatform?: () => string;
}

export function detectarPlataforma(global: unknown): Plataforma {
  try {
    const cap = (global as { Capacitor?: CapacitorGlobal } | null | undefined)?.Capacitor;
    const p = cap?.getPlatform?.();
    if (p === "android") return "capacitor_android";
    if (p === "ios") return "capacitor_ios";
  } catch { /* objeto estranho: é web */ }
  return "web";
}

export function detectarAmbiente(...declarados: (string | undefined)[]): Ambiente {
  for (const d of declarados) {
    const v = d?.trim().toLowerCase();
    if (v && (AMBIENTES as readonly string[]).includes(v)) return v as Ambiente;
  }
  return "development";
}

export interface SinaisDeTrafego {
  declarado?: string;
  webdriver?: boolean;
  marcado?: boolean;
  ganchosDeTeste?: boolean;
}

export function detectarTrafego(s: SinaisDeTrafego): Trafego {
  const declarado = s.declarado?.trim().toLowerCase();
  if (declarado === "test" || declarado === "teste") return "test";
  if (s.webdriver === true || s.marcado === true || s.ganchosDeTeste === true) return "test";
  return "real";
}

/** `?trafego=teste` marca este navegador; `?trafego=real` desmarca. Qualquer outra coisa: nada. */
export function marcaDeTrafegoNaUrl(search: string): "teste" | "real" | null {
  try {
    const v = new URLSearchParams(search).get("trafego")?.trim().toLowerCase();
    if (v === "teste" || v === "test") return "teste";
    if (v === "real") return "real";
  } catch { /* URL estranha: nenhuma marca */ }
  return null;
}

/** Os ganchos de teste do modo local (`?seed=`, `?mao=`) — partida montada, não jogada de verdade. */
export function temGanchosDeTeste(search: string): boolean {
  try {
    const q = new URLSearchParams(search);
    return q.has("seed") || q.has("mao");
  } catch {
    return false;
  }
}
