/**
 * A IDENTIDADE DE UM ASSENTO ATRAVESSA A SESSÃO INTEIRA SEM MUDAR.
 *
 * ══ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ══
 *
 * Numa partida real, a Raiza escolheu o Unicórnio no lobby e entrou na mesa como Leão. E, nos
 * placares entre mãos, os quatro bichos da mesa viravam quatro letras — "T", "V", "R", "R".
 *
 * As duas coisas têm a mesma forma: a pergunta "qual é o avatar deste assento?" era respondida
 * por cada tela do seu jeito, e telas diferentes davam respostas diferentes. Uma lia só o estado
 * da sala (e não sabia responder no modo local), outra caía na inicial do nome, outra no padrão.
 *
 * Aqui trava-se o contrato:
 *
 *   1. os OITO avatares atravessam Mesa, placar entre-mãos, placar final, perfil e consenso sem
 *      virar outro bicho — em especial `unicornio → unicornio`, nunca `unicornio → leao`;
 *   2. a resposta vem de UMA função, `etiquetaDoAvatar`, com uma ordem de autoridade declarada;
 *   3. sem identidade nenhuma, o resultado é a inicial — NÃO o Leão. "Não sei" precisa parecer
 *      diferente de "é o leão", senão o próximo defeito desta família passa despercebido.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, type HTMLElement } from "node-html-parser";
import {
  createMatch, startNextHand, playCard, redactFor, chooseNormalCard, buildBotView,
  type MatchState, type Seat,
} from "@king/engine";
import { KingGame } from "../game/kingGame.js";
import { PartidaRemota } from "../game/partidaRemota.js";
import { Mesa, type MesaMultiplayer } from "./Mesa.js";
import { PerfilJogador } from "./PerfilJogador.js";
import { PlacarFinal } from "./PlacarFinal.js";
import { etiquetaDoAvatar } from "./Insignia.js";
import { AVATARES, desenhoDoAvatar } from "./avatares.js";
import { avatarLocalDoAssento } from "../game/adversarios.js";
import type { AtualizacaoDeEstado } from "../net/protocolo.js";
import type { AssentoLido, EstadoDaSalaLido } from "../net/clienteKing.js";

const noop = () => {};
const JOGADORES = ["Tito", "Raiza", "Léo", "Nara"];
const SEATS: Seat[] = [0, 1, 2, 3];

/** Uma mão jogada até o fim: é o que faz a Mesa mostrar o placar entre-mãos. */
function maoTerminada(): MatchState {
  const m = createMatch(JOGADORES, 13);
  startNextHand(m);
  for (let g = 0; g < 3000; g++) {
    if (m.hand!.handScores !== null) break;
    const s = m.hand!.turn!;
    playCard(m, s, chooseNormalCard(buildBotView(m, s)));
  }
  return m;
}

function assentos(avatares: string[]): AssentoLido[] {
  return SEATS.map((s) => ({
    seat: s, playerId: `p${s}`, nick: JOGADORES[s],
    connected: true, ready: false, assisted: false, bot: false, host: s === 0,
    avatar: avatares[s],
  }));
}

function sala(avatares: string[]): EstadoDaSalaLido {
  return {
    protocolVersion: 2, roomCode: "0315", roomId: "0315", status: "playing",
    seats: assentos(avatares),
  };
}

function contexto(eu: Seat, avatares: string[], over: Partial<MesaMultiplayer> = {}): MesaMultiplayer {
  return {
    eu, sala: sala(avatares), conexao: "conectado", relogio: null, prontos: [],
    recusa: null, emVoo: null, aguardando: false, pediProximaMao: false,
    mensagens: {}, onEnviarMensagem: noop, onCancelarProximaMao: noop, ...over,
  };
}

function mesa(m: MatchState, eu: Seat, mp?: MesaMultiplayer): HTMLElement {
  const u: AtualizacaoDeEstado = {
    matchId: "m1", stateVersion: 9, view: redactFor(m, eu), cause: "CARD_PLAYED",
  };
  return parse(renderToStaticMarkup(
    <Mesa
      game={new PartidaRemota(u, eu, noop)} reviewing={false} shake={0} castigo={null}
      onPlay={noop} onChooseTrump={noop} onAdvance={noop} onHome={noop} onRestart={noop}
      onOpenAudio={noop} mp={mp}
    />,
  ));
}

/** Os glifos desenhados por um seletor, na ordem do documento. */
const glifos = (root: HTMLElement, sel: string): string[] =>
  root.querySelectorAll(sel).map((n) => n.text.trim());

describe("os oito avatares atravessam a sessão", () => {
  /**
   * O teste completo, um avatar de cada vez, no assento de quem está jogando E num assento de
   * adversário. Os dois lugares importam: o defeito relatado apareceu no card de OUTRA pessoa, e
   * um teste que só olhasse o próprio assento não teria visto nada.
   */
  it.each(AVATARES)("%s continua %s da Mesa ao perfil", (escolhido) => {
    // O escolhido no assento 1 (a Raiza, que foi quem viu o defeito); os outros três recebem
    // bichos diferentes entre si, para nenhuma igualdade passar por coincidência.
    const outros = AVATARES.filter((a) => a !== escolhido);
    const avatares = [outros[0], escolhido, outros[1], outros[2]];
    const esperado = desenhoDoAvatar(escolhido).glifo;
    const m = maoTerminada();
    const mp = contexto(0, avatares);

    // 1 · a resolução canônica, antes de qualquer tela
    expect(etiquetaDoAvatar(new PartidaRemota(
      { matchId: "m", stateVersion: 1, view: redactFor(m, 0), cause: "CARD_PLAYED" }, 0, noop,
    ), mp.sala!.seats, 1)).toBe(escolhido);

    // 2 · Mesa (card do adversário) e 3 · placar entre-mãos, na mesma árvore
    const tela = mesa(m, 0, mp);
    expect(glifos(tela, ".opp .av")).toContain(esperado);
    expect(glifos(tela, ".pl-av"), "placar entre-mãos sem o bicho").toContain(esperado);
    // e o placar não desenhou NENHUMA inicial no lugar de um bicho
    expect(glifos(tela, ".pl-av").sort())
      .toEqual(avatares.map((a) => desenhoDoAvatar(a).glifo).sort());

    // 4 · consenso da próxima mão (a fileira de "quem já confirmou")
    expect(glifos(tela, ".pl-pronto-av")).toContain(esperado);

    // 5 · placar final
    const fim = parse(renderToStaticMarkup(
      <PlacarFinal
        game={new PartidaRemota(
          { matchId: "m", stateVersion: 9, view: redactFor(m, 0), cause: "CARD_PLAYED" }, 0, noop,
        )}
        onRestart={noop} onHome={noop} mp={mp}
      />,
    ));
    expect(glifos(fim, ".fimlinha .av").sort())
      .toEqual(avatares.map((a) => desenhoDoAvatar(a).glifo).sort());

    // 6 · perfil do jogador
    const perfil = parse(renderToStaticMarkup(
      <PerfilJogador
        game={new KingGame(JOGADORES, 42)} assento={1} sala={assentos(avatares)} onFechar={noop}
      />,
    ));
    expect(perfil.querySelector(".pf-av")?.text.trim()).toBe(esperado);
  });

  it("nenhum avatar do catálogo colide com outro — a mesa é sempre legível", () => {
    expect(new Set(AVATARES.map((a) => desenhoDoAvatar(a).glifo)).size).toBe(AVATARES.length);
  });
});

describe("a ordem de autoridade da identidade", () => {
  const local = () => new KingGame(JOGADORES, 42);

  it("a SALA manda quando existe multiplayer", () => {
    const g = local();
    // A partida local tem opinião sobre o assento 1; a sala diz outra coisa, e é ela que vale.
    expect(avatarLocalDoAssento(1)).not.toBe("unicornio");
    expect(etiquetaDoAvatar(g, assentos(["leao", "unicornio", "raposa", "sapo"]), 1))
      .toBe("unicornio");
  });

  it("sem sala, quem responde é a PARTIDA LOCAL", () => {
    const g = local();
    for (const s of SEATS) expect(etiquetaDoAvatar(g, null, s)).toBe(avatarLocalDoAssento(s));
  });

  it("sem sala e sem partida que saiba, a resposta é `undefined` — nunca o Leão", () => {
    const m = maoTerminada();
    const remota = new PartidaRemota(
      { matchId: "m", stateVersion: 1, view: redactFor(m, 0), cause: "CARD_PLAYED" }, 0, noop,
    );
    // `PartidaRemota` não inventa identidade: quem sabe é a sala, e aqui não há sala.
    for (const s of SEATS) expect(etiquetaDoAvatar(remota, null, s)).toBeUndefined();
  });

  /**
   * O ESTADO DEGENERADO, testado de propósito e SEPARADO da partida.
   *
   * Sem etiqueta nenhuma a insígnia cai na inicial do nome. Isso é defesa, não projeto: numa
   * partida normal este caminho não é exercido — os testes acima provam que sempre há resposta.
   * O que ele não pode ser é o Leão, porque foi exatamente assim que quatro cards diferentes
   * passaram meses abrindo o mesmo bicho sem ninguém notar.
   */
  it("sem etiqueta, a tela mostra a INICIAL — o fallback não mente sobre quem é", () => {
    const m = maoTerminada();
    const tela = mesa(m, 0, undefined); // multiplayer sem sala: não deveria acontecer
    const desenhados = glifos(tela, ".opp .av");
    expect(desenhados.length).toBeGreaterThan(0);
    for (const d of desenhados) {
      expect(d).not.toBe(desenhoDoAvatar("leao").glifo);
      expect(d).toHaveLength(1); // uma letra
    }
  });
});
