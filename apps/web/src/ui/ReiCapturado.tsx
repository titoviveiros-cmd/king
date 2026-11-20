// O REI FOI CAPTURADO — a cena da mão 5, quando alguém leva a vaza com o K♥.
//
// ⚠ ISTO É APRESENTAÇÃO PURA, no mesmo molde do anúncio da ÚLTIMA MÃO (`UltimaMao.tsx`). Não toca
// no motor, não muda ordem, turno, timer nem pontuação. Quem decide que houve captura, quem pegou
// e quanto custou é o motor, via `anunciarVaza` (o mesmo `castigo` do selo). Se este arquivo
// sumir, a partida é idêntica.
//
// AS REGRAS QUE ELA OBEDECE:
//
//   1. CABE NA PAUSA DO KING. A captura do K♥ encerra a mão e a mesa para 6,5s para a leitura
//      (`leituraDaVazaKing`). A cena dura 5s e depois a mesa assume com o selo e a aura vinho
//      (1,35s). Nada aqui pede `suspender`, nada prolonga a pausa, nada espera o servidor: quem
//      sabe o tamanho da pausa é `timings.ts`, e o servidor tem o mesmo número (`tempos.ts`).
//   2. NÃO BLOQUEIA. Sai sozinha, e um toque encurta. O toque só fecha a cena: não avança a
//      partida, não joga carta, não confirma nada — e não atravessa para o que está por baixo.
//   3. APARECE UMA VEZ POR CAPTURA. A marca é o `nonce` do castigo, guardada fora do React — uma
//      remontagem da Mesa não repete a cena. Reconectar limpa o castigo (`limpar()` em
//      RESYNC/RECONNECTED), então quem volta não assiste ao que já passou.
//   4. SÓ O QUE JÁ É PÚBLICO. O K♥ já está revelado na vaza; nome e −160 são os do selo.
//   5. NÃO DEPENDE DE MOVIMENTO NEM DE SOM. O som é o do castigo do King, que já tocou; aqui não
//      toca nada nem vibra. Com movimento reduzido fica só o fade, e o texto diz tudo.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Crown } from "./Crown.js";
import { TEMPOS } from "../game/timings.js";

/** Fade de saída. Par do `.rc.saindo` no theme.css. */
const SAIDA_MS = 350;
/** Permanência antes de começar a sair: a cena inteira dura `TEMPOS.cenaDoRei`. */
const PERMANENCIA_MS = TEMPOS.cenaDoRei - SAIDA_MS;

/**
 * As faíscas saem em DUAS ondas: a do impacto, junto com a carta, e uma segunda no meio da cena.
 * Com 2s uma onda bastava; com 5s, a cena ficava parada metade do tempo. Oito por onda, só
 * `transform`/`opacity` — o que o celular compõe sem redesenhar a tela.
 */
const ONDAS_DE_FAISCAS = [0.18, 2.1] as const;
const FAISCAS_POR_ONDA = 8;

/** Capturas cuja cena já foi vista (ou dispensada), pelo `nonce` do castigo. */
const vistas = new Set<number>();
/** A cena desta captura já passou? Depois dela, a mesa mostra o selo e a aura vinho. */
export const cenaDoReiJaVista = (nonce: number): boolean => vistas.has(nonce);
/** Marca a captura como vista. Chamado no fim da cena (pelo tempo ou pelo toque). */
export function marcarCenaDoReiVista(nonce: number): void {
  vistas.add(nonce);
}

/**
 * Quando a cena de cada captura começou, pelo `nonce` — fora do React, como `vistas`.
 *
 * POR QUE: a cena agora dura 5s dentro de uma pausa de 6,5s. Se a Mesa remontar no meio dela
 * (girar o aparelho, por exemplo), uma cena que recomeçasse do zero terminaria DEPOIS da pausa e
 * seria cortada pelo Placar, levando junto o destaque da mesa. Retomando de onde parou, a soma
 * cena + destaque continua cabendo na pausa.
 */
const inicios = new Map<number, number>();

/**
 * Quanto falta da permanência de uma cena que começou em `inicio`, no instante `agora`.
 * Puro, para ser testado sem relógio. Nunca negativo e nunca maior que a permanência inteira.
 */
export function permanenciaRestante(inicio: number, agora: number): number {
  return Math.min(PERMANENCIA_MS, Math.max(0, PERMANENCIA_MS - (agora - inicio)));
}

export function ReiCapturado({ nonce, quem, voce, pontos, onFim }: {
  /** O `nonce` do castigo: identidade desta captura (a mesma marca de `vistas`). */
  nonce: number;
  /** Nome de quem levou a vaza com o K♥ — o vencedor confirmado pelo motor. */
  quem: string;
  /** Foi o próprio jogador deste aparelho? */
  voce: boolean;
  /** Os pontos do selo, do motor (−160). Nada é recalculado aqui. */
  pontos: number;
  onFim: () => void;
}) {
  const [saindo, setSaindo] = useState(false);
  const reduzido = usePrefersReducedMotion();
  const encerrado = useRef(false);
  const fim = useRef(onFim);
  fim.current = onFim;

  /** Fecha uma vez só, venha o fim do tempo ou o dedo. */
  const encerrar = useRef(() => {
    if (encerrado.current) return;
    encerrado.current = true;
    setSaindo(true);
    window.setTimeout(() => fim.current(), SAIDA_MS);
  });

  useEffect(() => {
    if (!inicios.has(nonce)) inicios.set(nonce, Date.now());
    const restante = permanenciaRestante(inicios.get(nonce)!, Date.now());
    const id = window.setTimeout(() => encerrar.current(), restante);
    return () => window.clearTimeout(id);
  }, [nonce]);

  return (
    <div
      className={`rc${saindo ? " saindo" : ""}${reduzido ? " calmo" : ""}`}
      // O TOQUE FECHA A CENA E PARA AQUI. A camada cobre a Mesa inteira (`inset:0`) e continua
      // interceptando durante a saída, então o dedo nunca alcança uma carta ou um botão por baixo
      // dela; o `stopPropagation` garante que nenhum ouvinte da Mesa trate este toque como seu.
      onClick={(e) => { e.stopPropagation(); encerrar.current(); }}
      role="status"
      aria-live="polite"
    >
      {!reduzido && <span className="rc-luz" aria-hidden />}
      {!reduzido && (
        <div className="rc-faiscas" aria-hidden>
          {ONDAS_DE_FAISCAS.flatMap((desde, onda) => Array.from({ length: FAISCAS_POR_ONDA }, (_, i) => (
            <i
              key={`${onda}-${i}`}
              style={{
                // a segunda onda sai girada meio passo: as faíscas não repetem o mesmo desenho
                "--ang": `${i * 45 + 22 + onda * 22}deg`,
                "--atraso": `${desde + i * 0.03}s`,
              } as CSSProperties}
            />
          )))}
        </div>
      )}
      <div className="rc-cena">
        <span className="rc-coroa" aria-hidden><Crown size={64} /></span>
        <span className="rc-carta" aria-hidden>
          <span className="rc-canto">K<br />♥</span>
          <span className="rc-naipe">♥</span>
          <span className="rc-canto rc-baixo">K<br />♥</span>
        </span>
        <b className="rc-titulo">O REI FOI CAPTURADO!</b>
        <span className="rc-quem">
          <span className="rc-nome">{voce ? "Você pegou o K♥" : `${quem} pegou o K♥`}</span>
          <span className="rc-pontos">{pontos}</span>
        </span>
      </div>
    </div>
  );
}

/** Mesma leitura do anúncio da Última Mão. Duplicada para o componente não depender dele. */
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
