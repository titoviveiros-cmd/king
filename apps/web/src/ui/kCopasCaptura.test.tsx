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
import { marcarCenaDoReiVista } from "./ReiCapturado.js";
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
        expect(root.querySelectorAll(".rc"), "receber o K♥ não é cena").toHaveLength(0);
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

  it("em cada um dos 4 aparelhos: PRIMEIRO a cena, DEPOIS a mesa — o K♥ e o VENCEDOR real", () => {
    const { m, vencedor } = cenario(5);
    for (const eu of SEATS) {
      const g = remota(m, eu);
      const a = anunciarVaza(g, 700 + eu)!;
      expect(a.castigo?.king).toBe(true);
      expect(a.castigo?.seat).toBe(vencedor);
      expect(a.castigo!.pontos).toBe(-160);

      // ── FASE 1 · a cena "O REI FOI CAPTURADO!", sozinha: nada da mesa anima junto ──
      const cena = render(g, a.castigo, true, contexto(eu));
      expect(cena.querySelectorAll(".rc")).toHaveLength(1);
      expect(cena.querySelector(".rc-titulo")?.text).toBe("O REI FOI CAPTURADO!");
      expect(cena.querySelector(".rc-nome")?.text).toBe(
        vencedor === eu ? "Você pegou o K♥" : `${JOGADORES[vencedor]} pegou o K♥`,
      );
      expect(cena.querySelector(".rc-pontos")?.text).toBe(String(a.castigo!.pontos));
      expect(cena.querySelectorAll(".kcaptura")).toHaveLength(0);
      expect(cena.querySelectorAll(".kpenalizado")).toHaveLength(0);
      expect(cena.querySelectorAll(".castigo")).toHaveLength(0);
      // a vaza continua lá embaixo, pública, como estava
      expect(cena.querySelectorAll(".trick .card").some((n) => n.getAttribute("aria-label") === "K de hearts")).toBe(true);

      // ── FASE 2 · a cena saiu (tempo ou toque): a mesa assume, e a cena não volta ──
      marcarCenaDoReiVista(a.castigo!.nonce);
      const root = render(g, a.castigo, true, contexto(eu));
      expect(root.querySelectorAll(".rc")).toHaveLength(0);

      // o K♥ revelado na vaza, e só ele
      const destacadas = root.querySelectorAll(".kcaptura.card");
      expect(destacadas).toHaveLength(1);
      expect(destacadas[0].getAttribute("aria-label")).toBe("K de hearts");
      expect(root.querySelectorAll(".trick .card.kcaptura")).toHaveLength(1);
      expect(root.querySelectorAll(".trick.kcaptura")).toHaveLength(1);
      expect(root.querySelectorAll(".hand .kcaptura")).toHaveLength(0);
      // a onda de impacto nasce no slot do K♥, visto desta cadeira
      const slotDoK = (destacadas[0].parentNode as HTMLElement).classList.value.find((c) => ["b", "l", "t", "r"].includes(c));
      expect(slotDoK).toBeTruthy();
      expect(root.querySelector(".trick.kcaptura")!.classList.contains(`k-${slotDoK}`)).toBe(true);
      expect(root.querySelectorAll(".trick[class*=\" k-\"]")).toHaveLength(1);

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
    }
  });

  it("a cena aparece UMA vez por captura: re-renderizar não a traz de volta; outra captura, sim", () => {
    const { m } = cenario(5);
    const g = remota(m, 0);
    const a = anunciarVaza(g, 801)!;
    expect(render(g, a.castigo, true, contexto(0)).querySelectorAll(".rc")).toHaveLength(1);
    marcarCenaDoReiVista(801);
    for (let i = 0; i < 3; i++) expect(render(g, a.castigo, true, contexto(0)).querySelectorAll(".rc")).toHaveLength(0);
    // a marca é desta captura, não "do K♥ em geral": outra partida, outro nonce, outra cena
    expect(render(g, anunciarVaza(g, 802)!.castigo, true, contexto(0)).querySelectorAll(".rc")).toHaveLength(1);
  });

  it("quando OUTRO jogador captura, o humano não é marcado — nem na cena, nem na mesa", () => {
    const { m, vencedor } = cenario(5, (v) => v !== 0);
    const g = remota(m, 0);
    const a = anunciarVaza(g, 811)!;
    const cena = render(g, a.castigo, true, contexto(0));
    expect(cena.querySelector(".rc-nome")?.text).toBe(`${JOGADORES[vencedor]} pegou o K♥`);
    marcarCenaDoReiVista(811);
    const root = render(g, a.castigo, true, contexto(0));
    expect(root.querySelectorAll(".youtag.kpenalizado")).toHaveLength(0);
    expect(root.querySelector(".opp.kpenalizado .n")?.text).toContain(JOGADORES[vencedor]);
    expect(root.querySelector(".castigo")?.text).toContain(`${JOGADORES[vencedor]} pegou`);
  });

  it("só o vencedor confirmado pelo motor: um selo que não bate com a vaza revelada não acende nada", () => {
    const { m, vencedor } = cenario(5);
    const g = remota(m, 0);
    const a = anunciarVaza(g, 821)!;
    const outro = ((vencedor + 1) % 4) as Seat;
    const root = render(g, { ...a.castigo!, seat: outro }, true, contexto(0));
    expect(root.querySelectorAll(".rc")).toHaveLength(0);
    expect(root.querySelectorAll(".kcaptura")).toHaveLength(0);
    expect(root.querySelectorAll('.trick[class*=" k-"]')).toHaveLength(0);
    expect(root.querySelectorAll(".kpenalizado")).toHaveLength(0);
  });

  it("no recolhimento (fim da pausa) cena, destaque e selo saem — não repete", () => {
    const { m } = cenario(5);
    const g = remota(m, 0);
    const root = render(g, anunciarVaza(g, 831)!.castigo, false, contexto(0));
    expect(root.querySelectorAll(".rc")).toHaveLength(0);
    expect(root.querySelectorAll(".kcaptura")).toHaveLength(0);
    expect(root.querySelectorAll('.trick[class*=" k-"]')).toHaveLength(0);
    expect(root.querySelectorAll(".kpenalizado")).toHaveLength(0);
    expect(root.querySelectorAll(".castigo")).toHaveLength(0);
  });

  it("modo local: a mesma cena e o mesmo destaque, com a mesma regra", () => {
    // Uma KingGame só com bots jogando também pelo humano, até o K♥ cair numa vaza.
    for (let seed = 1; seed < 200; seed++) {
      const g = new KingGame(JOGADORES, seed, 0, 5);
      for (let i = 0; i < 60 && g.phase() === "play"; i++) {
        if (g.isHumanTurn()) g.playHuman(g.legalCards()[0]); else g.stepBotPlay();
        if (g.currentTrick().length !== 0) continue;
        const ultima = g.lastCompletedTrick()!;
        if (!ultima.cards.some((pc) => isKingOfHearts(pc.card))) continue;
        const a = anunciarVaza(g, 841)!;
        const cena = render(g, a.castigo, true);
        expect(cena.querySelectorAll(".rc")).toHaveLength(1);
        expect(cena.querySelectorAll(".kcaptura")).toHaveLength(0);
        marcarCenaDoReiVista(841);
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
  it("nenhuma carta oculta aparece por causa da cena nem do destaque, em nenhum aparelho", () => {
    const { m } = cenario(5);
    for (const eu of SEATS) {
      const g = remota(m, eu);
      const a = anunciarVaza(g, 900 + eu)!;
      const permitidas = new Set([
        ...m.hand!.hands[eu].map(cardId),
        ...m.hand!.currentTrick.map((pc) => cardId(pc.card)),
        ...m.hand!.completedTricks.flatMap((t) => t.cards.map((pc) => cardId(pc.card))),
      ]);
      const fases = [render(g, a.castigo, true, contexto(eu))];
      marcarCenaDoReiVista(900 + eu);
      fases.push(render(g, a.castigo, true, contexto(eu)));
      expect(fases[0].querySelectorAll(".rc")).toHaveLength(1);
      for (const root of fases) {
        for (const c of cartasDesenhadas(root)) expect(permitidas.has(c), `carta ${c} vista pelo assento ${eu}`).toBe(true);
      }
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
    expect(root.querySelectorAll(".rc")).toHaveLength(0);
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
  // Cada item de toda lista `animation:` do CSS (a regra pode quebrar linha; a vírgula de dentro de
  // um cubic-bezier(...) não separa itens). Ler linha a linha deixava passar um `infinite`.
  const usosDaAnimacao = (nome: string) =>
    [...css.matchAll(/animation:([^;}]+)/g)]
      .flatMap((m) => m[1].split(/,(?![^(]*\))/))
      .map((s) => s.trim())
      .filter((s) => s.startsWith(`${nome} `));

  it("o impacto é controlado: só translate/scale/sombra, tremor HORIZONTAL, e termina em repouso", () => {
    const k = keyframes("kCaptura");
    // nada de transform (apagaria a rotação do slot) nem de geometria de layout
    expect(k).not.toMatch(/transform|rotate|top:|left:|bottom:|width|height/);
    // microescala: perceptível, mas sem engolir a vaza
    const escalas = [...k.matchAll(/scale:([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...escalas)).toBeGreaterThan(1.05);
    expect(Math.max(...escalas)).toBeLessThanOrEqual(1.2);
    // o tremor é só no eixo X: o segundo valor de todo translate é 0 (nunca sobe para o selo)
    const desloc = [...k.matchAll(/translate:([^;]+);/g)].map((m) => m[1].trim());
    expect(desloc.length).toBeGreaterThan(2);
    for (const d of desloc) expect(d, d).toMatch(/ 0$/);
    // dissipação: volta à identidade
    const fim = k.slice(k.lastIndexOf("100%{"));
    expect(fim).toMatch(/scale:1;translate:0 0;/);
    // o resto da cena não se move nem muda de tamanho
    for (const nome of ["kHalo", "kPenalizado", "kSelo", "kSeloValor", "kCapturaCalmo"]) {
      expect(keyframes(nome), nome).not.toMatch(/transform|translate|scale|rotate|top:|left:|width|height/);
    }
    // a onda só cresce e some (opacidade + escala), atrás das cartas
    expect(keyframes("kOnda")).toMatch(/0%\{opacity:\.95;scale:\.3;\}100%\{opacity:0;scale:2\.1;\}/);
    expect(css).toMatch(/\.trick\.kcaptura::after\{content:"";position:absolute;z-index:-1;pointer-events:none;/);
  });

  it("três tempos dentro da pausa: 1,1 a 1,5 s, uma vez só, depois da cena e dentro da pausa do King", () => {
    for (const nome of ["kCaptura", "kHalo", "kOnda", "kPenalizado", "kSelo", "kSeloValor", "kCapturaCalmo"]) {
      const usos = usosDaAnimacao(nome);
      expect(usos.length, `${nome} não é usada`).toBeGreaterThan(0);
      for (const u of usos) expect(u, `${nome} repete`).not.toMatch(/infinite/);
    }
    for (const nome of ["kCaptura", "kHalo", "kPenalizado", "kSelo", "kSeloValor"]) {
      expect(css, nome).toMatch(new RegExp(`${nome} 1\\.35s`));
    }
    expect(TEMPOS.kCopasCaptura).toBe(1350);
    expect(TEMPOS.kCopasCaptura).toBeGreaterThanOrEqual(1100);
    expect(TEMPOS.kCopasCaptura).toBeLessThanOrEqual(1500);
    expect(TEMPOS.kCopasCaptura).toBeLessThan(TEMPOS.leituraDaVazaKing);
    // a cena vem ANTES e dura ~5s (era 2s); somadas, cabem na pausa do King, que cresceu junto
    // (3400 → 6500). O contrato completo — folga, servidor, motor — está em `cinematica.test.ts`.
    expect(TEMPOS.cenaDoRei).toBeGreaterThanOrEqual(4500);
    expect(TEMPOS.cenaDoRei).toBeLessThanOrEqual(5500);
    expect(TEMPOS.cenaDoRei + TEMPOS.kCopasCaptura).toBeLessThanOrEqual(TEMPOS.leituraDaVazaKing);
    expect(TEMPOS.leituraDaVazaKing).toBe(6500);
  });

  it("o selo do K♥ mantém as animações de sempre do castigo e ganha só o clarão vinho", () => {
    const base = css.match(/\.castigo\{[^}]*animation:([^;]+);/)![1];
    const doK = css.match(/\.castigo\.king\{animation:([^;]+);\}/)![1];
    expect(doK.replace(/\n\s*/g, "")).toBe(`${base},kSelo 1.35s ease-out both`);
  });

  it("halo e onda ficam ATRÁS das cartas e não capturam toque", () => {
    expect(css).toMatch(/\.trick\.kcaptura::before\{[^}]*z-index:-1;[^}]*pointer-events:none/);
    expect(css).toMatch(/\.trick\.kcaptura::after\{[^}]*z-index:-1;[^}]*pointer-events:none/);
  });

  it("com movimento reduzido: sem pulsar, sem onda, sem salto — a informação fica", () => {
    const bloco = css.slice(css.indexOf("@media (prefers-reduced-motion:reduce){\n  .hand.distribuindo"));
    const media = bloco.slice(0, bloco.indexOf("\n}\n"));
    expect(media).toMatch(/\.trick \.slot \.card\.kcaptura\{animation:kCapturaCalmo 1\.35s/);
    expect(media).toMatch(/\.trick\.kcaptura::after\{animation:none;display:none;\}/);
    // o selo do K perde a entrada e o pulso (que movem); fica só o clarão
    expect(media).toMatch(/\.castigo\.king\{animation:kSelo 1\.35s ease-out both;\}/);
    expect(media).toMatch(/\.kpenalizado\{animation:kPenalizado 1\.35s/);
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

describe("a cena O REI FOI CAPTURADO é só apresentação", () => {
  const css = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const fonte = readFileSync(fileURLToPath(new URL("./ReiCapturado.tsx", import.meta.url)), "utf8");
  const bloco = css.slice(css.indexOf("/* ══════════════════ O REI FOI CAPTURADO"), css.indexOf("/* ══════════════════ A ÚLTIMA VAZA"));

  it("não toca som, não vibra, não suspende a mesa e não fala com o servidor", () => {
    const codigo = fonte.replace(/\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/audio|sfx|vibr|haptic|suspender|enviar|send\(|fetch\(/i);
    // sai sozinha no tempo da cena (retomando de onde parou se a Mesa remontar); o toque só
    // encurta, e não atravessa para a Mesa
    expect(codigo).toMatch(/const PERMANENCIA_MS = TEMPOS\.cenaDoRei - SAIDA_MS;/);
    expect(codigo).toMatch(/const restante = permanenciaRestante\(inicios\.get\(nonce\)!, Date\.now\(\)\);/);
    expect(codigo).toMatch(/window\.setTimeout\(\(\) => encerrar\.current\(\), restante\)/);
    expect(codigo).toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); encerrar\.current\(\); \}\}/);
  });

  it("cobre a mesa no andar da Última Mão, abaixo do clarão do tremor, e não repete", () => {
    expect(bloco.length).toBeGreaterThan(500);
    expect(bloco).toMatch(/\.rc\{position:fixed;inset:0;z-index:28;/);
    expect([...bloco.matchAll(/@keyframes (rc\w+)\{/g)].length).toBeGreaterThan(5);
    expect(bloco).not.toMatch(/infinite/);
  });

  it("movimento reduzido: sem faíscas e sem movimento, mesma informação", () => {
    expect(bloco).toMatch(/\.rc\.calmo \.rc-faiscas\{display:none;\}/);
    expect(bloco).toMatch(/\.rc\.calmo \.rc-coroa,\.rc\.calmo \.rc-carta,\.rc\.calmo \.rc-titulo,\.rc\.calmo \.rc-quem\{animation:rcVeu \.3s ease-out both;\}/);
    const media = bloco.slice(bloco.indexOf("@media (prefers-reduced-motion:reduce){"));
    expect(media).toMatch(/\.rc-faiscas\{display:none;\}/);
    expect(media).toMatch(/\.rc-coroa,\.rc-carta,\.rc-titulo,\.rc-quem\{animation:rcVeu \.3s ease-out both;\}/);
  });
});
