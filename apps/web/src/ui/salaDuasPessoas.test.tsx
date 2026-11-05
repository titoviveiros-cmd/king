/**
 * SALA MULTIPLAYER: A REGRA DOS DOIS HUMANOS, À VISTA (2º QA físico do Android, 03/11/2026).
 *
 * No aparelho, o anfitrião sozinho completou a mesa com 3 bots, marcou pronto e nada aconteceu —
 * sem nenhuma explicação na tela. Três defeitos de apresentação, todos travados aqui:
 *   1. a única explicação morava no rodapé, que SOME em paisagem no celular (theme.css,
 *      `max-height: 360px`) — agora há um aviso próprio, que não some;
 *   2. com 1 humano + 2 bots o rodapé dizia "ou complete com bots" — o caminho do beco: com a mesa
 *      cheia, a 2ª pessoa recebe "sala cheia" (ver mesaMista.test.ts) — agora o último lugar de que
 *      um humano precisa fica reservado, sem "+ Bot";
 *   3. o "✓ Pronto — cancelar" parecia travado — agora diz o que falta.
 * A regra não mudou (servidor: `MIN_HUMANOS = 2`); jogar só contra bots é o "Jogar agora".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import type { Seat } from "@king/engine";
import { Sala, situacaoDaSala, REGRA_DOS_DOIS } from "./Sala.js";
import type { AssentoLido, EstadoDaSalaLido } from "../net/clienteKing.js";

const noop = () => {};
const AV = ["leao", "sapo", "tucano", "panda"];
const humano = (seat: Seat, over: Partial<AssentoLido> = {}): AssentoLido => ({
  seat, playerId: "p" + seat, nick: "J" + seat, connected: true, ready: false,
  assisted: false, bot: false, host: seat === 0, avatar: AV[seat]!, ...over,
});
const robo = (seat: Seat): AssentoLido => humano(seat, { playerId: "bot:" + seat, nick: "Bot" + seat, bot: true, ready: true, host: false });
const vago = (seat: Seat): AssentoLido => humano(seat, { playerId: "", nick: "", avatar: "", host: false });

function tela(seats: AssentoLido[], o: { eu?: Seat; anfitriao?: boolean } = {}) {
  const sala: EstadoDaSalaLido = { protocolVersion: 3, roomCode: "0315", roomId: "0315", status: "lobby", seats };
  const html = renderToStaticMarkup(
    <Sala
      sala={sala} conexao="conectado" erro={null} eu={o.eu ?? 0} souAnfitriao={o.anfitriao ?? true}
      onPronto={noop} onAdicionarBot={noop} onRemoverBot={noop} onSair={noop} onOpenAudio={noop}
      onEscolherMesa={noop} onEscolherAvatar={noop}
    />,
  );
  const raiz = parse(html);
  return {
    aviso: raiz.querySelector(".sl-regra")?.text ?? null,
    rodape: raiz.querySelector(".foot")?.text ?? "",
    maisBot: raiz.querySelectorAll(".sl-bot.add").length,
    reservados: raiz.querySelectorAll(".sl-lugar").filter((l) => l.text.includes("Lugar do 2º jogador")).length,
    pronto: raiz.querySelectorAll("button").find((b) => /Pronto|pronto/.test(b.text))?.text ?? "",
  };
}

describe("a regra (função pura)", () => {
  it("sozinho com lugares vagos: aviso dos 2 humanos, bot só enquanto sobrar lugar para a 2ª pessoa", () => {
    expect(situacaoDaSala(1, 1, true, false)).toMatchObject({ aviso: { regra: REGRA_DOS_DOIS }, podeAdicionarBot: true });
    expect(situacaoDaSala(2, 1, true, false).podeAdicionarBot).toBe(true);
    // 1 humano + 2 bots + 1 vago: o vago é da 2ª pessoa
    expect(situacaoDaSala(3, 1, true, false).podeAdicionarBot).toBe(false);
  });

  it("nunca mais ensina o beco: com 1 humano, o rodapé não diz 'complete com bots'", () => {
    for (const ocupados of [1, 2, 3, 4]) {
      expect(situacaoDaSala(ocupados, 1, true, false).rodape).not.toMatch(/complete com bots/);
    }
  });

  it("mesa cheia com 1 humano (cliente antigo deixou): o aviso manda remover um bot", () => {
    const s = situacaoDaSala(4, 1, true, false);
    expect(s.aviso?.detalhe).toMatch(/remova um bot/);
    expect(s.podeAdicionarBot).toBe(false);
  });

  it("2 humanos ou mais: sem aviso; vagos aceitam bot; mesa cheia diz que começa quando todos estiverem prontos", () => {
    expect(situacaoDaSala(2, 2, true, false)).toMatchObject({ aviso: null, podeAdicionarBot: true });
    expect(situacaoDaSala(3, 2, true, false).rodape).toBe("3 de 4 lugares ocupados · faltam 1 — ou complete com bots");
    for (const h of [2, 3, 4]) {
      expect(situacaoDaSala(4, h, true, false)).toMatchObject({
        aviso: null, prontoEsperando: null,
        rodape: "Quatro na mesa · a partida começa quando todos os humanos estiverem prontos",
      });
    }
  });

  it("pronto sozinho: o botão diz o que falta", () => {
    expect(situacaoDaSala(4, 1, true, true).prontoEsperando).toBe("✓ Pronto · falta o 2º jogador");
    expect(situacaoDaSala(3, 1, true, false).prontoEsperando).toBeNull();
    expect(situacaoDaSala(4, 2, true, true).prontoEsperando).toBeNull();
  });
});

describe("a tela", () => {
  it("1 humano + 3 bots (o caso do QA): aviso visível com a regra, rodapé aponta o 'Jogar agora', botão diz o que falta", () => {
    const t = tela([humano(0, { ready: true }), robo(1), robo(2), robo(3)]);
    expect(t.aviso).toContain("Esta sala precisa de pelo menos 2 jogadores humanos para começar.");
    expect(t.aviso).toMatch(/remova um bot para o 2º jogador poder entrar/);
    expect(t.rodape).toMatch(/Jogar agora/);
    expect(t.pronto).toBe("✓ Pronto · falta o 2º jogador");
  });

  it("1 humano + 2 bots + 1 vago: o vago fica reservado (sem '+ Bot') e o aviso explica que bot não substitui", () => {
    const t = tela([humano(0), robo(1), robo(2), vago(3)]);
    expect(t.maisBot, "'+ Bot' no lugar da 2ª pessoa").toBe(0);
    expect(t.reservados).toBe(1);
    expect(t.aviso).toMatch(/Bots completam a mesa, mas não substituem o 2º jogador/);
    expect(t.pronto).toBe("Estou pronto");
  });

  it("sozinho com 3 vagos: dá para pôr bots enquanto sobra lugar (3 botões), e o aviso já aparece", () => {
    const t = tela([humano(0), vago(1), vago(2), vago(3)]);
    expect(t.maisBot).toBe(3);
    expect(t.reservados).toBe(0);
    expect(t.aviso).toContain(REGRA_DOS_DOIS);
  });

  it("2 humanos + 2 bots: sem aviso, a frase de sempre (a composição que funciona não mudou)", () => {
    const t = tela([humano(0), humano(1), robo(2), robo(3)]);
    expect(t.aviso).toBeNull();
    expect(t.rodape).toBe("Quatro na mesa · a partida começa quando todos os humanos estiverem prontos");
    expect(t.pronto).toBe("Estou pronto");
  });

  it("2 humanos + 1 bot + 1 vago: o vago aceita bot de novo", () => {
    const t = tela([humano(0), humano(1), robo(2), vago(3)]);
    expect(t.maisBot).toBe(1);
    expect(t.reservados).toBe(0);
    expect(t.aviso).toBeNull();
  });

  it("quem não é anfitrião (2 humanos) não vê '+ Bot' nem aviso", () => {
    const t = tela([humano(0), humano(1), vago(2), vago(3)], { eu: 1, anfitriao: false });
    expect(t.maisBot).toBe(0);
    expect(t.aviso).toBeNull();
  });
});

describe("o aviso não some na tela baixa do celular", () => {
  it("nenhuma regra de CSS esconde .sl-regra (o rodapé some em max-height:360px; o aviso não pode)", () => {
    const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.sl-regra\{/);
    expect(css).not.toMatch(/\.sl-regra[^{]*\{[^}]*display:\s*none/);
    // e o rodapé, de fato, some lá — por isso nada essencial pode morar só nele
    expect(css).toMatch(/\.sala \.foot \{ display: none; \}/);
  });
});
