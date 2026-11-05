// DIAGNÓSTICO DO ÁUDIO — SÓ no APK DEBUG de QA. Nunca em Production.
//
// O defeito do som no Android (2º QA físico do vc1, 03/11/2026) não se reproduz fora do aparelho.
// Este módulo grava, numa fita na memória do próprio aparelho, o que o motor de áudio vê: estado do
// AudioContext, quanto o relógio andou, nível do master, fase do ciclo, preferências, visibilidade,
// condenações e trocas. Cada linha também sai no console com o prefixo [KING-AUDIO] — no Android
// vai para o logcat (`adb logcat`), e no `chrome://inspect` aparece no console da WebView.
// Rodada 5 (sem cabo USB): a mesma fita alimenta o painel "Diagnóstico de áudio" do APK DEBUG, que
// monta um relatório e o exporta por ação explícita de quem testa (copiar/compartilhar/texto).
//
// NADA de rede, nada de identidade: nem token, nem id, nem apelido — só números e estados do áudio.
// A chave é uma constante de BUILD (`KING_DIAG_AUDIO=1` no ambiente do `vite build`, ver
// `vite.config.ts`): no build normal ela é `false`, e o ramo inteiro some do pacote.

export type Valor = string | number | boolean | null;
/** `t` = hora (ISO); `ms` = milissegundos desde que o diagnóstico começou (tempo relativo). */
export interface RegistroDeAudio { t: string; ms: number; evento: string; [campo: string]: Valor }

/** Retrato do motor num instante (só números e estados do áudio). */
export type Retrato = Record<string, Valor>;
export interface RetratoGuardado { rotulo: string; t: string; ms: number; r: Retrato }

export interface DiagnosticoDeAudio {
  readonly ligado: boolean;
  /** Quando o diagnóstico começou (ISO) — a origem do tempo relativo `ms`. */
  readonly inicio: string;
  registrar(evento: string, dados?: Record<string, Valor>): void;
  /** Põe `window.__kingAudio` para o console do chrome://inspect. */
  expor(api: Record<string, (...a: never[]) => unknown>): void;
  /** Cópia da fita (no máximo `MAX_FITA` linhas, da mais antiga para a mais nova). */
  fita(): RegistroDeAudio[];
  /** Quantas vezes cada evento aconteceu desde o início (a contagem não perde nada com o anel). */
  contagens(): Record<string, number>;
}

/** Linhas na fita: anel de tamanho fixo — memória limitada, nunca cresce. */
export const MAX_FITA = 600;
/** Texto livre num campo da fita é cortado aqui (nada de mensagem longa, nada que cresça). */
export const MAX_TEXTO = 80;
/** Nomes de evento distintos contados (os nomes vêm do código; o teto é só cinto de segurança). */
const MAX_EVENTOS_CONTADOS = 120;

/** Instante de referência do tempo relativo (carregamento do módulo). */
const T0 = Date.now();
export const msDesdeOInicio = (): number => Date.now() - T0;

/** Carimba um retrato com hora e tempo relativo. */
export function carimbar(rotulo: string, r: Retrato): RetratoGuardado {
  return { rotulo, t: new Date().toISOString(), ms: msDesdeOInicio(), r };
}

function cortar(v: Valor): Valor {
  return typeof v === "string" && v.length > MAX_TEXTO ? `${v.slice(0, MAX_TEXTO)}…` : v;
}

export function criarDiagnostico(saida: (linha: string) => void = (l) => console.info(l)): DiagnosticoDeAudio {
  const fita: RegistroDeAudio[] = [];
  const contagem = new Map<string, number>();
  return {
    ligado: true,
    inicio: new Date(T0).toISOString(),
    registrar(evento, dados = {}) {
      const r: RegistroDeAudio = { t: new Date().toISOString(), ms: msDesdeOInicio(), evento: String(cortar(evento)) };
      for (const [k, v] of Object.entries(dados)) {
        if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") r[k] = cortar(v);
      }
      fita.push(r);
      if (fita.length > MAX_FITA) fita.shift();
      if (contagem.has(r.evento) || contagem.size < MAX_EVENTOS_CONTADOS) {
        contagem.set(r.evento, (contagem.get(r.evento) ?? 0) + 1);
      }
      try { saida(`[KING-AUDIO] ${JSON.stringify(r)}`); } catch { /* console indisponível */ }
    },
    expor(api) {
      if (typeof window === "undefined") return;
      (window as unknown as { __kingAudio: unknown }).__kingAudio = { ...api, fita: () => fita.map((r) => ({ ...r })) };
    },
    fita: () => fita.map((r) => ({ ...r })),
    contagens: () => Object.fromEntries(contagem),
  };
}

const DESLIGADO: DiagnosticoDeAudio = {
  ligado: false, inicio: "", registrar() {}, expor() {}, fita: () => [], contagens: () => ({}),
};

/** Constante de build; nos testes (sem `define`) fica desligado. */
export const DIAG_LIGADO: boolean = typeof __KING_DIAG_AUDIO__ !== "undefined" && __KING_DIAG_AUDIO__;

export const diagAudio: DiagnosticoDeAudio = DIAG_LIGADO ? criarDiagnostico() : DESLIGADO;
