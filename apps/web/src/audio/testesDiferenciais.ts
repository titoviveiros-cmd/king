// TESTES DIFERENCIAIS DE ÁUDIO — SÓ no APK DEBUG de QA (rodada 6, 04/11/2026).
//
// O relatório real do Android 13 / Chromium 156 mostrou o grafo do KING com sinal (rms no analisador,
// que escuta o MASTER, o último nó antes do destino), contexto "running", relógio andando, e sete
// testes "não ouvi" — mesmo depois de trocar o contexto. O que falta saber é EM QUE CAMADA o som some.
// Quatro mecanismos independentes, cada um com a resposta "ouvi / não ouvi":
//   A  Web Audio ISOLADO — um AudioContext à parte, Oscillator → Gain → destination (sem motor,
//      sem barramentos, sem música); A′ o mesmo tom direto no destino do contexto DO JOGO;
//   B  <audio> HTML5 com um WAV curto gerado aqui (original), sem MediaElementSource, fora do Web Audio;
//   C  Android NATIVO (AudioTrack, plugin local só do APK debug), sem passar pela WebView;
//   D  o motor do KING (os testes de música e efeito da rodada 5).
// Nenhum deles repara nada, nem grava nada (sem microfone). Tudo injetável para os testes.

import type { Valor } from "./diagnostico.js";
import type { ResultadoDoTeste, SondaDoMotor } from "./engine.js";

/**
 * A, A′, B, C (rodada 6) e os experimentos da rodada 7: R = relógios lado a lado (KING × contexto limpo,
 * 60 s, sem "ouviu?"); I1 = música parada + medição + A′; I2 = grafo isolado + medição + A′; E1…E5 =
 * degraus da escada (o grafo do KING montado peça por peça num contexto limpo).
 */
export type LetraDiferencial = "A" | "A′" | "B" | "C" | "R" | "I1" | "I2" | "E1" | "E2" | "E3" | "E4" | "E5"
  // rodada 8: variantes do grafo do KING no PRÓPRIO motor (A original · B sem convolução · C leve = a correção ·
  // D leve + polifonia reduzida · E leve a 24 kHz, só medição)
  | "VA" | "VB" | "VC" | "VD" | "VE";

export interface ResultadoDiferencial {
  letra: LetraDiferencial;
  mecanismo: string;
  /** O mecanismo aceitou tocar (não quer dizer que o alto-falante tocou). */
  aceitou: boolean;
  tecnico: Record<string, Valor>;
  erro: string | null;
  /** Medição pura (R): não toca nada para ouvir — sem "ouviu?". */
  semOuvir?: boolean;
}

/** O plugin nativo (Android) — só existe no APK debug; fora dele, `null`. */
export interface PluginDeAudioNativo {
  estado(): Promise<Record<string, unknown>>;
  tocarTom(o: { freq: number; ms: number }): Promise<Record<string, unknown>>;
}

export type EstadoDoSistema = { campos: Record<string, Valor>; eventos: Record<string, Valor>[] };

const esperarDeVerdade = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const nomeDoErro = (e: unknown): string =>
  (e instanceof Error ? `${e.name}: ${e.message}` : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e)).slice(0, 120);

/** Corrida com prazo: há WebView e ponte nativa que nunca respondem. */
async function comPrazo<T>(p: Promise<T>, ms: number, esperar: (ms: number) => Promise<void>): Promise<T | "prazo"> {
  return Promise.race([p, esperar(ms).then(() => "prazo" as const)]);
}

/** Achata o que vem da ponte nativa em campos primitivos (listas viram texto; nada de objeto solto). */
export function achatar(o: Record<string, unknown>, prefixo = "", limite = 60): Record<string, Valor> {
  const out: Record<string, Valor> = {};
  for (const [k, v] of Object.entries(o)) {
    if (Object.keys(out).length >= limite) break;
    const chave = prefixo ? `${prefixo}.${k}` : k;
    if (v === null || typeof v === "boolean" || typeof v === "number") out[chave] = v;
    else if (typeof v === "string") out[chave] = v.slice(0, 80);
    else if (Array.isArray(v)) out[chave] = v.filter((x) => ["string", "number", "boolean"].includes(typeof x)).join(",").slice(0, 120);
    else if (typeof v === "object" && k !== "eventos") Object.assign(out, achatar(v as Record<string, unknown>, chave, limite - Object.keys(out).length));
  }
  return out;
}

/** O estado do áudio do Android (volume de mídia, mudo, rota, reproduções ativas, eventos), ou null. */
export async function lerSistema(plugin: PluginDeAudioNativo | null, esperar = esperarDeVerdade): Promise<EstadoDoSistema | null> {
  if (!plugin) return null;
  try {
    const r = await comPrazo(plugin.estado(), 1500, esperar);
    if (r === "prazo") return { campos: { erro: "a ponte nativa não respondeu em 1,5 s" }, eventos: [] };
    const eventos = Array.isArray(r.eventos) ? (r.eventos as Record<string, unknown>[]).slice(-60).map((e) => achatar(e, "", 12)) : [];
    return { campos: achatar(r), eventos };
  } catch (e) {
    return { campos: { erro: nomeDoErro(e) }, eventos: [] };
  }
}

// ───────────────────────── A — Web Audio isolado ─────────────────────────

type CtorDeContexto = new () => AudioContext;
export interface JanelaDeAudio {
  AudioContext?: CtorDeContexto;
  webkitAudioContext?: CtorDeContexto;
}

/**
 * A: um contexto À PARTE (fecha sozinho), Oscillator 523 Hz → Gain 0,2 → destination, 0,6 s. Começa
 * SÍNCRONO (dentro do toque): o contexto nasce e o tom é agendado antes de qualquer `await`.
 */
export function testarWebAudioIsolado(win: JanelaDeAudio | undefined, esperar = esperarDeVerdade): Promise<ResultadoDiferencial> {
  const base = { letra: "A" as const, mecanismo: "Web Audio isolado: AudioContext próprio → Oscillator → Gain → destination" };
  const Ctor = win?.AudioContext ?? win?.webkitAudioContext;
  if (!Ctor) return Promise.resolve({ ...base, aceitou: false, tecnico: {}, erro: "sem AudioContext" });
  let ctx: AudioContext;
  try { ctx = new Ctor(); } catch (e) { return Promise.resolve({ ...base, aceitou: false, tecnico: {}, erro: nomeDoErro(e) }); }
  const tecnico: Record<string, Valor> = { estadoAoNascer: ctx.state, taxa: ctx.sampleRate };
  let erro: string | null = null;
  let aceitou = false;
  const retomar = typeof ctx.resume === "function" ? ctx.resume().then(() => "ok", (e) => nomeDoErro(e)) : Promise.resolve("sem resume");
  try {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const t0 = ctx.currentTime + 0.05;
    osc.frequency.value = 523.25;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.2, t0 + 0.02);
    g.gain.setValueAtTime(0.2, t0 + 0.56);
    g.gain.linearRampToValueAtTime(0, t0 + 0.6);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.62);
    aceitou = true;
  } catch (e) { erro = nomeDoErro(e); }
  return (async () => {
    const r = await comPrazo(retomar, 1500, esperar);
    tecnico.resume = r === "prazo" ? "sem resposta em 1,5 s" : r;
    tecnico.estadoDepoisDoResume = ctx.state;
    const c0 = ctx.currentTime;
    await esperar(300);
    tecnico.relogioAndou300ms = Number((ctx.currentTime - c0).toFixed(3));
    tecnico.latBase = Number.isFinite(ctx.baseLatency) ? Number(ctx.baseLatency.toFixed(4)) : null;
    const out = (ctx as AudioContext & { outputLatency?: number }).outputLatency;
    tecnico.latSaida = typeof out === "number" && Number.isFinite(out) ? Number(out.toFixed(4)) : null;
    try {
      const ts = ctx.getOutputTimestamp?.();
      tecnico.saidaCtx = ts && typeof ts.contextTime === "number" ? Number(ts.contextTime.toFixed(3)) : null;
    } catch { tecnico.saidaCtx = null; }
    await esperar(500);
    const fechou = await comPrazo(ctx.close().then(() => "ok", (e) => nomeDoErro(e)), 1000, esperar);
    tecnico.fechou = fechou === "prazo" ? "sem resposta" : fechou;
    return { ...base, aceitou, tecnico, erro };
  })();
}

/** A′: o mesmo tipo de tom, direto no destino do contexto DO JOGO (sem barramentos; sem retomar, sem trocar). */
export async function testarTomDiretoNoMotor(sonda: SondaDoMotor | null): Promise<ResultadoDiferencial> {
  const base = { letra: "A′" as const, mecanismo: "Web Audio no contexto do jogo: Oscillator → Gain → destination (sem barramentos)" };
  if (!sonda) return { ...base, aceitou: false, tecnico: {}, erro: "sem motor" };
  const r: ResultadoDoTeste = await sonda.tomDireto();
  return {
    ...base,
    aceitou: r.tocou,
    tecnico: {
      contexto: r.antes.contexto ?? null, geracao: r.antes.geracao ?? null,
      relogioAntes: r.antes.relogio ?? null, relogioDurante: r.durante?.relogio ?? null,
    },
    erro: r.motivo,
  };
}

// ───────────────────────── B — <audio> HTML5 ─────────────────────────

/** Um WAV PCM 16 bits mono, tom puro com rampa nas pontas (gerado aqui: original, sem arquivo). */
export function gerarWav(freq = 587.33, segundos = 0.6, taxa = 22050, amplitude = 0.25): Uint8Array {
  const n = Math.round(segundos * taxa);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const txt = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  txt(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); txt(8, "WAVE");
  txt(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, taxa, true); v.setUint32(28, taxa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  txt(36, "data"); v.setUint32(40, n * 2, true);
  const rampa = Math.round(0.02 * taxa);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / rampa, (n - 1 - i) / rampa);
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / taxa) * amplitude * env * 32767), true);
  }
  return new Uint8Array(buf);
}

export interface AmbienteHtml5 {
  criarAudio(src: string): HTMLAudioElement;
  criarUrl(b: Blob): string;
  soltarUrl(u: string): void;
}

/** B: `<audio>` com o WAV num blob local; sem MediaElementSource, sem tocar no AudioContext. */
export function testarHtml5(amb: AmbienteHtml5 | null, esperar = esperarDeVerdade): Promise<ResultadoDiferencial> {
  const base = { letra: "B" as const, mecanismo: "HTMLAudioElement com WAV local (blob), fora do Web Audio" };
  if (!amb) return Promise.resolve({ ...base, aceitou: false, tecnico: {}, erro: "sem <audio>" });
  let url = "";
  let el: HTMLAudioElement;
  const eventos: string[] = [];
  try {
    url = amb.criarUrl(new Blob([gerarWav() as BlobPart], { type: "audio/wav" }));
    el = amb.criarAudio(url);
  } catch (e) {
    if (url) amb.soltarUrl(url);
    return Promise.resolve({ ...base, aceitou: false, tecnico: {}, erro: nomeDoErro(e) });
  }
  for (const nome of ["playing", "ended", "error", "pause", "stalled"]) el.addEventListener(nome, () => { if (eventos.length < 12) eventos.push(nome); });
  el.volume = 1;
  let tocar: Promise<string>;
  try {
    const p = el.play();
    tocar = p && typeof p.then === "function" ? p.then(() => "ok", (e) => nomeDoErro(e)) : Promise.resolve("ok (sem promessa)");
  } catch (e) {
    tocar = Promise.resolve(nomeDoErro(e));
  }
  return (async () => {
    const r = await comPrazo(tocar, 1500, esperar);
    const play = r === "prazo" ? "sem resposta em 1,5 s" : r;
    await esperar(300);
    const tecnico: Record<string, Valor> = {
      play, tempo300ms: Number((el.currentTime || 0).toFixed(3)), pausado: el.paused, mudo: el.muted, volume: el.volume,
      prontidao: el.readyState, rede: el.networkState, erroDoElemento: el.error ? el.error.code : null,
    };
    await esperar(700);
    tecnico.terminou = el.ended;
    tecnico.eventos = eventos.join(",");
    try { el.pause(); el.removeAttribute("src"); el.load(); } catch { /* melhor esforço */ }
    amb.soltarUrl(url);
    return { ...base, aceitou: play.startsWith("ok"), tecnico, erro: play.startsWith("ok") ? null : play };
  })();
}

// ───────────────────────── C — Android nativo ─────────────────────────

/** C: AudioTrack nativo (USAGE_MEDIA, como a WebView), 660 Hz, 0,6 s, sem pedir foco — fora da WebView. */
export async function testarNativo(plugin: PluginDeAudioNativo | null, esperar = esperarDeVerdade): Promise<ResultadoDiferencial> {
  const base = { letra: "C" as const, mecanismo: "Android nativo: AudioTrack (USAGE_MEDIA), sem WebView" };
  if (!plugin) return { ...base, aceitou: false, tecnico: {}, erro: "indisponível (não é o APK debug no Android)" };
  try {
    const r = await comPrazo(plugin.tocarTom({ freq: 660, ms: 600 }), 4000, esperar);
    if (r === "prazo") return { ...base, aceitou: false, tecnico: {}, erro: "o nativo não respondeu em 4 s" };
    const tecnico = achatar(r);
    const erro = typeof r.erro === "string" ? r.erro : null;
    return { ...base, aceitou: r.tocou === true, tecnico, erro };
  } catch (e) {
    return { ...base, aceitou: false, tecnico: {}, erro: nomeDoErro(e) };
  }
}

// ───────────────────────── a matriz de decisão ─────────────────────────

export type Ouviu = boolean | null;
export interface RespostasDaMatriz { A: Ouviu; B: Ouviu; C: Ouviu; D: Ouviu; "A′": Ouviu }

/**
 * A matriz da rodada 6, na ordem do pedido. Só lê respostas "ouvi / não ouvi" — nunca o analisador.
 * D = o motor do KING: "não ouviu" só se nenhum teste do motor foi ouvido.
 */
export function matrizDeDecisao(r: RespostasDaMatriz): { ramo: string; investigar: string } {
  const faltam = (["A", "B", "C", "D"] as const).filter((k) => r[k] === null);
  const { A, B, C, D } = r;
  if (A === false && B === false && C === false) {
    return { ramo: "A, B e C falham", investigar: "volume de mídia, rota física (alto-falante/fone/Bluetooth), foco do sistema e configuração do aparelho — sem culpar o hardware automaticamente" };
  }
  if (C === true && A === false && B === false) {
    return { ramo: "C funciona; A e B falham", investigar: "WebView/Chromium: a saída de áudio da WebView (serviço de áudio do Chromium), foco e rota de reprodução da WebView" };
  }
  if (B === true && A === false) {
    return { ramo: "B funciona; A falha", investigar: "Web Audio especificamente (o caminho do AudioContext na WebView)" };
  }
  if (A === true && D === false) {
    const extra = r["A′"] === false ? " — e o tom direto no contexto do jogo (A′) também falhou: a saída DESTE contexto, não o grafo"
      : r["A′"] === true ? " — o tom direto no contexto do jogo (A′) tocou: o defeito está no grafo/agendador" : "";
    return { ramo: "A funciona; o KING não", investigar: `grafo e agendador do KING${extra}` };
  }
  if (A === true && B === true && C === true && D === true) {
    return { ramo: "todos funcionam", investigar: "a falha não estava presente no teste: reproduzir a falha no tempo e comparar o estado antes e depois" };
  }
  if (faltam.length) return { ramo: "incompleta", investigar: `faltam respostas: ${faltam.join(", ")}` };
  return { ramo: "combinação fora da matriz", investigar: `A=${A} B=${B} C=${C} D=${D}: descrever ao time antes de concluir` };
}
