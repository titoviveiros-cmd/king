// Vetores do Placar Final, todos indexados por ASSENTO (0..3).
//
// Aqui morou um bug que chegou à tela: `rankings()` devolve as linhas **ordenadas por posição**,
// então `finais.map(r => r.score)` produz um vetor indexado por RANKING, não por assento.
// Misturado com o vetor de saldos anteriores (indexado por assento), isso trocava a pontuação
// entre jogadores — o 2º colocado exibia o número do 3º e vice-versa.
// Regra desta camada: **nada sai daqui indexado por posição.**
import type { RankRow } from "@king/engine";

const VAZIO = () => [0, 0, 0, 0];

/** Saldo FINAL de cada assento. */
export function scoresPorAssento(rows: RankRow[]): number[] {
  const v = VAZIO();
  for (const r of rows) v[r.seat] = r.score;
  return v;
}

/**
 * Saldo de cada assento ANTES da última mão — ponto de partida da contagem animada.
 * `deltas` é o resultado da última mão, já indexado por assento (vem de `handSummary.scores`).
 */
export function saldosAntes(rows: RankRow[], deltas?: number[]): number[] {
  const v = VAZIO();
  for (const r of rows) v[r.seat] = r.score - (deltas ? deltas[r.seat] : 0);
  return v;
}

/** Interpola os saldos de `de` até `ate` (ambos por assento) na fração `k` (0..1). */
export function interpolar(de: number[], ate: number[], k: number): number[] {
  return de.map((d, seat) => Math.round(d + (ate[seat] - d) * k));
}
