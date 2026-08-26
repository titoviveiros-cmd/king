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
      ["leao", "coruja", "raposa", "macaco", "panda", "tucano", "unicornio", "sapo"],
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
    // tucano não existe em Unicode: fica com o substituto mais próximo, marcado como tal.
    expect(desenhoDoAvatar("tucano").aproximado).toBe(true);
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

/**
 * A TROCA DO MACACO PELO UNICÓRNIO, sem deixar ninguém para trás.
 *
 * Trocar uma etiqueta de conjunto fechado tem um custo escondido: quem já escolheu a antiga tem
 * ela guardada no aparelho. Descartar em silêncio joga a pessoa no padrão sem explicação, e ela
 * reabre o jogo achando que perdeu a escolha.
 */
describe("a coleção final: oito, com o Macaco e o Unicórnio", () => {
  /**
   * TRIPWIRE. A coleção é fechada em OITO, e o número não pode mudar em silêncio: cada avatar a
   * mais é arte a mais no brief, uma linha a mais no seletor e um caso a mais no servidor.
   */
  it("são exatamente oito, na ordem oficial", () => {
    expect(AVATARES).toEqual(
      ["leao", "coruja", "raposa", "macaco", "panda", "tucano", "unicornio", "sapo"],
    );
    expect(AVATARES).toHaveLength(8);
  });

  it("os IDs são únicos, e os rótulos também", () => {
    expect(new Set(AVATARES).size).toBe(AVATARES.length);
    const rotulos = AVATARES.map((id) => desenhoDoAvatar(id).rotulo);
    expect(new Set(rotulos).size).toBe(rotulos.length);
  });

  it("o MACACO está na coleção — ele nunca foi o problema", () => {
    expect(AVATARES as readonly string[]).toContain("macaco");
    expect(desenhoDoAvatar("macaco").rotulo).toBe("Macaco");
  });

  it("o UNICÓRNIO entrou, com desenho, rótulo e persona como os outros sete", () => {
    const d = desenhoDoAvatar("unicornio");
    expect(AVATARES as readonly string[]).toContain("unicornio");
    expect(d.rotulo).toBe("Unicórnio");
    expect(d.glifo.length).toBeGreaterThan(0);
    expect(d.persona.length).toBeGreaterThan(0);
    // Tem glifo próprio no Unicode: não é aproximação, e por isso não se confunde com ninguém.
    expect(d.aproximado).toBeUndefined();
  });

  it("o SAPO continua no fim, e quem está à esquerda dele agora é o Unicórnio", () => {
    expect(AVATARES[AVATARES.length - 1]).toBe("sapo");
    expect(AVATARES[AVATARES.length - 2]).toBe("unicornio");
  });

  it("a CAPIVARA saiu da coleção visível", () => {
    // Era ela quem ocupava o lugar à esquerda do Sapo, com 🦫 (castor) por não ter emoji próprio.
    // Ao lado do 🐵 do macaco, o placeholder criava dois primatas pequenos na mesma fileira.
    expect(AVATARES as readonly string[]).not.toContain("capivara");
  });
});

describe("migração das etiquetas aposentadas", () => {
  it("quem tinha a CAPIVARA reencontra o Unicórnio", () => {
    expect(avatarValido("capivara")).toBe("unicornio");
  });

  it("o apelido `mico` também cai no Unicórnio", () => {
    expect(avatarValido("mico")).toBe("unicornio");
  });

  it("MACACO CONTINUA MACACO — nunca vira Unicórnio", () => {
    // É a asserção central desta rodada: a versão anterior migrava o macaco por engano.
    expect(avatarValido("macaco")).toBe("macaco");
    expect(avatarValido("macaco")).not.toBe("unicornio");
  });

  it("todo avatar da coleção é devolvido intacto, sem passar pelo mapa de aposentados", () => {
    for (const id of AVATARES) expect(avatarValido(id)).toBe(id);
  });

  it("etiqueta que nunca existiu continua caindo no padrão", () => {
    expect(avatarValido("dragao")).toBe(AVATAR_PADRAO);
    expect(avatarValido(42)).toBe(AVATAR_PADRAO);
    expect(avatarValido(undefined)).toBe(AVATAR_PADRAO);
  });

  it("persistência antiga não quebra a leitura, seja qual for o valor guardado", () => {
    for (const guardado of ["capivara", "mico", "macaco", "lixo", ""]) {
      comArmazenamento({ "king:avatar": guardado });
      expect(AVATARES as readonly string[], `guardado: "${guardado}"`).toContain(avatarLembrado());
    }
  });
});
