// AVATARES no cliente — validação, desenho e a memória local da última escolha.
//
// A regra que este arquivo protege: o `localStorage` LEMBRA, não MANDA. O avatar que os outros
// veem é o do estado autoritativo; aqui só mora a conveniência de já vir pré-selecionado.
import { afterEach, describe, expect, it } from "vitest";
import {
  AVATAR_PADRAO, AVATARES, avatarLembrado, avatarValido, desenhoDoAvatar, lembrarAvatar,
} from "./avatares.js";

/** Um `localStorage` de mentira, porque estes testes rodam em Node puro. */
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

describe("desenho", () => {
  it("todo avatar da lista tem glifo e ROTULO legível — identidade não pode ser só símbolo", () => {
    for (const a of AVATARES) {
      const d = desenhoDoAvatar(a);
      expect(d.glifo.length).toBeGreaterThan(0);
      expect(d.rotulo.length).toBeGreaterThan(0);
    }
  });

  it("os oito são distinguíveis entre si", () => {
    expect(new Set(AVATARES.map((a) => desenhoDoAvatar(a).glifo)).size).toBe(AVATARES.length);
    expect(new Set(AVATARES.map((a) => desenhoDoAvatar(a).rotulo)).size).toBe(AVATARES.length);
  });

  it("a coleção oficial: oito bichos, com Sapo e sem Tigre", () => {
    expect([...AVATARES]).toEqual(
      ["leao", "coruja", "raposa", "macaco", "panda", "tucano", "capivara", "sapo"],
    );
    expect(AVATARES as readonly string[]).toContain("sapo");
    expect(AVATARES as readonly string[]).not.toContain("tigre");
  });

  it("cada bicho tem PERSONA — é o que orienta o brief de arte", () => {
    for (const a of AVATARES) expect(desenhoDoAvatar(a).persona).toMatch(/\S/);
    expect(new Set(AVATARES.map((a) => desenhoDoAvatar(a).persona)).size).toBe(AVATARES.length);
    expect(desenhoDoAvatar("sapo").persona).toBe("O Malandro");
  });

  it("o desenho provisório se declara provisório onde o emoji não é o bicho", () => {
    // tucano e capivara não existem em Unicode: ficam com o substituto mais próximo, marcado.
    expect(desenhoDoAvatar("tucano").aproximado).toBe(true);
    expect(desenhoDoAvatar("capivara").aproximado).toBe(true);
    expect(desenhoDoAvatar("sapo").aproximado).toBeUndefined();
  });

  it("etiqueta desconhecida cai no padrão em vez de desenhar buraco", () => {
    for (const lixo of ["", "tigre", "leaoX", "<script>", undefined]) {
      expect(desenhoDoAvatar(lixo)).toEqual(desenhoDoAvatar(AVATAR_PADRAO));
    }
  });

  it("avatarValido espelha a regra do servidor", () => {
    for (const a of AVATARES) expect(avatarValido(a)).toBe(a);
    for (const lixo of ["", "LEAO", "tigre", 3, null, undefined, {}]) expect(avatarValido(lixo)).toBe(AVATAR_PADRAO);
  });
});

describe("memória local da última escolha", () => {
  it("lembra o que foi escolhido", () => {
    comArmazenamento();
    lembrarAvatar("sapo");
    expect(avatarLembrado()).toBe("sapo");
  });

  it("sem nada guardado, começa no padrão", () => {
    comArmazenamento();
    expect(avatarLembrado()).toBe(AVATAR_PADRAO);
  });

  it("valor adulterado à mão no navegador NÃO vira avatar", () => {
    comArmazenamento({ "king:avatar": "tigre-que-foi-removido" });
    expect(avatarLembrado()).toBe(AVATAR_PADRAO);
  });

  it("sem armazenamento nenhum (aba anônima travada) não explode: só não lembra", () => {
    expect(() => lembrarAvatar("panda")).not.toThrow();
    expect(avatarLembrado()).toBe(AVATAR_PADRAO);
  });
});
