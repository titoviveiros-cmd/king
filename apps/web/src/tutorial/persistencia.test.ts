// O QUE O TUTORIAL LEMBRA ENTRE UMA VISITA E OUTRA.
//
// Este arquivo cobre só a memória do tutorial: já abriu? já concluiu? onde parou? QUANDO ele
// aparece não se decide aqui e nem depende do que está salvo — ele nunca se abre sozinho, e a
// Home é sempre a primeira tela (ver `App.tsx` e o primeiro teste de `tests/tutorial.spec.ts`).
// O progresso existe para RETOMAR quando alguém o chama, não para decidir por ninguém.
import { afterEach, describe, expect, it } from "vitest";
import {
  PROGRESSO_ZERO, armazenamentoLocal, normalizar,
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
  it("do zero, o progresso começa no passo 0", () => {
    comArmazenamento();
    expect(armazenamentoLocal.ler()).toEqual({ iniciado: false, concluido: false, passo: 0 });
  });
});

describe("quem já passou por ele fica marcado", () => {
  it("pular guarda INICIADO sem concluir — o rótulo da Home continua 'Aprenda KING'", () => {
    comArmazenamento();
    armazenamentoLocal.gravar({ iniciado: true, concluido: false, passo: 2 });
    const lido = armazenamentoLocal.ler();
    expect(lido.iniciado).toBe(true);
    expect(lido.concluido).toBe(false);
  });

  it("concluir marca CONCLUÍDO — é o que faz a Home dizer 'Rever como se joga'", () => {
    comArmazenamento();
    armazenamentoLocal.gravar({ iniciado: true, concluido: true, passo: 0 });
    expect(armazenamentoLocal.ler().concluido).toBe(true);
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
