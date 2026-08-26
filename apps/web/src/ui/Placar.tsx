import type { LeituraDaPartida } from "../game/leituraDaPartida.js";
import {
  contractTitle, penaltyTextLong, trumpLabel, earlyEndText, unitsText, fmtSigned, ordinal,
} from "./contractText.js";
import {
  BalaoSocial, BotaoSocial, ConsensoDaProximaMao, type MesaMultiplayer,
} from "./MesaOnline.js";

/**
 * PLACAR ENTRE-MÃOS — o que aconteceu na mão que acabou, quanto cada um somou,
 * como ficou a classificação e qual é o próximo contrato.
 * Todos os números vêm de `game.summary()` (autoridade do motor); aqui só se formata.
 * Na 10ª mão a mesma tela vira o placar final da partida.
 */
export function Placar({
  game, onAdvance, onHome, onRestart, mp,
}: {
  game: LeituraDaPartida;
  onAdvance: () => void;
  onHome: () => void;
  onRestart: () => void;
  /** Presente só no multiplayer: "Continuar" vira voto e o Placar mostra quem já confirmou. */
  mp?: MesaMultiplayer;
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
              <div key={r.seat} className={`pl-row${r.seat === game.humanSeat ? " you" : ""}${r.position === 1 ? " lead" : ""}`}>
                <span className="pl-pos">{ordinal(r.position)}{r.tied && <i>=</i>}</span>
                <span className={`pl-mov ${move > 0 ? "up" : move < 0 ? "down" : "flat"}`}>
                  {move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : "–"}
                </span>
                <span className={`pl-av s${r.seat}`}>{r.player[0]}</span>
                <span className="pl-name">
                  {r.player}
                  <i className="pl-detail">{detail(b.units, bd, contract.isPositive)}</i>
                </span>
                <span className={`pl-delta ${deltaClass(b.points)}`}>{fmtSigned(b.points)}</span>
                <span className="pl-total">{fmtSigned(r.score)}</span>
                {/* A MENSAGEM APARECE AQUI TAMBÉM, e é a correção do bug que o aparelho achou.
                    A mensagem sempre foi entregue: o servidor difundia, o cliente recebia, o
                    balão renderizava. Só que o balão mora nos cards da MESA, e o Placar é um
                    overlay POR CIMA da Mesa. Quem estava no intervalo mandava, o outro recebia, e
                    ninguém via nada — porque o balão nascia atrás da tela que os dois estavam
                    olhando. O mesmo `mp.mensagens`, desenhado na camada certa. */}
                {mp && <BalaoSocial mensagem={mp.mensagens[r.seat]} />}
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
          {/* MENSAGENS RÁPIDAS TAMBÉM AQUI.
              Entre as mãos existe a única pausa do KING: todo mundo parado, olhando a mesma tela
              ao mesmo tempo. Era o melhor momento para dizer algo e o único em que não dava, porque
              o Placar cobre a Mesa e levava o botão junto.

              É o MESMO componente da Mesa, com o mesmo catálogo fechado, a mesma etiqueta viajando,
              a mesma validação e o mesmo anti-spam do servidor. Só o ponto de ancoragem muda, e os
              seis atalhos são outros: no intervalo ninguém comenta a jogada que passou, comenta o
              resultado da mão e o que vem pela frente. */}
          {mp && !s.finished && (
            <BotaoSocial status="placar" variante="placar" onEnviar={mp.onEnviarMensagem} />
          )}

          <div className="pl-actions">
            {s.finished ? (
              <>
                <button className="btn violet" onClick={onHome}>Home</button>
                {mp
                  ? <button className="btn gold" autoFocus onClick={onHome}>Sair da sala</button>
                  : <button className="btn gold" autoFocus onClick={onRestart}>Nova partida</button>}
              </>
            ) : mp ? (
              <ConsensoDaProximaMao mp={mp} players={game.players()} onAdvance={onAdvance} />
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
/**
 * O que cada jogador capturou. Mostra **só o que pontua**.
 *
 * Em "Não pegar Q", quantas vazas alguém levou é irrelevante — vaza sem Dama não custa nada,
 * e informar isso só concorre com o número que importa. O mesmo vale para Copas, Reis/Valetes,
 * K de Copas e as duas últimas. Nos contratos em que a **vaza é a própria unidade** (não pegar
 * Vazas e as positivas), ela continua sendo o dado principal.
 */
function detail(units: number, bd: { unit: string; unitPlural: string }, isPositive: boolean): string {
  if (units === 0) return isPositive ? "nenhuma vaza" : "escapou";
  return unitsText(units, bd.unit, bd.unitPlural);
}

const deltaClass = (n: number) => (n < 0 ? "neg" : n > 0 ? "pos" : "zero");
