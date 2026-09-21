import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useKingGame } from "./game/useKingGame.js";
import { Home, type OnlineDaHome, type TutorialDaHome } from "./ui/Home.js";
import { Mesa } from "./ui/Mesa.js";
import { AudioPanel } from "./ui/AudioPanel.js";
import { RotateGate } from "./ui/RotateGate.js";
import { useBotaoVoltar } from "./ui/useBotaoVoltar.js";
import { servidorConfigurado } from "./net/servidor.js";
import { lerRecuperacao } from "./net/recuperacao.js";
import type { Entrada } from "./modos.js";
import { analytics } from "./analytics/analytics.js";
import { armazenamentoLocal } from "./tutorial/persistencia.js";
import { useConta } from "./auth/useConta.js";

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

/**
 * APRENDA KING também entra por `lazy()`. Ele carrega quatro cenários e um roteiro que quem já
 * aprendeu nunca mais vai abrir — não faz sentido esse peso viajar em toda visita.
 */
const Tutorial = lazy(() => import("./tutorial/Tutorial.js").then((m) => ({ default: m.Tutorial })));

export function App() {
  const [audioOpen, setAudioOpen] = useState(false);
  const [entrada, setEntrada] = useState<Entrada | null>(null);
  // O TUTORIAL NUNCA SE ABRE SOZINHO. Quem abre o KING cai na Home, sempre — mesmo na primeira
  // vez, mesmo com armazenamento zerado. O APRENDA KING é um convite na Home ("Aprenda KING" /
  // "Rever como se joga"), e só o toque nele monta o tutorial. O progresso salvo continua valendo:
  // é lido quando ele abre, para retomar de onde parou.
  const [tutorialAberto, setTutorialAberto] = useState(false);
  const [tutorialConcluido, setTutorialConcluido] = useState(() => armazenamentoLocal.ler().concluido);

  const aberturaAnunciada = useRef(false);
  useEffect(() => {
    if (aberturaAnunciada.current) return;
    aberturaAnunciada.current = true;
    analytics.track("app_open", {});
  }, []);

  // Esc fecha o painel de áudio (teclado de PC).
  useEffect(() => {
    if (!audioOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAudioOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [audioOpen]);

  const abrirAudio = useCallback(() => setAudioOpen(true), []);
  const voltarParaLocal = useCallback(() => setEntrada(null), []);

  const tutorial: TutorialDaHome = {
    onAbrir: () => setTutorialAberto(true),
    concluido: tutorialConcluido,
  };
  const fecharTutorial = useCallback((concluido: boolean) => {
    setTutorialAberto(false);
    if (concluido) setTutorialConcluido(true);
  }, []);

  return (
    <>
      {tutorialAberto ? (
        <Suspense fallback={<Carregando texto="Preparando a mesa…" />}>
          <Tutorial onSair={fecharTutorial} onOpenAudio={abrirAudio} />
        </Suspense>
      ) : entrada === null ? (
        <ModoLocal onOpenAudio={abrirAudio} onIrParaOnline={setEntrada} tutorial={tutorial} />
      ) : (
        <Suspense fallback={<Carregando texto="Conectando…" />}>
          <ModoOnline entrada={entrada} onOpenAudio={abrirAudio} onSair={voltarParaLocal} />
        </Suspense>
      )}
      {audioOpen && <AudioPanel onClose={() => setAudioOpen(false)} />}
      <RotateGate />
    </>
  );
}

/** Enquanto um pedaço carregado sob demanda chega. Na prática, um piscar. */
function Carregando({ texto }: { texto: string }) {
  return (
    <div className="home">
      <div className="kw">KING</div>
      <div className="foot">{texto}</div>
    </div>
  );
}

// ─────────────────────────────── MODO LOCAL / BOTS ───────────────────────────────

function ModoLocal({
  onOpenAudio, onIrParaOnline, tutorial,
}: {
  onOpenAudio: () => void;
  onIrParaOnline: (e: Entrada) => void;
  tutorial: TutorialDaHome;
}) {
  const g = useKingGame();
  const { screen, goHome } = g;
  useBotaoVoltar(screen === "mesa", goHome);

  // A conta vive na Home, e o retorno do Google é processado aqui dentro, uma vez. `null` quando
  // esta publicação não vincula contas — e aí a Home é exatamente a de sempre.
  const conta = useConta();

  // Lidos direto dos módulos puros: saber se há servidor configurado não exige abrir conexão
  // nenhuma — e nenhum destes dois módulos toca no cliente Colyseus.
  const servidor = servidorConfigurado();
  const online: OnlineDaHome = {
    indisponivel: servidor.ok ? null : servidor.motivo,
    podeVoltar: lerRecuperacao() !== null,
    onCriar: (nick, avatar) => onIrParaOnline({ tipo: "criar", nick, avatar }),
    onEntrar: (codigo, nick, avatar) => onIrParaOnline({ tipo: "entrar", codigo, nick, avatar }),
    onVoltar: () => onIrParaOnline({ tipo: "voltar" }),
  };

  if (screen === "home" || !g.game) {
    return (
      <Home
        onStart={g.start}
        onOpenAudio={onOpenAudio}
        online={online}
        tutorial={tutorial}
        conta={conta ?? undefined}
      />
    );
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
      suspender={g.suspender}
    />
  );
}
