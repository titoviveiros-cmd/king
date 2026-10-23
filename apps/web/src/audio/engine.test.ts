// O ÁUDIO DEPOIS DE IR AO WHATSAPP E VOLTAR — hotfix V1 (22/10/2026) e V2 (23/10/2026).
//
// O aparelho derrubou a V1 na 2ª volta, e os testes dela passavam: o AudioContext falso era
// "honesto" — "running" sempre tinha relógio andando e o resume sempre respondia. Este falso imita
// o WebKit de verdade: o relógio só anda "running" e NÃO congelado (o zumbi que volta "running" e
// mudo), o resume pode recusar ou nunca responder, o close pode não responder, e um nó não liga em
// nó de outro contexto (como no navegador). Prova a LÓGICA; não substitui o teste físico no iPhone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine, audio } from "./engine.js";
import { sfxCardPlay, sfxTap, sfxYourTurn } from "./sounds.js";

class Alvo {
  ouvintes = new Map<string, Set<(e: unknown) => void>>();
  addEventListener(t: string, f: (e: unknown) => void) { (this.ouvintes.get(t) ?? this.ouvintes.set(t, new Set()).get(t)!).add(f); }
  removeEventListener(t: string, f: (e: unknown) => void) { this.ouvintes.get(t)?.delete(f); }
  disparar(t: string, e: Record<string, unknown> = {}) { for (const f of [...(this.ouvintes.get(t) ?? [])]) f({ type: t, ...e }); }
  quantos(t: string) { return this.ouvintes.get(t)?.size ?? 0; }
}

/** Parâmetro falso: guarda o valor inicial e o último alvo pedido. */
const param = () => ({
  value: 0,
  alvo: null as number | null,
  setTargetAtTime(v: number) { this.alvo = v; },
  setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
});

class NoFalso {
  gain = param(); threshold = param(); knee = param(); ratio = param(); attack = param(); release = param();
  frequency = param(); Q = param(); detune = param();
  buffer: unknown = null;
  type = "";
  loop = false;
  contexto: ContextoFalso;
  constructor(contexto: ContextoFalso) { this.contexto = contexto; }
  /** Como no navegador: ligar nós de contextos diferentes é erro. */
  connect(destino: { contexto: ContextoFalso }) {
    if (destino.contexto !== this.contexto) {
      throw new Error(`InvalidAccessError: nó do contexto #${this.contexto.id} ligado no #${destino.contexto.id}`);
    }
  }
  disconnect() {}
  start() {}
  stop() {}
}

class ContextoFalso {
  static todos: ContextoFalso[] = [];
  static estadoInicial = "running";
  /** O navegador não dá mais contexto (limite do aparelho). */
  static falharAoCriar = false;
  /** Autoplay: resume só funciona DENTRO de um gesto real. */
  static soComGesto = false;
  static dentroDoGesto = false;
  /** Contextos NOVOS (#2 em diante): o relógio só começa a andar N ms depois de nascer (sessão de áudio lenta). */
  static inicioLentoMs = 0;
  /** Contextos NOVOS nascem "suspended" e o resume nunca responde, nem com gesto (sessão ocupada). */
  static novosTravados = false;
  id = 0;
  sampleRate = 800;
  destination: { contexto: ContextoFalso };
  resumes = 0;
  closes = 0;
  osciladores = 0;
  fontes = 0;
  /** Sem gesto, o navegador recusa (NotAllowedError). */
  recusar = false;
  /** Sem gesto, o resume nunca responde (a especificação permite). */
  pendurar = false;
  /** O close também pode não responder (WebKit). */
  fecharPendurado = false;
  /** O resume nunca responde, nem com gesto. */
  pendurarSempre = false;
  onstatechange: (() => void) | null = null;
  private estado: string;
  private congelado = false;
  private base = 0;
  private marco = Date.now();
  private liberaEm = 0;
  constructor() {
    if (ContextoFalso.falharAoCriar) throw new Error("NotSupportedError: o aparelho não dá outro contexto");
    ContextoFalso.todos.push(this);
    this.id = ContextoFalso.todos.length;
    this.estado = ContextoFalso.estadoInicial;
    this.destination = { contexto: this };
    if (this.id > 1 && ContextoFalso.inicioLentoMs > 0) this.liberaEm = Date.now() + ContextoFalso.inicioLentoMs;
    if (this.id > 1 && ContextoFalso.novosTravados) { this.pendurarSempre = true; this.estado = "suspended"; }
  }
  /** O relógio só anda "running" e não congelado — o zumbi do WebKit diz "running" e não anda. */
  get currentTime() {
    if (this.estado !== "running" || this.congelado) return this.base;
    return this.base + Math.max(0, Date.now() - Math.max(this.marco, this.liberaEm)) / 1000;
  }
  get state() { return this.estado; }
  private marcar() { this.base = this.currentTime; this.marco = Date.now(); }
  /** O navegador muda o estado e avisa. */
  mudar(s: string) { this.marcar(); this.estado = s; this.onstatechange?.(); }
  /** Zumbi: continua "running", mas o relógio para. */
  congelar() { this.marcar(); this.congelado = true; }
  descongelar() { this.marcar(); this.congelado = false; }
  resume() {
    this.resumes++;
    if (this.pendurarSempre) return new Promise<void>(() => {});
    const semGesto = !ContextoFalso.dentroDoGesto;
    if (semGesto && this.pendurar) return new Promise<void>(() => {});
    if (semGesto && (this.recusar || ContextoFalso.soComGesto)) return Promise.reject(new Error("NotAllowedError"));
    if (this.estado !== "running" && this.estado !== "closed") this.mudar("running");
    return Promise.resolve();
  }
  suspend() { if (this.estado === "running") this.mudar("suspended"); return Promise.resolve(); }
  close() {
    this.closes++;
    if (this.fecharPendurado) return new Promise<void>(() => {});
    this.mudar("closed");
    return Promise.resolve();
  }
  createBuffer(_c: number, len: number) { return { getChannelData: () => new Float32Array(Math.max(0, len | 0)) }; }
  createGain() { return new NoFalso(this); }
  createDynamicsCompressor() { return new NoFalso(this); }
  createConvolver() { return new NoFalso(this); }
  createBiquadFilter() { return new NoFalso(this); }
  createOscillator() { this.osciladores++; return new NoFalso(this); }
  createBufferSource() { this.fontes++; return new NoFalso(this); }
}

let doc: Alvo & { visibilityState: string };
let win: Alvo & Record<string, unknown>;
/** Agendadores da música vivos: id → intervalo (2000 = bossa, 1500 = comemoração). */
let agendadores: Map<number, number>;
let gravados: string[];
const esvaziar = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
/** Ouvintes do gesto de reserva — os eventos que de fato liberam áudio. */
const gestosArmados = () => win.quantos("touchend") + win.quantos("click") + win.quantos("keydown");
/** O contexto que o motor usa (o último que nasceu). */
const atual = () => ContextoFalso.todos[ContextoFalso.todos.length - 1]!;

/** `tique`: o agendador da música roda de verdade (cada compasso no seu intervalo), em vez de só registrar. */
function ambiente(o: { ios?: boolean; ativacao?: { isActive: boolean }; tique?: boolean } = {}) {
  ContextoFalso.todos = [];
  ContextoFalso.estadoInicial = "running";
  ContextoFalso.falharAoCriar = false;
  ContextoFalso.soComGesto = false;
  ContextoFalso.dentroDoGesto = false;
  ContextoFalso.inicioLentoMs = 0;
  ContextoFalso.novosTravados = false;
  agendadores = new Map();
  gravados = [];
  let seq = 0;
  const vivos = new Map<number, ReturnType<typeof setTimeout>>();
  doc = Object.assign(new Alvo(), { visibilityState: "visible" });
  win = Object.assign(new Alvo(), {
    AudioContext: ContextoFalso,
    setInterval: (f: () => void, ms: number) => {
      const id = ++seq;
      agendadores.set(id, ms);
      if (o.tique) {
        const tique = () => { if (!agendadores.has(id)) return; f(); vivos.set(id, setTimeout(tique, ms)); };
        vivos.set(id, setTimeout(tique, ms));
      }
      return id;
    },
  });
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("clearInterval", (id: number) => {
    agendadores.delete(id);
    clearTimeout(vivos.get(id));
    vivos.delete(id);
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: (k: string) => { gravados.push(k); }, removeItem() {} });
  vi.stubGlobal("navigator", {
    ...(o.ios
      ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15", platform: "iPhone", maxTouchPoints: 5 }
      : { userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 }),
    userActivation: o.ativacao,
  });
}

type Prefs = { music: boolean; sfx: boolean };
/** Um motor com as preferências pedidas, já desbloqueado por um "gesto". O 1º compasso vai até 2,12 s. */
function motor(prefs: Prefs, desbloquear = true) {
  const m = new AudioEngine();
  m.set(prefs);
  if (desbloquear) m.unlock();
  gravados.length = 0;
  return m;
}
const esconder = () => { doc.visibilityState = "hidden"; doc.disparar("visibilitychange"); };
const mostrar = () => { doc.visibilityState = "visible"; doc.disparar("visibilitychange"); };
/** O tempo passa (assentar, retomar, medir o relógio, esperar o compasso). */
const passar = (ms = 5000) => vi.advanceTimersByTimeAsync(ms);
const voltar = async () => { mostrar(); await passar(); };
/** Um toque de verdade: o touchend e o click que o segue, os dois dentro do gesto. */
const tocar = async () => {
  ContextoFalso.dentroDoGesto = true;
  try { win.disparar("touchend"); win.disparar("click"); } finally { ContextoFalso.dentroDoGesto = false; }
  await passar();
};

/** O som está de pé AGORA: contexto do motor rodando com relógio andando, música e efeitos nele. */
async function funciona(m: AudioEngine, prefs: Prefs, rotulo = "") {
  const c = atual();
  expect(c.state, `${rotulo}: estado do contexto`).toBe("running");
  const t = c.currentTime;
  await passar(100);
  expect(c.currentTime, `${rotulo}: relógio parado — o jogo está mudo`).toBeGreaterThan(t);
  expect(agendadores.size, `${rotulo}: agendadores da música`).toBe(prefs.music ? 1 : 0);
  const antes = c.osciladores;
  m.tone({ freq: 440 });
  expect(c.osciladores - antes, `${rotulo}: efeito no contexto atual`).toBe(prefs.sfx ? 1 : 0);
}

/** Nada preso, nada sobrando: a máquina pronta para a próxima ida ao fundo. */
function pronto(m: AudioEngine, rotulo = "") {
  expect(m.invariantesVioladas(), `${rotulo}: invariantes`).toEqual([]);
  expect(m.estadoDoCiclo(), rotulo).toMatchObject({ fase: "ativo", gestoArmado: false, recuperando: false });
  expect(gestosArmados(), `${rotulo}: ouvintes de gesto`).toBe(0);
  const velhos = ContextoFalso.todos.slice(0, -1).filter((c) => c.closes === 0);
  expect(velhos.map((c) => c.id), `${rotulo}: contextos velhos sem close`).toEqual([]);
}

type Volta = "running" | "suspended" | "interrupted" | "zumbi" | "recusado" | "pendurado";
/** O que o navegador faz com o contexto enquanto o jogo está no fundo. */
function oNavegador(c: ContextoFalso, v: Volta) {
  if (v === "suspended" || v === "recusado" || v === "pendurado") c.mudar("suspended");
  if (v === "interrupted") c.mudar("interrupted");
  if (v === "zumbi") c.congelar();
  c.recusar = v === "recusado";
  c.pendurar = v === "pendurado";
}
/** Uma ida ao WhatsApp e volta; se a volta sozinha não bastou, o próximo toque resolve. */
async function ciclo(v: Volta) {
  esconder();
  oNavegador(atual(), v);
  await voltar();
  if (gestosArmados() > 0) await tocar();
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); ambiente(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("15. O DEFEITO DO APARELHO: a 1ª volta funciona, a 2ª fica muda", () => {
  for (const ios of [true, false]) {
    it(`${ios ? "iPhone" : "Android"}: ciclo 1 interrompido; ciclo 2 volta "running" com o relógio parado; ciclo 3 no contexto novo`, async () => {
      ambiente({ ios });
      const prefs = { music: true, sfx: true };
      const m = motor(prefs);
      await funciona(m, prefs, "início");

      // CICLO 1: o navegador interrompe o áudio no fundo; a volta recupera
      esconder();
      atual().mudar(ios ? "interrupted" : "suspended");
      await voltar();
      await tocar();
      await funciona(m, prefs, "ciclo 1");

      // CICLO 2: volta dizendo "running", mas o relógio não anda (o zumbi do WebKit)
      const zumbi = atual();
      esconder();
      zumbi.congelar();
      await voltar();
      await tocar();
      expect(atual(), "ciclo 2: o contexto zumbi continuou em uso — o jogo ficou mudo").not.toBe(zumbi);
      expect(zumbi.closes, "ciclo 2: o zumbi não foi fechado").toBe(1);
      await funciona(m, prefs, "ciclo 2");

      // CICLO 3: de novo, agora no contexto novo
      esconder();
      atual().mudar(ios ? "interrupted" : "suspended");
      await voltar();
      await tocar();
      await funciona(m, prefs, "ciclo 3");
    });
  }
});

describe("nunca cria áudio sem gesto", () => {
  it("1. página nunca desbloqueada: voltar não cria AudioContext nem instala ouvinte", async () => {
    const m = motor({ music: true, sfx: true }, false);
    await m.aoVoltarParaPrimeiroPlano();
    doc.disparar("visibilitychange");
    win.disparar("pageshow", { persisted: true });
    await passar();
    expect(ContextoFalso.todos.length).toBe(0);
    expect(doc.quantos("visibilitychange")).toBe(0);
    expect(agendadores.size).toBe(0);
    expect(gestosArmados()).toBe(0);
    expect(m.estadoDoCiclo().fase).toBe("ocioso");
  });

  it("a volta só RETOMA ou MEDE — contexto novo só nasce dentro de um gesto", async () => {
    const m = motor({ music: true, sfx: true });
    esconder();
    atual().congelar();
    await voltar();
    expect(ContextoFalso.todos.length, "a volta criou contexto sem gesto").toBe(1);
    expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
    await tocar();
    expect(ContextoFalso.todos.length).toBe(2);
  });
});

describe("16. estresse: 22 idas e voltas seguidas, variando o que o navegador faz", () => {
  const ROTEIRO: Volta[] = [
    "suspended", "interrupted", "running", "zumbi", "recusado", "pendurado", "running", "suspended",
    "zumbi", "zumbi", "interrupted", "recusado", "running", "pendurado", "suspended", "zumbi",
    "running", "interrupted", "recusado", "suspended", "pendurado", "running",
  ];
  for (const ios of [false, true]) {
    it(`${ios ? "iPhone" : "Android"}: ao fim de CADA ciclo o som funciona, 1 agendador, 0 gesto, nada preso, prefs intactas`, async () => {
      ambiente({ ios });
      const prefs = { music: true, sfx: true };
      const m = motor(prefs);
      const antes = JSON.stringify(m.get());
      for (const [i, v] of ROTEIRO.entries()) {
        await ciclo(v);
        const rotulo = `ciclo ${i + 1} (${v})`;
        await funciona(m, prefs, rotulo);
        pronto(m, rotulo);
        expect(JSON.stringify(m.get()), rotulo).toBe(antes);
        expect(gravados, `${rotulo}: gravou preferência`).toEqual([]);
      }
      const zumbis = ROTEIRO.filter((v) => v === "zumbi").length;
      // Android só troca o que o relógio condenou; o iPhone troca no 1º toque de cada volta
      expect(ContextoFalso.todos.length).toBe(ios ? ROTEIRO.length + 1 : zumbis + 1);
    });
  }
});

describe("17. reconstrução: #1 zumbi → #2; #2 zumbi → #3; nunca dois contextos úteis", () => {
  it("todos os barramentos, a música e os efeitos passam para o novo; o velho é fechado", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    const c1 = atual();
    const [agendadorVelho] = [...agendadores.keys()];
    esconder();
    c1.congelar();
    await voltar();
    expect(agendadores.size, "música agendada num relógio parado").toBe(0);
    expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
    await tocar();

    const c2 = atual();
    expect(c2.id).toBe(2);
    expect(c1.closes).toBe(1);
    expect(agendadores.has(agendadorVelho), "o agendador do contexto velho sobreviveu").toBe(false);
    expect(agendadores.size).toBe(1);
    expect(c2.osciladores, "o compasso da música não foi para o contexto novo").toBeGreaterThan(0);
    const velho = { o: c1.osciladores, f: c1.fontes };
    m.tone({ freq: 440 });
    m.noise({});
    expect({ o: c1.osciladores, f: c1.fontes }, "efeito no contexto velho").toEqual(velho);
    pronto(m, "#2");

    // a próxima volta opera no #2, sem trocar nada
    esconder();
    c2.mudar("suspended");
    await voltar();
    await funciona(m, prefs, "#2 de volta");
    expect(ContextoFalso.todos.length).toBe(2);

    // se o #2 virar zumbi, nasce o #3
    esconder();
    c2.congelar();
    await voltar();
    await tocar();
    expect(atual().id).toBe(3);
    expect(c2.closes).toBe(1);
    await funciona(m, prefs, "#3");
    pronto(m, "#3");
  });

  it("o close do velho que nunca responde não trava o novo, e o velho não manda mais nada", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    const c1 = atual();
    c1.fecharPendurado = true;
    esconder();
    c1.congelar();
    await voltar();
    await tocar();
    expect(c1.closes).toBe(1);
    await funciona(m, prefs, "com o velho fechando tarde");
    c1.mudar("interrupted"); // um aviso atrasado do velho
    c1.mudar("closed");
    expect(m.estadoDoCiclo().fase, "o contexto aposentado mexeu no motor").toBe("ativo");
    await funciona(m, prefs, "depois do aviso do velho");
  });

  it("UM toque (touchend + click, ou dois dedos) faz UMA reconstrução só", async () => {
    const m = motor({ music: true, sfx: true });
    esconder();
    atual().congelar();
    await voltar();
    ContextoFalso.dentroDoGesto = true;
    win.disparar("touchend");
    win.disparar("touchend");
    win.disparar("click");
    ContextoFalso.dentroDoGesto = false;
    await passar();
    expect(ContextoFalso.todos.length).toBe(2);
    pronto(m, "um toque");
  });

  it("o contexto novo é criado E retomado dentro do gesto — fora dele o iOS recusaria", async () => {
    ambiente({ ios: true });
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    ContextoFalso.estadoInicial = "suspended";
    ContextoFalso.soComGesto = true;
    esconder();
    atual().congelar();
    await voltar();
    await tocar();
    expect(atual().id).toBe(2);
    await funciona(m, prefs, "retomado no gesto");
  });

  it("o aparelho não dá outro contexto: segue no velho e o próximo toque tenta de novo", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    const c1 = atual();
    esconder();
    c1.congelar();
    await voltar();
    ContextoFalso.falharAoCriar = true;
    await tocar();
    expect(atual()).toBe(c1);
    expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
    expect(m.invariantesVioladas()).toEqual([]);
    ContextoFalso.falharAoCriar = false;
    await tocar();
    expect(atual().id).toBe(2);
    await funciona(m, prefs, "depois de o aparelho liberar");
    pronto(m);
  });

  it("iPhone saudável que não consegue outro contexto: desiste da troca nesta volta e segue tocando", async () => {
    ambiente({ ios: true });
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    esconder();
    atual().mudar("interrupted");
    await voltar();
    ContextoFalso.falharAoCriar = true;
    await tocar();
    expect(ContextoFalso.todos.length).toBe(1);
    await funciona(m, prefs, "no contexto antigo");
    pronto(m);
  });
});

describe("18 a 20. preferências depois da reconstrução", () => {
  for (const prefs of [{ music: false, sfx: true }, { music: true, sfx: false }, { music: false, sfx: false }, { music: true, sfx: true }]) {
    it(`Música ${prefs.music ? "ON" : "OFF"} / Efeitos ${prefs.sfx ? "ON" : "OFF"}: iguais no contexto novo, e nada gravado`, async () => {
      const m = motor(prefs);
      const antes = JSON.stringify(m.get());
      esconder();
      atual().congelar();
      await voltar();
      await tocar();
      expect(atual().id).toBe(2);
      expect(JSON.stringify(m.get())).toBe(antes);
      expect(gravados, "a volta gravou preferência").toEqual([]);
      if (!prefs.music) expect(atual().osciladores, "Música OFF tocou no contexto novo").toBe(0);
      await funciona(m, prefs, "contexto novo");
      pronto(m);
    });
  }
});

describe("21. comemoração do campeão", () => {
  it("reconstruída no Placar Final: volta a festa (1500 ms), uma vez só; ao sair, a bossa (2000 ms)", async () => {
    const m = motor({ music: true, sfx: true });
    m.celebrar();
    expect([...agendadores.values()]).toEqual([1500]);
    esconder();
    atual().congelar();
    await voltar();
    await tocar();
    expect(atual().id).toBe(2);
    expect([...agendadores.values()], "trilha errada ou comemoração duplicada").toEqual([1500]);
    m.encerrarCelebracao();
    expect([...agendadores.values()]).toEqual([2000]);
  });
});

describe("22. efeitos depois da reconstrução", () => {
  it("sfxTap, sfxCardPlay e sfxYourTurn criam nós no contexto NOVO, e nenhum no velho", async () => {
    audio.set({ music: true, sfx: true });
    audio.unlock();
    const c1 = atual();
    esconder();
    c1.congelar();
    await voltar();
    await tocar();
    const c2 = atual();
    expect(c2).not.toBe(c1);
    const velho = { o: c1.osciladores, f: c1.fontes };
    const novo = { o: c2.osciladores, f: c2.fontes };
    sfxTap();
    sfxCardPlay();
    sfxYourTurn();
    expect({ o: c1.osciladores, f: c1.fontes }).toEqual(velho);
    expect(c2.osciladores - novo.o).toBe(4); // toque 1 + carta 1 + vez 2
    expect(c2.fontes - novo.f).toBe(1); // o ruído de papel da carta
  });
});

describe("23. Android/Chrome: saudável não reconstrói", () => {
  it("10 idas e voltas saudáveis (mesmo as que pedem gesto) = 1 AudioContext a execução inteira", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    const roteiro: Volta[] = ["running", "suspended", "recusado", "pendurado", "suspended", "running", "recusado", "suspended", "pendurado", "running"];
    for (const [i, v] of roteiro.entries()) {
      await ciclo(v);
      await funciona(m, prefs, `ciclo ${i + 1} (${v})`);
      pronto(m, `ciclo ${i + 1}`);
    }
    expect(ContextoFalso.todos.length).toBe(1);
  });

  it("retomada recusada sem gesto: o toque retoma o MESMO contexto (sem trocar)", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    esconder();
    oNavegador(atual(), "recusado");
    await voltar();
    expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
    expect(gestosArmados()).toBe(3);
    expect(agendadores.size).toBe(0);
    await tocar();
    expect(ContextoFalso.todos.length).toBe(1);
    await funciona(m, prefs, "retomado no toque");
    pronto(m);
  });

  it("toque ANTES de a medição acabar: relógio 'running' parado há 1 s já condena o zumbi", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    esconder();
    atual().congelar();
    mostrar();
    await passar(1200); // parado desde a volta; o veredito sozinho só sairia aos 1,8 s
    await tocar();
    expect(atual().id).toBe(2);
    await funciona(m, prefs, "zumbi condenado no toque");
  });
});

describe("24. iPhone", () => {
  it("volta saudável: a música volta SOZINHA; o 1º toque troca o contexto uma vez; o 2º não troca nada", async () => {
    ambiente({ ios: true });
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    esconder();
    atual().mudar("interrupted");
    await voltar();
    expect(agendadores.size, "a música não voltou sem toque").toBe(1);
    expect(ContextoFalso.todos.length).toBe(1);
    const agendadorDaVolta = [...agendadores.keys()];
    await tocar();
    expect(ContextoFalso.todos.length).toBe(2);
    expect([...agendadores.keys()], "o agendador do contexto velho seguiu vivo").not.toEqual(agendadorDaVolta);
    expect(agendadores.size).toBe(1);
    expect(atual().osciladores, "a música não recomeçou na hora no contexto novo").toBeGreaterThan(0);
    await tocar();
    expect(ContextoFalso.todos.length, "trocou de novo sem nova ida ao fundo").toBe(2);
    await funciona(m, prefs, "depois da troca");
    pronto(m);
  });

  it("nada de suspend→resume no mesmo contexto (o 'chute' da V1)", async () => {
    ambiente({ ios: true });
    const m = motor({ music: true, sfx: true });
    const c1 = atual();
    const suspender = vi.spyOn(c1, "suspend");
    for (let i = 0; i < 3; i++) await ciclo("interrupted");
    expect(suspender).not.toHaveBeenCalled();
    pronto(m);
  });

  it("toque SEM ativação (fim de rolagem) não mexe em nada; o próximo toque de verdade troca", async () => {
    const ativacao = { isActive: false };
    ambiente({ ios: true, ativacao });
    const m = motor({ music: true, sfx: true });
    esconder();
    atual().mudar("interrupted");
    await voltar();
    await tocar();
    expect(ContextoFalso.todos.length, "trocou sem gesto que libera áudio").toBe(1);
    expect(gestosArmados()).toBe(3);
    ativacao.isActive = true;
    await tocar();
    expect(ContextoFalso.todos.length).toBe(2);
    pronto(m);
  });

  it("toque durante o assentamento já troca (o 1º toque depois de voltar é o que vale)", async () => {
    ambiente({ ios: true });
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    esconder();
    atual().mudar("interrupted");
    mostrar();
    await passar(100);
    await tocar();
    expect(ContextoFalso.todos.length).toBe(2);
    await funciona(m, prefs, "trocado no assentamento");
    pronto(m);
  });
});

describe("25. visibilitychange + pageshow da MESMA volta = uma recuperação", () => {
  it("dois avisos de visível e um pageshow: um resume, uma medição", async () => {
    const m = motor({ music: true, sfx: true });
    const c = atual();
    esconder();
    c.mudar("suspended");
    mostrar();
    win.disparar("pageshow", { persisted: true });
    doc.disparar("visibilitychange");
    await passar();
    expect(c.resumes).toBe(1);
    expect(agendadores.size).toBe(1);
    pronto(m);
    // um pageshow atrasado da MESMA volta não abre outra recuperação
    win.disparar("pageshow", { persisted: true });
    doc.disparar("visibilitychange");
    expect(m.estadoDoCiclo(), "o aviso atrasado reabriu a recuperação").toMatchObject({ fase: "ativo", recuperando: false, gestoArmado: false });
  });

  it("idas e voltas rápidas (escondeu no meio da recuperação): nunca dois agendadores, nada preso", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    for (let i = 0; i < 8; i++) {
      esconder();
      if (i % 2) atual().mudar("suspended");
      mostrar();
      await passar(i * 90); // escondeu de novo em pontos diferentes da recuperação
      expect(agendadores.size, `volta ${i}`).toBeLessThanOrEqual(1);
    }
    await passar();
    await funciona(m, prefs, "fim das idas e voltas");
    pronto(m);
  });

  it("escondido no meio da recuperação: a música NÃO recomeça escondida e nada fica preso", async () => {
    const m = motor({ music: true, sfx: true });
    esconder();
    atual().mudar("suspended");
    mostrar();
    await passar(350); // assentou e está retomando
    esconder();
    await passar();
    expect(agendadores.size).toBe(0);
    expect(m.estadoDoCiclo()).toMatchObject({ fase: "fundo", gestoArmado: false, recuperando: false });
    expect(m.invariantesVioladas()).toEqual([]);
  });
});

describe("o compasso que ficou pela metade (relógio congelado no fundo)", () => {
  it("a música espera o compasso antigo terminar — nunca dois acordes por cima", async () => {
    const m = motor({ music: true, sfx: true }); // compasso agendado em t=0, termina em 2,12 s
    await passar(800);
    esconder();
    atual().mudar("suspended"); // o relógio parou em 0,8 s
    mostrar();
    await passar(600); // assentou, retomou, mediu: faltam ~1,07 s do compasso
    expect(agendadores.size, "recomeçou por cima do compasso que ainda ia tocar").toBe(0);
    m.unlock(); // um gesto durante a espera não antecipa nem duplica
    m.set({ music: true });
    expect(agendadores.size, "o gesto antecipou a música por cima do compasso").toBe(0);
    await passar(1100);
    expect(agendadores.size).toBe(1);
    await passar(10_000);
    expect(agendadores.size).toBe(1);
    pronto(m);
  });

  it("o unlock (Iniciar, painel de som) também retoma o 'interrupted' do Safari", async () => {
    const m = motor({ music: true, sfx: true });
    const c = atual();
    c.mudar("interrupted");
    m.unlock();
    expect(c.state).toBe("running");
    await passar();
    await funciona(m, { music: true, sfx: true }, "retomado pelo unlock");
    pronto(m);
  });
});

describe("ligação ou outro app com a página à vista", () => {
  it("o navegador tira o áudio: a música para; quando ele devolve sozinho, a música volta", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    atual().mudar("interrupted");
    expect(agendadores.size, "o agendador seguiu empilhando compassos num relógio parado").toBe(0);
    expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
    atual().mudar("running");
    await passar();
    await funciona(m, prefs, "devolvido pelo navegador");
    pronto(m);
  });
});

/** Um toque de verdade sem deixar o tempo passar depois. */
const tocarSoh = () => {
  ContextoFalso.dentroDoGesto = true;
  try { win.disparar("touchend"); win.disparar("click"); } finally { ContextoFalso.dentroDoGesto = false; }
};

describe("red team da V2 (23/10): os ataques que derrubaram a 1ª versão dela", () => {
  it("relógio parado com o agendador vivo ('running' zumbi, à vista): no máximo UM compasso pendente, nunca uma pilha", async () => {
    ambiente({ tique: true });
    const m = motor({ music: true, sfx: true });
    const c = atual();
    const umCompasso = c.osciladores; // o 1º compasso, agendado no unlock
    c.congelar(); // sem aviso nenhum do navegador
    await passar(60_000); // 30 compassos de relógio parado
    expect(c.osciladores - umCompasso, "compassos empilhados num relógio parado").toBe(0);
    c.descongelar();
    await passar(2_100);
    expect(c.osciladores, "a música não voltou quando o relógio andou").toBeGreaterThan(umCompasso);
    expect(m.invariantesVioladas()).toEqual([]);
  });

  it("RT-A iPhone: o 1º toque troca para um contexto que não parte (sessão ocupada) — nada de música num relógio parado", async () => {
    ambiente({ ios: true, tique: true });
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    esconder();
    atual().mudar("interrupted");
    await voltar();
    expect(m.estadoDoCiclo()).toMatchObject({ fase: "esperando-gesto", musica: true }); // voltou tocando
    ContextoFalso.novosTravados = true; // ex.: ligação do WhatsApp segurando a sessão de áudio
    await tocar();
    const c2 = atual();
    expect(c2.id).toBe(2);
    await passar(120_000);
    expect(m.estadoDoCiclo().musica, "agendador vivo num contexto que não parte").toBe(false);
    expect(c2.osciladores, "compassos empilhados no contexto travado").toBe(0);
    expect(m.invariantesVioladas()).toEqual([]);
    // a sessão liberou: depois de duas retomadas sem resposta, o toque seguinte troca e a música volta
    ContextoFalso.novosTravados = false;
    for (let i = 0; i < 3 && atual().state !== "running"; i++) await tocar();
    await funciona(m, prefs, "sessão liberada");
  });

  it("RT-B Android: celebrar() durante a espera do gesto não liga a festa num relógio parado; o toque liga uma vez só", async () => {
    ambiente({ tique: true });
    const m = motor({ music: true, sfx: true });
    const c = atual();
    esconder();
    oNavegador(c, "recusado");
    await voltar();
    const antes = c.osciladores;
    m.celebrar(); // o Placar Final chega ao campeão logo depois da volta
    await passar(60_000);
    expect(m.estadoDoCiclo().musica, "a festa ligou num relógio parado").toBe(false);
    expect(c.osciladores - antes).toBe(0);
    await tocar();
    expect([...agendadores.values()], "a festa não voltou, ou voltou dobrada").toEqual([1500]);
    expect(m.invariantesVioladas()).toEqual([]);
  });

  it("celebrar() no meio da medição de um zumbi: o veredito para a festa; o toque troca e a festa volta uma vez, no contexto novo", async () => {
    ambiente({ tique: true });
    const m = motor({ music: true, sfx: true });
    esconder();
    atual().congelar();
    mostrar();
    await passar(600); // medindo: o relógio "running" ainda não foi condenado
    m.celebrar(); // o Placar Final chega ao campeão bem na volta
    await passar();
    expect(m.estadoDoCiclo(), "o agendador seguiu vivo num zumbi").toMatchObject({ fase: "esperando-gesto", musica: false });
    await tocar();
    expect(atual().id).toBe(2);
    expect([...agendadores.values()]).toEqual([1500]);
    expect(m.invariantesVioladas()).toEqual([]);
  });

  it("RT-C iPhone: o WebKit tira o áudio com a página à vista antes do 1º toque — a música para, e volta uma vez quando ele devolve", async () => {
    ambiente({ ios: true, tique: true });
    const m = motor({ music: true, sfx: true });
    esconder();
    atual().mudar("interrupted");
    await voltar();
    const c = atual();
    expect(m.estadoDoCiclo()).toMatchObject({ fase: "esperando-gesto", musica: true });
    c.mudar("interrupted"); // Siri, alarme, áudio de outro app
    const antes = c.osciladores;
    await passar(30_000);
    expect(m.estadoDoCiclo().musica).toBe(false);
    expect(c.osciladores - antes).toBe(0);
    c.mudar("running"); // o WebKit devolveu sozinho
    await passar();
    expect(agendadores.size).toBe(1);
    expect(m.invariantesVioladas()).toEqual([]);
  });

  it("RT-D iPhone: o contexto novo demora 2,5 s para partir — não é condenado, e os toques seguintes não trocam de novo", async () => {
    ambiente({ ios: true });
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    ContextoFalso.inicioLentoMs = 2500;
    esconder();
    atual().mudar("interrupted");
    await voltar();
    tocarSoh(); // troca: o #2 nasce com o relógio lento
    await passar(2000); // ainda não partiu
    await tocar(); // um toque no meio da partida lenta não troca de novo
    for (let i = 0; i < 4; i++) await tocar();
    expect(ContextoFalso.todos.length, "trocou um contexto que só demorava a partir").toBe(2);
    await funciona(m, prefs, "o #2 partiu devagar");
    pronto(m);
  });

  it("zumbi que volta a andar depois do veredito é absolvido no toque (Android): sem troca, e a música volta", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    const c = atual();
    esconder();
    c.congelar();
    await voltar(); // veredito: zumbi
    expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
    c.descongelar(); // a saída só demorou a reabrir
    await passar(500);
    await tocar();
    expect(ContextoFalso.todos.length, "trocou um contexto que voltou a andar").toBe(1);
    await funciona(m, prefs, "absolvido");
    pronto(m);
  });

  it("RT-E Android: contexto que não parte nem com gesto — na 2ª falha é condenado (vale entre voltas) e o toque seguinte troca", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    const c = atual();
    esconder();
    c.mudar("suspended");
    c.pendurarSempre = true;
    await voltar();
    await tocar(); // 1ª falha dentro do gesto
    esconder();
    await voltar();
    await tocar(); // 2ª: condenado
    expect(ContextoFalso.todos.length).toBe(1);
    esconder();
    await voltar();
    await tocar(); // troca
    expect(ContextoFalso.todos.length).toBe(2);
    await funciona(m, prefs, "contexto novo");
    pronto(m);
  });

  it("RT-F Android: o sistema suspende no começo da medição — não vira zumbi; quando ele devolve, a música volta sem troca", async () => {
    const m = motor({ music: true, sfx: true });
    esconder();
    atual().mudar("suspended");
    mostrar();
    await passar(320); // assentou, retomou, mediu 20 ms
    atual().mudar("suspended"); // perda de foco curta no meio da medição
    await passar(1700);
    atual().mudar("running"); // o sistema devolveu sozinho
    await passar();
    expect(m.estadoDoCiclo()).toMatchObject({ fase: "ativo", musica: true });
    expect(ContextoFalso.todos.length).toBe(1);
    pronto(m);
  });

  it("RT-G iPhone: 1º unlock FORA do gesto (o modo online chama depois de carregar) — o 1º toque real retoma, sem rejeição solta", async () => {
    ambiente({ ios: true });
    ContextoFalso.estadoInicial = "suspended";
    ContextoFalso.soComGesto = true;
    const prefs = { music: true, sfx: true };
    const m = motor(prefs, false);
    const soltas: unknown[] = [];
    const pegar = (r: unknown) => { soltas.push(r); };
    process.on("unhandledRejection", pegar);
    try {
      m.unlock();
      await passar();
      expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
      await tocar();
      await funciona(m, prefs, "retomado no 1º toque");
      pronto(m);
    } finally {
      process.off("unhandledRejection", pegar);
    }
    expect(soltas, "rejeição sem tratamento").toEqual([]);
  });

  it("RT-H new AudioContext() lançando no 1º unlock: o jogo segue mudo, sem derrubar o Iniciar; o próximo gesto tenta de novo", () => {
    ContextoFalso.falharAoCriar = true;
    const m = motor({ music: true, sfx: true }, false);
    expect(() => m.unlock()).not.toThrow();
    expect(m.estadoDoCiclo().fase).toBe("ocioso");
    ContextoFalso.falharAoCriar = false;
    m.unlock();
    expect(ContextoFalso.todos.length).toBe(1);
    expect(m.estadoDoCiclo().fase).toBe("ativo");
  });

  it("RT-I Android: relógio 'running' que demora 700 ms (Bluetooth reabrindo) e toque aos 600 ms — não troca", async () => {
    const m = motor({ music: true, sfx: true });
    const c1 = atual();
    esconder();
    c1.congelar();
    mostrar();
    await passar(600);
    tocarSoh();
    await passar(100);
    c1.descongelar();
    await passar();
    expect(ContextoFalso.todos.length, "trocou um contexto saudável").toBe(1);
    pronto(m);
  });

  for (const queda of ["suspended", "interrupted", "closed"] as const) {
    it(`RT-J Android: o contexto vai a "${queda}" no meio da medição — fica esperando o gesto, e o toque resolve`, async () => {
      const prefs = { music: true, sfx: true };
      const m = motor(prefs);
      const c = atual();
      esconder();
      c.mudar("suspended");
      mostrar();
      await passar(370); // assentou, retomou, o relógio andou 70 ms
      c.recusar = true; // daqui em diante só retoma com gesto
      c.mudar(queda);
      await passar();
      expect(m.estadoDoCiclo(), "declarou saudável um contexto parado").toMatchObject({ fase: "esperando-gesto", gestoArmado: true, musica: false });
      await tocar();
      await funciona(m, prefs, `depois de "${queda}"`);
      pronto(m);
    });
  }

  it("RT-K o grafo do contexto novo quebra no meio e o close dele não responde: uma tentativa por volta, não um contexto vazado por toque", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    const c1 = atual();
    esconder();
    c1.congelar();
    await voltar();
    const original = ContextoFalso.prototype.createConvolver;
    ContextoFalso.prototype.createConvolver = function (this: ContextoFalso) {
      if (this.id > 1) { this.fecharPendurado = true; throw new Error("NotSupportedError: convolver"); }
      return original.call(this);
    };
    try {
      for (let i = 0; i < 10; i++) await tocar();
    } finally {
      ContextoFalso.prototype.createConvolver = original;
    }
    expect(ContextoFalso.todos.length - 1, "um contexto meio-montado por toque").toBe(1);
    expect(m.invariantesVioladas()).toEqual([]);
    // na volta seguinte tenta de novo, e agora consegue
    esconder();
    await voltar();
    await tocar();
    await funciona(m, prefs, "contexto novo na volta seguinte");
    pronto(m);
  });
});
