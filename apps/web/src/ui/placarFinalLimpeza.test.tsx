/**
 * O PLACAR FINAL DEPOIS DA PODA.
 *
 * A tela do fim de partida tinha virado painel: além do pódio e dos saldos, ela abria um bloco
 * "Última mão" repetindo o que o placar entre-mãos já havia mostrado com mais detalhe, e três
 * selos — "Amplitude", "Negativas ilesas" e "Soma dos saldos = 0 ✓". Os três eram verdadeiros e
 * nenhum era para o jogador: um é a subtração entre a primeira e a última linha logo acima, outro
 * é vocabulário de dentro do projeto, e o terceiro é o checksum do motor, instrumento de
 * auditoria — o jogo mostrando a quem jogou que confere as próprias contas.
 *
 * NADA DE CÁLCULO MUDOU, e é isso que estes testes protegem: `stats` continua produzindo tudo,
 * `finais` continua ordenado, o checksum continua sendo verificado onde sempre foi (no motor).
 * O que saiu foi a renderização.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createMatch, startNextHand, playCard, chooseNormalCard, buildBotView } from "@king/engine";
import { KingGame } from "../game/kingGame.js";
import { construirDestaques } from "./PlacarFinal.js";

const JOGADORES = ["Tito", "Raiza", "Léo", "Nara"];

/** Uma partida inteira, pelo motor de verdade — é o que produz estatística real. */
function partidaCompleta(): KingGame {
  const g = new KingGame(JOGADORES, 42);
  for (let guarda = 0; guarda < 40_000 && g.phase() !== "matchEnd"; guarda++) {
    if (g.isHumanTurn()) g.playHuman(g.legalCards()[0]);
    else if (g.needsBotPlay()) g.stepBotPlay();
    else if (g.needsBotTrump()) g.stepBotTrump();
    // Nas mãos positivas a rotação também chega no humano: sem esta linha a partida para na
    // escolha do trunfo e nunca alcança o fim, que é justamente a tela sob teste.
    else if (g.phase() === "trump") g.chooseTrumpHuman("hearts");
    else if (g.phase() === "handEnd") g.advanceHand();
    else break;
  }
  return g;
}

describe("os selos do placar final", () => {
  it("sobra UM selo, e é o que conta uma história", () => {
    const g = partidaCompleta();
    expect(g.phase()).toBe("matchEnd");
    const d = construirDestaques(g, g.stats(), g.humanSeat, false, false);

    expect(d.chips).toHaveLength(1);
    expect(d.chips[0]).toMatch(/^Melhor mão da partida:/);
    // e os três que saíram não voltaram por outro caminho
    const tudo = d.chips.join(" | ");
    expect(tudo).not.toMatch(/Amplitude/i);
    expect(tudo).not.toMatch(/Negativas ilesas/i);
    expect(tudo).not.toMatch(/Soma dos saldos/i);
  });

  it("o destaque narrativo continua inteiro — a poda foi nos selos, não na história", () => {
    const g = partidaCompleta();
    const d = construirDestaques(g, g.stats(), g.humanSeat, false, false);
    expect(d.titulo).toMatch(/\S/);
    expect(d.texto).toMatch(/\S/);
  });

  it("o CÁLCULO continua existindo — só deixou de ser desenhado", () => {
    const g = partidaCompleta();
    const stats = g.stats();
    const finais = g.rankings();
    // amplitude: continua derivável em uma subtração, de dados que o motor entrega
    expect(finais[0].score - finais[finais.length - 1].score).toBeGreaterThanOrEqual(0);
    // negativas ilesas: continua no `stats`, jogador a jogador
    expect(stats.perSeat[g.humanSeat].cleanNegatives).toBeGreaterThanOrEqual(0);
    // checksum: continua sendo zero, que é o que ele sempre serviu para dizer
    expect(finais.reduce((t, r) => t + r.score, 0)).toBe(0);
  });
});

/**
 * A TRIPWIRE DE RENDERIZAÇÃO.
 *
 * O bloco "Última mão" e o selo do checksum eram JSX puro dentro da etapa final da encenação, que
 * só existe depois de temporizadores — território de Playwright, não de `renderToStaticMarkup`.
 * Ler o próprio arquivo é o guarda mais barato que ainda é honesto: se alguém reintroduzir
 * qualquer um dos quatro, isto acusa, e o comentário que explica a ausência está logo ao lado no
 * código para quem for reintroduzir pensar duas vezes.
 */
describe("os quatro elementos não voltaram ao arquivo", () => {
  const fonte = readFileSync(new URL("./PlacarFinal.tsx", import.meta.url), "utf8");
  // Só a parte executável: os comentários FALAM dos quatro de propósito, explicando a ausência.
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it.each([
    ["fimultima", /className="fimultima"/],
    ["Amplitude", /Amplitude/],
    ["Negativas ilesas", /Negativas ilesas/],
    ["Soma dos saldos", /Soma dos saldos/],
  ])("%s não é renderizado", (_rotulo, padrao) => {
    expect(codigo).not.toMatch(padrao);
  });
});
