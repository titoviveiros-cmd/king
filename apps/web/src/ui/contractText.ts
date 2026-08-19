// Textos pt-BR dos contratos e do trunfo. Só apresentação — nenhuma regra vive aqui:
// as unidades, os pontos e o que cada jogador capturou vêm do motor (`handBreakdown`).
import type { ContractKind, Trump } from "@king/engine";
import { SUIT_SYMBOL } from "@king/engine";

export function contractTitle(kind?: ContractKind): string {
  switch (kind) {
    case "no-tricks": return "Não pegar Vazas";
    case "no-hearts": return "Não pegar Copas";
    case "no-queens": return "Não pegar Q";
    case "no-men": return "Não pegar K e J";
    case "no-king": return "Não pegar o K de Copas";
    case "no-last-two": return "Não pegar as 2 últimas Vazas";
    case "positive": return "Positiva — Faça Vazas";
    default: return "";
  }
}

export function penaltyText(kind?: ContractKind): string {
  switch (kind) {
    case "no-tricks": return "−20 / vaza";
    case "no-hearts": return "−20 / copa";
    case "no-queens": return "−50 / q";
    case "no-men": return "−30 / k e j";
    case "no-king": return "K de Copas = −160";
    case "no-last-two": return "−90 na 12ª e na 13ª";
    case "positive": return "+25 / vaza";
    default: return "";
  }
}

/**
 * Forma LONGA da penalidade, para onde há espaço (Placar). Decisão de auditoria: no Placar usa-se
 * linguagem natural; os códigos Q / K e J ficam só nas áreas apertadas da Mesa.
 */
export function penaltyTextLong(kind?: ContractKind): string {
  switch (kind) {
    case "no-tricks": return "−20 por vaza";
    case "no-hearts": return "−20 por Copa";
    case "no-queens": return "−50 por Dama";
    case "no-men": return "−30 por Rei ou Valete";
    case "no-king": return "K de Copas = −160";
    case "no-last-two": return "−90 na 12ª e na 13ª";
    case "positive": return "+25 por vaza";
    default: return "";
  }
}

export function trumpLabel(t: Trump): string {
  return t === "no-trump" ? "Sem Trunfo" : SUIT_SYMBOL[t];
}

/** Motivo do encerramento antecipado (regra geral das negativas). */
export function earlyEndText(kind: ContractKind, tricksPlayed: number): string {
  const why =
    kind === "no-hearts" ? "todas as Copas já caíram"
    : kind === "no-queens" ? "todas as Damas já caíram"
    : kind === "no-men" ? "todos os Reis e Valetes já caíram"
    : kind === "no-king" ? "o K♥ já foi capturado"
    : "não há mais pontos em disputa";
  return `Encerrada na ${tricksPlayed}ª vaza — ${why}`;
}

/** "2 damas", "1 King", "5 vazas" — usa os rótulos que vêm do motor. */
export function unitsText(units: number, unit: string, unitPlural: string): string {
  return `${units} ${units === 1 ? unit : unitPlural}`;
}

export const fmtSigned = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
export const ordinal = (n: number) => `${n}º`;
