/**
 * BUG 2 (regressão) — a pontuação dos player cards da Mesa deve derivar SEMPRE do score canônico
 * do motor (`game.cumulative()`), associado pelo `seat` estável, e reagir a cada mão — sem esperar
 * troca de fase e sem placar paralelo na Presentation Layer.
 *
 * Renderiza a Mesa REAL para HTML (`renderToStaticMarkup`, Node puro — sem jsdom, robusto no CI),
 * dirige a partida pela API pública do adaptador (sem replicar regra) e, a cada fim de mão, compara
 * célula a célula, por ASSENTO: card da Mesa × linha do Placar entre-mãos × cumulativo do motor.
 * Cobre os 9 casos pedidos, incluindo a prova de que o score da Mesa muda entre duas mãos da MESMA
 * fase (o defeito relatado no aparelho).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, type HTMLElement } from "node-html-parser";
import { KingGame } from "../game/kingGame.js";
import { Mesa } from "./Mesa.js";

const noop = () => {};
const norm = (t: string | null | undefined) => (t ?? "").replace(/−/g, "-");
const parsePts = (t: string | null | undefined) => { const m = norm(t).match(/(-?\d+)\s*pts/); return m ? +m[1] : null; };
const parseTot = (t: string | null | undefined) => { const m = norm(t).match(/(-?\d+)/); return m ? +m[1] : null; };

/** Joga a mão corrente até o fim usando SÓ a API pública do adaptador (nenhuma regra replicada). */
function playHandToEnd(game: KingGame): void {
  for (let guard = 0; guard < 3000; guard++) {
    const ph = game.phase();
    if (ph === "handEnd" || ph === "matchEnd") return;
    if (ph === "trump") {
      if (game.humanChoosesTrump()) game.chooseTrumpHuman("no-trump");
      else game.stepBotTrump();
    } else if (game.isHumanTurn()) {
      game.playHuman(game.legalCards()[0]);
    } else if (game.needsBotPlay()) {
      game.stepBotPlay();
    } else {
      throw new Error(`estado inesperado durante a mão: ${ph}`);
    }
  }
  throw new Error("a mão não encerrou dentro do limite");
}

/** Renderiza a Mesa real para uma árvore consultável (sem DOM de browser). */
function renderMesaRoot(game: KingGame): HTMLElement {
  const html = renderToStaticMarkup(
    <Mesa
      game={game} reviewing={false} shake={0}
      onPlay={noop} onChooseTrump={noop} onAdvance={noop} onHome={noop} onRestart={noop} onOpenAudio={noop}
    />,
  );
  return parse(html);
}

/** Score exibido em cada card da Mesa, por ASSENTO (0 = Você, 1 esq, 2 topo, 3 dir). */
function mesaScoresBySeat(root: HTMLElement): (number | null)[] {
  return [
    parsePts(root.querySelector(".youtag .m")?.text),
    parsePts(root.querySelector(".opp.left .pt")?.text),
    parsePts(root.querySelector(".opp.top .pt")?.text),
    parsePts(root.querySelector(".opp.right .pt")?.text),
  ];
}
/** Total exibido em cada linha do Placar entre-mãos, por ASSENTO (via classe .pl-av.s{seat}). */
function placarScoresBySeat(root: HTMLElement): (number | null)[] {
  const v: (number | null)[] = [null, null, null, null];
  root.querySelectorAll(".pl-row").forEach((row) => {
    const cls = row.querySelector(".pl-av")?.getAttribute("class") ?? "";
    const m = cls.match(/\bs([0-3])\b/);
    if (m) v[+m[1]] = parseTot(row.querySelector(".pl-total")?.text);
  });
  return v;
}

const SEATS = [0, 1, 2, 3] as const;

describe("BUG 2 — score dos player cards da Mesa é o canônico do motor, por assento", () => {
  it("card inicial mostra 0 para os quatro assentos", () => {
    const game = new KingGame(["Você", "Bia", "Léo", "Nara"], 42);
    expect(mesaScoresBySeat(renderMesaRoot(game))).toEqual([0, 0, 0, 0]);
  });

  it("a cada mão: Mesa == Placar == cumulativo do motor (por assento) e muda entre mãos da mesma fase", () => {
    const game = new KingGame(["Você", "Bia", "Léo", "Nara"], 42);
    const log: Array<{ hand: number; canon: number[]; mesa: (number | null)[]; placar: (number | null)[]; handScores: number[] }> = [];

    for (let hand = 1; hand <= 7; hand++) {
      playHandToEnd(game);
      const root = renderMesaRoot(game);
      const canon = game.cumulative();
      const mesa = mesaScoresBySeat(root);
      const placar = placarScoresBySeat(root);
      const handScores = game.summary()!.scores;

      // Mesa e Placar refletem EXATAMENTE o cumulativo do motor, assento a assento.
      for (const seat of SEATS) {
        expect(mesa[seat], `Mesa · assento ${seat} · mão ${hand}`).toBe(canon[seat]);
        expect(placar[seat], `Placar · assento ${seat} · mão ${hand}`).toBe(canon[seat]);
      }

      log.push({ hand, canon: [...canon], mesa, placar, handScores: [...handScores] });
      if (game.phase() !== "matchEnd") game.advanceHand();
    }

    const at = (h: number) => log.find((l) => l.hand === h)!;

    // (1) score inicial coerente: mão 1 (não pegar vazas) distribui −260 no total.
    expect(at(1).canon.reduce((a, b) => a + b, 0)).toBe(-260);

    // (2)(3)(4) o score da MESA muda entre duas mãos NEGATIVAS (mesma fase), antes de qualquer troca
    //           de fase — reprodução exata do defeito relatado no aparelho.
    expect(at(4).mesa).not.toEqual(at(3).mesa);
    expect(at(4).mesa[0]).not.toBe(at(3).mesa[0]); // "Você" muda sem esperar a Mão 7

    // (5) acumulado correto ao longo das negativas (aditivo, sem perder pontos).
    for (const seat of SEATS) {
      expect(at(6).canon[seat]).toBe(
        at(1).handScores[seat] + at(2).handScores[seat] + at(3).handScores[seat] +
        at(4).handScores[seat] + at(5).handScores[seat] + at(6).handScores[seat],
      );
    }

    // (6) transição Mão 6 → Mão 7 SEM salto artificial: cumulativo 7 = cumulativo 6 + score da mão 7.
    for (const seat of SEATS) {
      expect(at(7).canon[seat] - at(6).canon[seat]).toBe(at(7).handScores[seat]);
    }

    // (7) +25 em mão positiva: a mão 7 soma +325 e há ganho positivo para alguém.
    expect(at(7).handScores.reduce((a, b) => a + b, 0)).toBe(325);
    expect(at(7).handScores.some((s) => s > 0)).toBe(true);

    // (8) quatro cards vinculados por ASSENTO nas 7 mãos (validado célula a célula acima).
    expect(log).toHaveLength(7);

    // (9) nenhuma regressão ranking × seat: em ALGUMA mão o líder não é o assento 0 (com total
    //     distinto); mesmo assim o card "Você" mostra o SEU total, nunca o do líder.
    const rankSwap = log.find((l) => {
      const leaderSeat = l.canon.indexOf(Math.max(...l.canon));
      return leaderSeat !== 0 && l.canon[leaderSeat] !== l.canon[0];
    });
    expect(rankSwap, "esperava ao menos uma mão com líder ≠ assento 0 e total distinto").toBeTruthy();
    const leaderSeat = rankSwap!.canon.indexOf(Math.max(...rankSwap!.canon));
    expect(rankSwap!.mesa[0]).toBe(rankSwap!.canon[0]);
    expect(rankSwap!.mesa[0]).not.toBe(rankSwap!.canon[leaderSeat]);
  });
});
