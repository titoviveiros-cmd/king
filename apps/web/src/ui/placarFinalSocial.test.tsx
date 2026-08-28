/**
 * FALAR NO PLACAR FINAL.
 *
 * O momento mais social da partida era o único mudo. Quem ganhou quer provocar, quem perdeu quer
 * reclamar, e os quatro ficam parados olhando a mesma tela — sem nenhum caminho para dizer nada.
 * O botão existia na Mesa e no placar entre-mãos, e desaparecia justamente onde a conversa
 * acontece.
 *
 * O que estes testes seguram são as DUAS metades do recurso, cada uma pelo instrumento que a
 * alcança:
 *
 *  - o BALÃO de quem falou vive numa `.fimlinha`, e as linhas do ranking existem desde o primeiro
 *    quadro — dá para renderizar e ler;
 *  - o BOTÃO vive em `.fimacoes`, que só nasce na etapa `completo`, atrás de temporizadores. É
 *    território de Playwright, e nenhum caminho de e2e chega a um placar final MULTIPLAYER sem
 *    jogar dez mãos com dois navegadores. A tripwire de fonte é o guarda mais barato que ainda é
 *    honesto — a mesma escolha, pelo mesmo motivo, de `placarFinalLimpeza.test.tsx`.
 *
 * E o `mp &&` na frente dos dois não é detalhe: no solo não há com quem falar, e um botão de chat
 * numa partida contra bots seria uma promessa que a tela não pode cumprir.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import type { Seat } from "@king/engine";
import { KingGame } from "../game/kingGame.js";
import { PlacarFinal } from "./PlacarFinal.js";
import type { MesaMultiplayer } from "./MesaOnline.js";

const noop = () => {};
const FONTE = readFileSync(new URL("./PlacarFinal.tsx", import.meta.url), "utf8");
// Só a parte EXECUTÁVEL: o comentário ao lado do botão explica por que ele existe, e um teste que
// lesse a prosa junto proibiria o código de contar a própria história.
const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Uma partida inteira, pelo motor de verdade — é o que faz o placar final ter o que desenhar. */
function partidaCompleta(): KingGame {
  const g = new KingGame(["Tito", "Raiza", "Léo", "Nara"], 42);
  for (let guarda = 0; guarda < 40_000 && g.phase() !== "matchEnd"; guarda++) {
    if (g.isHumanTurn()) g.playHuman(g.legalCards()[0]);
    else if (g.needsBotPlay()) g.stepBotPlay();
    else if (g.needsBotTrump()) g.stepBotTrump();
    else if (g.phase() === "trump") g.chooseTrumpHuman("hearts");
    else if (g.phase() === "handEnd") g.advanceHand();
    else break;
  }
  return g;
}

function mesa(mensagens: MesaMultiplayer["mensagens"] = {}): MesaMultiplayer {
  return {
    eu: 0 as Seat, sala: null, conexao: "online", relogio: null, prontos: [],
    recusa: null, emVoo: null, aguardando: false, pediProximaMao: false,
    mensagens, onEnviarMensagem: noop, onCancelarProximaMao: noop,
  };
}

function desenhar(mp?: MesaMultiplayer) {
  const g = partidaCompleta();
  return parse(renderToStaticMarkup(
    <PlacarFinal game={g} onRestart={noop} onHome={noop} mp={mp} />,
  ));
}

describe("o balão de quem falou, no ranking do fim", () => {
  it("a frase aparece na linha de QUEM a disse — e só nela", () => {
    const root = desenhar(mesa({ 2: { id: "boa", nonce: 1 } }));
    const linhas = root.querySelectorAll(".fimlinha");
    expect(linhas).toHaveLength(4);
    const comBalao = linhas.filter((l) => l.querySelectorAll(".balao").length > 0);
    expect(comBalao, "a frase vazou para mais de uma linha").toHaveLength(1);
    expect(comBalao[0].querySelector(".balao")!.text).toMatch(/\S/);
  });

  it("sem ninguém falando, nenhuma linha carrega balão vazio ocupando lugar", () => {
    const root = desenhar(mesa());
    expect(root.querySelectorAll(".fimlinha")).toHaveLength(4);
    expect(root.querySelectorAll(".balao")).toHaveLength(0);
  });

  it("no solo não há balão nenhum — nem a caixa", () => {
    const root = desenhar(undefined);
    expect(root.querySelectorAll(".fimlinha")).toHaveLength(4);
    expect(root.querySelectorAll(".balao")).toHaveLength(0);
  });
});

/**
 * O BOTÃO — atrás de temporizadores, lido na fonte.
 *
 * Três coisas precisam continuar verdadeiras, e cada uma já quebrou uma vez em alguma tela deste
 * projeto: o botão só existe com `mp`, ele reusa o MESMO componente da Mesa (mesmo catálogo
 * fechado, mesma validação e mesmo anti-spam do servidor, em vez de um segundo caminho social), e
 * ele se identifica como a variante do fim — é a variante que decide onde o painel abre, e um
 * painel que abrisse para fora da tela seria um botão que não funciona.
 */
describe("o botão de falar, na fileira dos CTAs", () => {
  it("só é renderizado quando há multiplayer", () => {
    expect(CODIGO).toContain("{mp && <BotaoSocial");
  });

  it("é o componente da Mesa, não um segundo caminho social", () => {
    expect(CODIGO).toContain('import { BalaoSocial, BotaoSocial');
    expect(CODIGO).not.toMatch(/CATALOGO|FRASES_SOCIAIS/);
  });

  it('se declara como a variante "fim", que é quem posiciona o painel', () => {
    expect(CODIGO).toMatch(/<BotaoSocial[^>]*variante="fim"/);
  });

  it("mora dentro de `.fimacoes`, junto dos outros botões — não solto sobre a tela", () => {
    const acoes = CODIGO.slice(CODIGO.indexOf('className="fimacoes"'));
    const fecha = acoes.indexOf("</div>");
    expect(acoes.slice(0, fecha)).toContain("BotaoSocial");
  });
});
