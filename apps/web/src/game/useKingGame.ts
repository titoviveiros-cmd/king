import { useCallback, useEffect, useRef, useState } from "react";
import type { Card, Trump } from "@king/engine";
import { KingGame } from "./kingGame.js";
import { useApresentacao } from "./useApresentacao.js";
import { useSonsDeTransicao } from "./useSonsDeTransicao.js";
import { TEMPOS } from "./timings.js";
import { audio } from "../audio/engine.js";
import { sfxTrump } from "../audio/sounds.js";

export type { Castigo } from "./anuncio.js";

/**
 * `?seed=123` fixa a semente da partida. O motor é determinístico por semente (ver
 * KING-ARCHITECTURE), então isso reproduz uma partida idêntica — serve para reproduzir bug
 * e para revisar uma tela específica sem depender de sorte.
 */
function seedDaUrl(): number | null {
  const v = new URLSearchParams(window.location.search).get("seed");
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n >>> 0 : null;
}

/**
 * MODO LOCAL. Liga o adaptador KingGame ao React: força re-render, dá o timing das jogadas dos
 * bots, uma pausa para ler a vaza resolvida e dispara os sons/haptics de cada evento.
 * Nenhuma regra aqui — só orquestração, UX e feedback.
 *
 * O modo multiplayer é um hook irmão (`useKingOnline`) com a MESMA forma de retorno; a Mesa não
 * sabe qual dos dois a está alimentando.
 */
export function useKingGame() {
  const ref = useRef<KingGame | null>(null);
  const [screen, setScreen] = useState<"home" | "mesa">("home");
  const ap = useApresentacao();
  const { bump, afterPlay, emLeitura, limpar } = ap;

  const start = useCallback(() => {
    audio.unlock(); // 1º gesto real do usuário: iOS só libera áudio aqui
    ref.current = new KingGame(["Você", "Bia", "Léo", "Nara"], seedDaUrl() ?? Math.floor(Math.random() * 1e9));
    limpar();
    setScreen("mesa");
    bump();
  }, [bump, limpar]);
  const goHome = useCallback(() => setScreen("home"), []);

  useEffect(() => {
    if (screen !== "mesa") return;
    const id = setInterval(() => {
      const g = ref.current;
      if (!g) return;
      if (emLeitura()) { bump(); return; } // pausa p/ ler a vaza
      const ph = g.phase();
      if (ph === "trump" && g.needsBotTrump()) { g.stepBotTrump(); sfxTrump(); bump(); return; }
      if (ph === "play" && g.needsBotPlay()) {
        g.stepBotPlay();
        afterPlay(g);
        bump();
        return;
      }
      // handEnd / matchEnd / vez do humano → aguarda clique
    }, TEMPOS.botPasso);
    return () => clearInterval(id);
  }, [screen, afterPlay, bump, emLeitura]);

  useSonsDeTransicao(ref.current, screen === "mesa");

  const playCard = useCallback((card: Card) => {
    const g = ref.current;
    if (g && g.isHumanTurn()) {
      g.playHuman(card);
      afterPlay(g);
      bump();
    }
  }, [afterPlay, bump]);
  const chooseTrump = useCallback((t: Trump) => {
    const g = ref.current;
    if (g && g.humanChoosesTrump()) { g.chooseTrumpHuman(t); sfxTrump(); bump(); }
  }, [bump]);
  const advanceHand = useCallback(() => {
    const g = ref.current;
    if (g) { g.advanceHand(); limpar(); bump(); }
  }, [bump, limpar]);

  return {
    game: ref.current as KingGame | null,
    screen,
    reviewing: emLeitura(),
    shake: ap.shake,
    castigo: ap.castigo,
    start, goHome, playCard, chooseTrump, advanceHand,
  };
}
