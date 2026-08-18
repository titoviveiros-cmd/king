import type { CSSProperties } from "react";
import type { Card, Trump, Seat } from "@king/engine";
import { RANK_ORDER, SUIT_SYMBOL } from "@king/engine";
import type { KingGame } from "../game/kingGame.js";
import { CardView } from "./CardView.js";

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

export function Mesa({
  game, reviewing, onPlay, onChooseTrump, onAdvance, onHome,
}: {
  game: KingGame;
  reviewing: boolean;
  onPlay: (c: Card) => void;
  onChooseTrump: (t: Trump) => void;
  onAdvance: () => void;
  onHome: () => void;
}) {
  const players = game.players();
  const contract = game.contract();
  const phase = game.phase();
  const counts = game.handCounts();
  const cumulative = game.cumulative();
  const turn = game.turn();
  const trump = game.trump();
  const humanTurn = game.isHumanTurn();
  const legal = humanTurn ? game.legalCards() : [];
  const hand = sortDisplay(game.view().yourHand);

  // vaza a mostrar: a corrente, ou a última resolvida durante a pausa de leitura
  const cur = game.currentTrick();
  const last = game.lastCompletedTrick();
  const shownTrick = cur.length > 0 ? cur : (reviewing && last ? last.cards : []);
  const winnerSeat = cur.length === 0 && reviewing && last ? last.winner : null;

  const oppSeats: Seat[] = [1, 2, 3];
  const oppName = (s: Seat) => players[s];

  return (
    <div className="mesa">
      <div className="inlay" />

      {/* HUD do contrato */}
      <div className="hud">
        <div className="ph">{contract?.isPositive ? "Fase positiva" : "Fase negativa"} · Mão {contract?.hand}</div>
        <div className="c">{contractTitle(contract?.kind)}</div>
        <div className="r">
          {!contract?.isPositive && <span className="pen">{penaltyText(contract?.kind)}</span>}
          {contract?.isPositive && <span className="pen">+25 / vaza</span>}
          <span className="vz">Vaza <b>{Math.min(game.trickNumber(), 13)}</b>/13</span>
          {contract?.isPositive && trump && <span className="trump">Trunfo: {trumpLabel(trump)}</span>}
        </div>
      </div>
      <div className="topbtn"><button className="btn ghost" onClick={onHome}>Sair</button></div>

      {/* adversários */}
      {oppSeats.map((s) => (
        <div key={s} className={`opp ${NAMES_SLOT[s] === "l" ? "left" : NAMES_SLOT[s] === "t" ? "top" : "right"} ${turn === s && phase === "play" ? "active" : ""}`}>
          <div className="av">{oppName(s)[0]}</div>
          <div>
            <div className="n">{oppName(s)}</div>
            <div className="m"><span className="cc">🂠 {counts[s]}</span><span className="pt">{cumulative[s]} pts</span></div>
          </div>
        </div>
      ))}

      {/* vaza central */}
      <div className="trick">
        {shownTrick.map((pc) => (
          <div key={pc.seat} className={`slot ${NAMES_SLOT[pc.seat]} ${winnerSeat === pc.seat ? "win" : ""}`}>
            <CardView card={pc.card} cw={60} />
          </div>
        ))}
      </div>

      {/* jogador local */}
      <div className={`youtag ${humanTurn ? "active" : ""}`}>
        <div className="av">{players[0][0]}</div>
        <div><div className="n">{players[0]}</div><div className="m">🂠 {counts[0]} · {cumulative[0]} pts</div></div>
      </div>
      {humanTurn && <div className="suavez">Sua vez</div>}

      {/* leque */}
      <div className="hand" style={{ width: fanWidth(hand.length) }}>
        {hand.map((c, i) => {
          const isLegal = legal.some((l) => same(l, c));
          const state = humanTurn ? (isLegal ? "legal" : "illegal") : "";
          return (
            <CardView key={c.rank + c.suit} card={c} cw={66} state={state as "legal" | "illegal" | ""}
              style={fanStyle(i, hand.length)}
              onClick={humanTurn && isLegal ? () => onPlay(c) : undefined} />
          );
        })}
      </div>

      {/* overlays */}
      {phase === "trump" && game.humanChoosesTrump() && (
        <TrumpOverlay onChoose={onChooseTrump} />
      )}
      {phase === "trump" && !game.humanChoosesTrump() && (
        <div className="suavez" style={{ bottom: "auto", top: "46%" }}>
          {oppName(game.awaitingTrumpFrom() as Seat)} está escolhendo o trunfo…
        </div>
      )}
      {phase === "handEnd" && <HandEndOverlay game={game} onAdvance={onAdvance} />}
      {phase === "matchEnd" && <MatchEndOverlay game={game} onHome={onHome} />}
    </div>
  );
}

function TrumpOverlay({ onChoose }: { onChoose: (t: Trump) => void }) {
  return (
    <div className="ov">
      <div className="ovcard">
        <h2>Escolha o trunfo</h2>
        <div className="sub">Sua mão positiva — escolha o naipe (ou Sem Trunfo).</div>
        <div className="trumpgrid">
          {TRUMPS.map((x) => (
            <button key={x.t} className={`trumpbtn ${x.red ? "red" : ""} ${x.t === "no-trump" ? "nt" : ""}`} onClick={() => onChoose(x.t)}>
              {x.sym}<small>{x.label}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function HandEndOverlay({ game, onAdvance }: { game: KingGame; onAdvance: () => void }) {
  const scores = game.lastHandScores() ?? [0, 0, 0, 0];
  const players = game.players();
  const rows = game.rankings();
  return (
    <div className="ov">
      <div className="ovcard">
        <h2>Fim da mão</h2>
        <div className="sub">{players.map((p, i) => `${p} ${fmt(scores[i])}`).join(" · ")}</div>
        {rows.map((r) => (
          <div key={r.seat} className="rankrow">
            <span className="pos">{r.tied ? "=" : r.position + "º"}</span>
            <span className="nm">{r.player}</span>
            <span className={`sc ${r.score < 0 ? "neg" : r.score > 0 ? "pos" : ""}`}>{r.score}</span>
          </div>
        ))}
        <div style={{ marginTop: 14 }}><button className="btn gold" onClick={onAdvance}>Próxima mão</button></div>
      </div>
    </div>
  );
}

function MatchEndOverlay({ game, onHome }: { game: KingGame; onHome: () => void }) {
  const rows = game.rankings();
  const champ = rows.find((r) => r.position === 1);
  const tie = rows.filter((r) => r.position === 1).length > 1;
  return (
    <div className="ov">
      <div className="ovcard">
        <h2>🏆 {tie ? "Empate!" : `${champ?.player} venceu!`}</h2>
        <div className="sub">Placar final da partida</div>
        {rows.map((r) => (
          <div key={r.seat} className="rankrow">
            <span className="pos">{r.tied ? "=" : r.position + "º"}</span>
            <span className="nm">{r.player}</span>
            <span className={`sc ${r.score < 0 ? "neg" : r.score > 0 ? "pos" : ""}`}>{r.score}</span>
          </div>
        ))}
        <div style={{ marginTop: 14 }}><button className="btn gold" onClick={onHome}>Voltar à Home</button></div>
      </div>
    </div>
  );
}

// helpers de layout / textos
function fanWidth(n: number) { const step = Math.min(46, 640 / Math.max(n, 1)); return (n - 1) * step + 66; }
function fanStyle(i: number, n: number): CSSProperties {
  const step = Math.min(46, 640 / Math.max(n, 1));
  const mid = (n - 1) / 2;
  const ang = (i - mid) * 2.3, x = i * step, y = Math.pow(Math.abs(i - mid), 1.25) * 2.1;
  return { position: "absolute", bottom: 0, left: x, transform: `rotate(${ang}deg) translateY(${y}px)`, zIndex: i };
}
function contractTitle(kind?: string): string {
  switch (kind) {
    case "no-tricks": return "Não faça vazas";
    case "no-hearts": return "❤️ Não faça Copas";
    case "no-queens": return "👸 Não faça Damas";
    case "no-men": return "Não faça Homens";
    case "no-king": return "👑♥ Fuja do King";
    case "no-last-two": return "Não faça as 2 últimas";
    case "positive": return "Positiva — faça vazas";
    default: return "";
  }
}
function penaltyText(kind?: string): string {
  switch (kind) {
    case "no-tricks": return "−20 / vaza";
    case "no-hearts": return "−20 / copa";
    case "no-queens": return "−50 / dama";
    case "no-men": return "−30 / homem";
    case "no-king": return "K♥ = −160";
    case "no-last-two": return "−90 (12ª e 13ª)";
    default: return "";
  }
}
function trumpLabel(t: Trump): string {
  if (t === "no-trump") return "Sem Trunfo";
  return SUIT_SYMBOL[t];
}
const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
