// @vitest-environment jsdom
/**
 * BUG 2 (regressão) — a pontuação dos player cards da Mesa deve derivar SEMPRE do score canônico
 * do motor (`game.cumulative()`), associado pelo `seat` estável, e reagir a cada mão — sem esperar
 * troca de fase e sem placar paralelo na Presentation Layer.
 *
 * Este teste renderiza a Mesa REAL, dirige a partida pela API pública do adaptador (sem replicar
 * regra) e, a cada fim de mão, compara célula a célula: Mesa (card) × Placar entre-mãos × motor,
 * por ASSENTO. Cobre os 9 casos pedidos, incluindo a prova explícita de que o score da Mesa muda
 * entre duas mãos da MESMA fase (o defeito relatado no aparelho).
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { KingGame } from "../game/kingGame.js";
import { Mesa } from "./Mesa.js";

beforeAll(() => {
  // jsdom não implementa matchMedia; a Mesa (useCoarsePointer) precisa dele.
  if (!window.matchMedia) {
    // @ts-expect-error polyfill mínimo para o ambiente de teste
    window.matchMedia = (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    });
  }
});
afterEach(() => cleanup());

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

/** Score exibido em cada card da Mesa, indexado por ASSENTO (0 = Você, 1 esq, 2 topo, 3 dir). */
function mesaScoresBySeat(root: HTMLElement): (number | null)[] {
  return [
    parsePts(root.querySelector(".youtag .m")?.textContent),
    parsePts(root.querySelector(".opp.left .pt")?.textContent),
    parsePts(root.querySelector(".opp.top .pt")?.textContent),
    parsePts(root.querySelector(".opp.right .pt")?.textContent),
  ];
}
/** Total exibido em cada linha do Placar entre-mãos, indexado por ASSENTO (via classe .pl-av.s{seat}). */
function placarScoresBySeat(root: HTMLElement): (number | null)[] {
  const v: (number | null)[] = [null, null, null, null];
  root.querySelectorAll(".pl-row").forEach((row) => {
    const cls = [...(row.querySelector(".pl-av")?.classList ?? [])].find((c) => /^s[0-3]$/.test(c));
    if (cls) v[+cls[1]] = parseTot(row.querySelector(".pl-total")?.textContent);
  });
  return v;
}

function renderMesa(game: KingGame, key: number) {
  return render(
    <Mesa
      key={key} game={game} reviewing={false} shake={0}
      onPlay={noop} onChooseTrump={noop} onAdvance={noop} onHome={noop} onRestart={noop} onOpenAudio={noop}
    />,
  );
}

const SEATS = [0, 1, 2, 3] as const;

describe("BUG 2 — score dos player cards da Mesa é o canônico do motor, por assento", () => {
  it("card inicial mostra 0 para os quatro assentos", () => {
    const game = new KingGame(["Você", "Bia", "Léo", "Nara"], 42);
    const { container } = renderMesa(game, 0);
    expect(mesaScoresBySeat(container)).toEqual([0, 0, 0, 0]);
  });

  it("a cada mão: Mesa == Placar == cumulativo do motor (por assento) e muda entre mãos da mesma fase", () => {
    const game = new KingGame(["Você", "Bia", "Léo", "Nara"], 42);
    const log: Array<{ hand: number; canon: number[]; mesa: (number | null)[]; placar: (number | null)[]; handScores: number[] }> = [];

    for (let hand = 1; hand <= 7; hand++) {
      playHandToEnd(game);
      const { container } = renderMesa(game, hand);
      const canon = game.cumulative();
      const mesa = mesaScoresBySeat(container);
      const placar = placarScoresBySeat(container);
      const handScores = game.summary()!.scores;

      // Mesa e Placar refletem EXATAMENTE o cumulativo do motor, assento a assento.
      for (const seat of SEATS) {
        expect(mesa[seat], `Mesa · assento ${seat} · mão ${hand}`).toBe(canon[seat]);
        expect(placar[seat], `Placar · assento ${seat} · mão ${hand}`).toBe(canon[seat]);
      }

      log.push({ hand, canon: [...canon], mesa, placar, handScores: [...handScores] });
      cleanup();
      if (game.phase() !== "matchEnd") game.advanceHand();
    }

    const at = (h: number) => log.find((l) => l.hand === h)!;

    // (1) score inicial coerente: mão 1 (não pegar vazas) distribui −260 no total.
    expect(at(1).canon.reduce((a, b) => a + b, 0)).toBe(-260);

    // (2)(3)(4) o score da MESA muda entre duas mãos NEGATIVAS (mesma fase) — antes de qualquer
    // troca de fase. É a reprodução exata do defeito: entre a mão 3 e a 4 o card já deve mudar.
    expect(at(4).mesa).not.toEqual(at(3).mesa);
    expect(at(4).mesa[0]).not.toBe(at(3).mesa[0]); // "Você" muda (−80 → −110) sem esperar a Mão 7

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

    // (8) quatro cards vinculados por ASSENTO: em toda mão registrada, cada card == cumulativo do
    //     seu assento (já validado célula a célula acima para os 4 assentos e as 7 mãos).
    expect(log).toHaveLength(7);

    // (9) nenhuma regressão ranking × seat: buscamos uma mão em que o LÍDER não seja o assento 0
    //     (e com total distinto do assento 0). Mesmo assim o card "Você" (assento 0) mostra o SEU
    //     total, nunca o do líder → a Mesa liga por `seat`, jamais por posição visual do ranking.
    const rankSwap = log.find((l) => {
      const leaderSeat = l.canon.indexOf(Math.max(...l.canon));
      return leaderSeat !== 0 && l.canon[leaderSeat] !== l.canon[0];
    });
    expect(rankSwap, "esperava ao menos uma mão com líder ≠ assento 0 e total distinto").toBeTruthy();
    const leaderSeat = rankSwap!.canon.indexOf(Math.max(...rankSwap!.canon));
    expect(rankSwap!.mesa[0]).toBe(rankSwap!.canon[0]);              // Você = próprio total
    expect(rankSwap!.mesa[0]).not.toBe(rankSwap!.canon[leaderSeat]); // ≠ total do líder
  });
});
