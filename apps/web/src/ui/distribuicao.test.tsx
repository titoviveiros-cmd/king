/**
 * COSMÉTICOS DA MESA — distribuição do leque e pouso da carta na vaza.
 *
 * O que estes testes travam é o CONTRATO de que tudo isto é só pintura:
 * - quando anima (só uma distribuição nova, de 13 cartas, e uma vez por conjunto);
 * - que receber o K de Copas não muda nada na encenação (azar é capturá-lo, ver kCopasCaptura);
 * - e que o CSS nunca move carta do leque (os testes de layout medem o leque no instante em que
 *   as 13 cartas aparecem).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Card } from "@king/engine";
import { TEMPOS } from "../game/timings.js";
import { assinaturaDaDistribuicao, encenacaoDaDistribuicao } from "./distribuicao.js";

const c = (rank: string, suit: string) => ({ rank, suit }) as Card;
const SEM_K: Card[] = [
  c("A", "spades"), c("K", "spades"), c("Q", "spades"), c("J", "spades"),
  c("A", "hearts"), c("Q", "hearts"), c("J", "hearts"), c("10", "hearts"),
  c("A", "clubs"), c("K", "clubs"), c("A", "diamonds"), c("K", "diamonds"), c("Q", "diamonds"),
];
const COM_K: Card[] = SEM_K.map((x) => (x.rank === "Q" && x.suit === "hearts" ? c("K", "hearts") : x));

describe("quando a distribuição anima", () => {
  it("só com o leque inteiro: 13 cartas", () => {
    expect(assinaturaDaDistribuicao(SEM_K)).not.toBe("");
    expect(assinaturaDaDistribuicao(SEM_K.slice(1))).toBe("");
    expect(assinaturaDaDistribuicao([])).toBe("");
    expect(encenacaoDaDistribuicao(SEM_K.slice(1), "")).toBeNull();
  });

  it("uma vez por conjunto de cartas: o mesmo leque não anima de novo", () => {
    const ja = assinaturaDaDistribuicao(COM_K);
    expect(encenacaoDaDistribuicao(COM_K, "")).not.toBeNull();
    expect(encenacaoDaDistribuicao(COM_K, ja)).toBeNull();
    // uma mão nova (outras cartas) anima, mesmo que a anterior tenha sido animada
    expect(encenacaoDaDistribuicao(SEM_K, ja)).not.toBeNull();
  });

  it("receber o K de Copas não acrescenta nada: a encenação é a mesma de uma mão sem ele", () => {
    const esperado = [
      { t: 0, distribuindo: true },
      { t: TEMPOS.distribuicaoDoLeque, distribuindo: false },
    ];
    expect(encenacaoDaDistribuicao(SEM_K, "")).toEqual(esperado);
    expect(encenacaoDaDistribuicao(COM_K, "")).toEqual(esperado);
    expect(TEMPOS.distribuicaoDoLeque).toBeLessThan(1000);
  });
});

describe("o CSS é só pintura", () => {
  // CRLF → LF: o checkout no Windows troca as quebras de linha, o CI não.
  const css = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const keyframes = (nome: string) => {
    const i = css.indexOf(`@keyframes ${nome}{`);
    expect(i, `@keyframes ${nome}`).toBeGreaterThan(-1);
    let n = 0, j = i;
    for (; j < css.length; j++) { if (css[j] === "{") n++; else if (css[j] === "}" && --n === 0) break; }
    return css.slice(i, j + 1);
  };

  it("a distribuição do leque mexe só na opacidade", () => {
    const k = keyframes("lequeAcende");
    expect(k).toMatch(/opacity/);
    expect(k).not.toMatch(/transform|translate|scale|rotate|top|left|bottom|width|height/);
  });

  it("o aviso do K na MÃO não existe mais: nenhuma regra de leque com kalerta/véu/rótulo", () => {
    expect(css).not.toMatch(/kalerta|kcopas-veu|kcopas-rotulo/);
  });

  it("com movimento reduzido nada acende em cascata nem pousa", () => {
    const bloco = css.slice(css.indexOf("@media (prefers-reduced-motion:reduce){\n  .hand.distribuindo"));
    expect(bloco).toMatch(/\.hand\.distribuindo \.card,\.trick \.slot \.card\{animation:none;\}/);
  });

  it("as durações do CSS batem com TEMPOS", () => {
    // 12 cartas × 35ms de atraso + 280ms da última = 700ms
    expect(css).toMatch(/lequeAcende \.28s[^;]*;animation-delay:calc\(var\(--i\) \* 35ms\)/);
    expect(12 * 35 + 280).toBe(TEMPOS.distribuicaoDoLeque);
  });
});
