// PERSISTÊNCIA DO TUTORIAL — local hoje, de perfil amanhã.
//
// Fica atrás de uma interface estreita de propósito. Quando existir conta e perfil remoto, o que
// muda é a implementação de `ArmazenamentoDoTutorial`; nem a tela nem o roteiro sabem de onde o
// progresso veio. É por isso que o resto do tutorial nunca toca `localStorage` diretamente.
//
// O que se guarda é o mínimo para responder três perguntas: já abriu alguma vez? já concluiu?
// onde parou? Nada de nome, nada de identificador de pessoa, nada de conteúdo de partida.

export interface ProgressoDoTutorial {
  /** Abriu o tutorial pelo menos uma vez (mesmo que tenha pulado no primeiro segundo). */
  iniciado: boolean;
  concluido: boolean;
  /** Índice do passo em que parou. Retomada. */
  passo: number;
}

export const PROGRESSO_ZERO: ProgressoDoTutorial = { iniciado: false, concluido: false, passo: 0 };

export interface ArmazenamentoDoTutorial {
  ler(): ProgressoDoTutorial;
  gravar(p: ProgressoDoTutorial): void;
}

const CHAVE = "king:tutorial";

/** Aceita só o que tem a forma certa. Dado corrompido vira progresso zero, nunca exceção. */
export function normalizar(bruto: unknown): ProgressoDoTutorial {
  if (!bruto || typeof bruto !== "object") return { ...PROGRESSO_ZERO };
  const o = bruto as Record<string, unknown>;
  const passo = typeof o.passo === "number" && Number.isFinite(o.passo) ? Math.max(0, Math.trunc(o.passo)) : 0;
  return {
    iniciado: o.iniciado === true,
    concluido: o.concluido === true,
    passo,
  };
}

/**
 * O armazenamento real.
 *
 * Toda operação é envolvida em `try`: aba anônima com storage bloqueado, cota estourada e JSON
 * corrompido são situações reais, e nenhuma delas pode impedir alguém de jogar. Sem persistência,
 * perde-se só a retomada: quem abrir o tutorial de novo recomeça do passo 1. Nada quebra, e a
 * Home continua sendo a primeira tela de qualquer jeito — ela não depende deste arquivo.
 */
export const armazenamentoLocal: ArmazenamentoDoTutorial = {
  ler() {
    try {
      const bruto = localStorage?.getItem(CHAVE);
      return bruto ? normalizar(JSON.parse(bruto)) : { ...PROGRESSO_ZERO };
    } catch {
      return { ...PROGRESSO_ZERO };
    }
  },
  gravar(p) {
    try {
      localStorage?.setItem(CHAVE, JSON.stringify(normalizar(p)));
    } catch {
      /* sem persistência: a próxima abertura do tutorial começa do passo 1, e é só */
    }
  },
};
