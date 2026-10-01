import type { ProgressoDoJogador, SequenciaDoJogador } from "../auth/progresso.js";
import { sequenciaDaPartida, type XpDaPartida } from "../game/xpDaPartida.js";

/**
 * A PROGRESSÃO DO JOGADOR, como o Design System a define: orgânica, NÃO dashboard — badge de
 * nível em ouro e barra de XP turquesa→violeta. Só o essencial.
 *
 * Os números são os do BANCO (`meu_progresso`): o nível e o quanto falta vêm prontos de lá. Nada
 * de fórmula de nível aqui — uma segunda fórmula um dia discordaria da primeira. A sequência
 * segue a mesma regra: chega EFETIVA do banco, e nada aqui conta dia ou olha o relógio.
 */
function percentual(p: ProgressoDoJogador): number {
  if (p.xpDoNivel <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((p.xpNoNivel / p.xpDoNivel) * 100)));
}

function Barra({ p }: { p: ProgressoDoJogador }) {
  return <span className="pg-barra" aria-hidden><i style={{ width: `${percentual(p)}%` }} /></span>;
}

export const dias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

/** O recorde só aparece quando diz algo que a sequência atual não diz. */
const recordeVisivel = (s: SequenciaDoJogador) => s.recorde > s.atual && s.recorde >= 2;

/**
 * O CONVITE do estado zero diz ONLINE porque essa é a regra: a sequência anda com XP, e partida
 * contra os bots não dá XP. Um "jogue hoje" solto prometeria o que uma partida solo não entrega.
 * Linguagem de convite, nunca de cobrança: nada de "perdeu", "quebrou" ou contagem regressiva.
 */
export const CONVITE_DA_SEQUENCIA = "Comece hoje: jogue online";

function descreverSequencia(s: SequenciaDoJogador): string {
  const base = s.atual > 0 ? `sequência de ${dias(s.atual)}` : "nenhuma sequência ativa";
  return recordeVisivel(s) ? `${base}, recorde de ${dias(s.recorde)}` : base;
}

/** Na Home: abaixo das ações de jogo, nunca competindo com elas. */
export function ProgressoNaHome({ progresso: p }: { progresso: ProgressoDoJogador }) {
  const s = p.sequencia;
  const total = <span className="pg-total">{p.xpTotal} XP total</span>;
  return (
    <div
      className="hm-progresso"
      role="group"
      aria-label={`Nível ${p.nivel}: ${p.xpNoNivel} de ${p.xpDoNivel} XP neste nível, ${p.xpTotal} XP no total${s ? `; ${descreverSequencia(s)}` : ""}`}
    >
      <span className="pg-nivel"><small>Nível</small><b>{p.nivel}</b></span>
      <span className="pg-meio">
        <Barra p={p} />
        <span className="pg-numeros"><b>{p.xpNoNivel}</b> / {p.xpDoNivel} XP</span>
      </span>
      {/* Sem sequência (banco sem a migração), o card é EXATAMENTE o de antes. Com ela, a lateral
          vira uma pilha curta, da altura do badge: o card não cresce. */}
      {!s ? total : (
        <span className="pg-lado">
          {total}
          <span className={`pg-seq${s.hoje ? " hoje" : ""}`}>
            {s.atual > 0 ? `🔥 Sequência ${dias(s.atual)}` : `🔥 ${CONVITE_DA_SEQUENCIA}`}
          </span>
          {recordeVisivel(s) && <span className="pg-recorde">Recorde: {dias(s.recorde)}</span>}
        </span>
      )}
    </div>
  );
}

/**
 * No fim de uma partida ONLINE, depois da encenação: o que ela rendeu e onde o jogador ficou. Só
 * com crédito REAL e positivo — quem decide isso é `xpParaExibir`, antes de chegar aqui. A
 * sequência entra só quando ESTA partida qualificou o dia (`sequenciaDaPartida`).
 */
export function XpNoFim({ xp, matchId }: { xp: XpDaPartida; matchId?: string }) {
  const p = xp.progresso;
  const seq = sequenciaDaPartida(xp, matchId);
  return (
    <div
      className="fimxp"
      role="status"
      aria-label={`Você ganhou ${xp.credito.xpDelta} XP nesta partida${seq !== null ? `; sequência de ${dias(seq)}` : ""}`}
    >
      <b className="fimxp-ganho">+{xp.credito.xpDelta} XP</b>
      {p && (
        <span className="fimxp-nivel">
          <span className="fimxp-rotulo">Nível {p.nivel}</span>
          <Barra p={p} />
          <span className="fimxp-num">{p.xpNoNivel} / {p.xpDoNivel} XP</span>
        </span>
      )}
      {seq !== null && <span className="fimxp-seq">🔥 Sequência: {dias(seq)}</span>}
    </div>
  );
}
