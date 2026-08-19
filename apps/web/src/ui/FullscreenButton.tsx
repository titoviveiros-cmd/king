import { useEffect, useState } from "react";
import { sfxTap } from "../audio/sounds.js";

type OrientationLock = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

/** Safari no iPhone não expõe Fullscreen API — o botão simplesmente não aparece lá. */
export const supportsFullscreen =
  typeof document !== "undefined" && !!document.documentElement.requestFullscreen;

/**
 * Tela cheia + trava de orientação em landscape (Android/Chrome e navegadores de PC).
 * Onde a trava não existe, a tela cheia sozinha já resolve; onde nada existe, o botão some.
 */
export function FullscreenButton() {
  const [on, setOn] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement);

  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  if (!supportsFullscreen) return null;

  const toggle = async () => {
    sfxTap();
    try {
      if (document.fullscreenElement) {
        (screen.orientation as OrientationLock | undefined)?.unlock?.();
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
        // trava landscape onde houver suporte (Android); em PC a promessa apenas rejeita
        await (screen.orientation as OrientationLock | undefined)?.lock?.("landscape").catch(() => {});
      }
    } catch {
      /* usuário negou ou o navegador não permitiu: segue em janela normal */
    }
  };

  return (
    <button
      className="audiobtn"
      onClick={toggle}
      aria-label={on ? "Sair da tela cheia" : "Tela cheia"}
      title={on ? "Sair da tela cheia" : "Tela cheia"}
    >
      {on ? "⤡" : "⛶"}
    </button>
  );
}
