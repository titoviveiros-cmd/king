/**
 * Testes de LAYOUT da Mesa — geometria e acessibilidade objetivas sobre o DOM real.
 *
 * Rodam sob cada viewport (projetos do playwright.config). Não checam estética/pixel; checam
 * matematicamente que componentes distintos não colidem, que tudo cabe no viewport e que as 13
 * cartas continuam identificáveis e alcançáveis. A sobreposição INTENCIONAL do leque (cartas
 * irmãs) nunca é tratada como colisão — só o cruzamento entre componentes DIFERENTES é.
 */
import { test, expect, type Page } from "@playwright/test";
import {
  intersects, gap, overlapArea, insideViewport, overflowEdges, fmt, type Box, type Viewport,
} from "./helpers/geometry.js";
import {
  openMesaStress, boxOf, boxesOf, cardReachable, horizontalOverflow, idxBoxes, SEL, SEED,
} from "./helpers/mesa.js";

/**
 * Tolerância ÚNICA e justificada: 1px absorve o arredondamento sub-pixel de
 * `getBoundingClientRect()` e das transformações CSS (rotação do leque). Colisões reais são de
 * vários px; folgas do Design System nas telas mais baixas são de 8px+ (ver KING-DESIGN-SYSTEM).
 */
const SUBPIXEL = 1;

const vpOf = (page: Page): Viewport => {
  const v = page.viewportSize();
  if (!v) throw new Error("viewport não definido");
  return v;
};

test.beforeEach(async ({ page }) => {
  await openMesaStress(page, SEED);
});

/** Falha (com evidência completa) se duas caixas de componentes distintos se cruzam. */
function assertApart(
  proj: string, vp: Viewport, aName: string, a: Box, bName: string, b: Box, tol = SUBPIXEL,
): void {
  const hit = intersects(a, b, tol);
  const msg =
    `[${proj} · ${vp.width}×${vp.height}] COLISÃO INDEVIDA: ${aName} × ${bName}\n` +
    `   A ${aName}: ${fmt(a)}\n` +
    `   B ${bName}: ${fmt(b)}\n` +
    `   interseção=${overlapArea(a, b).toFixed(1)}px²  gap=${gap(a, b).toFixed(1)}px  (tol=${tol}px)`;
  expect(hit, msg).toBe(false);
}

/** Falha (com evidência) se a caixa não couber inteira no viewport. */
function assertInside(proj: string, vp: Viewport, name: string, b: Box, tol = SUBPIXEL): void {
  const ok = insideViewport(b, vp, tol);
  const msg =
    `[${proj} · ${vp.width}×${vp.height}] FORA DO VIEWPORT: ${name}\n` +
    `   ${name}: ${fmt(b)}\n   transborda: ${overflowEdges(b, vp, tol).join(", ") || "—"}`;
  expect(ok, msg).toBe(true);
}

// ───────────────────────────── cenário / sanidade ─────────────────────────────
test("cenário determinístico: 13 no leque + 3 na vaza + vez do humano", async ({ page }) => {
  await expect(page.locator(SEL.youtagActive)).toBeVisible();
  await expect(page.locator(SEL.handCard)).toHaveCount(13);
  await expect(page.locator(SEL.trickCard)).toHaveCount(3);
});

// ───────────────────────────── pares de colisão obrigatórios ─────────────────────────────
test("A · player card do topo × cartas da vaza", async ({ page }, ti) => {
  const vp = vpOf(page);
  const top = await boxOf(page.locator(SEL.oppTop), "opp.top");
  const trick = await boxesOf(page, SEL.trickCard);
  expect(trick.length, "esperava cartas na vaza").toBeGreaterThan(0);
  trick.forEach((t, i) => assertApart(ti.project.name, vp, "opp.top", top, `vaza[${i}]`, t));
});

test("B · player card local × leque", async ({ page }, ti) => {
  const vp = vpOf(page);
  const you = await boxOf(page.locator(SEL.youtag), "youtag");
  const hand = await boxesOf(page, SEL.handCard);
  hand.forEach((c, i) => assertApart(ti.project.name, vp, "youtag", you, `leque[${i}]`, c));
});

test("C · vaza × leque", async ({ page }, ti) => {
  const vp = vpOf(page);
  const trick = await boxesOf(page, SEL.trickCard);
  const hand = await boxesOf(page, SEL.handCard);
  trick.forEach((t, ti2) =>
    hand.forEach((c, ci) => assertApart(ti.project.name, vp, `vaza[${ti2}]`, t, `leque[${ci}]`, c)),
  );
});

test("D · HUD do contrato × elementos dos jogadores", async ({ page }, ti) => {
  const vp = vpOf(page);
  const hud = await boxOf(page.locator(SEL.hud), "hud");
  const others: Array<[string, Box]> = [
    ["opp.left", await boxOf(page.locator(SEL.oppLeft), "opp.left")],
    ["opp.top", await boxOf(page.locator(SEL.oppTop), "opp.top")],
    ["opp.right", await boxOf(page.locator(SEL.oppRight), "opp.right")],
    ["youtag", await boxOf(page.locator(SEL.youtag), "youtag")],
  ];
  for (const [name, b] of others) assertApart(ti.project.name, vp, "hud", hud, name, b);
  const trick = await boxesOf(page, SEL.trickCard);
  trick.forEach((t, i) => assertApart(ti.project.name, vp, "hud", hud, `vaza[${i}]`, t));
});

test("E · controles do topo (emote/laterais) × leque e adversários", async ({ page }, ti) => {
  const vp = vpOf(page);
  // Não há botão de emote nesta fase; os controles reais no canto são `.topbtn`
  // (Tela cheia / Áudio / Sair). Verificamos que eles não invadem o leque nem os adversários.
  const topbtn = await boxOf(page.locator(SEL.topbtn), "topbtn");
  const hand = await boxesOf(page, SEL.handCard);
  hand.forEach((c, i) => assertApart(ti.project.name, vp, "topbtn", topbtn, `leque[${i}]`, c));
  assertApart(ti.project.name, vp, "topbtn", topbtn, "opp.top", await boxOf(page.locator(SEL.oppTop), "opp.top"));
  assertApart(ti.project.name, vp, "topbtn", topbtn, "opp.right", await boxOf(page.locator(SEL.oppRight), "opp.right"));
});

test("F · cartas/leque × base da tela (safe area) e sem overflow horizontal", async ({ page }, ti) => {
  const vp = vpOf(page);
  const hand = await boxesOf(page, SEL.handCard);
  hand.forEach((c, i) => assertInside(ti.project.name, vp, `leque[${i}]`, c));
  const ho = await horizontalOverflow(page);
  expect(
    ho.overflow,
    `[${ti.project.name} · ${vp.width}×${vp.height}] OVERFLOW horizontal: scrollWidth=${ho.scrollW} > clientWidth=${ho.clientW}`,
  ).toBe(false);
});

// ───────────────────────────── mão de 13 cartas ─────────────────────────────
test("13 cartas: existem, cabem, índice presente, legais e extremos alcançáveis", async ({ page }, ti) => {
  const vp = vpOf(page);
  const hand = await boxesOf(page, SEL.handCard);
  expect(hand.length, "deveriam existir 13 cartas no leque").toBe(13);

  // cabem na área útil (a carta da ponta é girada ~13,8° — a caixa já inclui a sobra)
  hand.forEach((c, i) => assertInside(ti.project.name, vp, `carta[${i}]`, c));

  // o índice identificador (.idx) de cada carta está presente, com área e dentro do viewport
  const idx = await idxBoxes(page);
  expect(idx.length, "cada carta deve ter seu índice (.idx) exposto").toBe(13);
  idx.forEach((b, i) => {
    expect(b.width * b.height, `índice[${i}] sem área`).toBeGreaterThan(0);
    assertInside(ti.project.name, vp, `índice[${i}]`, b);
  });

  // nenhuma carta legal fica inacessível (sobreposição do leque é intencional; overlay não)
  const legalCount = await page.locator(SEL.handCardLegal).count();
  expect(legalCount, "deveria haver ao menos 1 carta legal na vez do humano").toBeGreaterThan(0);
  for (let i = 0; i < hand.length; i++) {
    const r = await cardReachable(page, i);
    expect(
      r.reachable,
      `[${ti.project.name} · ${vp.width}×${vp.height}] carta[${i}] inacessível ` +
      `(ponto ${r.point.x.toFixed(0)},${r.point.y.toFixed(0)} caiu em "${r.hit}")`,
    ).toBe(true);
  }

  // primeira e última explicitamente alcançáveis
  for (const i of [0, hand.length - 1]) {
    const r = await cardReachable(page, i);
    expect(r.reachable, `extremo carta[${i}] inacessível (caiu em "${r.hit}")`).toBe(true);
  }

  const ho = await horizontalOverflow(page);
  expect(ho.overflow, `overflow horizontal: ${ho.scrollW} > ${ho.clientW}`).toBe(false);
});

// ───────────────────────────── safe area / viewport ─────────────────────────────
test("elementos críticos permanecem dentro do viewport", async ({ page }, ti) => {
  const vp = vpOf(page);
  const critical: Array<[string, string]> = [
    ["HUD", SEL.hud],
    ["controles do topo", SEL.topbtn],
    ["jogador local", SEL.youtag],
    ["adversário esquerda", SEL.oppLeft],
    ["adversário topo", SEL.oppTop],
    ["adversário direita", SEL.oppRight],
  ];
  for (const [name, sel] of critical) {
    assertInside(ti.project.name, vp, name, await boxOf(page.locator(sel), name));
  }
  // vaza e leque, carta a carta
  (await boxesOf(page, SEL.trickCard)).forEach((b, i) => assertInside(ti.project.name, vp, `vaza[${i}]`, b));
  (await boxesOf(page, SEL.handCard)).forEach((b, i) => assertInside(ti.project.name, vp, `leque[${i}]`, b));
});
