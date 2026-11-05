// RODADA 7 — o laboratório do APK DEBUG: relógio lado a lado, escada do grafo e a leitura no relatório.
// O que este arquivo trava:
//  - a razão do relógio (ΔcurrentTime/Δparede) sai certa, inclusive abaixo do tempo real e com paradas;
//  - cada degrau da escada monta o grafo do KING com os MESMOS parâmetros e na topologia certa;
//  - a carga da música tem o mesmo nº e tipo de vozes do compasso do KING e não acumula nós;
//  - o relatório junta R, I1/I2 e a escada numa leitura, sem afirmar causa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PARAMETROS_DO_GRAFO } from "./engine.js";
import {
  DEGRAUS, agendarCompassoDeCarga, criarContextoLimpo, criarEscada, medirRelogio, montarDegrau, type GrafoDaEscada,
} from "./laboratorio.js";
import { criarDiagnostico, type Retrato } from "./diagnostico.js";
import type { ResultadoDoTeste, SondaDoMotor, TrocaRegistrada } from "./engine.js";
import { criarSessaoDeDiagnostico, leituraDaRodada7, ambienteDoAparelho, type ExecutoresDiferenciais } from "./relatorioDeAudio.js";

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] }); });
afterEach(() => { vi.useRealTimers(); });

// ───────── relógio ─────────

describe("medirRelogio: a razão do relógio do contexto × tempo real", () => {
  const relogioFalso = (razao: (paredeMs: number) => number) => {
    let parede = 0;
    let ctxT = 10;
    const ctx = {
      state: "running", baseLatency: 0.01, outputLatency: 0.06,
      get currentTime() { return ctxT; },
      getOutputTimestamp: () => ({ contextTime: ctxT - 0.06, performanceTime: parede }),
    };
    const esperar = async (ms: number) => { parede += ms; ctxT += (ms / 1000) * razao(parede); };
    return { ctx, esperar, agora: () => parede };
  };

  it("contexto a 55% do tempo real (o que o Android mostrou): razão 0,55, sem paradas", async () => {
    const f = relogioFalso(() => 0.55);
    const m = await medirRelogio("KING", f.ctx, 60_000, { esperar: f.esperar, agora: f.agora });
    expect(m.razao).toBeCloseTo(0.55, 3);
    expect(m.razaoMin).toBeCloseTo(0.55, 3);
    expect(m.razaoSaida).toBeCloseTo(0.55, 3);
    expect(m.paradas).toBe(0);
    expect(m.amostras).toBe(240);
    expect(m).toMatchObject({ latBase: 0.01, latSaida: 0.06, estadoInicial: "running", estadoFinal: "running" });
  });

  it("tempo real com 3 s parado no meio: razão < 1, paradas contadas e o maior trecho parado", async () => {
    const f = relogioFalso((p) => (p > 20_000 && p <= 23_000 ? 0 : 1));
    const m = await medirRelogio("KING", f.ctx, 60_000, { esperar: f.esperar, agora: f.agora });
    expect(m.razao).toBeCloseTo(57 / 60, 3);
    expect(m.paradas).toBe(12);
    expect(m.maiorParadaMs).toBe(3000);
    expect(m.razaoMin).toBeLessThan(0.5);
    expect(m.razaoMax).toBeCloseTo(1, 3);
  });

  it("sem contexto: medição vazia, sem quebrar", async () => {
    expect(await medirRelogio("KING", null, 1000)).toMatchObject({ razao: null, amostras: 0 });
  });

  it("rodada 8: underruns da MEDIÇÃO e de cada janela = diferença (o contexto já vinha com 1.000 acumulados)", async () => {
    let parede = 0;
    let ctxT = 0;
    const stats = { underrunEvents: 1_000, underrunDuration: 50, totalDuration: 400 };
    const ctx = { state: "running", get currentTime() { return ctxT; }, playbackStats: stats };
    // 0–10 s limpo; 10–20 s com 4 underruns por segundo
    const esperar = async (ms: number) => {
      parede += ms;
      ctxT += ms / 1000;
      stats.totalDuration += ms / 1000;
      if (parede > 10_000) { stats.underrunEvents += (ms / 1000) * 4; stats.underrunDuration += (ms / 1000) * 0.1; }
    };
    const m = await medirRelogio("KING", ctx, 20_000, { esperar, agora: () => parede });
    expect(m.extras["stats.underrunEvents"], "só os desta medição, nunca os 1.000 de antes").toBe(40);
    expect(m.extras["stats.underrunDuration"]).toBe(1);
    expect(m.extras["stats.janelas"]).toBe(4);
    expect(m.extras["stats.janelasComUnderrun"]).toBe(2);
    expect(m.extras["stats.underrunEventosJanelaMax"]).toBe(20);
    expect(m.extras["stats.semBase"]).toBeUndefined();
  });
});

// ───────── escada ─────────

function ctxFalso() {
  const ligacoes: string[] = [];
  let id = 0;
  const no = (tipo: string) => {
    const nome = `${tipo}#${++id}`;
    const p = () => { const x = { value: 0, setValueAtTime: () => x, exponentialRampToValueAtTime: () => x }; return x; };
    const n: Record<string, unknown> = {
      nome, tipo, gain: p(), frequency: p(), offset: p(), threshold: p(), knee: p(), ratio: p(), attack: p(), release: p(),
      fftSize: 0, buffer: null, type: "", loop: false, onended: null as null | (() => void),
      connect: (d: { nome: string }) => { ligacoes.push(`${nome}→${d.nome}`); },
      disconnect: () => { for (let i = ligacoes.length - 1; i >= 0; i--) if (ligacoes[i].startsWith(`${nome}→`)) ligacoes.splice(i, 1); },
      start: () => {}, stop: () => {},
    };
    return n;
  };
  let fechado = false;
  const ctx = {
    sampleRate: 8000, currentTime: 0, state: "running", destination: { nome: "destination" },
    createGain: () => no("gain"), createDynamicsCompressor: () => no("comp"), createAnalyser: () => no("analyser"),
    createConvolver: () => no("conv"), createBiquadFilter: () => no("biquad"), createOscillator: () => no("osc"),
    createBufferSource: () => no("ruido"), createConstantSource: () => no("const"),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    resume: () => Promise.resolve(), close: () => { fechado = true; return Promise.resolve(); },
  };
  return { ctx: ctx as unknown as BaseAudioContext, ligacoes, fechado: () => fechado };
}

describe("a escada monta o grafo DO KING, peça por peça", () => {
  it("E1 → E2 → E3: topologia e parâmetros do KING; E1 deixa de ir direto à saída no E2", () => {
    const f = ctxFalso();
    let g: GrafoDaEscada = montarDegrau(null, f.ctx, "E1");
    expect(f.ligacoes).toEqual([`${(g.entrada as unknown as { nome: string }).nome}→destination`]);
    g = montarDegrau(g, f.ctx, "E2");
    const comp = g.comp as unknown as { nome: string; threshold: { value: number }; ratio: { value: number } };
    expect(comp.threshold.value).toBe(PARAMETROS_DO_GRAFO.compressor.threshold);
    expect(comp.ratio.value).toBe(PARAMETROS_DO_GRAFO.compressor.ratio);
    const entrada = (g.entrada as unknown as { nome: string }).nome;
    expect(f.ligacoes).toContain(`${entrada}→${comp.nome}`);
    expect(f.ligacoes).not.toContain(`${entrada}→destination`);
    expect(f.ligacoes.filter((l) => l.endsWith("→destination"))).toHaveLength(1); // só o master
    expect(f.ligacoes.some((l) => /gain#\d+→analyser/.test(l))).toBe(true);
    g = montarDegrau(g, f.ctx, "E3");
    const rin = (g.reverbIn as unknown as { nome: string }).nome;
    expect(f.ligacoes.some((l) => l.startsWith(`${rin}→conv`))).toBe(true);
    expect(f.ligacoes.some((l) => /gain#\d+→comp/.test(l) && !l.startsWith(entrada))).toBe(true); // wet → comp
    const antes = f.ligacoes.length;
    montarDegrau(g, f.ctx, "E3");
    expect(f.ligacoes.length, "degrau repetido não duplica nós").toBe(antes);
  });

  it("um compasso de carga = 30 vozes como as do KING (20 violão, 2 baixo, 8 ganzá), todas soltas no fim", () => {
    const f = ctxFalso();
    let g: GrafoDaEscada | null = null;
    for (const { d } of DEGRAUS.slice(0, 4)) g = montarDegrau(g, f.ctx, d);
    const base = f.ligacoes.length;
    const fontes: { onended: (() => void) | null }[] = [];
    const orig = f.ctx.createOscillator.bind(f.ctx);
    const origR = f.ctx.createBufferSource.bind(f.ctx);
    (f.ctx as unknown as Record<string, unknown>).createOscillator = () => { const o = orig(); fontes.push(o as never); return o; };
    (f.ctx as unknown as Record<string, unknown>).createBufferSource = () => { const o = origR(); fontes.push(o as never); return o; };
    expect(agendarCompassoDeCarga(g!, 0.1)).toBe(30);
    expect(fontes).toHaveLength(30);
    expect(f.ligacoes.length).toBeGreaterThan(base + 30 * 3);
    for (const s of fontes) s.onended?.();
    expect(f.ligacoes.length, "vozes que acabaram ficaram ligadas (acúmulo)").toBe(base);
  });

  it("a escada sobe E1…E5, para no fim e fecha o contexto limpo; o contexto nasce no 1º toque (síncrono)", async () => {
    const f = ctxFalso();
    let criados = 0;
    const win = { AudioContext: function () { criados++; return f.ctx; } as unknown as new () => AudioContext };
    const esc = criarEscada(win, (ms) => new Promise((ok) => setTimeout(ok, ms)));
    const p = esc.proximo(1000);
    expect(criados, "o contexto precisa nascer dentro do toque").toBe(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect((await p)?.degrau).toBe("E1");
    for (const d of ["E2", "E3", "E4", "E5"]) {
      const q = esc.proximo(1000);
      await vi.advanceTimersByTimeAsync(1500);
      expect((await q)?.degrau).toBe(d);
    }
    expect(await esc.proximo(1000)).toBeNull();
    await esc.encerrar();
    expect(f.fechado()).toBe(true);
    expect(criados).toBe(1);
  });

  it("contexto limpo: o mesmo caminho do A + sinal constante inaudível (1e-4) na saída", async () => {
    const f = ctxFalso();
    const l = criarContextoLimpo({ AudioContext: function () { return f.ctx; } as unknown as new () => AudioContext });
    expect(f.ligacoes.some((x) => /const#\d+→destination/.test(x))).toBe(true);
    await l!.fechar();
    expect(f.fechado()).toBe(true);
  });
});

// ───────── leitura no relatório ─────────

describe("leitura da rodada 7 no relatório (não afirma causa)", () => {
  const R0: Retrato = { fase: "ativo", contexto: "running", relogio: 5, geracao: 1 };
  const sonda: SondaDoMotor = {
    retrato: () => ({ ...R0 }), antesDoToque: () => [], trocas: (): TrocaRegistrada[] => [],
    tocarTeste: async (qual): Promise<ResultadoDoTeste> => ({ qual, tocou: true, motivo: null, antes: R0, durante: R0 }),
    tomDireto: async (): Promise<ResultadoDoTeste> => ({ qual: "direto", tocou: true, motivo: null, antes: R0, durante: R0 }),
    recuperar: () => {}, contextoParaMedir: () => null, pararMusica: () => true, isolarGrafo: () => true, restaurar: () => ({ religou: true, musica: true }),
  };
  it("R KING 0,55 × limpo 1,0 → só o KING abaixo do tempo real; I2 ouvido; escada falha no E4", async () => {
    const tec: Record<string, Record<string, number>> = {
      R: { "rei.razao": 0.55, "limpo.razao": 1.0 }, I1: { razao: 0.6 }, I2: { razao: 0.99 },
      E1: { razao: 1 }, E2: { razao: 1 }, E3: { razao: 0.98 }, E4: { razao: 0.5 },
    };
    const ex: ExecutoresDiferenciais = {
      executar: async (letra) => ({ letra, mecanismo: "m", aceitou: true, erro: null, tecnico: tec[letra] ?? {}, semOuvir: letra === "R" }),
      sistema: async () => null,
    };
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => sonda, diferenciais: ex });
    sess.registrarFalha();
    const resp: Record<string, boolean> = { I1: false, I2: true, E1: true, E2: true, E3: true, E4: false };
    for (const l of ["R", "I1", "I2", "E1", "E2", "E3", "E4"] as const) {
      const p = sess.testarDiferencial(l);
      await vi.runAllTimersAsync();
      const t = await p;
      if (l in resp) sess.responder(t, resp[l]);
    }
    const linhas = leituraDaRodada7(sess.ocorrencias()[0]);
    expect(linhas).toContain("RENDERIZAÇÃO FALTANDO (playbackStats do Chromium, se exposto): KING não exposto × limpo não exposto");
    expect(linhas[1]).toMatch(/RELÓGIOS .*KING 0\.55 × limpo 1 do tempo real → SÓ o contexto do KING renderiza abaixo do tempo real/);
    expect(linhas).toContain("ISOLAMENTO I1 (música parada): relógio 0.6 do tempo real · A′ NÃO ouvido");
    expect(linhas).toContain("ISOLAMENTO I2 (grafo isolado): relógio 0.99 do tempo real · A′ OUVIDO");
    expect(linhas[linhas.length - 1]).toMatch(/ESCADA: E1=ouviu\/1 · E2=ouviu\/1 · E3=ouviu\/0\.98 · E4=NÃO\/0\.5 → falha a partir de E4/);
    const txt = sess.relatorio(ambienteDoAparelho({}));
    expect(txt).toMatch(/#1 R m .*OUVIU: — \(medição\)/);
    expect(txt).toMatch(/SÓ o contexto do KING/);
  });
});
