import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Card, Trump, Seat } from "@king/engine";
import { RANK_ORDER, cardId } from "@king/engine";
import { contractTitle, penaltyText, trumpLabel } from "./contractText.js";
import { Placar } from "./Placar.js";
import { PlacarFinal } from "./PlacarFinal.js";
import { AudioButton } from "./AudioPanel.js";
import { FullscreenButton } from "./FullscreenButton.js";
import { sfxCardSelect, sfxTap } from "../audio/sounds.js";
import type { LeituraDaPartida } from "../game/leituraDaPartida.js";
import type { Castigo } from "../game/anuncio.js";
import { CardView } from "./CardView.js";
import { TEMPOS } from "../game/timings.js";
import { adversariosDe, slotDe } from "./assentos.js";
import {
  BalaoSocial, BotaoSocial, ChipDoRelogio, FaixaDaConexao, SeloDeAssistencia, SeloDeBot,
  AvisoDeRecusa, type MesaMultiplayer,
} from "./MesaOnline.js";
import { desenhoDoAvatar } from "./avatares.js";
import { DezMaos } from "./DezMaos.js";
import { PerfilJogador } from "./PerfilJogador.js";
import { UltimaVaza } from "./UltimaVaza.js";
import { UltimaMao } from "./UltimaMao.js";

export type { MesaMultiplayer } from "./MesaOnline.js";

const SUIT_ORDER: Record<string, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
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
/**
 * Faixa de comprimento do apelido, para o card de trunfo escolher a tipografia.
 *
 * Os cortes são em CARACTERES, não em pixels, e é essa a diferença que importa: um limiar em px
 * vale para um viewport e mente em todos os outros, enquanto "quantas letras" é a mesma pergunta
 * em qualquer tela. Os números saem do campo de apelido, que aceita 14: até 8 cabe no corpo
 * cheio, até 12 cabe reduzido, e o resto é nome extremo, onde as reticências entram.
 */
export function faixaDoNome(nome: string): "" | "medio" | "longo" {
  const n = nome.trim().length;
  return n <= 8 ? "" : n <= 12 ? "medio" : "longo";
}

/**
 * Etiqueta do tema, saneada aqui e em nenhum outro lugar.
 *
 * Um valor desconhecido cai no padrão em vez de deixar a mesa sem pano: o servidor já valida
 * contra o conjunto fechado, e esta é a segunda rede — se um dia chegar um tema que este cliente
 * ainda não conhece (versão nova no ar, aparelho com o bundle antigo), a mesa continua desenhada.
 */
const TEMAS_CONHECIDOS = new Set(["imperial", "verde"]);
const temaDaMesa = (id: string | undefined) => (id && TEMAS_CONHECIDOS.has(id) ? id : "imperial");

/** Saldo com sinal, no formato curto do card. O menos é o de verdade, não o hífen. */
const fmtPts = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

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
  game, reviewing, shake, castigo, onPlay, onChooseTrump, onAdvance, onHome, onRestart, onOpenAudio, mp,
}: {
  game: LeituraDaPartida;
  reviewing: boolean;
  shake: number;
  castigo: Castigo | null;
  onPlay: (c: Card) => void;
  onChooseTrump: (t: Trump) => void;
  onAdvance: () => void;
  onHome: () => void;
  onRestart: () => void;
  onOpenAudio: () => void;
  /** Presente SÓ no multiplayer. Ausente = modo local, e a Mesa se comporta exatamente como antes. */
  mp?: MesaMultiplayer;
}) {
  // Você sempre embaixo. No modo local `eu` é 0 e a rotação devolve o mapa antigo intacto.
  const eu = game.humanSeat;
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
  // Otimismo visual limitado: a carta tocada continua na mão, elevada, até o servidor confirmar.
  // Enquanto isso o leque não aceita um segundo toque — é o que impede jogar duas cartas.
  const emVoo = mp?.emVoo ?? null;
  const travado = !!mp?.aguardando;
  const hand = sortDisplay(game.view().yourHand);

  const coarse = useCoarsePointer();
  // Consulta às 10 mãos. Estado de LEITURA e nada mais: não pausa, não cancela, não avança.
  const [vendoAsMaos, setVendoAsMaos] = useState(false);
  // Mini perfil. Mesma natureza: abre, lê, fecha. Não toca em turno, carta, relógio nem socket.
  const [vendoPerfil, setVendoPerfil] = useState<Seat | null>(null);
  // Consulta à última vaza. Idem: leitura de estado público que o cliente já tem.
  const [vendoUltimaVaza, setVendoUltimaVaza] = useState(false);
  const temVazaAnterior = game.completedTrickCount() > 0;

  /**
   * O QUE CADA CARD DIZ, e por que só isso.
   *
   * Numa partida real ficou claro que o card respondia "quanto ele tem" e não respondia "como ele
   * está". Saldo sem posição não situa ninguém: +40 pode ser primeiro ou último, e a diferença é
   * a partida inteira. E o desempenho da MÃO EM CURSO é o que muda de vaza em vaza — era a
   * informação que faltava, e é a que se lê num relance.
   *
   * Tudo sai do motor: `rankings` para a posição, `liveScores` para o saldo (já com o parcial da
   * mão) e `handBreakdownSoFar` para o que cada um pegou até aqui. Nada é acumulado no cliente,
   * nada é estimado.
   *
   * O delta da mão só entra quando NÃO É ZERO. Escrever "0" em três cards enquanto a mão está
   * limpa é ruído puro, e ruído numa Mesa cheia custa a leitura dos quatro.
   */
  /**
   * QUEM SABE O AVATAR DE UM ASSENTO.
   *
   * A ordem é de autoridade, não de conveniência: no multiplayer manda o estado sincronizado da
   * sala, porque é ele que os quatro aparelhos compartilham. Sem sala, a partida local responde.
   * Se nenhum dos dois souber, devolve `undefined` — e "não sei" continua diferente de "é o
   * leão", que era exatamente o atalho que fazia os quatro cards abrirem o mesmo bicho.
   */
  const avatarDe = (s: Seat): string | undefined =>
    mp?.sala?.seats[s]?.avatar ?? game.avatarDoAssento(s);

  const posicoes = new Map(game.rankings().map((r) => [r.seat, r.position]));
  const daMao = game.handBreakdownSoFar();
  const deltaDaMao = (s: Seat): number => daMao?.rows[s]?.points ?? 0;

  /**
   * O ANÚNCIO DA MÃO 10, e a disciplina que o mantém inofensivo.
   *
   * A visibilidade é DERIVADA, não disparada: `mão 10 e ainda não dispensada`. Ninguém "abre" o
   * anúncio, então nenhum redesenho pode reabri-lo — e a Mesa redesenha a cada passo de bot e a
   * cada tique do relógio. Quem reconecta no meio da mão 10 vê o anúncio uma vez e pronto; se
   * já tinha dispensado, não vê de novo, porque quem manda é o estado, não um evento perdido.
   *
   * O que se guarda é o NÚMERO da mão dispensada, não um booleano: uma revanche volta para a
   * mão 1 com o mesmo componente montado, e o zero devolve o anúncio para a partida seguinte.
   */
  const maoAtual = contract?.hand ?? 0;
  const [dispensadaEm, setDispensadaEm] = useState(0);
  const anunciandoUltimaMao = maoAtual === 10 && dispensadaEm !== 10;
  useEffect(() => {
    // Revanche: a partida nova volta para a mão 1, e o anúncio fica disponível de novo.
    if (maoAtual > 0 && maoAtual < 10) setDispensadaEm(0);
  }, [maoAtual]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { if (!humanTurn) setSelected(null); }, [humanTurn]);

  // "SUA VEZ" é temporário (Design System): o estado permanente é o anel dourado no seu card.
  // Some antes de você começar a escolher a carta, para não disputar espaço com o leque.
  //
  // A contagem só começa com a mesa LIVRE (`!reviewing`). `humanTurn` fica true assim que a vaza
  // resolve, mas a mesa ainda passa a pausa de leitura congelada (até 3400ms no K de Copas): o
  // chip nascia atrás do selo do castigo e expirava antes de a mesa liberar. Isto NÃO adia o
  // turno nem a habilitação das cartas — elas seguem habilitadas por `humanTurn`, e jogar
  // enquanto o chip está na tela continua possível.
  const [showTurnChip, setShowTurnChip] = useState(false);
  const [chipSaindo, setChipSaindo] = useState(false);
  useEffect(() => {
    if (!humanTurn || reviewing) { setShowTurnChip(false); setChipSaindo(false); return; }
    setShowTurnChip(true);
    setChipSaindo(false);
    const sai = setTimeout(() => setChipSaindo(true), TEMPOS.chipSuaVez);
    const some = setTimeout(() => setShowTurnChip(false), TEMPOS.chipSuaVez + TEMPOS.chipSuaVezSaida);
    return () => { clearTimeout(sai); clearTimeout(some); };
  }, [humanTurn, reviewing]);

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

  const oppSeats: Seat[] = adversariosDe(eu);
  const oppName = (s: Seat) => players[s];

  return (
    // `comtrunfo` avisa ao CSS que a coluna esquerda ganhou mais um andar: com o slot de trunfo
    // na tela, os adversários laterais precisam de um piso para não subirem por baixo dele.
    <div
      className={`mesa${shaking ? " shaking" : ""}${contract?.isPositive && trump ? " comtrunfo" : ""}`}
      /* O tema vem do estado AUTORITATIVO da sala, não de preferência local: todo mundo joga na
         mesma mesa. Sem multiplayer cai no padrão, que é a mesa aprovada. */
      data-tema={temaDaMesa(mp?.sala?.tableTheme)}
    >
      <div className="inlay" />

      {/* HUD do contrato — é o objetivo da mão, a informação mais importante da tela.
          A classe da fase pinta o halo (magenta na negativa, turquesa na positiva) e a `key`
          remonta o card quando a mão vira, para o realce de atenção tocar de novo exatamente
          no momento em que o objetivo muda. */}
      {/* O CARD DO CONTRATO É UM BOTÃO. Ele já era o lugar para onde o olho vai quando a pergunta
          é "o que vale agora?"; virou também a resposta para "e as outras?". Abrir o resumo não
          toca no estado da partida: é leitura, e o motor nem fica sabendo. */}
      <button
        type="button"
        className={`hud ${contract?.isPositive ? "pos" : "neg"}`}
        key={contract?.hand ?? 0}
        onClick={() => { sfxTap(); setVendoAsMaos(true); }}
        aria-label={`Mão ${contract?.hand}: ${contractTitle(contract?.kind)}. Toque para ver as 10 mãos`}
      >
        <div className="ph">{contract?.isPositive ? "Fase positiva" : "Fase negativa"} · Mão {contract?.hand}</div>
        <div className="c">{contractTitle(contract?.kind)}</div>
        <div className="r">
          <span className="pen">{penaltyText(contract?.kind)}</span>
          <span className="vz">Vaza <b>{Math.min(game.trickNumber(), 13)}</b>/13</span>
        </div>
        <span className="hud-lupa" aria-hidden>as 10 mãos</span>
      </button>

      {vendoAsMaos && (
        <DezMaos maoAtual={contract?.hand} onFechar={() => setVendoAsMaos(false)} />
      )}

      {vendoPerfil !== null && (
        <PerfilJogador
          game={game}
          assento={vendoPerfil}
          sala={mp?.sala?.seats}
          onFechar={() => setVendoPerfil(null)}
        />
      )}

      {vendoUltimaVaza && <UltimaVaza game={game} onFechar={() => setVendoUltimaVaza(false)} />}

      {anunciandoUltimaMao && <UltimaMao onFim={() => setDispensadaEm(10)} />}

      {/* Slot de trunfo — só existe nas mãos positivas (Design System). Símbolo grande:
          é consultado o tempo todo durante a mão. */}
      {contract?.isPositive && trump && (
        <div className={`trumpslot ${trump === "no-trump" ? "nt" : isRedSuit(trump) ? "red" : "black"}`}>
          <span className="lb">Trunfo</span>
          <span className="sym">{trumpLabel(trump)}</span>
          {game.trumpChooser() !== null && (
            <span className={`who ${faixaDoNome(players[game.trumpChooser() as Seat])}`}>
              {players[game.trumpChooser() as Seat]}
            </span>
          )}
        </div>
      )}
      {mp && <ChipDoRelogio relogio={mp.relogio} eu={eu} />}
      {mp && <FaixaDaConexao conexao={mp.conexao} codigo={mp.sala?.roomCode ?? ""} />}
      {mp && <AvisoDeRecusa recusa={mp.recusa} />}
      {/* ZONA SOCIAL — canto inferior direito, longe de tudo.
          No topo direito ele ficava espremido entre Sair/tela-cheia/áudio (acima) e o relógio da
          decisão (logo abaixo): três funções sem relação nenhuma disputando o mesmo canto, e a
          única delas que é do JOGO era a menor. Aqui embaixo ele ganha zona própria, fica na
          diagonal oposta ao card do jogador — que mora no canto inferior esquerdo — e cai debaixo
          do polegar direito de quem segura o aparelho deitado. */}
      {mp && (
        <BotaoSocial
          status={mp.sala?.status === "finished" ? "finished" : "playing"}
          onEnviar={mp.onEnviarMensagem}
        />
      )}

      <div className="topbtn">
        {/* ÚLTIMA VAZA — discreto de propósito.
            É consulta, não ação de jogo: fica junto das utilidades do topo, longe do leque, e não
            depende de quem está na vez. Antes da primeira vaza fechar não há o que consultar, e o
            botão diz isso ficando desabilitado em vez de abrir uma tela vazia. */}
        <button
          className="btn ghost topvaza"
          onClick={() => { sfxTap(); setVendoUltimaVaza(true); }}
          disabled={!temVazaAnterior}
          aria-label="Ver a última vaza"
          title="Última vaza"
        >
          <b aria-hidden>↺</b><i>Última vaza</i>
        </button>
        <FullscreenButton />
        <AudioButton onOpen={onOpenAudio} />
        <button className="btn ghost" onClick={() => { sfxTap(); onHome(); }}>Sair</button>
      </div>

      {/* adversários */}
      {oppSeats.map((s) => {
        const pos = slotDe(s, eu);
        const assento = mp?.sala?.seats[s];
        return (
          <button
            type="button"
            key={s}
            className={`opp ${pos === "l" ? "left" : pos === "t" ? "top" : "right"}${turn === s && phase === "play" ? " active" : ""}${assento && !assento.connected ? " ausente" : ""}`}
            onClick={() => { sfxTap(); setVendoPerfil(s); }}
            aria-label={`Ver o perfil de ${oppName(s)}`}
          >
            <Insignia seat={s} avatar={avatarDe(s)} nome={oppName(s)} />
            <div>
              <div className="n">
                {oppName(s)}<SeloDeBot assento={assento} /><SeloDeAssistencia assento={assento} />
              </div>
              <div className="m">
                <span className="ps">{posicoes.get(s)}º</span>
                <span className="pt">{fmtPts(scores[s])}</span>
                {deltaDaMao(s) !== 0 && (
                  <span className={`mdelta ${deltaDaMao(s) > 0 ? "pos" : "neg"}`}>{fmtPts(deltaDaMao(s))}</span>
                )}
                <span className="cc">🂠 {counts[s]}</span>
              </div>
            </div>
            {mp && <BalaoSocial mensagem={mp.mensagens[s]} />}
          </button>
        );
      })}

      {/* vaza central */}
      <div className="trick">
        {shownTrick.map((pc) => (
          <div key={pc.seat} className={`slot ${slotDe(pc.seat, eu)} ${winnerSeat === pc.seat ? "win" : ""}`}>
            <CardView card={pc.card} />
          </div>
        ))}
      </div>

      {/* jogador local */}
      {/* O card do jogador local abre o MESMO mini perfil dos adversários. Uma tela só: duplicar
          a arquitetura de perfil para "eu" e para "os outros" criaria duas verdades para manter. */}
      <button
        type="button"
        className={`youtag ${humanTurn ? "active" : ""}`}
        onClick={() => { sfxTap(); setVendoPerfil(eu); }}
        aria-label={`Ver o seu perfil, ${players[eu]}`}
      >
        <Insignia seat={eu} avatar={avatarDe(eu)} nome={players[eu]} />
        <div>
          <div className="n">{players[eu]}<SeloDeAssistencia assento={mp?.sala?.seats[eu]} /></div>
          <div className="m">
            <span className="ps">{posicoes.get(eu)}º</span>
            <span className="pt">{fmtPts(scores[eu])}</span>
            {deltaDaMao(eu) !== 0 && (
              <span className={`mdelta ${deltaDaMao(eu) > 0 ? "pos" : "neg"}`}>{fmtPts(deltaDaMao(eu))}</span>
            )}
            <span className="cc">🂠 {counts[eu]}</span>
          </div>
        </div>
        {mp && <BalaoSocial mensagem={mp.mensagens[eu]} />}
      </button>
      {/* Selo do castigo: a mesa para e todos veem QUEM pegou a bucha e QUANTO custou.
          Antes a vaza penalizada era recolhida em 1,15s sem nome nem número — ninguém
          acompanhava quem tinha se dado mal, que é justamente a graça das mãos negativas. */}
      {castigo && reviewing && (
        <div
          key={castigo.nonce}
          className={`castigo s${castigo.seat}${castigo.king ? " king" : ""}${castigo.voce ? " voce" : ""}`}
          role="status"
        >
          <span className="quem">
            <Insignia seat={castigo.seat} avatar={mp?.sala?.seats[castigo.seat]?.avatar}
              nome={castigo.jogador} selo />
            {castigo.voce ? "Você pegou" : `${castigo.jogador} pegou`}
          </span>
          <span className="oque">{castigo.oQue}</span>
          <span className="quanto">{castigo.pontos}</span>
        </div>
      )}

      {humanTurn && (
        <>
          {showTurnChip && !selected && <div className={`suavez${chipSaindo ? " out" : ""}`}>Sua vez</div>}
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
              selected={selected === cardKey(c) || emVoo === cardId(c)}
              style={fanVars(i, Math.abs(i - mid))}
              onClick={humanTurn && isLegal && !travado ? () => pickCard(c) : undefined}
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
      {/* Os placares esperam a pausa de leitura terminar. Antes entravam no mesmo instante em
          que a última vaza fechava e cobriam o selo do castigo — justo o momento decisivo. */}
      {phase === "handEnd" && !reviewing && (
        <Placar game={game} onAdvance={onAdvance} onHome={onHome} onRestart={onRestart} mp={mp} />
      )}
      {phase === "matchEnd" && !reviewing && (
        <PlacarFinal game={game} onRestart={onRestart} onHome={onHome} />
      )}
    </div>
  );
}

/**
 * O círculo de identidade — adversários, você e o selo do castigo usam o mesmo.
 *
 * A COR vem do ASSENTO (`s0`–`s3`), nunca da posição na tela: a Mesa gira em torno de quem
 * olha, e colorir por posição faria a mesma pessoa aparecer de uma cor em cada aparelho.
 *
 * O DESENHO vem do avatar do estado autoritativo. No jogo local não há avatar escolhido nem
 * outros aparelhos para combinar: fica a inicial do nome, como sempre foi.
 */
function Insignia({ seat, avatar, nome, selo }: {
  seat: Seat;
  avatar?: string;
  nome: string;
  /** O selo do castigo desenha um `<i>` dentro de uma linha de texto, não um bloco. */
  selo?: boolean;
}) {
  const d = avatar ? desenhoDoAvatar(avatar) : null;
  const classe = `av s${seat}`;
  const conteudo = d ? d.glifo : nome[0];
  return selo
    ? <i className={classe} aria-label={d?.rotulo}>{conteudo}</i>
    : <div className={classe} aria-label={d?.rotulo}>{conteudo}</div>;
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
