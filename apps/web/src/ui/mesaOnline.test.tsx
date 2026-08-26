/**
 * A MESA NOS DOIS MODOS — renderizada de verdade, com o mesmo método já usado em `mesaScore`
 * (`renderToStaticMarkup`, Node puro, sem jsdom).
 *
 * As três garantias que este arquivo existe para travar:
 *
 *   1. NÃO-REGRESSÃO — no modo local/bots a Mesa renderiza exatamente como antes da Fase 8:
 *      mesmos slots, sem nenhum elemento novo na tela.
 *   2. ROTAÇÃO — no multiplayer você continua embaixo mesmo sendo o assento 2, e os adversários
 *      aparecem na ordem de jogo (esquerda, topo, direita).
 *   3. SIGILO NO PIXEL — o HTML que chega ao browser não contém NENHUMA carta de adversário.
 *      Este é o teste que importa: não basta o payload ser limpo, o que é desenhado também tem
 *      de ser. Cada carta traz `aria-label="rank de suit"`, então dá para varrer o HTML inteiro.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, type HTMLElement } from "node-html-parser";
import {
  createMatch, startNextHand, playCard, redactFor, cardId, chooseNormalCard, buildBotView,
  type MatchState, type Seat,
} from "@king/engine";
import { KingGame } from "../game/kingGame.js";
import { PartidaRemota } from "../game/partidaRemota.js";
import { Mesa, type MesaMultiplayer } from "./Mesa.js";
import type { AtualizacaoDeEstado, Causa } from "../net/protocolo.js";
import type { EstadoDaSalaLido } from "../net/clienteKing.js";
import { AVATAR_PADRAO, desenhoDoAvatar } from "./avatares.js";
import { fraseDe } from "./social.js";

const noop = () => {};
const JOGADORES = ["Você", "Bia", "Léo", "Nara"];
const SEATS: Seat[] = [0, 1, 2, 3];

function render(game: KingGame | PartidaRemota, mp?: MesaMultiplayer, reviewing = false): HTMLElement {
  return parse(renderToStaticMarkup(
    <Mesa
      game={game} reviewing={reviewing} shake={0} castigo={null}
      onPlay={noop} onChooseTrump={noop} onAdvance={noop} onHome={noop} onRestart={noop} onOpenAudio={noop}
      mp={mp}
    />,
  ));
}

/** Os avatares do fixture: um por assento, para ninguém passar por engano num teste de igualdade. */
const AVATARES_DA_MESA = ["leao", "sapo", "coruja", "capivara"];

type AssentoDoFixture = Partial<{
  assisted: boolean; connected: boolean; ready: boolean; bot: boolean; host: boolean; avatar: string;
}>;

function sala(over: Partial<EstadoDaSalaLido> = {}, assentos: AssentoDoFixture[] = []): EstadoDaSalaLido {
  return {
    protocolVersion: 1, roomCode: "0315", roomId: "0315", status: "playing",
    seats: SEATS.map((s) => ({
      seat: s, playerId: "p" + s, nick: JOGADORES[s],
      connected: true, ready: false, assisted: false, bot: false, host: s === 0,
      avatar: AVATARES_DA_MESA[s], ...(assentos[s] ?? {}),
    })),
    ...over,
  };
}

function contexto(eu: Seat, over: Partial<MesaMultiplayer> = {}): MesaMultiplayer {
  return {
    eu, sala: sala(), conexao: "conectado", relogio: null, prontos: [],
    recusa: null, emVoo: null, aguardando: false, pediProximaMao: false,
    mensagens: {}, onEnviarMensagem: noop, ...over,
  };
}

function partidaEmCurso(seed = 23, jogadas = 2): MatchState {
  const m = createMatch(JOGADORES, seed);
  startNextHand(m);
  for (let i = 0; i < jogadas; i++) {
    const s = m.hand!.turn!;
    playCard(m, s, chooseNormalCard(buildBotView(m, s)));
  }
  return m;
}

function remota(m: MatchState, eu: Seat, cause: Causa = "CARD_PLAYED"): PartidaRemota {
  const u: AtualizacaoDeEstado = { matchId: "m1", stateVersion: 9, view: redactFor(m, eu), cause };
  return new PartidaRemota(u, eu, noop);
}

/**
 * Toda carta desenhada na tela, pelo `aria-label` do CardView (`"K de hearts"`).
 *
 * O padrão casa com o FORMATO EXATO da etiqueta de carta, e não com qualquer texto que contenha
 * " de ". A versão larga era um coador furado ao contrário: quando os cards de jogador viraram
 * botões, "Ver o perfil de Bia" passou a ser lido como uma carta chamada "Ver o perfil" de naipe
 * "Bia". Nenhuma carta escapa desta versão, porque `CardView` é o único lugar que desenha carta e
 * ele sempre escreve `rank de <naipe>`.
 */
const ETIQUETA_DE_CARTA = /^(?:[2-9]|10|[JQKA]) de (hearts|diamonds|clubs|spades)$/;

function cartasDesenhadas(root: HTMLElement): string[] {
  return root.querySelectorAll("[aria-label]")
    .map((n) => n.getAttribute("aria-label") ?? "")
    .filter((t) => ETIQUETA_DE_CARTA.test(t))
    .map((t) => { const [rank, suit] = t.split(" de "); return cardId({ rank, suit } as never); });
}

/**
 * O MESMO relógio que o componente usa.
 *
 * Não é detalhe de teste: `ChipDoRelogio` conta com uma régua MONOTÔNICA, e carimbar a chegada
 * com `Date.now()` aqui misturaria duas escalas (hora do mundo e tempo desde o carregamento da
 * página). O resultado seria um "restante" de milhões de segundos, que foi exatamente o que estes
 * testes passaram a mostrar quando a régua mudou. As duas pontas leem a mesma fonte.
 */
const agoraMonotonico = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const nomeEm = (root: HTMLElement, sel: string) => root.querySelector(sel)?.text?.trim() ?? "";

// ═══════════════════════ 1. O MODO LOCAL NÃO MUDOU ═══════════════════════

describe("modo local/bots — nenhuma regressão visual", () => {
  it("mantém os slots históricos: você embaixo, adversários 1/2/3 à esquerda/topo/direita", () => {
    const g = new KingGame(JOGADORES, 42);
    const root = render(g);
    expect(nomeEm(root, ".youtag .n")).toBe("Você");
    expect(nomeEm(root, ".opp.left .n")).toBe("Bia");
    expect(nomeEm(root, ".opp.top .n")).toBe("Léo");
    expect(nomeEm(root, ".opp.right .n")).toBe("Nara");
  });

  it("sem `mp` nenhum elemento de multiplayer é montado", () => {
    const root = render(new KingGame(JOGADORES, 42));
    for (const sel of [".assist", ".mprelogio", ".mpconexao", ".mprecusa", ".pl-consenso", ".opp.ausente"]) {
      expect(root.querySelectorAll(sel), `não deveria existir ${sel} no modo local`).toHaveLength(0);
    }
  });

  it("continua mostrando as 13 cartas do humano e nenhuma dos bots", () => {
    const g = new KingGame(JOGADORES, 42);
    const desenhadas = cartasDesenhadas(render(g));
    const minhas = new Set(g.view().yourHand.map(cardId));
    expect(desenhadas.filter((c) => minhas.has(c))).toHaveLength(13);
    expect(desenhadas.every((c) => minhas.has(c))).toBe(true);
  });
});

// ═══════════════════════ 2. ROTAÇÃO NO MULTIPLAYER ═══════════════════════

describe("multiplayer — a mesa gira em torno de quem está jogando", () => {
  it("o assento 2 se vê embaixo, com 3, 0 e 1 à esquerda, topo e direita", () => {
    const m = partidaEmCurso();
    const root = render(remota(m, 2), contexto(2));
    expect(nomeEm(root, ".youtag .n")).toBe("Léo");     // assento 2 = você
    expect(nomeEm(root, ".opp.left .n")).toBe("Nara");  // 3
    expect(nomeEm(root, ".opp.top .n")).toBe("Você");   // 0
    expect(nomeEm(root, ".opp.right .n")).toBe("Bia");  // 1
  });

  it("qualquer que seja o assento, você está embaixo e os outros três aparecem uma vez cada", () => {
    const m = partidaEmCurso();
    for (const eu of SEATS) {
      const root = render(remota(m, eu), contexto(eu));
      expect(nomeEm(root, ".youtag .n")).toContain(JOGADORES[eu]);
      const adversarios = root.querySelectorAll(".opp .n").map((n) => n.text.replace("Assistência", "").trim());
      expect(adversarios).toHaveLength(3);
      expect(new Set(adversarios).size).toBe(3);
      expect(adversarios).not.toContain(JOGADORES[eu]);
    }
  });

  it("as cartas da vaza vão para o slot certo na perspectiva de cada um", () => {
    const m = partidaEmCurso(23, 2); // duas cartas na mesa
    const naMesa = m.hand!.currentTrick;
    expect(naMesa.length).toBeGreaterThan(0);

    for (const eu of SEATS) {
      const root = render(remota(m, eu), contexto(eu));
      for (const pc of naMesa) {
        const esperado = ["b", "l", "t", "r"][(pc.seat - eu + 4) % 4];
        const slot = root.querySelectorAll(`.trick .slot.${esperado} [aria-label]`);
        expect(slot.length, `assento ${pc.seat} visto por ${eu} devia estar no slot ${esperado}`).toBe(1);
      }
    }
  });
});

// ═══════════════════════ 3. SIGILO NO PIXEL ═══════════════════════

describe("nenhuma carta de adversário chega ao HTML", () => {
  it("o que é desenhado é só a própria mão mais as cartas públicas da vaza", () => {
    const m = partidaEmCurso(23, 2);
    for (const eu of SEATS) {
      const desenhadas = cartasDesenhadas(render(remota(m, eu), contexto(eu)));
      const permitidas = new Set([
        ...m.hand!.hands[eu].map(cardId),
        ...m.hand!.currentTrick.map((pc) => cardId(pc.card)),
        ...m.hand!.completedTricks.flatMap((t) => t.cards.map((pc) => cardId(pc.card))),
      ]);
      for (const c of desenhadas) {
        expect(permitidas.has(c), `carta ${c} desenhada para o assento ${eu} sem ser dele nem pública`).toBe(true);
      }
      // e o adversário não tem como ver a mão de ninguém: as dele aparecem, as dos outros não
      const deOutro = SEATS.filter((s) => s !== eu).flatMap((s) => m.hand!.hands[s].map(cardId));
      const publicas = new Set(m.hand!.currentTrick.map((pc) => cardId(pc.card)));
      for (const c of deOutro) {
        if (!publicas.has(c)) expect(desenhadas).not.toContain(c);
      }
    }
  });
});

// ═══════════════════════ 4. O CROMO NOVO ═══════════════════════

describe("indicações que só existem no multiplayer", () => {
  it("assistência aparece no assento que o servidor está jogando, e em nenhum outro", () => {
    const m = partidaEmCurso();
    const assentos = [{}, {}, {}, { assisted: true, connected: false }];
    const root = render(remota(m, 0), contexto(0, { sala: sala({}, assentos) }));
    const selos = root.querySelectorAll(".assist");
    expect(selos).toHaveLength(1);
    expect(selos[0].text).toContain("Assistência");
    // o assento ausente também fica esmaecido, sem sumir da mesa
    expect(root.querySelectorAll(".opp.ausente")).toHaveLength(1);
    expect(nomeEm(root, ".opp.ausente .n")).toContain("Nara");
  });

  it("o relógio da decisão vem do servidor e mostra os segundos restantes", () => {
    const m = partidaEmCurso();
    const relogio = { tipo: "PLAY" as const, seat: 0 as Seat, fase: "NORMAL" as const, restanteMs: 22_000, recebidoEm: agoraMonotonico() };
    const root = render(remota(m, 0), contexto(0, { relogio }));
    const chip = root.querySelector(".mprelogio")!;
    expect(chip.getAttribute("class")).toContain("normal");
    expect(chip.getAttribute("class")).toContain("meu");
    expect(chip.text).toMatch(/^2[12]s$/);
    // acima de 10s nao existe alerta nenhum
    expect(chip.text).not.toContain("acabando");
  });

  it("aos 10 segundos entra o ESTADO CRITICO — cor, TEXTO e aria, nao so cor", () => {
    const m = partidaEmCurso();
    const relogio = { tipo: "PLAY" as const, seat: 0 as Seat, fase: "WARNING" as const, restanteMs: 8000, recebidoEm: agoraMonotonico() };
    const root = render(remota(m, 0), contexto(0, { relogio }));
    const chip = root.querySelector(".mprelogio")!;

    expect(chip.getAttribute("class")).toContain("critico");
    expect(chip.getAttribute("class")).toContain("meu");
    expect(chip.text).toMatch(/^[78]s/);
    // ACESSIBILIDADE: o aviso nao pode depender so da cor
    expect(chip.text).toContain("Seu tempo está acabando");
    expect(chip.getAttribute("aria-live")).toBe("assertive");
  });

  it("no turno DOS OUTROS o relogio fica critico, mas sem texto dirigido a mim", () => {
    const m = partidaEmCurso();
    const relogio = { tipo: "PLAY" as const, seat: 2 as Seat, fase: "CRITICAL" as const, restanteMs: 6000, recebidoEm: agoraMonotonico() };
    const root = render(remota(m, 0), contexto(0, { relogio }));
    const chip = root.querySelector(".mprelogio")!;
    expect(chip.getAttribute("class")).toContain("critico");
    expect(chip.getAttribute("class")).not.toContain("meu");
    expect(chip.text).not.toContain("acabando");
    expect(chip.getAttribute("aria-live")).toBe("off");
  });

  it("prazo esgotado some da tela — quem age por estouro e o servidor", () => {
    const m = partidaEmCurso();
    const relogio = { tipo: "PLAY" as const, seat: 0 as Seat, fase: "CRITICAL" as const, restanteMs: 0, recebidoEm: agoraMonotonico() };
    expect(render(remota(m, 0), contexto(0, { relogio })).querySelectorAll(".mprelogio")).toHaveLength(0);
  });

  it("o relógio de READY não vira chip: quem trata disso é o Placar", () => {
    const m = partidaEmCurso();
    const relogio = { tipo: "READY" as const, seat: null, fase: "NORMAL" as const, restanteMs: 20000, recebidoEm: agoraMonotonico() };
    expect(render(remota(m, 0), contexto(0, { relogio })).querySelectorAll(".mprelogio")).toHaveLength(0);
  });

  it("a queda de conexão é anunciada com o código da sala à mão", () => {
    const m = partidaEmCurso();
    const root = render(remota(m, 0), contexto(0, { conexao: "reconectando" }));
    const faixa = root.querySelector(".mpconexao")!;
    expect(faixa.text).toContain("Reconectando");
    expect(faixa.text).toContain("0315");
  });

  it("em jogo normal a faixa de conexão não ocupa nada", () => {
    const m = partidaEmCurso();
    expect(render(remota(m, 0), contexto(0)).querySelectorAll(".mpconexao")).toHaveLength(0);
  });

  it("a recusa do servidor é explicada, e a carta continua no leque", () => {
    const m = partidaEmCurso();
    const p = remota(m, 0);
    const antes = cartasDesenhadas(render(p, contexto(0))).length;
    const root = render(p, contexto(0, { recusa: { mensagem: "Não é sua vez", nonce: 1 } }));
    expect(root.querySelector(".mprecusa")!.text).toBe("Não é sua vez");
    expect(cartasDesenhadas(root)).toHaveLength(antes);
  });
});

// ═══════════════════════ 5. O PLACAR VIRA CONSENSO ═══════════════════════

describe("Placar entre-mãos no multiplayer", () => {
  function maoTerminada() {
    const m = createMatch(JOGADORES, 13);
    startNextHand(m);
    for (let g = 0; g < 3000; g++) {
      const h = m.hand!;
      if (h.handScores !== null) break;
      const s = h.turn!;
      playCard(m, s, chooseNormalCard(buildBotView(m, s)));
    }
    expect(m.hand!.handScores).not.toBeNull();
    return m;
  }

  it("o Placar continua sendo Placar — resultado, ranking e próximo contrato intactos", () => {
    const m = maoTerminada();
    const root = render(remota(m, 0), contexto(0));
    expect(root.querySelectorAll(".pl-row")).toHaveLength(4);
    expect(root.querySelector(".pl-next")).toBeTruthy();
    expect(root.querySelector(".pl-legend")).toBeTruthy();
  });

  it("antes de votar, o botão continua sendo 'Próxima mão'", () => {
    const m = maoTerminada();
    const root = render(remota(m, 0), contexto(0, { prontos: [] }));
    expect(root.querySelector(".pl-consenso")).toBeTruthy();
    expect(root.querySelector(".pl-consenso .btn")!.text).toContain("Próxima mão");
    expect(root.querySelectorAll(".pl-pronto.ok")).toHaveLength(0);
  });

  it("depois de votar, diz que confirmou e por quem está esperando", () => {
    const m = maoTerminada();
    const root = render(remota(m, 0), contexto(0, { prontos: [0, 1, 2], pediProximaMao: true }));
    const aviso = root.querySelector(".pl-aguardando")!;
    expect(aviso.text).toContain("Pronto");
    expect(aviso.text).toContain("Nara"); // o único que falta
    expect(root.querySelectorAll(".pl-consenso .btn")).toHaveLength(0);
    // e o estado visual dos quatro participantes
    expect(root.querySelectorAll(".pl-pronto")).toHaveLength(4);
    expect(root.querySelectorAll(".pl-pronto.ok")).toHaveLength(3);
  });

  it("no modo local o Placar mantém o botão de sempre", () => {
    const g = new KingGame(JOGADORES, 13);
    for (let i = 0; i < 3000 && g.phase() !== "handEnd"; i++) {
      if (g.isHumanTurn()) g.playHuman(g.legalCards()[0]);
      else if (g.needsBotPlay()) g.stepBotPlay();
      else if (g.needsBotTrump()) g.stepBotTrump();
      else break;
    }
    const root = render(g);
    expect(root.querySelectorAll(".pl-consenso")).toHaveLength(0);
    expect(root.querySelector(".pl-actions .btn")!.text).toContain("Próxima mão");
  });
});

// ═══════════════════ 6 · IDENTIDADE DE COR POR ASSENTO ═══════════════════

describe("a cor pertence ao jogador, não ao lugar na tela", () => {
  /** A classe de identidade que o avatar de cada assento carrega, na visão de `eu`. */
  function corPorAssento(m: MatchState, eu: Seat): Record<number, string> {
    const root = render(remota(m, eu), contexto(eu));
    const mapa: Record<number, string> = {};
    // o card local
    const meu = root.querySelector(".youtag .av")?.getAttribute("class") ?? "";
    mapa[eu] = (meu.match(/\bs([0-3])\b/) ?? [])[1] ?? "?";
    // e os três adversários
    for (const pos of ["left", "top", "right"]) {
      const el = root.querySelector(`.opp.${pos} .av`);
      const cls = el?.getAttribute("class") ?? "";
      const s = (cls.match(/\bs([0-3])\b/) ?? [])[1];
      const nome = root.querySelector(`.opp.${pos} .n`)?.text.trim() ?? "";
      const assento = JOGADORES.findIndex((j) => nome.startsWith(j));
      if (s !== undefined && assento >= 0) mapa[assento] = s;
    }
    return mapa;
  }

  it("cada assento carrega a SUA classe de identidade, qualquer que seja o observador", () => {
    const m = partidaEmCurso();
    for (const eu of SEATS) {
      const mapa = corPorAssento(m, eu);
      for (const s of SEATS) {
        expect(mapa[s], `assento ${s} visto por ${eu}`).toBe(String(s));
      }
    }
  });

  it("dois clientes diferentes veem o MESMO assento com a MESMA cor", () => {
    const m = partidaEmCurso();
    const porTito = corPorAssento(m, 0);
    const porLeo = corPorAssento(m, 2);
    for (const s of SEATS) {
      expect(porLeo[s], `assento ${s}`).toBe(porTito[s]);
    }
  });

  it("a POSIÇÃO na tela muda entre clientes, a identidade não", () => {
    const m = partidaEmCurso();
    const doTito = render(remota(m, 0), contexto(0));
    const doLeo = render(remota(m, 2), contexto(2));

    // o assento 2 está no TOPO para o Tito e EMBAIXO (é ele) para o Léo — posições diferentes
    expect(nomeEm(doTito, ".opp.top .n")).toBe("Léo");
    expect(nomeEm(doLeo, ".youtag .n")).toBe("Léo");

    // ...e mesmo assim a classe de identidade é a mesma nos dois
    expect(doTito.querySelector(".opp.top .av")?.getAttribute("class")).toContain("s2");
    expect(doLeo.querySelector(".youtag .av")?.getAttribute("class")).toContain("s2");
  });

  it("o Placar usa a mesma identidade da Mesa", () => {
    const m = createMatch(JOGADORES, 13);
    startNextHand(m);
    for (let g = 0; g < 3000; g++) {
      const h = m.hand!;
      if (h.handScores !== null) break;
      const s = h.turn!;
      playCard(m, s, chooseNormalCard(buildBotView(m, s)));
    }
    for (const eu of SEATS) {
      const root = render(remota(m, eu), contexto(eu));
      for (const linha of root.querySelectorAll(".pl-row")) {
        const cls = linha.querySelector(".pl-av")?.getAttribute("class") ?? "";
        expect(cls).toMatch(/\bs[0-3]\b/);
      }
      // a linha do proprio jogador tem a classe do assento dele
      const minha = root.querySelectorAll(".pl-row").find((r) => r.getAttribute("class")?.includes("you"));
      expect(minha?.querySelector(".pl-av")?.getAttribute("class"), `assento ${eu}`).toContain(`s${eu}`);
    }
  });
});

// ═══════════════════ AVATAR ═══════════════════
//
// A cor vem do assento; o DESENHO vem do avatar que o servidor guardou. As duas coisas juntas
// são a identidade — e identidade que muda de aparelho para aparelho não é identidade.

describe("o avatar desenhado é o do estado autoritativo", () => {
  /** O glifo desenhado para cada assento, na visão de `eu`. */
  function glifoPorAssento(m: MatchState, eu: Seat): Record<number, string> {
    const root = render(remota(m, eu), contexto(eu));
    const mapa: Record<number, string> = {};
    mapa[eu] = root.querySelector(".youtag .av")?.text.trim() ?? "";
    for (const pos of ["left", "top", "right"]) {
      const nome = root.querySelector(`.opp.${pos} .n`)?.text.trim() ?? "";
      const assento = JOGADORES.findIndex((j) => nome.startsWith(j));
      if (assento >= 0) mapa[assento] = root.querySelector(`.opp.${pos} .av`)?.text.trim() ?? "";
    }
    return mapa;
  }

  it("cada assento aparece com o desenho do SEU avatar", () => {
    const esperado = AVATARES_DA_MESA.map((a) => desenhoDoAvatar(a).glifo);
    const mapa = glifoPorAssento(partidaEmCurso(), 0);
    for (const s of SEATS) expect(mapa[s], `assento ${s}`).toBe(esperado[s]);
  });

  it("dois clientes diferentes desenham o MESMO avatar no mesmo assento", () => {
    const m = partidaEmCurso();
    const porTito = glifoPorAssento(m, 0);
    const porLeo = glifoPorAssento(m, 2);
    for (const s of SEATS) expect(porLeo[s], `assento ${s}`).toBe(porTito[s]);
  });

  it("a rotação da tela não mexe no avatar: quem gira é a posição", () => {
    const m = partidaEmCurso();
    const doTito = render(remota(m, 0), contexto(0));
    const doLeo = render(remota(m, 2), contexto(2));
    const glifoDoLeo = desenhoDoAvatar(AVATARES_DA_MESA[2]).glifo;
    expect(doTito.querySelector(".opp.top .av")?.text.trim()).toBe(glifoDoLeo);
    expect(doLeo.querySelector(".youtag .av")?.text.trim()).toBe(glifoDoLeo);
  });

  it("o avatar vem acompanhado do NOME legível — não é só um símbolo", () => {
    const root = render(remota(partidaEmCurso(), 0), contexto(0));
    expect(root.querySelector(".youtag .av")?.getAttribute("aria-label"))
      .toBe(desenhoDoAvatar(AVATARES_DA_MESA[0]).rotulo);
  });

  it("avatar desconhecido não quebra a tela: cai no padrão", () => {
    const m = partidaEmCurso();
    const mp = contexto(0, { sala: sala({}, [{ avatar: "nao-existe" }]) });
    const root = render(remota(m, 0), mp);
    expect(root.querySelector(".youtag .av")?.text.trim()).toBe(desenhoDoAvatar(AVATAR_PADRAO).glifo);
  });

  it("SEM multiplayer nada muda: o jogo local continua com a inicial do nome", () => {
    const root = render(new KingGame(JOGADORES, 23));
    expect(root.querySelector(".youtag .av")?.text.trim()).toBe(JOGADORES[0][0]);
  });

  it("o assento de BOT é declarado como bot na mesa", () => {
    const m = partidaEmCurso();
    const mp = contexto(0, { sala: sala({}, [{}, { bot: true }]) });
    const root = render(remota(m, 0), mp);
    const comBot = root.querySelectorAll(".opp .n").find((n) => n.text.includes(JOGADORES[1]));
    expect(comBot?.querySelector(".robo")).not.toBeNull();
    // e os humanos continuam sem selo nenhum
    const humano = root.querySelectorAll(".opp .n").find((n) => n.text.includes(JOGADORES[2]));
    expect(humano?.querySelector(".robo")).toBeNull();
  });
});

// ═══════════════════ SOCIAL NA MESA ═══════════════════

describe("mensagens sociais aparecem onde importa: no jogador que falou", () => {
  const comMensagem = (m: Partial<Record<Seat, { id: string; nonce: number }>>) =>
    contexto(0, { mensagens: m });

  it("o balão sai do card de QUEM falou, não de um painel central", () => {
    const root = render(remota(partidaEmCurso(), 0), comMensagem({ 2: { id: "doeu", nonce: 1 } }));
    const dono = root.querySelectorAll(".opp").find((o) => o.querySelector(".balao"));
    expect(dono, "algum adversário tem o balão").toBeTruthy();
    expect(dono!.querySelector(".n")?.text).toContain(JOGADORES[2]);
    expect(dono!.querySelector(".balao")?.text.trim()).toBe(desenhoDaFrase("doeu"));
    // e ninguém mais fala junto
    expect(root.querySelectorAll(".balao")).toHaveLength(1);
  });

  it("a minha própria mensagem aparece no meu card", () => {
    const root = render(remota(partidaEmCurso(), 0), comMensagem({ 0: { id: "boa", nonce: 1 } }));
    expect(root.querySelector(".youtag .balao")?.text.trim()).toBe(desenhoDaFrase("boa"));
  });

  it("dois falando ao mesmo tempo: dois balões, cada um no seu dono", () => {
    const root = render(
      remota(partidaEmCurso(), 0),
      comMensagem({ 0: { id: "boa", nonce: 1 }, 1: { id: "quase", nonce: 2 } }),
    );
    expect(root.querySelectorAll(".balao")).toHaveLength(2);
    expect(root.querySelector(".youtag .balao")?.text.trim()).toBe(desenhoDaFrase("boa"));
  });

  it("etiqueta desconhecida não desenha balão nenhum", () => {
    const root = render(remota(partidaEmCurso(), 0), comMensagem({ 0: { id: "nao-existe", nonce: 1 } }));
    expect(root.querySelectorAll(".balao")).toHaveLength(0);
  });

  it("o balão é anunciado por leitor de tela — quem não olha para o card fica sabendo", () => {
    const root = render(remota(partidaEmCurso(), 0), comMensagem({ 0: { id: "boa", nonce: 1 } }));
    expect(root.querySelector(".balao")?.getAttribute("role")).toBe("status");
  });

  it("sem ninguém falando, a mesa não ganha um pixel a mais", () => {
    expect(render(remota(partidaEmCurso(), 0), contexto(0)).querySelectorAll(".balao")).toHaveLength(0);
  });
});

describe("o botão de falar", () => {
  it("existe no multiplayer e NÃO existe no jogo local", () => {
    expect(render(remota(partidaEmCurso(), 0), contexto(0)).querySelectorAll(".soc")).toHaveLength(1);
    expect(render(new KingGame(JOGADORES, 23)).querySelectorAll(".soc")).toHaveLength(0);
  });

  it("começa fechado: o painel não rouba espaço de quem está decidindo", () => {
    const root = render(remota(partidaEmCurso(), 0), contexto(0));
    expect(root.querySelectorAll(".socpanel")).toHaveLength(0);
    expect(root.querySelector(".soc")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("tem rótulo legível", () => {
    const root = render(remota(partidaEmCurso(), 0), contexto(0));
    expect(root.querySelector(".soc")?.getAttribute("aria-label")).toBe("Mensagens rápidas");
  });
});

/** O texto que a frase deve desenhar. Vem da MESMA tabela que a Mesa usa. */
function desenhoDaFrase(id: string): string {
  return fraseDe(id)!.texto;
}

describe("o painel é modal, e assume que é", () => {
  it("fechado, não existe véu nenhum sobre a mesa", () => {
    expect(render(remota(partidaEmCurso(), 0), contexto(0)).querySelectorAll(".socscrim")).toHaveLength(0);
  });

  it("o que fica permanente na tela nunca é o painel: só o botão", () => {
    const root = render(remota(partidaEmCurso(), 0), contexto(0));
    expect(root.querySelectorAll(".soc")).toHaveLength(1);
    expect(root.querySelectorAll(".socpanel")).toHaveLength(0);
    expect(root.querySelectorAll(".socscrim")).toHaveLength(0);
  });
});
