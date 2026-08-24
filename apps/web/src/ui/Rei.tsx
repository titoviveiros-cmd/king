// "O REI" — o guia do tutorial.
//
// ⚠ VISUAL PROVISÓRIO E CONTROLADO.
//
// O mascote definitivo do KING ("O Rei") ainda não foi desenhado, e a decisão foi explícita: não
// produzir a arte final nesta rodada. O que existe aqui é um SVG mínimo — a coroa já congelada no
// Design System sobre um disco — que cumpre a função (dizer "é ele falando") sem fingir ser o
// personagem. Quando a ilustração chegar, troca-se este componente e nada mais.
//
// Ele ORIENTA, NÃO DOMINA. Ocupa o rodapé, uma linha de texto, sem cobrir carta nem HUD. Se em
// algum momento a fala precisar de dois parágrafos, o problema é a fala, não o espaço.
import { Crown } from "./Crown.js";

export type HumorDoRei = "fala" | "acerto" | "erro";

export function Rei({ fala, humor = "fala" }: { fala: string; humor?: HumorDoRei }) {
  return (
    <div className={`rei ${humor}`} role="status" aria-live="polite">
      <span className="rei-cara" aria-hidden>
        <Crown size={34} />
      </span>
      <p className="rei-fala">{fala}</p>
    </div>
  );
}
