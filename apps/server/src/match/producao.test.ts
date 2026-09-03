// OS PRAZOS QUE VÃO PARA PRODUÇÃO — conferidos sem esperar 25 segundos.
//
// ══ POR QUE ESTE ARQUIVO EXISTE ══
//
// A suíte inteira roda com prazos reduzidos: 20s em vez de 25s, cortesia de bot de 200ms em vez
// de 900ms, piso do Placar de 1ms em vez de 8s. Sem isso cada caso custaria dezenas de segundos
// reais e a regressão deixaria de ser rodável.
//
// O preço disso é um risco concreto: um número de instrumentação escapar para produção. Já houve
// um ensaio desse acidente nesta mesma rodada — um teste chamou `restaurarTempos()` no meio da
// suíte e devolveu TODOS os prazos aos de produção, fazendo o teste seguinte medir um prazo que
// ele não tinha configurado e passar até com o defeito reintroduzido. O caminho inverso (um valor
// de teste indo parar no ar) seria pior, e silencioso.
//
// ══ POR QUE ESTE PORTÃO É DETERMINÍSTICO ══
//
// Ele não mede tempo: confere os VALORES CONGELADOS e prova que nenhum caminho de produção
// consegue trocá-los. Roda em milissegundos e falha por igualdade, não por relógio.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { TEMPOS_PADRAO } from "./tempos.js";

describe("os prazos congelados são os de produção", () => {
  /**
   * O prazo de uma jogada humana. É o número que o jogador vê no chip do relógio, e o mesmo
   * contra o qual o respiro da leitura da vaza é medido.
   */
  it("o prazo do turno é 25.000ms", () => {
    expect(TEMPOS_PADRAO.turno).toBe(25_000);
  });

  it("os demais prazos de decisão continuam nos valores da Fase 7A", () => {
    expect(TEMPOS_PADRAO.primeiraJogadaExtra).toBe(15_000);
    expect(TEMPOS_PADRAO.trunfo).toBe(45_000);
    expect(TEMPOS_PADRAO.aviso).toBe(10_000);
    expect(TEMPOS_PADRAO.critico).toBe(5_000);
    expect(TEMPOS_PADRAO.pisoDoPlacar).toBe(8_000);
    expect(TEMPOS_PADRAO.cortesiaDoBot).toBe(900);
  });

  /**
   * Os tempos de apresentação que o servidor conhece para NÃO cobrar do jogador. Não são prazos:
   * são a cópia autoritativa do que o cliente faz. O contrato com o cliente é conferido em
   * `rooms/prazoIntegral.test.ts`; aqui só se trava que não viraram valores de instrumentação.
   */
  it("os tempos de apresentação são os de produção, não os de teste", () => {
    expect(TEMPOS_PADRAO.leituraDaVaza).toBe(1_150);
    expect(TEMPOS_PADRAO.leituraDaVazaCastigo).toBe(2_700);
    expect(TEMPOS_PADRAO.leituraDaVazaKing).toBe(3_400);
    expect(TEMPOS_PADRAO.fimDeMao).toBe(1_800);
    expect(TEMPOS_PADRAO.passoDaApresentacao).toBe(520);
  });

  it("a tabela congelada é imutável de verdade — não só por convenção", () => {
    expect(Object.isFrozen(TEMPOS_PADRAO)).toBe(true);
    expect(() => {
      (TEMPOS_PADRAO as unknown as { turno: number }).turno = 1;
    }).toThrow();
  });
});

/**
 * NENHUM CAMINHO DE PRODUÇÃO TROCA OS PRAZOS.
 *
 * A garantia acima vale pouco se algum arquivo de produção chamar `configurarTempos`. Este teste
 * varre o código-fonte do servidor e reprova se a função aparecer fora de um teste — o que é
 * mais forte que confiar no comentário que diz "nunca é chamado em produção".
 */
describe("configurarTempos só existe para teste", () => {
  const RAIZ = fileURLToPath(new URL("..", import.meta.url));

  function arquivosDeProducao(dir: string, achados: string[] = []): string[] {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) { arquivosDeProducao(caminho, achados); continue; }
      if (!nome.endsWith(".ts") || nome.endsWith(".test.ts")) continue;
      achados.push(caminho);
    }
    return achados;
  }

  it("nenhum arquivo de produção do servidor a chama", () => {
    const culpados = arquivosDeProducao(RAIZ).filter((f) => {
      // A própria definição não conta: é onde a função mora.
      if (f.endsWith(join("match", "tempos.ts"))) return false;
      return /\bconfigurarTempos\s*\(/.test(readFileSync(f, "utf8"));
    });
    expect(
      culpados,
      `prazo de teste pode vazar para produção por: ${culpados.join(", ")}`,
    ).toEqual([]);
  });

  it("a varredura realmente leu arquivos — senão a lista vazia não prova nada", () => {
    expect(arquivosDeProducao(RAIZ).length).toBeGreaterThan(5);
  });
});
