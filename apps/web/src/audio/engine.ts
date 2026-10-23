// Engine de áudio PROCEDURAL do KING (Web Audio, zero assets) — herdada do Verbete e adaptada.
//
// Cadeia de sinal:
//   [efeitos] ──┬─────────────────────────────► sfxBus ──┐
//               └─ send ─► convolver (reverb) ─────────┐ │
//   [música]  ──┬─────────────────────────────► musBus ─┼─┼─► compressor ─► master ─► saída
//               └─ send ─► convolver (reverb) ─────────┘ │
//
// O reverb e o compressor são o que separa "bipe de brinquedo" de som de produto: dão espaço
// (a mesa passa a ter ambiente) e colam os picos (nada estoura quando dois eventos coincidem).
// Nada aqui conhece regra de KING — os sons semânticos ficam em sounds.ts.

export interface AudioPrefs {
  music: boolean;
  sfx: boolean;
  haptics: boolean;
  /** 0..1 — controle fino, independente do liga/desliga. */
  musicVol: number;
  sfxVol: number;
}

const STORAGE_KEY = "king.audio";
const DEFAULTS: AudioPrefs = { music: true, sfx: true, haptics: true, musicVol: 0.5, sfxVol: 0.8 };

/** Teto do barramento de música (multiplicado por `musicVol`). */
const MUSIC_BASE = 0.34;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function loadPrefs(): AudioPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const p = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AudioPrefs>) };
    return { ...p, musicVol: clamp01(p.musicVol), sfxVol: clamp01(p.sfxVol) };
  } catch {
    return { ...DEFAULTS };
  }
}

export interface ToneOpts {
  freq: number;
  /** Frequência final (glissando). */
  to?: number;
  dur?: number;
  gain?: number;
  wave?: OscillatorType;
  /** Atraso em segundos a partir de agora. */
  delay?: number;
  attack?: number;
  /** Fração de `dur` em que o som se sustenta antes de decair (0..1). */
  sustain?: number;
  /** Corte do filtro passa-baixa; ausente = sem filtro. */
  cutoff?: number;
  /** Desafinação em cents. */
  detune?: number;
  /** Quanto vai para o reverb (0..1). */
  space?: number;
}

export interface NoiseOpts {
  dur?: number;
  gain?: number;
  /** Passa-banda: centro e Q. */
  freq?: number;
  q?: number;
  delay?: number;
  /** Varredura do centro do filtro até esta frequência. */
  to?: number;
  space?: number;
}

/** Estados do contexto. "interrupted" é do Safari/iOS e não está em toda tipagem do TypeScript. */
type EstadoDoContexto = AudioContextState | "interrupted";

/** iPhone/iPad (o iPad se apresenta como Mac com toque). Todo navegador lá é WebKit. */
const ehIOS = () => typeof navigator !== "undefined"
  && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

const visivel = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/** Gesto que de fato libera áudio (sem a API, confia no evento). */
const ativacaoReal = () => {
  const a = typeof navigator !== "undefined"
    ? (navigator as { userActivation?: { isActive: boolean } }).userActivation
    : undefined;
  return !a || a.isActive;
};

/** Fases do ciclo de vida do áudio — a máquina de estados inteira. */
export type FaseDoAudio =
  | "ocioso" // ainda sem contexto: só um gesto real cria (o 1º unlock)
  | "ativo" // contexto em uso, com o relógio andando
  | "fundo" // página escondida: música parada, nada em voo
  | "recuperando" // voltou: assentando, retomando ou medindo o relógio
  | "esperando-gesto" // a volta sozinha não bastou: o próximo gesto real resolve
  | "reconstruindo"; // dentro de um gesto: trocando por um contexto novo

/** Tudo o que pertence a UM contexto — trocado de uma vez só. */
interface Grafo {
  ctx: AudioContext;
  master: GainNode;
  reverbIn: GainNode;
  musicBus: GainNode;
  sfxBus: GainNode;
  noiseBuf: AudioBuffer;
}

interface OpcoesDaRecuperacao {
  /** Volta do fundo: espera o navegador assentar antes de mexer. */
  assentar?: boolean;
  /** Começou dentro de um gesto real: se nem assim o contexto partir, conta como falha. */
  porGesto?: boolean;
  /** Janelas de medição do relógio (contexto recém-criado ganha mais). */
  janelas?: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private reverbIn: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private prefs: AudioPrefs = loadPrefs();
  private listeners = new Set<(p: AudioPrefs) => void>();

  // ---- preferências ----
  get(): AudioPrefs {
    return { ...this.prefs };
  }

  set(patch: Partial<AudioPrefs>): void {
    const next = { ...this.prefs, ...patch };
    next.musicVol = clamp01(next.musicVol);
    next.sfxVol = clamp01(next.sfxVol);
    this.prefs = next;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      /* modo privado: as preferências valem só nesta sessão */
    }
    this.applyLevels();
    if (this.prefs.music) this.startMusic();
    else this.stopMusic();
    for (const l of this.listeners) l(this.get());
  }

  subscribe(fn: (p: AudioPrefs) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private get musicTarget(): number {
    return this.prefs.music ? MUSIC_BASE * this.prefs.musicVol : 0;
  }

  private applyLevels(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus?.gain.setTargetAtTime(this.musicTarget, t, 0.12);
    this.sfxBus?.gain.setTargetAtTime(this.prefs.sfx ? this.prefs.sfxVol : 0, t, 0.05);
  }

  // ---- ciclo de vida ----
  /** Cria/retoma o contexto. PRECISA rodar dentro de um gesto real — exigência do iOS. */
  unlock(): void {
    let ctx = this.ctx;
    if (!ctx) {
      let g: Grafo | null;
      try {
        g = this.montarGrafo();
      } catch {
        g = null; // o aparelho não deu contexto: segue mudo, sem derrubar quem chamou (Iniciar, painel)
      }
      if (!g) return; // sem Web Audio: o jogo segue mudo, sem quebrar
      this.assumir(g);
      this.fase = "ativo";
      this.instalarCicloDeVida();
      ctx = g.ctx;
    }
    const estado = ctx.state as EstadoDoContexto;
    if (estado === "suspended" || estado === "interrupted") void ctx.resume().catch(() => {});
    if (this.prefs.music) this.startMusic();
    // Ainda parado (contexto que acabou de nascer, ou unlock chamado fora de um gesto): confere, e
    // se não partir sozinho o próximo gesto real retoma — a música nasce quando o relógio andar.
    if ((ctx.state as EstadoDoContexto) !== "running" && this.fase === "ativo" && !this.recuperacao) {
      void this.iniciarRecuperacao({});
    }
  }

  /**
   * O grafo inteiro de UM contexto — o mesmo de sempre (timbre, volumes e mix não mudam). Serve ao
   * 1º unlock e à reconstrução, e não mexe no motor: quem troca é o `assumir`, de uma vez.
   */
  private montarGrafo(): Grafo | null {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    try {
      const noiseBuf = this.makeNoise(ctx, 1.2);

      const master = ctx.createGain();
      master.gain.value = 0.9;

      // Limitador suave: impede que King capturado + música + carta jogada estourem juntos.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -15;
      comp.knee.value = 26;
      comp.ratio.value = 3.2;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
      comp.connect(master);
      master.connect(ctx.destination);

      // Reverb por convolução com resposta impulsiva gerada na hora (nenhum arquivo).
      const conv = ctx.createConvolver();
      conv.buffer = this.makeImpulse(ctx, 2.4, 2.6);
      const wet = ctx.createGain();
      wet.gain.value = 0.9;
      const damp = ctx.createBiquadFilter(); // corta o brilho do rabo do reverb
      damp.type = "lowpass";
      damp.frequency.value = 3200;
      const reverbIn = ctx.createGain();
      reverbIn.gain.value = 1;
      reverbIn.connect(conv);
      conv.connect(damp);
      damp.connect(wet);
      wet.connect(comp);

      const musicBus = ctx.createGain();
      musicBus.gain.value = this.musicTarget;
      musicBus.connect(comp);

      const sfxBus = ctx.createGain();
      sfxBus.gain.value = this.prefs.sfx ? this.prefs.sfxVol : 0;
      sfxBus.connect(comp);
      return { ctx, master, reverbIn, musicBus, sfxBus, noiseBuf };
    } catch {
      // nasceu, mas o grafo quebrou no meio: fecha (melhor esforço) e avisa quem tentou a troca
      void ctx.close().catch(() => {});
      this.grafoQuebrou = true;
      return null;
    }
  }

  /** Troca ATÔMICA: o motor inteiro passa a apontar para o grafo novo numa tacada só. */
  private assumir(g: Grafo): void {
    this.ctx = g.ctx;
    this.master = g.master;
    this.reverbIn = g.reverbIn;
    this.musicBus = g.musicBus;
    this.sfxBus = g.sfxBus;
    this.noiseBuf = g.noiseBuf;
    this.ultimoEstado = g.ctx.state as EstadoDoContexto;
    this.zumbi = false;
    this.naoConfiavel = false;
    this.relogio = null;
    this.vereditoZumbi = null;
    this.falhasDoGesto = 0;
    this.fimDoCompasso = 0;
    const ctx = g.ctx;
    ctx.onstatechange = () => this.aoMudarEstado(ctx);
  }

  private grafoAtual(): Grafo | null {
    const { ctx, master, reverbIn, musicBus, sfxBus, noiseBuf } = this;
    return ctx && master && reverbIn && musicBus && sfxBus && noiseBuf
      ? { ctx, master, reverbIn, musicBus, sfxBus, noiseBuf }
      : null;
  }

  // ---- segundo plano e volta: a máquina de estados ----
  // V1 (22/10/2026): com o som tocando, ir ao WhatsApp e voltar deixava o KING mudo — o `unlock` não
  // retomava "interrupted", ninguém ouvia a volta e o agendador seguia marcado como ativo.
  // V2 (23/10/2026, aparelho real): a V1 recuperava a 1ª volta e emudecia na 2ª. Ela confiava em
  // `state === "running"`, e o WebKit tem contexto que volta "running" com o relógio parado (zumbi),
  // `resume()` que nunca responde e saída muda depois de interrupção — e o "chute" suspend→resume
  // mexia sempre no MESMO contexto. Agora cada ida ao fundo abre uma GERAÇÃO nova (o que estava em
  // voo fica velho e não toca em mais nada); a volta assenta, retoma com prazo e MEDE o relógio; se o
  // contexto não presta, o próximo gesto real cria um NOVO — o mesmo caminho do 1º unlock, o único
  // provado no aparelho. Nunca cria contexto sem gesto, nunca grava preferência.
  private fase: FaseDoAudio = "ocioso";
  /** Sobe a cada ida ao fundo e a cada reconstrução: o que é de geração velha não mexe em nada. */
  private geracao = 0;
  /** Geração cuja volta já começou: visibilitychange + pageshow da mesma volta = UMA recuperação. */
  private voltaTratada = 0;
  private recuperacao: Promise<void> | null = null;
  /** Esperas em curso (assentar, prazo do resume, janelas da medição): canceláveis, nunca penduram. */
  private esperas = new Set<() => void>();
  private aoGesto: (() => void) | null = null;
  private cicloInstalado = false;
  private ultimoEstado: EstadoDoContexto = "suspended";
  /** O relógio não andou com a página visível: só um contexto novo resolve. */
  private zumbi = false;
  /** Onde o relógio estava no veredito de zumbi: se ele andar depois, o contexto só demorou a partir. */
  private vereditoZumbi: number | null = null;
  /** Retomadas DENTRO de gesto que não chegaram a "running": duas condenam o contexto (vale entre voltas). */
  private falhasDoGesto = 0;
  /** A última troca falhou há pouco (o click que segue o touchend não tenta de novo). */
  private trocaFalhouEm = -Infinity;
  /** Um contexto novo nasceu e o grafo quebrou no meio: não insiste até a próxima volta (não vaza contextos). */
  private trocaBloqueada = false;
  private grafoQuebrou = false;
  /**
   * iOS: o jogo foi ao fundo (ou o WebKit tirou o áudio). O JS não tem como saber se a saída física
   * voltou — o WebKit pode seguir "running", com relógio andando, e mudo. Então a música volta
   * sozinha se o relógio andar, e o 1º gesto real troca o contexto por um novo.
   */
  private naoConfiavel = false;
  /** Medição começada na volta com o contexto "running": o gesto pode julgá-la antes de ela acabar. */
  private relogio: { ctx: number; real: number } | null = null;
  /** Fim (no relógio do contexto) do último compasso agendado, e a espera para recomeçar depois dele. */
  private fimDoCompasso = 0;
  private musicaAgendada: ReturnType<typeof setTimeout> | null = null;
  /** Início do último compasso agendado: com o relógio parado, ele nunca começa — e nenhum outro empilha. */
  private inicioDoCompasso = -Infinity;

  /** O iOS reativa a sessão de áudio um instante DEPOIS de a página voltar — e avisos repetidos se juntam. */
  private static readonly ASSENTAR_MS = 300;
  private static readonly PRAZO_DO_RESUME_MS = 1500;
  /** Medição: até 6 janelas de 250 ms, e andar 50 ms basta — folga para a saída demorar a partir. */
  private static readonly JANELA_MS = 250;
  private static readonly JANELAS = 6;
  /** Contexto recém-criado pode demorar a partir (sessão de áudio do iOS): 3 s de folga. */
  private static readonly JANELAS_DO_NOVO = 12;
  private static readonly AVANCO_MINIMO = 0.05;
  /** Relógio "running" parado há tanto tempo, com a página visível, já condena no gesto (Bluetooth reabre devagar). */
  private static readonly GESTO_CONDENA_MS = 1000;
  private static readonly FALHAS_QUE_CONDENAM = 2;
  /** Gestos que de fato liberam áudio: `pointerdown`/`touchstart` de toque não contam (o iOS libera no `touchend`). */
  private static readonly GESTOS = ["touchend", "click", "keydown"] as const;

  /** UMA vez, quando o contexto nasce: antes dele não há o que recuperar. */
  private instalarCicloDeVida(): void {
    if (this.cicloInstalado || typeof document === "undefined" || typeof window === "undefined") return;
    this.cicloInstalado = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.aoIrParaSegundoPlano();
      else void this.aoVoltarParaPrimeiroPlano();
    });
    // Volta pelo cache de página (voltar/avançar do navegador): o `visibilitychange` pode não vir.
    window.addEventListener("pageshow", (e) => {
      if ((e as PageTransitionEvent).persisted) void this.aoVoltarParaPrimeiroPlano();
    });
  }

  /**
   * Escondido: geração nova, tudo o que estava em voo cancelado, música parada. Não fecha nem
   * suspende o contexto (o navegador cuida da interrupção) e não toca nas preferências.
   */
  aoIrParaSegundoPlano(): void {
    if (!this.ctx) return;
    this.geracao++;
    this.cancelarEsperas();
    this.recuperacao = null;
    this.desarmarGesto();
    this.stopMusic();
    this.relogio = null;
    this.zumbi = false; // a próxima volta mede de novo
    this.vereditoZumbi = null;
    this.trocaBloqueada = false;
    if (ehIOS()) this.naoConfiavel = true; // ida ao fundo no iPhone = interrupção real
    this.fase = "fundo";
  }

  /** Visível de novo (ou de volta do cache de página): UMA recuperação por volta. Nunca cria contexto. */
  aoVoltarParaPrimeiroPlano(): Promise<void> {
    if (!this.ctx || !visivel()) return Promise.resolve();
    if (this.voltaTratada === this.geracao) return this.recuperacao ?? Promise.resolve();
    this.voltaTratada = this.geracao;
    return this.iniciarRecuperacao({ assentar: true });
  }

  private iniciarRecuperacao(o: OpcoesDaRecuperacao): Promise<void> {
    this.fase = "recuperando";
    this.armarGesto(); // o 1º toque depois de voltar já pode resolver, mesmo com a medição em curso
    const p: Promise<void> = this.recuperar(this.geracao, o).finally(() => {
      if (this.recuperacao === p) this.recuperacao = null;
    });
    this.recuperacao = p;
    return p;
  }

  /** Assenta → recuperação leve (resume com prazo) → mede o relógio → decide. Geração velha sai sem mexer. */
  private async recuperar(g: number, o: OpcoesDaRecuperacao): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const vivo = () => g === this.geracao && ctx === this.ctx;
    const estado = () => ctx.state as EstadoDoContexto;
    // "running" já na volta: a medição começa agora, e o gesto pode usá-la antes de ela terminar
    let ref = estado() === "running" ? { ctx: ctx.currentTime, real: Date.now() } : null;
    if (o.assentar) this.relogio = ref;
    if (o.assentar && !(await this.dormir(AudioEngine.ASSENTAR_MS))) return;
    if (!vivo()) return;
    if (estado() === "closed") return this.esperarGesto();
    if (estado() !== "running") {
      this.relogio = null;
      ref = null; // o relógio estava parado até aqui: a medição começa depois de retomar
      try {
        // sem permissão, o resume pode nunca responder (a especificação permite): espera com prazo
        await Promise.race([ctx.resume(), this.dormir(AudioEngine.PRAZO_DO_RESUME_MS)]);
      } catch { /* recusado sem gesto: o próximo gesto resolve */ }
      if (!vivo()) return;
      if (estado() !== "running") {
        // nem com gesto: na 2ª vez seguida o contexto fica condenado e o próximo gesto troca por um novo
        if (o.porGesto) this.falhasDoGesto++;
        return this.esperarGesto();
      }
    }
    const saude = await this.medirSaude(ctx, g, ref, o.janelas ?? AudioEngine.JANELAS);
    if (saude === "abortada" || !vivo()) return;
    this.relogio = null;
    if (saude !== "saudavel" || estado() !== "running") {
      // zumbi: "running" com o relógio parado — só um contexto novo resolve. Parado: o navegador tirou
      // o áudio no meio da medição — o próximo gesto retoma, ou ele devolve sozinho. Nos dois, sem música.
      this.stopMusic();
      if (saude === "zumbi") {
        this.zumbi = true;
        this.vereditoZumbi = ctx.currentTime;
      }
      return this.esperarGesto();
    }
    this.falhasDoGesto = 0;
    this.applyLevels();
    if (this.prefs.music) this.recomecarMusicaDepoisDoCompasso();
    if (this.naoConfiavel) return this.esperarGesto(); // já tocando; o 1º gesto real troca o contexto
    this.fase = "ativo";
    this.desarmarGesto();
  }

  /**
   * "running" não prova nada no WebKit: o relógio TEM de andar com a página visível. Limite do
   * método: relógio andando não prova saída física — por isso o iPhone ainda troca no 1º gesto.
   * Estado que sai de "running" no meio é "parado" (o navegador tirou o áudio), não zumbi.
   */
  private async medirSaude(
    ctx: AudioContext,
    g: number,
    ref: { ctx: number; real: number } | null,
    janelas: number,
  ): Promise<"saudavel" | "zumbi" | "parado" | "abortada"> {
    const r = ref ?? { ctx: ctx.currentTime, real: Date.now() };
    for (let i = 0; ; i++) {
      if ((ctx.state as EstadoDoContexto) !== "running") return "parado";
      if (ctx.currentTime - r.ctx >= AudioEngine.AVANCO_MINIMO) return "saudavel";
      if (i === janelas) return "zumbi";
      if (!(await this.dormir(AudioEngine.JANELA_MS)) || g !== this.geracao || ctx !== this.ctx) return "abortada";
    }
  }

  private esperarGesto(): void {
    this.fase = "esperando-gesto";
    this.armarGesto();
  }

  /** Espera cancelável: termina `true` no prazo, ou `false` na hora se o ciclo acabar. Nunca pendura. */
  private dormir(ms: number): Promise<boolean> {
    return new Promise((ok) => {
      let id: ReturnType<typeof setTimeout> | undefined;
      const cancelar = () => {
        clearTimeout(id);
        this.esperas.delete(cancelar);
        ok(false);
      };
      id = setTimeout(() => {
        this.esperas.delete(cancelar);
        ok(true);
      }, ms);
      this.esperas.add(cancelar);
    });
  }

  private cancelarEsperas(): void {
    for (const cancelar of [...this.esperas]) cancelar();
  }

  /**
   * O compasso que estava tocando quando o navegador congelou o relógio termina sozinho na volta;
   * recomeçar na hora sobrepunha dois acordes por ~1,4 s. Espera ele acabar (nenhum som muda).
   */
  private recomecarMusicaDepoisDoCompasso(): void {
    if (this.musicTimer !== null || this.musicaAgendada !== null || !this.ctx) return;
    const resta = this.fimDoCompasso - this.ctx.currentTime;
    if (resta <= 0.05) { this.startMusic(); return; }
    this.musicaAgendada = setTimeout(() => {
      this.musicaAgendada = null;
      this.startMusic();
    }, resta * 1000);
  }

  /** O próximo gesto real decide. Um ouvinte só (touchend, click e keydown), removido quando o ciclo fecha. */
  private armarGesto(): void {
    if (this.aoGesto || typeof window === "undefined") return;
    const aoGesto = () => this.aoGestoReal();
    this.aoGesto = aoGesto;
    for (const ev of AudioEngine.GESTOS) window.addEventListener(ev, aoGesto, { capture: true, passive: true });
  }

  private desarmarGesto(): void {
    if (!this.aoGesto || typeof window === "undefined") return;
    for (const ev of AudioEngine.GESTOS) window.removeEventListener(ev, this.aoGesto, true);
    this.aoGesto = null;
  }

  /**
   * Dentro do gesto, e SÍNCRONO: um `await` aqui gastaria a ativação que o iOS exige. Contexto que
   * não presta é trocado; contexto só suspenso (o autoplay recusou sem gesto) é retomado, sem trocar.
   */
  private aoGestoReal(): void {
    const ctx = this.ctx;
    if (!ctx || this.fase === "reconstruindo" || !ativacaoReal()) return;
    // o "zumbi" voltou a andar (só demorou a partir): absolvido — confere de novo em vez de trocar
    if (this.zumbi && this.vereditoZumbi !== null && (ctx.state as EstadoDoContexto) === "running"
      && ctx.currentTime - this.vereditoZumbi >= AudioEngine.AVANCO_MINIMO) {
      this.zumbi = false;
      this.vereditoZumbi = null;
    }
    if (this.precisaReconstruir(ctx)) {
      // uma tentativa por toque (o click que segue o touchend não tenta de novo); grafo que quebrou
      // no meio não insiste até a próxima volta — cada tentativa pode deixar um contexto aberto
      if (this.trocaBloqueada || Date.now() - this.trocaFalhouEm < 1000) return;
      return this.reconstruir();
    }
    if ((ctx.state as EstadoDoContexto) !== "running") void ctx.resume().catch(() => {});
    if (!this.recuperacao) void this.iniciarRecuperacao({ porGesto: true }); // confere o relógio depois do gesto
  }

  private precisaReconstruir(ctx: AudioContext): boolean {
    if ((ctx.state as EstadoDoContexto) === "closed" || this.zumbi || this.naoConfiavel) return true;
    if (this.falhasDoGesto >= AudioEngine.FALHAS_QUE_CONDENAM) return true; // não parte nem com gesto
    // a medição ainda corre, mas o relógio "running" já está parado há meio segundo, página à vista
    const r = this.relogio;
    return r !== null && (ctx.state as EstadoDoContexto) === "running"
      && Date.now() - r.real >= AudioEngine.GESTO_CONDENA_MS
      && ctx.currentTime - r.ctx < AudioEngine.AVANCO_MINIMO;
  }

  /**
   * A troca, DENTRO do gesto: invalida o que estava em voo, cria contexto e grafo novos, retoma o
   * novo ainda no gesto e só então troca as referências — de uma vez. Nada de `await old.close()`
   * antes: isso gastaria a ativação. O velho sai depois, sem ninguém esperar por ele.
   */
  private reconstruir(): void {
    const velho = this.grafoAtual();
    this.fase = "reconstruindo";
    this.geracao++;
    this.voltaTratada = this.geracao;
    this.cancelarEsperas();
    this.recuperacao = null;
    this.desarmarGesto();
    this.stopMusic(); // o agendador e a espera do compasso eram do contexto velho
    this.grafoQuebrou = false;
    let novo: Grafo | null;
    try {
      novo = this.montarGrafo();
    } catch {
      novo = null;
    }
    if (!novo) {
      // o aparelho não deu outro contexto (limite), ou o grafo quebrou no meio: fica no atual, se ele
      // ainda puder servir; senão, o próximo gesto tenta de novo (o que quebrou no meio, só na próxima volta)
      this.trocaFalhouEm = Date.now();
      if (this.grafoQuebrou) this.trocaBloqueada = true;
      this.naoConfiavel = false;
      const atual = this.ctx;
      const serve = atual && !this.zumbi && this.falhasDoGesto < AudioEngine.FALHAS_QUE_CONDENAM
        && (atual.state as EstadoDoContexto) !== "closed";
      if (atual && serve) {
        void atual.resume().catch(() => {}); // ainda dentro do gesto
        void this.iniciarRecuperacao({ porGesto: true });
      } else {
        this.esperarGesto();
      }
      return;
    }
    void novo.ctx.resume().catch(() => {}); // ainda dentro do gesto
    this.assumir(novo);
    this.applyLevels();
    if (this.prefs.music) this.startMusic(); // só sai se o novo já estiver rodando; senão, a conferência liga
    if (velho) this.aposentar(velho);
    // confere o novo (com folga para partir devagar): se até ele nascer zumbi, o próximo gesto cria outro
    void this.iniciarRecuperacao({ janelas: AudioEngine.JANELAS_DO_NOVO });
  }

  /** O velho sai sem travar o novo: fade curto e close() de melhor esforço, com prazo — ninguém espera por ele. */
  private aposentar(v: Grafo): void {
    v.ctx.onstatechange = null; // aposentado não manda mais nada
    try {
      v.master.gain.setTargetAtTime(0, v.ctx.currentTime, 0.015);
    } catch { /* contexto zumbi: nada a desligar */ }
    setTimeout(() => {
      let fechar: Promise<void>;
      try {
        fechar = v.ctx.close();
      } catch {
        fechar = Promise.resolve();
      }
      void Promise.race([fechar, new Promise((ok) => setTimeout(ok, 1000))])
        .catch(() => {})
        .finally(() => {
          try { v.master.disconnect(); } catch { /* já fechado */ }
        });
    }, 80);
  }

  /** O navegador mudou o estado do contexto ATUAL (aposentado não conta). */
  private aoMudarEstado(ctx: AudioContext): void {
    if (ctx !== this.ctx) return;
    const antes = this.ultimoEstado;
    const agora = ctx.state as EstadoDoContexto;
    this.ultimoEstado = agora;
    if (antes === "running" && agora !== "running") {
      // tiraram o áudio (fundo, ligação, outro app); no iPhone, este contexto fica sob suspeita
      if (ehIOS()) this.naoConfiavel = true;
      if (this.fase !== "fundo" && visivel()) {
        this.stopMusic(); // relógio parado empilharia compassos — em QUALQUER fase
        if (this.fase === "ativo") this.esperarGesto();
      }
    } else if (agora === "running" && antes !== "running" && this.fase === "esperando-gesto"
      && visivel() && !this.recuperacao && !this.zumbi) {
      void this.iniciarRecuperacao({}); // devolveram sozinhos: confere o relógio, e a música volta
    }
  }

  /** Retrato do ciclo de vida (testes e diagnóstico). */
  estadoDoCiclo(): {
    fase: FaseDoAudio;
    geracao: number;
    gestoArmado: boolean;
    recuperando: boolean;
    musica: boolean;
    esperaDaMusica: boolean;
  } {
    return {
      fase: this.fase,
      geracao: this.geracao,
      gestoArmado: this.aoGesto !== null,
      recuperando: this.recuperacao !== null,
      musica: this.musicTimer !== null,
      esperaDaMusica: this.musicaAgendada !== null,
    };
  }

  /** Invariantes da máquina — vazio = coerente. Os testes conferem a cada ciclo. */
  invariantesVioladas(): string[] {
    const v: string[] = [];
    const gesto = this.aoGesto !== null;
    const recuperando = this.recuperacao !== null;
    const musica = this.musicTimer !== null || this.musicaAgendada !== null;
    if ((this.fase === "ocioso") !== (this.ctx === null)) v.push(`fase "${this.fase}" e contexto ${this.ctx ? "existente" : "ausente"}`);
    if (this.fase === "fundo" && (gesto || recuperando || musica)) v.push("no fundo com gesto, recuperação ou música viva");
    if (this.fase === "ativo" && (gesto || recuperando)) v.push("ativo com gesto armado ou recuperação pendente");
    if (this.fase === "esperando-gesto" && !gesto) v.push("esperando gesto sem ouvinte");
    if (this.fase === "recuperando" && !recuperando) v.push("recuperando sem recuperação em curso");
    if (this.fase === "reconstruindo") v.push("reconstrução não terminou");
    if (this.musicTimer !== null && this.musicaAgendada !== null) v.push("agendador e espera do compasso juntos");
    if (this.fase === "ativo" && this.ctx && (this.ctx.state as EstadoDoContexto) === "closed") v.push("ativo num contexto fechado");
    if (this.musicTimer !== null && this.ctx && (this.ctx.state as EstadoDoContexto) !== "running") v.push("música viva com o contexto parado");
    return v;
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Ruído com decaimento exponencial = sala plausível, em estéreo, sem assets. */
  private makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // pré-atraso curto deixa o ataque do som limpo antes da cauda entrar
        const pre = t < 0.012 ? t / 0.012 : 1;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * pre;
      }
    }
    return buf;
  }

  // ---- primitivas ----
  tone(o: ToneOpts): void {
    if (!this.prefs.sfx) return;
    this.rawTone(o, this.sfxBus, o.space ?? 0.18);
  }

  noise(o: NoiseOpts): void {
    if (!this.prefs.sfx) return;
    this.rawNoise(o, this.sfxBus, o.space ?? 0.12);
  }

  private send(node: AudioNode, amount: number, at: number, dur: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.reverbIn || amount <= 0) return;
    const g = ctx.createGain();
    g.gain.value = amount;
    node.connect(g);
    g.connect(this.reverbIn);
    // desconecta depois da cauda para não acumular nós
    setTimeout(() => g.disconnect(), (at - ctx.currentTime + dur + 3) * 1000);
  }

  private rawTone(o: ToneOpts, bus: GainNode | null, space: number): void {
    const ctx = this.ctx;
    if (!ctx || !bus) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const dur = o.dur ?? 0.18;
    const peak = Math.max(o.gain ?? 0.2, 0.0002);
    const attack = o.attack ?? 0.006;
    const hold = t + attack + (dur - attack) * (o.sustain ?? 0.25);

    const osc = ctx.createOscillator();
    osc.type = o.wave ?? "sine";
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(o.to, 1), t + dur);
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(peak * 0.72, hold); // corpo, em vez de decair de imediato
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let node: AudioNode = osc;
    if (o.cutoff !== undefined) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(o.cutoff, t);
      f.Q.value = 0.7;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(bus);
    this.send(g, space, t, dur);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private rawNoise(o: NoiseOpts, bus: GainNode | null, space: number): void {
    const ctx = this.ctx;
    if (!ctx || !bus || !this.noiseBuf) return;
    const t = ctx.currentTime + (o.delay ?? 0);
    const dur = o.dur ?? 0.12;
    const peak = Math.max(o.gain ?? 0.12, 0.0002);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;

    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(o.freq ?? 2000, t);
    if (o.to !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(o.to, 20), t + dur);
    f.Q.value = o.q ?? 1;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(f);
    f.connect(g);
    g.connect(bus);
    this.send(g, space, t, dur);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Abaixa a música por um instante para o efeito respirar (ducking). */
  duck(amount = 0.35, hold = 0.5): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || !this.prefs.music) return;
    const base = this.musicTarget;
    const now = ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setTargetAtTime(base * amount, now, 0.04);
    this.musicBus.gain.setTargetAtTime(base, now + hold, 0.4);
  }

  // ---- música ambiente: BOSSA ----
  /**
   * Ré maior, I – vi – ii – V (Dmaj7 · Bm7 · Em7 · A7): harmonia alegre e arejada.
   * Três camadas, uma barra (2s = 120bpm) agendada por vez:
   *   • violão — acordes CURTOS e sincopados na grade de semicolcheias (o que faz soar bossa
   *     não é o acorde, é onde ele NÃO cai: quase nada no tempo forte);
   *   • baixo — tônica no 1 e quinta no "a" do 3 (a célula pontuada característica);
   *   • ganzá — semicolcheias quase inaudíveis, só para dar balanço.
   * Substituiu o pad sustentado anterior, que soava denso e solene demais para a mesa.
   */
  private static readonly BOSSA: { bass: number; fifth: number; notes: number[] }[] = [
    { bass: 73.42, fifth: 110.0, notes: [146.83, 185.0, 220.0, 277.18] }, // Dmaj7
    { bass: 61.74, fifth: 92.5, notes: [123.47, 146.83, 185.0, 220.0] }, // Bm7
    { bass: 82.41, fifth: 123.47, notes: [164.81, 196.0, 246.94, 293.66] }, // Em7
    { bass: 55.0, fifth: 82.41, notes: [138.59, 164.81, 196.0, 220.0] }, // A7
  ];
  private static readonly BAR_MS = 2000;
  private static readonly SIXTEENTH = 0.125;
  /** Duas levadas alternadas — a variação evita o efeito "loop de 2 segundos". */
  private static readonly COMP: number[][] = [
    [0, 3, 6, 10, 13],
    [0, 4, 7, 10, 14],
  ];

  // ---- comemoração do campeão ----
  /** A mesma harmonia, mais rápida e com melodia: é a bossa "virando festa", não outra trilha. */
  private static readonly BAR_MS_FESTA = 1500;
  private static readonly COMP_FESTA: number[][] = [
    [0, 2, 3, 6, 8, 10, 13],
    [0, 3, 4, 6, 9, 11, 14],
  ];
  /** Melodia por compasso (semicolcheia → nota). O 1º compasso é o motivo da coroa. */
  private static readonly MELODIA: [number, number][][] = [
    [[0, 587.33], [3, 880.0], [6, 1108.73], [10, 1174.66]], // Ré–Lá–Fá♯–Ré (coroa)
    [[0, 987.77], [4, 880.0], [8, 739.99], [12, 659.25]],
    [[0, 659.25], [3, 783.99], [6, 987.77], [11, 1174.66]],
    [[0, 1108.73], [4, 880.0], [7, 739.99], [10, 587.33], [14, 587.33]],
  ];
  private celebrando = false;

  /** Entra a comemoração do campeão (respeita o liga/desliga de Música). */
  celebrar(): void {
    if (this.celebrando) return;
    this.celebrando = true;
    this.musicStep = 0;
    this.stopMusic();
    this.startMusic();
  }

  /** Volta ao ambiente normal ao sair do Placar Final. */
  encerrarCelebracao(): void {
    if (!this.celebrando) return;
    this.celebrando = false;
    this.musicStep = 0;
    this.stopMusic();
    this.startMusic();
  }

  startMusic(): void {
    if (this.musicTimer !== null || this.musicaAgendada !== null || !this.ctx || !this.prefs.music) return;
    // Escondido, não agenda (ex.: a partida online acaba em segundo plano e a comemoração pede
    // música): a volta para o primeiro plano é que recomeça, com o andamento certo.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    // Relógio parado não recebe compasso: quem confere o contexto liga a música quando ele rodar.
    if ((this.ctx.state as EstadoDoContexto) !== "running") return;
    const S = AudioEngine.SIXTEENTH;
    const festa = this.celebrando;
    this.inicioDoCompasso = -Infinity;
    const bar = () => {
      if (!this.prefs.music || !this.ctx) return;
      // O compasso anterior ainda nem começou (relógio parado, ou "running" zumbi): não empilha outro.
      if (this.ctx.currentTime < this.inicioDoCompasso) return;
      const n = this.musicStep++;
      const c = AudioEngine.BOSSA[n % AudioEngine.BOSSA.length];
      const comp = (festa ? AudioEngine.COMP_FESTA : AudioEngine.COMP)[n % 2];
      const lead = 0.12; // folga para o agendamento não chegar atrasado
      this.inicioDoCompasso = this.ctx.currentTime + lead;
      this.fimDoCompasso = this.ctx.currentTime + lead + (festa ? AudioEngine.BAR_MS_FESTA : AudioEngine.BAR_MS) / 1000;

      if (festa) {
        // melodia brilhante por cima, palmas nos tempos 2 e 4
        for (const [slot, f] of AudioEngine.MELODIA[n % AudioEngine.MELODIA.length]) {
          this.rawTone(
            { freq: f, wave: "triangle", dur: 0.42, gain: 0.062, attack: 0.006, sustain: 0.3, cutoff: 4200, delay: lead + slot * S },
            this.musicBus, 0.42,
          );
          this.rawTone(
            { freq: f * 2, wave: "sine", dur: 0.3, gain: 0.018, attack: 0.006, delay: lead + slot * S + 0.01 },
            this.musicBus, 0.5,
          );
        }
        for (const slot of [4, 12]) {
          this.rawNoise(
            { freq: 2000, to: 900, q: 0.8, dur: 0.11, gain: 0.05, delay: lead + slot * S },
            this.musicBus, 0.45,
          );
        }
      }

      // violão: acorde dedilhado rápido (strum de 7ms entre as cordas)
      for (const slot of comp) {
        const t = lead + slot * S;
        c.notes.forEach((f, i) => {
          this.rawTone(
            {
              freq: f, wave: "triangle", dur: 0.52, gain: 0.03 - i * 0.003, attack: 0.004,
              sustain: 0.12, cutoff: 2400, detune: i % 2 ? 4 : -4, delay: t + i * 0.007,
            },
            this.musicBus, 0.32,
          );
        });
      }
      // baixo: tônica no 1, quinta no "a" do 3 (mais firme na comemoração)
      this.rawTone(
        { freq: c.bass, wave: "sine", dur: 0.46, gain: 0.085, attack: 0.012, sustain: 0.3, cutoff: 380, delay: lead },
        this.musicBus, 0.14,
      );
      this.rawTone(
        { freq: c.fifth, wave: "sine", dur: 0.4, gain: 0.062, attack: 0.012, sustain: 0.3, cutoff: 380, delay: lead + 11 * S },
        this.musicBus, 0.14,
      );
      // ganzá nas colcheias, com acento leve nos tempos
      for (let i = 0; i < 16; i += 2) {
        this.rawNoise(
          { freq: 6800, to: 5200, q: 1.4, dur: 0.032, gain: i % 4 === 0 ? 0.012 : 0.007, delay: lead + i * S },
          this.musicBus, 0.18,
        );
      }
      // a cada 8 compassos, o motivo da coroa insinuado no agudo — assinatura, não melodia
      if (n % 8 === 7) {
        [587.33, 739.99].forEach((f, i) => {
          this.rawTone(
            { freq: f, wave: "sine", dur: 1.1, gain: 0.022, attack: 0.06, sustain: 0.3, delay: lead + (6 + i * 4) * S },
            this.musicBus, 0.6,
          );
        });
      }
    };
    bar();
    this.musicTimer = window.setInterval(bar, festa ? AudioEngine.BAR_MS_FESTA : AudioEngine.BAR_MS);
  }

  stopMusic(): void {
    if (this.musicaAgendada !== null) {
      clearTimeout(this.musicaAgendada);
      this.musicaAgendada = null;
    }
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  // ---- haptics semânticos ----
  /** iOS/Safari NÃO expõe a Vibration API — nesses aparelhos isto é ignorado em silêncio. */
  vibrate(pattern: number | number[]): void {
    if (!this.prefs.haptics) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* sem suporte: ignora */
    }
  }

  static get supportsHaptics(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }
}

export const audio = new AudioEngine();
export const supportsHaptics = AudioEngine.supportsHaptics;
