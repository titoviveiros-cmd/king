// LABORATÓRIO DE ÁUDIO — SÓ no APK DEBUG de QA (rodada 7, 04/11/2026).
//
// Evidência da rodada 6 (Android 13, Chromium 156): um AudioContext NOVO e leve (teste A) é ouvido; o
// contexto do KING, "running" e com sinal no analisador, não é — nem com um tom direto no destination
// dele (A′) — e o relógio dele andou ~55% do tempo real em 120 s. Pergunta: o contexto do KING está
// renderizando ABAIXO do tempo real (carga do grafo), ou o contexto em si quebrou (independente dos nós)?
//
// Três instrumentos, todos por botão do painel e sem nenhum reparo escondido:
//   1. RELÓGIOS — mede, lado a lado e pelo mesmo tempo (≥ 60 s), o contexto do KING e um contexto
//      limpo criado pelo MESMO caminho do teste A: Δperformance.now × ΔcurrentTime, razão por janela,
//      intervalos sem renderizar, getOutputTimestamp, latências e, se o Chromium expuser, playbackStats.
//   2. ISOLAMENTO — no contexto do KING: parar a música, isolar o grafo (master fora do destination e
//      do analisador), medir de novo e tocar A′; "restaurar" religa tudo.
//   3. ESCADA — num contexto limpo (caminho do A), o grafo do KING montado peça por peça com os MESMOS
//      parâmetros: E1 ganho · E2 + compressor/master/analisador · E3 + reverb · E4 + carga da música ·
//      E5 + efeitos. Cada degrau toca um marcador audível e mede o relógio.
// O mesmo código da escada roda num OfflineAudioContext para medir o CUSTO de cada degrau no PC.

import type { Valor } from "./diagnostico.js";
import { PARAMETROS_DO_GRAFO, gerarImpulso } from "./perfilDoGrafo.js";
import { diferenca, lerEstatisticas } from "./monitorDeAudio.js";

const esperarDeVerdade = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const agoraDeVerdade = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ───────────────────────── 1. relógio ─────────────────────────

export interface MedicaoDeRelogio {
  rotulo: string;
  duracaoMs: number;
  amostras: number;
  /** ΔcurrentTime / Δparede no período inteiro (1 = tempo real). */
  razao: number | null;
  /** A pior e a melhor janela de ~5 s. */
  razaoMin: number | null;
  razaoMax: number | null;
  /** Amostras seguidas (passo ~250 ms) em que o relógio não andou nada, e o maior trecho parado. */
  paradas: number;
  maiorParadaMs: number;
  /** Δ do relógio da SAÍDA (getOutputTimestamp.contextTime) / Δparede: o que o dispositivo tocou. */
  razaoSaida: number | null;
  latBase: number | null;
  latSaida: number | null;
  estadoInicial: string | null;
  estadoFinal: string | null;
  /** Chromium experimental (quando existir): falta de renderização medida pelo próprio navegador. */
  extras: Record<string, Valor>;
}

interface ContextoMedivel {
  state: string;
  currentTime: number;
  baseLatency?: number;
  outputLatency?: number;
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
  playbackStats?: Record<string, unknown>;
}

const r4 = (n: number) => Number(n.toFixed(4));


/**
 * Mede o relógio de um contexto por `ms` (amostra a cada `passoMs`). Só LÊ: currentTime,
 * getOutputTimestamp, latências — nada de resume, nada de nó novo.
 */
export async function medirRelogio(
  rotulo: string,
  ctx: ContextoMedivel | null,
  ms: number,
  o: { passoMs?: number; janelaMs?: number; esperar?: (ms: number) => Promise<void>; agora?: () => number } = {},
): Promise<MedicaoDeRelogio> {
  const passo = o.passoMs ?? 250;
  const janela = o.janelaMs ?? 5000;
  const esperar = o.esperar ?? esperarDeVerdade;
  const agora = o.agora ?? agoraDeVerdade;
  const vazio: MedicaoDeRelogio = {
    rotulo, duracaoMs: 0, amostras: 0, razao: null, razaoMin: null, razaoMax: null, paradas: 0, maiorParadaMs: 0,
    razaoSaida: null, latBase: null, latSaida: null, estadoInicial: null, estadoFinal: null, extras: {},
  };
  if (!ctx) return vazio;
  const saida = () => { try { const t = ctx.getOutputTimestamp?.(); return typeof t?.contextTime === "number" ? t.contextTime : null; } catch { return null; } };
  const p0 = agora();
  const c0 = ctx.currentTime;
  const s0 = saida();
  const st0 = lerEstatisticas(ctx);
  const estadoInicial = ctx.state;
  let amostras = 0;
  let paradas = 0;
  let parado = 0;
  let maiorParada = 0;
  let ultimaC = c0;
  let ultimaP = p0;
  let jP = p0;
  let jC = c0;
  let jSt = st0;
  const janelas: number[] = [];
  // rodada 8: underruns POR JANELA = diferença entre o começo e o fim dela (o playbackStats é acumulado)
  const underrunsPorJanela: number[] = [];
  while (agora() - p0 < ms) {
    await esperar(passo);
    const p = agora();
    const c = ctx.currentTime;
    amostras++;
    if (c - ultimaC <= 0) { paradas++; parado += p - ultimaP; maiorParada = Math.max(maiorParada, parado); } else parado = 0;
    ultimaC = c;
    ultimaP = p;
    if (p - jP >= janela) {
      janelas.push((c - jC) / ((p - jP) / 1000));
      const st = lerEstatisticas(ctx);
      const ev = diferenca(st, jSt, "underrunEvents");
      if (ev !== null) underrunsPorJanela.push(ev);
      jP = p; jC = c; jSt = st;
    }
  }
  const p1 = agora();
  const c1 = ctx.currentTime;
  const s1 = saida();
  const parede = (p1 - p0) / 1000;
  const st1 = lerEstatisticas(ctx);
  const extras: Record<string, Valor> = {};
  // SEMPRE a diferença fim − começo da medição; sem a leitura do começo, o número não entra (nunca o acumulado)
  for (const k of Object.keys(st1)) {
    const d = diferenca(st1, st0, k);
    if (d !== null) extras[`stats.${k}`] = d;
  }
  if (Object.keys(st1).length && !Object.keys(st0).length) extras["stats.semBase"] = true;
  if (underrunsPorJanela.length) {
    extras["stats.underrunEventosJanelaMax"] = Math.max(...underrunsPorJanela);
    extras["stats.janelasComUnderrun"] = underrunsPorJanela.filter((v) => v > 0).length;
    extras["stats.janelas"] = underrunsPorJanela.length;
  }
  return {
    rotulo,
    duracaoMs: Math.round(p1 - p0),
    amostras,
    razao: parede > 0 ? r4((c1 - c0) / parede) : null,
    razaoMin: janelas.length ? r4(Math.min(...janelas)) : null,
    razaoMax: janelas.length ? r4(Math.max(...janelas)) : null,
    paradas,
    maiorParadaMs: Math.round(maiorParada),
    razaoSaida: s0 !== null && s1 !== null && parede > 0 ? r4((s1 - s0) / parede) : null,
    latBase: typeof ctx.baseLatency === "number" && Number.isFinite(ctx.baseLatency) ? r4(ctx.baseLatency) : null,
    latSaida: typeof ctx.outputLatency === "number" && Number.isFinite(ctx.outputLatency) ? r4(ctx.outputLatency) : null,
    estadoInicial,
    estadoFinal: ctx.state,
    extras,
  };
}

export function medicaoEmCampos(m: MedicaoDeRelogio): Record<string, Valor> {
  return {
    razao: m.razao, razaoMin: m.razaoMin, razaoMax: m.razaoMax, razaoSaida: m.razaoSaida,
    paradas: m.paradas, maiorParadaMs: m.maiorParadaMs, duracaoMs: m.duracaoMs, amostras: m.amostras,
    latBase: m.latBase, latSaida: m.latSaida, estado: `${m.estadoInicial}→${m.estadoFinal}`, ...m.extras,
  };
}

// ───────────────────────── contexto limpo (o caminho do teste A) ─────────────────────────

type CtorDeContexto = new () => AudioContext;
export interface JanelaDeAudio { AudioContext?: CtorDeContexto; webkitAudioContext?: CtorDeContexto }

/**
 * O contexto do teste A: `new AudioContext()` sem opções, retomado dentro do toque. Para o relógio ser
 * comparável, ele recebe um sinal CONSTANTE e inaudível (1e-4, ≈ −80 dB): contexto 100% mudo pode ser
 * trocado pelo navegador por uma saída "de mentira" para poupar bateria, e aí a comparação não vale.
 */
export function criarContextoLimpo(win: JanelaDeAudio | undefined): { ctx: AudioContext; fechar: () => Promise<void> } | null {
  const Ctor = win?.AudioContext ?? win?.webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  void ctx.resume?.().catch(() => {});
  let fonte: ConstantSourceNode | null = null;
  try {
    if (typeof ctx.createConstantSource === "function") {
      fonte = ctx.createConstantSource();
      fonte.offset.value = 1e-4;
      fonte.connect(ctx.destination);
      fonte.start();
    }
  } catch { fonte = null; }
  return {
    ctx,
    fechar: async () => {
      try { fonte?.stop(); fonte?.disconnect(); } catch { /* já parou */ }
      await Promise.race([ctx.close().catch(() => {}), esperarDeVerdade(1000)]);
    },
  };
}

// ───────────────────────── 3. a escada (o grafo do KING, peça por peça) ─────────────────────────

export type Degrau = "E1" | "E2" | "E3" | "E4" | "E5";
export const DEGRAUS: { d: Degrau; nome: string }[] = [
  { d: "E1", nome: "só ganho (como o teste A)" },
  { d: "E2", nome: "+ compressor, master e analisador do KING" },
  { d: "E3", nome: "+ reverb do KING (convolução 2,4 s estéreo)" },
  { d: "E4", nome: "+ carga da música (o mesmo nº e tipo de vozes por compasso)" },
  { d: "E5", nome: "+ efeitos (uma voz de efeito a cada 400 ms)" },
];

export interface GrafoDaEscada {
  ctx: BaseAudioContext;
  /** Onde o marcador e as vozes entram (o "barramento"). */
  entrada: GainNode;
  comp: DynamicsCompressorNode | null;
  reverbIn: GainNode | null;
  ruido: AudioBuffer | null;
  nos: number;
}

/** Monta (ou estende) o grafo até o degrau pedido, com os parâmetros DO KING. Idempotente por degrau. */
export function montarDegrau(g: GrafoDaEscada | null, ctx: BaseAudioContext, d: Degrau): GrafoDaEscada {
  const P = PARAMETROS_DO_GRAFO;
  const nivel = Number(d.slice(1));
  let atual: GrafoDaEscada = g ?? (() => {
    const entrada = ctx.createGain();
    entrada.gain.value = 1;
    entrada.connect(ctx.destination);
    return { ctx, entrada, comp: null, reverbIn: null, ruido: null, nos: 1 };
  })();
  if (nivel >= 2 && !atual.comp) {
    // E2: a entrada passa a ir para compressor → master → destination (+ analisador em derivação)
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = P.compressor.threshold;
    comp.knee.value = P.compressor.knee;
    comp.ratio.value = P.compressor.ratio;
    comp.attack.value = P.compressor.attack;
    comp.release.value = P.compressor.release;
    const master = ctx.createGain();
    master.gain.value = P.master;
    comp.connect(master);
    master.connect(ctx.destination);
    const an = ctx.createAnalyser();
    an.fftSize = P.analisadorFft;
    master.connect(an);
    atual.entrada.disconnect();
    atual.entrada.connect(comp);
    atual = { ...atual, comp, nos: atual.nos + 3 };
  }
  if (nivel >= 3 && !atual.reverbIn && atual.comp) {
    const comp = atual.comp;
    const conv = ctx.createConvolver();
    conv.buffer = gerarImpulso(ctx, P.reverb.segundos, P.reverb.decaimento);
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = P.reverb.corte;
    const wet = ctx.createGain();
    wet.gain.value = P.reverb.wet;
    const reverbIn = ctx.createGain();
    reverbIn.connect(conv);
    conv.connect(damp);
    damp.connect(wet);
    wet.connect(comp);
    atual = { ...atual, reverbIn, nos: atual.nos + 4 };
  }
  if (nivel >= 4 && !atual.ruido) {
    const len = Math.floor(ctx.sampleRate * P.ruidoSegundos);
    const ruido = ctx.createBuffer(1, len, ctx.sampleRate);
    const dd = ruido.getChannelData(0);
    for (let i = 0; i < len; i++) dd[i] = Math.random() * 2 - 1;
    atual = { ...atual, ruido };
  }
  return atual;
}

/** Uma voz como o `rawTone`/`rawNoise` do KING: fonte → filtro → ganho → entrada, + envio ao reverb. */
function voz(g: GrafoDaEscada, t: number, o: { freq: number; dur: number; gain: number; wave?: OscillatorType; corte?: number; ruido?: boolean; envio: number }): void {
  const ctx = g.ctx;
  let fonte: AudioScheduledSourceNode;
  let filtro: BiquadFilterNode | null = null;
  if (o.ruido && g.ruido) {
    const b = ctx.createBufferSource();
    b.buffer = g.ruido;
    b.loop = true;
    filtro = ctx.createBiquadFilter();
    filtro.type = "bandpass";
    filtro.frequency.value = o.freq;
    fonte = b;
  } else {
    const osc = ctx.createOscillator();
    osc.type = o.wave ?? "sine";
    osc.frequency.value = o.freq;
    if (o.corte) { filtro = ctx.createBiquadFilter(); filtro.type = "lowpass"; filtro.frequency.value = o.corte; }
    fonte = osc;
  }
  const ganho = ctx.createGain();
  ganho.gain.setValueAtTime(0.0001, t);
  ganho.gain.exponentialRampToValueAtTime(Math.max(o.gain, 0.0002), t + 0.006);
  ganho.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  if (filtro) { fonte.connect(filtro); filtro.connect(ganho); } else fonte.connect(ganho);
  ganho.connect(g.entrada);
  let envio: GainNode | null = null;
  if (g.reverbIn && o.envio > 0) { envio = ctx.createGain(); envio.gain.value = o.envio; ganho.connect(envio); envio.connect(g.reverbIn); }
  fonte.onended = () => { for (const n of [fonte, filtro, ganho, envio]) { try { n?.disconnect(); } catch { /* fechado */ } } };
  fonte.start(t);
  fonte.stop(t + o.dur + 0.05);
}

/** Um compasso da bossa do KING em CARGA: 20 vozes de violão, 2 de baixo, 8 de ganzá — os mesmos nós. */
const ACORDE = [146.83, 185.0, 220.0, 277.18];
export function agendarCompassoDeCarga(g: GrafoDaEscada, t0: number): number {
  let n = 0;
  for (const slot of [0, 3, 6, 10, 13]) {
    ACORDE.forEach((f, i) => { voz(g, t0 + slot * 0.125 + i * 0.007, { freq: f, dur: 0.52, gain: 0.03 - i * 0.003, wave: "triangle", corte: 2400, envio: 0.32 }); n++; });
  }
  voz(g, t0, { freq: 73.42, dur: 0.46, gain: 0.085, corte: 380, envio: 0.14 }); n++;
  voz(g, t0 + 11 * 0.125, { freq: 110, dur: 0.4, gain: 0.062, corte: 380, envio: 0.14 }); n++;
  for (let i = 0; i < 16; i += 2) { voz(g, t0 + i * 0.125, { freq: 6800, dur: 0.032, gain: i % 4 === 0 ? 0.012 : 0.007, ruido: true, envio: 0.18 }); n++; }
  return n;
}

/** Uma voz de efeito (como o `tone` do KING): seno curto com envio ao reverb. */
export function agendarEfeitoDeCarga(g: GrafoDaEscada, t: number): void {
  voz(g, t, { freq: 880, dur: 0.16, gain: 0.08, envio: 0.18 });
}

/** O marcador que a pessoa precisa OUVIR em cada degrau (moderado, 523 Hz, 0,25 s). */
export function agendarMarcador(g: GrafoDaEscada, t: number): void {
  voz(g, t, { freq: 523.25, dur: 0.25, gain: 0.2, envio: 0.18 });
}

export interface Escada {
  /** Sobe um degrau (síncrono até agendar; dentro do toque), toca o marcador e mede o relógio por `ms`. */
  proximo(ms?: number): Promise<{ degrau: Degrau; nome: string; medicao: MedicaoDeRelogio; vozes: number } | null>;
  degrau(): Degrau | null;
  encerrar(): Promise<void>;
}

/** A escada num contexto LIMPO criado pelo caminho do A (o contexto nasce no 1º toque). */
export function criarEscada(win: JanelaDeAudio | undefined, esperar = esperarDeVerdade): Escada {
  let limpo: ReturnType<typeof criarContextoLimpo> = null;
  let g: GrafoDaEscada | null = null;
  let i = -1;
  const timers = new Set<ReturnType<typeof setInterval>>();
  const parar = () => { for (const t of timers) clearInterval(t); timers.clear(); };
  return {
    degrau: () => (i >= 0 ? DEGRAUS[i].d : null),
    async proximo(ms = 6000) {
      if (i + 1 >= DEGRAUS.length) return null;
      if (!limpo) limpo = criarContextoLimpo(win);
      if (!limpo) return null;
      const ctx = limpo.ctx;
      i++;
      const { d, nome } = DEGRAUS[i];
      parar();
      g = montarDegrau(g, ctx, d);
      const grafo = g;
      let vozes = 0;
      // o marcador audível, a cada 500 ms, pelo grafo do degrau
      const marcar = () => { agendarMarcador(grafo, ctx.currentTime + 0.05); vozes++; };
      marcar();
      timers.add(setInterval(marcar, 500));
      if (i >= 3) {
        const compasso = () => { vozes += agendarCompassoDeCarga(grafo, ctx.currentTime + 0.12); };
        compasso();
        timers.add(setInterval(compasso, 2000));
      }
      if (i >= 4) timers.add(setInterval(() => { agendarEfeitoDeCarga(grafo, ctx.currentTime + 0.02); vozes++; }, 400));
      const medicao = await medirRelogio(`escada ${d}`, ctx, ms, { esperar });
      parar();
      return { degrau: d, nome, medicao, vozes };
    },
    async encerrar() {
      parar();
      const l = limpo;
      limpo = null;
      g = null;
      i = -1;
      if (l) await l.fechar();
    },
  };
}
