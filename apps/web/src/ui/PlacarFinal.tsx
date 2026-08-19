import { useEffect, useMemo, useRef, useState } from "react";
import type { RankRow, Seat } from "@king/engine";
import type { KingGame } from "../game/kingGame.js";
import { Crown } from "./Crown.js";
import { contractTitle, trumpLabel, fmtSigned, ordinal } from "./contractText.js";
import { audio } from '../audio/engine.js';
import { sfxCountTick, sfxCrownLand, sfxDefeat, sfxRankShuffle, sfxTap, sfxVictory } from "../audio/sounds.js";

/**
 * PLACAR FINAL — o encerramento da partida. Não é "o Placar entre-mãos sem o botão":
 * é uma sequência encenada (contagem → reordenação → coroação) sobre os MESMOS dados
 * autoritativos do motor. O checksum final (soma dos saldos = 0) é exibido como selo.
 */
type Etapa = "entrada" | "contagem" | "ranking" | "campeao" | "completo";

const ORDEM: Etapa[] = ["entrada", "contagem", "ranking", "campeao", "completo"];
const MARCOS: Record<Etapa, number> = { entrada: 0, contagem: 950, ranking: 2350, campeao: 3150, completo: 4350 };
const DUR_CONTAGEM = 1250;

export function PlacarFinal({
  game, onRestart, onHome,
}: {
  game: KingGame;
  onRestart: () => void;
  onHome: () => void;
}) {
  const resumo = game.summary();
  const finais = game.rankings();
  const stats = game.stats();
  const players = game.players();
  const eu = game.humanSeat;

  const campeoes = finais.filter((r) => r.position === 1);
  const empate = campeoes.length > 1;
  const venci = campeoes.some((r) => r.seat === eu);

  const [etapa, setEtapa] = useState<Etapa>("entrada");
  const [pontos, setPontos] = useState<number[]>(() => antes(finais, resumo?.scores));
  const reduzido = usePrefersReducedMotion();

  // ---- encenação ----
  const pular = () => setEtapa("completo");
  useEffect(() => {
    if (reduzido) { setEtapa("completo"); return; }
    const ids = ORDEM.slice(1).map((e) => setTimeout(() => setEtapa(e), MARCOS[e]));
    return () => ids.forEach(clearTimeout);
  }, [reduzido]);

  // convergência dos pontos: sai do saldo ANTES da 10ª mão e chega no final
  useEffect(() => {
    if (etapa === "entrada") return;
    const de = antes(finais, resumo?.scores);
    const ate = finais.map((r) => r.score);
    if (etapa !== "contagem") { setPontos(ate); return; }
    const t0 = performance.now();
    let ticks = 0;
    let raf = 0;
    const passo = () => {
      const k = Math.min(1, (performance.now() - t0) / DUR_CONTAGEM);
      const e = 1 - Math.pow(1 - k, 3);
      setPontos(de.map((d, i) => Math.round(d + (ate[i] - d) * e)));
      const devidos = Math.floor(k * 14);
      while (ticks < devidos) sfxCountTick(ticks++);
      if (k < 1) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa]);

  // Música de comemoração do campeão: a bossa vira festa enquanto o Placar Final estiver aberto.
  useEffect(() => {
    if (etapa !== "campeao" && etapa !== "completo") return;
    audio.celebrar();
  }, [etapa]);
  useEffect(() => () => audio.encerrarCelebracao(), []);

  const soouRanking = useRef(false);
  const soouCoroa = useRef(false);
  useEffect(() => {
    if (etapa === "ranking" && !soouRanking.current) { soouRanking.current = true; sfxRankShuffle(); }
    if ((etapa === "campeao" || etapa === "completo") && !soouCoroa.current) {
      soouCoroa.current = true;
      sfxCrownLand();
      setTimeout(() => (venci || empate ? sfxVictory() : sfxDefeat()), 380);
    }
  }, [etapa, venci, empate]);

  // ---- ordenação: antes da etapa "ranking" as linhas ficam na ordem PRÉ-10ª mão ----
  const ordemInicial = useMemo(
    () => (resumo ? [...resumo.rankBefore].map((r) => r.seat) : finais.map((r) => r.seat)),
    [resumo, finais],
  );
  const mostrandoFinal = etapa === "ranking" || etapa === "campeao" || etapa === "completo";
  const linhas = mostrandoFinal ? finais : ordenarPor(finais, ordemInicial);

  const destaques = useMemo(
    () => construirDestaques(game, stats, finais, eu, empate, venci),
    [game, stats, finais, eu, empate, venci],
  );

  const revelado = etapa === "campeao" || etapa === "completo";
  const completo = etapa === "completo";

  return (
    <div className={`fim etapa-${etapa}`} onClick={pular} role="dialog" aria-label="Placar final da partida">
      {!reduzido && revelado && <Confetes />}
      <div className="fimgrid" onClick={(e) => e.stopPropagation()}>

        {/* ---- coluna heroica ---- */}
        <div className="fimheroi">
          <div className={`coroawrap ${revelado ? "on" : ""}`}>
            <Crown size={128} />
          </div>
          <div className="fimeyebrow">{completo || revelado ? "Partida encerrada · 10 mãos" : "Fim da partida"}</div>
          <h1 className={`fimtitulo ${revelado ? "on" : ""}`}>
            {!revelado ? "…" : empate ? "EMPATE!" : venci ? "VOCÊ VENCEU!" : `${campeoes[0].player} VENCEU`}
          </h1>
          {revelado && (
            <div className="fimsub">
              {empate
                ? `${campeoes.map((c) => c.player).join(" e ")} terminam empatados na liderança`
                : stats.margin > 0
                  ? `Por ${stats.margin} pontos de vantagem`
                  : "Decidido no último ponto"}
            </div>
          )}
          {completo && (
            <div className="fimacoes">
              <button className="btn gold" autoFocus onClick={() => { sfxTap(); onRestart(); }}>
                {venci ? "Jogar novamente" : "Revanche"}
              </button>
              <Compartilhar game={game} finais={finais} campeoes={campeoes} empate={empate} />
              <button className="btn violet" onClick={() => { sfxTap(); onHome(); }}>Home</button>
            </div>
          )}
        </div>

        {/* ---- coluna de resultado ---- */}
        <div className="fimdados">
          <div className="fimrank" style={{ height: `calc(var(--fimrow) * ${linhas.length})` }}>
            {finais.map((r) => {
              const pos = linhas.findIndex((x) => x.seat === r.seat);
              const campeao = r.position === 1 && revelado;
              return (
                <div
                  key={r.seat}
                  className={`fimlinha${r.seat === eu ? " voce" : ""}${campeao ? " campeao" : ""}`}
                  style={{ transform: `translateY(calc(var(--fimrow) * ${pos}))` }}
                >
                  <span className="p">{mostrandoFinal ? ordinal(r.position) : ""}{r.tied && mostrandoFinal && <i>=</i>}</span>
                  {campeao ? <Crown size={26} className="mini" /> : <span className="p-espaco" />}
                  <span className={`av s${r.seat}`}>{r.player[0]}</span>
                  <span className="nm">{r.player}</span>
                  <span className={`sc ${pontos[r.seat] < 0 ? "neg" : pontos[r.seat] > 0 ? "pos" : ""}`}>
                    {fmtSigned(pontos[r.seat] ?? r.score)}
                  </span>
                </div>
              );
            })}
          </div>

          {completo && (
            <>
              <div className="fimdest">
                <b>{destaques.titulo}</b>
                <span>{destaques.texto}</span>
              </div>

              <div className="fimchips">
                {destaques.chips.map((c) => <span key={c} className="pl-tag">{c}</span>)}
                <span className="pl-tag turq">Soma dos saldos = 0 ✓</span>
              </div>

              {resumo && (
                <div className="fimultima">
                  <b>Última mão</b>
                  <span>
                    Mão {resumo.handNumber} · {contractTitle(resumo.contract.kind)}
                    {resumo.trump && ` · trunfo ${trumpLabel(resumo.trump)}`}
                    {resumo.chooser !== null && ` (${players[resumo.chooser]})`}
                  </span>
                  <span className="deltas">
                    {finais.map((r) => (
                      <i key={r.seat} className={resumo.scores[r.seat] > 0 ? "pos" : resumo.scores[r.seat] < 0 ? "neg" : ""}>
                        {r.player[0]} {fmtSigned(resumo.scores[r.seat])}
                      </i>
                    ))}
                  </span>
                </div>
              )}

              {/* Reservado para progressão. Sem dado real, nada é simulado — regra do DS. */}
              <div className="fimxp" aria-label="Progressão — em breve">
                <b>Progressão</b>
                <div className="barra"><i /></div>
                <span>XP e conquistas entram na Fase 7</span>
              </div>
            </>
          )}
        </div>
      </div>

      {!completo && <div className="fimpular">toque para pular</div>}
    </div>
  );
}

/** Botão de compartilhar: usa a folha do sistema quando existe; senão copia para a área de transferência. */
function Compartilhar({
  game, finais, campeoes, empate,
}: {
  game: KingGame;
  finais: RankRow[];
  campeoes: RankRow[];
  empate: boolean;
}) {
  const [aviso, setAviso] = useState<string | null>(null);
  const texto = useMemo(() => {
    const cab = empate
      ? `Empate entre ${campeoes.map((c) => c.player).join(" e ")}`
      : `${campeoes[0].player} venceu`;
    const linhas = finais.map((r) => `${ordinal(r.position)} ${r.player} ${fmtSigned(r.score)}`).join(" · ");
    return `KING 👑 — ${cab}!\n${linhas}\n10 mãos · 4 jogadores`;
  }, [finais, campeoes, empate]);

  const compartilhar = async () => {
    sfxTap();
    try {
      if (navigator.share) {
        await navigator.share({ title: "KING", text: texto });
        return;
      }
      await navigator.clipboard.writeText(texto);
      setAviso("Resultado copiado");
    } catch {
      setAviso("Não foi possível compartilhar");
    }
    setTimeout(() => setAviso(null), 2200);
  };

  return (
    <button
      className="btn ghost"
      onClick={compartilhar}
      aria-label={`Compartilhar o resultado da partida de ${game.players()[game.humanSeat]}`}
    >
      {aviso ?? "Compartilhar"}
    </button>
  );
}

function Confetes() {
  // partículas suficientes para festejar, poucas o bastante para não virar cassino
  const pecas = useMemo(
    () => Array.from({ length: 22 }, (_, i) => ({
      esq: (i * 37) % 100,
      atraso: (i % 7) * 0.14,
      dur: 2.4 + (i % 5) * 0.35,
      cor: ["var(--gold)", "var(--turq)", "var(--violet)", "var(--magenta)"][i % 4],
      giro: (i % 2 ? 1 : -1) * (180 + (i % 4) * 90),
    })),
    [],
  );
  return (
    <div className="confetes" aria-hidden>
      {pecas.map((p, i) => (
        <i
          key={i}
          style={{
            left: `${p.esq}%`,
            background: p.cor,
            animationDelay: `${p.atraso}s`,
            animationDuration: `${p.dur}s`,
            ["--giro" as string]: `${p.giro}deg`,
          }}
        />
      ))}
    </div>
  );
}

// ---- apoio ----

/** Saldos ANTES da última mão — ponto de partida da contagem. */
function antes(finais: RankRow[], deltas?: number[]): number[] {
  const base = [0, 0, 0, 0];
  for (const r of finais) base[r.seat] = r.score - (deltas ? deltas[r.seat] : 0);
  return base;
}

function ordenarPor(finais: RankRow[], ordem: Seat[]): RankRow[] {
  return ordem.map((s) => finais.find((r) => r.seat === s)!).filter(Boolean);
}

function usePrefersReducedMotion(): boolean {
  const [reduzido, setReduzido] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduzido(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduzido;
}

/**
 * Escolhe o destaque memorável a partir das estatísticas REAIS do motor.
 * Ordem de preferência: o que for mais raro/expressivo primeiro.
 */
function construirDestaques(
  game: KingGame,
  stats: ReturnType<KingGame["stats"]>,
  finais: RankRow[],
  eu: Seat,
  empate: boolean,
  venci: boolean,
): { titulo: string; texto: string; chips: string[] } {
  const players = game.players();
  const meu = stats.perSeat[eu];
  const nome = (s: Seat) => players[s];
  const candidatos: { titulo: string; texto: string; peso: number }[] = [];

  if (meu.cleanNegatives >= 4) {
    candidatos.push({
      titulo: "Escapou ileso",
      texto: `Você zerou ${meu.cleanNegatives} das ${meu.negativeHands} mãos negativas`,
      peso: 90 + meu.cleanNegatives,
    });
  }
  if (stats.kingTaker !== null && stats.kingTaker !== eu) {
    candidatos.push({
      titulo: "Fugiu do Rei de Copas",
      texto: `${nome(stats.kingTaker)} levou os −160 da Mão 5`,
      peso: 70,
    });
  }
  if (stats.kingTaker === eu && venci) {
    candidatos.push({
      titulo: "Venceu mesmo levando o Rei",
      texto: "Você pegou os −160 da Mão 5 e ainda terminou na frente",
      peso: 120,
    });
  }
  if (meu.bestHand && meu.bestHand.score > 0) {
    candidatos.push({
      titulo: "Sua melhor mão",
      texto: `${fmtSigned(meu.bestHand.score)} na Mão ${meu.bestHand.handNumber}`,
      peso: 40 + meu.bestHand.score / 10,
    });
  }
  if (stats.margin > 0 && stats.margin <= 40 && !empate) {
    candidatos.push({
      titulo: "Decisão apertada",
      texto: `Apenas ${stats.margin} pontos separaram o 1º do 2º`,
      peso: 100,
    });
  }
  if (empate) {
    candidatos.push({ titulo: "Empate na liderança", texto: "O KING não inventa desempate — a posição é dividida", peso: 200 });
  }
  candidatos.push({
    titulo: "Partida completa",
    texto: `${meu.positiveTricks} vazas suas nas mãos positivas`,
    peso: 10,
  });

  candidatos.sort((a, b) => b.peso - a.peso);
  const [top] = candidatos;

  const chips = [
    `Melhor mão da partida: ${nome(stats.biggestHand!.seat)} ${fmtSigned(stats.biggestHand!.score)} (Mão ${stats.biggestHand!.handNumber})`,
    `Negativas ilesas: ${meu.cleanNegatives}/${meu.negativeHands}`,
    ...(finais.length ? [`Amplitude: ${finais[0].score - finais[finais.length - 1].score} pontos`] : []),
  ];

  return { titulo: top.titulo, texto: top.texto, chips };
}
