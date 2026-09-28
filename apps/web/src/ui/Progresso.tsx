import type { ProgressoDoJogador } from "../auth/progresso.js";
import type { XpDaPartida } from "../game/xpDaPartida.js";

/**
 * A PROGRESSÃO DO JOGADOR, como o Design System a define: orgânica, NÃO dashboard — badge de
 * nível em ouro e barra de XP turquesa→violeta. Só o essencial.
 *
 * Os números são os do BANCO (`meu_progresso`): o nível e o quanto falta vêm prontos de lá. Nada
 * de fórmula de nível aqui — uma segunda fórmula um dia discordaria da primeira.
 */
function percentual(p: ProgressoDoJogador): number {
  if (p.xpDoNivel <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((p.xpNoNivel / p.xpDoNivel) * 100)));
}

function Barra({ p }: { p: ProgressoDoJogador }) {
  return <span className="pg-barra" aria-hidden><i style={{ width: `${percentual(p)}%` }} /></span>;
}

/** Na Home: abaixo das ações de jogo, nunca competindo com elas. */
export function ProgressoNaHome({ progresso: p }: { progresso: ProgressoDoJogador }) {
  return (
    <div
      className="hm-progresso"
      role="group"
      aria-label={`Nível ${p.nivel}: ${p.xpNoNivel} de ${p.xpDoNivel} XP neste nível, ${p.xpTotal} XP no total`}
    >
      <span className="pg-nivel"><small>Nível</small><b>{p.nivel}</b></span>
      <span className="pg-meio">
        <Barra p={p} />
        <span className="pg-numeros"><b>{p.xpNoNivel}</b> / {p.xpDoNivel} XP</span>
      </span>
      <span className="pg-total">{p.xpTotal} XP total</span>
    </div>
  );
}

/**
 * No fim de uma partida ONLINE, depois da encenação: o que ela rendeu e onde o jogador ficou. Só
 * com crédito REAL e positivo — quem decide isso é `xpParaExibir`, antes de chegar aqui.
 */
export function XpNoFim({ xp }: { xp: XpDaPartida }) {
  const p = xp.progresso;
  return (
    <div className="fimxp" role="status" aria-label={`Você ganhou ${xp.credito.xpDelta} XP nesta partida`}>
      <b className="fimxp-ganho">+{xp.credito.xpDelta} XP</b>
      {p && (
        <span className="fimxp-nivel">
          <span className="fimxp-rotulo">Nível {p.nivel}</span>
          <Barra p={p} />
          <span className="fimxp-num">{p.xpNoNivel} / {p.xpDoNivel} XP</span>
        </span>
      )}
    </div>
  );
}
