// GEOMETRIA DA MESA — quem aparece embaixo, à esquerda, em cima e à direita.
//
// A Mesa sempre desenha VOCÊ embaixo. No modo local você é o assento 0 e os adversários são
// 1, 2 e 3 — foi assim que a mesa nasceu, com o mapa fixo `{0:"b",1:"l",2:"t",3:"r"}`.
//
// No multiplayer o servidor é quem atribui o assento: você pode ser o 2. A posição na tela passa
// então a ser a DISTÂNCIA até você, e não o número do assento. Repare que com `eu = 0` este
// cálculo devolve exatamente o mapa antigo — o modo local não muda um pixel.
import type { Seat } from "@king/engine";

/** Ordem horária a partir de você: você, esquerda, topo, direita. */
const SLOTS = ["b", "l", "t", "r"] as const;

export type Slot = (typeof SLOTS)[number];

/** Onde o assento `s` aparece na tela de quem está sentado em `eu`. */
export function slotDe(s: Seat, eu: Seat): Slot {
  return SLOTS[(s - eu + 4) % 4];
}

/** Os três adversários, em ordem de tela: esquerda, topo, direita. */
export function adversariosDe(eu: Seat): Seat[] {
  return [1, 2, 3].map((d) => ((eu + d) % 4) as Seat);
}
