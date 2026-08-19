import type { KingGame } from "../game/kingGame.js";
import {
  contractTitle, penaltyTextLong, trumpLabel, earlyEndText, unitsText, fmtSigned, ordinal,
} from "./contractText.js";

/**
 * PLACAR ENTRE-MÃOS — o que aconteceu na mão que acabou, quanto cada um somou,
 * como ficou a classificação e qual é o próximo contrato.
 * Todos os números vêm de `game.summary()` (autoridade do motor); aqui só se formata.
 * Na 10ª mão a mesma tela vira o placar final da partida.
 */
export function Placar({
  game, onAdvance, onHome, onRestart,
}: {
  game: KingGame;
  onAdvance: () => void;
  onHome: () => void;
  onRestart: () => void;
}) {
  const s = game.summary();
  if (!s) return null;

  const { breakdown: bd, contract } = s;
  const rows = s.rankAfter;
  const posBefore = new Map(s.rankBefore.map((r) => [r.seat, r.position]));
  const champions = rows.filter((r) => r.position === 1);

  return (
    <div className="ov placarov">
      <div className="placar">
        <header className="pl-head">
          <div className="pl-eyebrow">
            {s.finished
              ? "Partida encerrada · 10 mãos"
              : `Mão ${s.handNumber} de 10 · ${contract.isPositive ? "Fase positiva" : "Fase negativa"}`}
          </div>
          <h2 className="pl-title">
            {s.finished
              ? (champions.length > 1
                  ? `🏆 Empate: ${champions.map((c) => c.player).join(" e ")}`
                  : `🏆 ${champions[0].player} venceu!`)
              : contractTitle(contract.kind)}
          </h2>
          <div className="pl-meta">
            {s.finished && <span className="pl-tag">Última mão: {contractTitle(contract.kind)}</span>}
            <span className="pl-tag">{penaltyTextLong(contract.kind)}</span>
            {s.trump && (
              <span className="pl-tag turq">
                Trunfo {trumpLabel(s.trump)}
                {s.chooser !== null && ` · ${game.players()[s.chooser]}`}
              </span>
            )}
            <span className="pl-tag">{bd.tricksPlayed} vazas jogadas</span>
            {s.earlyEnd && <span className="pl-tag early">{earlyEndText(contract.kind, bd.tricksPlayed)}</span>}
          </div>
        </header>

        <div className="pl-legend">
          <span /><span /><span />
          <span>Jogador</span>
          <span className="rt">Nesta mão</span>
          <span className="rt">Total</span>
        </div>

        <div className="pl-rows">
          {rows.map((r) => {
            const b = bd.rows[r.seat];
            const move = (posBefore.get(r.seat) ?? r.position) - r.position;
            return (
              <div key={r.seat} className={`pl-row${r.seat === 0 ? " you" : ""}${r.position === 1 ? " lead" : ""}`}>
                <span className="pl-pos">{ordinal(r.position)}{r.tied && <i>=</i>}</span>
                <span className={`pl-mov ${move > 0 ? "up" : move < 0 ? "down" : "flat"}`}>
                  {move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : "–"}
                </span>
                <span className={`pl-av s${r.seat}`}>{r.player[0]}</span>
                <span className="pl-name">
                  {r.player}
                  <i className="pl-detail">{detail(b.units, b.tricks, bd, contract.isPositive)}</i>
                </span>
                <span className={`pl-delta ${deltaClass(b.points)}`}>{fmtSigned(b.points)}</span>
                <span className="pl-total">{fmtSigned(r.score)}</span>
              </div>
            );
          })}
        </div>

        <footer className="pl-foot">
          {s.nextContract ? (
            <div className="pl-next">
              <b>A seguir · Mão {s.nextContract.hand}</b>
              <span>
                {contractTitle(s.nextContract.kind)} · {penaltyTextLong(s.nextContract.kind)}
                {s.nextTrumpChooser !== null && ` · trunfo com ${game.players()[s.nextTrumpChooser]}`}
              </span>
            </div>
          ) : (
            <div className="pl-next">
              <b>Fim de partida</b>
              <span>Soma dos saldos = 0 (checksum do KING)</span>
            </div>
          )}
          <div className="pl-actions">
            {s.finished ? (
              <>
                <button className="btn violet" onClick={onHome}>Home</button>
                <button className="btn gold" autoFocus onClick={onRestart}>Nova partida</button>
              </>
            ) : (
              <button className="btn gold" autoFocus onClick={onAdvance}>Próxima mão ▸</button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

/** "2 damas · 5 vazas" — nas mãos em que unidade ≠ vaza, mostra as duas informações. */
function detail(
  units: number,
  tricks: number,
  bd: { unit: string; unitPlural: string },
  isPositive: boolean,
): string {
  const unitIsTrick = bd.unit === "vaza";
  if (units === 0) {
    const clean = isPositive ? "nenhuma vaza" : "escapou";
    return unitIsTrick ? clean : `${clean} · ${unitsText(tricks, "vaza", "vazas")}`;
  }
  const main = unitsText(units, bd.unit, bd.unitPlural);
  return unitIsTrick ? main : `${main} · ${unitsText(tricks, "vaza", "vazas")}`;
}

const deltaClass = (n: number) => (n < 0 ? "neg" : n > 0 ? "pos" : "zero");
