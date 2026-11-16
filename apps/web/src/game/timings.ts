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
  /**
   * Vaza que levou "bucha" (Dama, Rei/Valete, Copa, últimas): a mesa PARA para todos verem
   * quem se deu mal. Sem isso a rodada passava tão rápido que ninguém sabia quem tinha pegado
   * — e é justamente essa a graça do jogo.
   */
  leituraDaVazaCastigo: 2700,
  /** O K de Copas é o castigo máximo: pausa ainda maior. */
  leituraDaVazaKing: 3400,
  /**
   * Última vaza da mão. O Placar só entra DEPOIS desta pausa — antes ele cobria a mesa no
   * mesmo instante em que a vaza fechava, e o selo do castigo da última bucha nunca era visto.
   */
  fimDeMao: 1800,
  /**
   * Tempo que o chip "Sua vez" permanece OPACO (o anel dourado é o estado permanente).
   * A contagem só começa com a mesa livre — durante a pausa de leitura da vaza o chip expirava
   * sem nunca ter sido visto (ver Mesa.tsx).
   */
  chipSuaVez: 2200,
  /** Fade-out do chip "Sua vez". Par do `.suavez.out` no theme.css (.35s). */
  chipSuaVezSaida: 350,
  /** Duração do screen-shake do K de Copas. */
  shakeKing: 520,

  /**
   * DISTRIBUIÇÃO DO LEQUE: as 13 cartas aparecem uma a uma quando a mão é dada. Só opacidade —
   * nenhuma carta sai do lugar, então o leque mede o mesmo do primeiro ao último quadro.
   * Par no theme.css: `.hand.distribuindo .card` (35ms por carta, 280ms cada) = 12×35 + 280.
   */
  distribuicaoDoLeque: 700,
  /**
   * K DE COPAS CAPTURADO: o destaque da vaza que levou o K♥ na mão 5 dura 1100ms e cabe com
   * folga dentro da pausa do King (`leituraDaVazaKing`). Só existe enquanto o selo do castigo
   * está na tela — quem decide quem pegou é o motor, via `anunciarVaza`.
   * Par no theme.css: `.trick .slot .card.kcaptura`, `.trick.kcaptura::before` e `.kpenalizado`.
   */
  kCopasCaptura: 1100,

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
