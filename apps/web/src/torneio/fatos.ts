// Os fatos de uma partida vista pela camada de LEITURA (a mesma que a Mesa consome). A mesa do
// humano é lida por aqui; as de bots, direto do `MatchState` (`simulacao.ts`). As duas leem os
// mesmos campos do motor — `cumulative`, `negatives` e `matchStats` —, e um teste confere que dão
// o mesmo número para a mesma partida.
import type { LeituraDaPartida } from "../game/leituraDaPartida.js";
import type { FatosDaMesa } from "./desempate.js";

export function fatosDoEstadoDaLeitura(g: LeituraDaPartida): FatosDaMesa {
  return {
    pontos: g.cumulative(),
    negativas: g.negatives(),
    ilesas: g.stats().perSeat.map((s) => s.cleanNegatives),
  };
}
