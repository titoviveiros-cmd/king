/**
 * Tokens de RITMO da apresentação.
 *
 * Centralizados por decisão de auditoria: o ajuste fino acontece aqui, não espalhado pelos
 * componentes. **Não existe opção de velocidade para o jogador** — quando existir
 * ("Animações rápidas"), será um multiplicador sobre estes valores e **nunca** tocará em regra:
 * o motor é síncrono e não conhece tempo.
 *
 * Os valores em CSS que acompanham estes (transição do ranking, descida da coroa) estão
 * marcados com o comentário `// par de TEMPOS.fim` no `theme.css`.
 */
export const TEMPOS = {
  /** Intervalo entre passos dos bots (jogar carta, escolher trunfo). */
  botPasso: 520,
  /** Pausa para ler a vaza resolvida antes de recolher as cartas. */
  leituraDaVaza: 1150,
  /** Tempo que o chip "Sua vez" permanece visível (o anel dourado é o estado permanente). */
  chipSuaVez: 2200,
  /** Duração do screen-shake do K de Copas. */
  shakeKing: 520,

  /**
   * Placar Final — marcos da encenação. Teto aprovado: **4300ms**.
   * As micro-pausas entre etapas são deliberadas e devem permanecer perceptíveis:
   *   contagem termina em 900+1150 = 2050 → 300ms de respiro → ranking em 2350
   *   ranking termina em 2350+620 = 2970 → 330ms de respiro → coroação em 3300
   *   coroação → 1000ms até a tela completa em 4300
   */
  fim: {
    contagem: 900,
    ranking: 2350,
    campeao: 3300,
    completo: 4300,
    /** Duração da contagem de pontos (cabe entre `contagem` e `ranking` com folga). */
    duracaoContagem: 1150,
    /** Quanto tempo o burst de partículas fica na tela antes de sumir por completo. */
    burstParticulas: 1700,
  },
} as const;
