// DIAGNÓSTICO DO ÁUDIO — SÓ no APK DEBUG de QA. Nunca em Production.
//
// O defeito do som no Android (2º QA físico do vc1, 03/11/2026) não se reproduz fora do aparelho.
// Este módulo grava, numa fita na memória do próprio aparelho, o que o motor de áudio vê: estado do
// AudioContext, quanto o relógio andou, nível do master, fase do ciclo, preferências, visibilidade,
// condenações e trocas. Cada linha também sai no console com o prefixo [KING-AUDIO] — no Android
// vai para o logcat (`adb logcat`), e no `chrome://inspect` aparece no console da WebView.
//
// NADA de rede, nada de identidade: nem token, nem id, nem apelido — só números e estados do áudio.
// A chave é uma constante de BUILD (`KING_DIAG_AUDIO=1` no ambiente do `vite build`, ver
// `vite.config.ts`): no build normal ela é `false`, e o ramo inteiro some do pacote.

type Valor = string | number | boolean | null;
export interface RegistroDeAudio { t: string; evento: string; [campo: string]: Valor }

export interface DiagnosticoDeAudio {
  readonly ligado: boolean;
  registrar(evento: string, dados?: Record<string, Valor>): void;
  /** Põe `window.__kingAudio` para o console do chrome://inspect. */
  expor(api: Record<string, (...a: never[]) => unknown>): void;
}

const MAX = 600;

export function criarDiagnostico(saida: (linha: string) => void = (l) => console.info(l)): DiagnosticoDeAudio {
  const fita: RegistroDeAudio[] = [];
  return {
    ligado: true,
    registrar(evento, dados = {}) {
      const r: RegistroDeAudio = { t: new Date().toISOString(), evento, ...dados };
      fita.push(r);
      if (fita.length > MAX) fita.shift();
      try { saida(`[KING-AUDIO] ${JSON.stringify(r)}`); } catch { /* console indisponível */ }
    },
    expor(api) {
      if (typeof window === "undefined") return;
      (window as unknown as { __kingAudio: unknown }).__kingAudio = { ...api, fita: () => fita.map((r) => ({ ...r })) };
    },
  };
}

const DESLIGADO: DiagnosticoDeAudio = { ligado: false, registrar() {}, expor() {} };

/** Constante de build; nos testes (sem `define`) fica desligado. */
const LIGADO = typeof __KING_DIAG_AUDIO__ !== "undefined" && __KING_DIAG_AUDIO__;

export const diagAudio: DiagnosticoDeAudio = LIGADO ? criarDiagnostico() : DESLIGADO;
