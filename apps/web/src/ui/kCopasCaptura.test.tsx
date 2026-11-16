/**
 * K DE COPAS CAPTURADO — o efeito especial da mão 5 acompanha a CAPTURA, nunca o recebimento.
 *
 * O azar do "Não pegar o Rei de Copas" é levar a vaza que contém o K♥ (−160). Receber a carta na
 * distribuição não custa nada. Por isso o destaque é amarrado ao selo do castigo, que já é
 * decidido pelo motor (`anunciarVaza` → `castigo.king`, `castigo.seat` = vencedor da vaza).
 *
 * Tudo aqui roda partidas REAIS do motor, com bots jogando, e renderiza a Mesa de verdade
 * (`renderToStaticMarkup`, Node puro), nos dois modos: local e multiplayer.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, type HTMLElement } from "node-html-parser";
import {
  createMatch, startNextHand, playCard, redactFor, cardId, chooseNormalCard, buildBotView, isKingOfHearts,
  type MatchState, type Seat,
} from "@king/engine";
import { KingGame } from "../game/kingGame.js";
import { PartidaRemota } from "../game/partidaRemota.js";
import { anunciarVaza, type Castigo } from "../game/anuncio.js";
import { TEMPOS } from "../game/timings.js";
import { Mesa, type MesaMultiplayer } from "./Mesa.js";
import type { EstadoDaSalaLido } from "../net/clienteKing.js";

const noop = () => {};
const JOGADORES = ["Você", "Bia", "Léo", "Nara"];
const SEATS: Seat[] = [0, 1, 2, 3];

function sala(): EstadoDaSalaLido {
  return {
    protocolVersion: 1, roomCode: "0315", roomId: "0315", status: "playing",
    seats: SEATS.map((s) => ({
      seat: s, playerId: "p" + s, nick: JOGADORES[s],
      connected: true, ready: false, assisted: false, bot: false, host: s === 0, avatar: "leao",
    })),
  };
}

function contexto(eu: Seat): MesaMultiplayer {
  return {
    eu, sala: sala(), conexao: "conectado", relogio: null, prontos: [],
    recusa: null, emVoo: null, aguardando: false, pediProximaMao: false,
    mensagens: {}, onEnviarMensagem: noop, onCancelarProximaMao: noop,
  };
}

function remota(m: MatchState, eu: Seat): PartidaRemota {
  return new PartidaRemota({ matchId: "m1", stateVersion: 9, view: redactFor(m, eu), cause: "CARD_PLAYED" }, eu, noop);
}

function render(game: KingGame | PartidaRemota, castigo: Castigo | null, reviewing: boolean, mp?: MesaMultiplayer): HTMLElement {
  return parse(renderToStaticMarkup(
    <Mesa
      game={game} reviewing={reviewing} shake={0} castigo={castigo}
      onPlay={noop} onChooseTrump={noop} onAdvance={noop} onHome={noop} onRestart={noop} onOpenAudio={noop}
      mp={mp}
    />,
  ));
}

const ETIQUETA_DE_CARTA = /^(?:[2-9]|10|[JQKA]) de (hearts|diamonds|clubs|spades)$/;
function cartasDesenhadas(root: HTMLElement): string[] {
  return root.querySelectorAll("[aria-label]")
    .map((n) => n.getAttribute("aria-label") ?? "")
    .filter((t) => ETIQUETA_DE_CARTA.test(t))
    .map((t) => { const [rank, suit] = t.split(" de "); return cardId({ rank, suit } as never); });
}

/** A mão `mao` montada pelo motor (mesma técnica do `?mao=` do modo local). */
function naMao(seed: number, mao: number): MatchState {
  const m = createMatch(JOGADORES, seed);
  m.handNumber = mao - 1;
  startNextHand(m);
  return m;
}

/**
 * Joga com os bots até a vaza que contém o K♥ fechar. Devolve a partida parada nesse instante
 * (a mesa em leitura) e quantos anúncios de King apareceram no caminho — tem de ser exatamente 1.
 */
function ateCapturarOK(seed: number, mao: number): { m: MatchState; anunciosDeKing: number; vencedor: Seat } | null {
  const m = naMao(seed, mao);
  let anunciosDeKing = 0;
  for (let i = 0; i < 60; i++) {
    const h = m.hand!;
    if (h.handScores !== null || h.turn === null) return null;
    const s = h.turn;
    playCard(m, s, chooseNormalCard(buildBotView(m, s)));
    if (m.hand!.currentTrick.length !== 0) continue;
    // uma vaza fechou: o anúncio que a Mesa faria agora
    const a = anunciarVaza(remota(m, 0), 1);
    if (a?.castigo?.king) anunciosDeKing++;
    const ultima = m.hand!.completedTricks.at(-1)!;
    if (ultima.cards.some((pc) => isKingOfHearts(pc.card))) return { m, anunciosDeKing, vencedor: ultima.winner };
  }
  return null;
}

/** A primeira semente em que o K♥ é capturado na mão `mao`. */
function cenario(mao: number, aceitar: (vencedor: Seat) => boolean = () => true) {
  for (let seed = 1; seed < 400; seed++) {
    const r = ateCapturarOK(seed, mao);
    if (r && aceitar(r.vencedor)) return { seed, ...r };
  }
  throw new Error(`nenhuma semente capturou o K♥ na mão ${mao}`);
}

describe("receber o K♥ NÃO é castigo", () => {
  it("na mão 5, com o K♥ na mão do jogador e nenhuma vaza fechada: nenhum destaque", () => {
    let provados = 0;
    for (let seed = 1; seed < 60 && provados < 3; seed++) {
      const g = new KingGame(JOGADORES, seed, 0, 5);
      if (!g.view().yourHand.some(isKingOfHearts)) continue;
      expect(g.contract()?.kind).toBe("no-king");
      for (const reviewing of [false, true]) {
        const root = render(g, null, reviewing);
        expect(root.querySelectorAll(".kcaptura"), `semente ${seed}`).toHaveLength(0);
        expect(root.querySelectorAll(".kpenalizado"), `semente ${seed}`).toHaveLength(0);
        expect(root.querySelectorAll(".castigo")).toHaveLength(0);
        // o K♥ continua no leque, normal: carta como as outras
        const k = root.querySelectorAll(".hand .card").find((n) => n.getAttribute("aria-label") === "K de hearts");
        expect(k?.getAttribute("class")).not.toMatch(/kcaptura|kalerta/);
      }
      provados++;
    }
    expect(provados, "nenhuma semente deu o K♥ ao humano na mão 5").toBeGreaterThan(0);
  });
});

describe("capturar o K♥ dispara o destaque — uma vez, no penalizado certo", () => {
  it("o motor anuncia o King exatamente uma vez na mão, na vaza que levou o K♥", () => {
    const { anunciosDeKing } = cenario(5);
    expect(anunciosDeKing).toBe(1);
  });

  it("em cada um dos 4 aparelhos: o K♥ da vaza e o card do VENCEDOR real, nada mais", () => {
    const { m, vencedor } = cenario(5);
    for (const eu of SEATS) {
      const g = remota(m, eu);
      const a = anunciarVaza(g, 7)!;
      expect(a.castigo?.king).toBe(true);
      expect(a.castigo?.seat).toBe(vencedor);
      const root = render(g, a.castigo, true, contexto(eu));

      // o K♥ revelado na vaza, e só ele
      const destacadas = root.querySelectorAll(".kcaptura.card");
      expect(destacadas).toHaveLength(1);
      expect(destacadas[0].getAttribute("aria-label")).toBe("K de hearts");
      expect(root.querySelectorAll(".trick .card.kcaptura")).toHaveLength(1);
      expect(root.querySelectorAll(".trick.kcaptura")).toHaveLength(1);
      expect(root.querySelectorAll(".hand .kcaptura")).toHaveLength(0);

      // o penalizado é quem venceu a vaza, visto da cadeira de cada um
      const marcados = root.querySelectorAll(".kpenalizado");
      expect(marcados).toHaveLength(1);
      if (vencedor === eu) {
        expect(marcados[0].getAttribute("class")).toContain("youtag");
      } else {
        expect(marcados[0].getAttribute("class")).toContain("opp");
        expect(marcados[0].querySelector(".n")?.text).toContain(JOGADORES[vencedor]);
      }

      // o selo e os −160 são os do motor, intactos
      const selo = root.querySelector(".castigo.king")!;
      expect(selo).toBeTruthy();
      expect(selo.querySelector(".quanto")?.text).toBe(String(a.castigo!.pontos));
      expect(a.castigo!.pontos).toBe(-160);
    }
  });

  it("quando OUTRO jogador captura, o humano não é marcado", () => {
    const { m, vencedor } = cenario(5, (v) => v !== 0);
    const g = remota(m, 0);
    const root = render(g, anunciarVaza(g, 1)!.castigo, true, contexto(0));
    expect(root.querySelectorAll(".youtag.kpenalizado")).toHaveLength(0);
    expect(root.querySelector(".opp.kpenalizado .n")?.text).toContain(JOGADORES[vencedor]);
    expect(root.querySelector(".castigo")?.text).toContain(`${JOGADORES[vencedor]} pegou`);
  });

  it("no recolhimento (fim da pausa) o destaque sai junto com o selo — não repete", () => {
    const { m } = cenario(5);
    const g = remota(m, 0);
    const root = render(g, anunciarVaza(g, 1)!.castigo, false, contexto(0));
    expect(root.querySelectorAll(".kcaptura")).toHaveLength(0);
    expect(root.querySelectorAll(".kpenalizado")).toHaveLength(0);
    expect(root.querySelectorAll(".castigo")).toHaveLength(0);
  });

  it("modo local: o mesmo destaque, com a mesma regra", () => {
    // Uma KingGame só com bots jogando também pelo humano, até o K♥ cair numa vaza.
    for (let seed = 1; seed < 200; seed++) {
      const g = new KingGame(JOGADORES, seed, 0, 5);
      for (let i = 0; i < 60 && g.phase() === "play"; i++) {
        if (g.isHumanTurn()) g.playHuman(g.legalCards()[0]); else g.stepBotPlay();
        if (g.currentTrick().length !== 0) continue;
        const ultima = g.lastCompletedTrick()!;
        if (!ultima.cards.some((pc) => isKingOfHearts(pc.card))) continue;
        const a = anunciarVaza(g, 1)!;
        const root = render(g, a.castigo, true);
        expect(root.querySelectorAll(".trick .card.kcaptura")).toHaveLength(1);
        expect(root.querySelectorAll(".kpenalizado")).toHaveLength(1);
        return;
      }
    }
    throw new Error("nenhuma semente local capturou o K♥ na mão 5");
  });
});

describe("sigilo e outros contratos", () => {
  it("nenhuma carta oculta aparece por causa do destaque, em nenhum aparelho", () => {
    const { m } = cenario(5);
    for (const eu of SEATS) {
      const g = remota(m, eu);
      const desenhadas = cartasDesenhadas(render(g, anunciarVaza(g, 1)!.castigo, true, contexto(eu)));
      const permitidas = new Set([
        ...m.hand!.hands[eu].map(cardId),
        ...m.hand!.currentTrick.map((pc) => cardId(pc.card)),
        ...m.hand!.completedTricks.flatMap((t) => t.cards.map((pc) => cardId(pc.card))),
      ]);
      for (const c of desenhadas) expect(permitidas.has(c), `carta ${c} vista pelo assento ${eu}`).toBe(true);
    }
  });

  it("o K♥ capturado em OUTRO contrato (mão 2, Copas) não ganha o efeito do King", () => {
    const { m } = cenario(2);
    const g = remota(m, 0);
    const a = anunciarVaza(g, 1)!;
    expect(g.contract()?.kind).not.toBe("no-king");
    expect(a.castigo?.king).toBe(false);
    const root = render(g, a.castigo, true, contexto(0));
    expect(root.querySelectorAll(".trick .card").some((n) => n.getAttribute("aria-label") === "K de hearts")).toBe(true);
    expect(root.querySelectorAll(".kcaptura")).toHaveLength(0);
    expect(root.querySelectorAll(".kpenalizado")).toHaveLength(0);
  });
});

describe("o CSS do destaque é só pintura", () => {
  const css = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const keyframes = (nome: string) => {
    const i = css.indexOf(`@keyframes ${nome}{`);
    expect(i, `@keyframes ${nome}`).toBeGreaterThan(-1);
    let n = 0, j = i;
    for (; j < css.length; j++) { if (css[j] === "{") n++; else if (css[j] === "}" && --n === 0) break; }
    return css.slice(i, j + 1);
  };
  const regras = (sel: string) => css.split("\n").filter((l) => l.includes(sel)).join("\n");

  it("nada se move: sem transform, translate, scale ou rotate nas animações do King", () => {
    for (const k of ["kCaptura", "kHalo", "kPenalizado", "kCapturaCalmo"]) {
      expect(keyframes(k), k).not.toMatch(/transform|translate|scale|rotate|top|left|width|height/);
    }
  });

  it("toca uma vez: nenhuma animação do King é infinita, e dura o que TEMPOS diz", () => {
    for (const sel of [".kcaptura", ".kpenalizado"]) expect(regras(sel)).not.toMatch(/infinite/);
    expect(css).toMatch(/kCaptura 1\.1s/);
    expect(TEMPOS.kCopasCaptura).toBe(1100);
    expect(TEMPOS.kCopasCaptura).toBeGreaterThanOrEqual(600);
    expect(TEMPOS.kCopasCaptura).toBeLessThanOrEqual(1200);
    // e cabe dentro da pausa em que o selo está na tela
    expect(TEMPOS.kCopasCaptura).toBeLessThan(TEMPOS.leituraDaVazaKing);
  });

  it("o halo fica ATRÁS das cartas e não captura toque", () => {
    expect(css).toMatch(/\.trick\.kcaptura::before\{[^}]*z-index:-1;[^}]*pointer-events:none/);
  });

  it("com movimento reduzido a aura não pulsa", () => {
    const bloco = css.slice(css.indexOf("@media (prefers-reduced-motion:reduce){\n  .hand.distribuindo"));
    expect(bloco).toMatch(/\.trick \.slot \.card\.kcaptura\{animation:kCapturaCalmo/);
  });
});

describe("aparência-base do K♥: igual à das demais cartas", () => {
  const css = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  // Todo seletor do CSS (as regras dentro de @media também: o `[^{}]+` recomeça após cada `{`).
  const seletores = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((m) => m[1].split(",").map((s) => s.trim()))
    .filter((s) => !s.startsWith("@") && !/^\d|^from$|^to$/.test(s));
  const classes = (html: string) => new Set(parse(html).querySelector(".card")!.classList.value);
  const kCopas = { rank: "K", suit: "hearts" } as const;
  const damaCopas = { rank: "Q", suit: "hearts" } as const;

  it("nenhuma regra de CSS pinta o K♥ fora da captura (sem borda nem aura douradas permanentes)", () => {
    // `.castigo.king` é o selo do castigo (outro componente), não a carta.
    const daCarta = seletores.filter((s) => /\.king\b/.test(s) && !/\.castigo\.king/.test(s));
    expect(daCarta).toEqual([]);
    // o único destaque exclusivo dele é a aura vinho da captura, só na vaza
    const exclusivos = seletores.filter((s) => /kcaptura/.test(s) && /\.card/.test(s));
    expect(exclusivos.length).toBeGreaterThan(0);
    for (const s of exclusivos) expect(s, s).toMatch(/^\.trick \.slot \.card\.kcaptura$/);
  });

  it("na mão, legal, ilegal e selecionado: o K♥ recebe os MESMOS estados de qualquer carta", async () => {
    const { CardView } = await import("./CardView.js");
    for (const props of [{ state: "legal" as const }, { state: "illegal" as const }, { state: "legal" as const, selected: true }, {}]) {
      const k = classes(renderToStaticMarkup(<CardView card={kCopas as never} {...props} />));
      const q = classes(renderToStaticMarkup(<CardView card={damaCopas as never} {...props} />));
      // a única diferença é o marcador `king`, que nenhuma regra de CSS da carta usa (teste acima)
      expect([...k].filter((c) => !q.has(c))).toEqual(["king"]);
      expect([...q].filter((c) => !k.has(c))).toEqual([]);
      expect(k.has("kcaptura")).toBe(false);
    }
    // capturado só vale para o K♥: outra carta "capturada" não ganha nada
    expect(classes(renderToStaticMarkup(<CardView card={kCopas as never} capturado />)).has("kcaptura")).toBe(true);
    expect(classes(renderToStaticMarkup(<CardView card={damaCopas as never} capturado />)).has("kcaptura")).toBe(false);
  });
});
