/**
 * COSMÉTICOS DA MESA — distribuição do leque e pouso da carta na vaza.
 *
 * O que estes testes travam é o CONTRATO de que tudo isto é só pintura:
 * - quando anima (só uma distribuição nova, de 13 cartas, e uma vez por conjunto);
 * - que receber o K de Copas não muda nada na encenação (azar é capturá-lo, ver kCopasCaptura);
 * - e que o movimento é transitório: só `translate`/`scale`, terminando na identidade, para que a
 *   geometria FINAL do leque e da vaza seja a de sempre (é ela que os testes de layout medem).
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
    // pedido do dono: distribuição perceptível, entre 0,8 e 1,1 s
    expect(TEMPOS.distribuicaoDoLeque).toBeGreaterThanOrEqual(800);
    expect(TEMPOS.distribuicaoDoLeque).toBeLessThanOrEqual(1100);
  });
});

describe("o CSS: movimento transitório, geometria final intacta", () => {
  // CRLF → LF: o checkout no Windows troca as quebras de linha, o CI não.
  const css = readFileSync(fileURLToPath(new URL("./theme.css", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const keyframes = (nome: string) => {
    const i = css.indexOf(`@keyframes ${nome}{`);
    expect(i, `@keyframes ${nome}`).toBeGreaterThan(-1);
    let n = 0, j = i;
    for (; j < css.length; j++) { if (css[j] === "{") n++; else if (css[j] === "}" && --n === 0) break; }
    return css.slice(i, j + 1);
  };

  // A posição FINAL da carta é a do leque/da vaza: o movimento só pode usar as propriedades
  // individuais (`translate`/`scale`), que se SOMAM ao `transform` do arco/slot, e precisa acabar
  // na identidade. Um `transform` aqui apagaria a rotação do leque durante a animação.
  const terminaNaIdentidade = (k: string) => {
    expect(k).not.toMatch(/transform|rotate|top:|left:|bottom:|width|height/);
    const fim = k.slice(k.lastIndexOf("100%{"));
    expect(fim).toMatch(/translate:0 0;/);
    expect(fim).toMatch(/scale:1;/);
    expect(fim).toMatch(/opacity:1;/);
  };

  it("a distribuição é um gesto: as cartas saem do meio da mesa e assentam no lugar de sempre", () => {
    const k = keyframes("lequeEntra");
    expect(k).toMatch(/0%\{opacity:0;[^}]*translate:calc\(\(\(var\(--n\) - 1\) \/ 2 - var\(--i\)\) \* var\(--step\)/);
    terminaNaIdentidade(k);
    // `backwards`: nada fica preso na carta depois que ela chega
    expect(css).toMatch(/\.hand\.distribuindo \.card\{animation:lequeEntra [^;]* backwards;/);
  });

  it("o pouso na vaza vem do lado de quem jogou, bate e assenta, sem se repetir", () => {
    const k = keyframes("pousaNaVaza");
    expect(k).toMatch(/0%\{[^}]*translate:var\(--entra/);
    expect(k).toMatch(/scale:\.9\d+/); // a batida: encolhe um fio antes de assentar
    expect(k).toMatch(/box-shadow/);
    terminaNaIdentidade(k);
    expect(css).toMatch(/\.trick \.slot \.card\{animation:pousaNaVaza \.26s [^;]* backwards;\}/);
    // a carta do topo nunca sobe na direção do selo: entra sem deslocamento e cresce para baixo
    expect(css).toMatch(/\.trick \.slot\.t\{--entra:0 0;\}/);
    expect(css).toMatch(/\.trick \.slot\.t \.card\{transform-origin:50% 0;\}/);
  });

  it("o aviso do K na MÃO não existe mais: nenhuma regra de leque com kalerta/véu/rótulo", () => {
    expect(css).not.toMatch(/kalerta|kcopas-veu|kcopas-rotulo/);
  });

  it("com movimento reduzido nada acende em cascata nem pousa", () => {
    const bloco = css.slice(css.indexOf("@media (prefers-reduced-motion:reduce){\n  .hand.distribuindo"));
    expect(bloco).toMatch(/\.hand\.distribuindo \.card,\.trick \.slot \.card\{animation:none;\}/);
  });

  it("as durações do CSS batem com TEMPOS", () => {
    // 12 cartas × 55ms de atraso + 360ms da última = 1020ms
    expect(css).toMatch(/lequeEntra \.36s[^;]*;\n  animation-delay:calc\(var\(--i\) \* 55ms\)/);
    expect(12 * 55 + 360).toBe(TEMPOS.distribuicaoDoLeque);
    expect(TEMPOS.pousoNaVaza).toBe(260);
    expect(TEMPOS.pousoNaVaza).toBeGreaterThanOrEqual(220);
    expect(TEMPOS.pousoNaVaza).toBeLessThanOrEqual(300);
  });
});
