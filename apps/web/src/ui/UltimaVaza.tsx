// ÚLTIMA VAZA — o que acabou de acontecer, para quem piscou.
//
// A mesa do KING passa rápido: quatro cartas caem, alguém leva, e as cartas são recolhidas. Numa
// partida real a pergunta "quem jogou a Dama?" apareceu mais de uma vez, e não havia resposta.
//
// ══ NADA AQUI É NOVO, E ISSO É A GARANTIA ══
//
// Não houve mudança no motor, nem no protocolo, nem no servidor. A última vaza JÁ É estado
// público: `completedTricks` viaja dentro do `PlayerView`, que é o `MatchState` redigido para o
// assento. Todo cliente já tem, e tem exatamente o mesmo — quem joga na sala vê a mesma coisa.
//
// O que a tela mostra é o que `lastCompletedTrick()` devolve (as quatro cartas, quem jogou cada
// uma, a ordem e quem venceu) e o que `lastTrickBreakdown()` calcula (o que a vaza custou ou
// rendeu, pelo motor). Nenhuma reconstrução, nenhuma inferência, nenhuma carta de mão de ninguém:
// as quatro cartas desta vaza foram jogadas ABERTAS, na frente de todo mundo.
//
// E nada é guardado: quando a mão vira, `completedTricks` é outro. Não existe histórico no
// cliente para vazar depois.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Seat } from "@king/engine";
import type { LeituraDaPartida } from "../game/leituraDaPartida.js";
import { CardView } from "./CardView.js";
import { fmtSigned, unitsText } from "./contractText.js";
import { sfxTap } from "../audio/sounds.js";

export function UltimaVaza({ game, onFechar }: { game: LeituraDaPartida; onFechar: () => void }) {
  const fechar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fechar.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onFechar(); }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const sair = () => { sfxTap(); onFechar(); };

  const vaza = game.lastCompletedTrick();
  if (!vaza) return null;

  const players = game.players();
  const contrato = game.contract();
  const bd = game.lastTrickBreakdown();
  const doVencedor = bd?.rows[vaza.winner];

  /**
   * O que ESTA vaza custou ou rendeu, e só quando houve algo.
   *
   * Sai de `handBreakdown` sobre a vaza sozinha — o mesmo caminho que o selo do castigo usa. Numa
   * mão de "não pegar Damas", uma vaza sem Dama não vale nada e a linha simplesmente não aparece:
   * escrever "0" seria informação sem conteúdo competindo com o que importa.
   */
  const efeito = doVencedor && doVencedor.points !== 0 && bd
    ? {
        pontos: doVencedor.points,
        detalhe: contrato?.isPositive
          ? null
          : unitsText(doVencedor.units, bd.unit, bd.unitPlural),
      }
    : null;

  const painel = (
    <div className="uv-scrim" onClick={sair}>
      <div
        className="uv"
        role="dialog"
        aria-modal="true"
        aria-label={`Última vaza: ${players[vaza.winner]} venceu`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="uv-topo">
          <h2>Vaza {vaza.number}</h2>
          <button ref={fechar} className="uv-x" onClick={sair} aria-label="Fechar a última vaza">✕</button>
        </div>

        {/* A ORDEM DE JOGO é informação de jogo, não decoração: saber quem abriu muda a leitura
            da vaza inteira. Por isso o número da posição vem antes do nome. */}
        <ol className="uv-cartas">
          {vaza.cards.map((p, i) => {
            const venceu = p.seat === vaza.winner;
            return (
              <li key={`${p.seat}-${i}`} className={`uv-carta${venceu ? " venceu" : ""}`}>
                <span className="uv-ordem" aria-hidden>{i + 1}</span>
                <CardView card={p.card} />
                <span className={`uv-quem s${p.seat as Seat}`}>
                  {players[p.seat]}
                  {venceu && <i>venceu</i>}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="uv-fim">
          <b>{players[vaza.winner]} ganhou a vaza</b>
          {efeito && (
            <span className={`uv-pontos ${efeito.pontos > 0 ? "pos" : "neg"}`}>
              {fmtSigned(efeito.pontos)}
              {efeito.detalhe && <i>{efeito.detalhe}</i>}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? painel : createPortal(painel, document.body);
}
