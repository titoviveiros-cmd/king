// "NOVO RECORDE!" (Entrega D) — decide, no fim de uma partida COMPLETA, se ela entrou no Top 3.
//
//   SOLO    registra no Top 3 deste aparelho (uma vez por partida) e celebra a posição que ganhou.
//   ONLINE  NÃO registra nada: quem grava é o servidor, na transação do crédito. Depois que o crédito
//           desta partida é CONFIRMADO (o mesmo XP que o Placar Final mostra), relê o Top 3 Online UMA
//           vez e celebra se esta partida está nele.
//
// Uma vez por resultado: marcado como celebrado no aparelho assim que aparece. Nunca durante a
// partida: só existe no Placar Final, que é depois do fim.
import { useEffect, useState } from "react";
import type { LeituraDaPartida } from "./leituraDaPartida.js";
import { KingGame } from "./kingGame.js";
import type { XpDaPartida } from "./xpDaPartida.js";
import { jaCelebrado, marcarCelebrado, registrarSolo, type LeitorDeRecordes, type Modalidade } from "../auth/recordes.js";

export interface NovoRecordeDaPartida {
  id: string;
  posicao: 1 | 2 | 3;
  pontos: number;
  modo: Modalidade;
}

export function useNovoRecorde(
  game: LeituraDaPartida,
  online: { matchId?: string; creditoConfirmado: boolean } | null,
  leitor: LeitorDeRecordes | null,
): NovoRecordeDaPartida | null {
  const [novo, setNovo] = useState<NovoRecordeDaPartida | null>(null);
  const fim = game.phase() === "matchEnd";

  // SOLO: a partida local que CONTA (inteira, sem depuração) entra no Top 3 deste aparelho.
  useEffect(() => {
    if (online || !fim || !(game instanceof KingGame) || !game.contaParaRecordes) return;
    const id = game.idDaPartida;
    const pontos = game.cumulative()[game.humanSeat];
    const posicao = registrarSolo(id, pontos, new Date().toISOString());
    if (posicao && !jaCelebrado(id)) setNovo({ id, posicao, pontos, modo: "solo" });
  }, [game, fim, online]);

  // ONLINE: só depois do crédito confirmado — antes disso o servidor pode não ter gravado o placar.
  const matchId = online?.matchId;
  const confirmado = online?.creditoConfirmado ?? false;
  useEffect(() => {
    if (!fim || !matchId || !confirmado || !leitor || jaCelebrado(matchId)) return;
    let vivo = true;
    void leitor.topOnline().then((top) => {
      if (!vivo || !top) return;
      const i = top.findIndex((r) => r.id === matchId);
      if (i >= 0) setNovo({ id: matchId, posicao: (i + 1) as 1 | 2 | 3, pontos: top[i].pontos, modo: "online" });
    });
    return () => { vivo = false; };
  }, [fim, matchId, confirmado, leitor]);

  return novo;
}

/** O crédito desta partida está confirmado? (o mesmo XP real que o Placar Final mostra) */
export const creditoConfirmado = (xp: XpDaPartida | null): boolean => xp !== null;

export { marcarCelebrado };
