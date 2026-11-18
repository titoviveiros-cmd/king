// RECORDES & XP (Entrega D) — o que o cliente LÊ e o que ele guarda NO APARELHO. Nenhuma decisão.
//
// ══ ONLINE ══
// A pontuação final de uma partida online é gravada pelo SERVIDOR autoritativo, na transação do
// crédito (`king_private.registrar_placares`). O cliente só LÊ as PRÓPRIAS linhas (RLS): o Top 3
// (`placares_online`), as últimas partidas creditadas (`xp_eventos`) e o XP em que um nível começa
// (`xp_por_nivel`, a mesma fórmula do banco). Nada aqui escreve no banco, e nada informa pontuação.
//
// ══ SOLO ══
// Partida contra os bots nunca chega ao banco. O Top 3 Solo vive NESTE aparelho, numa chave
// versionada: não é ranking verificado, não sincroniza entre aparelhos e não diz que é. Partidas de
// depuração (`?seed=`, `?mao=`) não contam — ver `KingGame.contaParaRecordes`.
//
// FALHA NUNCA ATRAPALHA: sem sessão, sem a migração, banco fora ou resposta estranha → a parte online
// fica "indisponível" (`null`) e o resto da tela é o de sempre.
import { clienteCompartilhado } from "./clienteSupabase.js";
import { identidadeConfigurada } from "./identidade.js";
import { chaveDaSessao } from "./progresso.js";
import { marcadorDeSessao } from "./sessaoNativa.js";

export type Modalidade = "solo" | "online";

/** Uma linha do Top 3 (de qualquer modalidade). */
export interface Recorde {
  /** A partida que gerou o recorde (UUID no online; o id local no solo). */
  id: string;
  pontos: number;
  /** Quando a partida terminou (ISO 8601). */
  em: string;
}

/** Uma partida online recente, como o ledger de XP a registrou. */
export interface PartidaRecente {
  id: string;
  posicao: number;
  xp: number;
  em: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehData = (s: unknown): s is string => typeof s === "string" && Number.isFinite(Date.parse(s));
const inteiro = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/**
 * A ORDEM do Top 3, igual nas duas modalidades e igual à do banco: maior pontuação; no empate, a
 * conquista mais ANTIGA primeiro (quem chegou lá antes); por fim, o id — nunca duas ordens possíveis.
 */
export function ordemDoTop(a: Recorde, b: Recorde): number {
  return b.pontos - a.pontos || Date.parse(a.em) - Date.parse(b.em) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// ───────────────────────── SOLO, neste aparelho ─────────────────────────

export const CHAVE_DO_SOLO = "king:recordes:solo";
const VERSAO_DO_SOLO = 1;
export const TAMANHO_DO_TOP = 3;

interface ArquivoDoSolo { v: number; top: Recorde[]; vistos: string[] }

function lerArquivoDoSolo(): ArquivoDoSolo {
  try {
    const bruto = JSON.parse(globalThis.localStorage?.getItem(CHAVE_DO_SOLO) ?? "null") as Partial<ArquivoDoSolo> | null;
    if (!bruto || bruto.v !== VERSAO_DO_SOLO || !Array.isArray(bruto.top) || !Array.isArray(bruto.vistos)) return { v: VERSAO_DO_SOLO, top: [], vistos: [] };
    const top = bruto.top.filter((r): r is Recorde =>
      !!r && typeof r.id === "string" && r.id.length > 0 && r.id.length <= 64 && inteiro(r.pontos) && ehData(r.em));
    const vistos = bruto.vistos.filter((x): x is string => typeof x === "string").slice(-50);
    return { v: VERSAO_DO_SOLO, top: [...top].sort(ordemDoTop).slice(0, TAMANHO_DO_TOP), vistos };
  } catch {
    return { v: VERSAO_DO_SOLO, top: [], vistos: [] };
  }
}

/** O Top 3 Solo deste aparelho, já ordenado. */
export function topSolo(): Recorde[] {
  return lerArquivoDoSolo().top;
}

/**
 * Registra o fim de uma partida solo COMPLETA. Devolve a posição (1, 2 ou 3) se ela entrou no Top 3
 * agora, ou `null`. Idempotente pelo id: a mesma partida nunca gera dois registros — nem se o Placar
 * Final remontar.
 */
export function registrarSolo(id: string, pontos: number, em: string): 1 | 2 | 3 | null {
  if (!id || !inteiro(pontos) || !ehData(em)) return null;
  const arq = lerArquivoDoSolo();
  if (arq.vistos.includes(id) || arq.top.some((r) => r.id === id)) return null;
  const top = [...arq.top, { id, pontos, em }].sort(ordemDoTop).slice(0, TAMANHO_DO_TOP);
  const posicao = top.findIndex((r) => r.id === id);
  try {
    globalThis.localStorage?.setItem(CHAVE_DO_SOLO, JSON.stringify({ v: VERSAO_DO_SOLO, top, vistos: [...arq.vistos, id].slice(-50) }));
  } catch { return null; /* sem armazenamento: nada foi gravado, nada a celebrar */ }
  return posicao >= 0 ? ((posicao + 1) as 1 | 2 | 3) : null;
}

// ───────────────────────── "NOVO RECORDE!" — uma vez por resultado ─────────────────────────

const CHAVE_DAS_CELEBRACOES = "king:recordes:celebrados";

export function jaCelebrado(id: string): boolean {
  try {
    const l = JSON.parse(globalThis.localStorage?.getItem(CHAVE_DAS_CELEBRACOES) ?? "[]") as unknown;
    return Array.isArray(l) && l.includes(id);
  } catch { return false; }
}

export function marcarCelebrado(id: string): void {
  try {
    const l = JSON.parse(globalThis.localStorage?.getItem(CHAVE_DAS_CELEBRACOES) ?? "[]") as unknown;
    const lista = Array.isArray(l) ? l.filter((x): x is string => typeof x === "string") : [];
    if (!lista.includes(id)) globalThis.localStorage?.setItem(CHAVE_DAS_CELEBRACOES, JSON.stringify([...lista, id].slice(-50)));
  } catch { /* sem armazenamento: a celebração pode voltar uma vez, e só */ }
}

// ───────────────────────── ONLINE, lido do banco ─────────────────────────

type Resposta<T> = Promise<{ data: T | null; error: unknown }>;

export interface PortaDosRecordes {
  topOnline(): Resposta<Array<{ partida_id?: unknown; pontos?: unknown; terminada_em?: unknown }>>;
  recentes(): Resposta<Array<{ partida_id?: unknown; posicao?: unknown; xp_delta?: unknown; criado_em?: unknown }>>;
  xpDoNivel(nivel: number): Resposta<{ xp?: unknown }>;
}

export function criarLeitorDeRecordes(porta: () => Promise<PortaDosRecordes | null>, temSessao: () => boolean = () => true) {
  async function comPorta<T>(f: (p: PortaDosRecordes) => Promise<T | null>): Promise<T | null> {
    if (!temSessao()) return null;
    try {
      const p = await porta();
      return p ? await f(p) : null;
    } catch { return null; }
  }
  return {
    /** O Top 3 Online. `[]` = nenhum ainda; `null` = indisponível. */
    topOnline: () => comPorta(async (p) => {
      const { data, error } = await p.topOnline();
      if (error || !Array.isArray(data)) return null;
      const linhas = data.filter((l) => typeof l.partida_id === "string" && UUID.test(l.partida_id) && inteiro(l.pontos) && ehData(l.terminada_em))
        .map((l) => ({ id: l.partida_id as string, pontos: l.pontos as number, em: l.terminada_em as string }));
      return linhas.length === data.length ? [...linhas].sort(ordemDoTop).slice(0, TAMANHO_DO_TOP) : null;
    }),
    /** As últimas cinco partidas online creditadas. `[]` = nenhuma; `null` = indisponível. */
    recentes: () => comPorta(async (p) => {
      const { data, error } = await p.recentes();
      if (error || !Array.isArray(data)) return null;
      const linhas = data.filter((l) => typeof l.partida_id === "string" && inteiro(l.posicao) && (l.posicao as number) >= 1
        && (l.posicao as number) <= 4 && inteiro(l.xp_delta) && (l.xp_delta as number) >= 0 && ehData(l.criado_em))
        .map((l) => ({ id: l.partida_id as string, posicao: l.posicao as number, xp: l.xp_delta as number, em: l.criado_em as string }));
      return linhas.length === data.length ? linhas.slice(0, 5) : null;
    }),
    /** O XP em que um nível começa, pela curva do BANCO. `null` = indisponível. */
    xpDoNivel: (nivel: number) => comPorta(async (p) => {
      if (!Number.isInteger(nivel) || nivel < 1 || nivel > 100) return null;
      const { data, error } = await p.xpDoNivel(nivel);
      const xp = Number(data?.xp);
      return error || !Number.isSafeInteger(xp) || xp < 0 ? null : xp;
    }),
  };
}

export type LeitorDeRecordes = ReturnType<typeof criarLeitorDeRecordes>;

function sessaoGuardada(url: string): boolean {
  const chave = chaveDaSessao(url);
  if (!chave) return false;
  let local: Storage | null = null;
  try { local = globalThis.localStorage ?? null; } catch { return false; }
  try { return !!local?.getItem(chave) || marcadorDeSessao(local); } catch { return false; }
}

let unico: { url: string; leitor: LeitorDeRecordes } | null = null;

/** O leitor real, sobre o MESMO cliente Supabase da identidade. `null` sem identidade configurada. */
export function leitorDeRecordesConfigurado(): LeitorDeRecordes | null {
  const r = identidadeConfigurada();
  if (!r.configurado) return null;
  if (unico?.url === r.url) return unico.leitor;
  const leitor = criarLeitorDeRecordes(async () => {
    const c = await clienteCompartilhado(r);
    if (!c) return null;
    return {
      topOnline: async () => await c.from("placares_online").select("partida_id, pontos, terminada_em")
        .order("pontos", { ascending: false }).order("terminada_em", { ascending: true }).order("partida_id", { ascending: true }).limit(TAMANHO_DO_TOP),
      recentes: async () => await c.from("xp_eventos").select("partida_id, posicao, xp_delta, criado_em")
        .order("criado_em", { ascending: false }).limit(5),
      xpDoNivel: async (nivel) => await c.from("xp_por_nivel").select("xp").eq("nivel", nivel).maybeSingle(),
    };
  }, () => sessaoGuardada(r.url));
  unico = { url: r.url, leitor };
  return leitor;
}

/** Data brasileira, no fuso de São Paulo (o mesmo dia que a sequência usa): 18/11/2026. */
export function dataBr(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
  } catch { return ""; }
}
