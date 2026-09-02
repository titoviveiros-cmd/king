// TOKENS DE TEMPO DO SERVIDOR — a única fonte dos prazos autoritativos.
//
// Nenhum número mágico espalhado pelo código: tudo passa por aqui. São decisões de PRODUTO
// (Fase 7A, D2/D4/D5/D6), portanto ajustáveis sem tocar em lógica.
//
// POR QUE SÃO MUTÁVEIS
// Os testes precisam exercitar prazos em milissegundos — esperar 25 s reais por caso tornaria a
// suíte lenta e intermitente. `configurarTempos` existe para isso e **nunca é chamado em
// produção**; não há caminho a partir de mensagem de cliente que chegue aqui.

export interface Tempos {
  /** Prazo padrão de uma jogada. */
  turno: number;
  /** Acréscimo na PRIMEIRA jogada da mão: 13 cartas novas e um contrato novo para ler. */
  primeiraJogadaExtra: number;
  /** Escolha de trunfo: decisão única, define a mão inteira, 5 opções sobre 13 cartas. */
  trunfo: number;
  /** Aviso ao próprio jogador, em tempo RESTANTE. */
  aviso: number;
  /** Estado crítico, visível a todos, em tempo RESTANTE. */
  critico: number;
  /** Piso de leitura do Placar entre-mãos: ninguém avança antes disso, nem com os quatro prontos. */
  pisoDoPlacar: number;
  /** Ausente vira pronto automaticamente depois disto (contado do fim da mão). */
  autoReadyDesconectado: number;
  /** Conectado que não confirma vira pronto automaticamente depois disto. */
  autoReadyConectado: number;
  /**
   * Enquanto um assento está sendo assistido, o bot não age instantaneamente: a mesa precisa
   * acompanhar visualmente o que aconteceu.
   */
  cortesiaDoBot: number;
  /**
   * RESPIRO DA ABERTURA DA ÚLTIMA MÃO — o único lugar em que o servidor sabe da apresentação.
   *
   * O cliente anuncia "ÚLTIMA MÃO" quando a décima começa, e durante o anúncio a Mesa não
   * apresenta nada da mão nova: nem trunfo, nem leque, nem vaza. O servidor não sabe do anúncio
   * e não deveria saber. O que ele sabe é que a PRIMEIRA decisão da última mão acontece enquanto
   * ninguém ainda está olhando para a mesa.
   *
   * Sem isto o cliente teria de escolher entre dois defeitos: deixar a partida correr atrás do
   * véu (que é o defeito que esta rodada veio corrigir) ou represar a apresentação e ficar para
   * trás — com quem escolhe o trunfo perdendo o tempo do anúncio do próprio prazo, e um bot
   * decidindo por trás dele. Nenhum dos dois se resolve só no cliente: o prazo é autoritativo.
   *
   * O valor é o par de `DURACAO_MS + SAIDA_MS` de `apps/web/src/ui/UltimaMao.tsx`. Não é folga
   * arbitrária: é exatamente a presença do anúncio, e o teste de contrato compara os dois.
   */
  aberturaDaUltimaMao: number;
  /**
   * ══ OS TEMPOS DA APRESENTAÇÃO QUE O SERVIDOR PRECISA CONHECER ══
   *
   * Estes cinco NÃO são prazos de decisão: são a cópia autoritativa de tempos que existem no
   * cliente. O servidor não os usa para esperar nem para animar nada — usa para saber QUANTO
   * TEMPO o jogador passou impedido de agir, e não cobrar esse tempo do prazo dele.
   *
   * É o mesmo desenho de `aberturaDaUltimaMao`, que já vive aqui pelo mesmo motivo: quando a
   * apresentação legitimamente impede alguém de jogar, o prazo autoritativo tem de saber disso,
   * senão o jogador perde tempo por um motivo que não é dele. Um teste de contrato compara cada
   * um destes com `apps/web/src/game/timings.ts` e reprova se os dois lados se separarem.
   */
  /** Pausa de leitura de uma vaza comum. */
  leituraDaVaza: number;
  /** Vaza que levou bucha: a mesa para mais tempo para todos verem quem se deu mal. */
  leituraDaVazaCastigo: number;
  /** O K de Copas é o castigo máximo: pausa ainda maior. */
  leituraDaVazaKing: number;
  /** Última vaza da mão — o Placar só entra depois dela. */
  fimDeMao: number;
  /** Intervalo com que o cliente apresenta um passo represado. */
  passoDaApresentacao: number;

  /** No LOBBY, o assento de quem cai fica reservado por este tempo. Depois é liberado. */
  lobbyReservaAposQueda: number;
  /** Sala sem nenhuma conexão viva morre depois disto. Evita sala órfã eterna. */
  salaOrfa: number;
}

/** Valores de produto congelados na Fase 7A (decisões D2, D4, D5, D6). */
export const TEMPOS_PADRAO: Readonly<Tempos> = Object.freeze({
  turno: 25_000,
  primeiraJogadaExtra: 15_000,
  trunfo: 45_000,
  aviso: 10_000,
  critico: 5_000,
  pisoDoPlacar: 8_000,
  autoReadyDesconectado: 20_000,
  autoReadyConectado: 45_000,
  cortesiaDoBot: 900,
  aberturaDaUltimaMao: 3_720,
  leituraDaVaza: 1_150,
  leituraDaVazaCastigo: 2_700,
  leituraDaVazaKing: 3_400,
  fimDeMao: 1_800,
  passoDaApresentacao: 520,
  lobbyReservaAposQueda: 60_000,
  salaOrfa: 120_000,
});

export const TEMPOS: Tempos = { ...TEMPOS_PADRAO };

/** Só para testes. Produção nunca chama. */
export function configurarTempos(parcial: Partial<Tempos>): void {
  Object.assign(TEMPOS, parcial);
}

export function restaurarTempos(): void {
  Object.assign(TEMPOS, TEMPOS_PADRAO);
}
