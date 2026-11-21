// A CLASSIFICAÇÃO DE UMA MESA DO TORNEIO — e o desempate, que é só do torneio.
//
// O motor tem o ranking OFICIAL da partida, e nele empate é empate: dois jogadores com a mesma
// pontuação dividem a posição (ver `rankings` em @king/engine). Isso não muda. Mas o torneio
// precisa de exatamente dois classificados por mesa, então ele precisa de uma ordem total — e
// essa ordem é decidida AQUI, por uma cadeia fixa, sem tocar no motor.
//
// A CADEIA, nesta ordem (o primeiro critério que separa decide):
//   1. PONTUAÇÃO TOTAL oficial da partida (maior primeiro).
//   2. MENOS PONTOS PERDIDOS NAS MÃOS NEGATIVAS — a soma das mãos 1–6, mais perto de zero primeiro.
//      Com o total igual, quem perdeu menos na parte defensiva fez menos dano a si mesmo.
//   3. MAIS MÃOS NEGATIVAS ILESAS — negativas em que o jogador não perdeu ponto nenhum.
//   4. SORTEIO DETERMINÍSTICO pela semente da mesa: cada participante recebe um número derivado
//      da semente da mesa e do id dele; o MENOR passa. Não é sorte de quem recarrega a página: a
//      mesma mesa sempre dá o mesmo número, e qualquer um pode refazer a conta.
//
// Os critérios 1–3 são fatos da partida que o próprio motor calcula (`cumulative`, `negatives`,
// `matchStats`). O torneio não reconta carta nenhuma.
import { derivar, USO } from "./sementes.js";

/** Os fatos de uma partida que o torneio usa, por ASSENTO (0..3). Todos vêm do motor. */
export interface FatosDaMesa {
  /** Pontuação total oficial (`cumulative`). */
  pontos: number[];
  /** Soma das mãos negativas (`negatives`, ≤ 0). */
  negativas: number[];
  /** Mãos negativas sem perder ponto (`matchStats().perSeat[i].cleanNegatives`). */
  ilesas: number[];
}

export type Criterio = "pontos" | "negativas" | "ilesas" | "sorteio";

/** Um desempate que aconteceu: quem ficou à frente de quem, e por qual critério. */
export interface Desempate {
  /** Ids dos participantes: `acima` ficou imediatamente à frente de `abaixo`. */
  acima: number;
  abaixo: number;
  criterio: Exclude<Criterio, "pontos">;
}

export interface Classificacao {
  /** Ids dos participantes, do 1º ao 4º. */
  ordem: number[];
  /** Cada par vizinho que empatou na pontuação total, e o critério que o separou. */
  desempates: Desempate[];
}

/** O número do sorteio de um participante numa mesa. Menor passa. Exposto para a tela mostrar. */
export const numeroDoSorteio = (sementeDaMesa: number, id: number): number =>
  derivar(sementeDaMesa, USO.desempate, id);

/**
 * Compara dois assentos pela cadeia. Negativo = `a` fica à frente. Devolve também o critério que
 * decidiu — é o que a tela de classificação mostra.
 */
function comparar(
  f: FatosDaMesa, ids: readonly number[], semente: number, a: number, b: number,
): { d: number; criterio: Criterio } {
  if (f.pontos[a] !== f.pontos[b]) return { d: f.pontos[b] - f.pontos[a], criterio: "pontos" };
  if (f.negativas[a] !== f.negativas[b]) return { d: f.negativas[b] - f.negativas[a], criterio: "negativas" };
  if (f.ilesas[a] !== f.ilesas[b]) return { d: f.ilesas[b] - f.ilesas[a], criterio: "ilesas" };
  const sa = numeroDoSorteio(semente, ids[a]);
  const sb = numeroDoSorteio(semente, ids[b]);
  // Dois ids diferentes com o mesmo número de 32 bits é possível em tese; o id desfaz, para a
  // ordem ser TOTAL e nunca depender da ordem de entrada.
  return { d: sa !== sb ? (sa < sb ? -1 : 1) : ids[a] - ids[b], criterio: "sorteio" };
}

/**
 * Classifica a mesa. `ids[i]` é o participante do assento i; os fatos são por assento.
 * Pura e determinística: mesma entrada, mesma ordem — em qualquer aparelho.
 */
export function classificar(ids: readonly number[], fatos: FatosDaMesa, sementeDaMesa: number): Classificacao {
  const assentos = ids.map((_, i) => i);
  assentos.sort((a, b) => comparar(fatos, ids, sementeDaMesa, a, b).d);
  const desempates: Desempate[] = [];
  for (let i = 0; i + 1 < assentos.length; i++) {
    const { criterio } = comparar(fatos, ids, sementeDaMesa, assentos[i], assentos[i + 1]);
    if (criterio !== "pontos") desempates.push({ acima: ids[assentos[i]], abaixo: ids[assentos[i + 1]], criterio });
  }
  return { ordem: assentos.map((s) => ids[s]), desempates };
}

/** Como cada critério é dito na tela. Uma frase curta que se lê sem animação nenhuma. */
export const TEXTO_DO_CRITERIO: Record<Exclude<Criterio, "pontos">, string> = {
  negativas: "perdeu menos nas mãos negativas",
  ilesas: "saiu ileso de mais mãos negativas",
  sorteio: "venceu o sorteio da mesa (semente)",
};

/** A cadeia inteira, para a tela de regras. */
export const CADEIA_DE_DESEMPATE: readonly string[] = [
  "Pontuação total da partida",
  "Menos pontos perdidos nas mãos negativas",
  "Mais mãos negativas sem perder ponto",
  "Sorteio determinístico pela semente da mesa",
];
