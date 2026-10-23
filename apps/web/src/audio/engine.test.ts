// O ÁUDIO DEPOIS DE IR AO WHATSAPP E VOLTAR (hotfix de 22/10/2026, defeito visto em aparelho real).
//
// AudioContext, documento, janela e intervalos são de mentira e controlados: o que se prova aqui é a
// LÓGICA do ciclo de vida — quem para, quem retoma, quantos agendadores existem, o que nunca muda.
// Não substitui o teste físico no iPhone, onde o defeito apareceu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./engine.js";

class Alvo {
  ouvintes = new Map<string, Set<(e: unknown) => void>>();
  addEventListener(t: string, f: (e: unknown) => void) { (this.ouvintes.get(t) ?? this.ouvintes.set(t, new Set()).get(t)!).add(f); }
  removeEventListener(t: string, f: (e: unknown) => void) { this.ouvintes.get(t)?.delete(f); }
  disparar(t: string, e: Record<string, unknown> = {}) { for (const f of [...(this.ouvintes.get(t) ?? [])]) f({ type: t, ...e }); }
  quantos(t: string) { return this.ouvintes.get(t)?.size ?? 0; }
}

const param = () => ({ value: 0, setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
const no = () => ({
  gain: param(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
  frequency: param(), Q: param(), detune: param(), buffer: null as unknown, type: "",
  connect() {}, disconnect() {}, start() {}, stop() {},
});

class ContextoFalso {
  static criados = 0;
  static ultimo: ContextoFalso | null = null;
  state = "running";
  sampleRate = 800;
  currentTime = 0;
  destination = {};
  resumes = 0;
  suspends = 0;
  recusar = false;
  /** Sem permissão, o resume pode ficar pendente para sempre (a especificação permite). */
  pendurar = false;
  constructor() { ContextoFalso.criados++; ContextoFalso.ultimo = this; }
  resume() {
    this.resumes++;
    if (this.pendurar) return new Promise<void>(() => {});
    if (this.recusar) return Promise.reject(new Error("NotAllowedError"));
    this.state = "running";
    return Promise.resolve();
  }
  suspend() { this.suspends++; this.state = "suspended"; return Promise.resolve(); }
  createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(Math.max(0, len | 0)) }; }
  createGain() { return no(); }
  createDynamicsCompressor() { return no(); }
  createConvolver() { return no(); }
  createBiquadFilter() { return no(); }
  createOscillator() { return no(); }
  createBufferSource() { return no(); }
}

let doc: Alvo & { visibilityState: string };
let win: Alvo & Record<string, unknown>;
let agendadores: Set<number>;
let gravados: string[];
const esvaziar = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
/** Ouvintes do gesto de reserva — os eventos que de fato liberam áudio. */
const gestosArmados = () => win.quantos("touchend") + win.quantos("click") + win.quantos("keydown");

function ambiente(o: { ios?: boolean; ativacao?: { isActive: boolean } } = {}) {
  ContextoFalso.criados = 0;
  ContextoFalso.ultimo = null;
  agendadores = new Set();
  gravados = [];
  let seq = 0;
  doc = Object.assign(new Alvo(), { visibilityState: "visible" });
  win = Object.assign(new Alvo(), {
    AudioContext: ContextoFalso,
    setInterval: () => { const id = ++seq; agendadores.add(id); return id; },
  });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("clearInterval", (id: number) => { agendadores.delete(id); });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: (k: string) => { gravados.push(k); }, removeItem() {} });
  vi.stubGlobal("navigator", {
    ...(o.ios
      ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15", platform: "iPhone", maxTouchPoints: 5 }
      : { userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 }),
    userActivation: o.ativacao,
  });
}

/** Um motor com as preferências pedidas, já desbloqueado por um "gesto". O 1º compasso vai até 2,12 s. */
function motor(prefs: { music: boolean; sfx: boolean }, desbloquear = true) {
  const m = new AudioEngine();
  m.set(prefs);
  if (desbloquear) m.unlock();
  gravados.length = 0;
  return m;
}
const ctx = () => ContextoFalso.ultimo!;
const esconder = () => { doc.visibilityState = "hidden"; doc.disparar("visibilitychange"); };
/** Volta depois de um tempo: o compasso que estava tocando já terminou. */
const mostrar = async (m: AudioEngine) => {
  if (ContextoFalso.ultimo) ContextoFalso.ultimo.currentTime += 5;
  doc.visibilityState = "visible";
  doc.disparar("visibilitychange");
  await m.aoVoltarParaPrimeiroPlano();
  await esvaziar();
};
/** Volta com o relógio do contexto CONGELADO no meio do compasso (o navegador suspendeu ali). */
const voltarCongelado = async (m: AudioEngine) => {
  doc.visibilityState = "visible";
  doc.disparar("visibilitychange");
  await m.aoVoltarParaPrimeiroPlano();
  await esvaziar();
};

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); ambiente(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("nunca cria áudio sem gesto", () => {
  it("1. página nunca desbloqueada: voltar não cria AudioContext nem instala ouvinte", async () => {
    const m = motor({ music: true, sfx: true }, false);
    await m.aoVoltarParaPrimeiroPlano();
    doc.disparar("visibilitychange");
    win.disparar("pageshow", { persisted: true });
    expect(ContextoFalso.criados).toBe(0);
    expect(doc.quantos("visibilitychange")).toBe(0);
    expect(agendadores.size).toBe(0);
    expect(gestosArmados()).toBe(0);
  });
});

describe("escondido e de volta", () => {
  it("2. contexto 'suspended' é retomado e a música recomeça", async () => {
    const m = motor({ music: true, sfx: true });
    esconder();
    ctx().state = "suspended";
    await mostrar(m);
    expect(ctx().resumes).toBeGreaterThan(0);
    expect(ctx().state).toBe("running");
    expect(agendadores.size).toBe(1);
  });

  it("3. contexto 'interrupted' (Safari/iOS) também é retomado — o unlock antigo nem tentava", async () => {
    const m = motor({ music: true, sfx: true });
    esconder();
    ctx().state = "interrupted";
    await mostrar(m);
    expect(ctx().state).toBe("running");
    expect(agendadores.size).toBe(1);
    // e o próprio unlock passou a retomar "interrupted"
    ctx().state = "interrupted";
    m.unlock();
    await esvaziar();
    expect(ctx().state).toBe("running");
  });

  it("4 e 6. escondido PARA o agendador; visível com Música ligada, ele volta", async () => {
    const m = motor({ music: true, sfx: true });
    expect(agendadores.size).toBe(1);
    esconder();
    expect(agendadores.size, "o agendador continuou vivo em segundo plano").toBe(0);
    await mostrar(m);
    expect(agendadores.size).toBe(1);
  });

  it("5. Música desligada: a volta não liga agendador nenhum", async () => {
    const m = motor({ music: false, sfx: true });
    esconder();
    ctx().state = "suspended";
    await mostrar(m);
    expect(ctx().state).toBe("running");
    expect(agendadores.size).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(agendadores.size).toBe(0);
  });

  it("7 e 8. idas e voltas repetidas e rápidas: nunca dois agendadores", async () => {
    const m = motor({ music: true, sfx: true });
    for (let i = 0; i < 6; i++) {
      esconder();
      ctx().state = "suspended";
      doc.visibilityState = "visible";
      doc.disparar("visibilitychange");
      doc.disparar("visibilitychange");
      win.disparar("pageshow", { persisted: true });
      if (i % 2) esconder(); // escondeu de novo antes de o resume terminar
      await m.aoVoltarParaPrimeiroPlano();
      await esvaziar();
      vi.advanceTimersByTime(3000); // inclusive a música que esperava o compasso antigo acabar
      expect(agendadores.size, `volta ${i}`).toBeLessThanOrEqual(1);
    }
    await mostrar(m);
    vi.advanceTimersByTime(3000);
    expect(agendadores.size).toBe(1);
  });

  it("escondido no meio da retomada: a música NÃO recomeça escondida", async () => {
    const m = motor({ music: true, sfx: true });
    esconder();
    ctx().state = "suspended";
    doc.visibilityState = "visible";
    doc.disparar("visibilitychange");
    esconder();
    await m.aoVoltarParaPrimeiroPlano();
    await esvaziar();
    vi.advanceTimersByTime(5000);
    expect(agendadores.size).toBe(0);
  });
});

describe("o compasso que ficou pela metade (relógio congelado)", () => {
  it("a música espera o compasso antigo terminar — nunca dois acordes por cima — e só UM agendador nasce", async () => {
    const m = motor({ music: true, sfx: true }); // compasso agendado em t=0, termina em 2,12 s
    ctx().currentTime = 0.8; // escondeu no meio dele…
    esconder();
    ctx().state = "suspended"; // …e o navegador congelou o relógio ali
    await voltarCongelado(m);
    expect(ctx().state).toBe("running");
    expect(agendadores.size, "recomeçou por cima do compasso que ainda ia tocar").toBe(0);
    vi.advanceTimersByTime(1000);
    expect(agendadores.size).toBe(0);
    m.unlock(); // um gesto durante a espera não antecipa nem duplica
    m.set({ music: true });
    expect(agendadores.size).toBe(0);
    vi.advanceTimersByTime(400); // 1,32 s depois da volta: o compasso antigo acabou
    expect(agendadores.size).toBe(1);
    vi.advanceTimersByTime(10_000);
    expect(agendadores.size).toBe(1);
  });

  it("escondido, ou Música desligada, durante a espera: nada recomeça", async () => {
    const m = motor({ music: true, sfx: true });
    ctx().currentTime = 0.8;
    esconder();
    ctx().state = "suspended";
    await voltarCongelado(m);
    esconder(); // saiu de novo antes de o compasso acabar
    vi.advanceTimersByTime(5000);
    expect(agendadores.size).toBe(0);

    await voltarCongelado(m);
    m.set({ music: false }); // desligou a Música durante a espera
    vi.advanceTimersByTime(5000);
    expect(agendadores.size).toBe(0);
  });
});

describe("quando o navegador recusa retomar sem gesto", () => {
  it("9 e 10. resume recusado não quebra nada, e o PRÓXIMO gesto tenta de novo — um ouvinte só, removido no sucesso", async () => {
    const m = motor({ music: true, sfx: true });
    esconder();
    ctx().state = "suspended";
    ctx().recusar = true;
    await expect(mostrar(m)).resolves.toBeUndefined();
    expect(ctx().state).toBe("suspended");
    expect(agendadores.size).toBe(0);
    expect(win.quantos("click")).toBe(1);
    expect(win.quantos("touchend")).toBe(1);
    await mostrar(m); // outra volta não arma um segundo ouvinte
    expect(win.quantos("click")).toBe(1);

    ctx().recusar = false;
    win.disparar("click");
    await esvaziar();
    expect(ctx().state).toBe("running");
    expect(agendadores.size).toBe(1);
    expect(gestosArmados()).toBe(0);
  });

  it("resume que NUNCA responde: o gesto já fica armado antes de esperar, a espera tem prazo, e o gesto recupera", async () => {
    const m = motor({ music: true, sfx: true });
    esconder();
    ctx().state = "suspended";
    ctx().pendurar = true;
    ctx().currentTime += 5;
    doc.visibilityState = "visible";
    doc.disparar("visibilitychange");
    const volta = m.aoVoltarParaPrimeiroPlano();
    await esvaziar();
    expect(gestosArmados(), "o gesto só seria armado depois de um resume que nunca volta").toBe(3);
    vi.advanceTimersByTime(1500);
    await volta; // a espera terminou sozinha, sem travar as próximas voltas
    expect(ctx().state).toBe("suspended");
    expect(agendadores.size).toBe(0);

    ctx().pendurar = false;
    win.disparar("touchend");
    await esvaziar();
    expect(ctx().state).toBe("running");
    expect(agendadores.size).toBe(1);
    expect(gestosArmados()).toBe(0);
  });
});

describe("preferências", () => {
  for (const prefs of [{ music: true, sfx: true }, { music: false, sfx: true }, { music: true, sfx: false }, { music: false, sfx: false }]) {
    it(`11. Música ${prefs.music ? "ON" : "OFF"} / Efeitos ${prefs.sfx ? "ON" : "OFF"}: idênticas depois de esconder e voltar, e nada gravado`, async () => {
      const m = motor(prefs);
      const antes = JSON.stringify(m.get());
      esconder();
      ctx().state = "interrupted";
      await mostrar(m);
      vi.advanceTimersByTime(3000);
      expect(JSON.stringify(m.get())).toBe(antes);
      expect(gravados, "esconder/voltar gravou preferência").toEqual([]);
      expect(agendadores.size).toBe(prefs.music ? 1 : 0);
    });
  }
});

describe("iOS: o contexto que volta 'running' e mudo", () => {
  it("o primeiro gesto depois de voltar faz UM suspend→resume, dentro do gesto; depois, nunca mais", async () => {
    ambiente({ ios: true });
    const m = motor({ music: true, sfx: true });
    esconder();
    await mostrar(m); // o iOS mente "running"
    expect(ctx().suspends).toBe(0);
    expect(win.quantos("touchend")).toBe(1);
    win.disparar("touchend");
    await esvaziar();
    expect(ctx().suspends).toBe(1);
    expect(ctx().state).toBe("running");
    expect(gestosArmados()).toBe(0);
    win.disparar("touchend");
    await esvaziar();
    expect(ctx().suspends, "chute repetido fora da volta").toBe(1);
    expect(agendadores.size).toBe(1);
  });

  it("toque SEM ativação (fim de rolagem) não mexe no contexto; o próximo toque de verdade recupera", async () => {
    const ativacao = { isActive: false };
    ambiente({ ios: true, ativacao });
    const m = motor({ music: true, sfx: true });
    esconder();
    await mostrar(m);
    win.disparar("touchend");
    await esvaziar();
    expect(ctx().suspends, "suspend sem ativação pode deixar o contexto parado de vez").toBe(0);
    expect(ctx().resumes).toBe(0);
    expect(ctx().state).toBe("running");
    expect(win.quantos("touchend"), "o gesto de reserva desistiu cedo demais").toBe(1);

    ativacao.isActive = true;
    win.disparar("touchend");
    await esvaziar();
    expect(ctx().suspends).toBe(1);
    expect(ctx().state).toBe("running");
    expect(gestosArmados()).toBe(0);
  });

  it("no Android/Chrome não há chute: o resume comum basta e nenhum gesto fica armado", async () => {
    const m = motor({ music: true, sfx: true });
    esconder();
    await mostrar(m);
    expect(ctx().suspends).toBe(0);
    expect(gestosArmados()).toBe(0);
  });
});
