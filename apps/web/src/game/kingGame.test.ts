import { describe, it, expect } from "vitest";
import { chooseTrumpByMajority } from "@king/engine";
import { KingGame } from "./kingGame.js";

const PLAYERS = ["Você", "Bia", "Léo", "Nara"];
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

// Driver que executa a partida INTEIRA usando SÓ os métodos do adaptador (como a UI faria).
// O "humano" aqui é automatizado escolhendo a primeira carta legal.
function playFullMatch(g: KingGame): void {
  let guard = 0;
  while (!g.finished()) {
    if (++guard > 20000) throw new Error("loop de segurança");
    const ph = g.phase();
    if (ph === "handEnd") { g.advanceHand(); continue; }
    if (ph === "trump") {
      if (g.humanChoosesTrump()) g.chooseTrumpHuman(chooseTrumpByMajority(g.view().yourHand));
      else g.stepBotTrump();
      continue;
    }
    // play
    if (g.isHumanTurn()) g.playHuman(g.legalCards()[0]);
    else g.stepBotPlay();
  }
}

describe("integração adaptador ↔ engine — 1 humano + 3 bots", () => {
  it("completa as 10 mãos e preserva os checksums (−1300 / +1300 / 0)", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const g = new KingGame(PLAYERS, seed);
      playFullMatch(g);
      expect(g.finished()).toBe(true);
      expect(g.history()).toHaveLength(10);
      expect(sum(g.negatives())).toBe(-1300);
      expect(sum(g.positives())).toBe(1300);
      expect(sum(g.cumulative())).toBe(0);
      // há um (ou mais, em empate) vencedor
      expect(g.winners().length).toBeGreaterThanOrEqual(1);
    }
  });

  it("o humano enxerga somente a própria mão (13 cartas) — informação oculta", () => {
    const g = new KingGame(PLAYERS, 7);
    const v = g.view();
    expect(v.yourHand).toHaveLength(13);
    expect(v.yourSeat).toBe(0);
    // a visão pública não expõe as mãos dos adversários
    expect((v as Record<string, unknown>).hands).toBeUndefined();
  });

  it("cartas legais vêm do engine; jogada ilegal é rejeitada pela autoridade", () => {
    const g = new KingGame(PLAYERS, 3);
    let guard = 0;
    while (!g.isHumanTurn() && ++guard < 30) {
      if (g.needsBotTrump()) g.stepBotTrump();
      else if (g.needsBotPlay()) g.stepBotPlay();
      else break;
    }
    expect(g.isHumanTurn()).toBe(true);
    const legal = g.legalCards();
    expect(legal.length).toBeGreaterThan(0);
    const illegal = g.view().yourHand.find(
      (c) => !legal.some((l) => l.rank === c.rank && l.suit === c.suit),
    );
    if (illegal) expect(() => g.playHuman(illegal)).toThrow();
  });

  it("chega às mãos positivas e o humano escolhe trunfo exatamente uma vez", () => {
    const g = new KingGame(PLAYERS, 5);
    let humanTrumpChoices = 0;
    let guard = 0;
    while (!g.finished()) {
      if (++guard > 20000) throw new Error("loop");
      const ph = g.phase();
      if (ph === "handEnd") { g.advanceHand(); continue; }
      if (ph === "trump") {
        if (g.humanChoosesTrump()) { g.chooseTrumpHuman("no-trump"); humanTrumpChoices++; }
        else g.stepBotTrump();
        continue;
      }
      if (g.isHumanTurn()) g.playHuman(g.legalCards()[0]);
      else g.stepBotPlay();
    }
    expect(humanTrumpChoices).toBe(1); // rotação M7→P0..M10→P3: o humano (P0) escolhe uma vez
  });
});

describe("summary() — dados do Placar entre-mãos", () => {
  it("só existe entre as mãos e descreve corretamente a mão que acabou", () => {
    const g = new KingGame(PLAYERS, 21);
    expect(g.summary()).toBeNull(); // mão 1 em andamento

    const seen: number[] = [];
    let guard = 0;
    while (!g.finished()) {
      if (++guard > 20000) throw new Error("loop de segurança");
      const ph = g.phase();
      if (ph === "handEnd") {
        const s = g.summary()!;
        seen.push(s.handNumber);
        // o delta da mão bate com o contrato e com o detalhamento
        expect(sum(s.scores)).toBe(s.contract.handTotal);
        expect(s.breakdown.rows.map((r) => r.points)).toEqual(s.scores);
        // ranking exibido = ranking do motor; antes + delta = depois
        expect(s.rankAfter).toEqual(g.rankings());
        for (const before of s.rankBefore) {
          const after = s.rankAfter.find((r) => r.seat === before.seat)!;
          expect(before.score + s.scores[before.seat]).toBe(after.score);
        }
        // próximo contrato: existe até a 9ª, some na 10ª
        if (s.handNumber < 10) expect(s.nextContract?.hand).toBe(s.handNumber + 1);
        else expect(s.nextContract).toBeNull();
        // trunfo só nas positivas
        expect(s.trump === null).toBe(!s.contract.isPositive);
        g.advanceHand();
        continue;
      }
      if (ph === "trump") {
        if (g.humanChoosesTrump()) g.chooseTrumpHuman(chooseTrumpByMajority(g.view().yourHand));
        else g.stepBotTrump();
        continue;
      }
      if (g.isHumanTurn()) g.playHuman(g.legalCards()[0]);
      else g.stepBotPlay();
    }
    // mãos 1..9 encerram em "handEnd"; a 10ª cai direto em "matchEnd" (fim de partida),
    // por isso a Mesa renderiza o Placar nas duas fases.
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(g.phase()).toBe("matchEnd");
    const last = g.summary()!;
    expect(last.handNumber).toBe(10);
    expect(last.finished).toBe(true);
    expect(last.nextContract).toBeNull();
    expect(sum(last.rankAfter.map((r) => r.score))).toBe(0); // checksum final
  });
});
