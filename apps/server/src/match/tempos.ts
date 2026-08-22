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
