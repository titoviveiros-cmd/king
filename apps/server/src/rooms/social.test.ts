// MENSAGENS SOCIAIS — conjunto fechado e limitador de ritmo.
//
// Testes puros. O que está em jogo: (1) nenhum texto escrito por um jogador pode chegar à tela
// de outro, e (2) ninguém consegue transformar a mesa em spam.
import { describe, expect, it } from "vitest";
import {
  COOLDOWN_MS, DURACAO_MS, JANELA_MS, MAX_NA_JANELA, MENSAGENS_SOCIAIS, RitmoSocial, mensagemValida,
} from "./social.js";

describe("conjunto fechado", () => {
  it("aceita cada etiqueta da lista", () => {
    for (const m of MENSAGENS_SOCIAIS) expect(mensagemValida(m)).toBe(true);
  });

  it("recusa qualquer coisa fora da lista — inclusive o que alguém tentaria injetar", () => {
    for (const lixo of [
      "", " ", "boa ", "BOA", "oi tudo bem", "<script>alert(1)</script>",
      "https://exemplo.com", "meu zap é 11999999999", "a".repeat(10_000),
      undefined, null, 0, 1, true, {}, [], { toString: () => "boa" },
    ]) {
      expect(mensagemValida(lixo), String(lixo).slice(0, 20)).toBe(false);
    }
  });

  it("mensagem inválida é RECUSADA, não substituída — diferente do avatar, e de propósito", () => {
    // avatar inválido tem padrão porque todo assento precisa de um; mensagem não precisa existir
    expect(mensagemValida("nao-existe")).toBe(false);
  });

  it("a lista não tem repetidos e nenhuma etiqueta é texto de interface", () => {
    expect(new Set(MENSAGENS_SOCIAIS).size).toBe(MENSAGENS_SOCIAIS.length);
    for (const m of MENSAGENS_SOCIAIS) expect(m).toMatch(/^[a-z-]+$/);
  });
});

describe("limitador de ritmo", () => {
  it("a primeira mensagem passa", () => {
    expect(new RitmoSocial().permitir(0, 1000).ok).toBe(true);
  });

  it("metralhadora é barrada pelo cooldown", () => {
    const r = new RitmoSocial();
    expect(r.permitir(0, 0).ok).toBe(true);
    expect(r.permitir(0, 500)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(r.permitir(0, COOLDOWN_MS - 1).ok).toBe(false);
    expect(r.permitir(0, COOLDOWN_MS).ok).toBe(true);
  });

  it("rajada espaçada, que passaria pelo cooldown, é barrada pela janela", () => {
    const r = new RitmoSocial();
    for (let i = 0; i < MAX_NA_JANELA; i++) {
      expect(r.permitir(0, i * COOLDOWN_MS).ok, `envio ${i}`).toBe(true);
    }
    expect(r.permitir(0, MAX_NA_JANELA * COOLDOWN_MS)).toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });

  it("passada a janela, volta a falar", () => {
    const r = new RitmoSocial();
    for (let i = 0; i < MAX_NA_JANELA; i++) r.permitir(0, i * COOLDOWN_MS);
    expect(r.permitir(0, JANELA_MS + MAX_NA_JANELA * COOLDOWN_MS).ok).toBe(true);
  });

  it("o limite é POR ASSENTO: quem falou demais não cala os outros", () => {
    const r = new RitmoSocial();
    expect(r.permitir(0, 0).ok).toBe(true);
    expect(r.permitir(0, 100).ok).toBe(false);
    for (const seat of [1, 2, 3]) expect(r.permitir(seat, 100).ok, `assento ${seat}`).toBe(true);
  });

  it("recusa NÃO conta como envio — senão o bloqueio se renovaria sozinho para sempre", () => {
    const r = new RitmoSocial();
    r.permitir(0, 0);
    for (let t = 100; t < COOLDOWN_MS; t += 100) r.permitir(0, t); // martelando
    expect(r.permitir(0, COOLDOWN_MS).ok).toBe(true);
  });

  it("assento liberado esquece o histórico: quem sentar depois não herda castigo", () => {
    const r = new RitmoSocial();
    r.permitir(0, 0);
    expect(r.permitir(0, 100).ok).toBe(false);
    r.esquecer(0);
    expect(r.permitir(0, 100).ok).toBe(true);
  });

  it("os prazos são humanos: ninguém espera mais que alguns segundos, e o balão some sozinho", () => {
    expect(COOLDOWN_MS).toBeGreaterThanOrEqual(1000);
    expect(COOLDOWN_MS).toBeLessThanOrEqual(5000);
    expect(DURACAO_MS).toBeGreaterThan(1500);
    expect(DURACAO_MS).toBeLessThanOrEqual(8000);
  });
});

// O texto de cada mensagem vive no cliente; aqui só a etiqueta. Se as duas listas divergirem,
// alguém manda "coroado" e o outro não desenha nada — ou pior, desenha a frase errada.
describe("contrato com o cliente", () => {
  it("toda etiqueta do servidor tem frase no web, e vice-versa", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const caminho = fileURLToPath(new URL("../../../web/src/ui/social.ts", import.meta.url));
    const fonte = readFileSync(caminho, "utf8");
    const doWeb = [...fonte.matchAll(/\{ id: "([a-z-]+)"/g)].map((m) => m[1]);

    expect(doWeb.length).toBeGreaterThan(0);
    expect([...doWeb].sort()).toEqual([...MENSAGENS_SOCIAIS].sort());
    expect(new Set(doWeb).size).toBe(doWeb.length);
  });
});
