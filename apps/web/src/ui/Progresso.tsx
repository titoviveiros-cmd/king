import type { ComposicaoDoXp, ProgressoDoJogador, SequenciaDoJogador } from "../auth/progresso.js";
import { sequenciaDaPartida, type FaseDoXp, type XpDaPartida } from "../game/xpDaPartida.js";
import { sfxTap } from "../audio/sounds.js";

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

/** A porta da vitrine dos Itens da Coroa (Entrega B), dentro do card. */
export interface ItensDoCard {
  liberados: number;
  total: number;
  onAbrir: () => void;
}

/** Na Home: abaixo das ações de jogo, nunca competindo com elas. */
export function ProgressoNaHome({ progresso: p, itens }: { progresso: ProgressoDoJogador; itens?: ItensDoCard }) {
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
      {/* OS ITENS DA COROA: um botão curto no fim do card, só quando a vitrine existe. É a mesma
          pílula: nada novo empurra as ações da Home. */}
      {itens && (
        <button
          type="button"
          className="pg-itens"
          onClick={() => { sfxTap(); itens.onAbrir(); }}
          aria-label={`Itens da Coroa: ${itens.liberados} de ${itens.total} liberados`}
        >
          👑 <b>{itens.liberados}/{itens.total}</b>
        </button>
      )}
    </div>
  );
}

/**
 * PENALIDADE DO REI (Entrega C): a CONTA do XP, só quando há o que explicar (penalidade ou redução) e
 * só com as parcelas que o BANCO gravou. Tom de informação, não de castigo: cor discreta, sem vermelho,
 * e o "+N XP" creditado continua sendo o destaque. Os −160 pontos da mão são outra coisa e ficam no placar.
 */
export function contaDoXp(c: ComposicaoDoXp | undefined): { bruto: number; rei: number; diaria: number } | null {
  if (!c || (c.penalidadeRei === 0 && c.reducaoDiaria === 0)) return null;
  return { bruto: c.bruto, rei: c.penalidadeRei, diaria: c.reducaoDiaria };
}

function descreverConta(c: NonNullable<ReturnType<typeof contaDoXp>>): string {
  return [`${c.bruto} XP da partida`, c.rei > 0 ? `menos ${c.rei} pelo Rei de Copas` : "", c.diaria > 0 ? `menos ${c.diaria} de redução diária` : ""]
    .filter(Boolean).join(", ");
}

/**
 * No fim de uma partida ONLINE, depois da encenação: o que ela rendeu e onde o jogador ficou. Só
 * com crédito REAL e positivo — quem decide isso é `xpParaExibir`, antes de chegar aqui. A
 * sequência entra só quando ESTA partida qualificou o dia (`sequenciaDaPartida`).
 */
export function XpNoFim({ xp, matchId }: { xp: XpDaPartida; matchId?: string }) {
  const p = xp.progresso;
  const seq = sequenciaDaPartida(xp, matchId);
  const conta = contaDoXp(xp.credito.composicao);
  return (
    <div
      className="fimxp"
      role="status"
      aria-label={`Você ganhou ${xp.credito.xpDelta} XP nesta partida${conta ? ` (${descreverConta(conta)})` : ""}${seq !== null ? `; sequência de ${dias(seq)}` : ""}`}
    >
      <b className="fimxp-ganho">+{xp.credito.xpDelta} XP</b>
      {conta && (
        <span className="fimxp-conta" aria-hidden>
          <span className="fimxp-bruto">{conta.bruto}</span>
          {conta.rei > 0 && <span className="fimxp-rei">−{conta.rei} Rei de Copas</span>}
          {conta.diaria > 0 && <span className="fimxp-diaria">−{conta.diaria} redução diária</span>}
        </span>
      )}
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

/**
 * O XP AINDA NÃO CONFIRMADO (Entrega C). O crédito é gravado pelo servidor segundos depois do fim; até
 * o banco confirmar, a tela diz que está confirmando — e NENHUM número: nem bruto, nem penalidade do
 * Rei, nem redução, nem líquido. Se as tentativas acabarem sem crédito, diz que segue em confirmação
 * e que a Home mostra depois. Fora do multiplayer com sessão (`fora`) e com o crédito já lido
 * (`confirmado`, inclusive o de zero), não desenha nada.
 */
export function XpPendente({ fase }: { fase: FaseDoXp }) {
  if (fase !== "buscando" && fase !== "nao-confirmado") return null;
  const texto = fase === "buscando" ? "Confirmando o XP…" : "XP em confirmação · aparece na Home";
  const rotulo = fase === "buscando" ? "Confirmando o XP desta partida" : "O XP desta partida ainda está em confirmação; ele aparece na Home";
  return (
    <div className="fimxp fimxp-pendente" role="status" aria-label={rotulo}>
      <span className="fimxp-espera">{texto}</span>
    </div>
  );
}
