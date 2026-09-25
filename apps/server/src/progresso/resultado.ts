// DO FIM DA PARTIDA AO RESULTADO QUE O BANCO RECEBE.
//
// Puro: não conhece sala, socket nem banco. Recebe o que a sala sabia no instante em que o motor
// declarou a partida encerrada e devolve o resultado do crédito — ou `null`, quando não há de quem
// gravar.
import type { Posicao, ResultadoDaPartida } from "./tipos.js";

/** Um assento, como estava no fim. Contadores são só de JOGADAS DE CARTA — trunfo não entra. */
export interface AssentoAoFim {
  seat: number;
  playerId: string;
  bot: boolean;
  /** O `playerId` veio de credencial verificada (sobrevive à sala) ou foi sorteado para ela? */
  permanente: boolean;
  conectado: boolean;
  jogadasTotais: number;
  /** Quantas dessas o PRÓPRIO humano fez. Assistência e estouro de prazo não contam. */
  jogadasProprias: number;
}

export interface PartidaEncerrada {
  partidaId: string;
  iniciadaEm: Date;
  terminadaEm: Date;
  assentos: AssentoAoFim[];
  /** Posição final por assento, do ranking do motor. Empate = mesma posição. */
  posicoes: Record<number, Posicao>;
}

/**
 * PARTICIPOU? Conectado no encerramento E com pelo menos 60% das próprias cartas.
 *
 * A conta é inteira — `próprias × 5 ≥ totais × 3` — porque 0,6 em ponto flutuante erraria a
 * borda: 3/5 é exatamente 60% e precisa passar, sem depender de arredondamento.
 */
export function participou(a: AssentoAoFim): boolean {
  if (!a.conectado || a.jogadasTotais <= 0) return false;
  return a.jogadasProprias * 5 >= a.jogadasTotais * 3;
}

/**
 * O resultado do crédito, ou `null` quando não há o que gravar.
 *
 * `null` quando algum humano tem identidade SORTEADA (servidor em legacy): o id dele morre com a
 * sala, e não existe `auth.users.id` para receber XP. Bots nunca entram — nem como entrada
 * ignorada: o banco recebe só humanos, e a contagem de bots vai à parte.
 */
export function resultadoParaCredito(p: PartidaEncerrada): ResultadoDaPartida | null {
  const humanos = p.assentos.filter((a) => !a.bot);
  if (humanos.length < 2) return null;
  if (humanos.some((a) => !a.permanente)) return null;
  return {
    partidaId: p.partidaId,
    iniciadaEm: p.iniciadaEm.toISOString(),
    terminadaEm: p.terminadaEm.toISOString(),
    bots: p.assentos.length - humanos.length,
    humanos: humanos.map((a) => ({
      playerId: a.playerId,
      posicao: p.posicoes[a.seat],
      participou: participou(a),
    })),
  };
}
