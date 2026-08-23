// ENCERRAMENTO DAS MÃOS — cobertura explícita da REGRA B, contrato por contrato.
//
// REGRA OFICIAL (decisão de produto, `KING-RULES.md` §6): uma mão negativa termina assim que
// TODOS os eventos pontuáveis do seu contrato foram definitivamente resolvidos. Cada mão tem
// **até** 13 vazas.
//
//   M1 (toda vaza vale −20)        → 13 obrigatórias
//   M2 (13 Copas)                  → pode encerrar antes
//   M3 (4 Damas)                   → pode encerrar antes
//   M4 (8 Reis/Valetes)            → pode encerrar antes
//   M5 (K♥)                        → pode encerrar antes
//   M6 (12ª e 13ª vazas)           → 13 obrigatórias
//   M7–M10 (toda vaza vale +25)    → 13 obrigatórias
//
// Os testes rodam pela `AutoridadeDaPartida` — o MESMO caminho que a `KingRoom` usa — e não
// tocam em `packages/engine`. A decisão de encerrar é sempre do motor; nem o cliente nem o
// servidor a calculam.
import { describe, expect, it } from "vitest";
import {
  cardId, isKingOfHearts, legalCardsFor,
  type Card, type MatchState, type Seat,
} from "@king/engine";
import { AutoridadeDaPartida } from "./autoridade.js";

const P = ["P0", "P1", "P2", "P3"];
const SEATS: Seat[] = [0, 1, 2, 3];
const soma = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
let n = 0;
const acao = () => `e${++n}`;

/** Estratégia do jogador: escolhe entre as cartas LEGAIS. */
type Estrategia = (legais: Card[], puxado: string | undefined) => Card;

const primeiraLegal: Estrategia = (legais) => legais[0];

/** Solta a carta penalizada assim que puder — acelera o encerramento antecipado. */
const soltaPenalizada = (penalizada: (c: Card) => boolean): Estrategia =>
  (legais, puxado) => {
    const alvo = legais.filter(penalizada);
    // ao ABRIR a vaza não força o naipe: só descarta quando não é a carta puxada
    if (alvo.length && (puxado === undefined || alvo[0].suit !== puxado)) return alvo[alvo.length - 1];
    return legais[0];
  };

function nova(seed: number): AutoridadeDaPartida {
  const a = new AutoridadeDaPartida();
  a.iniciar(P, "m", seed);
  return a;
}

const estado = (a: AutoridadeDaPartida): MatchState => a.estadoAutoritativo()!;

/** Joga a mão corrente até o motor encerrá-la. */
function jogarMao(a: AutoridadeDaPartida, escolher: Estrategia = primeiraLegal): void {
  const m = estado(a);
  if (m.hand!.awaitingTrumpFrom !== null) {
    a.escolherTrunfo(m.hand!.awaitingTrumpFrom, P[m.hand!.awaitingTrumpFrom], { actionId: acao(), trump: "spades" });
  }
  let guard = 0;
  while (estado(a).hand!.handScores === null) {
    if (++guard > 100) throw new Error("loop de segurança");
    const h = estado(a).hand!;
    const s = h.turn as Seat;
    const puxado = h.currentTrick.length ? h.currentTrick[0].card.suit : undefined;
    const carta = escolher(legalCardsFor(estado(a), s), puxado);
    const r = a.jogarCarta(s, P[s], { actionId: acao(), cardId: cardId(carta) });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
}

/** Leva a partida até o INÍCIO da mão `alvo`, jogando as anteriores com a estratégia simples. */
function irAteMao(a: AutoridadeDaPartida, alvo: number): void {
  while (estado(a).handNumber < alvo) {
    if (estado(a).hand!.handScores === null) { jogarMao(a); continue; }
    for (const s of SEATS) a.marcarPronto(s, P[s], { actionId: acao() });
    // o consenso não avança sozinho desde a Fase 7: quem avança é a camada de tempo
    expect(a.avancarMao().ok).toBe(true);
  }
}

interface Fim { vazas: number; cartas: number; restantes: number; total: number; handTotal: number; ultima: Card[] }

/** Joga a mão `alvo` com a estratégia dada e devolve como ela terminou. */
function jogarAMao(seed: number, alvo: number, escolher: Estrategia): Fim {
  const a = nova(seed);
  irAteMao(a, alvo);
  jogarMao(a, escolher);
  const h = estado(a).hand!;
  return {
    vazas: h.completedTricks.length,
    cartas: h.completedTricks.reduce((x, t) => x + t.cards.length, 0),
    restantes: h.hands.reduce((x, mao) => x + mao.length, 0),
    total: soma(h.handScores!),
    handTotal: h.contract.handTotal,
    ultima: h.completedTricks[h.completedTricks.length - 1].cards.map((p) => p.card),
  };
}

/** As cartas que sobraram NUNCA podem constar como jogadas. */
function exigirRestantesNaoJogadas(a: AutoridadeDaPartida): void {
  const h = estado(a).hand!;
  const jogadas = new Set(h.completedTricks.flatMap((t) => t.cards.map((p) => cardId(p.card))));
  for (const mao of h.hands) for (const c of mao) expect(jogadas.has(cardId(c))).toBe(false);
}

/** Larga o K♥ na primeira oportunidade legal — leva o encerramento para o começo da mão. */
const soltaKing: Estrategia = (legais, puxado) => {
  const king = legais.find(isKingOfHearts);
  // ao ABRIR a vaza não força naipe; seguindo, só descarta quando copas não é o naipe puxado
  if (king && (puxado === undefined || puxado !== "hearts")) return king;
  return legais[0];
};

/** Segura o K♥ até não ter alternativa — empurra o encerramento para o fim da mão. */
const seguraKing: Estrategia = (legais) => {
  const semKing = legais.filter((c) => !isKingOfHearts(c));
  return semKing.length ? semKing[0] : legais[0];
};

/** Procura uma semente em que o K♥ caia EXATAMENTE na vaza pedida, com `soltaKing`. */
function acharKingNaVaza(vaza: number, ateSeed = 300): { seed: number; vazas: number } {
  for (let seed = 1; seed <= ateSeed; seed++) {
    const fim = jogarAMao(seed, 5, soltaKing);
    if (fim.vazas === vaza) return { seed, vazas: fim.vazas };
  }
  throw new Error(`nenhuma semente até ${ateSeed} colocou o K♥ na vaza ${vaza}`);
}

/** Procura uma semente em que a mão `alvo` encerre antes da 13ª. */
function acharEncerramentoAntecipado(alvo: number, escolher: Estrategia, ateSeed = 60): { seed: number; fim: Fim } {
  for (let seed = 1; seed <= ateSeed; seed++) {
    const fim = jogarAMao(seed, alvo, escolher);
    if (fim.vazas < 13) return { seed, fim };
  }
  throw new Error(`nenhuma semente até ${ateSeed} encerrou a mão ${alvo} antes da 13ª`);
}

// ═══════════════ mãos SEM encerramento antecipado ═══════════════

describe("M1 · Não fazer Vazas — 13 vazas obrigatórias", () => {
  it("toda vaza vale −20, então a mão sempre vai até a 13ª", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const a = nova(seed);
      jogarMao(a);
      const h = estado(a).hand!;
      expect(h.contract.kind).toBe("no-tricks");
      expect(h.completedTricks).toHaveLength(13);
      expect(h.completedTricks.reduce((x, t) => x + t.cards.length, 0)).toBe(52);
      for (const s of SEATS) expect(h.hands[s]).toHaveLength(0); // nada sobrou
      expect(soma(h.handScores!)).toBe(-260);
    }
  });
});

describe("M6 · Duas últimas — 13 vazas obrigatórias", () => {
  it("as penalizadas SÃO a 12ª e a 13ª, então nunca encerra antes", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const fim = jogarAMao(seed, 6, primeiraLegal);
      expect(fim.vazas).toBe(13);
      expect(fim.cartas).toBe(52);
      expect(fim.restantes).toBe(0);
      expect(fim.total).toBe(-180);
    }
  });
});

describe("M7–M10 · positivas — 13 vazas obrigatórias", () => {
  it("toda vaza vale +25, então nenhuma positiva encerra antes", () => {
    for (const mao of [7, 8, 9, 10]) {
      for (let seed = 1; seed <= 3; seed++) {
        const fim = jogarAMao(seed, mao, primeiraLegal);
        expect(fim.vazas, `mão ${mao} semente ${seed}`).toBe(13);
        expect(fim.cartas).toBe(52);
        expect(fim.restantes).toBe(0);
        expect(fim.total).toBe(325);
      }
    }
  });
});

// ═══════════════ mãos COM encerramento antecipado ═══════════════

describe("M2 · Não fazer Copas — encerra quando a 13ª Copa é capturada", () => {
  it("com todas as Copas capturadas antes da 13ª, a mão termina e o total continua −260", () => {
    const { seed, fim } = acharEncerramentoAntecipado(2, soltaPenalizada((c) => c.suit === "hearts"));
    expect(fim.vazas).toBeLessThan(13);
    expect(fim.cartas).toBe(fim.vazas * 4);
    expect(fim.restantes).toBe(52 - fim.cartas);
    expect(fim.restantes).toBeGreaterThan(0);
    expect(fim.total).toBe(-260);
    expect(fim.total).toBe(fim.handTotal);

    // as 13 Copas estão TODAS nas vazas resolvidas — é o gatilho oficial
    const a = nova(seed);
    irAteMao(a, 2);
    jogarMao(a, soltaPenalizada((c) => c.suit === "hearts"));
    const jogadas = estado(a).hand!.completedTricks.flatMap((t) => t.cards.map((p) => p.card));
    expect(jogadas.filter((c) => c.suit === "hearts")).toHaveLength(13);
    exigirRestantesNaoJogadas(a);
  });
});

describe("M3 · Não fazer Damas — encerra quando a 4ª Dama é capturada", () => {
  it("com as quatro Damas capturadas, a mão termina e o total continua −200", () => {
    const { seed, fim } = acharEncerramentoAntecipado(3, primeiraLegal);
    expect(fim.vazas).toBeLessThan(13);
    expect(fim.cartas).toBe(fim.vazas * 4);
    expect(fim.restantes).toBeGreaterThan(0);
    expect(fim.total).toBe(-200);

    const a = nova(seed);
    irAteMao(a, 3);
    jogarMao(a);
    const jogadas = estado(a).hand!.completedTricks.flatMap((t) => t.cards.map((p) => p.card));
    expect(jogadas.filter((c) => c.rank === "Q")).toHaveLength(4);
    // a última vaza resolvida contém a Dama que fechou o contrato
    expect(fim.ultima.some((c) => c.rank === "Q")).toBe(true);
    exigirRestantesNaoJogadas(a);
  });
});

describe("M4 · Não fazer Homens — encerra quando o 8º Homem é capturado", () => {
  it("com os oito Reis/Valetes capturados, a mão termina e o total continua −240", () => {
    const { seed, fim } = acharEncerramentoAntecipado(4, primeiraLegal);
    expect(fim.vazas).toBeLessThan(13);
    expect(fim.cartas).toBe(fim.vazas * 4);
    expect(fim.restantes).toBeGreaterThan(0);
    expect(fim.total).toBe(-240);

    const a = nova(seed);
    irAteMao(a, 4);
    jogarMao(a);
    const jogadas = estado(a).hand!.completedTricks.flatMap((t) => t.cards.map((p) => p.card));
    expect(jogadas.filter((c) => c.rank === "K" || c.rank === "J")).toHaveLength(8);
    expect(fim.ultima.some((c) => c.rank === "K" || c.rank === "J")).toBe(true);
    exigirRestantesNaoJogadas(a);
  });
});

describe("M5 · Não fazer o King — encerra na vaza do K♥", () => {
  it("o K♥ capturado encerra a mão logo após aquela vaza, com −160 ao vencedor dela", () => {
    const { seed, fim } = acharEncerramentoAntecipado(5, primeiraLegal);
    expect(fim.vazas).toBeLessThan(13);
    expect(fim.cartas).toBe(fim.vazas * 4);
    expect(fim.total).toBe(-160);

    const a = nova(seed);
    irAteMao(a, 5);
    jogarMao(a);
    const h = estado(a).hand!;

    // o K♥ está na ÚLTIMA vaza resolvida — a mão parou exatamente ali
    const ultima = h.completedTricks[h.completedTricks.length - 1];
    expect(ultima.cards.some((p) => isKingOfHearts(p.card))).toBe(true);
    // e em nenhuma anterior
    for (const t of h.completedTricks.slice(0, -1)) {
      expect(t.cards.some((p) => isKingOfHearts(p.card))).toBe(false);
    }
    // os −160 foram para quem venceu essa vaza
    expect(h.handScores![ultima.winner]).toBe(-160);
    for (const s of SEATS) if (s !== ultima.winner) expect(h.handScores![s]).toBe(0);

    exigirRestantesNaoJogadas(a);
  });

  it("K♥ na 1ª vaza: a mão encerra ali, e NENHUMA 2ª vaza é criada", () => {
    const { seed, vazas } = acharKingNaVaza(1);
    expect(vazas).toBe(1);

    const a = nova(seed);
    irAteMao(a, 5);
    jogarMao(a, soltaKing);
    const h = estado(a).hand!;

    expect(h.completedTricks).toHaveLength(1);
    expect(h.trickNumber).toBe(1);          // não avançou para a 2ª
    expect(h.currentTrick).toHaveLength(0); // nenhuma vaza nova foi aberta
    expect(h.turn).toBeNull();              // ninguém tem a vez: a mão acabou
    expect(h.handScores).not.toBeNull();
    expect(soma(h.handScores!)).toBe(-160);
    // 12 cartas de cada um ficaram na mão, sem serem jogadas
    expect(h.hands.reduce((x, mao) => x + mao.length, 0)).toBe(48);
    exigirRestantesNaoJogadas(a);
  });

  it("K♥ na 3ª vaza: a mão encerra ali, e NENHUMA 4ª vaza é criada", () => {
    const { seed, vazas } = acharKingNaVaza(3);
    expect(vazas).toBe(3);

    const a = nova(seed);
    irAteMao(a, 5);
    jogarMao(a, soltaKing);
    const h = estado(a).hand!;

    expect(h.completedTricks).toHaveLength(3);
    expect(h.trickNumber).toBe(3);
    expect(h.currentTrick).toHaveLength(0);
    expect(h.turn).toBeNull();
    expect(h.completedTricks.reduce((x, t) => x + t.cards.length, 0)).toBe(12);
    expect(soma(h.handScores!)).toBe(-160);
    exigirRestantesNaoJogadas(a);
  });

  it("K♥ na 13ª vaza: funcionamento normal, sem encerramento antecipado", () => {
    // `seguraKing` só larga o K♥ quando é a única saída — assim ele tende à última vaza.
    let achou = false;
    for (let seed = 1; seed <= 200 && !achou; seed++) {
      const fim = jogarAMao(seed, 5, seguraKing);
      if (fim.vazas !== 13) continue;
      achou = true;
      expect(fim.vazas).toBe(13);
      expect(fim.cartas).toBe(52);
      expect(fim.restantes).toBe(0);        // ninguém sobrou com carta na mão
      expect(fim.total).toBe(-160);
      expect(fim.total).toBe(fim.handTotal);
      // o K♥ saiu mesmo na última vaza
      expect(fim.ultima.some(isKingOfHearts)).toBe(true);
    }
    expect(achou, "nenhuma semente levou o K♥ até a 13ª vaza").toBe(true);
  });

  it("as cartas abandonadas continuam privadas: nenhuma aparece na visão dos adversários", () => {
    const { seed } = acharEncerramentoAntecipado(5, primeiraLegal);
    const a = nova(seed);
    irAteMao(a, 5);
    jogarMao(a);
    const h = estado(a).hand!;
    expect(h.hands.reduce((x, mao) => x + mao.length, 0)).toBeGreaterThan(0); // sobrou carta

    for (const seat of SEATS) {
      const v = a.visaoDe(seat)!;
      for (const outro of SEATS) {
        if (outro === seat) continue;
        expect(v.hand!.hands[outro]).toEqual([]); // as sobras alheias não vazam
      }
      expect(v.hand!.hands[seat].map(cardId)).toEqual(h.hands[seat].map(cardId)); // as próprias, sim
    }
  });
});

// ═══════════════ invariantes da partida ═══════════════

describe("invariantes preservados pelo encerramento antecipado", () => {
  it("em 12 partidas completas: cada mão fecha no seu handTotal e a soma final é 0", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const a = nova(seed);
      const porMao: number[] = [];
      let vazas = 0;
      let cartas = 0;

      for (let mao = 1; mao <= 10; mao++) {
        jogarMao(a);
        const h = estado(a).hand!;
        expect(soma(h.handScores!), `semente ${seed} mão ${mao}`).toBe(h.contract.handTotal);
        expect(h.completedTricks.length).toBeLessThanOrEqual(13);
        porMao.push(soma(h.handScores!));
        vazas += h.completedTricks.length;
        cartas += h.completedTricks.reduce((x, t) => x + t.cards.length, 0);
        exigirRestantesNaoJogadas(a);
        if (mao < 10) {
          for (const s of SEATS) a.marcarPronto(s, P[s], { actionId: acao() });
          expect(a.avancarMao().ok).toBe(true);
        }
      }

      const m = estado(a);
      expect(porMao).toEqual([-260, -260, -200, -240, -160, -180, 325, 325, 325, 325]);
      expect(soma(m.negatives)).toBe(-1300);
      expect(soma(m.positives)).toBe(1300);
      expect(soma(m.cumulative)).toBe(0);
      expect(m.finished).toBe(true);
      // máximo teórico, nunca invariante
      expect(vazas).toBeLessThanOrEqual(130);
      expect(cartas).toBeLessThanOrEqual(520);
      expect(cartas).toBe(vazas * 4);
    }
  });
});
