/**
 * O SEQUENCIAMENTO DA ÚLTIMA MÃO — anúncio primeiro, mão depois. Nunca os dois juntos.
 *
 * ══ O DEFEITO ══
 *
 * O anúncio esperava a escolha do trunfo sair da frente (`phase !== "trump"`) e entrava depois
 * dela — com a mão JÁ EM CURSO atrás do véu. Medido a 852×393 numa partida solo: aos 1000ms havia
 * uma carta na vaza, aos 1500ms havia duas e a vez do humano já estava aberta, tudo por baixo da
 * animação. Quem parou para assistir saía do anúncio com a vaza em andamento.
 *
 * Adiar não é sequenciar. A ordem certa é a terceira: o anúncio PRIMEIRO, inteiro e sozinho, com
 * a Mesa sem nada da mão nova; a escolha do trunfo e as cartas DEPOIS.
 *
 * ══ POR QUE AQUI, E NÃO SÓ NO PLAYWRIGHT ══
 *
 * O e2e prova a linha do tempo — anúncio na tela, nada acontece; anúncio sai, cartas entram — e
 * ele existe, em `apps/web/tests/ultimaMao.spec.ts`. O que ele não alcança em tempo razoável é o
 * MULTIPLAYER: chegar à mão 10 com dois navegadores custa dez mãos jogadas pela interface.
 *
 * Só que a pergunta do multiplayer é a mesma pergunta de renderização, no MESMO componente: a
 * Mesa é uma só, e o que muda é a presença do `mp`. Então cada afirmação aqui roda nos dois
 * modos, e o modo online ganha as suas próprias — o relógio da decisão, que só existe nele.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, type HTMLElement } from "node-html-parser";
import { createMatch, redactFor, startNextHand, TOTAL_HANDS, type MatchState, type Seat } from "@king/engine";
import { KingGame } from "../game/kingGame.js";
import { PartidaRemota } from "../game/partidaRemota.js";
import { Mesa, type MesaMultiplayer } from "./Mesa.js";
import type { AtualizacaoDeEstado } from "../net/protocolo.js";
import type { EstadoDaSalaLido } from "../net/clienteKing.js";

const noop = () => {};
const JOGADORES = ["Você", "Bia", "Léo", "Nara"];
const SEATS: Seat[] = [0, 1, 2, 3];
const AVATARES_DA_MESA = ["leao", "sapo", "coruja", "unicornio"];

function sala(): EstadoDaSalaLido {
  return {
    protocolVersion: 1, roomCode: "0315", roomId: "0315", status: "playing",
    seats: SEATS.map((s) => ({
      seat: s, playerId: "p" + s, nick: JOGADORES[s],
      connected: true, ready: false, assisted: false, bot: false, host: s === 0,
      avatar: AVATARES_DA_MESA[s],
    })),
  };
}

/** Um relógio em contagem: no multiplayer é o que apareceria por cima do anúncio. */
function contexto(): MesaMultiplayer {
  return {
    eu: 0, sala: sala(), conexao: "conectado",
    relogio: { tipo: "TRUMP", seat: 0, fase: "NORMAL", restanteMs: 30_000, recebidoEm: 0 },
    prontos: [], recusa: null, emVoo: null, aguardando: false, pediProximaMao: false,
    mensagens: {}, onEnviarMensagem: noop, onCancelarProximaMao: noop,
  };
}

/** Um `MatchState` na abertura da mão 10 — trunfo por escolher, treze cartas na mão, vaza vazia. */
function abrindoAUltimaMao(): MatchState {
  const m = createMatch(JOGADORES, 42);
  m.handNumber = TOTAL_HANDS - 1;
  startNextHand(m);
  return m;
}

/**
 * A mesma abertura, numa mão que NÃO é a décima — e positiva, como a décima.
 *
 * Positiva de propósito: é o que faz a comparação ser justa. Uma mão negativa abriria sem escolha
 * de trunfo, e "não há painel de trunfo" deixaria de significar "o anúncio o está segurando" para
 * significar "esta mão não tem trunfo". A mão 7 é positiva, como a 10, e a única diferença entre
 * as duas nestes testes é o anúncio.
 */
const MAO_POSITIVA_SEM_ANUNCIO = 7;
function abrindoUmaMaoQualquer(): MatchState {
  const m = createMatch(JOGADORES, 42);
  m.handNumber = MAO_POSITIVA_SEM_ANUNCIO - 1;
  startNextHand(m);
  return m;
}

function local(m: MatchState): KingGame {
  const g = new KingGame(JOGADORES, 42, 0, m.handNumber, "sapo");
  return g;
}

function remota(m: MatchState): PartidaRemota {
  const u: AtualizacaoDeEstado = {
    matchId: "m1", stateVersion: 9, view: redactFor(m, 0), cause: "HAND_ADVANCED",
  };
  return new PartidaRemota(u, 0, noop);
}

function desenhar(game: KingGame | PartidaRemota, mp?: MesaMultiplayer): HTMLElement {
  return parse(renderToStaticMarkup(
    <Mesa
      game={game} reviewing={false} shake={0} castigo={null}
      onPlay={noop} onChooseTrump={noop} onAdvance={noop} onHome={noop} onRestart={noop}
      onOpenAudio={noop} mp={mp}
    />,
  ));
}

/** Tudo o que é da mão 10 e não pode dividir a tela com o anúncio. */
function oQueEstaNaMesa(root: HTMLElement) {
  return {
    anuncio: root.querySelectorAll(".um").length,
    cartasNoLeque: root.querySelectorAll(".hand .card").length,
    cartasNaVaza: root.querySelectorAll(".trick .card").length,
    cartasJogaveis: root.querySelectorAll(".hand .card.legal").length,
    painelDeTrunfo: root.querySelectorAll(".trumpov").length,
    botoesDeTrunfo: root.querySelectorAll(".trumpbtn").length,
    avisoDeEscolha: root.querySelectorAll(".pickmsg").length,
    slotDeTrunfo: root.querySelectorAll(".trumpslot").length,
    relogio: root.querySelectorAll(".mprelogio").length,
  };
}

const MODOS = [
  ["solo", (m: MatchState) => desenhar(local(m))],
  ["multiplayer", (m: MatchState) => desenhar(remota(m), contexto())],
] as const;

describe.each(MODOS)("com o anúncio na tela (%s)", (_modo, montar) => {
  const naMesa = () => oQueEstaNaMesa(montar(abrindoAUltimaMao()));

  it("o anúncio está lá — é a premissa de todo o resto", () => {
    expect(naMesa().anuncio).toBe(1);
  });

  it("nenhuma carta da mão 10 foi distribuída", () => {
    expect(naMesa().cartasNoLeque, "as treze cartas apareceram por baixo do véu").toBe(0);
  });

  it("nenhuma carta na vaza — a mão não começou a ser jogada", () => {
    expect(naMesa().cartasNaVaza).toBe(0);
  });

  it("nenhuma carta é jogável: não existe vez do humano durante o anúncio", () => {
    expect(naMesa().cartasJogaveis).toBe(0);
  });

  it("nenhum controle de trunfo aparece — nem o painel, nem os cinco botões", () => {
    const m = naMesa();
    expect(m.painelDeTrunfo, "o painel de escolha do trunfo dividiu a tela com o anúncio").toBe(0);
    expect(m.botoesDeTrunfo).toBe(0);
  });

  it('nem o aviso de que outro está escolhendo — era ele que ficava no centro do selo', () => {
    expect(naMesa().avisoDeEscolha).toBe(0);
  });

  it("nem o card de trunfo já resolvido", () => {
    expect(naMesa().slotDeTrunfo).toBe(0);
  });
});

describe.each(MODOS)("depois que o anúncio sai (%s)", (_modo, montar) => {
  /**
   * O anúncio some por tempo ou por toque, e nos dois casos o efeito é o mesmo: a mão 10 passa a
   * ser apresentada. Aqui a saída é simulada pela mão que ela deixa de cobrir — uma mão que não é
   * a décima é indistinguível, para a Mesa, de uma décima já dispensada: nos dois casos
   * `anunciandoUltimaMao` é falso, e é essa condição, e só ela, que governa as retenções.
   */
  const depois = () => oQueEstaNaMesa(montar(abrindoUmaMaoQualquer()));

  it("o anúncio não está mais na tela", () => {
    expect(depois().anuncio).toBe(0);
  });

  it("as cartas entram: o leque volta a ser desenhado", () => {
    expect(depois().cartasNoLeque, "o leque não voltou depois do anúncio").toBeGreaterThan(0);
  });

  it("e a mão volta a ser interativa — o trunfo é pedido a quem tem de escolher", () => {
    const d = depois();
    expect(d.painelDeTrunfo + d.avisoDeEscolha,
      "nem o painel nem o aviso apareceram: a mão ficou sem começar").toBeGreaterThan(0);
  });
});

/**
 * O RELÓGIO, QUE SÓ EXISTE NO MULTIPLAYER.
 *
 * Um cronômetro correndo sobre uma tela que não aceita jogada só diz "você está perdendo tempo".
 * E não é só aparência: quem conta o prazo é o servidor, e é ele que dá o respiro da abertura
 * (`aberturaDaUltimaMao` em `apps/server/src/match/tempos.ts`) — sem o respiro, esconder o relógio
 * seria esconder a perda em vez de evitá-la.
 */
describe("o relógio da decisão e o anúncio", () => {
  it("não conta na cara de quem está vendo o anúncio", () => {
    const r = desenhar(remota(abrindoAUltimaMao()), contexto());
    expect(oQueEstaNaMesa(r).relogio).toBe(0);
  });

  it("mas volta assim que a mão é apresentada", () => {
    const r = desenhar(remota(abrindoUmaMaoQualquer()), contexto());
    expect(oQueEstaNaMesa(r).relogio,
      "o relógio sumiu de vez em vez de só esperar o anúncio").toBeGreaterThan(0);
  });
});

/**
 * A SUSPENSÃO DO ANDAMENTO — esconder não bastaria.
 *
 * Se a Mesa apenas deixasse de desenhar, o motor local continuaria dando o passo dos bots e o
 * multiplayer continuaria consumindo a fila do servidor: a mão andaria invisível e reapareceria
 * adiantada, que é a mesma perda de informação com outra roupa. Por isso a Mesa avisa a camada
 * de apresentação, e é ela que congela o andamento — a mesma que já congela a mesa para ler a
 * vaza que fechou.
 */
describe("a Mesa avisa que a partida deve parar", () => {
  it("suspende enquanto anuncia, e libera quando o anúncio sai", () => {
    const vistos: boolean[] = [];
    renderToStaticMarkup(
      <Mesa
        game={local(abrindoAUltimaMao())} reviewing={false} shake={0} castigo={null}
        onPlay={noop} onChooseTrump={noop} onAdvance={noop} onHome={noop} onRestart={noop}
        onOpenAudio={noop} suspender={(v) => vistos.push(v)}
      />,
    );
    // `renderToStaticMarkup` não roda efeitos, então o que se afirma aqui é o CONTRATO: a Mesa
    // aceita o canal e não o chama durante o render. Quem prova o efeito é o e2e, medindo a mesa
    // parada — um teste de render que fingisse rodar efeitos provaria o mock, não o produto.
    expect(vistos, "a suspensão foi chamada durante o render, e não no efeito").toEqual([]);
  });

  it("o canal é opcional: o tutorial monta a Mesa sem ele e não pode quebrar", () => {
    expect(() => desenhar(local(abrindoUmaMaoQualquer()))).not.toThrow();
  });
});

/**
 * OS DOIS PONTOS DE CHAMADA PRECISAM LIGAR O CANAL — e um teste de render não vê isso.
 *
 * ══ COMO ISTO PASSOU ══
 *
 * A prop `suspender` é opcional, porque o tutorial monta a Mesa sem ela. A rodada adicionou a
 * prop, adicionou o `suspender` ao retorno dos dois hooks — e esqueceu de LIGAR os dois nos
 * pontos de chamada. Nenhum teste caiu: os de render afirmam o que é desenhado, e a Mesa desenhava
 * certo. O motor é que continuava andando atrás do véu, invisível, que é exatamente o defeito com
 * outra roupa.
 *
 * Quem acusou foi a geometria: a coluna esquerda descia 24px durante o anúncio, porque o trunfo
 * era escolhido por trás dele. Um defeito de arquitetura encontrado por um teste de pixel é sorte,
 * e sorte não é cobertura.
 *
 * A tripwire de fonte é o guarda mais barato que ainda é honesto para "esta prop chegou ao lugar
 * certo". `App.tsx` é o modo local e `ModoOnline.tsx` é o multiplayer: são os dois únicos lugares
 * onde uma partida de verdade monta a Mesa. O tutorial fica de fora de propósito — ele encena uma
 * partida e nunca chega à mão 10.
 */
describe("a suspensão chega à Mesa nos dois modos", () => {
  const fonte = (arquivo: string) =>
    readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it.each([
    ["App.tsx", "modo local"],
    ["ModoOnline.tsx", "multiplayer"],
  ])("%s (%s) passa `suspender` para a Mesa", (arquivo) => {
    expect(fonte(arquivo)).toContain("suspender={g.suspender}");
  });

  it("e os dois hooks oferecem o canal — não adianta ligar num fio que não existe", () => {
    for (const h of ["../game/useKingGame.ts", "../game/useKingOnline.ts"]) {
      const codigo = readFileSync(new URL(h, import.meta.url), "utf8");
      expect(codigo, `${h} não devolve \`suspender\``).toContain("suspender,");
    }
  });

  it("o andamento consulta a pausa, e não só a leitura da vaza", () => {
    // `emLeitura()` congela a mesa para ler a vaza que fechou; `emPausa()` inclui o anúncio. Se
    // algum dos dois laços voltar a consultar só o primeiro, a mão anda por trás da animação.
    for (const h of ["../game/useKingGame.ts", "../game/useKingOnline.ts"]) {
      const codigo = readFileSync(new URL(h, import.meta.url), "utf8");
      expect(codigo, `${h} voltou a consultar só a leitura da vaza`).toContain("if (emPausa())");
    }
  });
});
