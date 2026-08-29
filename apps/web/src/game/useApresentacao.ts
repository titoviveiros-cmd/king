// APRESENTAÇÃO DA MESA — pausa de leitura, selo do castigo, tremor e som.
//
// É a parte da experiência que NÃO depende de quem manda no estado: no modo local o motor acaba
// de resolver a vaza; no multiplayer o servidor já resolveu e mandou o `PlayerView`. Nos dois
// casos a mesa para o mesmo tanto, o selo diz a mesma coisa e o som é o mesmo.
//
// Nenhuma regra aqui — só orquestração, UX e feedback. A decisão do que anunciar é da função
// pura `anunciarVaza`; este hook só a liga ao React.
import { useCallback, useReducer, useRef, useState } from "react";
import { anunciarVaza, type Castigo, type SomDaVaza } from "./anuncio.js";
import type { LeituraDaPartida } from "./leituraDaPartida.js";
import { TEMPOS } from "./timings.js";
import { sfxCardPlay, sfxKingCaptured, sfxPenalty, sfxTrickGood, sfxTrickNeutral } from "../audio/sounds.js";

const TOCAR: Record<SomDaVaza, () => void> = {
  good: sfxTrickGood,
  neutral: sfxTrickNeutral,
  penalty: sfxPenalty,
  king: sfxKingCaptured,
};

export function useApresentacao() {
  const reviewUntil = useRef(0);
  const [castigo, setCastigo] = useState<Castigo | null>(null);
  const [shake, setShake] = useState(0); // contador: cada incremento redispara o screen-shake
  const [, bump] = useReducer((x: number) => x + 1, 0);

  /**
   * Anúncio da vaza que acabou de fechar: som + o "castigo" a mostrar na mesa.
   * Devolve quanto tempo a mesa deve ficar parada antes de recolher as cartas.
   */
  const announceTrick = useCallback((g: LeituraDaPartida): number => {
    const a = anunciarVaza(g, Date.now());
    if (!a) return TEMPOS.leituraDaVaza;
    setCastigo(a.castigo);
    TOCAR[a.som]();
    if (a.shake) setShake((s) => s + 1);
    return a.pausa;
  }, []);

  /** Chamado depois de qualquer jogada: ou fecha a vaza, ou foi só mais uma carta. */
  const afterPlay = useCallback((g: LeituraDaPartida) => {
    if (g.currentTrick().length === 0) {
      const pausa = announceTrick(g);
      reviewUntil.current = Date.now() + pausa;
      // Re-render exatamente no fim da pausa. Sem isto, quando a MÃO acaba o loop dos bots não
      // tem mais nada a fazer e não redesenha — o Placar ficaria esperando indefinidamente.
      window.setTimeout(bump, pausa + 30);
    } else {
      setCastigo(null); // a vaza seguinte começou: o castigo anterior sai da tela
      sfxCardPlay();
    }
  }, [announceTrick]);

  /** A mesa está congelada mostrando a vaza resolvida? */
  const emLeitura = useCallback(() => Date.now() < reviewUntil.current, []);

  /**
   * SUSPENSÃO — a mesa está com uma tela por cima, e a mão não deve andar por baixo dela.
   *
   * A pausa de leitura já era isto para a vaza que fecha: a mesa congela, ninguém joga, e o
   * andamento retoma sozinho. Faltava o mesmo para o anúncio da ÚLTIMA MÃO, que é a única tela
   * do jogo que cobre a Mesa inteira enquanto uma mão nova está começando.
   *
   * Sem isto o anúncio virava um véu translúcido com a partida correndo atrás: medido a
   * 852×393, dois bots jogavam e a vez do humano abria antes de a animação terminar. Quem
   * assistiu ao anúncio saía dele com a vaza já em curso — a celebração cobrindo justamente o
   * começo que ela veio anunciar.
   *
   * É um `ref` e não estado porque quem consulta é um `setInterval`: o intervalo precisa ler o
   * valor de agora, não o do fechamento em que nasceu — a mesma razão de `reviewUntil`.
   */
  const suspenso = useRef(false);
  const suspender = useCallback((v: boolean) => {
    suspenso.current = v;
    bump();
  }, []);

  /** A mesa está parada por QUALQUER motivo de apresentação — leitura da vaza ou anúncio. */
  const emPausa = useCallback(() => suspenso.current || Date.now() < reviewUntil.current, []);

  /** Corta a pausa e limpa o selo — usado ao virar a mão e ao ressincronizar. */
  const limpar = useCallback(() => {
    reviewUntil.current = 0;
    setCastigo(null);
  }, []);

  return { castigo, shake, bump, announceTrick, afterPlay, emLeitura, emPausa, suspender, limpar };
}
