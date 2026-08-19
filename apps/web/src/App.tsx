import { useEffect, useState } from "react";
import { useKingGame } from "./game/useKingGame.js";
import { Home } from "./ui/Home.js";
import { Mesa } from "./ui/Mesa.js";
import { AudioPanel } from "./ui/AudioPanel.js";
import { RotateGate } from "./ui/RotateGate.js";

export function App() {
  const g = useKingGame();
  const [audioOpen, setAudioOpen] = useState(false);
  const { screen, goHome } = g;

  // Esc fecha o painel de áudio (teclado de PC).
  useEffect(() => {
    if (!audioOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAudioOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audioOpen]);

  // Botão VOLTAR do Android: sai da mesa para a Home em vez de abandonar a página.
  useEffect(() => {
    if (screen !== "mesa") return;
    window.history.pushState({ king: "mesa" }, "");
    const onPop = () => goHome();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // saiu pelo botão "Sair": desfaz a entrada que empurramos, para não sobrar histórico
      if ((window.history.state as { king?: string } | null)?.king === "mesa") window.history.back();
    };
  }, [screen, goHome]);

  return (
    <>
      {screen === "home" || !g.game ? (
        <Home onStart={g.start} onOpenAudio={() => setAudioOpen(true)} />
      ) : (
        <Mesa
          game={g.game}
          reviewing={g.reviewing}
          shake={g.shake}
          onPlay={g.playCard}
          onChooseTrump={g.chooseTrump}
          onAdvance={g.advanceHand}
          onHome={goHome}
          onRestart={g.start}
          onOpenAudio={() => setAudioOpen(true)}
        />
      )}
      {audioOpen && <AudioPanel onClose={() => setAudioOpen(false)} />}
      <RotateGate />
    </>
  );
}
