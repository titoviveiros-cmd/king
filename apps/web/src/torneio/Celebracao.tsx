// A CELEBRAÇÃO DO CAMPEÃO — ~8 segundos de ouro, e depois a tela parada.
//
// O que ela PRECISA dizer cabe numa linha estática: o título ("CAMPEÃO DO MINITORNEIO!" ou
// "CAMPEÃO DA COPA!"), o nome e o bicho de quem venceu. Isso está no DOM desde o primeiro quadro,
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
import { useEffect, useRef } from "react";
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
  titulo, nome, avatar, onFim, duracaoMs = DURACAO_DA_CELEBRACAO_MS,
}: {
  titulo: string;
  nome: string;
  avatar: string;
  onFim: () => void;
  duracaoMs?: number;
}) {
  const fim = useRef(onFim);
  fim.current = onFim;
  const raiz = useRef<HTMLDivElement>(null);
  const reduzido = prefereMenosMovimento();

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
        <p className="tn-celebra-titulo" role="status">{titulo}</p>
        <p className="tn-celebra-nome">{nome} <span className="tn-sr">({d.rotulo})</span></p>
        <p className="tn-celebra-dica">toque para continuar</p>
      </div>
    </div>
  );
}
