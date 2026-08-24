// QUANDO O TUTORIAL APARECE, E QUANDO NÃO APARECE.
//
// A regra de produto tem duas metades e a segunda é a que costuma ser esquecida: ele abre sozinho
// na PRIMEIRA utilização, e **nunca mais se impõe** depois disso. Tutorial que reaparece sem ser
// chamado é a forma mais rápida de tornar um jogo irritante.
import { afterEach, describe, expect, it } from "vitest";
import {
  PROGRESSO_ZERO, armazenamentoLocal, deveAbrirSozinho, normalizar,
  type ProgressoDoTutorial,
} from "./persistencia.js";

function comArmazenamento(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => { dados.set(k, v); },
    removeItem: (k: string) => { dados.delete(k); },
  };
  return dados;
}
afterEach(() => { delete (globalThis as Record<string, unknown>).localStorage; });

describe("primeira utilização", () => {
  it("sem nada salvo, o tutorial se apresenta sozinho", () => {
    expect(deveAbrirSozinho(PROGRESSO_ZERO)).toBe(true);
  });

  it("do zero, o progresso começa no passo 0", () => {
    comArmazenamento();
    expect(armazenamentoLocal.ler()).toEqual({ iniciado: false, concluido: false, passo: 0 });
  });
});

describe("nunca mais se impõe", () => {
  it("depois de CONCLUÍDO, não abre sozinho", () => {
    expect(deveAbrirSozinho({ iniciado: true, concluido: true, passo: 0 })).toBe(false);
  });

  it("depois de PULADO, também não — quem saiu no passo 2 escolheu sair", () => {
    expect(deveAbrirSozinho({ iniciado: true, concluido: false, passo: 2 })).toBe(false);
  });

  it("basta ter ABERTO uma vez: mesmo abandonado no meio, não se impõe de novo", () => {
    expect(deveAbrirSozinho({ iniciado: true, concluido: false, passo: 0 })).toBe(false);
  });
});

describe("retomada", () => {
  it("guarda onde parou e devolve igual", () => {
    comArmazenamento();
    armazenamentoLocal.gravar({ iniciado: true, concluido: false, passo: 7 });
    expect(armazenamentoLocal.ler()).toEqual({ iniciado: true, concluido: false, passo: 7 });
  });

  it("concluir zera o passo — rever começa do início, não do fim", () => {
    comArmazenamento();
    armazenamentoLocal.gravar({ iniciado: true, concluido: true, passo: 0 });
    const lido = armazenamentoLocal.ler();
    expect(lido.concluido).toBe(true);
    expect(lido.passo).toBe(0);
  });
});

describe("dado estranho nunca vira exceção", () => {
  it("JSON corrompido volta ao progresso zero", () => {
    comArmazenamento({ "king:tutorial": "{isto não é json" });
    expect(armazenamentoLocal.ler()).toEqual(PROGRESSO_ZERO);
  });

  it("campos com tipo errado são saneados, não aceitos", () => {
    expect(normalizar({ iniciado: "sim", concluido: 1, passo: "cinco" }))
      .toEqual({ iniciado: false, concluido: false, passo: 0 });
    expect(normalizar({ passo: -4 })).toEqual({ iniciado: false, concluido: false, passo: 0 });
    expect(normalizar({ passo: 3.7 })).toMatchObject({ passo: 3 });
    expect(normalizar({ passo: Infinity })).toMatchObject({ passo: 0 });
  });

  it("nulo, texto e lista não derrubam a leitura", () => {
    for (const lixo of [null, undefined, "abc", 7, []]) {
      expect(() => normalizar(lixo)).not.toThrow();
      expect(normalizar(lixo).passo).toBe(0);
    }
  });

  it("sem armazenamento nenhum (aba anônima travada), o jogo continua", () => {
    // nenhum localStorage definido: ler devolve zero e gravar não lança
    expect(armazenamentoLocal.ler()).toEqual(PROGRESSO_ZERO);
    expect(() => armazenamentoLocal.gravar({ iniciado: true, concluido: true, passo: 3 })).not.toThrow();
  });
});

describe("nada de pessoal é guardado", () => {
  it("o progresso tem exatamente três campos, e nenhum identifica ninguém", () => {
    comArmazenamento();
    const p: ProgressoDoTutorial = { iniciado: true, concluido: false, passo: 4 };
    armazenamentoLocal.gravar(p);
    expect(Object.keys(armazenamentoLocal.ler()).sort()).toEqual(["concluido", "iniciado", "passo"]);
  });
});
