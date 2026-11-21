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
  /**
   * O K de Copas é o castigo máximo: a pausa mais longa do jogo, porque é nela que mora a cena
   * "O REI FOI CAPTURADO" (`cenaDoRei`) seguida do destaque da mesa (`kCopasCaptura`).
   *
   * Era 3400ms, com a cena de 2s. A cena cresceu para 5s e a pausa cresceu junto: as duas somadas
   * cabem aqui com 150ms de folga (5000 + 1350 = 6350 ≤ 6500), para um `setTimeout` atrasado no
   * celular não cortar o fim do destaque.
   *
   * POR QUE ESTA PAUSA PODE SER LONGA SEM ROUBAR TEMPO DE NINGUÉM: capturar o K♥ ENCERRA a mão 5
   * (o motor fecha a mão quando a única carta penalizada sai). Depois desta pausa não vem a vez de
   * ninguém — vem o Placar. Nenhum bot joga durante ela e nenhum relógio de jogada corre contra
   * ela. O `cadencia.test.ts` prova isso com o motor e reprova se um dia deixar de ser verdade.
   *
   * Par no servidor: `leituraDaVazaKing` em `apps/server/src/match/tempos.ts` (contrato por teste).
   */
  leituraDaVazaKing: 6500,
  /**
   * O PLACAR DA MÃO DO REI FICA PARA SER LIDO — só na mão 5, contado do instante em que a vaza do
   * K♥ entra na mesa. 11500 = pausa do King (6500) + 4600 de leitura REAL do Placar (meta do
   * produto) + 400 de folga para timer atrasado no celular.
   *
   * O piso geral do Placar (8s, servidor) conta do fim da mão; depois de 6,5s de cena sobrava
   * ~1,5s de Placar. Solo: "Próxima mão" só responde depois disto (`placarDoRei.ts`). Online:
   * quem segura é o servidor, com o MESMO número (`pisoDoPlacarDoRei` em
   * `apps/server/src/match/tempos.ts`, contrato por teste). As outras nove mãos não mudam.
   */
  pisoDoPlacarDoRei: 11500,
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
   * DISTRIBUIÇÃO DO LEQUE: as 13 cartas saem do meio da mesa, uma a uma, e assentam no leque.
   * O movimento é só `translate`/`scale` transitórios: a posição FINAL de cada carta é a de sempre.
   * Par no theme.css: `.hand.distribuindo .card` (55ms por carta, 360ms cada) = 12×55 + 360.
   */
  distribuicaoDoLeque: 1020,
  /** POUSO NA VAZA: a carta chega, bate e assenta. Par no theme.css: `pousaNaVaza` (.26s). */
  pousoNaVaza: 260,
  /**
   * O REI FOI CAPTURADO — a cena central da mão 5 (`ReiCapturado.tsx`): 5000ms de presença, já
   * contadas a entrada e a saída; um toque encurta. Vem ANTES do destaque da mesa
   * (`kCopasCaptura`), nunca junto, e as duas somadas cabem na pausa do King:
   * 5000 + 1350 = 6350 ≤ `leituraDaVazaKing` (6500).
   *
   * Eram 2000ms, e o momento mais dramático da partida passava rápido demais: quem não estava
   * olhando para o aparelho naquele instante só via o selo. Cinco segundos dão tempo de a mesa
   * inteira ver quem pegou e quanto custou sem virar espera — a mão já acabou, ninguém tem jogada
   * a fazer (ver `leituraDaVazaKing`).
   */
  cenaDoRei: 5000,
  /**
   * K DE COPAS CAPTURADO: impacto, destaque e dissipação em 1350ms na mesa, DEPOIS da cena
   * (`cenaDoRei`), dentro da pausa do King (`leituraDaVazaKing`). Só existe enquanto o selo do castigo está na tela —
   * quem decide quem pegou é o motor, via `anunciarVaza`.
   * Par no theme.css: `kCaptura`, `kHalo`, `kOnda`, `kPenalizado`, `kSelo` (1.35s).
   */
  kCopasCaptura: 1350,

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
