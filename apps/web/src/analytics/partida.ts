// PARTIDAS — começo e fim, nos dois modos, sem contar duas vezes.
//
// `match_started`  modo, humanos, bots
// `first_match_started`  UMA vez por instalação, junto do primeiro `match_started` que houver
// `match_finished` modo, posição (1..4), empate
//
// O id da partida online entra aqui SÓ para deduplicar: fica na memória local do aparelho e nunca
// vai em evento. Sem ele, um reload no meio da partida (a Mesa remonta e o servidor manda o estado
// de novo) ou no Placar Final (a tela remonta) contaria a mesma partida outra vez.
//
// No modo local não há id nem como remontar a mesma partida: recarregar a página perde a partida,
// e "Jogar novamente" é, corretamente, uma partida nova.
import { analytics, type Modo, type Payload } from "./analytics.js";
import { memoria as memoriaDoNavegador, type Memoria } from "./memoria.js";

export function anunciarInicioDePartida(
  p: { modo: Modo; humanos: number; bots: number; partidaId?: string },
  mem: Memoria = memoriaDoNavegador,
): void {
  try {
    if (p.partidaId && !mem.marcarPartida("inicios", p.partidaId)) return;
    analytics.track("match_started", { modo: p.modo, humanos: p.humanos, bots: p.bots });
    // A marca é gravada ANTES do evento sair: duas chamadas seguidas (clique duplo, StrictMode)
    // encontram a marca e não repetem.
    if (mem.ler().primeiraPartida !== true) {
      mem.atualizar((m) => ({ ...m, primeiraPartida: true }));
      analytics.track("first_match_started", { modo: p.modo });
    }
  } catch { /* medir nunca atrasa a partida */ }
}

export function anunciarFimDePartida(
  p: { modo: Modo; posicao?: number; empate: boolean; partidaId?: string },
  mem: Memoria = memoriaDoNavegador,
): void {
  try {
    if (p.partidaId && !mem.marcarPartida("fins", p.partidaId)) return;
    const payload: Payload = { modo: p.modo, empate: p.empate };
    if (p.posicao !== undefined) payload.posicao = p.posicao;
    analytics.track("match_finished", payload);
  } catch { /* idem */ }
}

/** Humanos e bots sentados, a partir dos assentos públicos da sala. Sem nome, sem id. */
export function contarAssentos(seats: readonly { playerId: string; bot: boolean }[] | undefined): { humanos: number; bots: number } {
  let humanos = 0;
  let bots = 0;
  for (const s of seats ?? []) {
    if (s.bot) bots++;
    else if (s.playerId !== "") humanos++;
  }
  return { humanos, bots };
}
