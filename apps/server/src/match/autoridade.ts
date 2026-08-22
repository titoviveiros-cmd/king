// AUTORIDADE DA PARTIDA — validação e aplicação de intenções (Fase 3).
//
// Puro: não conhece Colyseus, WebSocket nem cliente. Recebe (assento, intenção) e devolve um
// resultado. Isso torna a regra de autoridade testável sem rede, e deixa a `KingRoom` como
// transporte e fan-out.
//
// NENHUMA REGRA DE KING VIVE AQUI. Quem decide legalidade, resolução de vaza, pontuação e
// transição de mão é `@king/engine`. Esta classe coordena: identifica o assento pela sessão,
// aplica idempotência e versão, e chama o motor. `playCard` do motor revalida e **lança** em
// jogada ilegal — é a trava final, mesmo que uma checagem daqui falhe.
import {
  SUITS, buildBotView, cardId, chooseNormalCard, chooseNormalTrump, createMatch, legalCardsFor,
  playCard, redactFor, selectTrump, startNextHand,
  type Card, type MatchState, type PlayerView, type Seat, type Trump,
} from "@king/engine";

/** Códigos estáveis. O cliente recebe o código; a mensagem é humana e **nunca** carrega stack. */
export const ERRO = {
  MATCH_NOT_STARTED: "MATCH_NOT_STARTED",
  MATCH_ALREADY_STARTED: "MATCH_ALREADY_STARTED",
  ROOM_NOT_FULL: "ROOM_NOT_FULL",
  NOT_HOST: "NOT_HOST",
  WRONG_PHASE: "WRONG_PHASE",
  NOT_YOUR_TURN: "NOT_YOUR_TURN",
  CARD_NOT_OWNED: "CARD_NOT_OWNED",
  ILLEGAL_CARD: "ILLEGAL_CARD",
  INVALID_TRUMP: "INVALID_TRUMP",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  STALE_ACTION: "STALE_ACTION",
  HAND_NOT_OVER: "HAND_NOT_OVER",
} as const;
export type CodigoDeErro = (typeof ERRO)[keyof typeof ERRO];

/**
 * Resultado de um READY. `consenso` diz que os quatro pediram — mas **não avança nada**.
 * Quem decide QUANDO avançar é a Room, porque o avanço tem um piso de tempo (o Placar
 * entre-mãos precisa ser lido) e esta classe é deliberadamente atemporal.
 */
export type ResultadoPronto =
  | { ok: true; duplicada: boolean; consenso: boolean; prontos: Seat[]; stateVersion: number }
  | { ok: false; code: CodigoDeErro; message: string };

export type Resultado =
  /** Aplicada agora: o estado mudou e a versão avançou. */
  | { ok: true; duplicada: false; stateVersion: number }
  /** Já tinha sido aplicada (mesma `actionId`): NADA foi executado de novo. */
  | { ok: true; duplicada: true; stateVersion: number }
  | { ok: false; code: CodigoDeErro; message: string };

/** Forma de erro comum aos dois resultados — por isso o tipo é o do ramo, não a união. */
const falha = (code: CodigoDeErro, message: string): { ok: false; code: CodigoDeErro; message: string } =>
  ({ ok: false, code, message });

/** Domínio oficial do trunfo. Qualquer coisa fora disto é recusada antes de chegar ao motor. */
const TRUMPS: readonly Trump[] = [...SUITS, "no-trump"];
const trumpValido = (t: unknown): t is Trump => TRUMPS.includes(t as Trump);

/** Campos comuns a toda intenção de gameplay. */
export interface Intencao {
  actionId: string;
  /** Opcional. Se vier, precisa bater com a versão corrente — ver `verificarVersao`. */
  expectedStateVersion?: number;
}

export class AutoridadeDaPartida {
  /**
   * SERVER-ONLY. Carrega mãos completas e a semente (que sozinha reconstrói o baralho).
   * Privado de verdade: nada fora desta classe alcança o objeto — só `visaoDe()`, que redige.
   */
  #match: MatchState | null = null;
  #matchId = "";
  #stateVersion = 0;
  /** `playerId:actionId` → versão em que foi aplicada. Base da idempotência. */
  #aplicadas = new Map<string, number>();
  /** Consenso entre-mãos: quem já pediu a próxima. Sempre atrelado a UMA mão. */
  #prontos = new Set<Seat>();
  /** Mão a que o consenso corrente se refere — um ready de mão antiga nunca conta. */
  #maoDoConsenso = 0;

  get iniciada(): boolean { return this.#match !== null; }
  /** Quem já pediu a próxima mão (ordenado, para leitura estável). */
  get prontos(): Seat[] { return [...this.#prontos].sort(); }
  get stateVersion(): number { return this.#stateVersion; }
  get matchId(): string { return this.#matchId; }

  /** Visão redigida de um assento — a ÚNICA saída de estado desta classe. */
  visaoDe(seat: Seat): PlayerView | null {
    return this.#match === null ? null : redactFor(this.#match, seat);
  }

  /**
   * Leitura SERVER-ONLY para as decisões do próprio servidor (ex.: bots na Fase 8).
   * Nunca deve ser serializada para um cliente — quem faz isso é `visaoDe`.
   */
  estadoAutoritativo(): MatchState | null { return this.#match; }

  /**
   * Cria a partida. A **semente é do servidor**: nunca vem do cliente nem das opções da sala.
   * Um cliente que pudesse escolher a semente escolheria a distribuição.
   */
  iniciar(jogadores: string[], matchId: string, seed: number): Resultado {
    if (this.#match !== null) return falha(ERRO.MATCH_ALREADY_STARTED, "A partida já começou");
    if (jogadores.length !== 4) return falha(ERRO.ROOM_NOT_FULL, "KING exige quatro jogadores");
    this.#match = createMatch(jogadores, seed);
    startNextHand(this.#match);
    this.#matchId = matchId;
    this.#stateVersion = 1;
    return { ok: true, duplicada: false, stateVersion: this.#stateVersion };
  }

  jogarCarta(seat: Seat, playerId: string, acao: Intencao & { cardId: string }): Resultado {
    const m = this.#match;
    if (m === null) return falha(ERRO.MATCH_NOT_STARTED, "A partida ainda não começou");
    if (typeof acao?.actionId !== "string" || !acao.actionId) {
      return falha(ERRO.INVALID_PAYLOAD, "actionId ausente");
    }
    if (typeof acao.cardId !== "string" || !acao.cardId) {
      return falha(ERRO.INVALID_PAYLOAD, "cardId ausente");
    }

    const repetida = this.#jaAplicada(playerId, acao.actionId);
    if (repetida !== null) return { ok: true, duplicada: true, stateVersion: repetida };

    const versao = this.#verificarVersao(acao.expectedStateVersion);
    if (versao) return versao;

    const h = m.hand;
    if (!h || h.handScores !== null) return falha(ERRO.WRONG_PHASE, "Nenhuma mão em andamento");
    if (h.awaitingTrumpFrom !== null) return falha(ERRO.WRONG_PHASE, "A mão aguarda a escolha do trunfo");
    if (h.turn !== seat) return falha(ERRO.NOT_YOUR_TURN, "Não é a sua vez");

    // A carta precisa estar na mão DESTE assento. Uma carta alheia cai aqui — e a mensagem não
    // revela de quem é, para não transformar o erro num canal de informação.
    const carta = h.hands[seat].find((c) => cardId(c) === acao.cardId);
    if (!carta) return falha(ERRO.CARD_NOT_OWNED, "Você não tem essa carta");

    const legais = legalCardsFor(m, seat);
    if (!legais.some((c) => cardId(c) === acao.cardId)) {
      return falha(ERRO.ILLEGAL_CARD, "Essa carta não é legal agora");
    }

    return this.#aplicar(playerId, acao.actionId, () => playCard(m, seat, carta as Card));
  }

  escolherTrunfo(seat: Seat, playerId: string, acao: Intencao & { trump: Trump }): Resultado {
    const m = this.#match;
    if (m === null) return falha(ERRO.MATCH_NOT_STARTED, "A partida ainda não começou");
    if (typeof acao?.actionId !== "string" || !acao.actionId) {
      return falha(ERRO.INVALID_PAYLOAD, "actionId ausente");
    }
    if (!trumpValido(acao.trump)) return falha(ERRO.INVALID_TRUMP, "Trunfo fora do domínio oficial");

    const repetida = this.#jaAplicada(playerId, acao.actionId);
    if (repetida !== null) return { ok: true, duplicada: true, stateVersion: repetida };

    const versao = this.#verificarVersao(acao.expectedStateVersion);
    if (versao) return versao;

    const h = m.hand;
    if (!h || h.awaitingTrumpFrom === null) {
      return falha(ERRO.WRONG_PHASE, "Esta mão não aguarda escolha de trunfo");
    }
    if (h.awaitingTrumpFrom !== seat) return falha(ERRO.NOT_YOUR_TURN, "O trunfo não é seu para escolher");

    return this.#aplicar(playerId, acao.actionId, () => selectTrump(m, seat, acao.trump));
  }

  /**
   * CONSENSO ENTRE-MÃOS. O servidor **não** avança sozinho — o Placar entre-mãos precisa de um
   * momento de leitura, e antecipá-lo destruiria o ritmo aprovado no iPhone. E nenhum jogador
   * isolado avança a partida: só quando os QUATRO pedem.
   *
   * O consenso é atrelado ao NÚMERO DA MÃO. Se a mão mudou desde o último ready, o conjunto é
   * zerado antes de contar — assim um ready atrasado, de uma mão que já passou, nunca soma.
   */
  marcarPronto(seat: Seat, playerId: string, acao: Intencao): ResultadoPronto {
    const m = this.#match;
    if (m === null) return falha(ERRO.MATCH_NOT_STARTED, "A partida ainda não começou");
    if (typeof acao?.actionId !== "string" || !acao.actionId) {
      return falha(ERRO.INVALID_PAYLOAD, "actionId ausente");
    }

    const repetida = this.#jaAplicada(playerId, acao.actionId);
    if (repetida !== null) {
      return {
        ok: true, duplicada: true, consenso: this.#prontos.size === 4,
        prontos: this.prontos, stateVersion: this.#stateVersion,
      };
    }

    const versao = this.#verificarVersao(acao.expectedStateVersion);
    if (versao) return versao;

    // GAME OVER: nenhum consenso cria a 11ª mão.
    if (m.finished) return falha(ERRO.WRONG_PHASE, "A partida já terminou");
    if (!m.hand || m.hand.handScores === null) return falha(ERRO.HAND_NOT_OVER, "A mão ainda não acabou");

    if (this.#maoDoConsenso !== m.hand.handNumber) {
      this.#prontos.clear();
      this.#maoDoConsenso = m.hand.handNumber;
    }
    this.#prontos.add(seat);
    // Registrar a actionId SEM avançar versão: pedir a próxima não altera o estado da partida.
    this.#aplicadas.set(this.#chave(playerId, acao.actionId), this.#stateVersion);

    return {
      ok: true,
      duplicada: false,
      consenso: this.#prontos.size === 4,
      prontos: this.prontos,
      stateVersion: this.#stateVersion,
    };
  }

  /**
   * Avança de fato para a próxima mão. Só a Room chama, e só depois do piso de leitura.
   * Reconfere o consenso: um assento que saiu entre o pedido e o avanço invalida a decisão.
   */
  avancarMao(): Resultado {
    const m = this.#match;
    if (m === null) return falha(ERRO.MATCH_NOT_STARTED, "A partida ainda não começou");
    if (m.finished) return falha(ERRO.WRONG_PHASE, "A partida já terminou");
    if (!m.hand || m.hand.handScores === null) return falha(ERRO.HAND_NOT_OVER, "A mão ainda não acabou");
    if (this.#prontos.size < 4) return falha(ERRO.WRONG_PHASE, "Ainda falta gente pedir a próxima");

    startNextHand(m);
    this.#stateVersion += 1;
    this.#prontos.clear();
    this.#maoDoConsenso = 0;
    return { ok: true, duplicada: false, stateVersion: this.#stateVersion };
  }

  // ─────────────── decisões automáticas (assistência) ───────────────
  //
  // Passam pela MESMA fronteira anti-cheat do bot da Mesa: `buildBotView` projeta só o público
  // + a própria mão, e `chooseNormalCard`/`chooseNormalTrump` não importam `MatchState`.
  // Não existe versão privilegiada do bot para multiplayer.

  /** Carta que o Bot Normal jogaria por este assento — `null` se não houver o que jogar. */
  cartaAutomatica(seat: Seat): string | null {
    const m = this.#match;
    if (!m || !m.hand || m.hand.handScores !== null || m.hand.turn !== seat) return null;
    return cardId(chooseNormalCard(buildBotView(m, seat)));
  }

  /** Trunfo que o Bot Normal escolheria — SÓ com as 13 cartas do próprio assento. */
  trunfoAutomatico(seat: Seat): Trump | null {
    const m = this.#match;
    if (!m || !m.hand || m.hand.awaitingTrumpFrom !== seat) return null;
    return chooseNormalTrump(buildBotView(m, seat).hand);
  }

  // ───────────────────────── internos ─────────────────────────

  #chave(playerId: string, actionId: string): string { return `${playerId}:${actionId}`; }

  #jaAplicada(playerId: string, actionId: string): number | null {
    const v = this.#aplicadas.get(this.#chave(playerId, actionId));
    return v === undefined ? null : v;
  }

  /**
   * Versão declarada pelo cliente.
   *
   * `expectedStateVersion` é OPCIONAL: cliente que não acompanha versão não é punido. Quando vem,
   * a checagem é de igualdade estrita — e isso **não rejeita ação válida** porque KING é por
   * turnos: enquanto é a sua vez, ninguém mais move o estado, então a versão fica parada até você
   * agir. Uma versão atrasada significa, de fato, que você decidiu sobre uma mesa que já mudou.
   * Versão à frente da do servidor é payload inválido, não atraso.
   */
  #verificarVersao(esperada: number | undefined): { ok: false; code: CodigoDeErro; message: string } | null {
    if (esperada === undefined) return null;
    if (!Number.isInteger(esperada) || esperada < 0) {
      return falha(ERRO.INVALID_PAYLOAD, "expectedStateVersion inválida");
    }
    if (esperada > this.#stateVersion) {
      return falha(ERRO.INVALID_PAYLOAD, "expectedStateVersion à frente do servidor");
    }
    if (esperada < this.#stateVersion) {
      return falha(ERRO.STALE_ACTION, "O estado mudou desde a sua leitura");
    }
    return null;
  }

  /**
   * Aplica no motor e só então avança a versão e registra a `actionId`.
   * Se o motor lançar (é a autoridade final), nada é registrado e a versão **não** avança —
   * uma ação recusada nunca consome versão.
   */
  #aplicar(playerId: string, actionId: string, efeito: () => void): Resultado {
    try {
      efeito();
    } catch (e) {
      return falha(ERRO.ILLEGAL_CARD, e instanceof Error ? e.message : "Ação recusada pelo motor");
    }
    this.#stateVersion += 1;
    this.#aplicadas.set(this.#chave(playerId, actionId), this.#stateVersion);
    return { ok: true, duplicada: false, stateVersion: this.#stateVersion };
  }
}
