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

import { DIAG_LIGADO, carimbar, diagAudio, type Retrato, type RetratoGuardado } from "./diagnostico.js";
import {
  PARAMETROS_DO_GRAFO, PERFIL_ORIGINAL, PERFIS, REVERB_LEVE, compensacaoDoReverbLeve, gerarImpulso, perfilPadrao, tocaGanza, tocaNotaDoViolao,
  type NomeDoPerfil, type PerfilDoGrafo,
} from "./perfilDoGrafo.js";
import { criarMonitor, type Monitor } from "./monitorDeAudio.js";

// Rodada 8: os números do grafo e o impulso moram em perfilDoGrafo.ts (o laboratório usa os mesmos).
export { PARAMETROS_DO_GRAFO, gerarImpulso };

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

/**
 * A VOZ TERMINOU: desliga a cadeia dela do barramento. Cada nota da música é fonte → filtro → ganho
 * → barramento, ~30 por compasso; sem isto as ligações ficavam de pé até o coletor do navegador
 * passar (medido no dublê: ~4 mil no 1º minuto, ~40 mil aos 10) e o motor de áudio as percorria a
 * cada quantum. O reverb não perde a cauda: ela mora no convolver, não nesta cadeia.
 */
function soltar(...nos: (AudioNode | null)[]): void {
  for (const no of nos) {
    try { no?.disconnect(); } catch { /* contexto já fechado */ }
  }
}

/** Retoma sem deixar rejeição solta — e, no APK de QA, registra a recusa (é a pergunta "o resume falhou?"). */
function retomar(ctx: AudioContext, onde: string): void {
  void ctx.resume().catch((e: unknown) => {
    diagAudio.registrar("resume-recusado", { onde, erro: nomeDoErro(e) });
  });
}

/** Só o nome do erro (NotAllowedError, InvalidStateError…): nada de mensagem livre na fita. */
function nomeDoErro(e: unknown): string {
  return e instanceof Error ? e.name : typeof e;
}

/** Ganho atual de um nó (o Chrome devolve o valor calculado no último quantum). */
function ganho(no: GainNode | null): number | null {
  return no ? Number(no.gain.value.toFixed(4)) : null;
}

/**
 * A SAÍDA DO APARELHO, como o navegador a relata: `getOutputTimestamp` diz até onde o dispositivo
 * de saída já tocou (e quando); `outputLatency`, o atraso dele. Relógio do contexto andando com a
 * marca da saída parada é o retrato de "o motor toca, o alto-falante não".
 */
function saidaDoAparelho(ctx: AudioContext): Record<string, number | null> {
  try {
    const c = ctx as AudioContext & { getOutputTimestamp?: () => AudioTimestamp; outputLatency?: number };
    const ts = c.getOutputTimestamp?.();
    return {
      saidaCtx: ts && Number.isFinite(ts.contextTime) ? Number(ts.contextTime!.toFixed(3)) : null,
      saidaIdadeMs: ts && Number.isFinite(ts.performanceTime) && typeof performance !== "undefined"
        ? Math.round(performance.now() - ts.performanceTime!) : null,
      latSaida: Number.isFinite(c.outputLatency) ? Number(c.outputLatency!.toFixed(3)) : null,
    };
  } catch {
    return { saidaCtx: null, saidaIdadeMs: null, latSaida: null };
  }
}

/** Estados do contexto. "interrupted" é do Safari/iOS e não está em toda tipagem do TypeScript. */
type EstadoDoContexto = AudioContextState | "interrupted";

/** iPhone/iPad (o iPad se apresenta como Mac com toque). Todo navegador lá é WebKit. */
const ehIOS = () => typeof navigator !== "undefined"
  && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** Android (Chrome e a WebView do app). */
const ehAndroid = () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/**
 * Celular: iPhone ou Android. Nos dois, ida ao fundo e interrupção deixam a SAÍDA FÍSICA sob
 * suspeita — o JS não vê se ela voltou (ver `naoConfiavel`).
 */
const ehMovel = () => ehIOS() || ehAndroid();

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
  /** Escuta o master (fora do caminho do som) para o vigia ver NaN. Ausente onde não há analisador. */
  analisador: AnalyserNode | null;
  /** Rodada 8: o peso deste grafo (o reverb, os envios, a polifonia) — escolhido quando ele nasce. */
  perfil: PerfilDoGrafo;
  /** Envios ao reverb COMPARTILHADOS (perfil leve): um nó por quantidade, ligado ao reverbIn. */
  envios: Map<number, GainNode>;
}

/** Um som de teste do painel de diagnóstico: o motor antes e ~300 ms depois de mandar tocar. */
export interface ResultadoDoTeste {
  qual: "musica" | "efeito" | "direto";
  /** As notas foram agendadas no contexto atual (não quer dizer que o alto-falante tocou). */
  tocou: boolean;
  motivo: string | null;
  antes: Retrato;
  durante: Retrato | null;
}

/** Uma troca de contexto vista pelo diagnóstico: o motor antes, logo depois e ~1 s depois. */
export interface TrocaRegistrada { antes: RetratoGuardado; depois: RetratoGuardado | null; umSegundoDepois: RetratoGuardado | null; falhou: boolean }

/**
 * SÓ NO APK DEBUG: a sonda do painel "Diagnóstico de áudio" (rodada 5, sem cabo USB). Lê o motor sem
 * mexer nele; os únicos verbos são o som de teste (pelos barramentos de verdade) e `recuperar`, que é
 * o `religar` de sempre — chamado só pelo botão "Tentar recuperar".
 */
export interface SondaDoMotor {
  /** O motor AGORA, sem efeito colateral (não retoma, não troca, não marca nada). */
  retrato(): Retrato;
  /** Retratos tirados no `pointerdown` — ANTES do touchend/click que pode trocar o contexto (até 6). */
  antesDoToque(): RetratoGuardado[];
  /** As últimas trocas de contexto, com o antes e o depois (até 6). */
  trocas(): TrocaRegistrada[];
  tocarTeste(qual: "musica" | "efeito"): Promise<ResultadoDoTeste>;
  /**
   * Rodada 6 (teste A′): um tom direto no `destination` do contexto ATUAL — Oscillator → Gain →
   * destination, sem barramentos, sem compressor, sem master. Sem resume, sem troca.
   */
  tomDireto(): Promise<ResultadoDoTeste>;
  recuperar(): void;
  /** Rodada 7: o contexto atual, SÓ para medir o relógio (currentTime, getOutputTimestamp, latências). */
  contextoParaMedir(): AudioContext | null;
  /** Rodada 7: para o agendador da música SEM mexer nas preferências. Devolve se ela estava agendada. */
  pararMusica(): boolean;
  /**
   * Rodada 7: tira o grafo do KING do processamento — o master sai do destination E do analisador (que
   * puxa o grafo sozinho). Nada é destruído: `restaurar` religa as duas ligações. Devolve se isolou.
   */
  isolarGrafo(): boolean;
  /** Rodada 7: religa o que `isolarGrafo` tirou (só no MESMO contexto) e a música volta se estiver ligada. */
  restaurar(): { religou: boolean; musica: boolean };
  /** Rodada 8: o perfil do grafo em uso (e se foi forçado pelo painel). */
  perfil(): { nome: NomeDoPerfil; forcado: boolean };
  /**
   * Rodada 8 (variantes A–E): força um perfil (`null` = volta ao automático) e TROCA o contexto por um novo
   * montado com ele — pelo caminho de sempre (`reconstruir`), dentro do toque: um contexto só de cada vez.
   * Devolve se trocou (fundo, troca em curso ou sem contexto: não troca).
   */
  usarPerfil(nome: NomeDoPerfil | null): boolean;
  /** Rodada 8: o monitor contínuo do relógio (só existe no APK DEBUG). */
  monitor(): Monitor | null;
}

interface SondaInterna extends SondaDoMotor {
  guardarAntesDoToque(): void;
  registrarTroca(momento: "antes" | "depois" | "falhou"): void;
}

/** Por que o vigia condenou o contexto — só para o diagnóstico. */
type Condenacao = "zumbi" | "envenenado" | "erro" | "mudo";

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
  private analisador: AnalyserNode | null = null;
  private amostras: Float32Array<ArrayBuffer> | null = null;
  /** O analisador deste contexto já mostrou som (≠ 0): só então um zero absoluto quer dizer algo. */
  private analisadorProvado = false;
  /** Exames seguidos do vigia com a música agendada e o master em zero absoluto. */
  private zerosSeguidos = 0;
  /** Quando o agendador da música (re)começou — o 1º compasso precisa de um instante para soar. */
  private musicaDesde = 0;
  /** Quando o contexto atual nasceu (o 🔊 não troca um contexto que acabou de nascer). */
  private nasceuEm = 0;
  /** DIAGNÓSTICO (só no APK de QA): vozes no ar e o último compasso agendado. */
  private vozes = 0;
  private compassoEm = 0;
  /** DIAGNÓSTICO (só no APK de QA): a sonda do painel; `null` no build normal, sempre. */
  private sonda: SondaInterna | null = null;
  /** DIAGNÓSTICO (rodada 7): o que `isolarGrafo` desligou, para religar no mesmo contexto. */
  private isolado: { ctx: AudioContext; master: GainNode; analisador: AnalyserNode | null } | null = null;
  /** Rodada 8: o perfil do grafo atual e os envios compartilhados dele. */
  private perfil: PerfilDoGrafo = PERFIL_ORIGINAL;
  private envios = new Map<number, GainNode>();
  /** DIAGNÓSTICO (rodada 8): perfil forçado pelo painel (variantes); `null` = automático. */
  private perfilForcado: PerfilDoGrafo | null = null;
  /** DIAGNÓSTICO (rodada 8): o monitor contínuo do relógio; `null` fora do APK DEBUG. */
  private monitorDoRelogio: Monitor | null = null;
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
  /**
   * RELIGAR, dentro do toque: Música ou Efeitos voltaram a ON no painel — o pedido explícito de quem
   * quer ouvir. Hotfix do AAB 0.1.0 vc1 (Android): o som sumiu com o painel aberto e desligar/religar
   * não o trazia, porque `unlock` só retoma contexto PARADO. Um contexto "running", de relógio
   * andando, cuja saída física morreu é invisível ao JS (o mesmo limite do iPhone, acima) — então
   * religar troca por um contexto NOVO, pelo caminho já provado (`reconstruir`). Timbre, mix e
   * preferências não mudam. Escondido, ou com uma troca em curso, não faz nada.
   */
  religar(): void {
    diagAudio.registrar("religar", { fase: this.fase, estado: this.ctx?.state ?? null, visivel: visivel() });
    if (!this.ctx) { this.unlock(); return; }
    if (this.fase === "reconstruindo" || this.fase === "fundo" || !visivel()) return;
    this.reconstruir();
  }

  /**
   * O 🔊 (2º QA físico do Android, 03/11/2026): quem abre o painel de som quer OUVIR. Há mortes da
   * saída que o JS não enxerga — contexto "running", relógio andando, grafo com som, alto-falante
   * mudo (saída trocada pelo navegador, rota de áudio que mudou). O que o aparelho provou é que um
   * contexto NOVO, criado dentro de um toque, toca ("funciona no começo"). Então o 🔊 troca por um
   * novo, pelo caminho de sempre (`religar`): um toque, e o som volta, seja qual for a causa.
   * Contexto que acabou de nascer não é trocado (toque duplo), e as travas da troca no gesto valem
   * aqui também (uma tentativa por toque; grafo que quebrou no meio só na próxima volta).
   * SÓ NO ANDROID: no iPhone e no computador o som funciona hoje, e trocar um contexto saudável lá
   * é risco sem ganho (o novo pode demorar a partir) — nesses, o 🔊 continua só retomando.
   */
  reativar(): void {
    diagAudio.registrar("reativar", { fase: this.fase, idadeMs: this.ctx ? Date.now() - this.nasceuEm : null });
    const travado = this.trocaBloqueada || Date.now() - this.trocaFalhouEm < 1000;
    if (!ehAndroid() || travado || (this.ctx && Date.now() - this.nasceuEm < AudioEngine.REATIVAR_MIN_MS)) {
      this.unlock();
      return;
    }
    this.religar();
  }

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
    if (estado === "suspended" || estado === "interrupted") retomar(ctx, "unlock");
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
    // Rodada 8: o peso do grafo. Produção: "leve-24k" no Android, "original" no resto (perfilDoGrafo.ts).
    const perfil = (DIAG_LIGADO ? this.perfilForcado : null) ?? perfilPadrao(ehAndroid());
    // Sem taxa no perfil: `new Ctor()` SEM opção nenhuma, como sempre. Com taxa (Android): se o aparelho
    // recusar a opção, o contexto nasce como sempre — nunca fica sem som por causa dela.
    let ctx: AudioContext;
    if (perfil.taxa) {
      try {
        ctx = new Ctor({ sampleRate: perfil.taxa });
      } catch (e) {
        diagAudio.registrar("taxa-recusada", { pedida: perfil.taxa, erro: nomeDoErro(e) });
        ctx = new Ctor();
      }
    } else {
      ctx = new Ctor();
    }
    try {
      const P = PARAMETROS_DO_GRAFO;
      const noiseBuf = this.makeNoise(ctx, P.ruidoSegundos);

      const master = ctx.createGain();
      master.gain.value = P.master;

      // Limitador suave: impede que King capturado + música + carta jogada estourem juntos.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = P.compressor.threshold;
      comp.knee.value = P.compressor.knee;
      comp.ratio.value = P.compressor.ratio;
      comp.attack.value = P.compressor.attack;
      comp.release.value = P.compressor.release;
      comp.connect(master);
      master.connect(ctx.destination);
      // O VIGIA ESCUTA O MASTER por um analisador em derivação (não leva a lugar nenhum: nada do que
      // se ouve passa por ele). É por ele que um NaN no meio do grafo aparece — o compressor que
      // recebe um NaN guarda o NaN e cala o contexto inteiro, com o relógio andando.
      const analisador = typeof ctx.createAnalyser === "function" ? ctx.createAnalyser() : null;
      if (analisador) {
        analisador.fftSize = P.analisadorFft;
        master.connect(analisador);
      }

      // Reverb por convolução com resposta impulsiva gerada na hora (nenhum arquivo).
      // Rodada 8: no perfil "leve" (Android), o impulso é o COMEÇO mono (1,2 s) do mesmo envelope, e o
      // molhado é compensado para sair no mesmo volume; no "nenhum" (só variante B do DEBUG) não existe
      // convolução nenhuma — e nenhum envio é criado (ganho zero não tiraria o peso do processamento).
      const reverbIn = ctx.createGain();
      reverbIn.gain.value = 1;
      if (perfil.reverb !== "nenhum") {
        const leve = perfil.reverb === "mono-curto";
        const conv = ctx.createConvolver();
        conv.buffer = leve
          ? gerarImpulso(ctx, P.reverb.segundos, P.reverb.decaimento, REVERB_LEVE)
          : gerarImpulso(ctx, P.reverb.segundos, P.reverb.decaimento);
        const wet = ctx.createGain();
        wet.gain.value = leve ? P.reverb.wet * compensacaoDoReverbLeve(ctx.sampleRate) : P.reverb.wet;
        const damp = ctx.createBiquadFilter(); // corta o brilho do rabo do reverb
        damp.type = "lowpass";
        damp.frequency.value = P.reverb.corte;
        reverbIn.connect(conv);
        conv.connect(damp);
        damp.connect(wet);
        wet.connect(comp);
      }

      const musicBus = ctx.createGain();
      musicBus.gain.value = this.musicTarget;
      musicBus.connect(comp);

      const sfxBus = ctx.createGain();
      sfxBus.gain.value = this.prefs.sfx ? this.prefs.sfxVol : 0;
      sfxBus.connect(comp);
      return { ctx, master, reverbIn, musicBus, sfxBus, noiseBuf, analisador, perfil, envios: new Map() };
    } catch {
      // nasceu, mas o grafo quebrou no meio: fecha (melhor esforço) e avisa quem tentou a troca
      void ctx.close().catch(() => {});
      diagAudio.registrar("contexto-fechado", { estado: ctx.state, motivo: "grafo-quebrou" });
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
    this.analisador = g.analisador;
    this.perfil = g.perfil;
    this.envios = g.envios;
    this.amostras = null;
    this.analisadorProvado = false;
    this.zerosSeguidos = 0;
    this.nasceuEm = Date.now();
    this.vozes = 0; // diagnóstico: conta as vozes DESTE contexto (as do velho não descontam aqui)
    this.ultimoEstado = g.ctx.state as EstadoDoContexto;
    this.zumbi = false;
    this.condenado = null;
    this.naoConfiavel = false;
    this.relogio = null;
    this.refDoVigia = null;
    this.vereditoZumbi = null;
    this.falhasDoGesto = 0;
    this.fimDoCompasso = 0;
    const ctx = g.ctx;
    ctx.onstatechange = () => this.aoMudarEstado(ctx);
    // Chrome: o dispositivo de saída falhou. O contexto pode seguir "running", de relógio andando, e
    // mudo — só um novo resolve. Onde o evento não existe, a atribuição é inofensiva.
    (ctx as AudioContext & { onerror: (() => void) | null }).onerror = () => {
      if (ctx === this.ctx) this.condenar("erro");
    };
    diagAudio.registrar("contexto-novo", {
      estado: ctx.state, taxa: ctx.sampleRate,
      latencia: Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : null,
      analisador: g.analisador !== null,
      perfil: g.perfil.nome,
    });
  }

  private grafoAtual(): Grafo | null {
    const { ctx, master, reverbIn, musicBus, sfxBus, noiseBuf, analisador, perfil, envios } = this;
    return ctx && master && reverbIn && musicBus && sfxBus && noiseBuf
      ? { ctx, master, reverbIn, musicBus, sfxBus, noiseBuf, analisador, perfil, envios }
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
  /** NaN no master ou erro do dispositivo: relógio andando não absolve — só um contexto novo resolve. */
  private condenado: Condenacao | null = null;
  /** Última leitura do vigia (relógio do contexto × relógio de parede), com a página à vista. */
  private refDoVigia: { ctx: number; real: number } | null = null;
  private vigia: ReturnType<typeof setTimeout> | null = null;
  private tiquesDoVigia = 0;
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
  /** O vigia confere a saúde do contexto a cada 2 s com o jogo à vista (barato: duas leituras). */
  private static readonly VIGIA_MS = 2000;
  /** Música tocando há tanto tempo antes de um zero absoluto contar (o 1º compasso entra em 0,12 s). */
  private static readonly MUDO_DEPOIS_MS = 4000;
  /** Exames seguidos em zero absoluto que condenam (2 × 2 s). */
  private static readonly EXAMES_MUDOS = 2;
  /** O 🔊 não troca um contexto mais novo que isto. */
  private static readonly REATIVAR_MIN_MS = 1500;
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
    this.vigiar();
    this.exporDiagnostico();
  }

  /**
   * Console do chrome://inspect (SÓ no APK DEBUG de QA): `__kingAudio.estado()`, `.tomDireto()` (440 Hz
   * direto no destino do contexto ATUAL, sem grafo nenhum) e `.tomEmContextoNovo()` (um contexto à
   * parte, que fecha sozinho). Separam "o grafo calou", "a saída deste contexto morreu" e "o
   * aparelho não toca mais nada pela WebView".
   */
  private exporDiagnostico(): void {
    if (!diagAudio.ligado) return;
    const tom = (ctx: AudioContext) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      g.gain.value = 0.15;
      osc.frequency.value = 440;
      osc.connect(g);
      g.connect(ctx.destination);
      osc.onended = () => soltar(osc, g);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    };
    diagAudio.expor({
      estado: () => ({ ...this.estadoDoCiclo(), contexto: this.ctx?.state ?? null, relogio: this.ctx?.currentTime ?? null,
        zumbi: this.zumbi, condenado: this.condenado, prefs: this.get() }),
      tomDireto: () => { if (this.ctx) tom(this.ctx); return this.ctx?.state ?? null; },
      tomEmContextoNovo: () => {
        const ctx = new AudioContext();
        void ctx.resume().catch(() => {});
        tom(ctx);
        setTimeout(() => void ctx.close().catch(() => {}), 1500);
        return ctx.state;
      },
      reativar: () => { this.reativar(); return this.ctx?.state ?? null; },
    });
    // O QUE ACONTECEU EM VOLTA do som (só no APK de QA): ciclo de vida do Capacitor (`pause` e
    // `resume` no document), congelamento da página, foco, rede — e o TOQUE que não fez nada.
    // Um toque com a fase "ativo" e o som mudo é a assinatura da morte que o vigia não enxerga.
    const ev = (alvo: EventTarget, nome: string) => alvo.addEventListener(nome, () => {
      diagAudio.registrar(`ev-${nome}`, { fase: this.fase, estado: this.ctx?.state ?? null, visivel: visivel() });
    });
    for (const nome of ["pause", "resume", "freeze", "visibilitychange"]) ev(document, nome);
    for (const nome of ["blur", "focus", "pagehide", "online", "offline"]) ev(window, nome);
    // O RETRATO ANTES DO TOQUE (rodada 5): o `pointerdown` vem antes do touchend/click — os eventos
    // em que o motor troca o contexto. Assim o estado DEFEITUOSO fica salvo antes de qualquer reparo
    // que o próprio toque dispare (o 🔊, um toque na mesa, o "Registrar falha").
    const sonda = this.sondaDeDiagnostico() as SondaInterna | null;
    if (sonda) window.addEventListener("pointerdown", () => sonda.guardarAntesDoToque(), { capture: true, passive: true });
    // RODADA 8: o monitor contínuo do relógio (janelas de 5 s: razão e underruns por diferença), para o
    // teste de uso real. Só lê; segue o contexto atual sozinho (troca no meio = janela descartada).
    if (DIAG_LIGADO && !this.monitorDoRelogio) {
      this.monitorDoRelogio = criarMonitor({
        contexto: () => this.ctx,
        perfil: () => this.perfil.nome,
        visivel,
        agora: () => Date.now(),
      });
      this.monitorDoRelogio.iniciar();
    }
    let ultimoToque = 0;
    window.addEventListener("touchend", () => {
      if (Date.now() - ultimoToque < 5000) return;
      ultimoToque = Date.now();
      diagAudio.registrar("toque", {
        fase: this.fase, estado: this.ctx?.state ?? null, gesto: this.aoGesto !== null,
        musica: this.musicTimer !== null, condenado: this.condenado, zumbi: this.zumbi,
      });
    }, { capture: true, passive: true });
  }

  /**
   * SÓ NO APK DEBUG (`null` em qualquer outro build — e o corpo some do pacote): a sonda do painel
   * "Diagnóstico de áudio". Lê o motor sem mexer nele. O analisador é lido num buffer PRÓPRIO, para
   * não mexer na prova do vigia (`analisadorProvado`). Atenção de leitura: o analisador mede o SINAL
   * DENTRO do grafo; ele não prova que o alto-falante tocou — por isso o painel pergunta "ouviu?".
   */
  sondaDeDiagnostico(): SondaDoMotor | null {
    if (!DIAG_LIGADO) return null;
    if (this.sonda) return this.sonda;
    const motor = this; // a sonda lê o motor de dentro das funções dela
    const toques: RetratoGuardado[] = [];
    const trocas: TrocaRegistrada[] = [];
    let ultimoToque = 0;
    const medir = (): { rms: number | null; pico: number | null; nan: boolean | null } => {
      const a = motor.analisador;
      if (!a) return { rms: null, pico: null, nan: null };
      const buf = new Float32Array(a.fftSize);
      try { a.getFloatTimeDomainData(buf); } catch { return { rms: null, pico: null, nan: null }; }
      let soma = 0;
      let pico = 0;
      let nan = false;
      for (const v of buf) {
        if (!Number.isFinite(v)) { nan = true; continue; }
        soma += v * v;
        pico = Math.max(pico, Math.abs(v));
      }
      return { rms: Number(Math.sqrt(soma / buf.length).toFixed(5)), pico: Number(pico.toFixed(5)), nan };
    };
    const retrato = (): Retrato => {
      const ctx = motor.ctx;
      const agora = Date.now();
      const ref = motor.refDoVigia;
      const m = medir();
      const p = motor.prefs;
      const base = ctx && Number.isFinite(ctx.baseLatency) ? Number(ctx.baseLatency.toFixed(4)) : null;
      return {
        fase: motor.fase,
        contexto: ctx ? (ctx.state as string) : null,
        relogio: ctx ? Number(ctx.currentTime.toFixed(3)) : null,
        // quanto o relógio andou desde o último exame do vigia (a cada 2 s, com a página à vista)
        andouDesdeVigia: ctx && ref ? Number((ctx.currentTime - ref.ctx).toFixed(3)) : null,
        paredeDesdeVigiaMs: ref ? agora - ref.real : null,
        taxa: ctx ? ctx.sampleRate : null,
        latBase: base,
        ...(ctx ? saidaDoAparelho(ctx) : { saidaCtx: null, saidaIdadeMs: null, latSaida: null }),
        idadeContextoMs: ctx ? agora - motor.nasceuEm : null,
        geracao: motor.geracao,
        musicaAgendada: motor.musicTimer !== null,
        compassoHaMs: motor.compassoEm ? agora - motor.compassoEm : null,
        musicaDesdeMs: motor.musicTimer !== null && motor.musicaDesde ? agora - motor.musicaDesde : null,
        prefMusica: p.music, volMusica: p.musicVol, prefEfeitos: p.sfx, volEfeitos: p.sfxVol, prefVibracao: p.haptics,
        ganhoMaster: ganho(motor.master), ganhoMusica: ganho(motor.musicBus), ganhoEfeitos: ganho(motor.sfxBus),
        analisador: motor.analisador !== null, rms: m.rms, pico: m.pico, sinalNaN: m.nan,
        analisadorProvado: motor.analisadorProvado, vozes: motor.vozes,
        perfil: motor.perfil.nome, perfilForcado: motor.perfilForcado !== null,
        zumbi: motor.zumbi, condenado: motor.condenado, naoConfiavel: motor.naoConfiavel,
        gestoArmado: motor.aoGesto !== null, recuperando: motor.recuperacao !== null,
        trocaBloqueada: motor.trocaBloqueada, falhasDoGesto: motor.falhasDoGesto,
        visivel: visivel(),
        foco: typeof document !== "undefined" && typeof document.hasFocus === "function" ? document.hasFocus() : null,
      };
    };
    const guardar = <T>(lista: T[], item: T) => { lista.push(item); if (lista.length > 6) lista.shift(); };
    const sonda: SondaInterna = {
      retrato,
      antesDoToque: () => toques.slice(),
      trocas: () => trocas.map((t) => ({ ...t })),
      guardarAntesDoToque() {
        // pointerdown e o touchstart do mesmo dedo: um retrato por toque
        if (Date.now() - ultimoToque < 250) return;
        ultimoToque = Date.now();
        guardar(toques, carimbar("antes-do-toque", retrato()));
      },
      registrarTroca(momento) {
        if (momento === "antes") {
          guardar(trocas, { antes: carimbar("antes-da-troca", retrato()), depois: null, umSegundoDepois: null, falhou: false });
          return;
        }
        const t = trocas[trocas.length - 1];
        if (!t) return;
        if (momento === "falhou") { t.falhou = true; t.depois = carimbar("troca-falhou", retrato()); return; }
        t.depois = carimbar("logo-depois-da-troca", retrato());
        setTimeout(() => { t.umSegundoDepois = carimbar("1s-depois-da-troca", retrato()); }, 1000);
      },
      async tocarTeste(qual) {
        const antes = retrato();
        const ctx = motor.ctx;
        const bus = qual === "musica" ? motor.musicBus : motor.sfxBus;
        diagAudio.registrar("teste-de-som", { qual, estado: ctx?.state ?? null, geracao: motor.geracao });
        if (!ctx || !bus) return { qual, tocou: false, motivo: "sem-contexto", antes, durante: null };
        // pelos barramentos DE VERDADE (com o volume e o liga/desliga que estão valendo): sem resume, sem troca
        const notas: [number, number][] = qual === "musica" ? [[392, 0], [494, 0.18], [587, 0.36]] : [[880, 0], [1320, 0.09]];
        try {
          for (const [freq, delay] of notas) {
            motor.rawTone({ freq, delay, dur: qual === "musica" ? 0.5 : 0.16, gain: 0.25, wave: qual === "musica" ? "triangle" : "sine" }, bus, 0.1);
          }
        } catch (e) {
          return { qual, tocou: false, motivo: nomeDoErro(e), antes, durante: null };
        }
        await new Promise((ok) => setTimeout(ok, 300));
        const durante = retrato();
        diagAudio.registrar("teste-de-som-medido", { qual, rms: durante.rms, relogio: durante.relogio, estado: durante.contexto });
        return { qual, tocou: true, motivo: null, antes, durante };
      },
      async tomDireto() {
        const antes = retrato();
        const ctx = motor.ctx;
        diagAudio.registrar("teste-de-som", { qual: "direto", estado: ctx?.state ?? null, geracao: motor.geracao });
        if (!ctx) return { qual: "direto", tocou: false, motivo: "sem-contexto", antes, durante: null };
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
          osc.onended = () => soltar(osc, g);
          osc.start(t0);
          osc.stop(t0 + 0.62);
        } catch (e) {
          return { qual: "direto", tocou: false, motivo: nomeDoErro(e), antes, durante: null };
        }
        await new Promise((ok) => setTimeout(ok, 300));
        const durante = retrato();
        diagAudio.registrar("teste-de-som-medido", { qual: "direto", rms: durante.rms, relogio: durante.relogio, estado: durante.contexto });
        return { qual: "direto", tocou: true, motivo: null, antes, durante };
      },
      recuperar: () => motor.religar(),
      contextoParaMedir: () => motor.ctx,
      pararMusica() {
        const tocava = motor.musicTimer !== null || motor.musicaAgendada !== null;
        motor.stopMusic();
        diagAudio.registrar("lab-musica-parada", { tocava });
        return tocava;
      },
      isolarGrafo() {
        const { ctx, master, analisador } = motor;
        if (!ctx || !master || motor.isolado) return false;
        try { master.disconnect(); } catch { return false; }
        motor.isolado = { ctx, master, analisador };
        diagAudio.registrar("lab-grafo-isolado", { estado: ctx.state, geracao: motor.geracao });
        return true;
      },
      restaurar() {
        const iso = motor.isolado;
        motor.isolado = null;
        let religou = false;
        if (iso && iso.ctx === motor.ctx && (iso.ctx.state as EstadoDoContexto) !== "closed") {
          try {
            iso.master.connect(iso.ctx.destination);
            if (iso.analisador) iso.master.connect(iso.analisador);
            religou = true;
          } catch { /* contexto morreu no meio: a próxima troca resolve */ }
        }
        if (motor.prefs.music) motor.startMusic(); // startMusic não duplica: sai se já houver agendador
        const musica = motor.musicTimer !== null;
        diagAudio.registrar("lab-restaurado", { religou, musica });
        return { religou, musica };
      },
      perfil: () => ({ nome: motor.perfil.nome, forcado: motor.perfilForcado !== null }),
      usarPerfil(nome) {
        motor.perfilForcado = nome === null ? null : PERFIS[nome];
        const pode = motor.ctx !== null && visivel() && motor.fase !== "reconstruindo" && motor.fase !== "fundo";
        diagAudio.registrar("lab-perfil", { pedido: nome, pode, atual: motor.perfil.nome });
        if (!pode) return false;
        motor.isolado = null; // o grafo isolado era do contexto velho
        motor.reconstruir();
        return motor.perfil.nome === (motor.perfilForcado ?? perfilPadrao(ehAndroid())).nome;
      },
      monitor: () => motor.monitorDoRelogio,
    };
    this.sonda = sonda;
    return sonda;
  }

  // ---- o vigia: o contexto que morre NO MEIO do uso ----
  // 2º QA físico do vc1 (Android, 03/11/2026): o som começou, sumiu depois de um tempo de uso e não
  // voltou. A máquina acima só olhava o contexto na ida ao fundo, na volta e no `statechange`. Um
  // contexto que morre com a página à vista e SEM aviso — relógio "running" parado, estado trocado
  // sem evento, NaN no master, dispositivo de saída que falhou — ficava "ativo" para sempre, e
  // "ativo" não arma o gesto: nenhum toque o trocava. O vigia confere a cada 2 s e, quando condena,
  // a música para (relógio parado empilharia compassos) e o PRÓXIMO toque real resolve — pelo mesmo
  // caminho de sempre: retoma o que é retomável, troca o que não presta. Nunca cria contexto sozinho.

  /** Um tique a cada `VIGIA_MS`, a vida inteira do motor (setTimeout em cadeia: nunca dois). */
  private vigiar(): void {
    if (this.vigia !== null) return;
    this.vigia = setTimeout(() => {
      this.vigia = null;
      this.conferirSaude();
      this.vigiar();
    }, AudioEngine.VIGIA_MS);
  }

  /** O exame. Escondido ou no meio de outra fase, não mexe em nada — quem cuida é a máquina acima. */
  private conferirSaude(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!visivel() || this.fase === "fundo") { this.refDoVigia = null; return; }
    const estado = ctx.state as EstadoDoContexto;
    const agora = { ctx: ctx.currentTime, real: Date.now() };
    const ref = this.refDoVigia;
    this.refDoVigia = estado === "running" ? agora : null;
    if (++this.tiquesDoVigia % 5 === 0) this.registrarPulso(ctx, ref, agora);

    if (this.fase === "esperando-gesto") {
      // o zumbi voltou a andar sozinho (só demorou): absolvido — confere e a música volta, sem toque
      if (this.zumbi && !this.condenado && this.vereditoZumbi !== null && estado === "running"
        && agora.ctx - this.vereditoZumbi >= AudioEngine.AVANCO_MINIMO && !this.recuperacao) {
        this.zumbi = false;
        this.vereditoZumbi = null;
        diagAudio.registrar("vigia-absolveu", {});
        void this.iniciarRecuperacao({});
      }
      return;
    }
    if (this.fase !== "ativo") return;
    if (estado !== "running") {
      // o navegador tirou o áudio e o aviso não veio: o mesmo que o `statechange` faria
      diagAudio.registrar("vigia-parado", { estado });
      this.stopMusic();
      if (estado !== "closed") retomar(ctx, "vigia");
      this.esperarGesto();
      return;
    }
    const master = this.lerMaster();
    if (master === "nan") return this.condenar("envenenado");
    // relógio parado é "zumbi" (que tem absolvição se voltar a andar) — antes do "mudo", que não tem
    if (ref && agora.real - ref.real >= AudioEngine.GESTO_CONDENA_MS && agora.ctx - ref.ctx < AudioEngine.AVANCO_MINIMO) {
      return this.condenar("zumbi");
    }
    if (this.saidaMuda(master)) this.condenar("mudo");
  }

  /** Contexto que não presta mais: a música para e o próximo toque real troca por um novo. */
  private condenar(motivo: Condenacao): void {
    const ctx = this.ctx;
    if (!ctx) return;
    diagAudio.registrar("vigia-condenou", { motivo, fase: this.fase, estado: ctx.state, relogio: ctx.currentTime });
    if (motivo === "zumbi") {
      this.zumbi = true;
      this.vereditoZumbi = ctx.currentTime;
    } else {
      this.condenado = motivo;
    }
    // no fundo, ou já esperando/recuperando, só a marca muda: a máquina acima decide na hora certa
    if (this.fase !== "ativo") return;
    this.stopMusic();
    this.esperarGesto();
  }

  /**
   * O que sai do master agora: NaN/infinito (o compressor envenenado não volta a dar número), zero
   * ABSOLUTO, som, ou nada a ler (sem analisador).
   */
  private lerMaster(): "nan" | "zero" | "som" | null {
    const a = this.analisador;
    if (!a) return null;
    const buf = this.amostras ??= new Float32Array(a.fftSize);
    try {
      a.getFloatTimeDomainData(buf);
    } catch {
      return null;
    }
    let zero = true;
    for (const v of buf) {
      if (!Number.isFinite(v)) return "nan";
      if (v !== 0) zero = false;
    }
    if (!zero) this.analisadorProvado = true;
    return zero ? "zero" : "som";
  }

  /**
   * O GRAFO CALOU POR DENTRO: a música está agendada há segundos, o volume dela não é zero, e o
   * master dá ZERO ABSOLUTO em dois exames seguidos. Com a bossa no ar isso não acontece (a cauda do
   * reverb sozinha já não é zero). Só conta num analisador que já mostrou som neste contexto: um
   * analisador que sempre devolve zero (WebView que não o implementa direito) nunca condena — senão
   * a música pararia a cada 6 s para sempre.
   */
  private saidaMuda(master: "nan" | "zero" | "som" | null): boolean {
    const musicaNoAr = master !== null && this.prefs.music && this.musicTarget > 0 && this.musicTimer !== null
      && Date.now() - this.musicaDesde >= AudioEngine.MUDO_DEPOIS_MS;
    if (!musicaNoAr || master !== "zero" || !this.analisadorProvado) {
      this.zerosSeguidos = 0;
      return false;
    }
    return ++this.zerosSeguidos >= AudioEngine.EXAMES_MUDOS;
  }

  /** Diagnóstico DEBUG (só no APK de QA): um retrato a cada ~10 s. Nada de identidade, só áudio. */
  private registrarPulso(ctx: AudioContext, ref: { ctx: number; real: number } | null, agora: { ctx: number; real: number }): void {
    if (!diagAudio.ligado) return;
    let rms: number | null = null;
    if (this.analisador) {
      const buf = this.amostras ??= new Float32Array(this.analisador.fftSize);
      try {
        this.analisador.getFloatTimeDomainData(buf);
        let soma = 0;
        for (const v of buf) soma += v * v;
        rms = Math.sqrt(soma / buf.length);
      } catch { /* sem leitura */ }
    }
    diagAudio.registrar("pulso", {
      fase: this.fase, estado: ctx.state, relogio: Number(agora.ctx.toFixed(3)),
      andou: ref ? Number((agora.ctx - ref.ctx).toFixed(3)) : null,
      parede: ref ? agora.real - ref.real : null,
      rms: rms === null ? null : Number(rms.toFixed(5)),
      musica: this.musicTimer !== null, gesto: this.aoGesto !== null,
      compassoHaMs: this.compassoEm ? Date.now() - this.compassoEm : null,
      vozes: this.vozes,
      ganhoMaster: ganho(this.master), ganhoMusica: ganho(this.musicBus), ganhoEfeitos: ganho(this.sfxBus),
      ...saidaDoAparelho(ctx),
      provado: this.analisadorProvado,
      prefMusica: this.prefs.music, prefEfeitos: this.prefs.sfx,
      volMusica: this.prefs.musicVol, volEfeitos: this.prefs.sfxVol,
      visivel: visivel(), zumbi: this.zumbi, condenado: this.condenado, geracao: this.geracao,
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
    // Ida ao fundo no CELULAR = a saída física sob suspeita. No iPhone, interrupção real (V2,
    // 23/10). No Android (2º QA físico, 03/11): sem som contínuo o Chrome troca a saída real por
    // uma falsa depois de 30 s de silêncio e precisa destrocá-la na volta; rota de áudio
    // (Bluetooth/fone) que muda com o app no fundo deixa o contexto velho falando para o nada. Em
    // todos, o relógio anda e o JS não vê. A música volta sozinha e o 1º toque troca o contexto
    // por um novo — o caminho que o aparelho provou.
    if (ehMovel()) this.naoConfiavel = true;
    this.fase = "fundo";
    diagAudio.registrar("fundo", { estado: this.ctx.state, geracao: this.geracao });
  }

  /** Visível de novo (ou de volta do cache de página): UMA recuperação por volta. Nunca cria contexto. */
  aoVoltarParaPrimeiroPlano(): Promise<void> {
    if (!this.ctx || !visivel()) return Promise.resolve();
    if (this.voltaTratada === this.geracao) return this.recuperacao ?? Promise.resolve();
    this.voltaTratada = this.geracao;
    diagAudio.registrar("volta", { estado: this.ctx.state, geracao: this.geracao });
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
      } catch (e) {
        diagAudio.registrar("resume-recusado", { onde: "recuperar", erro: nomeDoErro(e) }); // o próximo gesto resolve
      }
      if (!vivo()) return;
      if (estado() !== "running") {
        // nem com gesto: na 2ª vez seguida o contexto fica condenado e o próximo gesto troca por um novo
        if (o.porGesto) this.falhasDoGesto++;
        return this.esperarGesto();
      }
    }
    const saude = await this.medirSaude(ctx, g, ref, o.janelas ?? AudioEngine.JANELAS);
    if (saude === "abortada" || !vivo()) return;
    diagAudio.registrar("medicao", { saude, estado: estado(), condenado: this.condenado, porGesto: !!o.porGesto });
    this.relogio = null;
    if (saude !== "saudavel" || estado() !== "running" || this.condenado) {
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
    diagAudio.registrar("gesto", { fase: this.fase, estado: ctx.state, zumbi: this.zumbi, condenado: this.condenado });
    if (this.precisaReconstruir(ctx)) {
      // uma tentativa por toque (o click que segue o touchend não tenta de novo); grafo que quebrou
      // no meio não insiste até a próxima volta — cada tentativa pode deixar um contexto aberto
      if (this.trocaBloqueada || Date.now() - this.trocaFalhouEm < 1000) return;
      return this.reconstruir();
    }
    if ((ctx.state as EstadoDoContexto) !== "running") retomar(ctx, "gesto");
    if (!this.recuperacao) void this.iniciarRecuperacao({ porGesto: true }); // confere o relógio depois do gesto
  }

  private precisaReconstruir(ctx: AudioContext): boolean {
    if ((ctx.state as EstadoDoContexto) === "closed" || this.zumbi || this.condenado || this.naoConfiavel) return true;
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
    // diagnóstico (só APK DEBUG): o motor como estava, ANTES de esta troca mexer em qualquer coisa
    if (DIAG_LIGADO) this.sonda?.registrarTroca("antes");
    const velho = this.grafoAtual();
    this.fase = "reconstruindo";
    this.geracao++;
    this.voltaTratada = this.geracao;
    this.cancelarEsperas();
    this.recuperacao = null;
    this.desarmarGesto();
    this.stopMusic(); // o agendador e a espera do compasso eram do contexto velho
    this.grafoQuebrou = false;
    diagAudio.registrar("reconstruir", { estadoVelho: velho?.ctx.state ?? null, geracao: this.geracao });
    let novo: Grafo | null;
    try {
      novo = this.montarGrafo();
    } catch {
      novo = null;
    }
    if (!novo) {
      diagAudio.registrar("reconstruir-falhou", { grafoQuebrou: this.grafoQuebrou });
      if (DIAG_LIGADO) this.sonda?.registrarTroca("falhou");
      // o aparelho não deu outro contexto (limite), ou o grafo quebrou no meio: fica no atual, se ele
      // ainda puder servir; senão, o próximo gesto tenta de novo (o que quebrou no meio, só na próxima volta)
      this.trocaFalhouEm = Date.now();
      if (this.grafoQuebrou) this.trocaBloqueada = true;
      this.naoConfiavel = false;
      const atual = this.ctx;
      const serve = atual && !this.zumbi && !this.condenado && this.falhasDoGesto < AudioEngine.FALHAS_QUE_CONDENAM
        && (atual.state as EstadoDoContexto) !== "closed";
      if (atual && serve) {
        retomar(atual, "troca-falhou"); // ainda dentro do gesto
        void this.iniciarRecuperacao({ porGesto: true });
      } else {
        this.esperarGesto();
      }
      return;
    }
    retomar(novo.ctx, "contexto-novo"); // ainda dentro do gesto
    this.assumir(novo);
    this.applyLevels();
    if (this.prefs.music) this.startMusic(); // só sai se o novo já estiver rodando; senão, a conferência liga
    if (velho) this.aposentar(velho);
    diagAudio.registrar("reconstruir-ok", { estadoNovo: novo.ctx.state, geracao: this.geracao });
    if (DIAG_LIGADO) this.sonda?.registrarTroca("depois");
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
          diagAudio.registrar("contexto-fechado", { estado: v.ctx.state, motivo: "aposentado" });
        });
    }, 80);
  }

  /** O navegador mudou o estado do contexto ATUAL (aposentado não conta). */
  private aoMudarEstado(ctx: AudioContext): void {
    if (ctx !== this.ctx) return;
    const antes = this.ultimoEstado;
    const agora = ctx.state as EstadoDoContexto;
    this.ultimoEstado = agora;
    diagAudio.registrar("estado", { antes, agora, fase: this.fase, visivel: visivel() });
    if (antes === "running" && agora !== "running") {
      // tiraram o áudio (fundo, ligação, outro app); no iPhone, este contexto fica sob suspeita
      if (ehMovel()) this.naoConfiavel = true;
      if (this.fase !== "fundo" && visivel()) {
        this.stopMusic(); // relógio parado empilharia compassos — em QUALQUER fase
        if (this.fase === "ativo") this.esperarGesto();
      }
    } else if (agora === "running" && antes !== "running" && this.fase === "esperando-gesto"
      && visivel() && !this.recuperacao && !this.zumbi && !this.condenado) {
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
    if (!ctx || !this.reverbIn || amount <= 0 || this.perfil.reverb === "nenhum") return;
    if (this.perfil.enviosCompartilhados) {
      // Rodada 8 (perfil leve): UM nó de envio por quantidade, ligado ao reverb de uma vez. A nota liga a
      // voz nele; quando ela acaba, `soltar` desliga a voz de tudo (inclusive dele). Mesma soma no reverb.
      let e = this.envios.get(amount);
      if (!e) {
        e = ctx.createGain();
        e.gain.value = amount;
        e.connect(this.reverbIn);
        this.envios.set(amount, e);
      }
      node.connect(e);
      return;
    }
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
    let f: BiquadFilterNode | null = null;
    if (o.cutoff !== undefined) {
      f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(o.cutoff, t);
      f.Q.value = 0.7;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(bus);
    this.send(g, space, t, dur);
    if (diagAudio.ligado) this.vozes++;
    osc.onended = () => { soltar(osc, f, g); if (diagAudio.ligado && ctx === this.ctx) this.vozes--; };
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
    if (diagAudio.ligado) this.vozes++;
    src.onended = () => { soltar(src, f, g); if (diagAudio.ligado && ctx === this.ctx) this.vozes--; };
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
      if (this.ctx.currentTime < this.inicioDoCompasso) {
        diagAudio.registrar("compasso-pulado", { relogio: this.ctx.currentTime, inicio: this.inicioDoCompasso });
        return;
      }
      this.compassoEm = Date.now();
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
          if (!tocaNotaDoViolao(this.perfil, i)) return; // variante D (só DEBUG)
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
        if (!tocaGanza(this.perfil, i)) continue; // variante D (só DEBUG)
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
    this.musicaDesde = Date.now();
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
    if (diagAudio.ligado) diagAudio.registrar("vibrar", { padrao: JSON.stringify(pattern) });
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
