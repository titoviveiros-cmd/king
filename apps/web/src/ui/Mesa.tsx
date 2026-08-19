import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Card, Trump, Seat } from "@king/engine";
import { RANK_ORDER } from "@king/engine";
import { contractTitle, penaltyText, trumpLabel } from "./contractText.js";
import { Placar } from "./Placar.js";
import { PlacarFinal } from "./PlacarFinal.js";
import { AudioButton } from "./AudioPanel.js";
import { FullscreenButton } from "./FullscreenButton.js";
import { sfxCardSelect, sfxTap } from "../audio/sounds.js";
import type { KingGame } from "../game/kingGame.js";
import { CardView } from "./CardView.js";
import { TEMPOS } from "../game/timings.js";

const SUIT_ORDER: Record<string, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
const NAMES_SLOT: Record<Seat, "b" | "l" | "t" | "r"> = { 0: "b", 1: "l", 2: "t", 3: "r" };
const TRUMPS: { t: Trump; sym: string; label: string; red?: boolean }[] = [
  { t: "hearts", sym: "♥", label: "Copas", red: true },
  { t: "diamonds", sym: "♦", label: "Ouros", red: true },
  { t: "clubs", sym: "♣", label: "Paus" },
  { t: "spades", sym: "♠", label: "Espadas" },
  { t: "no-trump", sym: "∅", label: "Sem Trunfo" },
];

function sortDisplay(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => (SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]) || (RANK_ORDER[b.rank] - RANK_ORDER[a.rank]));
}
const same = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;
const cardKey = (c: Card) => c.rank + c.suit;
const isRedSuit = (t: Trump) => t === "hearts" || t === "diamonds";

/** Aparelho sem mouse (celular/tablet): o toque seleciona antes de confirmar. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(
    () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(pointer: coarse)");
    const on = () => setCoarse(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return coarse;
}

export function Mesa({
  game, reviewing, shake, onPlay, onChooseTrump, onAdvance, onHome, onRestart, onOpenAudio,
}: {
  game: KingGame;
  reviewing: boolean;
  shake: number;
  onPlay: (c: Card) => void;
  onChooseTrump: (t: Trump) => void;
  onAdvance: () => void;
  onHome: () => void;
  onRestart: () => void;
  onOpenAudio: () => void;
}) {
  const players = game.players();
  const contract = game.contract();
  const phase = game.phase();
  const counts = game.handCounts();
  // Pontuação pública AO VIVO por assento (cumulativo + parcial da mão em curso, tudo do motor):
  // o card do vencedor incorpora o delta assim que a vaza é resolvida. NUNCA por posição/ranking.
  const scores = game.liveScores();
  const turn = game.turn();
  const trump = game.trump();
  const humanTurn = game.isHumanTurn();
  const legal = humanTurn ? game.legalCards() : [];
  const hand = sortDisplay(game.view().yourHand);

  const coarse = useCoarsePointer();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { if (!humanTurn) setSelected(null); }, [humanTurn]);

  // "SUA VEZ" é temporário (Design System): o estado permanente é o anel dourado no seu card.
  // Some antes de você começar a escolher a carta, para não disputar espaço com o leque.
  const [showTurnChip, setShowTurnChip] = useState(false);
  useEffect(() => {
    if (!humanTurn) { setShowTurnChip(false); return; }
    setShowTurnChip(true);
    const id = setTimeout(() => setShowTurnChip(false), TEMPOS.chipSuaVez);
    return () => clearTimeout(id);
  }, [humanTurn]);

  // Dica de teclado (SÓ em ambiente com teclado — ver `coarse` e o gate CSS por `pointer:fine`).
  // Aparece depois do chip "Sua vez", fica ACIMA do leque (nunca sobre as cartas) e some após
  // alguns segundos OU na primeira tecla de jogada. No toque não existe.
  const [keyhintOn, setKeyhintOn] = useState(false);
  useEffect(() => {
    if (!humanTurn || coarse) { setKeyhintOn(false); return; }
    setKeyhintOn(true);
    const id = setTimeout(() => setKeyhintOn(false), 5500);
    return () => clearTimeout(id);
  }, [humanTurn, coarse]);

  // screen-shake nos momentos heróicos (King capturado) — Design System
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    if (!shake) return;
    setShaking(true);
    const id = setTimeout(() => setShaking(false), TEMPOS.shakeKing);
    return () => clearTimeout(id);
  }, [shake]);

  /** No toque: 1º toque seleciona, 2º na mesma carta joga. No mouse: clique joga direto. */
  const pickCard = (c: Card) => {
    if (!coarse) { setSelected(null); onPlay(c); return; }
    if (selected === cardKey(c)) { setSelected(null); onPlay(c); return; }
    setSelected(cardKey(c));
    sfxCardSelect();
  };

  // ---- teclado (PC) ----
  // O handler é registrado UMA vez e lê o estado atual por ref (a mesa re-renderiza a cada
  // passo dos bots; não faz sentido reassinar o listener nesse ritmo).
  const kb = useRef({ phase, humanTurn, hand, legal, selected, onPlay, onChooseTrump, setSelected, chooseTrump: false });
  kb.current = {
    phase, humanTurn, hand, legal, selected, onPlay, onChooseTrump, setSelected,
    chooseTrump: phase === "trump" && game.humanChoosesTrump(),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = kb.current;
      if (s.chooseTrump) {
        const i = ["1", "2", "3", "4", "5"].indexOf(e.key);
        if (i >= 0) { e.preventDefault(); s.onChooseTrump(TRUMPS[i].t); }
        return;
      }
      if (s.phase !== "play" || !s.humanTurn || s.legal.length === 0) return;
      const legalCards = s.hand.filter((c) => s.legal.some((l) => same(l, c)));
      const at = legalCards.findIndex((c) => cardKey(c) === s.selected);

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        setKeyhintOn(false); // primeira interação por teclado: a dica já cumpriu o papel
        const step = e.key === "ArrowRight" ? 1 : -1;
        const next = at < 0
          ? (step > 0 ? 0 : legalCards.length - 1)
          : (at + step + legalCards.length) % legalCards.length;
        s.setSelected(cardKey(legalCards[next]));
        sfxCardSelect();
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setKeyhintOn(false);
        if (at >= 0) { s.setSelected(null); s.onPlay(legalCards[at]); }
        else { s.setSelected(cardKey(legalCards[0])); sfxCardSelect(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // vaza a mostrar: a corrente, ou a última resolvida durante a pausa de leitura
  const cur = game.currentTrick();
  const last = game.lastCompletedTrick();
  const shownTrick = cur.length > 0 ? cur : (reviewing && last ? last.cards : []);
  const winnerSeat = cur.length === 0 && reviewing && last ? last.winner : null;

  const oppSeats: Seat[] = [1, 2, 3];
  const oppName = (s: Seat) => players[s];

  return (
    <div className={`mesa${shaking ? " shaking" : ""}`}>
      <div className="inlay" />

      {/* HUD do contrato — é o objetivo da mão, a informação mais importante da tela.
          A classe da fase pinta o halo (magenta na negativa, turquesa na positiva) e a `key`
          remonta o card quando a mão vira, para o realce de atenção tocar de novo exatamente
          no momento em que o objetivo muda. */}
      <div className={`hud ${contract?.isPositive ? "pos" : "neg"}`} key={contract?.hand ?? 0}>
        <div className="ph">{contract?.isPositive ? "Fase positiva" : "Fase negativa"} · Mão {contract?.hand}</div>
        <div className="c">{contractTitle(contract?.kind)}</div>
        <div className="r">
          <span className="pen">{penaltyText(contract?.kind)}</span>
          <span className="vz">Vaza <b>{Math.min(game.trickNumber(), 13)}</b>/13</span>
        </div>
      </div>

      {/* Slot de trunfo — só existe nas mãos positivas (Design System). Símbolo grande:
          é consultado o tempo todo durante a mão. */}
      {contract?.isPositive && trump && (
        <div className={`trumpslot ${trump === "no-trump" ? "nt" : isRedSuit(trump) ? "red" : "black"}`}>
          <span className="lb">Trunfo</span>
          <span className="sym">{trumpLabel(trump)}</span>
          {game.trumpChooser() !== null && (
            <span className="who">{players[game.trumpChooser() as Seat]}</span>
          )}
        </div>
      )}
      <div className="topbtn">
        <FullscreenButton />
        <AudioButton onOpen={onOpenAudio} />
        <button className="btn ghost" onClick={() => { sfxTap(); onHome(); }}>Sair</button>
      </div>

      {/* adversários */}
      {oppSeats.map((s) => (
        <div key={s} className={`opp ${NAMES_SLOT[s] === "l" ? "left" : NAMES_SLOT[s] === "t" ? "top" : "right"} ${turn === s && phase === "play" ? "active" : ""}`}>
          <div className="av">{oppName(s)[0]}</div>
          <div>
            <div className="n">{oppName(s)}</div>
            <div className="m"><span className="cc">🂠 {counts[s]}</span><span className="pt">{scores[s]} pts</span></div>
          </div>
        </div>
      ))}

      {/* vaza central */}
      <div className="trick">
        {shownTrick.map((pc) => (
          <div key={pc.seat} className={`slot ${NAMES_SLOT[pc.seat]} ${winnerSeat === pc.seat ? "win" : ""}`}>
            <CardView card={pc.card} />
          </div>
        ))}
      </div>

      {/* jogador local */}
      <div className={`youtag ${humanTurn ? "active" : ""}`}>
        <div className="av">{players[0][0]}</div>
        <div>
          <div className="n">{players[0]}</div>
          <div className="m">🂠 {counts[0]} · {scores[0]} pts</div>
        </div>
      </div>
      {humanTurn && (
        <>
          {showTurnChip && !selected && <div className="suavez">Sua vez</div>}
          {coarse && selected && <div className="confirmchip">Toque de novo ▸</div>}
          {!coarse && keyhintOn && !selected && (
            <div className="keyhint"><b>← →</b> escolher · <b>Enter</b> jogar</div>
          )}
        </>
      )}

      {/* leque — largura, passo e ângulo são calculados no CSS a partir de --n, --i e --ymax */}
      <div
        className="hand"
        style={{
          ["--n" as string]: hand.length || 1,
          ["--ymax" as string]: arc((hand.length - 1) / 2),
        }}
      >
        {hand.map((c, i) => {
          const isLegal = legal.some((l) => same(l, c));
          const state = humanTurn ? (isLegal ? "legal" : "illegal") : "";
          const mid = (hand.length - 1) / 2;
          return (
            <CardView
              key={cardKey(c)}
              card={c}
              state={state as "legal" | "illegal" | ""}
              selected={selected === cardKey(c)}
              style={fanVars(i, Math.abs(i - mid))}
              onClick={humanTurn && isLegal ? () => pickCard(c) : undefined}
            />
          );
        })}
      </div>

      {/* overlays */}
      {phase === "trump" && game.humanChoosesTrump() && (
        <TrumpOverlay onChoose={onChooseTrump} />
      )}
      {phase === "trump" && !game.humanChoosesTrump() && (
        <div className="pickmsg">
          {oppName(game.awaitingTrumpFrom() as Seat)} está escolhendo o trunfo…
        </div>
      )}
      {phase === "handEnd" && (
        <Placar game={game} onAdvance={onAdvance} onHome={onHome} onRestart={onRestart} />
      )}
      {phase === "matchEnd" && (
        <PlacarFinal game={game} onRestart={onRestart} onHome={onHome} />
      )}
    </div>
  );
}

/**
 * Painel de trunfo — ocupa só o miolo da mesa. O leque continua **visível e nítido** porque
 * escolher o trunfo exige justamente analisar as 13 cartas.
 */
function TrumpOverlay({ onChoose }: { onChoose: (t: Trump) => void }) {
  return (
    <div className="trumpov">
      <div className="trumppanel">
        <h2>Escolha o trunfo</h2>
        <div className="sub">Analise sua mão abaixo e escolha o naipe (ou Sem Trunfo).</div>
        <div className="trumpgrid">
          {TRUMPS.map((x, i) => (
            <button
              key={x.t}
              className={`trumpbtn ${x.red ? "red" : ""} ${x.t === "no-trump" ? "nt" : ""}`}
              autoFocus={i === 0}
              onClick={() => onChoose(x.t)}
            >
              {x.sym}<small>{x.label}</small>
            </button>
          ))}
        </div>
        <div className="keyhint" style={{ position: "static", transform: "none", marginTop: 10 }}>
          <b>1–5</b> escolhe pelo teclado
        </div>
      </div>
    </div>
  );
}

/** Curva do arco: quanto a carta desce conforme se afasta do centro do leque. */
const arc = (dist: number) => Math.pow(Math.max(dist, 0), 1.25);

/** Só o índice e o afastamento do centro; o tamanho do leque é responsabilidade do CSS. */
function fanVars(i: number, dist: number): CSSProperties {
  return { ["--i" as string]: i, ["--y" as string]: arc(dist) } as CSSProperties;
}
