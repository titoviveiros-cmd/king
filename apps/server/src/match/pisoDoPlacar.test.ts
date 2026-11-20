// O PISO DO PLACAR, regra pura: a mão do Rei ganha leitura; as outras nove não mudam.
//
// Os estados vêm do MOTOR (partidas jogadas até o fim de cada mão), nunca montados à mão: o que se
// prova é a regra sobre o estado que a Room realmente vê.
import { describe, expect, it } from "vitest";
import {
  createMatch, startNextHand, selectTrump, playCard, legalCardsFor, chooseNormalTrump, buildBotView,
  type MatchState,
} from "@king/engine";
import { ehPlacarDoRei, placarLiberadoEm } from "./pisoDoPlacar.js";
import { TEMPOS_PADRAO } from "./tempos.js";

/** A META do produto: leitura REAL do Placar depois da cena do Rei. */
const META_DE_LEITURA = 4_600;

/** Joga pelo motor até a mão `alvo` ter placar (ou a partida acabar, se `alvo` for 10). */
function fimDaMao(alvo: number, semente = 42): MatchState {
  const m = createMatch(["A", "B", "C", "D"], semente);
  for (let guarda = 0; guarda < 20_000; guarda++) {
    const h = m.hand;
    if (h && h.handNumber === alvo && h.handScores !== null) return m;
    if (m.finished) return m;
    if (h === null || h.handScores !== null) { startNextHand(m); continue; }
    if (h.awaitingTrumpFrom !== null) {
      selectTrump(m, h.awaitingTrumpFrom, chooseNormalTrump(buildBotView(m, h.awaitingTrumpFrom).hand));
      continue;
    }
    playCard(m, h.turn!, legalCardsFor(m, h.turn!)[0]);
  }
  throw new Error("partida não chegou à mão " + alvo);
}

const T0 = 1_000_000;

describe("as nove mãos que não são a do Rei: o piso de sempre, contado do fim da mão", () => {
  for (const mao of [1, 2, 3, 4, 6, 7, 8, 9]) {
    it(`mão ${mao}: fim + ${TEMPOS_PADRAO.pisoDoPlacar}ms, com ou sem atraso da fila`, () => {
      const m = fimDaMao(mao);
      expect(m.hand!.handNumber).toBe(mao);
      expect(ehPlacarDoRei(m)).toBe(false);
      for (const atraso of [0, 520, 3_000]) {
        expect(placarLiberadoEm({ m, maoTerminouEm: T0, vazaFinalEntraEm: T0 + atraso }))
          .toBe(T0 + TEMPOS_PADRAO.pisoDoPlacar);
      }
    });
  }

  it("mão 10 (fim de partida): o Placar Final tem encenação própria — nada de piso do Rei", () => {
    const m = fimDaMao(10);
    expect(m.finished).toBe(true);
    expect(ehPlacarDoRei(m)).toBe(false);
  });
});

describe("a mão do Rei (mão 5): leitura garantida DEPOIS da cena", () => {
  const m = fimDaMao(5);

  it("o estado do motor no fim da mão 5 é reconhecido como o Placar do Rei", () => {
    expect(m.hand!.handNumber).toBe(5);
    expect(m.hand!.contract.kind).toBe("no-king");
    expect(ehPlacarDoRei(m)).toBe(true);
  });

  it("sem atraso de fila: fim + 11,5s — a cena (6,5s) e ao menos 4,6s de Placar", () => {
    const em = placarLiberadoEm({ m, maoTerminouEm: T0, vazaFinalEntraEm: T0 });
    expect(em).toBe(T0 + TEMPOS_PADRAO.pisoDoPlacarDoRei);
    const placarEntra = T0 + TEMPOS_PADRAO.leituraDaVazaKing;
    expect(em - placarEntra).toBeGreaterThanOrEqual(META_DE_LEITURA);
  });

  it("a vaza do K♥ esperou a cadência: o piso anda junto, e a leitura REAL não encolhe", () => {
    for (const atraso of [1, 520, 1_040, 2_600]) {
      const entra = T0 + atraso;
      const em = placarLiberadoEm({ m, maoTerminouEm: T0, vazaFinalEntraEm: entra });
      const placarEntra = entra + TEMPOS_PADRAO.leituraDaVazaKing;
      expect(em - placarEntra, `atraso ${atraso}ms`).toBeGreaterThanOrEqual(META_DE_LEITURA);
      expect(em - placarEntra, `atraso ${atraso}ms`).toBe(TEMPOS_PADRAO.pisoDoPlacarDoRei - TEMPOS_PADRAO.leituraDaVazaKing);
    }
  });

  it("instante de entrada desconhecido ou anterior ao fim nunca ADIANTA o piso", () => {
    for (const entra of [null, 0, T0 - 5_000]) {
      expect(placarLiberadoEm({ m, maoTerminouEm: T0, vazaFinalEntraEm: entra }))
        .toBe(T0 + TEMPOS_PADRAO.pisoDoPlacarDoRei);
    }
  });

  it("e nunca fica abaixo do piso geral", () => {
    expect(TEMPOS_PADRAO.pisoDoPlacarDoRei).toBeGreaterThan(TEMPOS_PADRAO.pisoDoPlacar);
  });
});

describe("a folga é exigida, não apenas 'cabe'", () => {
  it("piso do Rei − pausa do King ≥ 4,6s + 300ms de folga para timer atrasado", () => {
    expect(TEMPOS_PADRAO.pisoDoPlacarDoRei - TEMPOS_PADRAO.leituraDaVazaKing)
      .toBeGreaterThanOrEqual(META_DE_LEITURA + 300);
  });

  it("e não virou espera: no máximo 6s de Placar obrigatório", () => {
    expect(TEMPOS_PADRAO.pisoDoPlacarDoRei - TEMPOS_PADRAO.leituraDaVazaKing).toBeLessThanOrEqual(6_000);
  });

  it("o auto-ready continua MAIOR que o piso do Rei: ninguém é marcado pronto antes de ler", () => {
    expect(TEMPOS_PADRAO.autoReadyDesconectado).toBeGreaterThan(TEMPOS_PADRAO.pisoDoPlacarDoRei);
    expect(TEMPOS_PADRAO.autoReadyConectado).toBeGreaterThan(TEMPOS_PADRAO.pisoDoPlacarDoRei);
  });
});
