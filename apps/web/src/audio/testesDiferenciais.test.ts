// RODADA 6 — testes diferenciais (A Web Audio isolado · A′ direto no motor · B <audio> · C nativo · D motor)
// e a matriz de decisão. O que este arquivo trava:
//  - cada mecanismo é INDEPENDENTE do motor (A não usa a sonda; B não passa pelo Web Audio; C não passa
//    pela WebView) e começa SÍNCRONO, dentro do toque;
//  - erro/recusa de cada um vira resultado legível, nunca exceção; prazos para ponte que não responde;
//  - a matriz segue o pedido ramo a ramo e só lê "ouvi / não ouvi" (nunca o analisador);
//  - nada de rede, microfone ou identificador do aparelho (JS e Java).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { criarDiagnostico, type Retrato } from "./diagnostico.js";
import type { ResultadoDoTeste, SondaDoMotor, TrocaRegistrada } from "./engine.js";
import {
  achatar, gerarWav, lerSistema, matrizDeDecisao, testarHtml5, testarNativo, testarTomDiretoNoMotor, testarWebAudioIsolado,
  type AmbienteHtml5, type PluginDeAudioNativo, type ResultadoDiferencial,
} from "./testesDiferenciais.js";
import { ambienteDoAparelho, criarSessaoDeDiagnostico, respostasDaMatriz, type ExecutoresDiferenciais } from "./relatorioDeAudio.js";

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// ───────── fakes ─────────

function contextoFalso(o: { resume?: () => Promise<void> } = {}) {
  const log: string[] = [];
  let tempo = 0;
  class Ctx {
    state: AudioContextState = "suspended";
    sampleRate = 48000;
    baseLatency = 0.01;
    outputLatency = 0.05;
    destination = { nome: "destination" };
    constructor() { log.push("novo-contexto"); }
    get currentTime() { tempo += 0.1; return tempo; }
    resume() { log.push("resume"); this.state = "running"; return o.resume ? o.resume() : Promise.resolve(); }
    close() { log.push("close"); this.state = "closed"; return Promise.resolve(); }
    getOutputTimestamp() { return { contextTime: 1.2, performanceTime: 0 }; }
    createOscillator() {
      return {
        frequency: { value: 0 },
        connect: (n: { nome?: string }) => log.push(`osc→${n.nome ?? "?"}`),
        start: () => log.push("start"),
        stop: () => log.push("stop"),
      };
    }
    createGain() {
      const p = { setValueAtTime: () => p, linearRampToValueAtTime: () => p, value: 1 };
      return { nome: "gain", gain: p, connect: (n: { nome?: string }) => log.push(`gain→${n.nome ?? "?"}`) };
    }
  }
  return { log, Ctor: Ctx as unknown as new () => AudioContext };
}

function audioFalso(play: () => Promise<void>) {
  const log: string[] = [];
  const ouvintes: Record<string, () => void> = {};
  const el = {
    volume: 0.5, muted: false, paused: true, ended: false, currentTime: 0, readyState: 4, networkState: 1, error: null,
    addEventListener: (n: string, f: () => void) => { ouvintes[n] = f; },
    play: () => { log.push("play"); el.paused = false; el.currentTime = 0.28; ouvintes.playing?.(); return play(); },
    pause: () => log.push("pause"), removeAttribute: () => {}, load: () => {},
  };
  const amb: AmbienteHtml5 = {
    criarAudio: (src) => { log.push(`audio:${src}`); return el as unknown as HTMLAudioElement; },
    criarUrl: () => { log.push("criarUrl"); return "blob:local/1"; },
    soltarUrl: (u) => log.push(`soltar:${u}`),
  };
  return { log, amb, el };
}

const R: Retrato = { fase: "ativo", contexto: "running", relogio: 5, geracao: 2, rms: 0.02 };
function sonda(): SondaDoMotor & { chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    chamadas,
    retrato: () => ({ ...R }),
    antesDoToque: () => [],
    trocas: (): TrocaRegistrada[] => [],
    async tocarTeste(qual): Promise<ResultadoDoTeste> { chamadas.push(`tocarTeste:${qual}`); return { qual, tocou: true, motivo: null, antes: { ...R }, durante: { ...R, rms: 0.03 } }; },
    async tomDireto(): Promise<ResultadoDoTeste> { chamadas.push("tomDireto"); return { qual: "direto", tocou: true, motivo: null, antes: { ...R }, durante: { ...R, relogio: 5.3 } }; },
    recuperar() { chamadas.push("recuperar"); },
  };
}

// ───────── A ─────────

describe("A — Web Audio isolado: contexto próprio, Oscillator → Gain → destination", () => {
  it("nasce e agenda o tom SÍNCRONO (dentro do toque), fecha o próprio contexto e mede o relógio", async () => {
    const f = contextoFalso();
    const p = testarWebAudioIsolado({ AudioContext: f.Ctor });
    expect(f.log, "o tom precisa estar agendado antes do 1º await").toEqual(["novo-contexto", "resume", "osc→gain", "gain→destination", "start", "stop"]);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r).toMatchObject({ letra: "A", aceitou: true, erro: null });
    expect(r.tecnico).toMatchObject({ estadoAoNascer: "suspended", resume: "ok", estadoDepoisDoResume: "running", latSaida: 0.05, saidaCtx: 1.2, fechou: "ok" });
    expect(Number(r.tecnico.relogioAndou300ms)).toBeGreaterThan(0);
    expect(f.log).toContain("close");
  });

  it("resume recusado ou mudo: vira técnico legível, não exceção; sem AudioContext: erro", async () => {
    const f = contextoFalso({ resume: () => Promise.reject(Object.assign(new Error("nope"), { name: "NotAllowedError" })) });
    const p = testarWebAudioIsolado({ AudioContext: f.Ctor });
    await vi.runAllTimersAsync();
    expect((await p).tecnico.resume).toMatch(/NotAllowedError/);
    const g = contextoFalso({ resume: () => new Promise(() => {}) });
    const q = testarWebAudioIsolado({ AudioContext: g.Ctor });
    await vi.runAllTimersAsync();
    expect((await q).tecnico.resume).toBe("sem resposta em 1,5 s");
    expect(await testarWebAudioIsolado({})).toMatchObject({ aceitou: false, erro: "sem AudioContext" });
  });

  it("A′ usa o contexto DO JOGO só para um tom direto: nada de recuperar", async () => {
    const s = sonda();
    const r = await testarTomDiretoNoMotor(s);
    expect(s.chamadas).toEqual(["tomDireto"]);
    expect(r).toMatchObject({ letra: "A′", aceitou: true, tecnico: { contexto: "running", relogioAntes: 5, relogioDurante: 5.3 } });
    expect(await testarTomDiretoNoMotor(null)).toMatchObject({ aceitou: false, erro: "sem motor" });
  });
});

// ───────── B ─────────

describe("B — <audio> HTML5 com WAV gerado aqui, fora do Web Audio", () => {
  it("WAV válido: RIFF/WAVE, PCM 16 bits mono, rampa nas pontas, amplitude moderada", () => {
    const w = gerarWav(587.33, 0.6, 22050, 0.25);
    const txt = (a: number, b: number) => String.fromCharCode(...w.slice(a, b));
    expect([txt(0, 4), txt(8, 12), txt(12, 16), txt(36, 40)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    const v = new DataView(w.buffer);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(Math.round(0.6 * 22050) * 2);
    expect(v.getInt16(44, true)).toBe(0);
    let pico = 0;
    for (let i = 44; i < w.length; i += 2) pico = Math.max(pico, Math.abs(v.getInt16(i, true)));
    expect(pico).toBeLessThanOrEqual(Math.ceil(0.25 * 32767));
    expect(pico).toBeGreaterThan(0.2 * 32767);
  });

  it("toca pelo elemento, solta o blob no fim; recusa (NotAllowedError) vira erro legível", async () => {
    const ok = audioFalso(() => Promise.resolve());
    const p = testarHtml5(ok.amb);
    expect(ok.log.slice(0, 3)).toEqual(["criarUrl", "audio:blob:local/1", "play"]);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r).toMatchObject({ letra: "B", aceitou: true, erro: null, tecnico: { play: "ok", volume: 1, mudo: false, tempo300ms: 0.28 } });
    expect(ok.log).toContain("soltar:blob:local/1");
    const nao = audioFalso(() => Promise.reject(Object.assign(new Error("gesto"), { name: "NotAllowedError" })));
    const q = testarHtml5(nao.amb);
    await vi.runAllTimersAsync();
    expect(await q).toMatchObject({ aceitou: false, erro: expect.stringMatching(/NotAllowedError/) });
    expect(nao.log).toContain("soltar:blob:local/1");
    expect(await testarHtml5(null)).toMatchObject({ aceitou: false, erro: "sem <audio>" });
  });

  it("B nunca toca no Web Audio (sem MediaElementSource, sem AudioContext)", () => {
    const fonte = readFileSync(fileURLToPath(new URL("./testesDiferenciais.ts", import.meta.url)), "utf8");
    const corpoB = fonte.slice(fonte.indexOf("export function testarHtml5"), fonte.indexOf("// ───────────────────────── C"));
    expect(corpoB).not.toMatch(/createMediaElementSource|AudioContext/);
  });
});

// ───────── C e o áudio do sistema ─────────

describe("C — Android nativo (AudioTrack) e leitura do AudioManager", () => {
  const plugin = (o: Partial<PluginDeAudioNativo> = {}): PluginDeAudioNativo => ({
    estado: async () => ({ volumeMidia: 0, volumeMidiaMax: 15, midiaMuda: false, saidas: "alto-falante", eventos: [{ ms: 10, e: "tela-desligou" }] }),
    tocarTom: async () => ({ tocou: true, rotaDaTrilha: "alto-falante", cabecaFim: 28800, antes: { volumeMidia: 0, musicaAtiva: false }, durante: { musicaAtiva: true } }),
    ...o,
  });

  it("fora do APK debug no Android: indisponível (não é erro do aparelho)", async () => {
    expect(await testarNativo(null)).toMatchObject({ letra: "C", aceitou: false, erro: expect.stringMatching(/indisponível/) });
    expect(await lerSistema(null)).toBeNull();
  });

  it("resultado nativo achatado em campos legíveis (antes/durante)", async () => {
    const r = await testarNativo(plugin());
    expect(r).toMatchObject({ aceitou: true, erro: null });
    expect(r.tecnico).toMatchObject({ rotaDaTrilha: "alto-falante", cabecaFim: 28800, "antes.volumeMidia": 0, "durante.musicaAtiva": true });
  });

  it("nativo que recusa ou não responde: erro legível, com prazo", async () => {
    expect(await testarNativo(plugin({ tocarTom: () => Promise.reject(new Error("UNIMPLEMENTED")) }))).toMatchObject({ aceitou: false, erro: expect.stringMatching(/UNIMPLEMENTED/) });
    const p = testarNativo(plugin({ tocarTom: () => new Promise(() => {}) }));
    await vi.advanceTimersByTimeAsync(4000);
    expect(await p).toMatchObject({ aceitou: false, erro: "o nativo não respondeu em 4 s" });
    const q = lerSistema(plugin({ estado: () => new Promise(() => {}) }));
    await vi.advanceTimersByTimeAsync(1500);
    expect((await q)?.campos.erro).toMatch(/não respondeu/);
  });

  it("áudio do sistema: campos e eventos, sem objeto solto", async () => {
    const s = await lerSistema(plugin());
    expect(s?.campos).toMatchObject({ volumeMidia: 0, volumeMidiaMax: 15, saidas: "alto-falante" });
    expect(s?.eventos).toEqual([{ ms: 10, e: "tela-desligou" }]);
    expect(achatar({ a: { b: [1, "x", { c: 1 }] }, d: undefined })).toEqual({ "a.b": "1,x" });
  });

  it("o plugin Java: sem microfone, sem identificador do aparelho, sem rede, sem pedir foco", () => {
    const java = readFileSync(fileURLToPath(new URL("../../recursos-nativos/android-debug/java/br/com/playkingcards/king/DiagAudioNativoPlugin.java", import.meta.url)), "utf8");
    expect(java).not.toMatch(/RECORD_AUDIO|AudioRecord|MediaRecorder/);
    expect(java).not.toMatch(/getProductName|getAddress|ANDROID_ID|Settings\.Secure|Build\.(MODEL|SERIAL|DEVICE|BRAND|MANUFACTURER)|getSerial|getImei/);
    expect(java).not.toMatch(/java\.net|HttpURLConnection|OkHttp|Socket/);
    expect(java).not.toMatch(/requestAudioFocus|abandonAudioFocus/);
    expect(java).toMatch(/USAGE_MEDIA/);
  });
});

// ───────── matriz ─────────

describe("matriz de decisão (o pedido, ramo a ramo)", () => {
  const m = (A: boolean | null, B: boolean | null, C: boolean | null, D: boolean | null, Al: boolean | null = null) => matrizDeDecisao({ A, B, C, D, "A′": Al });
  it("cada ramo", () => {
    expect(m(false, false, false, false).ramo).toBe("A, B e C falham");
    expect(m(false, false, false, false).investigar).toMatch(/sem culpar o hardware/);
    expect(m(false, false, true, false).ramo).toBe("C funciona; A e B falham");
    expect(m(false, true, true, false).ramo).toBe("B funciona; A falha");
    expect(m(true, true, true, false).ramo).toBe("A funciona; o KING não");
    expect(m(true, true, true, false, false).investigar).toMatch(/saída DESTE contexto/);
    expect(m(true, true, true, false, true).investigar).toMatch(/grafo\/agendador/);
    expect(m(true, true, true, true).ramo).toBe("todos funcionam");
    expect(m(false, null, true, null).ramo).toBe("incompleta");
  });
});

// ───────── a sessão com os diferenciais ─────────

function executores(respostas: Partial<Record<string, ResultadoDiferencial>> = {}) {
  const log: string[] = [];
  const e: ExecutoresDiferenciais = {
    executar(letra) {
      log.push(`executar:${letra}`);
      return Promise.resolve(respostas[letra] ?? { letra, mecanismo: `mec-${letra}`, aceitou: true, tecnico: { x: 1 }, erro: null });
    },
    sistema: async () => { log.push("sistema"); return { campos: { volumeMidia: 0, volumeMidiaMax: 15, midiaMuda: false, musicaAtiva: false }, eventos: [{ e: "tela-desligou", ms: 5 }] }; },
  };
  return { e, log };
}

describe("sessão: os quatro testes na MESMA falha, antes de qualquer reconstrução", () => {
  it("registrar lê o sistema (só leitura); A/A′/B/C/D sem recuperar; a matriz sai no relatório", async () => {
    const s = sonda();
    const ex = executores();
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s, diferenciais: ex.e });
    const o = sess.registrarFalha();
    await vi.runAllTimersAsync();
    expect(o.sistemaNaFalha?.campos.volumeMidia).toBe(0);
    for (const [letra, ouviu] of [["A", false], ["A′", false], ["B", false], ["C", true]] as const) {
      const p = sess.testarDiferencial(letra);
      expect(ex.log[ex.log.length - 1], "o mecanismo começa ANTES da leitura do sistema").toBe(`executar:${letra}`);
      await vi.runAllTimersAsync();
      sess.responder(await p, ouviu);
    }
    const pd = sess.testar("musica");
    await vi.runAllTimersAsync();
    sess.responder(await pd, false);
    expect(s.chamadas).not.toContain("recuperar");
    expect(o.diferenciais.map((d) => d.momento)).toEqual(Array(4).fill("antes-da-recuperacao"));
    expect(o.diferenciais.every((d) => d.sistemaDurante?.campos.volumeMidia === 0)).toBe(true);
    expect(respostasDaMatriz(o, "antes-da-recuperacao")).toEqual({ A: false, "A′": false, B: false, C: true, D: false });
    await sess.lerSistema();
    const txt = sess.relatorio(ambienteDoAparelho({}));
    expect(txt).toMatch(/E\. TESTES DIFERENCIAIS/);
    expect(txt).toMatch(/#\d+ C mec-C \(antes-da-recuperacao.*OUVIU: SIM/);
    expect(txt).toMatch(/MATRIZ \(antes-da-recuperacao\): A=NÃO A′=NÃO B=NÃO C=ouviu D\(KING\)=NÃO → C funciona; A e B falham/);
    expect(txt).toMatch(/F\. ÁUDIO DO SISTEMA ANDROID NO REGISTRO[\s\S]*volumeMidia=0/);
    expect(txt).toMatch(/== ÁUDIO DO SISTEMA ANDROID[\s\S]*tela-desligou/);
    expect(txt).toMatch(/o analisador escuta o\nMASTER/);
  });

  it("depois de Tentar recuperar, os testes ficam marcados como depois; memória limitada a 12", async () => {
    const s = sonda();
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s, diferenciais: executores().e, esperar: () => Promise.resolve() });
    sess.registrarFalha();
    await sess.recuperar();
    const p = sess.testarDiferencial("A");
    await vi.runAllTimersAsync();
    expect((await p).momento).toBe("depois-da-recuperacao");
    for (let i = 0; i < 20; i++) { const q = sess.testarDiferencial("B"); await vi.runAllTimersAsync(); await q; }
    expect(sess.ocorrencias()[0].diferenciais.length).toBe(12);
  });

  it("executor que explode e sem executores: resultado com erro, nada quebra", async () => {
    const s = sonda();
    const ruim: ExecutoresDiferenciais = { executar: () => Promise.reject(new Error("boom")), sistema: () => Promise.reject(new Error("x")) };
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s, diferenciais: ruim });
    const p = sess.testarDiferencial("C");
    await vi.runAllTimersAsync();
    expect((await p).resultado).toMatchObject({ aceitou: false, erro: expect.stringMatching(/boom/) });
    const sem = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s });
    const q = sem.testarDiferencial("A");
    await vi.runAllTimersAsync();
    expect((await q).resultado.erro).toMatch(/indisponíveis/);
    expect(sem.relatorio(ambienteDoAparelho({}))).toMatch(/sem leitura — fora do APK debug/);
  });

  it("sem rede: o módulo dos diferenciais não tem nenhuma chamada de rede", () => {
    const fonte = readFileSync(fileURLToPath(new URL("./testesDiferenciais.ts", import.meta.url)), "utf8");
    expect(fonte).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|navigator\.share/);
  });
});

describe("teste que não pôde rodar (indisponível) não entra na matriz nem pede 'ouviu?'", () => {
  it("C indisponível (navegador, release): fica fora da matriz mesmo com resposta", async () => {
    const s = sonda();
    const ex: ExecutoresDiferenciais = {
      executar: (letra) => Promise.resolve(letra === "C"
        ? { letra, mecanismo: "nativo", aceitou: false, tecnico: {}, erro: "indisponível (não é o APK debug no Android)" }
        : { letra, mecanismo: "x", aceitou: true, tecnico: {}, erro: null }),
      sistema: async () => null,
    };
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s, diferenciais: ex });
    sess.registrarFalha();
    const p = sess.testarDiferencial("C");
    await vi.runAllTimersAsync();
    const t = await p;
    expect(t.indisponivel).toBe(true);
    sess.responder(t, true);
    expect(respostasDaMatriz(sess.ocorrencias()[0], "antes-da-recuperacao").C).toBeNull();
  });
});
