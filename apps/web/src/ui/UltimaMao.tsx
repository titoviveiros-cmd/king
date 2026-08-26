// ÚLTIMA MÃO DO JOGO — o único momento em que o KING para para dizer alguma coisa.
//
// ⚠ ISTO É APRESENTAÇÃO PURA. Não toca no motor, não muda ordem, trunfo, dealer, chooser, timer
// nem pontuação. A mão 10 continua sendo positiva, +25 por vaza, com a escolha de trunfo do
// jogador da rotação e as mesmas 13 vazas. Se este arquivo inteiro sumir, a partida é idêntica.
//
// AS TRÊS REGRAS QUE ELE OBEDECE, e todas vieram da mesma preocupação — celebração que atrapalha
// vira obstáculo:
//
//   1. NÃO BLOQUEIA. Sai sozinho em ~1,9s, e um toque encurta. Nunca exige interação, nunca
//      espera confirmação, e o `pointer-events` some junto com o elemento.
//   2. APARECE UMA VEZ. Quem reconecta no meio da mão 10 não assiste de novo — a marca é por
//      partida e por mão, guardada em ref, não em estado que remonta.
//   3. NÃO DEPENDE DE MOVIMENTO NEM DE SOM. Com movimento reduzido, o giro sai e fica o fade; com
//      áudio desligado, o texto diz tudo. Nenhuma informação mora só na animação.
import { useEffect, useRef, useState } from "react";
import { Crown } from "./Crown.js";
import { sfxUltimaMao } from "../audio/sounds.js";

/** Quanto tempo o anúncio fica sozinho na tela. Um toque encurta; nada o prolonga. */
const DURACAO_MS = 1900;
/** Fade de saída. Par do `.um.saindo` no theme.css. */
const SAIDA_MS = 320;

export function UltimaMao({ onFim }: { onFim: () => void }) {
  const [saindo, setSaindo] = useState(false);
  const reduzido = usePrefersReducedMotion();
  const encerrado = useRef(false);

  /** Fecha uma vez só, venha o fim do tempo ou o dedo. */
  const encerrar = useRef(() => {
    if (encerrado.current) return;
    encerrado.current = true;
    setSaindo(true);
    setTimeout(onFim, SAIDA_MS);
  });

  useEffect(() => {
    // O som e a vibração são acompanhamento: `sfxUltimaMao` sai cedo se os efeitos estiverem
    // desligados, e a vibração só existe onde o aparelho oferece. Nada aqui é requisito.
    sfxUltimaMao();
    const id = setTimeout(() => encerrar.current(), DURACAO_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <div
      className={`um${saindo ? " saindo" : ""}${reduzido ? " calmo" : ""}`}
      onClick={() => encerrar.current()}
      role="status"
      aria-live="polite"
    >
      <div className="um-selo">
        <Crown size={72} />
        <b>ÚLTIMA MÃO DO JOGO!</b>
        <i>Tudo pode mudar agora.</i>
      </div>
    </div>
  );
}

/** Mesma leitura que o Placar Final usa. Duplicada aqui para o componente não depender dele. */
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
