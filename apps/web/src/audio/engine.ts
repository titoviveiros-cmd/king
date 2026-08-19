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

class AudioEngine {
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
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return; // sem Web Audio: o jogo segue mudo, sem quebrar
      const ctx = new Ctor();
      this.ctx = ctx;
      this.noiseBuf = this.makeNoise(ctx, 1.2);

      this.master = ctx.createGain();
      this.master.gain.value = 0.9;

      // Limitador suave: impede que King capturado + música + carta jogada estourem juntos.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -15;
      comp.knee.value = 26;
      comp.ratio.value = 3.2;
      comp.attack.value = 0.004;
      comp.release.value = 0.22;
      comp.connect(this.master);
      this.master.connect(ctx.destination);

      // Reverb por convolução com resposta impulsiva gerada na hora (nenhum arquivo).
      const conv = ctx.createConvolver();
      conv.buffer = this.makeImpulse(ctx, 2.4, 2.6);
      const wet = ctx.createGain();
      wet.gain.value = 0.9;
      const damp = ctx.createBiquadFilter(); // corta o brilho do rabo do reverb
      damp.type = "lowpass";
      damp.frequency.value = 3200;
      this.reverbIn = ctx.createGain();
      this.reverbIn.gain.value = 1;
      this.reverbIn.connect(conv);
      conv.connect(damp);
      damp.connect(wet);
      wet.connect(comp);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicTarget;
      this.musicBus.connect(comp);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.prefs.sfx ? this.prefs.sfxVol : 0;
      this.sfxBus.connect(comp);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (this.prefs.music) this.startMusic();
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
    if (this.musicTimer !== null || !this.ctx || !this.prefs.music) return;
    const S = AudioEngine.SIXTEENTH;
    const festa = this.celebrando;
    const bar = () => {
      if (!this.prefs.music || !this.ctx) return;
      const n = this.musicStep++;
      const c = AudioEngine.BOSSA[n % AudioEngine.BOSSA.length];
      const comp = (festa ? AudioEngine.COMP_FESTA : AudioEngine.COMP)[n % 2];
      const lead = 0.12; // folga para o agendamento não chegar atrasado

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
