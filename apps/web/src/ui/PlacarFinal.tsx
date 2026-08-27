import { useEffect, useMemo, useRef, useState } from "react";
import type { RankRow, Seat } from "@king/engine";
import type { LeituraDaPartida } from "../game/leituraDaPartida.js";
import { textoDoCompartilhamento } from "./compartilhar.js";
import { Crown } from "./Crown.js";
import { fmtSigned, ordinal } from "./contractText.js";
import { audio } from "../audio/engine.js";
import { TEMPOS } from "../game/timings.js";
import { interpolar, saldosAntes, scoresPorAssento } from "./placarFinalDados.js";
import { sfxCountTick, sfxCrownLand, sfxDefeat, sfxRankShuffle, sfxTap, sfxVictory } from "../audio/sounds.js";
import { analytics } from "../analytics/analytics.js";
import { InsigniaEmLinha, etiquetaDoAvatar } from "./Insignia.js";
import type { MesaMultiplayer } from "./MesaOnline.js";

/**
 * PLACAR FINAL — o encerramento da partida. Não é "o Placar entre-mãos sem o botão":
 * é uma sequência encenada (contagem → reordenação → coroação) sobre os MESMOS dados
 * autoritativos do motor. O checksum final (soma dos saldos = 0) é exibido como selo.
 */
type Etapa = "entrada" | "contagem" | "ranking" | "campeao" | "completo";

const ORDEM: Etapa[] = ["entrada", "contagem", "ranking", "campeao", "completo"];
const MARCOS: Record<Etapa, number> = {
  entrada: 0,
  contagem: TEMPOS.fim.contagem,
  ranking: TEMPOS.fim.ranking,
  campeao: TEMPOS.fim.campeao,
  completo: TEMPOS.fim.completo,
};
const DUR_CONTAGEM = TEMPOS.fim.duracaoContagem;

export function PlacarFinal({
  game, onRestart, onHome, mp,
}: {
  game: LeituraDaPartida;
  onRestart: () => void;
  onHome: () => void;
  /** Presente só no multiplayer. Aqui serve a uma coisa: resolver o avatar de cada assento. */
  mp?: MesaMultiplayer;
}) {
  const resumo = game.summary();
  const finais = game.rankings();
  const stats = game.stats();
  const eu = game.humanSeat;

  const campeoes = finais.filter((r) => r.position === 1);
  const empate = campeoes.length > 1;
  const venci = campeoes.some((r) => r.seat === eu);

  const [etapa, setEtapa] = useState<Etapa>("entrada");
  const [pontos, setPontos] = useState<number[]>(() => saldosAntes(finais, resumo?.scores));
  const reduzido = usePrefersReducedMotion();

  // A partida acabou de verdade quando esta tela monta — é o único ponto do app em que isso é
  // certo nos dois modos. `useRef` porque a tela remonta a cada tique da animação de pontos.
  const fimAnunciado = useRef(false);
  useEffect(() => {
    if (fimAnunciado.current) return;
    fimAnunciado.current = true;
    analytics.track("match_finished", { venci, empate, maos: 10 });
  }, [venci, empate]);

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
    // AMBOS indexados por ASSENTO: `finais` vem ordenado por posição e não serve de índice
    const de = saldosAntes(finais, resumo?.scores);
    const ate = scoresPorAssento(finais);
    if (etapa !== "contagem") { setPontos(ate); return; }
    const t0 = performance.now();
    let ticks = 0;
    let raf = 0;
    const passo = () => {
      const k = Math.min(1, (performance.now() - t0) / DUR_CONTAGEM);
      const e = 1 - Math.pow(1 - k, 3);
      setPontos(interpolar(de, ate, e));
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
    () => construirDestaques(game, stats, eu, empate, venci),
    [game, stats, eu, empate, venci],
  );

  // o burst vive só o instante da coroação; depois a tela desce de intensidade
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    if (etapa !== "campeao") return;
    setBurst(true);
    const id = setTimeout(() => setBurst(false), TEMPOS.fim.burstParticulas);
    return () => clearTimeout(id);
  }, [etapa]);

  const revelado = etapa === "campeao" || etapa === "completo";
  const completo = etapa === "completo";

  return (
    <div className={`fim etapa-${etapa}`} onClick={pular} role="dialog" aria-label="Placar final da partida">
      {!reduzido && burst && <Confetes />}
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
              <button
                className="btn gold"
                autoFocus
                onClick={() => { sfxTap(); analytics.track("rematch_clicked", { venci }); onRestart(); }}
              >
                {venci ? "Jogar novamente" : "Revanche"}
              </button>
              <Compartilhar game={game} finais={finais} empate={empate} />
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
                  <InsigniaEmLinha
                    seat={r.seat}
                    avatar={etiquetaDoAvatar(game, mp?.sala?.seats, r.seat)}
                    nome={r.player}
                    classe="av"
                  />
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

              {/* SOBRA UM CHIP, e é o único que conta uma história: a maior mão da partida.

                  Saíram daqui "Amplitude", "Negativas ilesas" e "Soma dos saldos = 0 ✓". Os três
                  eram verdadeiros e nenhum era para o jogador: amplitude é a subtração que
                  qualquer um faz olhando a primeira e a última linha logo acima; "negativas
                  ilesas" é vocabulário de dentro do projeto; e o checksum é instrumento de
                  auditoria do motor — o jogo mostrando ao jogador que confere as próprias
                  contas. Continuam existindo, todos, onde sempre estiveram: `stats`, `finais` e
                  o teste de checksum do motor. O que mudou é que a tela do fim de partida não é
                  mais o painel de diagnóstico deles. */}
              <div className="fimchips">
                {destaques.chips.map((c) => <span key={c} className="pl-tag">{c}</span>)}
              </div>

              {/* AQUI FICAVA "Última mão": contrato, trunfo e os quatro deltas da mão 10.
                  Era repetição pura — o Placar entre-mãos já mostrou essa mão inteira, com mais
                  detalhe, trinta segundos antes, e o ranking logo acima já mostra onde ela
                  deixou cada um. No fim de partida a pergunta é "quem venceu", não "como foi a
                  última mão". */}

              {/* AQUI ficava um bloco "Progressão" com barra vazia e o texto "XP e conquistas
                  entram na Fase 7". Saiu inteiro: "Fase 7" é nome de etapa interna do projeto,
                  que ninguém fora dele entende, e uma barra que nunca enche promete algo que o
                  jogo não entrega. Espaço reservado para funcionalidade inexistente é dívida
                  visível — quando Perfil/XP existir de verdade, entra com dado real. */}
            </>
          )}
        </div>
      </div>

      {!completo && <div className="fimpular">toque para pular</div>}
    </div>
  );
}

/**
 * Botão de compartilhar.
 *
 * TRÊS CAMINHOS, e nenhum deles é obrigatório: a folha do sistema quando o aparelho oferece, a
 * área de transferência quando não, e um aviso honesto quando as duas falham. A Web Share API
 * não existe em desktop nem em todo navegador móvel, então tratá-la como dependência deixaria o
 * botão morto justamente para quem joga no computador.
 *
 * Cancelar a folha do sistema NÃO é erro: o `AbortError` é a pessoa desistindo, e responder
 * "não foi possível compartilhar" a uma desistência é mentir sobre o que aconteceu.
 */
function Compartilhar({
  game, finais, empate,
}: {
  game: LeituraDaPartida;
  finais: RankRow[];
  empate: boolean;
}) {
  const [aviso, setAviso] = useState<string | null>(null);
  const texto = useMemo(
    () => textoDoCompartilhamento({
      finais, eu: game.humanSeat, players: game.players(), stats: game.stats(), empate,
    }),
    [finais, game, empate],
  );

  const compartilhar = async () => {
    sfxTap();
    try {
      if (navigator.share) {
        await navigator.share({ title: "KING", text: texto });
        return;
      }
      await navigator.clipboard.writeText(texto);
      setAviso("Resultado copiado");
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return; // desistiu; não é falha
      try {
        await navigator.clipboard.writeText(texto);
        setAviso("Resultado copiado");
      } catch {
        setAviso("Não foi possível compartilhar");
      }
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
  // BURST, não chuva: as partículas saem todas juntas do centro no instante da coroação e
  // somem em ~1,3s. Decisão de auditoria: festa elegante e curta, sem confete contínuo.
  const pecas = useMemo(
    () => Array.from({ length: 26 }, (_, i) => {
      const ang = (i / 26) * Math.PI * 2 + (i % 3) * 0.21;
      const forca = 34 + (i % 5) * 9;
      return {
        dx: Math.cos(ang) * forca,
        dy: Math.sin(ang) * forca * 0.72 + 26, // leve viés para baixo: gravidade insinuada
        atraso: (i % 4) * 0.035,
        dur: 1.05 + (i % 5) * 0.11,
        cor: ["var(--gold)", "var(--turq)", "var(--violet)", "var(--magenta)"][i % 4],
        giro: (i % 2 ? 1 : -1) * (200 + (i % 4) * 70),
      };
    }),
    [],
  );
  return (
    <div className="confetes" aria-hidden>
      {pecas.map((p, i) => (
        <i
          key={i}
          style={{
            background: p.cor,
            animationDelay: `${p.atraso}s`,
            animationDuration: `${p.dur}s`,
            ["--dx" as string]: `${p.dx}vmin`,
            ["--dy" as string]: `${p.dy}vmin`,
            ["--giro" as string]: `${p.giro}deg`,
          }}
        />
      ))}
    </div>
  );
}

// ---- apoio ----


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
export function construirDestaques(
  game: LeituraDaPartida,
  stats: ReturnType<LeituraDaPartida["stats"]>,
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
      // O título diz de quem é a notícia; a linha de baixo diz QUEM levou, e quem determina isso
      // continua sendo `stats.kingTaker`, do motor. Só o rótulo mudou.
      titulo: "Quem não conseguiu fugir do K de Copas:",
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
  ];

  return { titulo: top.titulo, texto: top.texto, chips };
}
