// O ÁUDIO DEPOIS DE IR AO WHATSAPP E VOLTAR — hotfix V1 (22/10/2026) e V2 (23/10/2026).
//
// O aparelho derrubou a V1 na 2ª volta, e os testes dela passavam: o AudioContext falso era
// "honesto" — "running" sempre tinha relógio andando e o resume sempre respondia. Este falso imita
// o WebKit de verdade: o relógio só anda "running" e NÃO congelado (o zumbi que volta "running" e
// mudo), o resume pode recusar ou nunca responder, o close pode não responder, e um nó não liga em
// nó de outro contexto (como no navegador). Prova a LÓGICA; não substitui o teste físico no iPhone.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioEngine, audio } from "./engine.js";
import { compensacaoDoReverbLeve } from "./perfilDoGrafo.js";
import { sfxCardPlay, sfxTap, sfxYourTurn } from "./sounds.js";
import { alternarPreferencia } from "../ui/AudioPanel.js";

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
  /** Ligações que saem deste nó e ainda estão de pé (o navegador as processa a cada quantum). */
  saidas = 0;
  onended: (() => void) | null = null;
  fftSize = 2048;
  /** Como no navegador: ligar nós de contextos diferentes é erro. */
  connect(destino: { contexto: ContextoFalso }) {
    if (destino.contexto !== this.contexto) {
      throw new Error(`InvalidAccessError: nó do contexto #${this.contexto.id} ligado no #${destino.contexto.id}`);
    }
    this.saidas++;
    this.contexto.ligacoes++;
  }
  disconnect() { this.contexto.ligacoes -= this.saidas; this.saidas = 0; }
  start() {}
  /** A fonte acaba no instante pedido e avisa (`ended`), como no navegador. */
  stop(quando = 0) {
    const ms = Math.max(0, quando - this.contexto.currentTime) * 1000;
    setTimeout(() => this.onended?.(), ms);
  }
  /** Analisador: o que sai do master. Envenenado = NaN (o compressor nunca mais devolve número). */
  getFloatTimeDomainData(buf: Float32Array) { buf.fill(this.contexto.envenenado ? Number.NaN : this.contexto.saida); }
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
  /** O dispositivo de saída falhou (Chrome: evento `error` do AudioContext). */
  onerror: (() => void) | null = null;
  /** Ligações vivas entre nós deste contexto. */
  ligacoes = 0;
  /** O sinal virou NaN no meio do grafo (e o compressor guarda o NaN para sempre). */
  envenenado = false;
  /** O que o analisador lê no master (0 = silêncio absoluto; o padrão, para os testes antigos). */
  saida = 0;
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
  /** O navegador muda o estado SEM avisar (o `statechange` se perdeu). */
  mudarCalado(s: string) { this.marcar(); this.estado = s; }
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
  createAnalyser() { return new NoFalso(this); }
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
function ambiente(o: { ios?: boolean; desktop?: boolean; ativacao?: { isActive: boolean }; tique?: boolean } = {}) {
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
      : o.desktop
        ? { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36", platform: "Win32", maxTouchPoints: 0 }
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
  for (const plat of ["android", "ios", "desktop"] as const) {
    const ios = plat === "ios";
    const nome = { android: "Android", ios: "iPhone", desktop: "Chrome no computador" }[plat];
    it(`${nome}: ao fim de CADA ciclo o som funciona, 1 agendador, 0 gesto, nada preso, prefs intactas`, async () => {
      ambiente({ ios, desktop: plat === "desktop" });
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
      // O CELULAR (iPhone e, desde 03/11, Android) troca no 1º toque de cada volta: a saída física
      // ficou sob suspeita. O computador só troca o que o relógio condenou.
      expect(ContextoFalso.todos.length).toBe(plat === "desktop" ? zumbis + 1 : ROTEIRO.length + 1);
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

describe("23. Chrome no computador: saudável não reconstrói", () => {
  it("10 idas e voltas saudáveis (mesmo as que pedem gesto) = 1 AudioContext a execução inteira", async () => {
    ambiente({ desktop: true }); // a lógica do Chrome que confia no relógio vale no computador; o celular troca na volta (§27)
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
    ambiente({ desktop: true }); // a lógica do Chrome que confia no relógio vale no computador; o celular troca na volta (§27)
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
    ambiente({ desktop: true }); // a lógica do Chrome que confia no relógio vale no computador; o celular troca na volta (§27)
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
    ambiente({ desktop: true }); // a lógica do Chrome que confia no relógio vale no computador; o celular troca na volta (§27)
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
    ambiente({ desktop: true }); // a lógica do Chrome que confia no relógio vale no computador; o celular troca na volta (§27)
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
    ambiente({ desktop: true }); // a lógica do Chrome que confia no relógio vale no computador; o celular troca na volta (§27)
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
    ambiente({ desktop: true }); // a lógica do Chrome que confia no relógio vale no computador; o celular troca na volta (§27)
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
    // Desde o vigia (03/11), o relógio parado é VISTO: a música para e, quando o relógio volta a
    // andar, o vigia absolve, confere e recomeça — alguns segundos, não um compasso.
    await passar(8_000);
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

  it("zumbi que volta a andar depois do veredito é absolvido no toque (Chrome no computador): sem troca, e a música volta", async () => {
    ambiente({ desktop: true }); // a lógica do Chrome que confia no relógio vale no computador; o celular troca na volta (§27)
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

  it("RT-E Chrome no computador: contexto que não parte nem com gesto — na 2ª falha é condenado (vale entre voltas) e o toque seguinte troca", async () => {
    ambiente({ desktop: true }); // a lógica do Chrome que confia no relógio vale no computador; o celular troca na volta (§27)
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

  it("RT-F Chrome no computador: o sistema suspende no começo da medição — não vira zumbi; quando ele devolve, a música volta sem troca", async () => {
    ambiente({ desktop: true }); // a lógica do Chrome que confia no relógio vale no computador; o celular troca na volta (§27)
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

  it("RT-I Chrome no computador: relógio 'running' que demora 700 ms (Bluetooth reabrindo) e toque aos 600 ms — não troca", async () => {
    ambiente({ desktop: true }); // a lógica do Chrome que confia no relógio vale no computador; o celular troca na volta (§27)
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

// ─────────────────────────── HOTFIX ANDROID (AAB 0.1.0 vc1, 03/11/2026) ───────────────────────────
//
// Relato do 1º teste físico no Android: tocar no ícone de som na Home, o painel abre e o som some —
// e desligar/religar Música ou Efeitos NÃO o traz de volta. A causa no aparelho não foi reproduzida
// (não há WebView do Android aqui); o que o código mostra é que o painel não tinha como recuperar:
// `unlock` só retoma contexto PARADO, e um contexto "running" de relógio andando cuja saída física
// morreu é invisível ao JS (o mesmo limite já descrito para o iPhone). Este falso simula exatamente
// isso: `saidaMorta` — "running", relógio andando, e mudo. Religar no painel é o pedido explícito de
// quem quer ouvir: agora troca o contexto por um novo, dentro do toque, pelo caminho já provado.
describe("16. painel de som no Android: religar Música/Efeitos recupera o áudio", () => {
  /** O toque no painel: dentro do gesto, como no aparelho. */
  const noPainel = async (m: AudioEngine, k: "music" | "sfx") => {
    ContextoFalso.dentroDoGesto = true;
    try { alternarPreferencia(m, k, () => {}); } finally { ContextoFalso.dentroDoGesto = false; }
    await passar();
  };

  it("saída morta com o contexto 'running': Música OFF→ON troca por um contexto novo, com música e efeitos nele", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    await funciona(m, prefs, "início");
    const morto = atual(); // "running", relógio andando — e mudo: o JS não tem como ver
    await noPainel(m, "music");
    await noPainel(m, "music");
    expect(atual(), "religar a Música não trocou o contexto de saída morta").not.toBe(morto);
    expect(morto.closes, "o contexto velho não foi fechado").toBe(1);
    await funciona(m, prefs, "depois de religar a Música");
    pronto(m, "depois de religar a Música");
  });

  it("o mesmo com Efeitos OFF→ON (a música continua, agora no contexto novo)", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    const morto = atual();
    await noPainel(m, "sfx");
    await noPainel(m, "sfx");
    expect(atual()).not.toBe(morto);
    await funciona(m, prefs, "depois de religar os Efeitos");
    pronto(m);
  });

  it("DESLIGAR não troca nada: só a música (ou só os efeitos) para", async () => {
    const m = motor({ music: true, sfx: true });
    const c = atual();
    await noPainel(m, "music");
    expect(atual()).toBe(c);
    await funciona(m, { music: false, sfx: true }, "música desligada");
    await noPainel(m, "sfx");
    expect(atual()).toBe(c);
    await funciona(m, { music: false, sfx: false }, "tudo desligado");
    pronto(m);
  });

  it("todas as combinações, ida e volta: cada estado funciona e nada se acumula", async () => {
    const m = motor({ music: true, sfx: true });
    const sequencia: ("music" | "sfx")[] = ["music", "sfx", "music", "sfx", "sfx", "music", "music", "sfx"];
    for (const [i, k] of sequencia.entries()) {
      await noPainel(m, k);
      await funciona(m, { music: m.get().music, sfx: m.get().sfx }, `passo ${i + 1} (${k})`);
      expect(m.invariantesVioladas(), `passo ${i + 1}`).toEqual([]);
    }
    const abertos = ContextoFalso.todos.filter((c) => c.state !== "closed");
    expect(abertos.length, "contextos abertos ao mesmo tempo").toBe(1);
  });

  it("abrir e fechar o painel muitas vezes (o toque no ícone) não troca contexto nem duplica a música", async () => {
    const prefs = { music: true, sfx: true };
    const m = motor(prefs);
    const c = atual();
    for (let i = 0; i < 12; i++) {
      ContextoFalso.dentroDoGesto = true;
      try { m.unlock(); } finally { ContextoFalso.dentroDoGesto = false; }
      await passar(300);
    }
    expect(atual()).toBe(c);
    await funciona(m, prefs, "depois de 12 aberturas");
    pronto(m);
  });

  it("religar com a página escondida não cria contexto (só a volta e o gesto mexem)", async () => {
    const m = motor({ music: true, sfx: true });
    const c = atual();
    esconder();
    m.religar();
    expect(atual()).toBe(c);
    expect(m.invariantesVioladas()).toEqual([]);
  });

  it("os volumes respondem no contexto novo, e as escolhas ficam gravadas", async () => {
    const m = motor({ music: true, sfx: true });
    await noPainel(m, "music");
    await noPainel(m, "music");
    m.set({ musicVol: 0.2, sfxVol: 0.3 });
    expect(m.get()).toMatchObject({ music: true, sfx: true, musicVol: 0.2, sfxVol: 0.3 });
    expect(gravados).toContain("king.audio");
  });
});

describe("26. Android, 2º QA físico (03/11): o som morre NO MEIO do uso, com a página à vista", () => {
  // No aparelho o som começou, sumiu depois de um tempo de uso e não voltou. A máquina só olhava o
  // contexto na ida ao fundo, na volta e no `statechange`: um contexto que morre com a página à vista
  // e sem aviso (relógio parado, estado trocado sem evento, NaN no master, erro do dispositivo) ficava
  // "ativo" para sempre — e, "ativo", nenhum toque o trocava. Agora um VIGIA confere a saúde enquanto
  // o jogo está à vista, e o próximo toque real resolve.
  const prefs = { music: true, sfx: true };

  it("relógio congela sem aviso: o vigia percebe, a música para e o PRÓXIMO toque troca o contexto", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    await passar(10_000);
    const morto = atual();
    morto.congelar();
    await passar(5_000);
    expect(m.estadoDoCiclo().fase, "o vigia não viu o relógio parado").toBe("esperando-gesto");
    expect(agendadores.size, "música viva num relógio parado").toBe(0);
    await tocar();
    expect(atual(), "o toque não trocou o contexto morto").not.toBe(morto);
    expect(morto.closes, "o contexto morto não foi fechado").toBe(1);
    await funciona(m, prefs, "depois do toque");
    pronto(m, "depois do toque");
  });

  it("estado sai de 'running' SEM statechange: o vigia para a música; o toque retoma o MESMO contexto", async () => {
    ambiente({ tique: true });
    ContextoFalso.soComGesto = true;
    const m = motor(prefs);
    const c = atual();
    c.mudarCalado("suspended");
    await passar(5_000);
    expect(m.estadoDoCiclo().fase, "o vigia não viu o contexto parado").toBe("esperando-gesto");
    expect(agendadores.size).toBe(0);
    await tocar();
    expect(atual(), "retomável não precisa de contexto novo").toBe(c);
    await funciona(m, prefs, "depois do toque");
    pronto(m, "depois do toque");
  });

  it("sinal envenenado (NaN no master) com o relógio andando: condenado até o toque, que troca por um novo", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    const c = atual();
    c.envenenado = true;
    await passar(15_000);
    expect(m.estadoDoCiclo().fase, "o vigia não viu o NaN").toBe("esperando-gesto");
    expect(agendadores.size, "música tocando num grafo envenenado").toBe(0);
    await tocar();
    expect(atual()).not.toBe(c);
    expect(c.closes).toBe(1);
    await funciona(m, prefs, "depois do toque");
    pronto(m, "depois do toque");
  });

  it("erro do dispositivo de saída (evento error do AudioContext): o toque troca o contexto", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    const c = atual();
    c.onerror?.();
    await passar(100);
    expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
    await tocar();
    expect(atual()).not.toBe(c);
    await funciona(m, prefs, "depois do toque");
    pronto(m, "depois do toque");
  });

  it("zumbi que volta a andar sozinho é absolvido pelo vigia: a música volta sem troca e sem toque", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    const c = atual();
    c.congelar();
    await passar(5_000);
    expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
    c.descongelar();
    await passar(8_000);
    expect(atual()).toBe(c);
    await funciona(m, prefs, "absolvido");
    pronto(m, "absolvido");
  });

  it("acúmulo de nós: 10 minutos de música e efeitos não deixam ligações penduradas no contexto", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    const c = atual();
    const tocarPor = async (s: number) => {
      for (let i = 0; i < s; i++) { m.tone({ freq: 440, dur: 0.1, space: 0.2 }); m.noise({ dur: 0.1, space: 0.2 }); await passar(1000); }
    };
    await tocarPor(60);
    const umMinuto = c.ligacoes;
    await tocarPor(540);
    expect(c.ligacoes - umMinuto, `ligações acumuladas (1 min: ${umMinuto}, 10 min: ${c.ligacoes})`).toBeLessThan(60);
    expect(c.ligacoes, "ligações vivas depois de 10 min").toBeLessThan(400);
    pronto(m);
  }, 60_000);

  it("saudável não dispara o vigia: 10 minutos tocando = 1 contexto, nenhuma troca, nenhum ouvinte de gesto (Android e iPhone)", async () => {
    for (const ios of [false, true]) {
      ambiente({ ios, tique: true });
      const m = motor(prefs);
      const c = atual();
      await passar(600_000);
      expect(atual(), ios ? "iPhone" : "Android").toBe(c);
      await funciona(m, prefs, ios ? "iPhone" : "Android");
      pronto(m, ios ? "iPhone" : "Android");
    }
  }, 60_000);

  it("escondido, o vigia não mexe em nada nem cria contexto", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    esconder();
    atual().congelar();
    atual().envenenado = true;
    await passar(30_000);
    expect(ContextoFalso.todos.length).toBe(1);
    expect(m.estadoDoCiclo()).toMatchObject({ fase: "fundo", gestoArmado: false });
    expect(m.invariantesVioladas()).toEqual([]);
  });
});

describe("27. Android, rodada 4 (03/11): o som que morre SEM o motor perceber", () => {
  // O aparelho provou uma coisa só: um contexto NOVO, criado dentro de um toque, toca ("funciona no
  // começo"). O que mata o som depois nem sempre aparece para o JS — saída trocada pelo navegador
  // depois de silêncio, rota de áudio que mudou com o app no fundo, grafo que calou por dentro. Esta
  // seção prova os três gatilhos novos que levam ao contexto novo: a volta do fundo no celular, o
  // master em zero absoluto com a música no ar, e o 🔊.
  const prefs = { music: true, sfx: true };

  it("Android: volta do fundo com o relógio andando — a música volta sozinha e o 1º toque troca o contexto; o 2º não troca de novo", async () => {
    const m = motor(prefs);
    const c1 = atual();
    esconder();
    await passar(40_000); // 40 s no fundo: o bastante para o Chrome trocar a saída real pela falsa
    await voltar();
    expect(agendadores.size, "a música não voltou sozinha").toBe(1);
    expect(m.estadoDoCiclo(), "o toque não ficou armado").toMatchObject({ fase: "esperando-gesto", gestoArmado: true });
    await tocar();
    expect(atual(), "o 1º toque não trocou o contexto").not.toBe(c1);
    expect(c1.closes, "o velho não foi fechado").toBe(1);
    await funciona(m, prefs, "contexto novo");
    pronto(m, "contexto novo");
    const c2 = atual();
    await tocar();
    expect(atual(), "o 2º toque trocou de novo").toBe(c2);
    expect(gravados, "gravou preferência").toEqual([]);
  });

  it("Android: o sistema tira o áudio com a página à vista e devolve — a música volta, e o 1º toque troca o contexto", async () => {
    const m = motor(prefs);
    const c1 = atual();
    c1.mudar("interrupted");
    expect(agendadores.size, "música num relógio parado").toBe(0);
    c1.mudar("running");
    await passar();
    expect(agendadores.size, "a música não voltou quando o sistema devolveu").toBe(1);
    await tocar();
    expect(atual()).not.toBe(c1);
    await funciona(m, prefs, "depois da interrupção");
    pronto(m);
  });

  it("grafo calado por dentro (master em ZERO absoluto com a música no ar): condenado em ~6 s; o toque troca e o som volta", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    const c = atual();
    c.saida = 0.05; // o analisador mostra som: está provado
    await passar(10_000);
    expect(m.estadoDoCiclo().fase).toBe("ativo");
    c.saida = 0; // calou por dentro, relógio andando, estado "running"
    await passar(7_000);
    expect(m.estadoDoCiclo().fase, "o vigia não viu o master mudo").toBe("esperando-gesto");
    expect(agendadores.size, "a música seguiu agendada num grafo mudo").toBe(0);
    await tocar();
    expect(atual(), "o toque não trocou o contexto calado").not.toBe(c);
    expect(c.closes).toBe(1);
    atual().saida = 0.05;
    await funciona(m, prefs, "contexto novo");
    pronto(m, "contexto novo");
  });

  it("analisador que NUNCA mostrou som (devolve sempre zero): 3 minutos tocando = nenhuma condenação, nenhuma troca", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    const c = atual(); // saida = 0 desde o começo: o analisador não prova nada
    await passar(180_000);
    expect(atual()).toBe(c);
    expect(m.estadoDoCiclo()).toMatchObject({ fase: "ativo", gestoArmado: false });
    await funciona(m, prefs, "analisador mudo de nascença");
  }, 30_000);

  it("silêncio LEGÍTIMO não condena: volume da música em 0, ou música desligada", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    const c = atual();
    c.saida = 0.05;
    await passar(10_000);
    m.set({ musicVol: 0 });
    c.saida = 0;
    await passar(20_000);
    expect(m.estadoDoCiclo().fase, "volume 0 condenou").toBe("ativo");
    m.set({ musicVol: 0.5, music: false });
    await passar(20_000);
    expect(m.estadoDoCiclo().fase, "música desligada condenou").toBe("ativo");
    expect(ContextoFalso.todos.length).toBe(1);
    expect(m.invariantesVioladas()).toEqual([]);
  });

  it("logo depois de a música (re)começar, o zero não conta (o 1º compasso ainda nem soou)", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    const c = atual();
    c.saida = 0.05;
    await passar(10_000);
    m.set({ music: false });
    c.saida = 0;
    m.set({ music: true }); // recomeça agora
    await passar(3_000); // um exame cai dentro da janela de 4 s
    expect(m.estadoDoCiclo().fase).toBe("ativo");
  });

  it("🔊 reativa: sem contexto, cria; com contexto, troca por um novo DENTRO do toque; toque duplo não troca de novo", async () => {
    const m = motor(prefs, false);
    ContextoFalso.dentroDoGesto = true;
    m.reativar();
    ContextoFalso.dentroDoGesto = false;
    expect(ContextoFalso.todos.length, "o 1º 🔊 não criou o contexto").toBe(1);
    await passar();
    const c1 = atual();
    ContextoFalso.dentroDoGesto = true;
    m.reativar();
    m.reativar(); // toque duplo
    ContextoFalso.dentroDoGesto = false;
    expect(ContextoFalso.todos.length, "o 🔊 não trocou, ou trocou duas vezes").toBe(2);
    expect(c1.closes).toBe(0); // o velho sai depois, sem ninguém esperar por ele
    await passar();
    expect(c1.closes, "o velho não foi fechado").toBe(1);
    await funciona(m, prefs, "depois do 🔊");
    pronto(m, "depois do 🔊");
    expect(gravados, "o 🔊 gravou preferência").toEqual([]);
  });

  it("🔊 com o jogo escondido não cria nem troca nada", async () => {
    const m = motor(prefs);
    esconder();
    await passar();
    m.reativar();
    expect(ContextoFalso.todos.length).toBe(1);
    expect(m.estadoDoCiclo()).toMatchObject({ fase: "fundo", gestoArmado: false });
  });

  it("🔊 resolve o mudo que ninguém vê: relógio andando, master com som, e mesmo assim troca (o alto-falante é que calou)", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    const c = atual();
    c.saida = 0.05; // para o JS, tudo perfeito
    await passar(30_000);
    expect(m.estadoDoCiclo().fase).toBe("ativo");
    ContextoFalso.dentroDoGesto = true;
    m.reativar();
    ContextoFalso.dentroDoGesto = false;
    expect(atual()).not.toBe(c);
    await passar();
    await funciona(m, prefs, "depois do 🔊");
    pronto(m);
  });
});

describe("27b. o 🔊 depois da revisão independente (03/11)", () => {
  const prefs = { music: true, sfx: true };

  for (const plat of ["ios", "desktop"] as const) {
    it(`${plat === "ios" ? "iPhone" : "Chrome no computador"}: o 🔊 NÃO troca um contexto saudável (lá o som funciona; só retoma)`, async () => {
      ambiente({ ios: plat === "ios", desktop: plat === "desktop" });
      const m = motor(prefs);
      const c = atual();
      await passar();
      ContextoFalso.dentroDoGesto = true;
      m.reativar();
      ContextoFalso.dentroDoGesto = false;
      await passar();
      expect(atual(), "o 🔊 trocou fora do Android").toBe(c);
      await funciona(m, prefs, plat);
      pronto(m, plat);
    });
  }

  it("Android: troca que acabou de falhar no toque não é repetida pelo 🔊 do MESMO toque (uma tentativa por toque)", async () => {
    const m = motor(prefs);
    await passar();
    ContextoFalso.falharAoCriar = true;
    ContextoFalso.dentroDoGesto = true;
    m.reativar(); // 1ª tentativa: o aparelho não dá outro contexto
    const tentativas = ContextoFalso.todos.length;
    m.reativar(); // o click que segue o touchend
    ContextoFalso.dentroDoGesto = false;
    expect(ContextoFalso.todos.length).toBe(tentativas);
    ContextoFalso.falharAoCriar = false;
    await passar(2_000);
    ContextoFalso.dentroDoGesto = true;
    m.reativar(); // um toque NOVO, depois: tenta de novo
    ContextoFalso.dentroDoGesto = false;
    expect(ContextoFalso.todos.length).toBe(tentativas + 1);
    await passar();
    await funciona(m, prefs, "depois da 2ª tentativa");
    expect(m.invariantesVioladas()).toEqual([]);
  });

  it("relógio parado com o master em zero: condena como ZUMBI (absolvível), não como mudo", async () => {
    ambiente({ tique: true });
    const m = motor(prefs);
    const c = atual();
    c.saida = 0.05;
    await passar(10_000);
    c.saida = 0;
    c.congelar();
    await passar(5_000);
    expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
    c.descongelar(); // só demorou
    c.saida = 0.05;
    await passar(5_000);
    expect(atual(), "trocou um contexto que voltou a andar").toBe(c);
    expect(m.estadoDoCiclo().fase).toBe("ativo");
  });
});

describe("28. diagnóstico DEBUG sem cabo (rodada 5, 04/11): a sonda lê o motor sem mexer nele", () => {
  // O APK DEBUG ganha um painel que registra a falha NO APARELHO e exporta o relatório por ação da
  // pessoa. Estes testes usam o motor DE VERDADE com a chave de build ligada (módulos recarregados):
  // o retrato do toque vem antes da troca que o toque dispara, "Registrar falha" não repara nada,
  // o som de teste não retoma nem troca, e "Tentar recuperar" é o religar de sempre.
  const prefs = { music: true, sfx: true };
  type Motores = typeof import("./engine.js");
  let Motor: Motores["AudioEngine"];
  let rel: typeof import("./relatorioDeAudio.js");
  let dg: typeof import("./diagnostico.js");
  const AMB = { versao: "0.1.0", build: "teste", plataforma: "Android 14", motor: "Chromium 141", webview: true, nativo: true, tela: null, online: false, nucleos: null, memoriaGb: null };

  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.resetModules();
    vi.stubGlobal("__KING_DIAG_AUDIO__", true);
    ({ AudioEngine: Motor } = await import("./engine.js"));
    rel = await import("./relatorioDeAudio.js");
    dg = await import("./diagnostico.js");
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const ligado = (p: Prefs = prefs) => { const m = new Motor(); m.set(p); m.unlock(); return m; };
  /** O dedo encosta (pointerdown) e solta (touchend + click, dentro do gesto). */
  const dedo = async () => { win.disparar("pointerdown"); await tocar(); };

  it("no build normal (sem a chave) não existe sonda nem diagnóstico", () => {
    expect(new AudioEngine().sondaDeDiagnostico()).toBeNull();
    expect(audio.sondaDeDiagnostico()).toBeNull();
    expect(dg.DIAG_LIGADO, "a chave do teste ligou").toBe(true);
  });

  it("relógio congelado: o retrato do toque guarda o estado DEFEITUOSO antes da troca que o próprio toque faz", async () => {
    ambiente({ tique: true });
    const m = ligado();
    const s = m.sondaDeDiagnostico()!;
    await passar(10_000);
    const morto = atual();
    morto.congelar();
    await passar(5_000);
    expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
    const geracaoMorta = s.retrato().geracao;
    await dedo();
    expect(atual(), "o toque não trocou").not.toBe(morto);
    const antes = s.antesDoToque().at(-1)!;
    expect(antes.r).toMatchObject({ fase: "esperando-gesto", contexto: "running", zumbi: true, geracao: geracaoMorta, musicaAgendada: false });
    expect(Number(s.retrato().geracao)).toBeGreaterThan(Number(geracaoMorta));
    // a troca registrada: antes (zumbi) → logo depois → ~1 s depois
    await passar(1_500);
    const t = s.trocas().at(-1)!;
    expect(t.antes.r).toMatchObject({ zumbi: true, geracao: geracaoMorta });
    expect(t.falhou).toBe(false);
    expect(t.depois?.r.geracao).not.toBe(geracaoMorta);
    expect(t.umSegundoDepois?.r.contexto).toBe("running");
    const c = dg.diagAudio.contagens();
    expect(c["contexto-novo"]).toBe(2);
    expect(c["reconstruir-ok"]).toBe(1);
    expect(c["contexto-fechado"], "o velho fechado entra na conta").toBe(1);
  });

  it("Registrar falha não repara nada: nenhum contexto novo, nenhum resume, a fase continua a defeituosa", async () => {
    ambiente({ tique: true });
    const m = ligado();
    await passar(10_000);
    const morto = atual();
    morto.congelar();
    await passar(5_000);
    const sess = rel.criarSessaoDeDiagnostico({ diag: dg.diagAudio, sonda: () => m.sondaDeDiagnostico() });
    const contextos = ContextoFalso.todos.length;
    const resumes = morto.resumes;
    const o = sess.registrarFalha();
    expect(ContextoFalso.todos.length).toBe(contextos);
    expect(morto.resumes).toBe(resumes);
    expect(m.estadoDoCiclo().fase).toBe("esperando-gesto");
    expect(o.noRegistro).toMatchObject({ zumbi: true, contexto: "running" });
  });

  it("o 🔊 no Android: A1 é o motor ANTES do reparo do 🔊 (reativar troca o contexto logo depois)", async () => {
    const m = ligado();
    const c1 = atual();
    await passar(3_000); // o 🔊 não troca contexto que acabou de nascer
    const s = m.sondaDeDiagnostico()!;
    const g1 = s.retrato().geracao;
    const sess = rel.criarSessaoDeDiagnostico({ diag: dg.diagAudio, sonda: () => s });
    win.disparar("pointerdown");
    ContextoFalso.dentroDoGesto = true;
    try { sess.aoAbrirPainelDeSom(); m.reativar(); } finally { ContextoFalso.dentroDoGesto = false; }
    expect(atual(), "o 🔊 não trocou o contexto").not.toBe(c1);
    await passar(2_000);
    const o = sess.registrarFalha();
    expect(o.abertura?.r.geracao).toBe(g1);
    expect(o.depoisDoPainel?.r.geracao).not.toBe(g1);
    expect(dg.diagAudio.contagens()["painel-de-som-aberto"]).toBe(1);
  });

  it("Testar música/efeito: toca pelos barramentos do contexto atual — sem resume, sem troca; o resultado mede o grafo", async () => {
    const m = ligado({ music: false, sfx: true });
    const c = atual();
    const s = m.sondaDeDiagnostico()!;
    c.saida = 0.03;
    const osc = c.osciladores;
    const resumes = c.resumes;
    const p = s.tocarTeste("musica");
    await passar(400);
    const r = await p;
    expect(r).toMatchObject({ qual: "musica", tocou: true });
    expect(r.durante).toMatchObject({ rms: 0.03, contexto: "running", prefMusica: false, ganhoMusica: 0 });
    expect(c.osciladores - osc).toBe(3);
    expect(c.resumes).toBe(resumes);
    expect(ContextoFalso.todos).toHaveLength(1);
  });

  it("sem contexto (antes do 1º toque): o teste não cria contexto", async () => {
    const m = new Motor();
    const r = await m.sondaDeDiagnostico()!.tocarTeste("efeito");
    expect(r).toMatchObject({ tocou: false, motivo: "sem-contexto" });
    expect(ContextoFalso.todos).toHaveLength(0);
  });

  it("Tentar recuperar (C) = o religar de sempre, dentro do toque: antes defeituoso, depois contexto novo", async () => {
    ambiente({ tique: true });
    const m = ligado();
    await passar(10_000);
    const morto = atual();
    morto.mudarCalado("suspended");
    ContextoFalso.soComGesto = true;
    await passar(3_000);
    const sess = rel.criarSessaoDeDiagnostico({ diag: dg.diagAudio, sonda: () => m.sondaDeDiagnostico() });
    sess.registrarFalha();
    ContextoFalso.dentroDoGesto = true;
    let p: Promise<void>;
    try { p = sess.recuperar(); } finally { ContextoFalso.dentroDoGesto = false; }
    await passar(2_000);
    await p!;
    const o = sess.ocorrencias()[0]!;
    expect(o.recuperacao?.antes.contexto).toBe("suspended");
    expect(o.recuperacao?.depois?.contexto).toBe("running");
    expect(atual()).not.toBe(morto);
    const txt = sess.relatorio(AMB);
    expect(txt).toMatch(/H1 AudioContext suspenso\/interrompido: SIM/);
  });

  it("relatório com o motor de verdade: A, B, C, H1–H8, contagens — e nenhuma rede", async () => {
    const rede = vi.fn(() => { throw new Error("rede"); });
    vi.stubGlobal("fetch", rede);
    vi.stubGlobal("XMLHttpRequest", rede);
    ambiente({ tique: true });
    const m = ligado();
    await passar(12_000);
    const sess = rel.criarSessaoDeDiagnostico({ diag: dg.diagAudio, sonda: () => m.sondaDeDiagnostico() });
    sess.registrarFalha();
    const t = sess.testar("efeito");
    await passar(400);
    sess.responder(await t, false);
    const txt = sess.relatorio(AMB);
    for (const trecho of ["A. ESTADO CAPTURADO", "B. SONS DE TESTE", "C. DEPOIS", "== CONTAGENS", "== PULSOS", "== HISTÓRICO", "OUVIU: NÃO"]) {
      expect(txt, trecho).toContain(trecho);
    }
    for (const h of ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8"]) expect(txt, h).toContain(`  ${h} `);
    expect(rede).not.toHaveBeenCalled();
  });
});

describe("29. rodada 6 (04/11): A′ = tom direto no destino do contexto do jogo, sem mexer no motor", () => {
  type Motores = typeof import("./engine.js");
  let Motor: Motores["AudioEngine"];
  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.resetModules();
    vi.stubGlobal("__KING_DIAG_AUDIO__", true);
    ({ AudioEngine: Motor } = await import("./engine.js"));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("Oscillator → Gain → destination no contexto ATUAL: sem resume, sem contexto novo, sem barramento", async () => {
    const m = new Motor();
    m.set({ music: false, sfx: true });
    m.unlock();
    const c = atual();
    const proto = Object.getPrototypeOf(c.createGain()) as { connect: (d: unknown) => void };
    const ligou = vi.spyOn(proto, "connect");
    const osc = c.osciladores;
    const resumes = c.resumes;
    const p = m.sondaDeDiagnostico()!.tomDireto();
    await passar(400);
    const r = await p;
    expect(r).toMatchObject({ qual: "direto", tocou: true, motivo: null });
    expect(c.osciladores - osc).toBe(1);
    expect(ligou.mock.calls.filter(([d]) => d === c.destination), "o tom não foi direto ao destination").toHaveLength(1);
    expect(ligou).toHaveBeenCalledTimes(2);
    expect(c.resumes).toBe(resumes);
    expect(ContextoFalso.todos).toHaveLength(1);
  });

  it("sem contexto (antes do 1º toque): não cria contexto", async () => {
    const r = await new Motor().sondaDeDiagnostico()!.tomDireto();
    expect(r).toMatchObject({ tocou: false, motivo: "sem-contexto" });
    expect(ContextoFalso.todos).toHaveLength(0);
  });
});

describe("30. rodada 7 (04/11): isolar o grafo do KING e restaurar — sem perder nada, sem duplicar a música", () => {
  type Motores = typeof import("./engine.js");
  let Motor: Motores["AudioEngine"];
  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.resetModules();
    vi.stubGlobal("__KING_DIAG_AUDIO__", true);
    ({ AudioEngine: Motor } = await import("./engine.js"));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("parar música não mexe nas preferências; isolar tira as 2 ligações do master; restaurar religa as 2 e a música volta UMA vez", async () => {
    const m = new Motor();
    m.set({ music: true, sfx: true });
    m.unlock();
    await passar(2_500);
    const c = atual();
    const s = m.sondaDeDiagnostico()!;
    expect(agendadores.size).toBe(1);
    expect(s.pararMusica()).toBe(true);
    expect(agendadores.size).toBe(0);
    expect(m.get().music, "parar a música do teste não grava preferência").toBe(true);
    const antes = c.ligacoes;
    const proto = Object.getPrototypeOf(c.createGain()) as { connect: (d: unknown) => void; disconnect: (d?: unknown) => void };
    const liga = vi.spyOn(proto, "connect");
    const desliga = vi.spyOn(proto, "disconnect");
    expect(s.isolarGrafo()).toBe(true);
    expect(desliga.mock.calls, "o master sai de TUDO (destination e analisador, que puxa o grafo sozinho)").toEqual([[]]);
    const master = desliga.mock.instances[0];
    expect(c.ligacoes, "master → destination e master → analisador").toBe(antes - 2);
    expect(s.isolarGrafo(), "isolar duas vezes não mexe de novo").toBe(false);
    liga.mockClear();
    expect(s.restaurar()).toEqual({ religou: true, musica: true });
    const doMaster = liga.mock.calls.filter((_, i) => liga.mock.instances[i] === master).map(([d]) => d);
    expect(doMaster, "religou o master na saída e no analisador").toHaveLength(2);
    expect(doMaster[0]).toBe(c.destination);
    expect((doMaster[1] as { fftSize?: number }).fftSize, "a 2ª ligação é o analisador").toBeDefined();
    expect(agendadores.size, "a música voltou uma vez só").toBe(1);
    const depois = c.ligacoes;
    expect(s.restaurar(), "restaurar de novo não religa nada").toEqual({ religou: false, musica: true });
    expect(c.ligacoes).toBe(depois);
    expect(agendadores.size).toBe(1);
    expect(ContextoFalso.todos).toHaveLength(1);
  });

  it("trocou de contexto com o grafo isolado: restaurar NÃO mexe no contexto novo (nem liga nó de outro contexto)", async () => {
    const m = new Motor();
    m.set({ music: false, sfx: true });
    m.unlock();
    await passar(3_000);
    const s = m.sondaDeDiagnostico()!;
    expect(s.isolarGrafo()).toBe(true);
    ContextoFalso.dentroDoGesto = true;
    try { m.religar(); } finally { ContextoFalso.dentroDoGesto = false; }
    const novo = atual();
    const lig = novo.ligacoes;
    expect(() => s.restaurar()).not.toThrow();
    expect(novo.ligacoes).toBe(lig);
    expect(s.contextoParaMedir()).toBe(novo);
  });

  it("no build normal a sonda não existe (nada disto chega ao jogador)", () => {
    expect(new AudioEngine().sondaDeDiagnostico()).toBeNull();
  });
});

// RODADA 8 (04/11/2026) — o grafo do KING não cabia no tempo real do Android (r7: contexto do KING 0,47 do
// tempo real com 1.040 underruns em 60 s; a escada caiu no reverb estéreo de 2,4 s e piorou com a música).
// Correção SÓ no Android (perfil "leve-24k"): reverb mono com o começo (1,2 s) do MESMO envelope, molhado
// compensado, envios ao reverb compartilhados (mesma soma, menos nós) e contexto a 24 kHz (metade do
// processamento; acima de 12 kHz o som do KING tem −55 dB da energia). iPhone e computador: o grafo de sempre.
describe("31. rodada 8: perfil leve do grafo no Android — e o de sempre no iPhone e no computador", () => {
  type Etiqueta = { canais: number; len: number; getChannelData: () => Float32Array };
  /** Grava o que o motor cria: buffers (canais × amostras), ganhos, convolvers e com que opção o contexto nasce. */
  function espionar() {
    const buffers: Etiqueta[] = [];
    const ganhos: NoFalso[] = [];
    const convolvers: NoFalso[] = [];
    const opcoes: unknown[][] = [];
    const proto = ContextoFalso.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    vi.spyOn(proto, "createBuffer").mockImplementation(function (this: ContextoFalso, ...a: unknown[]) {
      const [canais, len] = a as [number, number];
      const b: Etiqueta = { canais, len, getChannelData: () => new Float32Array(Math.max(0, len | 0)) };
      buffers.push(b);
      return b;
    });
    const criarGanho = proto.createGain;
    vi.spyOn(proto, "createGain").mockImplementation(function (this: ContextoFalso) {
      const g = criarGanho.call(this) as NoFalso;
      ganhos.push(g);
      return g;
    });
    const criarConv = proto.createConvolver;
    vi.spyOn(proto, "createConvolver").mockImplementation(function (this: ContextoFalso) {
      const c = criarConv.call(this) as NoFalso;
      convolvers.push(c);
      return c;
    });
    win.AudioContext = class extends ContextoFalso {
      constructor(...a: unknown[]) { super(); opcoes.push(a); }
    };
    return { buffers, ganhos, convolvers, opcoes };
  }
  afterEach(() => { vi.restoreAllMocks(); });

  for (const plat of ["android", "ios", "desktop"] as const) {
    it(`${plat}: o reverb ${plat === "android" ? "LEVE (mono, 1,2 s do mesmo envelope, molhado compensado) num contexto a 24 kHz" : "de SEMPRE (estéreo, 2,4 s, molhado 0,9) e o contexto sem opção nenhuma"}`, () => {
      ambiente(plat === "ios" ? { ios: true } : plat === "desktop" ? { desktop: true } : {});
      const e = espionar();
      motor({ music: false, sfx: true });
      const c = atual();
      expect(e.opcoes, plat === "android" ? "Android: 24 kHz" : "new AudioContext() sem argumento nenhum, como sempre").toEqual(plat === "android" ? [[{ sampleRate: 24000 }]] : [[]]);
      expect(e.convolvers).toHaveLength(1);
      const imp = e.convolvers[0]!.buffer as Etiqueta;
      const molhado = e.ganhos.map((g) => g.gain.value);
      if (plat === "android") {
        expect([imp.canais, imp.len], "impulso mono de 1,2 s").toEqual([1, Math.floor(c.sampleRate * 1.2)]);
        expect(molhado.some((v) => Math.abs(v - 0.9 * compensacaoDoReverbLeve(c.sampleRate)) < 1e-9), "molhado compensado").toBe(true);
        expect(molhado.filter((v) => v === 0.9), "0,9 só no master (o molhado é o compensado)").toHaveLength(1);
      } else {
        expect([imp.canais, imp.len], "impulso estéreo de 2,4 s, como sempre").toEqual([2, Math.floor(c.sampleRate * 2.4)]);
        expect(molhado.filter((v) => v === 0.9), "master 0,9 e molhado 0,9, como sempre").toHaveLength(2);
      }
    });
  }

  it("android: os envios ao reverb são COMPARTILHADOS — 1 nó por quantidade, sem timer de 3 s, e nada sobra ligado depois das notas", async () => {
    ambiente();
    const e = espionar();
    const m = motor({ music: false, sfx: true });
    const c = atual();
    await passar(100);
    const ganhosAntes = e.ganhos.length;
    const timersAntes = vi.getTimerCount();
    const ligAntes = c.ligacoes;
    for (let i = 0; i < 10; i++) m.tone({ freq: 440 + i, dur: 0.1 });
    expect(e.ganhos.length - ganhosAntes, "10 vozes + 1 envio de 0,18 (e não 10 vozes + 10 envios)").toBe(11);
    expect(vi.getTimerCount() - timersAntes, "só o fim de cada nota (nenhum desliga-envio de 3 s)").toBe(10);
    await passar(1_000);
    expect(c.ligacoes - ligAntes, "acabadas as notas, só o envio compartilhado → reverb fica de pé").toBe(1);
    for (let i = 0; i < 5; i++) m.tone({ freq: 500, dur: 0.1, space: 0.18 });
    expect(e.ganhos.length - ganhosAntes, "a mesma quantidade reaproveita o mesmo envio").toBe(16);
  });

  it("iPhone: um envio por nota, desligado 3 s depois — como sempre (nada muda onde o som foi validado)", async () => {
    ambiente({ ios: true });
    const e = espionar();
    const m = motor({ music: false, sfx: true });
    const c = atual();
    await passar(100);
    const ganhosAntes = e.ganhos.length;
    const ligAntes = c.ligacoes;
    for (let i = 0; i < 10; i++) m.tone({ freq: 440 + i, dur: 0.1 });
    expect(e.ganhos.length - ganhosAntes).toBe(20);
    await passar(4_000);
    expect(c.ligacoes - ligAntes, "depois dos 3 s, nada ligado").toBe(0);
  });

  it("android: o aparelho RECUSA a taxa de 24 kHz → o contexto nasce como sempre (sem opção) e o som funciona", async () => {
    ambiente();
    const tentativas: unknown[][] = [];
    win.AudioContext = class extends ContextoFalso {
      constructor(...a: unknown[]) {
        tentativas.push(a);
        if (a.length) throw new Error("NotSupportedError: taxa não suportada");
        super();
      }
    };
    const m = motor({ music: true, sfx: true });
    expect(tentativas, "tentou 24 kHz e caiu no de sempre").toEqual([[{ sampleRate: 24000 }], []]);
    expect(ContextoFalso.todos).toHaveLength(1);
    await funciona(m, { music: true, sfx: true }, "taxa recusada");
  });

  it("a música do Android é a MESMA: 22 osciladores e 8 ganzás no 1º compasso, como no iPhone", () => {
    for (const o of [{}, { ios: true }]) {
      ambiente(o);
      motor({ music: true, sfx: true });
      const c = atual();
      expect([c.osciladores, c.fontes], JSON.stringify(o)).toEqual([22, 8]);
    }
  });
});

describe("32. rodada 8 (APK DEBUG): variantes A–E trocam o contexto pelo caminho de sempre, um de cada vez", () => {
  type Motores = typeof import("./engine.js");
  let Motor: Motores["AudioEngine"];
  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.resetModules();
    vi.stubGlobal("__KING_DIAG_AUDIO__", true);
    ({ AudioEngine: Motor } = await import("./engine.js"));
  });
  afterEach(() => { vi.restoreAllMocks(); });
  const dentroDoToque = <T>(f: () => T): T => {
    ContextoFalso.dentroDoGesto = true;
    try { return f(); } finally { ContextoFalso.dentroDoGesto = false; }
  };

  it("A → B → C → D → E → automático: cada troca = 1 contexto novo (o velho fechado), a música nunca duplica, e cada um com o seu peso", async () => {
    ambiente();
    const opcoes: unknown[][] = [];
    const convPorCtx = new Map<ContextoFalso, number>();
    const proto = ContextoFalso.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const criarConv = proto.createConvolver;
    vi.spyOn(proto, "createConvolver").mockImplementation(function (this: ContextoFalso) {
      convPorCtx.set(this, (convPorCtx.get(this) ?? 0) + 1);
      return criarConv.call(this);
    });
    win.AudioContext = class extends ContextoFalso { constructor(...a: unknown[]) { super(); opcoes.push(a); } };
    const m = new Motor();
    m.set({ music: true, sfx: true });
    m.unlock();
    await passar(2_500);
    const s = m.sondaDeDiagnostico()!;
    expect(s.perfil()).toEqual({ nome: "leve-24k", forcado: false });
    const esperado: [Parameters<typeof s.usarPerfil>[0], string, number, number, number][] = [
      // perfil, nome, convolvers, osciladores no 1º compasso, ganzás
      ["original", "original", 1, 22, 8],
      ["sem-reverb", "sem-reverb", 0, 22, 8],
      ["leve", "leve", 1, 22, 8],
      ["leve-polifonia", "leve-polifonia", 1, 17, 4],
      ["leve-24k", "leve-24k", 1, 22, 8],
      [null, "leve-24k", 1, 22, 8],
    ];
    for (const [pedido, nome, conv, osc, ganza] of esperado) {
      const antes = ContextoFalso.todos.length;
      const velho = atual();
      expect(dentroDoToque(() => s.usarPerfil(pedido)), String(pedido)).toBe(true);
      const novo = atual();
      expect(ContextoFalso.todos.length - antes, `${pedido}: um contexto novo`).toBe(1);
      expect(s.perfil(), String(pedido)).toEqual({ nome, forcado: pedido !== null });
      expect(convPorCtx.get(novo) ?? 0, `${pedido}: convolvers`).toBe(conv);
      expect([novo.osciladores, novo.fontes], `${pedido}: vozes do 1º compasso`).toEqual([osc, ganza]);
      expect(agendadores.size, `${pedido}: um agendador de música só`).toBe(1);
      await passar(1_000);
      expect(velho.state, `${pedido}: o velho foi fechado`).toBe("closed");
      expect(ContextoFalso.todos.filter((c) => c.state !== "closed"), "um contexto vivo de cada vez").toHaveLength(1);
    }
    expect(opcoes[opcoes.length - 2], "a variante E pede 24 kHz").toEqual([{ sampleRate: 24000 }]);
    expect(opcoes.map((o) => (o.length ? "24k" : "-")), "24 kHz: o padrão do Android (início e volta ao automático) e a E").toEqual(["24k", "-", "-", "-", "-", "24k", "24k"]);
  });

  it("variante B (sem reverb): nenhum convolver E nenhum envio — ganho zero não bastaria", async () => {
    ambiente();
    const m = new Motor();
    m.set({ music: false, sfx: true });
    m.unlock();
    await passar(500);
    const s = m.sondaDeDiagnostico()!;
    dentroDoToque(() => s.usarPerfil("sem-reverb"));
    const criados = vi.spyOn(ContextoFalso.prototype, "createGain");
    for (let i = 0; i < 5; i++) m.tone({ freq: 440, dur: 0.1 });
    expect(criados, "só a voz de cada nota").toHaveBeenCalledTimes(5);
  });

  it("escondido (fundo) ou sem contexto: não troca nada — só guarda o pedido", async () => {
    ambiente();
    const m = new Motor();
    const s = m.sondaDeDiagnostico()!;
    expect(s.usarPerfil("original"), "sem contexto").toBe(false);
    expect(ContextoFalso.todos).toHaveLength(0);
    m.set({ music: true, sfx: true });
    m.unlock();
    await passar(2_500);
    expect(s.perfil(), "o pedido guardado vale no próximo contexto").toEqual({ nome: "original", forcado: true });
    esconder();
    await passar(500);
    const n = ContextoFalso.todos.length;
    expect(dentroDoToque(() => s.usarPerfil("leve"))).toBe(false);
    expect(ContextoFalso.todos.length).toBe(n);
  });

  it("o monitor contínuo nasce com o 1º contexto e segue o contexto atual (janela da troca descartada)", async () => {
    ambiente();
    const m = new Motor();
    m.set({ music: false, sfx: true });
    m.unlock();
    const s = m.sondaDeDiagnostico()!;
    const mon = s.monitor()!;
    expect(mon).not.toBeNull();
    await passar(10_500);
    const j1 = mon.janelas();
    expect(j1.length).toBe(2);
    expect(j1.every((j) => j.perfil === "leve-24k" && j.razao !== null && j.razao > 0.9 && !j.contextoNovo)).toBe(true);
    dentroDoToque(() => s.usarPerfil("original"));
    await passar(10_000);
    const j2 = mon.janelas().slice(2);
    expect(j2[0]!.contextoNovo, "a janela da troca não vale").toBe(true);
    expect(j2[0]!.razao).toBeNull();
    expect(j2[1]!.perfil).toBe("original");
    expect(j2[1]!.razao).not.toBeNull();
  });
});
