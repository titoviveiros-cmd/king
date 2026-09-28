/**
 * SEM CONFIGURAÇÃO, SILÊNCIO DE VERDADE.
 *
 * O build de e2e principal não tem `VITE_POSTHOG_*` — é exatamente o estado de Production até a
 * Fase 4F-B. Nele, o analytics tem de ser o adaptador silencioso: o pedaço do SDK (`posthogSdk-*`)
 * nunca é pedido e nenhum host de fora é contatado, nem abrindo, nem jogando.
 *
 * Um viewport basta: isto é rede, não layout.
 */
import { expect, test } from "@playwright/test";
import { SEL, iniciarPartidaLocal } from "./helpers/mesa.js";

test("sem VITE_POSTHOG_*: o SDK não é baixado e nada sai para fora", async ({ page }, info) => {
  test.skip(info.project.name !== "852x393", "um viewport basta: é rede, não layout");
  const pedidos: string[] = [];
  page.on("request", (r) => pedidos.push(r.url()));
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio", JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
    } catch { /* segue */ }
  });

  await page.goto("/?utm_source=instagram&seed=42&mao=10");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);

  expect(pedidos.filter((u) => /posthog/i.test(u)), "nenhum pedaço do SDK nem host do PostHog").toEqual([]);
  const origem = new URL(page.url()).origin;
  const externos = pedidos.filter((u) => !u.startsWith(origem) && !u.startsWith("data:"));
  expect(externos, "o modo local não fala com ninguém de fora").toEqual([]);
});
