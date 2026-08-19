import { AudioButton } from "./AudioPanel.js";
import { FullscreenButton } from "./FullscreenButton.js";

export function Home({ onStart, onOpenAudio }: { onStart: () => void; onOpenAudio: () => void }) {
  return (
    <div className="home">
      <div className="kw">KING</div>
      <div className="tg">Fuja do <b>King</b>. Domine a mesa.</div>
      <div className="row">
        <button className="btn gold" autoFocus onClick={onStart}>▶ Jogar agora</button>
        <FullscreenButton />
        <AudioButton onOpen={onOpenAudio} />
      </div>
      <div className="foot">1 jogador + 3 bots · 4 jogadores · 10 mãos · base jogável (motor real)</div>
    </div>
  );
}
