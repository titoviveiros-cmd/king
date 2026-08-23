// SONS DE TRANSIÇÃO — mão nova, última vaza, fim de mão, fim de partida, sua vez.
//
// Compartilhado pelos dois modos: no local a transição vem do motor local; no multiplayer vem da
// visão autoritativa recém-aplicada. Em ambos os casos o gatilho é o mesmo — MUDOU de estado —,
// então a experiência sonora é idêntica.
import { useEffect, useRef } from "react";
import type { LeituraDaPartida, Phase } from "./leituraDaPartida.js";
import { sfxDeal, sfxFinalSwell, sfxHandEnd, sfxLastTrick, sfxYourTurn } from "../audio/sounds.js";

export function useSonsDeTransicao(g: LeituraDaPartida | null, ativo: boolean): void {
  const prev = useRef({ phase: null as Phase | null, hand: 0, humanTurn: false, trick: 0 });

  const phase = ativo && g ? g.phase() : null;
  const handNumber = g ? g.handNumber() : 0;
  const trickNumber = g ? g.trickNumber() : 0;
  const humanTurn = !!g && ativo && g.isHumanTurn();

  useEffect(() => {
    if (!ativo || !g) {
      // Sair da mesa zera a memória: a próxima partida deve anunciar a primeira mão de novo.
      prev.current = { phase: null, hand: 0, humanTurn: false, trick: 0 };
      return;
    }
    const p = prev.current;
    if (handNumber !== p.hand && handNumber > 0) sfxDeal();
    else if (phase === "handEnd" && p.phase !== "handEnd") sfxHandEnd();
    else if (phase === "matchEnd" && p.phase !== "matchEnd") {
      // o resto do encerramento (coroa, fanfarra) é encenado pelo próprio Placar Final
      sfxFinalSwell();
    } else if (phase === "play" && trickNumber === 13 && p.trick !== 13) sfxLastTrick();
    else if (humanTurn && !p.humanTurn) sfxYourTurn();
    prev.current = { phase, hand: handNumber, humanTurn, trick: trickNumber };
  }, [ativo, g, phase, handNumber, trickNumber, humanTurn]);
}
