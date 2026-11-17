// A DISTRIBUIÇÃO DA MÃO NA TELA — as cartas do leque acendem uma a uma quando a mão é dada.
//
// Tudo aqui é PINTURA. Nada pausa a partida, nada atrasa jogada, nada muda o que é jogável: a
// Mesa continua lendo turno, cartas legais e cliques exatamente como antes, e este estado só
// acrescenta uma classe CSS ao leque por 700ms.
//
// Receber o K de Copas NÃO é castigo e não ganha efeito nenhum aqui: o azar da mão 5 é CAPTURAR
// a vaza com ele, e isso é anunciado pelo selo do castigo (ver `anuncio.ts` e o `.kcaptura` da Mesa).
//
// QUANDO É UMA DISTRIBUIÇÃO NOVA: quando o leque aparece com as 13 cartas e esse conjunto ainda
// não foi animado. A assinatura é o conjunto em si, e não o número da mão, porque:
// - uma revanche volta para a mão 1 com o mesmo componente montado, e as cartas são outras;
// - a mão 10 só mostra o leque DEPOIS do anúncio — antes dele a lista está vazia;
// - quem reconecta no meio da mão já jogou carta (12 ou menos): não é distribuição e não anima.
//
// NO MÁXIMO UMA VEZ POR MÃO: a última assinatura animada fica no módulo, não no componente, e
// por isso sobrevive a uma remontagem da Mesa no meio da mesma mão. Só volta a valer se a
// animação foi INTERROMPIDA antes de terminar (a remontagem a refaz uma vez, inteira).
import { useEffect, useState } from "react";
import type { Card } from "@king/engine";
import { TEMPOS } from "../game/timings.js";

/** Assinatura de uma distribuição: as 13 cartas na ordem do leque. Vazio = não é distribuição. */
export function assinaturaDaDistribuicao(mao: Card[]): string {
  return mao.length === 13 ? mao.map((c) => c.rank + c.suit).join(",") : "";
}

/** Um passo da encenação: em `t` ms depois de o leque aparecer, liga/desliga a distribuição. */
export type PassoDaDistribuicao = { t: number; distribuindo: boolean };

/**
 * A encenação inteira de uma distribuição, decidida de uma vez e sem relógio — o hook só a
 * executa. `null` = não há o que animar (não é distribuição nova).
 */
export function encenacaoDaDistribuicao(mao: Card[], ultimaAnimada: string): PassoDaDistribuicao[] | null {
  const assinatura = assinaturaDaDistribuicao(mao);
  if (!assinatura || assinatura === ultimaAnimada) return null;
  return [
    { t: 0, distribuindo: true },
    { t: TEMPOS.distribuicaoDoLeque, distribuindo: false },
  ];
}

let ultimaAnimada = "";

/** Só para testes: esquece a última distribuição animada. */
export function esquecerDistribuicaoAnimada(): void {
  ultimaAnimada = "";
}

export function useDistribuicaoDaMao(mao: Card[]): boolean {
  const assinatura = assinaturaDaDistribuicao(mao);
  const [distribuindo, setDistribuindo] = useState(false);

  useEffect(() => {
    const passos = encenacaoDaDistribuicao(mao, ultimaAnimada);
    if (!passos) return;
    ultimaAnimada = assinatura;
    const fim = Math.max(...passos.map((p) => p.t));
    let terminou = false;
    const aplicar = (p: PassoDaDistribuicao) => {
      setDistribuindo(p.distribuindo);
      if (p.t === fim) terminou = true;
    };
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const p of passos) {
      if (p.t === 0) aplicar(p);
      else timers.push(setTimeout(() => aplicar(p), p.t));
    }
    return () => {
      timers.forEach(clearTimeout);
      setDistribuindo(false);
      // Interrompida (primeira carta jogada no meio, Mesa desmontada): a mesma mão pode refazer
      // a animação UMA vez se o leque de 13 voltar inteiro. Terminada, nunca mais.
      if (!terminou && ultimaAnimada === assinatura) ultimaAnimada = "";
    };
    // A assinatura É a mão: as cartas só importam quando ela muda.
  }, [assinatura]);

  return distribuindo;
}
