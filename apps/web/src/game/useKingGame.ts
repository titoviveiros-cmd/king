import { useCallback, useEffect, useRef, useState } from "react";
import type { Card, Trump } from "@king/engine";
import { KingGame } from "./kingGame.js";
import { NOMES_DA_MESA_LOCAL } from "./adversarios.js";
import { useApresentacao } from "./useApresentacao.js";
import { useSonsDeTransicao } from "./useSonsDeTransicao.js";
import { TEMPOS } from "./timings.js";
import { audio } from "../audio/engine.js";
import { analytics } from "../analytics/analytics.js";
import { sfxTrump } from "../audio/sounds.js";

export type { Castigo } from "./anuncio.js";

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
 * `?mao=10` começa a partida LOCAL naquela mão.
 *
 * Mesma natureza do `?seed=`: serve para rever uma tela específica sem jogar nove mãos até ela. E
 * é o que torna o anúncio da mão 10 testável no navegador de verdade — pelo caminho real, com o
 * componente montado, em vez de só por render estático.
 *
 * NÃO MUDA REGRA NENHUMA. Quem monta a mão é `startNextHand`, do motor, exatamente como no
 * tutorial: o contrato, a distribuição, o dealer e a rotação do trunfo saem todos dele. E existe
 * só no modo local contra bots — no multiplayer quem decide a mão é o servidor, e ele não lê a
 * URL de ninguém.
 */
function maoDaUrl(): number | null {
  const v = new URLSearchParams(window.location.search).get("mao");
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null;
}

/**
 * MODO LOCAL. Liga o adaptador KingGame ao React: força re-render, dá o timing das jogadas dos
 * bots, uma pausa para ler a vaza resolvida e dispara os sons/haptics de cada evento.
 * Nenhuma regra aqui — só orquestração, UX e feedback.
 *
 * O modo multiplayer é um hook irmão (`useKingOnline`) com a MESMA forma de retorno; a Mesa não
 * sabe qual dos dois a está alimentando.
 */
export function useKingGame() {
  const ref = useRef<KingGame | null>(null);
  const [screen, setScreen] = useState<"home" | "mesa">("home");
  const ap = useApresentacao();
  const { bump, afterPlay, emLeitura, limpar } = ap;

  /**
   * O avatar da partida em curso.
   *
   * `start(avatar)` vem da Home, com uma escolha recém-feita. `start()` sem argumento é o "Jogar
   * novamente" do placar final, que é continuação da mesma experiência e por isso conserva o que
   * já estava — ele não passa pela Home, então não há escolha nova a fazer.
   */
  const avatarDoHumano = useRef<string | undefined>(undefined);

  const start = useCallback((avatar?: string) => {
    if (avatar) avatarDoHumano.current = avatar;
    // "Jogar de novo" na tela de fim é o mesmo `start`: para a medição, o que interessa é que
    // uma partida COMEÇOU. O botão que a pediu é dado da própria tela, não deste hook.
    analytics.track("match_started", { modo: "local", bots: 3 });
    audio.unlock(); // 1º gesto real do usuário: iOS só libera áudio aqui
    ref.current = new KingGame(
      NOMES_DA_MESA_LOCAL,
      seedDaUrl() ?? Math.floor(Math.random() * 1e9),
      0,
      maoDaUrl() ?? 1,
      avatarDoHumano.current,
    );
    limpar();
    setScreen("mesa");
    bump();
  }, [bump, limpar]);
  /**
   * Voltar para a Home DESCARTA a escolha de avatar.
   *
   * É o que separa "escolha do fluxo atual" de "preferência guardada": quem volta ao início
   * recomeça, e a próxima partida pergunta de novo. Sem isto, a remoção do `localStorage` teria
   * sido trocar uma pré-seleção persistente por outra em memória.
   */
  const goHome = useCallback(() => {
    avatarDoHumano.current = undefined;
    setScreen("home");
  }, []);

  useEffect(() => {
    if (screen !== "mesa") return;
    const id = setInterval(() => {
      const g = ref.current;
      if (!g) return;
      if (emLeitura()) { bump(); return; } // pausa p/ ler a vaza
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
  }, [screen, afterPlay, bump, emLeitura]);

  useSonsDeTransicao(ref.current, screen === "mesa");

  const playCard = useCallback((card: Card) => {
    const g = ref.current;
    if (g && g.isHumanTurn()) {
      g.playHuman(card);
      afterPlay(g);
      bump();
    }
  }, [afterPlay, bump]);
  const chooseTrump = useCallback((t: Trump) => {
    const g = ref.current;
    if (g && g.humanChoosesTrump()) { g.chooseTrumpHuman(t); sfxTrump(); bump(); }
  }, [bump]);
  const advanceHand = useCallback(() => {
    const g = ref.current;
    if (g) { g.advanceHand(); limpar(); bump(); }
  }, [bump, limpar]);

  return {
    game: ref.current as KingGame | null,
    screen,
    reviewing: emLeitura(),
    shake: ap.shake,
    castigo: ap.castigo,
    start, goHome, playCard, chooseTrump, advanceHand,
  };
}
