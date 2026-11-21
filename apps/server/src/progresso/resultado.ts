// DO FIM DA PARTIDA AO RESULTADO QUE O BANCO RECEBE.
//
// Puro: não conhece sala, socket nem banco. Recebe o que a sala sabia no instante em que o motor
// declarou a partida encerrada e devolve o resultado do crédito — ou `null`, quando não há de quem
// gravar.
import { PONTOS_MAX, PONTOS_MIN, REGRA_ATUAL, type Posicao, type ResultadoDaPartida } from "./tipos.js";

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
  /** RECORDES (Entrega D): a pontuação final de cada assento, do motor (`MatchState.cumulative`). */
  pontos?: Record<number, number>;
  /**
   * PENALIDADE DO REI (Entrega C): o ASSENTO que capturou o K♥ na mão 5, do histórico do motor
   * (`capturadorDoRei`). `null`/ausente = fato não estabelecido → o crédito vai pela regra 1.
   */
  capturouRei?: number | null;
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
const pontosValidos = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= PONTOS_MIN && (x as number) <= PONTOS_MAX;

/** O fato da captura só vale se for um assento de verdade (0..3). Qualquer outra coisa = sem fato. */
const assentoValido = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 3;

export function resultadoParaCredito(p: PartidaEncerrada): ResultadoDaPartida | null {
  const humanos = p.assentos.filter((a) => !a.bot);
  if (humanos.length < 2) return null;
  if (humanos.some((a) => !a.permanente)) return null;
  // PENALIDADE DO REI (Entrega C): com o fato, regra 2 e `capturouRei` em TODOS os humanos (o assento
  // de um bot capturador não marca ninguém). Sem o fato, o resultado sai IGUAL ao de antes — regra 1.
  const regra2 = assentoValido(p.capturouRei);
  return {
    partidaId: p.partidaId,
    iniciadaEm: p.iniciadaEm.toISOString(),
    terminadaEm: p.terminadaEm.toISOString(),
    bots: p.assentos.length - humanos.length,
    humanos: humanos.map((a) => ({
      playerId: a.playerId,
      posicao: p.posicoes[a.seat],
      participou: participou(a),
      // A pontuação final vai SÓ de quem participou de verdade: é ela que vira recorde no banco.
      ...(participou(a) && pontosValidos(p.pontos?.[a.seat]) ? { pontos: p.pontos![a.seat] } : {}),
      ...(regra2 ? { capturouRei: a.seat === p.capturouRei } : {}),
    })),
    ...(regra2 ? { regra: REGRA_ATUAL } : {}),
  };
}
