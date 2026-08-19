import type { CSSProperties } from "react";
import type { Card } from "@king/engine";
import { SUIT_SYMBOL, isRed, isKingOfHearts } from "@king/engine";

export function CardView({
  card, faceDown, state, selected, style, onClick, cw,
}: {
  card?: Card;
  faceDown?: boolean;
  state?: "legal" | "illegal" | "";
  /** Estado "selecionada" do Design System (toque: escolhida, aguardando confirmação). */
  selected?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
  /** Largura fixa em px. Omitido = o CSS decide (responsivo). */
  cw?: number;
}) {
  const s: CSSProperties = { ...(cw ? { ["--cw" as string]: cw + "px" } : {}), ...style };
  if (faceDown || !card) return <div className="card back" style={s} aria-hidden />;
  const sym = SUIT_SYMBOL[card.suit];
  const king = isKingOfHearts(card);
  const cls = `card ${isRed(card.suit) ? "red" : "black"} ${state ?? ""} ${king ? "king" : ""} ${selected ? "sel" : ""}`;
  return (
    <div className={cls} style={s} onClick={onClick} role={onClick ? "button" : undefined}
      aria-label={`${card.rank} de ${card.suit}`}>
      <span className="idx"><b>{card.rank}</b><span>{sym}</span></span>
      {king && <span className="kb">👑</span>}
      <span className="pip">{sym}</span>
    </div>
  );
}
