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

function sala(over: Partial<EstadoDaSalaLido> = {}, assentos: Partial<{ assisted: boolean; connected: boolean; ready: boolean }>[] = []): EstadoDaSalaLido {
  return {
    protocolVersion: 1, roomCode: "ABCDE", roomId: "ABCDE", status: "playing",
    seats: SEATS.map((s) => ({
      seat: s, playerId: "p" + s, nick: JOGADORES[s],
      connected: true, ready: false, assisted: false, ...(assentos[s] ?? {}),
    })),
    ...over,
  };
}

function contexto(eu: Seat, over: Partial<MesaMultiplayer> = {}): MesaMultiplayer {
  return {
    eu, sala: sala(), conexao: "conectado", relogio: null, prontos: [],
    recusa: null, emVoo: null, aguardando: false, pediProximaMao: false, ...over,
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

/** Toda carta desenhada na tela, pelo `aria-label` do CardView. */
function cartasDesenhadas(root: HTMLElement): string[] {
  return root.querySelectorAll("[aria-label]")
    .map((n) => n.getAttribute("aria-label") ?? "")
    .filter((t) => / de /.test(t))
    .map((t) => { const [rank, suit] = t.split(" de "); return cardId({ rank, suit } as never); });
}

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
    const relogio = { tipo: "PLAY" as const, seat: 0 as Seat, fase: "WARNING" as const, restanteMs: 8000, recebidoEm: Date.now() };
    const root = render(remota(m, 0), contexto(0, { relogio }));
    const chip = root.querySelector(".mprelogio")!;
    expect(chip.getAttribute("class")).toContain("warning");
    expect(chip.getAttribute("class")).toContain("meu");
    expect(chip.text).toMatch(/^[78]s$/);
  });

  it("o relógio de READY não vira chip: quem trata disso é o Placar", () => {
    const m = partidaEmCurso();
    const relogio = { tipo: "READY" as const, seat: null, fase: "NORMAL" as const, restanteMs: 20000, recebidoEm: Date.now() };
    expect(render(remota(m, 0), contexto(0, { relogio })).querySelectorAll(".mprelogio")).toHaveLength(0);
  });

  it("a queda de conexão é anunciada com o código da sala à mão", () => {
    const m = partidaEmCurso();
    const root = render(remota(m, 0), contexto(0, { conexao: "reconectando" }));
    const faixa = root.querySelector(".mpconexao")!;
    expect(faixa.text).toContain("Reconectando");
    expect(faixa.text).toContain("ABCDE");
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
