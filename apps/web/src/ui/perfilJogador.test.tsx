// MINI PERFIL — o que ele mostra, e principalmente o que ele NÃO mostra.
//
// A regra que esta suíte protege é a mais importante da tela: enquanto não existir camada de
// progressão, nada de XP, nível, partidas ou vitórias pode aparecer. Uma barra vazia ou um
// "Nível 1" fixo seriam a mesma dívida visível que já saiu do Placar Final por decisão anterior:
// prometer o que o jogo não entrega.
//
// A segunda regra é de sigilo: `playerId`, token de reconexão e código de sala existem no estado
// e não podem vazar por uma tela social.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, type HTMLElement } from "node-html-parser";
import {
  buildBotView, chooseNormalCard, createMatch, playCard, startNextHand,
  type MatchState, type Seat,
} from "@king/engine";
import { KingGame } from "../game/kingGame.js";
import { PerfilJogador, type ProgressoDoJogador } from "./PerfilJogador.js";
import type { AssentoLido } from "../net/clienteKing.js";

const JOGADORES = ["Você", "Bia", "Léo", "Nara"];
const SEATS: Seat[] = [0, 1, 2, 3];
const noop = () => {};

function assentos(over: Partial<AssentoLido>[] = []): AssentoLido[] {
  return SEATS.map((s) => ({
    seat: s, playerId: `segredo-${s}`, nick: JOGADORES[s],
    connected: true, ready: false, assisted: false, bot: false, host: s === 0,
    avatar: "leao", ...(over[s] ?? {}),
  }));
}

function render(
  assento: Seat, opts: { sala?: AssentoLido[] | null; progresso?: ProgressoDoJogador; jogo?: KingGame } = {},
): HTMLElement {
  const jogo = opts.jogo ?? new KingGame(JOGADORES, 42);
  return parse(renderToStaticMarkup(
    <PerfilJogador
      game={jogo}
      assento={assento}
      sala={opts.sala ?? assentos()}
      progresso={opts.progresso}
      onFechar={noop}
    />,
  ));
}

/** Uma partida com mãos concluídas: é o que produz estatística de verdade. */
function comMaosJogadas(quantas: number): KingGame {
  const m: MatchState = createMatch(JOGADORES, 42);
  for (let mao = 0; mao < quantas; mao++) {
    startNextHand(m);
    const h = m.hand!;
    if (h.awaitingTrumpFrom !== null) break;
    // joga a mão inteira com o Bot Normal, dos dois lados
    for (let guarda = 0; guarda < 60 && m.hand && m.hand.handScores === null; guarda++) {
      const t = m.hand.turn;
      if (t === null) break;
      playCard(m, t, chooseNormalCard(buildBotView(m, t)));
    }
  }
  const jogo = new KingGame(JOGADORES, 42);
  // @ts-expect-error acesso deliberado ao estado para montar o cenário do teste
  jogo.m = m;
  return jogo;
}

describe("o que existe é mostrado", () => {
  it("apelido, avatar e cor de identidade do assento", () => {
    const root = render(1);
    expect(root.querySelector(".pf-id b")?.text).toContain("Bia");
    expect(root.querySelector(".pf-av")?.getAttribute("class")).toContain("s1");
    expect(root.querySelector(".pf-av")?.getAttribute("aria-label")).toBeTruthy();
  });

  it("o saldo na partida, com sinal", () => {
    expect(render(0).querySelector(".pf-saldo")?.text?.trim() ?? "").toMatch(/^[+−]?\d/);
  });

  it("marca quem é você, e não marca os outros", () => {
    expect(render(0).querySelectorAll(".pf-voce")).toHaveLength(1);
    expect(render(2).querySelectorAll(".pf-voce")).toHaveLength(0);
  });

  it("a situação do assento sai do estado da sala, não de suposição", () => {
    const bot = render(2, { sala: assentos([{}, {}, { bot: true }]) });
    expect(bot.querySelector(".pf-situacao")?.text).toBe("Bot");

    const caido = render(2, { sala: assentos([{}, {}, { connected: false }]) });
    expect(caido.querySelector(".pf-situacao")?.text).toBe("Desconectado");

    const anfitriao = render(0);
    expect(anfitriao.querySelector(".pf-situacao")?.text).toBe("Anfitrião da sala");
  });

  it("é um diálogo acessível, com nome e botão de fechar rotulado", () => {
    const root = render(1);
    const dlg = root.querySelector(".pf");
    expect(dlg?.getAttribute("role")).toBe("dialog");
    expect(dlg?.getAttribute("aria-modal")).toBe("true");
    expect(dlg?.getAttribute("aria-label")).toContain("Bia");
    expect(root.querySelector(".pf-x")?.getAttribute("aria-label")).toBeTruthy();
  });
});

describe("nada é inventado", () => {
  it("SEM camada de progressão, nenhuma palavra de XP, nível, partidas ou vitórias", () => {
    const html = renderToStaticMarkup(
      <PerfilJogador game={new KingGame(JOGADORES, 42)} assento={1} sala={assentos()} onFechar={noop} />,
    );
    for (const proibido of [/\bXP\b/i, /\bn[íi]vel\b/i, /vit[óo]rias/i, /partidas jogadas/i, /conquista/i]) {
      expect(html, `apareceu ${proibido} sem fonte real`).not.toMatch(proibido);
    }
    expect(parse(html).querySelectorAll(".pf-progresso")).toHaveLength(0);
    expect(parse(html).querySelectorAll(".pf-barra")).toHaveLength(0);
  });

  it("COM progressão real, a seção aparece e usa os números recebidos", () => {
    const root = render(1, {
      progresso: { nivel: 7, xp: 320, xpDoProximoNivel: 500, partidas: 41, vitorias: 12 },
    });
    expect(root.querySelector(".pf-nivel b")?.text).toBe("Nível 7");
    expect(root.querySelector(".pf-nivel span")?.text).toBe("320 / 500 XP");
    expect(root.querySelector(".pf-hist")?.text).toContain("41 partidas");
    expect(root.querySelector(".pf-hist")?.text).toContain("12 vitórias");
  });

  it("partida sem mão concluída não inventa estatística: diz que ainda não há", () => {
    const root = render(1);
    expect(root.querySelectorAll(".pf-linhas")).toHaveLength(0);
    expect(root.querySelector(".pf-vazio")?.text).toContain("primeira mão");
  });

  it("com mãos jogadas, as linhas saem do motor", () => {
    const root = render(0, { jogo: comMaosJogadas(2) });
    const linhas = root.querySelectorAll(".pf-linhas li");
    expect(linhas.length).toBeGreaterThan(0);
    // "Negativas ilesas: N de M" — o M é quantas negativas já foram jogadas, nunca 6 fixo
    const ilesas = linhas.find((l) => l.text.includes("Negativas ilesas"));
    expect(ilesas?.text).toMatch(/\d+ de [12]/);
  });
});

describe("nada privado atravessa", () => {
  it("nenhum identificador interno, token ou código de sala no HTML", () => {
    const html = renderToStaticMarkup(
      <PerfilJogador
        game={new KingGame(JOGADORES, 42)}
        assento={2}
        sala={assentos()}
        onFechar={noop}
      />,
    );
    for (const proibido of [/segredo-/, /playerId/i, /sessionToken/i, /recovery/i,
      /roomId/i, /roomCode/i, /\bseed\b/i]) {
      expect(html, `vazou: ${proibido}`).not.toMatch(proibido);
    }
  });

  it("nenhuma carta de ninguém: perfil fala de resultado, não de mão", () => {
    const html = renderToStaticMarkup(
      <PerfilJogador game={comMaosJogadas(2)} assento={1} sala={assentos()} onFechar={noop} />,
    );
    expect(html).not.toMatch(/♠|♥|♦|♣/);
    expect(html).not.toMatch(/ de (hearts|diamonds|clubs|spades)/);
  });
});

describe("funciona sem sala — partida local contra bots", () => {
  it("sem estado de sala não quebra, e não afirma situação nenhuma", () => {
    const root = render(1, { sala: null });
    expect(root.querySelector(".pf-id b")?.text).toContain("Bia");
    expect(root.querySelectorAll(".pf-situacao")).toHaveLength(0);
  });
});

