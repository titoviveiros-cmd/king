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
    guardarRecuperacao("0315:tok-1");
    expect(lerRecuperacao()).toBe("0315:tok-1");
    esquecerRecuperacao();
    expect(lerRecuperacao()).toBeNull();
  });

  it("a credencial nova SUBSTITUI a antiga — ela rotaciona a cada retorno", () => {
    guardarRecuperacao("0315:tok-1");
    guardarRecuperacao("0315:tok-2");
    expect(lerRecuperacao()).toBe("0315:tok-2");
  });

  it("valor sem o formato `roomCode:token` é ignorado", () => {
    instalarCofre({ ...cofreDeMentira(), getItem: () => "lixo-sem-doispontos" });
    expect(lerRecuperacao()).toBeNull();
  });

  it("extrai o código da sala embutido na credencial", () => {
    expect(codigoDaRecuperacao("0315:tok-1")).toBe("0315");
  });

  it("o ZERO À ESQUERDA sobrevive à ida e à volta — o defeito clássico do código numérico", () => {
    // `0315` tratado como número em qualquer ponto vira `315`, e o jogador não consegue voltar
    // para a própria sala usando o código que está na tela do amigo.
    for (const codigo of ["0315", "0001", "0000", "0007"]) {
      const credencial = `${codigo}:abc-123`;
      guardarRecuperacao(credencial);
      expect(lerRecuperacao()).toBe(credencial);
      expect(codigoDaRecuperacao(lerRecuperacao()!)).toBe(codigo);
      expect(codigoDaRecuperacao(lerRecuperacao()!)).toHaveLength(4);
    }
  });

  it("um token com ':' no meio não confunde a extração do código", () => {
    expect(codigoDaRecuperacao("0315:abc:def")).toBe("0315");
  });

  it("armazenamento indisponível não derruba o jogo", () => {
    instalarCofre(undefined);
    expect(() => guardarRecuperacao("0315:tok")).not.toThrow();
    expect(lerRecuperacao()).toBeNull();
    expect(() => esquecerRecuperacao()).not.toThrow();
  });

  it("armazenamento que LANÇA (Safari privado, cota cheia) também não derruba", () => {
    const explode = () => { throw new Error("QuotaExceededError"); };
    instalarCofre({ getItem: explode, setItem: explode, removeItem: explode });
    expect(() => guardarRecuperacao("0315:tok")).not.toThrow();
    expect(lerRecuperacao()).toBeNull();
    expect(() => esquecerRecuperacao()).not.toThrow();
  });
});
