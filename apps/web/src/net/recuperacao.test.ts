/**
 * CREDENCIAL DE RETORNO — o que permite voltar ao MESMO assento depois de recarregar a página.
 *
 * Dois comportamentos são críticos:
 *   • ela ROTACIONA a cada `SERVER_WELCOME`, então gravar tem de sobrescrever, nunca acumular;
 *   • se o armazenamento falhar (Safari privado, cota cheia), o jogo NÃO pode cair — perde-se o
 *     retorno automático, e só.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { codigoDaRecuperacao, esquecerRecuperacao, guardarRecuperacao, lerRecuperacao } from "./recuperacao.js";

const original = Reflect.get(globalThis, "localStorage");

function instalarCofre(cofre: unknown) {
  Reflect.set(globalThis, "localStorage", cofre);
}

function cofreDeMentira() {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => { dados.set(k, v); },
    removeItem: (k: string) => { dados.delete(k); },
  };
}

beforeEach(() => instalarCofre(cofreDeMentira()));
afterEach(() => instalarCofre(original));

describe("recoveryToken", () => {
  it("guarda, lê e esquece", () => {
    expect(lerRecuperacao()).toBeNull();
    guardarRecuperacao("ABCDE:tok-1");
    expect(lerRecuperacao()).toBe("ABCDE:tok-1");
    esquecerRecuperacao();
    expect(lerRecuperacao()).toBeNull();
  });

  it("a credencial nova SUBSTITUI a antiga — ela rotaciona a cada retorno", () => {
    guardarRecuperacao("ABCDE:tok-1");
    guardarRecuperacao("ABCDE:tok-2");
    expect(lerRecuperacao()).toBe("ABCDE:tok-2");
  });

  it("valor sem o formato `roomCode:token` é ignorado", () => {
    instalarCofre({ ...cofreDeMentira(), getItem: () => "lixo-sem-doispontos" });
    expect(lerRecuperacao()).toBeNull();
  });

  it("extrai o código da sala embutido na credencial", () => {
    expect(codigoDaRecuperacao("ABCDE:tok-1")).toBe("ABCDE");
  });

  it("armazenamento indisponível não derruba o jogo", () => {
    instalarCofre(undefined);
    expect(() => guardarRecuperacao("ABCDE:tok")).not.toThrow();
    expect(lerRecuperacao()).toBeNull();
    expect(() => esquecerRecuperacao()).not.toThrow();
  });

  it("armazenamento que LANÇA (Safari privado, cota cheia) também não derruba", () => {
    const explode = () => { throw new Error("QuotaExceededError"); };
    instalarCofre({ getItem: explode, setItem: explode, removeItem: explode });
    expect(() => guardarRecuperacao("ABCDE:tok")).not.toThrow();
    expect(lerRecuperacao()).toBeNull();
    expect(() => esquecerRecuperacao()).not.toThrow();
  });
});
