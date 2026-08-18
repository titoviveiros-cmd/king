import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Card, Trump } from "@king/engine";
import { KingGame } from "./kingGame.js";

/**
 * Liga o adaptador KingGame ao React: força re-render, dá o timing das jogadas dos bots
 * e uma pequena pausa para ler a vaza resolvida. Nenhuma regra aqui — só orquestração/UX.
 */
export function useKingGame() {
  const ref = useRef<KingGame | null>(null);
  const reviewUntil = useRef(0);
  const [, bump] = useReducer((x) => x + 1, 0);
  const [screen, setScreen] = useState<"home" | "mesa">("home");

  const start = useCallback(() => {
    ref.current = new KingGame(["Você", "Bia", "Léo", "Nara"], Math.floor(Math.random() * 1e9));
    reviewUntil.current = 0;
    setScreen("mesa");
    bump();
  }, []);
  const goHome = useCallback(() => setScreen("home"), []);

  useEffect(() => {
    if (screen !== "mesa") return;
    const id = setInterval(() => {
      const g = ref.current;
      if (!g) return;
      if (Date.now() < reviewUntil.current) { bump(); return; } // pausa p/ ler a vaza
      const ph = g.phase();
      if (ph === "trump" && g.needsBotTrump()) { g.stepBotTrump(); bump(); return; }
      if (ph === "play" && g.needsBotPlay()) {
        g.stepBotPlay();
        if (g.currentTrick().length === 0) reviewUntil.current = Date.now() + 1300;
        bump();
        return;
      }
      // handEnd / matchEnd / vez do humano → aguarda clique
    }, 620);
    return () => clearInterval(id);
  }, [screen]);

  const playCard = useCallback((card: Card) => {
    const g = ref.current;
    if (g && g.isHumanTurn()) {
      g.playHuman(card);
      if (g.currentTrick().length === 0) reviewUntil.current = Date.now() + 1300;
      bump();
    }
  }, []);
  const chooseTrump = useCallback((t: Trump) => {
    const g = ref.current;
    if (g && g.humanChoosesTrump()) { g.chooseTrumpHuman(t); bump(); }
  }, []);
  const advanceHand = useCallback(() => {
    const g = ref.current;
    if (g) { g.advanceHand(); reviewUntil.current = 0; bump(); }
  }, []);

  return {
    game: ref.current,
    screen,
    reviewing: Date.now() < reviewUntil.current,
    start, goHome, playCard, chooseTrump, advanceHand,
  };
}
