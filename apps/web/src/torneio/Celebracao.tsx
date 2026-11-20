// A CELEBRAÇÃO DO CAMPEÃO — ~8 segundos de ouro, e depois a tela parada.
//
// O que ela PRECISA dizer cabe em poucas linhas estáticas: o título ("Campeão do mini-torneio!" ou
// "Campeão da Copa!", em caixa alta só pelo CSS), a frase da vitória ("Você venceu o mini-torneio!"),
// o nome e o bicho de quem venceu. Isso está no DOM desde o primeiro quadro,
// em texto, com `role="status"` — quem joga sem som, sem movimento ou com leitor de tela recebe a
// notícia inteira sem esperar efeito nenhum.
//
// O resto é festa: coroa entrando, brilho girando, partículas douradas caindo. As partículas são
// DETERMINÍSTICAS (posição e atraso derivados do índice), sem `Math.random`: a celebração é a mesma
// em toda execução, o que deixa o teste olhar para ela e a revisão visual comparar quadros.
//
// Dispensa: um toque (ou Enter/Espaço/Esc) em qualquer ponto encerra; sozinha, encerra em 8 s.
// Com `prefers-reduced-motion`, nada se mexe e nada cai — o CSS desliga, e o JS não desenha as
// partículas.
//
// SOM: o motivo da coroa (`sfxVictory`, o mesmo da vitória na partida solo), UMA vez por
// celebração. Ele passa pelo motor de áudio, que já obedece às preferências da pessoa (efeitos
// desligados = silêncio; vibração desligada = sem vibrar). Nada aqui decide som por conta própria.
import { useEffect, useRef } from "react";
import { sfxVictory } from "../audio/sounds.js";
import { Crown } from "../ui/Crown.js";
import { desenhoDoAvatar } from "../ui/avatares.js";

export const DURACAO_DA_CELEBRACAO_MS = 8000;
const PARTICULAS = 36;

export function prefereMenosMovimento(): boolean {
  try {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

export function Celebracao({
  titulo, frase, nome, avatar, onFim, duracaoMs = DURACAO_DA_CELEBRACAO_MS,
}: {
  titulo: string;
  /** "Você venceu o mini-torneio!" — a linha abaixo do título. */
  frase?: string;
  nome: string;
  avatar: string;
  onFim: () => void;
  duracaoMs?: number;
}) {
  const fim = useRef(onFim);
  fim.current = onFim;
  const raiz = useRef<HTMLDivElement>(null);
  const reduzido = prefereMenosMovimento();

  // O som toca UMA vez, na montagem — nunca de novo por re-render.
  useEffect(() => { sfxVictory(); }, []);

  useEffect(() => {
    const t = setTimeout(() => fim.current(), duracaoMs);
    raiz.current?.focus({ preventScroll: true });
    return () => clearTimeout(t);
  }, [duracaoMs]);

  const d = desenhoDoAvatar(avatar);
  return (
    <div
      ref={raiz}
      className={`tn-celebra ${reduzido ? "tn-quieto" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      tabIndex={-1}
      onClick={() => fim.current()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " " || e.key === "Escape") { e.preventDefault(); fim.current(); } }}
    >
      {!reduzido && (
        <div className="tn-particulas" aria-hidden>
          {Array.from({ length: PARTICULAS }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${(i * 37) % 100}%`,
                animationDelay: `${((i * 53) % 40) / 10}s`,
                animationDuration: `${2.6 + ((i * 29) % 18) / 10}s`,
                ["--tn-giro" as string]: `${(i * 47) % 360}deg`,
              }}
              className={i % 3 === 0 ? "tn-p-losango" : i % 3 === 1 ? "tn-p-faisca" : "tn-p-ponto"}
            />
          ))}
        </div>
      )}
      <div className="tn-celebra-centro">
        <div className="tn-brilho" aria-hidden />
        <Crown size={110} className="tn-coroa" />
        <div className="tn-campeao-av" aria-hidden>{d.glifo}</div>
        <p className="tn-celebra-titulo tn-caixa-alta" role="status">{titulo}</p>
        {frase && <p className="tn-celebra-frase">{frase}</p>}
        <p className="tn-celebra-nome">{nome} <span className="tn-sr">({d.rotulo})</span></p>
        <p className="tn-celebra-dica">toque para continuar</p>
      </div>
    </div>
  );
}
