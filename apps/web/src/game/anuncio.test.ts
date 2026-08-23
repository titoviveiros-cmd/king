/**
 * ANÚNCIO DA VAZA — a lógica que decide o selo do castigo, o som e a pausa da mesa.
 *
 * Estava dentro do hook do modo local e agora é uma função pura compartilhada pelos DOIS modos.
 * Isso é o que garante que a partida online tenha o mesmo ritmo e o mesmo drama que o KING que
 * já foi validado no aparelho — e permite testar sem montar componente.
 */
import { describe, it, expect } from "vitest";
import {
  createMatch, startNextHand, playCard, redactFor, chooseNormalCard, buildBotView,
  type MatchState, type Seat,
} from "@king/engine";
import { KingGame } from "./kingGame.js";
import { PartidaRemota } from "./partidaRemota.js";
import { anunciarVaza } from "./anuncio.js";
import { TEMPOS } from "./timings.js";

const JOGADORES = ["Você", "Bia", "Léo", "Nara"];
const noop = () => {};

function remotaDe(m: MatchState, eu: Seat): PartidaRemota {
  return new PartidaRemota({ matchId: "m", stateVersion: 1, view: redactFor(m, eu), cause: "CARD_PLAYED" }, eu, noop);
}

/** Joga vazas completas e devolve o estado logo depois de UMA vaza fechar. */
function aposUmaVaza(seed: number, vazas: number): MatchState {
  const m = createMatch(JOGADORES, seed);
  startNextHand(m);
  for (let v = 0; v < vazas; v++) {
    for (let k = 0; k < 4; k++) {
      const h = m.hand!;
      if (h.handScores !== null) return m;
      const s = h.turn!;
      playCard(m, s, chooseNormalCard(buildBotView(m, s)));
    }
  }
  return m;
}

/**
 * A mão 1 é "não pegar Vazas", que por decisão de produto NÃO abre selo (toda vaza custa e o
 * vencedor é evidente). O selo do castigo vive nas mãos 2–5, em que a bucha é uma CARTA — é para
 * lá que este helper leva a partida.
 */
function aposVazaNaMao(seed: number, mao: number, vazas: number): MatchState {
  const m = createMatch(JOGADORES, seed);
  startNextHand(m);
  while (m.handNumber < mao) {
    for (let g = 0; g < 3000 && m.hand!.handScores === null; g++) {
      const h = m.hand!;
      if (h.awaitingTrumpFrom !== null) break;
      const s = h.turn!;
      playCard(m, s, chooseNormalCard(buildBotView(m, s)));
    }
    startNextHand(m);
  }
  for (let v = 0; v < vazas; v++) {
    for (let k = 0; k < 4; k++) {
      const h = m.hand!;
      if (h.handScores !== null) return m;
      const s = h.turn!;
      playCard(m, s, chooseNormalCard(buildBotView(m, s)));
    }
  }
  return m;
}

describe("anunciarVaza", () => {
  it("sem vaza fechada não há o que anunciar — a apresentação não mexe em nada", () => {
    const g = new KingGame(JOGADORES, 42);
    expect(anunciarVaza(g, 1)).toBeNull();
  });

  it("mão 1 (não pegar Vazas): não abre selo, mas o som distingue quem levou", () => {
    const m = aposUmaVaza(42, 1);
    expect(m.hand!.contract.kind).toBe("no-tricks");
    const vencedor = m.hand!.completedTricks[0].winner;

    const doVencedor = anunciarVaza(remotaDe(m, vencedor), 1)!;
    expect(doVencedor.castigo).toBeNull();
    expect(doVencedor.som).toBe("penalty");
    expect(doVencedor.shake).toBe(false);

    const outro = ([0, 1, 2, 3] as Seat[]).find((s) => s !== vencedor)!;
    expect(anunciarVaza(remotaDe(m, outro), 1)!.som).toBe("neutral");
  });

  it("o mesmo estado anuncia a mesma coisa para os quatro — muda só o 'você'", () => {
    // A função só consome métodos de LEITURA, e a paridade método a método entre KingGame e
    // PartidaRemota está provada em partidaRemota.test.ts. Logo, se o anúncio é o mesmo para
    // qualquer observador do mesmo estado, os dois modos anunciam igual.
    const m = aposUmaVaza(42, 1);
    const anuncios = ([0, 1, 2, 3] as Seat[]).map((s) => anunciarVaza(remotaDe(m, s), 7)!);
    const vencedor = m.hand!.completedTricks[0].winner;

    for (const a of anuncios) {
      expect(a.pausa).toBe(anuncios[0].pausa);
      expect(a.shake).toBe(anuncios[0].shake);
      expect(a.castigo?.seat).toBe(anuncios[0].castigo?.seat);
      expect(a.castigo?.pontos).toBe(anuncios[0].castigo?.pontos);
    }
    expect(anuncios.filter((a) => a.castigo?.voce).length).toBe(anuncios[vencedor].castigo ? 1 : 0);
  });

  it("a pausa nunca é menor que a leitura padrão, e cresce quando há bucha", () => {
    for (const seed of [1, 5, 13, 42, 77]) {
      for (const vazas of [1, 3, 6]) {
        const m = aposUmaVaza(seed, vazas);
        if (m.hand!.completedTricks.length === 0) continue;
        const a = anunciarVaza(remotaDe(m, 0), 1);
        if (!a) continue;
        expect(a.pausa).toBeGreaterThanOrEqual(TEMPOS.leituraDaVaza);
        if (a.castigo) {
          expect(a.pausa).toBeGreaterThanOrEqual(TEMPOS.leituraDaVazaCastigo);
          expect(a.shake).toBe(true);
          expect(a.som === "penalty" || a.som === "king").toBe(true);
          // o selo anuncia o ACUMULADO da mão, com o texto vindo do motor
          expect(a.castigo.oQue).toMatch(/^\d+ \S/);
          expect(a.castigo.nonce).toBe(1);
        }
      }
    }
  });

  it("a última vaza da mão ganha ar: a pausa respeita o piso de fim de mão", () => {
    for (const seed of [3, 13, 29, 42]) {
      const m = aposUmaVaza(seed, 13);
      if (m.hand!.handScores === null) continue;
      const a = anunciarVaza(remotaDe(m, 0), 1)!;
      expect(a.pausa).toBeGreaterThanOrEqual(TEMPOS.fimDeMao);
      return;
    }
    throw new Error("nenhuma semente encerrou a mão");
  });

  it("o castigo aponta o assento certo e marca 'você' só para quem levou", () => {
    let provado = 0;
    for (const seed of [7, 13, 23, 42, 55, 91]) {
      for (const mao of [2, 3, 4, 5]) {
        for (const vazas of [1, 2, 3, 4, 5, 6]) {
          const m = aposVazaNaMao(seed, mao, vazas);
          const t = m.hand!.completedTricks.at(-1);
          if (!t) continue;
          const a = anunciarVaza(remotaDe(m, t.winner), 1);
          if (!a?.castigo) continue;

          expect(a.castigo.seat).toBe(t.winner);
          expect(a.castigo.jogador).toBe(JOGADORES[t.winner]);
          expect(a.castigo.voce).toBe(true);
          expect(a.shake).toBe(true);
          expect(a.pausa).toBeGreaterThanOrEqual(TEMPOS.leituraDaVazaCastigo);

          const outro = ([0, 1, 2, 3] as Seat[]).find((s) => s !== t.winner)!;
          const doOutro = anunciarVaza(remotaDe(m, outro), 1)!;
          expect(doOutro.castigo!.voce).toBe(false);
          // mesmo estado, mesmo castigo: muda só de quem é a perspectiva
          expect(doOutro.castigo!.seat).toBe(a.castigo.seat);
          expect(doOutro.castigo!.pontos).toBe(a.castigo.pontos);
          provado++;
          if (provado >= 3) return;
        }
      }
    }
    expect(provado, "nenhuma semente produziu castigo").toBeGreaterThan(0);
  });
});
