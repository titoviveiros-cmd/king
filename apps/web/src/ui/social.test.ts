// AS FRASES — conteúdo e curadoria.
//
// Testar texto parece bobagem até a primeira vez que alguém acrescenta uma frase agressiva "só
// de brincadeira". A lista é conteúdo de produto e tem régua: provocação sim, ataque não.
import { describe, expect, it } from "vitest";
import { MENSAGENS, ROTULO_DA_CATEGORIA, atalhosDe, fraseDe, porCategoria } from "./social.js";

describe("a lista", () => {
  it("toda frase tem etiqueta em kebab-case, texto e categoria", () => {
    for (const m of MENSAGENS) {
      expect(m.id, m.texto).toMatch(/^[a-z-]+$/);
      expect(m.texto.trim().length).toBeGreaterThan(0);
      expect(ROTULO_DA_CATEGORIA[m.categoria]).toBeTruthy();
    }
  });

  it("não há etiqueta nem frase repetida", () => {
    expect(new Set(MENSAGENS.map((m) => m.id)).size).toBe(MENSAGENS.length);
    expect(new Set(MENSAGENS.map((m) => m.texto)).size).toBe(MENSAGENS.length);
  });

  it("é curta de ler: nenhuma frase vira parágrafo dentro de um balão", () => {
    for (const m of MENSAGENS) expect(m.texto.length, m.texto).toBeLessThanOrEqual(26);
  });

  it("nenhuma frase ataca a pessoa, acusa de trapaça ou humilha", () => {
    // A régua é grosseira de propósito: pega o óbvio e obriga a pensar antes de acrescentar.
    const proibido = /burr|idiot|otári|lixo|trapac|roub|cola|fraude|perdedor|noob|merd|porcari/i;
    for (const m of MENSAGENS) expect(m.texto, m.id).not.toMatch(proibido);
  });

  it("existe pelo menos uma frase de cortesia — a mesa também precisa combinar coisas", () => {
    expect(MENSAGENS.some((m) => m.categoria === "cortesia")).toBe(true);
  });
});

describe("busca", () => {
  it("acha pela etiqueta", () => {
    expect(fraseDe("boa")?.texto).toBe("Boa!");
  });

  it("etiqueta desconhecida devolve null — a tela ignora em vez de desenhar balão vazio", () => {
    for (const lixo of ["", "nao-existe", undefined]) expect(fraseDe(lixo)).toBeNull();
  });
});

describe("atalhos", () => {
  it("são seis, e todos existem na lista", () => {
    for (const status of ["playing", "finished"] as const) {
      const a = atalhosDe(status);
      expect(a, status).toHaveLength(6);
      for (const f of a) expect(MENSAGENS).toContain(f);
    }
  });

  it("mudam com o momento: no fim da partida aparece 'Revanche?'", () => {
    const emJogo = atalhosDe("playing").map((f) => f.id);
    const noFim = atalhosDe("finished").map((f) => f.id);
    expect(noFim).toContain("revanche");
    expect(emJogo).not.toContain("revanche");
    // e em jogo aparece o que serve durante a mão
    expect(emJogo).toContain("ja-volto");
  });

  it("não repetem dentro do mesmo conjunto", () => {
    for (const status of ["playing", "finished"] as const) {
      const ids = atalhosDe(status).map((f) => f.id);
      expect(new Set(ids).size, status).toBe(ids.length);
    }
  });
});

describe("painel expandido", () => {
  it("mostra TODAS as frases, sem perder nem duplicar nenhuma", () => {
    const todas = porCategoria().flatMap((g) => g.frases);
    expect(todas).toHaveLength(MENSAGENS.length);
    expect(new Set(todas.map((f) => f.id)).size).toBe(MENSAGENS.length);
  });

  it("nenhum grupo vem vazio", () => {
    for (const g of porCategoria()) expect(g.frases.length, g.categoria).toBeGreaterThan(0);
  });
});

/**
 * O PLACAR ENTRE-MÃOS FALA A MESMA LÍNGUA.
 *
 * O risco de dar acesso social a uma segunda tela é criar um segundo sistema social: outro
 * catálogo, outra validação, outro cooldown, e a divergência silenciosa na primeira mudança.
 * Estes testes cobram o contrário: o intervalo usa frases DIFERENTES, mas todas do mesmo catálogo
 * fechado que o servidor já valida.
 */
describe("mensagens do placar entre-mãos", () => {
  it("os atalhos do intervalo saem do MESMO catálogo, sem frase inventada", () => {
    for (const f of atalhosDe("placar")) {
      expect(MENSAGENS.map((m) => m.id), `${f.id} não existe no catálogo`).toContain(f.id);
      expect(fraseDe(f.id)).not.toBeNull();
    }
  });

  it("são seis, como nos outros momentos: ler lista longa custa a vez de alguém", () => {
    expect(atalhosDe("placar")).toHaveLength(6);
  });

  it("o intervalo tem atalhos PRÓPRIOS — não é a lista da mesa repetida", () => {
    const noJogo = atalhosDe("playing").map((f) => f.id);
    const noPlacar = atalhosDe("placar").map((f) => f.id);
    expect(noPlacar).not.toEqual(noJogo);
    // e são contextuais: no intervalo se comenta o resultado da mão, não a jogada que passou
    expect(noPlacar).toContain("achou-o-rei");
    expect(noPlacar).not.toContain("ja-volto");
  });

  it("os três momentos existem e nenhum devolve lista vazia", () => {
    for (const m of ["playing", "placar", "finished"] as const) {
      expect(atalhosDe(m).length, m).toBeGreaterThan(0);
    }
  });
});
