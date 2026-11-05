/**
 * NENHUMA ENTRADA ESPERA PARA SEMPRE — a outra metade do defeito do vc1.
 *
 * A causa do "Conectando…" eterno no Android foi o cofre (ver `nativo/cofreNativo.test.ts`), mas o
 * que deixou a tela presa foi a falta de prazo: `conectar()` esperava `abrir(pedido)` sem limite, e
 * `credencialPara` esperava `token()` sem limite. Qualquer etapa que não responda — cofre, Supabase,
 * matchmaking, WebSocket — repetiria o sintoma. Aqui cada uma ganha prazo, e a sessão que chegar
 * DEPOIS do prazo é fechada: ninguém fica com uma sala aberta que não vê.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abrirComPrazo, credencialPara, PrazoDaEntradaEsgotado, PRAZO_DA_CREDENCIAL_MS, PRAZO_DA_ENTRADA_MS,
  type SessaoKing,
} from "./clienteKing.js";
import { mensagemDeFalha } from "../game/useKingOnline.js";

const nunca = <T>() => new Promise<T>(() => {});

function sessaoFalsa() {
  const s = { saiu: 0, roomCode: "1234", sair() { s.saiu++; } };
  return s as unknown as SessaoKing & { saiu: number };
}

afterEach(() => { vi.useRealTimers(); });

describe("credencial com prazo", () => {
  it("um provedor que nunca responde vira 'sem credencial' no prazo", async () => {
    vi.useFakeTimers();
    const p = credencialPara({ token: () => nunca<string | undefined>() });
    await vi.advanceTimersByTimeAsync(PRAZO_DA_CREDENCIAL_MS);
    await expect(p).resolves.toBeUndefined();
  });

  it("o prazo da credencial cabe dentro do prazo da entrada (sobra tempo para o servidor responder)", () => {
    expect(PRAZO_DA_CREDENCIAL_MS).toBeLessThan(PRAZO_DA_ENTRADA_MS / 2);
  });

  it("um token que chega a tempo continua chegando", async () => {
    await expect(credencialPara({ token: async () => "abc" })).resolves.toBe("abc");
  });
});

describe("entrada com prazo", () => {
  it("abrir que nunca termina falha no prazo, com erro próprio", async () => {
    vi.useFakeTimers();
    const p = abrirComPrazo(() => nunca<SessaoKing>(), { tipo: "criar", nick: "Ana", avatar: "leao" });
    const resultado = p.then(() => "abriu", (e) => e);
    await vi.advanceTimersByTimeAsync(PRAZO_DA_ENTRADA_MS);
    expect(await resultado).toBeInstanceOf(PrazoDaEntradaEsgotado);
  });

  it("a sessão que chega DEPOIS do prazo é fechada — nada de sala órfã", async () => {
    vi.useFakeTimers();
    const s = sessaoFalsa();
    let entregar: (x: SessaoKing) => void = () => {};
    const p = abrirComPrazo(() => new Promise<SessaoKing>((ok) => { entregar = ok; }), { tipo: "criar", nick: "Ana", avatar: "leao" });
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(PRAZO_DA_ENTRADA_MS);
    entregar(s);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.saiu).toBe(1);
  });

  it("a sessão que chega a tempo é entregue e fica aberta", async () => {
    const s = sessaoFalsa();
    await expect(abrirComPrazo(async () => s, { tipo: "criar", nick: "Ana", avatar: "leao" })).resolves.toBe(s);
    expect(s.saiu).toBe(0);
  });

  it("a recusa do servidor chega como veio (a frase certa continua sendo escolhida)", async () => {
    const e = Object.assign(new Error("room is locked"), { code: 522 });
    await expect(abrirComPrazo(async () => { throw e; }, { tipo: "entrar", codigo: "1234", nick: "Ana", avatar: "leao" }))
      .rejects.toBe(e);
  });

  it("o prazo esgotado tem frase própria, objetiva e com o gesto de tentar de novo", () => {
    const frase = mensagemDeFalha(new PrazoDaEntradaEsgotado());
    expect(frase).toMatch(/demorou/i);
    expect(frase).toMatch(/tente de novo/i);
    expect(frase).not.toBe(mensagemDeFalha(new Error("qualquer coisa")));
  });
});
