// OS MICROCENÁRIOS SÃO LEGAIS E ENSINAM O QUE PROMETEM.
//
// Este é o arquivo mais importante do tutorial. A promessa de produto é dura: **o tutorial não
// pode ensinar nenhuma regra divergente do motor**. Um tutorial que mente é pior que nenhum —
// a pessoa aprende errado e depois acha que o jogo está quebrado.
//
// Cada cena é remontada aqui pelo motor de verdade e conferida contra a lição que o roteiro
// promete. Se o embaralhamento mudar, se o Bot Normal mudar de ideia, se a numeração dos
// contratos mudar — estes testes caem, e é exatamente o que se quer: a lição teria mudado junto.
import { describe, expect, it } from "vitest";
import { cardId, legalCardsFor, HAND_CONTRACTS, type Card } from "@king/engine";
import {
  ALUNO, CENAS, legaisDoAluno, legaisQueEscapam, legaisQueGanham, montarCena, naipePuxado,
  venceriaAVaza, type CenaId,
} from "./cenas.js";

const ids = (cartas: Card[]) => cartas.map(cardId).sort();

describe("toda cena nasce válida", () => {
  const todas = Object.keys(CENAS) as CenaId[];

  it.each(todas)("cena %s: mão ativa, contrato certo e vez do aluno", (id) => {
    const m = montarCena(id);
    const h = m.hand!;
    expect(h).not.toBeNull();
    expect(h.handNumber).toBe(CENAS[id].mao);
    expect(h.contract).toEqual(HAND_CONTRACTS[CENAS[id].mao]);
    expect(h.handScores).toBeNull();
    // ou é a vez dele de jogar, ou é a vez dele de escolher o trunfo. Nunca "espere aí".
    expect(h.turn === ALUNO || h.awaitingTrumpFrom === ALUNO).toBe(true);
  });

  it.each(todas)("cena %s: as 52 cartas continuam inteiras e sem repetição", (id) => {
    const m = montarCena(id);
    const h = m.hand!;
    const todasAsCartas = [
      ...h.hands.flat(),
      ...h.currentTrick.map((p) => p.card),
      ...h.completedTricks.flatMap((t) => t.cards.map((p) => p.card)),
    ];
    expect(todasAsCartas).toHaveLength(52);
    expect(new Set(todasAsCartas.map(cardId)).size).toBe(52);
  });

  it.each(todas)("cena %s: é REPRODUTÍVEL — mesma semente, mesma mesa", (id) => {
    const a = montarCena(id);
    const b = montarCena(id);
    expect(ids(a.hand!.hands[ALUNO])).toEqual(ids(b.hand!.hands[ALUNO]));
    expect(a.hand!.currentTrick.map((p) => cardId(p.card)))
      .toEqual(b.hand!.currentTrick.map((p) => cardId(p.card)));
  });

  it.each(todas)("cena %s: o que a tela oferece é exatamente o que o motor aceita", (id) => {
    const m = montarCena(id);
    expect(ids(legaisDoAluno(m))).toEqual(ids(legalCardsFor(m, ALUNO)));
  });
});

describe("cena SERVIR — obrigado a seguir o naipe, com escolha que importa", () => {
  it("três cartas na mesa e a vez é do aluno", () => {
    const m = montarCena("servir");
    expect(m.hand!.currentTrick).toHaveLength(3);
    expect(m.hand!.turn).toBe(ALUNO);
  });

  it("o motor RESTRINGE ao naipe puxado — é isso que a lição chama de servir", () => {
    const m = montarCena("servir");
    const puxado = naipePuxado(m)!;
    const legais = legaisDoAluno(m);
    const mao = m.hand!.hands[ALUNO];

    expect(legais.length).toBeGreaterThanOrEqual(2); // há escolha de verdade
    expect(legais.length).toBeLessThan(mao.length);  // e ela é restrita
    expect(legais.every((c) => c.suit === puxado)).toBe(true);
  });

  it("a lição só existe porque dá para acertar E errar", () => {
    const m = montarCena("servir");
    expect(legaisQueEscapam(m).length).toBeGreaterThan(0);
    expect(legaisQueGanham(m).length).toBeGreaterThan(0);
  });

  it("é mão NEGATIVA: pegar a vaza custa pontos", () => {
    const m = montarCena("servir");
    expect(m.hand!.contract.isPositive).toBe(false);
    expect(m.hand!.contract.kind).toBe("no-tricks");
  });
});

describe("cena NEGAR — sem o naipe puxado, o leque inteiro acende", () => {
  it("o aluno NÃO tem o naipe puxado", () => {
    const m = montarCena("negar");
    const puxado = naipePuxado(m)!;
    expect(m.hand!.hands[ALUNO].some((c) => c.suit === puxado)).toBe(false);
  });

  it("por isso toda a mão é legal — a definição de negar", () => {
    const m = montarCena("negar");
    expect(ids(legaisDoAluno(m))).toEqual(ids(m.hand!.hands[ALUNO]));
  });
});

describe("cena KING — o Rei de Copas na mesa, e uma saída para quem entendeu", () => {
  it("é a mão do Rei de Copas", () => {
    const m = montarCena("king");
    expect(m.hand!.contract.kind).toBe("no-king");
  });

  it("o Rei de Copas está NA MESA, à vista", () => {
    const m = montarCena("king");
    expect(m.hand!.currentTrick.map((p) => cardId(p.card))).toContain("K-hearts");
  });

  it("dá para escapar E dá para se dar mal: a decisão é real", () => {
    const m = montarCena("king");
    expect(legaisQueEscapam(m).length).toBeGreaterThan(0);
    expect(legaisQueGanham(m).length).toBeGreaterThan(0);
  });

  it("quem leva a vaza leva o Rei junto — é o que a fala promete", () => {
    const m = montarCena("king");
    const perigosa = legaisQueGanham(m)[0];
    expect(venceriaAVaza(m, perigosa)).toBe(true);
    // e o -160 do contrato confere com o motor
    expect(HAND_CONTRACTS[5].handTotal).toBe(-160);
  });
});

describe("cena POSITIVA — o aluno escolhe o trunfo e quer a vaza", () => {
  it("a mão espera o trunfo DELE — a rotação do motor manda isso na mão 7", () => {
    const m = montarCena("positiva");
    expect(m.hand!.awaitingTrumpFrom).toBe(ALUNO);
    expect(m.hand!.contract.isPositive).toBe(true);
  });

  it("paus é mesmo o naipe mais longo, com o Ás — a fala do Rei não inventa", () => {
    const m = montarCena("positiva");
    const mao = m.hand!.hands[ALUNO];
    const paus = mao.filter((c) => c.suit === "clubs");
    expect(paus.length).toBeGreaterThanOrEqual(5);
    expect(paus.some((c) => c.rank === "A")).toBe(true);
    for (const naipe of ["hearts", "diamonds", "spades"] as const) {
      expect(mao.filter((c) => c.suit === naipe).length).toBeLessThan(paus.length);
    }
  });

  it("+25 por vaza vem do motor, não da microcopy", () => {
    expect(HAND_CONTRACTS[7].handTotal / 13).toBe(25);
  });
});

describe("os números que o Rei diz são os do motor", () => {
  it("cada contrato negativo bate com o que a fala promete", () => {
    expect(HAND_CONTRACTS[1].handTotal / 13).toBe(-20);  // vaza
    expect(HAND_CONTRACTS[2].handTotal / 13).toBe(-20);  // cada copas
    expect(HAND_CONTRACTS[3].handTotal / 4).toBe(-50);   // cada dama
    expect(HAND_CONTRACTS[4].handTotal / 8).toBe(-30);   // cada rei e valete
    expect(HAND_CONTRACTS[5].handTotal).toBe(-160);      // o Rei de Copas
    expect(HAND_CONTRACTS[6].handTotal / 2).toBe(-90);   // as duas últimas
  });
});
