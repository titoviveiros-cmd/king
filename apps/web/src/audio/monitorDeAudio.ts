// MONITOR CONTÍNUO DO RELÓGIO DE ÁUDIO — SÓ no APK DEBUG de QA (rodada 8, 04/11/2026).
//
// Para o teste físico de uso real (Home por 10 min, partida, painel, fundo e volta): a cada janela de ~5 s,
// quanto o relógio do contexto ATUAL andou em relação ao tempo real e quantos underruns o Chromium contou
// NAQUELA janela — sempre por DIFERENÇA entre o começo e o fim da janela (o `playbackStats` é acumulado
// desde que o contexto nasceu; usar o acumulado como se fosse da janela inflaria tudo). Troca de contexto
// no meio da janela: a janela não vale (o relógio recomeça do zero) e a próxima parte da base nova.
// Só LÊ: currentTime e playbackStats, na thread principal, uma vez por janela — nenhum nó, nenhum resume.

import type { Valor } from "./diagnostico.js";

export interface ContextoComEstatisticas {
  state: string;
  currentTime: number;
  playbackStats?: Record<string, unknown>;
}

const r4 = (n: number) => Number(n.toFixed(4));

/** As estatísticas do Chromium (experimentais), quando existem: underrun e duração total, em segundos. */
export function lerEstatisticas(ctx: ContextoComEstatisticas | null): Record<string, number> {
  const s = ctx?.playbackStats;
  if (!s || typeof s !== "object") return {};
  const out: Record<string, number> = {};
  for (const k of ["underrunDuration", "underrunEvents", "totalDuration", "averageLatency", "maximumLatency"]) {
    const v = (s as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** Diferença de um contador entre duas leituras — `null` se faltar uma das pontas (nunca o acumulado). */
export function diferenca(fim: Record<string, number>, inicio: Record<string, number>, k: string): number | null {
  return typeof fim[k] === "number" && typeof inicio[k] === "number" ? r4(fim[k] - inicio[k]) : null;
}

export interface JanelaDoMonitor {
  /** Segundos desde o início do monitor (fim da janela). */
  s: number;
  perfil: string;
  duracaoS: number;
  /** ΔcurrentTime / Δtempo real (1 = tempo real). `null` se o contexto trocou no meio. */
  razao: number | null;
  underrunEventos: number | null;
  underrunSegundos: number | null;
  totalSegundos: number | null;
  /** A página esteve visível nas duas pontas (fundo não conta na média). */
  visivel: boolean;
  contextoNovo: boolean;
  estado: string | null;
}

export interface ResumoPorPerfil {
  janelas: number;
  razaoMedia: number | null;
  razaoMin: number | null;
  abaixoDe095: number;
  underrunEventos: number;
  underrunSegundos: number;
  totalSegundos: number;
}

export interface ResumoDoMonitor {
  ligado: boolean;
  duracaoS: number;
  janelas: number;
  validas: number;
  trocasDeContexto: number;
  emFundo: number;
  porPerfil: Record<string, ResumoPorPerfil>;
  /** As últimas janelas (as mais recentes no fim). */
  recentes: JanelaDoMonitor[];
}

export interface Monitor {
  iniciar(): void;
  parar(): void;
  janelas(): JanelaDoMonitor[];
  resumo(recentes?: number): ResumoDoMonitor;
}

export function criarMonitor(o: {
  contexto: () => ContextoComEstatisticas | null;
  perfil: () => string;
  visivel: () => boolean;
  janelaMs?: number;
  max?: number;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (h: unknown) => void;
  agora?: () => number;
}): Monitor {
  const janelaMs = o.janelaMs ?? 5000;
  const max = o.max ?? 720; // 1 h em janelas de 5 s
  const agendar = o.agendar ?? ((fn, ms) => setTimeout(fn, ms));
  const cancelar = o.cancelar ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const agora = o.agora ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const lista: JanelaDoMonitor[] = [];
  let timer: unknown = null;
  let t0 = 0;
  let base: { ctx: ContextoComEstatisticas | null; p: number; c: number; st: Record<string, number>; vis: boolean } | null = null;

  const marcarBase = () => {
    const ctx = o.contexto();
    base = { ctx, p: agora(), c: ctx ? ctx.currentTime : 0, st: lerEstatisticas(ctx), vis: o.visivel() };
  };
  const tique = () => {
    timer = agendar(tique, janelaMs);
    const b = base;
    const ctx = o.contexto();
    const p = agora();
    if (!b) { marcarBase(); return; }
    const novo = ctx !== b.ctx;
    const dur = (p - b.p) / 1000;
    const st = lerEstatisticas(ctx);
    const vis = o.visivel() && b.vis;
    const j: JanelaDoMonitor = {
      s: r4((p - t0) / 1000),
      perfil: o.perfil(),
      duracaoS: r4(dur),
      razao: !novo && ctx && dur > 0 ? r4((ctx.currentTime - b.c) / dur) : null,
      underrunEventos: novo ? null : diferenca(st, b.st, "underrunEvents"),
      underrunSegundos: novo ? null : diferenca(st, b.st, "underrunDuration"),
      totalSegundos: novo ? null : diferenca(st, b.st, "totalDuration"),
      visivel: vis,
      contextoNovo: novo,
      estado: ctx ? ctx.state : null,
    };
    lista.push(j);
    if (lista.length > max) lista.shift();
    base = { ctx, p, c: ctx ? ctx.currentTime : 0, st, vis: o.visivel() };
  };

  return {
    iniciar() {
      if (timer !== null) return;
      t0 = agora();
      marcarBase();
      timer = agendar(tique, janelaMs);
    },
    parar() {
      if (timer !== null) cancelar(timer);
      timer = null;
      base = null;
    },
    janelas: () => lista.slice(),
    resumo(recentes = 12) {
      const porPerfil: Record<string, ResumoPorPerfil> = {};
      const somas: Record<string, { soma: number; n: number }> = {};
      let validas = 0;
      for (const j of lista) {
        if (j.razao === null || !j.visivel) continue;
        validas++;
        const r = (porPerfil[j.perfil] ??= { janelas: 0, razaoMedia: null, razaoMin: null, abaixoDe095: 0, underrunEventos: 0, underrunSegundos: 0, totalSegundos: 0 });
        const s = (somas[j.perfil] ??= { soma: 0, n: 0 });
        r.janelas++;
        s.soma += j.razao;
        s.n++;
        r.razaoMin = r.razaoMin === null ? j.razao : Math.min(r.razaoMin, j.razao);
        if (j.razao < 0.95) r.abaixoDe095++;
        r.underrunEventos = r4(r.underrunEventos + (j.underrunEventos ?? 0));
        r.underrunSegundos = r4(r.underrunSegundos + (j.underrunSegundos ?? 0));
        r.totalSegundos = r4(r.totalSegundos + (j.totalSegundos ?? 0));
      }
      for (const [k, s] of Object.entries(somas)) porPerfil[k].razaoMedia = r4(s.soma / s.n);
      const primeira = lista[0];
      const ultima = lista[lista.length - 1];
      return {
        ligado: timer !== null,
        duracaoS: primeira && ultima ? r4(ultima.s - primeira.s + primeira.duracaoS) : 0,
        janelas: lista.length,
        validas,
        trocasDeContexto: lista.filter((j) => j.contextoNovo).length,
        emFundo: lista.filter((j) => !j.visivel).length,
        porPerfil,
        recentes: lista.slice(-recentes),
      };
    },
  };
}

/** O resumo em campos planos (para o relatório). */
export function resumoEmCampos(r: ResumoDoMonitor): Record<string, Valor> {
  const out: Record<string, Valor> = {
    ligado: r.ligado, duracaoS: r.duracaoS, janelas: r.janelas, validas: r.validas,
    trocasDeContexto: r.trocasDeContexto, emFundo: r.emFundo,
  };
  for (const [p, v] of Object.entries(r.porPerfil)) {
    out[`${p}.janelas`] = v.janelas;
    out[`${p}.razaoMedia`] = v.razaoMedia;
    out[`${p}.razaoMin`] = v.razaoMin;
    out[`${p}.abaixoDe095`] = v.abaixoDe095;
    out[`${p}.underrunEventos`] = v.underrunEventos;
    out[`${p}.underrunSegundos`] = v.underrunSegundos;
    out[`${p}.fracaoUnderrun`] = v.totalSegundos > 0 ? r4(v.underrunSegundos / v.totalSegundos) : null;
  }
  return out;
}
