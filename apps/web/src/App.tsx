import { useKingGame } from "./game/useKingGame.js";
import { Home } from "./ui/Home.js";
import { Mesa } from "./ui/Mesa.js";

export function App() {
  const g = useKingGame();
  if (g.screen === "home" || !g.game) return <Home onStart={g.start} />;
  return (
    <Mesa
      game={g.game}
      reviewing={g.reviewing}
      onPlay={g.playCard}
      onChooseTrump={g.chooseTrump}
      onAdvance={g.advanceHand}
      onHome={g.goHome}
    />
  );
}
