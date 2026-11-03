/**
 * 1 HUMANO + 3 BOTS NO LOBBY (decisão de 03/11/2026).
 *
 * O piso de humanos é do SERVIDOR e chega nas boas-vindas. O que trava aqui: com o servidor novo, o
 * rodapé diz que a partida começa e que ela não vale XP; com um servidor ANTERIOR (sem o campo), o
 * lobby continua dizendo que faltam pessoas — nunca promete uma partida que não começaria.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import type { Seat } from "@king/engine";
import { Sala, rodape } from "./Sala.js";
import { pisoDeHumanos, PISO_ANTIGO_DE_HUMANOS } from "../game/useKingOnline.js";
import type { AssentoLido, EstadoDaSalaLido } from "../net/clienteKing.js";

const noop = () => {};
const assento = (seat: Seat, over: Partial<AssentoLido> = {}): AssentoLido => ({
  seat, playerId: "p" + seat, nick: "J" + seat, connected: true, ready: false,
  assisted: false, bot: false, host: seat === 0, avatar: ["leao", "sapo", "tucano", "panda"][seat]!, ...over,
});
const umMaisTres = [assento(0), assento(1, { bot: true, ready: true }), assento(2, { bot: true, ready: true }), assento(3, { bot: true, ready: true })];

function rodapeRenderizado(seats: AssentoLido[], minHumanos?: number): string {
  const sala: EstadoDaSalaLido = { protocolVersion: 3, roomCode: "0315", roomId: "0315", status: "lobby", seats };
  const html = renderToStaticMarkup(
    <Sala
      sala={sala} conexao="conectado" erro={null} eu={0} souAnfitriao minHumanos={minHumanos}
      onPronto={noop} onAdicionarBot={noop} onRemoverBot={noop} onSair={noop} onOpenAudio={noop}
      onEscolherMesa={noop} onEscolherAvatar={noop}
    />,
  );
  return parse(html).querySelector(".foot")!.text;
}

describe("lobby com 1 humano + 3 bots", () => {
  it("servidor novo (piso 1): diz que começa quando você estiver pronto e que NÃO vale XP", () => {
    const t = rodapeRenderizado(umMaisTres, 1);
    expect(t).toMatch(/começa quando você estiver pronto/);
    expect(t).toMatch(/sem XP/);
  });

  it("servidor ANTERIOR (sem o campo): continua pedindo a 2ª pessoa — nada de promessa falsa", () => {
    const t = rodapeRenderizado(umMaisTres);
    expect(t).toBe("A mesa precisa de pelo menos 2 pessoas — troque um bot por alguém para começar");
  });

  it("2+2, 3+1 e 4 humanos: a frase de sempre, sem aviso de XP", () => {
    const comp = (h: number) => [0, 1, 2, 3].map((s) => assento(s as Seat, s >= h ? { bot: true, ready: true } : {}));
    for (const h of [2, 3, 4]) {
      expect(rodapeRenderizado(comp(h), 1)).toBe("Quatro na mesa · a partida começa quando todos os humanos estiverem prontos");
    }
  });

  it("mesa incompleta continua dizendo quantos lugares faltam (com a dica de bots para o anfitrião)", () => {
    expect(rodape(1, 1, true, 1)).toBe("1 de 4 lugares ocupados · faltam 3 — ou complete com bots");
    expect(rodape(3, 1, true, 1)).toBe("3 de 4 lugares ocupados · faltam 1 — ou complete com bots");
  });

  it("a frase cabe numa linha curta, como as outras do rodapé", () => {
    expect(rodape(4, 1, true, 1).length).toBeLessThanOrEqual(rodape(4, 1, true, 2).length);
  });
});

describe("piso anunciado nas boas-vindas", () => {
  it("vale o que o servidor anuncia (1 a 4)", () => {
    for (const n of [1, 2, 3, 4]) expect(pisoDeHumanos(n)).toBe(n);
  });
  it("ausente ou lixo = a regra antiga, 2", () => {
    expect(PISO_ANTIGO_DE_HUMANOS).toBe(2);
    for (const x of [undefined, null, 0, -1, 5, 1.5, "1", NaN]) expect(pisoDeHumanos(x)).toBe(2);
  });
});
