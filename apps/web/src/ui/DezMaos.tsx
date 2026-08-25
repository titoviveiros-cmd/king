// AS 10 MÃOS — a consulta rápida que estava faltando.
//
// Nasceu de uma observação de uso real: o card do contrato no canto diz o que vale AGORA, e não
// existia lugar nenhum para responder "e as outras?". Quem esquece a ordem das mãos no meio da
// partida abre o menu, procura, desiste. Agora o próprio card é a porta.
//
// REGRA DESTE ARQUIVO: nenhuma regra mora aqui. As dez linhas saem de `HAND_CONTRACTS`, o mesmo
// registro que o motor usa para pontuar, e os rótulos saem de `contractText`. Se o motor mudar um
// contrato, esta tela muda junto, sem ninguém lembrar de vir aqui. É o que impede a consulta
// rápida de virar uma segunda fonte de verdade divergindo em silêncio.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { HAND_CONTRACTS, TOTAL_HANDS } from "@king/engine";
import { penaltyTextLong } from "./contractText.js";
import { sfxTap } from "../audio/sounds.js";

/** As dez, na ordem do jogo, direto do registro do motor. */
const MAOS = Array.from({ length: TOTAL_HANDS }, (_, i) => HAND_CONTRACTS[i + 1]);

export function DezMaos({ maoAtual, onFechar }: { maoAtual?: number; onFechar: () => void }) {
  const fechar = useRef<HTMLButtonElement>(null);

  // Esc fecha, e o foco começa no botão de fechar: quem abriu sem querer sai sem procurar.
  useEffect(() => {
    fechar.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onFechar(); }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const sair = () => { sfxTap(); onFechar(); };

  const linha = (n: number) => {
    const c = MAOS[n - 1];
    const atual = n === maoAtual;
    return (
      <li key={n} className={`dm-item ${c.isPositive ? "pos" : "neg"} ${atual ? "atual" : ""}`}>
        <span className="dm-n" aria-hidden>{n}</span>
        <span className="dm-txt">
          {/* O nome vem do REGISTRO DO MOTOR, não do vocabulário curto da Mesa. No canto da tela
              cabe "Não pegar Q"; aqui cabe "Não pegar Damas", que é como a mesa fala em voz alta. */}
          <b>{c.label}</b>
          <i>{penaltyTextLong(c.kind)}</i>
        </span>
        {/* O destaque NÃO é só a cor: há moldura, marcador e a palavra ATUAL, que também é o
            que um leitor de tela anuncia. Cor sozinha não informa quem não a distingue. */}
        {atual && <span className="dm-atual">◆ ATUAL</span>}
      </li>
    );
  };

  /* PORTAL, e por um motivo medido: a Mesa é o container de quem a abre, e um overlay renderizado
     lá dentro herda a caixa dela. No tutorial, onde a Mesa começa abaixo da faixa, o resumo
     nascia cortado no topo e a faixa continuava clicável por cima dele: dava para tocar AVANÇAR
     com o modal aberto. Preso ao `body`, o scrim cobre a tela inteira em qualquer tela que o
     abra, e nada atrás dele recebe toque. */
  const painel = (
    <div className="dm-scrim" onClick={sair}>
      <div
        className="dm"
        role="dialog"
        aria-modal="true"
        aria-label="As 10 mãos do KING"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dm-topo">
          <h2>As 10 mãos</h2>
          <button ref={fechar} className="dm-x" onClick={sair} aria-label="Fechar o resumo das mãos">
            ✕
          </button>
        </div>

        <div className="dm-corpo">
          <section className="dm-fase neg">
            <h3>Fase negativa</h3>
            <ul className="dm-lista">{[1, 2, 3, 4, 5, 6].map(linha)}</ul>
          </section>

          <section className="dm-fase pos">
            <h3>Fase positiva</h3>
            <ul className="dm-lista">{[7, 8, 9, 10].map(linha)}</ul>
            <p className="dm-nota">
              Nas 4 mãos positivas, um jogador diferente escolhe o trunfo ou joga Sem Trunfo.
            </p>
          </section>
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? painel : createPortal(painel, document.body);
}
