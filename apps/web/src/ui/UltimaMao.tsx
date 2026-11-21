// ÚLTIMA MÃO DO JOGO — o único momento em que o KING para para dizer alguma coisa.
//
// ⚠ ISTO É APRESENTAÇÃO PURA. Não toca no motor, não muda ordem, trunfo, dealer, chooser, timer
// nem pontuação. A mão 10 continua sendo positiva, +25 por vaza, com a escolha de trunfo do
// jogador da rotação e as mesmas 13 vazas. Se este arquivo inteiro sumir, a partida é idêntica.
//
// AS TRÊS REGRAS QUE ELE OBEDECE, e todas vieram da mesma preocupação — celebração que atrapalha
// vira obstáculo:
//
//   1. NÃO BLOQUEIA. Sai sozinho em ~6s, e um toque encurta. Nunca exige interação, nunca
//      espera confirmação, e o `pointer-events` some junto com o elemento.
//   2. APARECE UMA VEZ. Quem reconecta no meio da mão 10 não assiste de novo — a marca é por
//      partida e por mão, guardada em ref, não em estado que remonta.
//   3. NÃO DEPENDE DE MOVIMENTO NEM DE SOM. Com movimento reduzido, o giro sai e fica o fade; com
//      áudio desligado, o texto diz tudo. Nenhuma informação mora só na animação.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Crown } from "./Crown.js";
import { sfxUltimaMao } from "../audio/sounds.js";

/**
 * Quanto tempo o anúncio fica sozinho na tela. Um toque encurta; nada o prolonga.
 *
 * Eram 1,9s, e no teste manual a pessoa não conseguiu ler: a entrada sozinha come meio segundo,
 * então sobrava pouco mais de um segundo de leitura para duas linhas. Foram para 2,6s — cerca de
 * 3s de presença total — e o segundo teste em aparelho ainda pediu um pouco mais: a mesa tem
 * quatro pessoas, e o anúncio precisa dar tempo de TODAS notarem, não só de quem já estava
 * olhando. Foram 3,3s de permanência mais 0,42s de saída (~3,7s).
 *
 * Agora são 5,58s + 0,42s = 6s de presença. A última mão é o clímax da partida e o anúncio
 * passou a ser tratado como cena, não como aviso: a frase gira, assenta e RESPIRA na tela tempo
 * suficiente para ser lida com calma num celular deitado, por quem estava olhando para outro
 * lado. Continua saindo sozinho, e o toque continua encurtando.
 *
 * O SERVIDOR CONHECE ESTE NÚMERO (`aberturaDaUltimaMao` = DURACAO_MS + SAIDA_MS, travado por
 * teste): ele estende o prazo da primeira decisão da mão 10 por esse tempo e segura o bot durante
 * ele. Por isso o toque encurta só a CENA — online, um bot continua esperando o respiro
 * autoritativo acabar, e o relógio de quem decide não perdeu nada para a animação.
 */
const DURACAO_MS = 5580;
/** Fade de saída. Par do `.um.saindo` no theme.css. */
const SAIDA_MS = 420;
/** Quando cada onda de faíscas sai (s): a da chegada e a do meio da leitura. */
const ONDAS_DE_FAISCAS = [0.24, 2.9] as const;

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
      // O toque encerra o anúncio e para aqui: nenhum ouvinte da Mesa o trata como seu. Durante o
      // anúncio a Mesa não tem leque nem vaza, então não há o que o dedo pudesse acionar por baixo.
      onClick={(e) => { e.stopPropagation(); encerrar.current(); }}
      role="status"
      aria-live="polite"
    >
      {/* O halo atrás do selo: acende com a frase e respira durante a leitura. */}
      {!reduzido && <span className="um-luz" aria-hidden />}
      {/* As faíscas são seis por onda, saem da coroa e somem. Nenhuma depende de biblioteca: são
          `<i>` com uma animação CSS e um ângulo próprio, o mesmo princípio do burst do Placar
          Final. A segunda onda, menor no tempo e girada meio passo, acontece no meio da leitura —
          com 6s de anúncio, uma onda só deixava a tela parada por quatro. Somem inteiras com
          movimento reduzido. */}
      {!reduzido && (
        <div className="um-faiscas" aria-hidden>
          {ONDAS_DE_FAISCAS.flatMap((desde, onda) => Array.from({ length: 6 }, (_, i) => (
            <i
              key={`${onda}-${i}`}
              style={{ "--ang": `${i * 60 + 15 + onda * 30}deg`, "--atraso": `${desde + i * 0.045}s` } as CSSProperties}
            />
          )))}
        </div>
      )}
      <div className="um-selo">
        <span className="um-coroa"><Crown size={72} /></span>
        <b>ÚLTIMA MÃO</b>
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
