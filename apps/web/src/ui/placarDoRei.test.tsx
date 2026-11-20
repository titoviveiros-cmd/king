/**
 * O PLACAR DA MÃO DO REI, renderizado: no SOLO o "Próxima mão" nasce segurado só na mão 5; no
 * ONLINE o voto "Estou pronto" continua livre (quem segura é o servidor). Partidas reais do motor,
 * `renderToStaticMarkup` em Node puro — o mesmo molde de `kCopasCaptura.test.tsx`.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import {
  createMatch, startNextHand, selectTrump, playCard, legalCardsFor, chooseNormalTrump, buildBotView,
  type MatchState, type Seat,
} from "@king/engine";
import { LeituraDaPartida } from "../game/leituraDaPartida.js";
import { Placar } from "./Placar.js";
import type { MesaMultiplayer } from "./MesaOnline.js";
import type { EstadoDaSalaLido } from "../net/clienteKing.js";

const noop = () => {};
const JOGADORES = ["Você", "Bia", "Léo", "Nara"];
const SEATS: Seat[] = [0, 1, 2, 3];

function fimDaMao(alvo: number): MatchState {
  const m = createMatch(JOGADORES, 42);
  for (let guarda = 0; guarda < 20_000; guarda++) {
    const h = m.hand;
    if (h && h.handNumber === alvo && h.handScores !== null) return m;
    if (h === null || h.handScores !== null) { startNextHand(m); continue; }
    if (h.awaitingTrumpFrom !== null) {
      selectTrump(m, h.awaitingTrumpFrom, chooseNormalTrump(buildBotView(m, h.awaitingTrumpFrom).hand));
      continue;
    }
    playCard(m, h.turn!, legalCardsFor(m, h.turn!)[0]);
  }
  throw new Error("não chegou à mão " + alvo);
}

function sala(): EstadoDaSalaLido {
  return {
    protocolVersion: 1, roomCode: "0315", roomId: "0315", status: "playing",
    seats: SEATS.map((s) => ({
      seat: s, playerId: "p" + s, nick: JOGADORES[s],
      connected: true, ready: false, assisted: false, bot: false, host: s === 0, avatar: "leao",
    })),
  };
}
const mp = (): MesaMultiplayer => ({
  eu: 0, sala: sala(), conexao: "conectado", relogio: null, prontos: [],
  recusa: null, emVoo: null, aguardando: false, pediProximaMao: false,
  mensagens: {}, onEnviarMensagem: noop, onCancelarProximaMao: noop,
});

const botaoDe = (mao: number, multi?: MesaMultiplayer) => {
  const html = parse(renderToStaticMarkup(
    <Placar game={new LeituraDaPartida(fimDaMao(mao), 0)} onAdvance={noop} onHome={noop} onRestart={noop} mp={multi} />,
  ));
  return html.querySelector(".pl-actions button")!;
};

describe("Placar da mão do Rei", () => {
  it("solo, mão 5: 'Próxima mão' nasce desabilitado, com a MESMA classe (sem mudar geometria)", () => {
    const b = botaoDe(5);
    expect(b.text).toContain("Próxima mão");
    expect(b.hasAttribute("disabled")).toBe(true);
    expect(b.getAttribute("class")).toBe("btn gold");
  });

  it("solo, as outras mãos: o botão nasce livre, como sempre", () => {
    for (const mao of [1, 4, 6, 9]) {
      const b = botaoDe(mao);
      expect(b.hasAttribute("disabled"), `mão ${mao}`).toBe(false);
      expect(b.getAttribute("style"), `mão ${mao}`).toBeFalsy();
    }
  });

  it("online, mão 5: o voto 'Estou pronto' continua livre — o servidor é quem segura", () => {
    const b = botaoDe(5, mp());
    expect(b.text).toMatch(/Estou pronto/i);
    expect(b.hasAttribute("disabled")).toBe(false);
  });
});
