/**
 * O LOBBY renderizado de verdade (`renderToStaticMarkup`, Node puro, sem jsdom).
 *
 * O que trava aqui: o avatar aparece no lobby, é o do estado sincronizado, é o MESMO desenho
 * que a Mesa usa depois — e o bot, agora que tem nome de gente, continua declarado como bot.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, type HTMLElement } from "node-html-parser";
import type { Seat } from "@king/engine";
import { Sala } from "./Sala.js";
import { desenhoDoAvatar } from "./avatares.js";
import type { AssentoLido, EstadoDaSalaLido } from "../net/clienteKing.js";

const noop = () => {};

function assento(seat: Seat, over: Partial<AssentoLido> = {}): AssentoLido {
  return {
    seat, playerId: "p" + seat, nick: "J" + seat, connected: true, ready: false,
    assisted: false, bot: false, host: seat === 0, avatar: "coroa", ...over,
  };
}

function render(seats: AssentoLido[], eu: Seat = 0, souAnfitriao = true): HTMLElement {
  const sala: EstadoDaSalaLido = {
    protocolVersion: 1, roomCode: "0315", roomId: "0315", status: "lobby", seats,
  };
  return parse(renderToStaticMarkup(
    <Sala
      sala={sala} conexao="conectado" erro={null} eu={eu} souAnfitriao={souAnfitriao}
      onPronto={noop} onAdicionarBot={noop} onRemoverBot={noop} onSair={noop} onOpenAudio={noop}
    />,
  ));
}

const circulos = (root: HTMLElement) => root.querySelectorAll(".sl-av").map((n) => n.text.trim());

describe("avatar no lobby", () => {
  it("cada pessoa aparece com o desenho do seu avatar", () => {
    const escolhas = ["espadas", "copas", "ouros", "paus"];
    const root = render(escolhas.map((a, i) => assento(i as Seat, { avatar: a })));
    expect(circulos(root)).toEqual(escolhas.map((a) => desenhoDoAvatar(a).glifo));
  });

  it("o desenho é o MESMO que a Mesa usa — a identidade não muda de tela", () => {
    const root = render([assento(0, { avatar: "dama" }), assento(1), assento(2), assento(3)]);
    expect(circulos(root)[0]).toBe(desenhoDoAvatar("dama").glifo);
  });

  it("avatar desconhecido cai no padrão em vez de deixar o círculo vazio", () => {
    const root = render([assento(0, { avatar: "sei-la" }), assento(1), assento(2), assento(3)]);
    expect(circulos(root)[0]).toBe(desenhoDoAvatar(undefined).glifo);
  });

  it("cada círculo tem rótulo legível — quem usa leitor de tela também sabe quem é quem", () => {
    const root = render([assento(0, { avatar: "ouros" }), assento(1), assento(2), assento(3)]);
    expect(root.querySelectorAll(".sl-av")[0].getAttribute("aria-label")).toBe(desenhoDoAvatar("ouros").rotulo);
  });

  it("lugar vago continua sendo um convite, não um jogador sem cara", () => {
    const root = render([assento(0), { ...assento(1), playerId: "", nick: "" }, assento(2), assento(3)]);
    expect(circulos(root)[1]).toBe("+");
    expect(root.text).toContain("Aguardando");
  });
});

describe("o bot tem nome próprio, e mesmo assim se declara bot", () => {
  it("o nome sorteado pelo servidor é o que aparece", () => {
    const root = render([assento(0), assento(1), assento(2, { bot: true, nick: "Reizinho" }), assento(3)]);
    expect(root.text).toContain("Reizinho");
  });

  it("o assento de bot é marcado no texto E na classe — não só num ícone", () => {
    const root = render([assento(0), assento(1), assento(2, { bot: true, nick: "Reizinho" }), assento(3)]);
    const lugar = root.querySelectorAll(".sl-lugar")[2];
    expect(lugar.getAttribute("class")).toContain("robo");
    expect(lugar.text).toContain("bot");
    expect(lugar.querySelector(".sl-av")?.text.trim()).toBe("🤖");
  });

  it("humano nenhum ganha a etiqueta de bot", () => {
    const root = render([assento(0, { nick: "Tito" }), assento(1), assento(2), assento(3)]);
    expect(root.querySelectorAll(".sl-lugar")[0].text).not.toContain("bot");
  });
});
