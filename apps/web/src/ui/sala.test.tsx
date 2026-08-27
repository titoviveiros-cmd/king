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
import { AVATARES, desenhoDoAvatar } from "./avatares.js";
import type { AssentoLido, EstadoDaSalaLido } from "../net/clienteKing.js";

const noop = () => {};

function assento(seat: Seat, over: Partial<AssentoLido> = {}): AssentoLido {
  return {
    seat, playerId: "p" + seat, nick: "J" + seat, connected: true, ready: false,
    assisted: false, bot: false, host: seat === 0, avatar: "leao", ...over,
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
      onEscolherMesa={noop} onEscolherAvatar={noop}
    />,
  ));
}

const circulos = (root: HTMLElement) => root.querySelectorAll(".sl-av").map((n) => n.text.trim());

/** Um lugar ainda vago: `playerId` vazio é o que o servidor usa para dizer "ninguém aqui". */
const vazio = (seat: Seat): AssentoLido => ({ ...assento(seat), playerId: "", nick: "" });

describe("avatar no lobby", () => {
  it("cada pessoa aparece com o desenho do seu avatar", () => {
    const escolhas = ["leao", "sapo", "tucano", "panda"];
    const root = render(escolhas.map((a, i) => assento(i as Seat, { avatar: a })));
    expect(circulos(root)).toEqual(escolhas.map((a) => desenhoDoAvatar(a).glifo));
  });

  it("o desenho é o MESMO que a Mesa usa — a identidade não muda de tela", () => {
    const root = render([assento(0, { avatar: "raposa" }), assento(1), assento(2), assento(3)]);
    expect(circulos(root)[0]).toBe(desenhoDoAvatar("raposa").glifo);
  });

  it("avatar desconhecido cai no padrão em vez de deixar o círculo vazio", () => {
    const root = render([assento(0, { avatar: "sei-la" }), assento(1), assento(2), assento(3)]);
    expect(circulos(root)[0]).toBe(desenhoDoAvatar(undefined).glifo);
  });

  it("cada círculo tem rótulo legível — quem usa leitor de tela também sabe quem é quem", () => {
    const root = render([assento(0, { avatar: "tucano" }), assento(1), assento(2), assento(3)]);
    expect(root.querySelectorAll(".sl-av")[0].getAttribute("aria-label")).toBe(desenhoDoAvatar("tucano").rotulo);
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

/**
 * AVATAR EXCLUSIVO — a parte que o lobby consegue fazer.
 *
 * Dois humanos com o mesmo bicho numa mesa de quatro é confusão gratuita, e a escolha da Home
 * acontece antes de saber quem já está na sala. Aqui, com a mesa à vista, ela pode ser refeita.
 *
 * O que se trava: o ocupado CONTINUA na grade. Sumir com ele reposicionaria todos os outros no
 * instante em que um dedo já está a caminho de um deles, e o toque cairia em outro bicho.
 *
 * Isto é apresentação. Quem recusa de verdade é o servidor — entre esta grade e a mensagem
 * chegando lá cabe a escolha de outra pessoa, e essa corrida tem teste próprio no servidor.
 */
describe("seletor de avatar do lobby", () => {
  const ops = (root: HTMLElement) => root.querySelectorAll(".sl-avop");

  it("os oito continuam na grade, ocupados inclusive", () => {
    const root = render([
      assento(0, { avatar: "leao" }), assento(1, { avatar: "sapo" }),
    ].concat([2, 3].map((s) => vazio(s as Seat))));
    expect(ops(root)).toHaveLength(AVATARES.length);
  });

  it("o que outro humano usa aparece como EM USO e não é clicável", () => {
    const root = render([
      assento(0, { avatar: "leao" }), assento(1, { avatar: "sapo" }),
    ].concat([2, 3].map((s) => vazio(s as Seat))));
    const sapo = ops(root)[AVATARES.indexOf("sapo")];
    expect(sapo.classNames).toContain("emuso");
    expect(sapo.getAttribute("disabled")).not.toBeNull();
    expect(sapo.text).toContain("Em uso");
    expect(sapo.getAttribute("aria-label")).toContain("em uso");
  });

  it("o próprio avatar NÃO é 'em uso' — ele é o escolhido", () => {
    const root = render([
      assento(0, { avatar: "leao" }), assento(1, { avatar: "sapo" }),
    ].concat([2, 3].map((s) => vazio(s as Seat))));
    const leao = ops(root)[AVATARES.indexOf("leao")];
    expect(leao.classNames).toContain("on");
    expect(leao.classNames).not.toContain("emuso");
    expect(leao.getAttribute("disabled")).toBeFalsy();
    expect(leao.getAttribute("aria-checked")).toBe("true");
  });

  it("o bicho de um BOT também conta como ocupado", () => {
    const root = render([
      assento(0, { avatar: "leao" }), assento(1, { avatar: "coruja", bot: true }),
    ].concat([2, 3].map((s) => vazio(s as Seat))));
    expect(ops(root)[AVATARES.indexOf("coruja")].classNames).toContain("emuso");
  });

  it("assento vago não ocupa bicho nenhum — e o meu não bloqueia a mim mesmo", () => {
    const root = render([assento(0, { avatar: "leao" })]
      .concat([1, 2, 3].map((s) => vazio(s as Seat))));
    // Sozinho na sala, os oito estão disponíveis: os três lugares vazios não reservam nada, e o
    // meu próprio bicho não pode aparecer como "em uso" para mim.
    expect(ops(root).filter((o) => o.classNames.includes("emuso"))).toHaveLength(0);
    expect(ops(root).filter((o) => o.classNames.includes("on"))).toHaveLength(1);
  });
});
