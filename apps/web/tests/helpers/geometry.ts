/**
 * Geometria pura para os testes de layout — SEM Playwright, SEM DOM.
 *
 * Recebe caixas (bounding boxes) já lidas do DOM real e responde perguntas objetivas:
 * há interseção indevida? qual a folga? o elemento cabe no viewport?
 *
 * É o único lugar onde a matemática de colisão existe — os specs só chamam estas funções
 * (regra do milestone: "não espalhe cálculos duplicados pelos testes").
 */

/** Caixa no sistema do viewport, em CSS px — o mesmo formato de `Locator.boundingBox()`. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const right = (b: Box): number => b.x + b.width;
export const bottom = (b: Box): number => b.y + b.height;
export const area = (b: Box): number => Math.max(0, b.width) * Math.max(0, b.height);

/** Sobreposição em cada eixo (positiva = quanto as caixas se penetram naquele eixo). */
function overlapX(a: Box, b: Box): number {
  return Math.min(right(a), right(b)) - Math.max(a.x, b.x);
}
function overlapY(a: Box, b: Box): number {
  return Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
}

/** Área de interseção das duas caixas (0 se não se tocam). */
export function overlapArea(a: Box, b: Box): number {
  return Math.max(0, overlapX(a, b)) * Math.max(0, overlapY(a, b));
}

/**
 * Há interseção real? Só conta como colisão se as caixas se penetram em AMBOS os eixos por
 * mais que `tol` (a tolerância existe para absorver arredondamento sub-pixel — ver SUBPIXEL).
 */
export function intersects(a: Box, b: Box, tol = 0): boolean {
  return overlapX(a, b) > tol && overlapY(a, b) > tol;
}

/**
 * Folga (gap) entre duas caixas, em px:
 *  - **positiva** = distância que as separa (euclidiana quando separadas nos dois eixos);
 *  - **0** = encostadas;
 *  - **negativa** = penetração (profundidade da colisão, = −min das sobreposições dos eixos).
 */
export function gap(a: Box, b: Box): number {
  const ox = overlapX(a, b);
  const oy = overlapY(a, b);
  if (ox > 0 && oy > 0) return -Math.min(ox, oy); // penetrando nos dois eixos = colisão
  const sepX = Math.max(0, -ox); // separação horizontal (0 se há sobreposição no X)
  const sepY = Math.max(0, -oy);
  if (sepX > 0 && sepY > 0) return Math.hypot(sepX, sepY); // separadas na diagonal
  return sepX + sepY; // separadas em um único eixo
}

/** A caixa cabe inteira no viewport (permitido transbordar até `tol`)? */
export function insideViewport(b: Box, vp: Viewport, tol = 0): boolean {
  return b.x >= -tol && b.y >= -tol && right(b) <= vp.width + tol && bottom(b) <= vp.height + tol;
}

/** Quais bordas do viewport a caixa ultrapassa, e por quanto — para diagnóstico legível. */
export function overflowEdges(b: Box, vp: Viewport, tol = 0): string[] {
  const out: string[] = [];
  if (b.x < -tol) out.push(`esquerda por ${(-b.x).toFixed(1)}px`);
  if (b.y < -tol) out.push(`topo por ${(-b.y).toFixed(1)}px`);
  if (right(b) > vp.width + tol) out.push(`direita por ${(right(b) - vp.width).toFixed(1)}px`);
  if (bottom(b) > vp.height + tol) out.push(`base por ${(bottom(b) - vp.height).toFixed(1)}px`);
  return out;
}

/** Formata uma caixa para mensagens de falha. */
export function fmt(b: Box): string {
  return `{x:${b.x.toFixed(1)}, y:${b.y.toFixed(1)}, w:${b.width.toFixed(1)}, h:${b.height.toFixed(1)}` +
    ` → dir:${right(b).toFixed(1)}, base:${bottom(b).toFixed(1)}}`;
}
