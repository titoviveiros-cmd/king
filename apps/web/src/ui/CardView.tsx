import type { CSSProperties } from "react";
import type { Card } from "@king/engine";
import { SUIT_SYMBOL, isRed, isKingOfHearts } from "@king/engine";

export function CardView({
  card, faceDown, state, style, onClick, cw,
}: {
  card?: Card;
  faceDown?: boolean;
  state?: "legal" | "illegal" | "";
  style?: CSSProperties;
  onClick?: () => void;
  cw?: number;
}) {
  const s: CSSProperties = { ...(cw ? { ["--cw" as string]: cw + "px" } : {}), ...style };
  if (faceDown || !card) return <div className="card back" style={s} aria-hidden />;
  const sym = SUIT_SYMBOL[card.suit];
  const king = isKingOfHearts(card);
  const cls = `card ${isRed(card.suit) ? "red" : "black"} ${state ?? ""} ${king ? "king" : ""}`;
  return (
    <div className={cls} style={s} onClick={onClick} role={onClick ? "button" : undefined}
      aria-label={`${card.rank} de ${card.suit}`}>
      <span className="idx"><b>{card.rank}</b><span>{sym}</span></span>
      {king && <span className="kb">👑</span>}
      <span className="pip">{sym}</span>
    </div>
  );
}
