import type { CSSProperties } from "react";
import type { Card as CardType } from "@king/engine";
import { SUIT_SYMBOL, isRed } from "@king/engine";

interface CardProps {
  card?: CardType;
  /** Verso virado para baixo (mão do oponente, pilha de compra). */
  faceDown?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

export function Card({ card, faceDown, onClick, style }: CardProps) {
  if (faceDown || !card) {
    return <div className="card back" style={style} aria-hidden />;
  }
  const symbol = SUIT_SYMBOL[card.suit];
  const color = isRed(card.suit) ? "red" : "black";
  const label = `${card.rank} de ${card.suit}`;
  return (
    <div
      className={`card ${color}`}
      style={style}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      aria-label={label}
      title={label}
    >
      <span className="corner tl">
        {card.rank}
        <span>{symbol}</span>
      </span>
      <span className="pip-center">{symbol}</span>
      <span className="corner br">
        {card.rank}
        <span>{symbol}</span>
      </span>
    </div>
  );
}
