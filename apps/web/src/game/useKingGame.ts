import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Card, Trump } from "@king/engine";
import { KingGame, type Phase } from "./kingGame.js";
import { TEMPOS } from "./timings.js";
import { audio } from "../audio/engine.js";
import {
  sfxCardPlay, sfxDeal, sfxHandEnd, sfxKingCaptured, sfxLastTrick,
  sfxPenalty, sfxTrickGood, sfxTrickNeutral, sfxTrump, sfxYourTurn, sfxFinalSwell,
} from "../audio/sounds.js";

/**
 * `?seed=123` fixa a semente da partida. O motor é determinístico por semente (ver
 * KING-ARCHITECTURE), então isso reproduz uma partida idêntica — serve para reproduzir bug
 * e para revisar uma tela específica sem depender de sorte.
 */
function seedDaUrl(): number | null {
  const v = new URLSearchParams(window.location.search).get("seed");
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n >>> 0 : null;
}

/**
 * Liga o adaptador KingGame ao React: força re-render, dá o timing das jogadas dos bots,
 * uma pausa para ler a vaza resolvida e dispara os sons/haptics de cada evento.
 * Nenhuma regra aqui — só orquestração, UX e feedback.
 */
export function useKingGame() {
  const ref = useRef<KingGame | null>(null);
  const reviewUntil = useRef(0);
  const [, bump] = useReducer((x) => x + 1, 0);
  const [screen, setScreen] = useState<"home" | "mesa">("home");
  const [shake, setShake] = useState(0); // contador: cada incremento redispara o screen-shake

  // memória para detectar transições (mão nova, fase nova, "sua vez")
  const prev = useRef({ phase: null as Phase | null, hand: 0, humanTurn: false, trick: 0 });

  const start = useCallback(() => {
    audio.unlock(); // 1º gesto real do usuário: iOS só libera áudio aqui
    ref.current = new KingGame(["Você", "Bia", "Léo", "Nara"], seedDaUrl() ?? Math.floor(Math.random() * 1e9));
    reviewUntil.current = 0;
    prev.current = { phase: null, hand: 0, humanTurn: false, trick: 0 };
    setScreen("mesa");
    bump();
  }, []);
  const goHome = useCallback(() => setScreen("home"), []);

  /** Som da vaza que acabou de fechar — quem levou e o que isso custou (dados do motor). */
  const announceTrick = useCallback((g: KingGame) => {
    const last = g.lastCompletedTrick();
    const contract = g.contract();
    const bd = g.lastTrickBreakdown();
    if (!last || !contract || !bd) return;
    const units = bd.rows[last.winner].units;
    const mine = last.winner === g.humanSeat;

    if (contract.kind === "no-king" && units > 0) {
      sfxKingCaptured();
      setShake((s) => s + 1);
      return;
    }
    if (contract.isPositive) {
      if (mine) sfxTrickGood();
      else sfxTrickNeutral();
      return;
    }
    if (mine && units > 0) sfxPenalty();
    else if (!mine && units > 0) sfxTrickNeutral();
    else if (mine) sfxTrickNeutral();
    else sfxTrickGood(); // negativa que sobrou para outro: alívio
  }, []);

  /** Chamado depois de qualquer jogada: ou fecha a vaza, ou foi só mais uma carta. */
  const afterPlay = useCallback((g: KingGame) => {
    if (g.currentTrick().length === 0) {
      announceTrick(g);
      reviewUntil.current = Date.now() + TEMPOS.leituraDaVaza;
    } else {
      sfxCardPlay();
    }
  }, [announceTrick]);

  useEffect(() => {
    if (screen !== "mesa") return;
    const id = setInterval(() => {
      const g = ref.current;
      if (!g) return;
      if (Date.now() < reviewUntil.current) { bump(); return; } // pausa p/ ler a vaza
      const ph = g.phase();
      if (ph === "trump" && g.needsBotTrump()) { g.stepBotTrump(); sfxTrump(); bump(); return; }
      if (ph === "play" && g.needsBotPlay()) {
        g.stepBotPlay();
        afterPlay(g);
        bump();
        return;
      }
      // handEnd / matchEnd / vez do humano → aguarda clique
    }, TEMPOS.botPasso);
    return () => clearInterval(id);
  }, [screen, afterPlay]);

  // Transições de estado que merecem som: mão nova, última vaza, fim de mão, fim de partida, sua vez.
  const g = ref.current;
  const phase = screen === "mesa" && g ? g.phase() : null;
  const handNumber = g ? g.handNumber() : 0;
  const trickNumber = g ? g.trickNumber() : 0;
  const humanTurn = !!g && g.isHumanTurn();
  useEffect(() => {
    if (screen !== "mesa" || !g) return;
    const p = prev.current;
    if (handNumber !== p.hand && handNumber > 0) sfxDeal();
    else if (phase === "handEnd" && p.phase !== "handEnd") sfxHandEnd();
    else if (phase === "matchEnd" && p.phase !== "matchEnd") {
      // o resto do encerramento (coroa, fanfarra) é encenado pelo próprio Placar Final
      sfxFinalSwell();
    } else if (phase === "play" && trickNumber === 13 && p.trick !== 13) sfxLastTrick();
    else if (humanTurn && !p.humanTurn) sfxYourTurn();
    prev.current = { phase, hand: handNumber, humanTurn, trick: trickNumber };
  }, [screen, g, phase, handNumber, trickNumber, humanTurn]);

  const playCard = useCallback((card: Card) => {
    const g = ref.current;
    if (g && g.isHumanTurn()) {
      g.playHuman(card);
      afterPlay(g);
      bump();
    }
  }, [afterPlay]);
  const chooseTrump = useCallback((t: Trump) => {
    const g = ref.current;
    if (g && g.humanChoosesTrump()) { g.chooseTrumpHuman(t); sfxTrump(); bump(); }
  }, []);
  const advanceHand = useCallback(() => {
    const g = ref.current;
    if (g) { g.advanceHand(); reviewUntil.current = 0; bump(); }
  }, []);

  return {
    game: ref.current,
    screen,
    reviewing: Date.now() < reviewUntil.current,
    shake,
    start, goHome, playCard, chooseTrump, advanceHand,
  };
}
