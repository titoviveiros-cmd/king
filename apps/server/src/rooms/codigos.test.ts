/**
 * CÓDIGO DA SALA — 4 dígitos, string do começo ao fim.
 *
 * O defeito que estes testes existem para impedir é sempre o mesmo: alguém tratar o código como
 * NÚMERO em algum ponto da cadeia. `0315` vira `315`, o jogador digita o que está na tela do
 * amigo e recebe "sala não encontrada" — um bug que só aparece em 1 de cada 10 salas e que é
 * quase impossível de reproduzir sem saber o que procurar.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  ALFABETO, ESPACO_DE_CODIGOS, TAMANHO_CODIGO,
  codigoOcupado, codigoValido, gerarCodigo, liberarCodigo, normalizarCodigo, reservarCodigo, totalEmUso,
} from "./codigos.js";

/** O pool é estado de módulo: cada teste limpa o que reservou. */
const reservados: string[] = [];
afterEach(() => {
  for (const c of reservados.splice(0)) liberarCodigo(c);
});
function reservar(rnd?: () => number): string {
  const c = reservarCodigo(rnd);
  reservados.push(c);
  return c;
}

/** Gerador determinístico: devolve os valores pedidos, em ordem, ciclicamente. */
function rndFixo(...valores: number[]): () => number {
  let i = 0;
  return () => valores[i++ % valores.length];
}

describe("formato do código", () => {
  it("o alfabeto é só dígito e o tamanho é 4", () => {
    expect(ALFABETO).toBe("0123456789");
    expect(TAMANHO_CODIGO).toBe(4);
    expect(ESPACO_DE_CODIGOS).toBe(10_000);
  });

  it("gera SEMPRE 4 dígitos, em mil tentativas", () => {
    for (let i = 0; i < 1000; i++) {
      const c = gerarCodigo();
      expect(c).toMatch(/^\d{4}$/);
      expect(c).toHaveLength(4);
    }
  });

  it("gera o código com zeros à esquerda quando o sorteio pede", () => {
    // rnd sempre 0 → primeiro símbolo do alfabeto → "0000"
    expect(gerarCodigo(() => 0)).toBe("0000");
    // 0, 0, 0, 0.15 → "0001"
    expect(gerarCodigo(rndFixo(0, 0, 0, 0.15))).toBe("0001");
    // 0, 0.35, 0.15, 0.55 → "0315"
    expect(gerarCodigo(rndFixo(0, 0.35, 0.15, 0.55))).toBe("0315");
    // 0.99 em todos → "9999"
    expect(gerarCodigo(() => 0.99)).toBe("9999");
  });
});

describe("codigoValido", () => {
  it("aceita os quatro casos-limite de zero e nove", () => {
    for (const c of ["0000", "0001", "0315", "9999", "1234", "0007"]) {
      expect(codigoValido(c), c).toBe(true);
    }
  });

  it("rejeita letras", () => {
    for (const c of ["ABCD", "A123", "123A", "0O15", "abcd"]) {
      expect(codigoValido(c), c).toBe(false);
    }
  });

  it("rejeita 3 dígitos", () => {
    expect(codigoValido("315")).toBe(false);
    expect(codigoValido("000")).toBe(false);
  });

  it("rejeita 5 dígitos", () => {
    expect(codigoValido("03150")).toBe(false);
    expect(codigoValido("12345")).toBe(false);
  });

  it("rejeita caracteres especiais, espaços e vazio", () => {
    for (const c of ["03-5", "03 5", "0 15", "", "  ", "03.5", "+315", "０３１５"]) {
      expect(codigoValido(c), JSON.stringify(c)).toBe(false);
    }
  });

  it("rejeita o que não é string", () => {
    for (const v of [null, undefined, 315, 315.0, {}, []]) {
      expect(codigoValido(v as unknown as string), String(v)).toBe(false);
    }
  });
});

describe("normalizarCodigo", () => {
  it("descarta separadores e mantém os dígitos NA ORDEM", () => {
    expect(normalizarCodigo("0315")).toBe("0315");
    expect(normalizarCodigo("03 15")).toBe("0315");
    expect(normalizarCodigo("0-3-1-5")).toBe("0315");
    expect(normalizarCodigo(" 0315 ")).toBe("0315");
    expect(normalizarCodigo("#0315!")).toBe("0315");
  });

  it("PRESERVA o zero à esquerda — o defeito que este arquivo existe para impedir", () => {
    expect(normalizarCodigo("0315")).toBe("0315");
    expect(normalizarCodigo("0001")).toBe("0001");
    expect(normalizarCodigo("0000")).toBe("0000");
    // e o que aconteceria se alguém convertesse para número, para deixar o contraste explícito:
    expect(String(Number("0315"))).toBe("315");
    expect(normalizarCodigo("0315")).not.toBe(String(Number("0315")));
  });

  it("descarta letras em vez de traduzi-las", () => {
    expect(normalizarCodigo("O315")).toBe("315");   // vira inválido por tamanho, e é o certo
    expect(codigoValido(normalizarCodigo("O315"))).toBe(false);
  });

  it("aguenta entrada nula sem quebrar", () => {
    expect(normalizarCodigo(null as unknown as string)).toBe("");
    expect(normalizarCodigo(undefined as unknown as string)).toBe("");
  });
});

describe("reserva e colisão", () => {
  it("reserva um código válido e o marca como ocupado", () => {
    const c = reservar();
    expect(codigoValido(c)).toBe(true);
    expect(codigoOcupado(c)).toBe(true);
  });

  it("em colisão com sala ATIVA, gera outro código", () => {
    // o primeiro sorteio produz "0000"; o segundo, "0001"
    const primeiro = reservar(() => 0);
    expect(primeiro).toBe("0000");

    // agora um gerador que insiste em "0000" nas duas primeiras vezes e depois muda
    let n = 0;
    const teimoso = () => {
      n++;
      // as 4 primeiras chamadas formam "0000" (colide); as 4 seguintes formam "0001"
      return n <= 4 ? 0 : (n === 8 ? 0.15 : 0);
    };
    const segundo = reservar(teimoso);
    expect(segundo).not.toBe(primeiro);
    expect(codigoValido(segundo)).toBe(true);
    expect(codigoOcupado(primeiro)).toBe(true);
  });

  it("liberar devolve o código ao pool", () => {
    const c = reservarCodigo(() => 0);
    expect(codigoOcupado(c)).toBe(true);
    liberarCodigo(c);
    expect(codigoOcupado(c)).toBe(false);
    // e agora ele pode ser reservado de novo
    const denovo = reservar(() => 0);
    expect(denovo).toBe(c);
  });

  it("desiste depois do limite de tentativas em vez de travar", () => {
    const ocupado = reservar(() => 0); // "0000"
    expect(ocupado).toBe("0000");
    // um gerador que SÓ sabe produzir "0000" nunca acha vaga
    expect(() => reservarCodigo(() => 0, 5)).toThrow(/código de sala livre/);
  });

  it("mil reservas seguidas não repetem código", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const c = reservar();
      expect(vistos.has(c), `código repetido: ${c}`).toBe(false);
      vistos.add(c);
    }
    expect(totalEmUso()).toBeGreaterThanOrEqual(1000);
  });
});
