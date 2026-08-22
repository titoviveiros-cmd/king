// AUTORIDADE — testes de unidade (sem rede, sem Colyseus).
//
// Exercitam exatamente o código que a `KingRoom` chama, mas sem WebSocket: rápido, determinístico
// e capaz de montar cenários que levariam muitas vazas para acontecer por acaso.
import { describe, expect, it } from "vitest";
import { SUITS, cardId, legalCardsFor, type Card, type Seat, type Trump } from "@king/engine";
import { AutoridadeDaPartida, ERRO } from "./autoridade.js";

const P = ["P0", "P1", "P2", "P3"];
const SEATS: Seat[] = [0, 1, 2, 3];
let n = 0;
const acao = () => `a${++n}`;

function nova(seed = 42): AutoridadeDaPartida {
  const a = new AutoridadeDaPartida();
  a.iniciar(P, "m1", seed);
  return a;
}

/** Quem é a vez, lendo o estado autoritativo (o TESTE pode; um cliente não). */
const vez = (a: AutoridadeDaPartida): Seat => a.estadoAutoritativo()!.hand!.turn as Seat;
const mao = (a: AutoridadeDaPartida, s: Seat): Card[] => a.estadoAutoritativo()!.hand!.hands[s];

/** Joga a primeira carta legal do assento da vez. */
function jogarLegal(a: AutoridadeDaPartida): void {
  const s = vez(a);
  const legais = legalCardsFor(a.estadoAutoritativo()!, s);
  const r = a.jogarCarta(s, P[s], { actionId: acao(), cardId: cardId(legais[0]) });
  expect(r.ok).toBe(true);
}

describe("início da partida", () => {
  it("cria a partida pelo motor e a versão começa em 1", () => {
    const a = new AutoridadeDaPartida();
    expect(a.iniciada).toBe(false);
    expect(a.stateVersion).toBe(0);
    const r = a.iniciar(P, "m1", 7);
    expect(r.ok).toBe(true);
    expect(a.iniciada).toBe(true);
    expect(a.stateVersion).toBe(1);
    const m = a.estadoAutoritativo()!;
    expect(m.handNumber).toBe(1);
    expect(m.hand!.contract.kind).toBe("no-tricks");
    for (const s of SEATS) expect(m.hand!.hands[s]).toHaveLength(13);
  });

  it("recusa iniciar duas vezes e recusa sala incompleta", () => {
    const a = nova();
    expect(a.iniciar(P, "m2", 1)).toMatchObject({ ok: false, code: ERRO.MATCH_ALREADY_STARTED });
    const b = new AutoridadeDaPartida();
    expect(b.iniciar(["só", "três"], "m3", 1)).toMatchObject({ ok: false, code: ERRO.ROOM_NOT_FULL });
  });

  it("antes de iniciar, toda intenção de gameplay é recusada", () => {
    const a = new AutoridadeDaPartida();
    expect(a.jogarCarta(0, P[0], { actionId: acao(), cardId: "A-spades" }))
      .toMatchObject({ ok: false, code: ERRO.MATCH_NOT_STARTED });
    expect(a.escolherTrunfo(0, P[0], { actionId: acao(), trump: "hearts" }))
      .toMatchObject({ ok: false, code: ERRO.MATCH_NOT_STARTED });
    expect(a.visaoDe(0)).toBeNull();
  });
});

describe("PLAY_CARD — caminho legal", () => {
  it("aplica a jogada, avança a versão e passa o turno", () => {
    const a = nova();
    const s = vez(a);
    const versaoAntes = a.stateVersion;
    const carta = legalCardsFor(a.estadoAutoritativo()!, s)[0];

    const r = a.jogarCarta(s, P[s], { actionId: acao(), cardId: cardId(carta) });

    expect(r).toMatchObject({ ok: true, duplicada: false });
    expect(a.stateVersion).toBe(versaoAntes + 1);
    expect(mao(a, s).map(cardId)).not.toContain(cardId(carta));
    expect(mao(a, s)).toHaveLength(12);
    expect(a.estadoAutoritativo()!.hand!.currentTrick).toHaveLength(1);
    expect(vez(a)).not.toBe(s);
  });
});

describe("PLAY_CARD — ações ilegais não mudam nada", () => {
  it("F · fora do turno: recusa e o turno permanece com quem é de direito", () => {
    const a = nova();
    const daVez = vez(a);
    const outro = ((daVez + 1) % 4) as Seat;
    const versao = a.stateVersion;
    const carta = mao(a, outro)[0];

    const r = a.jogarCarta(outro, P[outro], { actionId: acao(), cardId: cardId(carta) });

    expect(r).toMatchObject({ ok: false, code: ERRO.NOT_YOUR_TURN });
    expect(a.stateVersion).toBe(versao);
    expect(vez(a)).toBe(daVez);
    expect(mao(a, outro)).toHaveLength(13);
    expect(a.estadoAutoritativo()!.hand!.currentTrick).toHaveLength(0);
  });

  it("G · carta que o jogador não tem (está na mão adversária): recusa sem vazar de quem é", () => {
    const a = nova();
    const s = vez(a);
    const outro = ((s + 1) % 4) as Seat;
    const alheia = mao(a, outro)[0];
    const versao = a.stateVersion;

    const r = a.jogarCarta(s, P[s], { actionId: acao(), cardId: cardId(alheia) });

    expect(r).toMatchObject({ ok: false, code: ERRO.CARD_NOT_OWNED });
    if (!r.ok) {
      expect(r.message).not.toContain(String(outro));
      expect(r.message).not.toContain(alheia.suit);
      expect(r.message).not.toContain(alheia.rank);
    }
    expect(a.stateVersion).toBe(versao);
    expect(mao(a, outro)).toHaveLength(13);
  });

  it("H · baldar tendo o naipe puxado: recusa por ILLEGAL_CARD", () => {
    const a = nova();
    const lider = vez(a);
    const abertura = legalCardsFor(a.estadoAutoritativo()!, lider)[0];
    a.jogarCarta(lider, P[lider], { actionId: acao(), cardId: cardId(abertura) });

    const seguidor = vez(a);
    const temONaipe = mao(a, seguidor).filter((c) => c.suit === abertura.suit);
    const fora = mao(a, seguidor).find((c) => c.suit !== abertura.suit);
    if (temONaipe.length === 0 || !fora) return; // cenário não aplicável nesta distribuição

    const versao = a.stateVersion;
    const r = a.jogarCarta(seguidor, P[seguidor], { actionId: acao(), cardId: cardId(fora) });

    expect(r).toMatchObject({ ok: false, code: ERRO.ILLEGAL_CARD });
    expect(a.stateVersion).toBe(versao);
    expect(mao(a, seguidor)).toHaveLength(13);
  });

  it("payload malformado: recusa por INVALID_PAYLOAD, sem derrubar nada", () => {
    const a = nova();
    const s = vez(a);
    const versao = a.stateVersion;
    const ruins = [
      { actionId: "", cardId: "A-spades" },
      { actionId: acao(), cardId: "" },
      { actionId: acao() } as unknown as { actionId: string; cardId: string },
      undefined as unknown as { actionId: string; cardId: string },
    ];
    for (const ruim of ruins) {
      expect(a.jogarCarta(s, P[s], ruim)).toMatchObject({ ok: false, code: ERRO.INVALID_PAYLOAD });
    }
    expect(a.stateVersion).toBe(versao);
    expect(a.iniciada).toBe(true);
  });

  it("cardId inexistente no baralho: recusa como carta não possuída", () => {
    const a = nova();
    const s = vez(a);
    const versao = a.stateVersion;
    expect(a.jogarCarta(s, P[s], { actionId: acao(), cardId: "Z-unicorns" }))
      .toMatchObject({ ok: false, code: ERRO.CARD_NOT_OWNED });
    expect(a.stateVersion).toBe(versao);
  });
});

describe("I · idempotência por actionId", () => {
  it("a mesma actionId do mesmo jogador aplica UMA vez", () => {
    const a = nova();
    const s = vez(a);
    const carta = legalCardsFor(a.estadoAutoritativo()!, s)[0];
    const id = acao();

    const r1 = a.jogarCarta(s, P[s], { actionId: id, cardId: cardId(carta) });
    const versaoDepois = a.stateVersion;
    const maoDepois = mao(a, s).map(cardId);

    const r2 = a.jogarCarta(s, P[s], { actionId: id, cardId: cardId(carta) });

    expect(r1).toMatchObject({ ok: true, duplicada: false });
    expect(r2).toMatchObject({ ok: true, duplicada: true, stateVersion: versaoDepois });
    expect(a.stateVersion).toBe(versaoDepois); // versão NÃO avançou de novo
    expect(mao(a, s).map(cardId)).toEqual(maoDepois);
    expect(a.estadoAutoritativo()!.hand!.currentTrick).toHaveLength(1);
  });

  it("actionId igual vinda de OUTRO jogador não é confundida", () => {
    const a = nova();
    const s = vez(a);
    const id = "mesma-id";
    a.jogarCarta(s, P[s], { actionId: id, cardId: cardId(legalCardsFor(a.estadoAutoritativo()!, s)[0]) });

    const proximo = vez(a);
    const legal = legalCardsFor(a.estadoAutoritativo()!, proximo)[0];
    const r = a.jogarCarta(proximo, P[proximo], { actionId: id, cardId: cardId(legal) });

    expect(r).toMatchObject({ ok: true, duplicada: false }); // escopo é por jogador
    expect(a.estadoAutoritativo()!.hand!.currentTrick).toHaveLength(2);
  });
});

describe("J · stateVersion", () => {
  it("versão correta passa; versão atrasada vira STALE_ACTION sem efeito", () => {
    const a = nova();
    const s = vez(a);
    const legal = legalCardsFor(a.estadoAutoritativo()!, s)[0];

    // atrasada
    const versao = a.stateVersion;
    const r = a.jogarCarta(s, P[s], { actionId: acao(), cardId: cardId(legal), expectedStateVersion: versao - 1 });
    expect(r).toMatchObject({ ok: false, code: ERRO.STALE_ACTION });
    expect(a.stateVersion).toBe(versao);
    expect(a.estadoAutoritativo()!.hand!.currentTrick).toHaveLength(0);

    // correta
    const ok = a.jogarCarta(s, P[s], { actionId: acao(), cardId: cardId(legal), expectedStateVersion: versao });
    expect(ok).toMatchObject({ ok: true, duplicada: false });
  });

  it("versão à frente do servidor é payload inválido, não atraso", () => {
    const a = nova();
    const s = vez(a);
    const legal = legalCardsFor(a.estadoAutoritativo()!, s)[0];
    expect(a.jogarCarta(s, P[s], {
      actionId: acao(), cardId: cardId(legal), expectedStateVersion: a.stateVersion + 5,
    })).toMatchObject({ ok: false, code: ERRO.INVALID_PAYLOAD });
  });

  it("omitir expectedStateVersion é aceito — cliente que não versiona não é punido", () => {
    const a = nova();
    const s = vez(a);
    const legal = legalCardsFor(a.estadoAutoritativo()!, s)[0];
    expect(a.jogarCarta(s, P[s], { actionId: acao(), cardId: cardId(legal) }))
      .toMatchObject({ ok: true, duplicada: false });
  });

  it("ação recusada NUNCA consome versão", () => {
    const a = nova();
    const antes = a.stateVersion;
    const s = vez(a);
    const outro = ((s + 1) % 4) as Seat;
    a.jogarCarta(outro, P[outro], { actionId: acao(), cardId: cardId(mao(a, outro)[0]) });
    a.jogarCarta(s, P[s], { actionId: acao(), cardId: "Z-unicorns" });
    a.escolherTrunfo(s, P[s], { actionId: acao(), trump: "hearts" });
    expect(a.stateVersion).toBe(antes);
  });
});

// ═══════════════════ O · P · Q — SELECT_TRUMP ═══════════════════

/** Leva a partida até a mão 7, onde o motor exige escolha de trunfo. */
function ateFaseDeTrunfo(a: AutoridadeDaPartida): void {
  let guard = 0;
  while (a.estadoAutoritativo()!.hand!.awaitingTrumpFrom === null) {
    if (++guard > 5000) throw new Error("loop de segurança");
    const m = a.estadoAutoritativo()!;
    if (m.hand!.handScores !== null) {
      // consenso dos quatro; quem AVANÇA é a camada de tempo (a Room), não a autoridade
      let r!: ReturnType<AutoridadeDaPartida["marcarPronto"]>;
      for (const s of SEATS) r = a.marcarPronto(s, P[s], { actionId: acao() });
      expect(r.ok).toBe(true);
      expect(r.ok && r.consenso).toBe(true);
      expect(a.avancarMao().ok).toBe(true);
      continue;
    }
    jogarLegal(a);
  }
}

describe("O/P/Q · SELECT_TRUMP", () => {
  it("O · o escolhedor da vez escolhe um naipe e a mão passa a ter trunfo", () => {
    const a = nova(11);
    ateFaseDeTrunfo(a);
    const m = a.estadoAutoritativo()!;
    const escolhedor = m.hand!.awaitingTrumpFrom as Seat;
    expect(m.handNumber).toBe(7);
    const versao = a.stateVersion;

    const r = a.escolherTrunfo(escolhedor, P[escolhedor], { actionId: acao(), trump: "hearts" });

    expect(r).toMatchObject({ ok: true, duplicada: false });
    expect(a.stateVersion).toBe(versao + 1);
    expect(a.estadoAutoritativo()!.hand!.trump).toBe("hearts");
    expect(a.estadoAutoritativo()!.hand!.awaitingTrumpFrom).toBeNull();
    expect(a.estadoAutoritativo()!.hand!.turn).not.toBeNull();
  });

  it("P · SEM TRUNFO é aceito quando legal", () => {
    const a = nova(23);
    ateFaseDeTrunfo(a);
    const escolhedor = a.estadoAutoritativo()!.hand!.awaitingTrumpFrom as Seat;

    const r = a.escolherTrunfo(escolhedor, P[escolhedor], { actionId: acao(), trump: "no-trump" });

    expect(r).toMatchObject({ ok: true, duplicada: false });
    expect(a.estadoAutoritativo()!.hand!.trump).toBe("no-trump");
  });

  it("Q · escolha ilegal é recusada: assento errado, fase errada e domínio inválido", () => {
    const a = nova(11);

    // fase errada — a mão 1 é negativa, não tem trunfo
    expect(a.escolherTrunfo(0, P[0], { actionId: acao(), trump: "spades" }))
      .toMatchObject({ ok: false, code: ERRO.WRONG_PHASE });

    ateFaseDeTrunfo(a);
    const escolhedor = a.estadoAutoritativo()!.hand!.awaitingTrumpFrom as Seat;
    const impostor = ((escolhedor + 1) % 4) as Seat;
    const versao = a.stateVersion;

    // assento errado
    expect(a.escolherTrunfo(impostor, P[impostor], { actionId: acao(), trump: "spades" }))
      .toMatchObject({ ok: false, code: ERRO.NOT_YOUR_TURN });

    // fora do domínio oficial (♥ ♦ ♣ ♠ e Sem Trunfo)
    for (const invalido of ["coringa", "", null, 7, "NO-TRUMP", "Hearts"]) {
      expect(a.escolherTrunfo(escolhedor, P[escolhedor], {
        actionId: acao(), trump: invalido as unknown as Trump,
      })).toMatchObject({ ok: false, code: ERRO.INVALID_TRUMP });
    }

    expect(a.stateVersion).toBe(versao);
    expect(a.estadoAutoritativo()!.hand!.trump).toBeNull();

    // e o domínio aceito é exatamente o oficial
    for (const t of [...SUITS, "no-trump"] as Trump[]) {
      const b = nova(11);
      ateFaseDeTrunfo(b);
      const e = b.estadoAutoritativo()!.hand!.awaitingTrumpFrom as Seat;
      expect(b.escolherTrunfo(e, P[e], { actionId: acao(), trump: t }).ok).toBe(true);
    }
  });
});

describe("consenso entre-mãos (READY_NEXT_HAND)", () => {
  /** Joga a mão corrente até o fim. */
  function terminarMao(a: AutoridadeDaPartida): void {
    let guard = 0;
    while (a.estadoAutoritativo()!.hand!.handScores === null) {
      if (++guard > 200) throw new Error("loop");
      jogarLegal(a);
    }
  }

  it("recusa pronto com mão em andamento", () => {
    const a = nova(5);
    expect(a.marcarPronto(0, P[0], { actionId: acao() }))
      .toMatchObject({ ok: false, code: ERRO.HAND_NOT_OVER });
  });

  it("X/Y · 1, 2 e 3 prontos NÃO avançam; o quarto avança exatamente uma vez", () => {
    const a = nova(5);
    terminarMao(a);
    const versao = a.stateVersion;

    for (const s of [0, 1, 2] as Seat[]) {
      const r = a.marcarPronto(s, P[s], { actionId: acao() });
      expect(r).toMatchObject({ ok: true, consenso: false });
      expect(a.avancarMao()).toMatchObject({ ok: false }); // sem consenso, não avança
      expect(a.estadoAutoritativo()!.handNumber).toBe(1);
      expect(a.stateVersion).toBe(versao);               // versão parada
    }
    expect(a.prontos).toEqual([0, 1, 2]);

    const r4 = a.marcarPronto(3, P[3], { actionId: acao() });
    expect(r4).toMatchObject({ ok: true, consenso: true });
    expect(a.estadoAutoritativo()!.handNumber).toBe(1);   // consenso NÃO avança sozinho
    expect(a.avancarMao()).toMatchObject({ ok: true });
    expect(a.estadoAutoritativo()!.handNumber).toBe(2);
    expect(a.stateVersion).toBe(versao + 1);
    expect(a.prontos).toEqual([]); // consenso zerado na virada
  });

  it("Z · pronto repetido do mesmo jogador não conta duas vezes", () => {
    const a = nova(5);
    terminarMao(a);
    // três actionId DIFERENTES, do mesmo assento
    for (let i = 0; i < 3; i++) {
      expect(a.marcarPronto(0, P[0], { actionId: acao() })).toMatchObject({ ok: true, consenso: false });
    }
    expect(a.prontos).toEqual([0]);
    expect(a.estadoAutoritativo()!.handNumber).toBe(1);

    // e a MESMA actionId repetida é idempotente
    const id = acao();
    a.marcarPronto(1, P[1], { actionId: id });
    const dup = a.marcarPronto(1, P[1], { actionId: id });
    expect(dup).toMatchObject({ ok: true, duplicada: true, consenso: false });
    expect(a.prontos).toEqual([0, 1]);

    for (const s of [2, 3] as Seat[]) a.marcarPronto(s, P[s], { actionId: acao() });
    expect(a.avancarMao().ok).toBe(true);
    expect(a.estadoAutoritativo()!.handNumber).toBe(2);
  });

  it("AA · pronto atrasado, já na mão nova, é recusado sem efeito", () => {
    const a = nova(5);
    terminarMao(a);
    for (const s of SEATS) a.marcarPronto(s, P[s], { actionId: acao() });
    expect(a.avancarMao().ok).toBe(true);
    expect(a.estadoAutoritativo()!.handNumber).toBe(2);

    const versao = a.stateVersion;
    // um retardatário pede de novo: a mão 2 está em andamento
    expect(a.marcarPronto(0, P[0], { actionId: acao() }))
      .toMatchObject({ ok: false, code: ERRO.HAND_NOT_OVER });
    expect(a.estadoAutoritativo()!.handNumber).toBe(2);
    expect(a.stateVersion).toBe(versao);
  });

  it("prontos de uma mão nunca somam com os da seguinte", () => {
    const a = nova(5);
    terminarMao(a);
    a.marcarPronto(0, P[0], { actionId: acao() });
    a.marcarPronto(1, P[1], { actionId: acao() });
    a.marcarPronto(2, P[2], { actionId: acao() });
    a.marcarPronto(3, P[3], { actionId: acao() });
    expect(a.avancarMao().ok).toBe(true); // avança para a mão 2
    terminarMao(a);
    // dois prontos na mão 2: não pode avançar por herdar os da mão 1
    a.marcarPronto(0, P[0], { actionId: acao() });
    a.marcarPronto(1, P[1], { actionId: acao() });
    expect(a.prontos).toEqual([0, 1]);
    expect(a.estadoAutoritativo()!.handNumber).toBe(2);
  });
});
