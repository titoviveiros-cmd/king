import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useKingGame } from "./game/useKingGame.js";
import { Home, type OnlineDaHome } from "./ui/Home.js";
import { Mesa } from "./ui/Mesa.js";
import { AudioPanel } from "./ui/AudioPanel.js";
import { RotateGate } from "./ui/RotateGate.js";
import { useBotaoVoltar } from "./ui/useBotaoVoltar.js";
import { servidorConfigurado } from "./net/servidor.js";
import { lerRecuperacao } from "./net/recuperacao.js";
import type { Entrada } from "./modos.js";

/**
 * Dois modos, uma Mesa.
 *
 * `useKingGame` (local/bots) e `useKingOnline` (multiplayer) devolvem a MESMA forma. Como hook
 * não pode ser chamado condicionalmente, cada modo é um COMPONENTE — e é o App que escolhe qual
 * montar. Assim o motor local não fica rodando à toa durante uma partida online.
 *
 * O modo online entra por `lazy()` porque é o único caminho que chega ao cliente Colyseus: quem
 * abre o app para jogar com os bots não baixa o SDK de rede.
 */
const ModoOnline = lazy(() => import("./ModoOnline.js"));

export function App() {
  const [audioOpen, setAudioOpen] = useState(false);
  const [entrada, setEntrada] = useState<Entrada | null>(null);

  // Esc fecha o painel de áudio (teclado de PC).
  useEffect(() => {
    if (!audioOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAudioOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audioOpen]);

  const abrirAudio = useCallback(() => setAudioOpen(true), []);
  const voltarParaLocal = useCallback(() => setEntrada(null), []);

  return (
    <>
      {entrada === null ? (
        <ModoLocal onOpenAudio={abrirAudio} onIrParaOnline={setEntrada} />
      ) : (
        <Suspense fallback={<Conectando />}>
          <ModoOnline entrada={entrada} onOpenAudio={abrirAudio} onSair={voltarParaLocal} />
        </Suspense>
      )}
      {audioOpen && <AudioPanel onClose={() => setAudioOpen(false)} />}
      <RotateGate />
    </>
  );
}

/** Enquanto o pedaço do multiplayer é baixado. Na prática, um piscar. */
function Conectando() {
  return (
    <div className="home">
      <div className="kw">KING</div>
      <div className="foot">Conectando…</div>
    </div>
  );
}

// ─────────────────────────────── MODO LOCAL / BOTS ───────────────────────────────

function ModoLocal({
  onOpenAudio, onIrParaOnline,
}: {
  onOpenAudio: () => void;
  onIrParaOnline: (e: Entrada) => void;
}) {
  const g = useKingGame();
  const { screen, goHome } = g;
  useBotaoVoltar(screen === "mesa", goHome);

  // Lidos direto dos módulos puros: saber se há servidor configurado não exige abrir conexão
  // nenhuma — e nenhum destes dois módulos toca no cliente Colyseus.
  const servidor = servidorConfigurado();
  const online: OnlineDaHome = {
    indisponivel: servidor.ok ? null : servidor.motivo,
    podeVoltar: lerRecuperacao() !== null,
    onCriar: (nick) => onIrParaOnline({ tipo: "criar", nick }),
    onEntrar: (codigo, nick) => onIrParaOnline({ tipo: "entrar", codigo, nick }),
    onVoltar: () => onIrParaOnline({ tipo: "voltar" }),
  };

  if (screen === "home" || !g.game) {
    return <Home onStart={g.start} onOpenAudio={onOpenAudio} online={online} />;
  }
  return (
    <Mesa
      game={g.game}
      reviewing={g.reviewing}
      shake={g.shake}
      castigo={g.castigo}
      onPlay={g.playCard}
      onChooseTrump={g.chooseTrump}
      onAdvance={g.advanceHand}
      onHome={goHome}
      onRestart={g.start}
      onOpenAudio={onOpenAudio}
    />
  );
}
