// MEUS RECORDES (Entrega D) — Top 3 Solo e Online, a evolução de XP, o próximo item da Coroa e as
// últimas partidas online. E "NOVO RECORDE!", a celebração curta do Placar Final.
//
// Tudo o que é ONLINE vem do banco (pelo leitor, só as próprias linhas); tudo o que é SOLO vem deste
// aparelho e diz isso. Nada aqui calcula nível: o XP de cada nível vem do banco (`xp_por_nivel`), e
// o nível e o XP do jogador vêm de `meu_progresso`. Sem conta, a parte online explica como começar;
// com o banco fora, diz que está indisponível — nunca inventa um zero.
import { useEffect, useRef, useState } from "react";
import { sfxTap } from "../audio/sounds.js";
import { Crown } from "./Crown.js";
import { AmostraDoItem } from "./Cosmeticos.js";
import { proximoDesbloqueio } from "../auth/cosmeticos.js";
import { dataBr, topSolo, type LeitorDeRecordes, type Modalidade, type PartidaRecente, type Recorde } from "../auth/recordes.js";
import type { ProgressoDoJogador } from "../auth/progresso.js";
import type { NovoRecordeDaPartida } from "../game/useNovoRecorde.js";

const NUM = new Intl.NumberFormat("pt-BR");
/** A pontuação com sinal, como no placar: +320, −45, 0. */
export const comSinal = (n: number): string => (n > 0 ? `+${NUM.format(n)}` : n < 0 ? `−${NUM.format(-n)}` : "0");
const MEDALHA = ["ouro", "prata", "bronze"] as const;
const ORDINAL = ["1º", "2º", "3º", "4º"];

/** O que a parte online tem para mostrar. `null` em cada campo = indisponível (banco fora, sem migração). */
interface DadosOnline {
  top: Recorde[] | null;
  recentes: PartidaRecente[] | null;
  xpDoAlvo: number | null;
}

function TopTres({ linhas, modo }: { linhas: Recorde[]; modo: Modalidade }) {
  return (
    <ol className="rec-top" aria-label={`Top 3 ${modo === "solo" ? "Solo" : "Online"}`}>
      {[0, 1, 2].map((i) => {
        const r = linhas[i];
        return (
          <li key={i} className={`rec-linha ${MEDALHA[i]}${r ? "" : " vazia"}`}>
            <span className="rec-medalha" aria-hidden>{ORDINAL[i]}</span>
            {r ? (
              <>
                <span className="rec-pontos">{comSinal(r.pontos)}<small> pts</small></span>
                <span className="rec-meta">{dataBr(r.em)} · {modo === "solo" ? "Solo" : "Online"}</span>
              </>
            ) : <span className="rec-meta">—</span>}
          </li>
        );
      })}
    </ol>
  );
}

const ROTULO_DA_POSICAO = ["Vitória", "2º lugar", "3º lugar", "4º lugar"];

export function MeusRecordes({ progresso, leitor, onFechar }: {
  /** O progresso do banco (`meu_progresso`); `null` = sem conta ou indisponível. */
  progresso: ProgressoDoJogador | null;
  /** O leitor dos recordes online; `null` = esta publicação não tem identidade. */
  leitor: LeitorDeRecordes | null;
  onFechar: () => void;
}) {
  const [aba, setAba] = useState<Modalidade>("solo");
  const [solo] = useState<Recorde[]>(() => topSolo());
  const [online, setOnline] = useState<DadosOnline | null>(null);
  const proximo = progresso ? proximoDesbloqueio(progresso.nivel) : null;

  // UMA leitura por abertura: o Top 3, as recentes e o XP do nível do próximo item, juntos.
  useEffect(() => {
    if (!leitor || !progresso) return;
    let vivo = true;
    void Promise.all([leitor.topOnline(), leitor.recentes(), proximo ? leitor.xpDoNivel(proximo.nivel) : Promise.resolve(null)])
      .then(([top, recentes, xpDoAlvo]) => { if (vivo) setOnline({ top, recentes, xpDoAlvo }); });
    return () => { vivo = false; };
  }, [leitor, progresso, proximo]);

  // PRÓXIMO DESBLOQUEIO: o progresso REAL do começo do nível atual até o nível do item.
  const inicioDoNivel = progresso ? progresso.xpTotal - progresso.xpNoNivel : 0;
  const alvo = online?.xpDoAlvo ?? null;
  const fracaoAteOItem = progresso && alvo !== null && alvo > inicioDoNivel
    ? Math.min(1, Math.max(0, (progresso.xpTotal - inicioDoNivel) / (alvo - inicioDoNivel))) : null;
  const fracaoDoNivel = progresso && progresso.xpDoNivel > 0 ? Math.min(1, progresso.xpNoNivel / progresso.xpDoNivel) : 0;

  return (
    <div className="ov" onClick={onFechar}>
      <div className="ovcard recordes" role="dialog" aria-modal="true" aria-labelledby="rec-titulo" onClick={(e) => e.stopPropagation()}>
        <h2 id="rec-titulo"><span aria-hidden>🏆</span> Meus Recordes</h2>
        <div className="rec-lista">
          {/* ── MINHA EVOLUÇÃO ── */}
          <section className="rec-secao rec-evolucao" aria-labelledby="rec-evo">
            <h3 id="rec-evo" className="rec-titulo">Minha evolução</h3>
            {progresso ? (
              <>
                <div className="rec-nivel"><span>Nível</span><b>{progresso.nivel}</b><span className="rec-total">{NUM.format(progresso.xpTotal)} XP no total</span></div>
                <div className="rec-barra" role="progressbar" aria-label={`XP no nível ${progresso.nivel}`}
                  aria-valuemin={0} aria-valuemax={progresso.xpDoNivel} aria-valuenow={progresso.xpNoNivel}>
                  <i style={{ width: `${Math.round(fracaoDoNivel * 100)}%` }} />
                </div>
                <p className="rec-linha-txt">
                  <b>{NUM.format(progresso.xpNoNivel)}</b> / {NUM.format(progresso.xpDoNivel)} XP neste nível · faltam{" "}
                  <b>{NUM.format(Math.max(0, progresso.xpDoNivel - progresso.xpNoNivel))} XP</b> para o nível {progresso.nivel + 1}
                </p>
                {progresso.sequencia && progresso.sequencia.recorde > 0 && (
                  <p className="rec-linha-txt">🔥 Recorde de sequência: <b>{progresso.sequencia.recorde} {progresso.sequencia.recorde === 1 ? "dia" : "dias"}</b></p>
                )}
              </>
            ) : <p className="rec-vazio">O XP vem das partidas online com outras pessoas. Jogue uma para começar a evoluir.</p>}
          </section>

          {/* ── PRÓXIMO DESBLOQUEIO ── */}
          {progresso && (
            <section className="rec-secao rec-proximo" aria-labelledby="rec-prox">
              <h3 id="rec-prox" className="rec-titulo">Próximo desbloqueio</h3>
              {proximo ? (
                <div className="rec-item">
                  <AmostraDoItem id={proximo.id} />
                  <div className="rec-item-txt">
                    <b>{proximo.nome}</b>
                    <span>no nível {proximo.nivel}{alvo !== null && progresso.xpTotal < alvo ? ` · faltam ${NUM.format(alvo - progresso.xpTotal)} XP` : ""}</span>
                    {fracaoAteOItem !== null && (
                      <div className="rec-barra fina" role="progressbar" aria-label={`Progresso até o nível ${proximo.nivel}`}
                        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fracaoAteOItem * 100)}>
                        <i style={{ width: `${Math.round(fracaoAteOItem * 100)}%` }} />
                      </div>
                    )}
                  </div>
                </div>
              ) : <p className="rec-vazio">Todos os itens da Coroa desbloqueados.</p>}
            </section>
          )}

          {/* ── TOP 3 ── */}
          <section className="rec-secao rec-recordes" aria-labelledby="rec-top">
            <div className="rec-cabeca">
              <h3 id="rec-top" className="rec-titulo">Top 3 — maiores pontuações finais</h3>
              <div className="rec-abas" role="tablist" aria-label="Modalidade">
                {(["solo", "online"] as const).map((m) => (
                  <button key={m} role="tab" aria-selected={aba === m} className={`rec-aba${aba === m ? " on" : ""}`}
                    onClick={() => { sfxTap(); setAba(m); }}>{m === "solo" ? "Solo" : "Online"}</button>
                ))}
              </div>
            </div>
            {aba === "solo" ? (
              solo.length > 0
                ? <><TopTres linhas={solo} modo="solo" /><p className="rec-nota">Recordes deste aparelho, contra os bots — partidas completas de 10 mãos.</p></>
                : <p className="rec-vazio">Nenhum recorde solo ainda. Termine uma partida contra os bots para marcar o primeiro.</p>
            ) : !leitor || !progresso ? (
              <p className="rec-vazio">Jogue uma partida online com outras pessoas para ter recordes online.</p>
            ) : !online ? (
              <p className="rec-vazio" role="status">Carregando…</p>
            ) : online.top === null ? (
              <p className="rec-vazio">Recordes online indisponíveis agora.</p>
            ) : online.top.length > 0 ? (
              <><TopTres linhas={online.top} modo="online" /><p className="rec-nota">Pontuação confirmada pelo servidor, em partidas online completas.</p></>
            ) : <p className="rec-vazio">Nenhum recorde online ainda. Eles contam a partir da sua próxima partida online completa.</p>}
          </section>

          {/* ── HISTÓRICO RECENTE (online) ── */}
          {leitor && progresso && (
            <section className="rec-secao rec-historico" aria-labelledby="rec-hist">
              <h3 id="rec-hist" className="rec-titulo">Últimas partidas online</h3>
              {!online ? <p className="rec-vazio" role="status">Carregando…</p>
                : online.recentes === null ? <p className="rec-vazio">Histórico indisponível agora.</p>
                : online.recentes.length === 0 ? <p className="rec-vazio">Nenhuma partida online ainda.</p>
                : (
                  <ul className="rec-recentes">
                    {online.recentes.map((p) => (
                      <li key={p.id} className={`rec-recente p${p.posicao}`}>
                        <span className="rec-data">{dataBr(p.em)}</span>
                        <span className="rec-resultado">{ROTULO_DA_POSICAO[p.posicao - 1]}</span>
                        <span className="rec-xp">+{NUM.format(p.xp)} XP</span>
                      </li>
                    ))}
                  </ul>
                )}
            </section>
          )}
        </div>
        <button className="btn gold rec-fechar" onClick={() => { sfxTap(); onFechar(); }}>Voltar</button>
      </div>
    </div>
  );
}

/** Quanto a celebração fica sozinha na tela, se ninguém tocar. */
export const DURACAO_DO_RECORDE_MS = 5_500;

/**
 * "NOVO RECORDE!" — sobre o Placar Final, DEPOIS da encenação: coroa, a posição no Top 3, a
 * pontuação e a modalidade. Um toque fecha. Não toca som nem vibra (o Placar Final já tocou o dele).
 */
export function NovoRecorde({ recorde, onFechar }: { recorde: NovoRecordeDaPartida; onFechar: () => void }) {
  const [saindo, setSaindo] = useState(false);
  const fim = useRef(onFechar);
  fim.current = onFechar;
  useEffect(() => {
    const id = window.setTimeout(() => setSaindo(true), DURACAO_DO_RECORDE_MS);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!saindo) return;
    const id = window.setTimeout(() => fim.current(), 300);
    return () => window.clearTimeout(id);
  }, [saindo]);
  const medalha = MEDALHA[recorde.posicao - 1];
  return (
    <div className={`novorecorde${saindo ? " saindo" : ""}`} role="status" aria-live="polite"
      onClick={(e) => { e.stopPropagation(); setSaindo(true); }}>
      <div className={`nr-cartao ${medalha}`}>
        <span className="nr-coroa" aria-hidden><Crown size={52} /></span>
        <span className="nr-brilho" aria-hidden />
        <b className="nr-titulo">NOVO RECORDE!</b>
        <span className="nr-posicao">{ORDINAL[recorde.posicao - 1]} do seu Top 3 · {recorde.modo === "solo" ? "Solo" : "Online"}</span>
        <span className="nr-pontos">{comSinal(recorde.pontos)}<small> pts</small></span>
        <span className="nr-toque">toque para fechar</span>
      </div>
    </div>
  );
}
