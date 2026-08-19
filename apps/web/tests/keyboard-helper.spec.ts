/**
 * BUG 1 (regressão) — a dica de teclado ("← → escolher · Enter jogar") NÃO pode tocar o leque.
 *
 * Regra do Design System: o helper é keyboard-only (some no toque), fica ACIMA do ponto mais alto
 * do leque com folga, e desaparece após a 1ª tecla ou alguns segundos. Aqui verificamos a geometria
 * real: keyboard-helper × leque/vaza = zero interseção, inclusive com uma carta SELECIONADA (elevada).
 */
import { test, expect, type Page } from "@playwright/test";
import { intersects, overlapArea, gap, insideViewport, fmt, type Viewport } from "./helpers/geometry.js";
import { openMesaStress, boxOf, boxesOf, SEL } from "./helpers/mesa.js";

const SUBPIXEL = 1;
/** A dica só existe em ambiente com teclado — nas fixtures, os viewports "desktop" (altos). */
const isDesktopViewport = (vp: Viewport) => vp.height >= 700;

test.describe("BUG 1 — dica de teclado × leque", () => {
  test("desktop: keyboard-helper × leque/vaza = zero interseção (inclui carta selecionada)", async ({ page }, ti) => {
    const vp = page.viewportSize()!;
    test.skip(!isDesktopViewport(vp), "dica de teclado só existe em ambiente com teclado (viewports desktop altos)");

    await openMesaStress(page);
    const kh = page.locator(SEL.keyhint);
    await expect(kh, "a dica de teclado deveria aparecer no desktop na vez do humano").toBeVisible({ timeout: 9000 });

    const khBox = await boxOf(kh, "keyhint");
    const cards = await boxesOf(page, SEL.handCard);
    cards.forEach((c, i) => {
      expect(
        intersects(khBox, c, SUBPIXEL),
        `[${ti.project.name} · ${vp.width}×${vp.height}] keyhint × leque[${i}] colidem\n` +
        `   keyhint: ${fmt(khBox)}\n   carta[${i}]: ${fmt(c)}\n   interseção=${overlapArea(khBox, c).toFixed(1)}px²  gap=${gap(khBox, c).toFixed(1)}px`,
      ).toBe(false);
    });
    (await boxesOf(page, SEL.trickCard)).forEach((t, i) =>
      expect(intersects(khBox, t, SUBPIXEL), `keyhint × vaza[${i}] colidem`).toBe(false),
    );
    expect(insideViewport(khBox, vp, SUBPIXEL), `keyhint fora do viewport: ${fmt(khBox)}`).toBe(true);

    // Estado SELECIONADA: uma tecla de seta seleciona/eleva uma carta. Por regra a dica some na
    // 1ª interação de teclado — então ou ela desaparece, ou (se visível) não pode tocar a carta.
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(SEL.handCardSelected), "a seta deveria selecionar uma carta").toHaveCount(1);
    if (await kh.isVisible()) {
      const kh2 = await boxOf(kh, "keyhint");
      const sel = await boxOf(page.locator(SEL.handCardSelected), "carta selecionada");
      expect(intersects(kh2, sel, SUBPIXEL), `keyhint × carta SELECIONADA colidem: kh=${fmt(kh2)} sel=${fmt(sel)}`).toBe(false);
    }
  });

  // A inexistência no mobile independe do viewport do projeto — roda uma única vez.
  test("mobile (pointer coarse): a dica de teclado é inexistente", async ({ browser }, ti) => {
    test.skip(ti.project.name !== "1024x768", "verificação única (contexto mobile próprio)");
    const ctx = await browser.newContext({ viewport: { width: 874, height: 402 }, isMobile: true, hasTouch: true });
    const page: Page = await ctx.newPage();
    try {
      await openMesaStress(page);
      await expect(page.locator(SEL.keyhint), "no toque a dica de teclado não deve existir").toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
