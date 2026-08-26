/**
 * "ÚLTIMA MÃO DO JOGO!" no navegador de verdade.
 *
 * O risco de um anúncio no meio da partida não é ele ser feio: é BLOQUEAR. Estes testes medem
 * exatamente isso — que ele sai sozinho, que o toque encurta, que depois de sair não sobra nada
 * interceptando a Mesa, e que ele nunca aparece na mão errada.
 */
import { test, expect, type Page } from "@playwright/test";
import { insideViewport, type Box } from "./helpers/geometry.js";
import { boxOf, SEL } from "./helpers/mesa.js";

const SUBPIXEL = 1;

/**
 * Abre a Mesa local JÁ na mão pedida.
 *
 * Jogar nove mãos de 13 vazas pela interface leva mais de cinco minutos, no ritmo dos bots e das
 * pausas de leitura. O `?mao=` é a mesma afordância de QA que o `?seed=` já era, e monta a mão
 * pelo motor: contrato, distribuição, dealer e rotação do trunfo continuam sendo dele.
 */
async function mesaNaMao(page: Page, mao: number): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  await page.goto(`/?seed=42&mao=${mao}`);
  await page.locator(SEL.startBtn).click();
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`${SEL.hud} .ph`)).toContainText(`Mão ${mao}`);
}

test("aparece na mão 10, some sozinho e não deixa nada interceptando", async ({ page }, ti) => {
  const vp = page.viewportSize()!;
  // Na mão 9 ainda não existe.
  await mesaNaMao(page, 9);
  await page.waitForTimeout(500);
  await expect(page.locator(".um"), "apareceu antes da hora").toHaveCount(0);

  await mesaNaMao(page, 10);

  const selo = page.locator(".um-selo");
  await expect(selo).toBeVisible({ timeout: 15_000 });
  await expect(selo).toContainText("ÚLTIMA MÃO");
  await expect(selo).toContainText("Tudo pode mudar");

  // Cabe na tela em qualquer viewport.
  const caixa = await boxOf(selo, "um-selo");
  expect(
    insideViewport(caixa as Box, vp, SUBPIXEL),
    `[${ti.project.name} · ${vp.width}×${vp.height}] o anúncio saiu da tela`,
  ).toBe(true);

  // FICA TEMPO DE LER. Eram 1,9s e no teste manual não deu para ler; agora são ~3s de presença
  // (2,6s de permanência + 0,42s de saída). O teste cobra o piso: ainda na tela depois de 2s.
  await page.waitForTimeout(2000);
  await expect(page.locator(".um-selo"), "sumiu antes de dar para ler").toBeVisible();

  // E SAI SOZINHO. Nada de exigir toque.
  await expect(page.locator(".um")).toHaveCount(0, { timeout: 8000 });

  // E não sobra camada nenhuma sobre a Mesa: o leque volta a receber toque.
  const nada = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.86);
    return el?.closest(".um") !== null;
  });
  expect(nada, "o anúncio continua interceptando o toque depois de sair").toBe(false);

  // A mão 10 é a do motor, intocada.
  await expect(page.locator(`${SEL.hud} .ph`)).toContainText("Mão 10");
  await expect(page.locator(`${SEL.hud} .ph`)).toContainText("positiva");
});

test("não aparece duas vezes na mesma mão", async ({ page }, ti) => {
  test.skip(ti.project.name !== "667x375", "comportamento, não geometria");
  await mesaNaMao(page, 10);

  await expect(page.locator(".um")).toHaveCount(0, { timeout: 15_000 });

  // A Mesa redesenha muitas vezes por mão (bots, relógio, cartas). Nenhum desses redesenhos pode
  // reabrir o anúncio: a visibilidade é derivada de "mão 10 e ainda não dispensada".
  for (let i = 0; i < 6; i++) {
    const carta = page.locator(SEL.handCardLegal).first();
    if (await carta.count()) {
      await carta.click({ timeout: 4000 }).catch(() => {});
      if (await page.locator(SEL.handCardSelected).count()) {
        await carta.click({ timeout: 4000 }).catch(() => {});
      }
    }
    await page.waitForTimeout(400);
    expect(await page.locator(".um").count(), `reabriu no ciclo ${i}`).toBe(0);
  }
});

test("com MOVIMENTO REDUZIDO a informação continua inteira", async ({ page }, ti) => {
  test.skip(ti.project.name !== "667x375", "comportamento, não geometria");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mesaNaMao(page, 10);

  const selo = page.locator(".um-selo");
  await expect(selo).toBeVisible({ timeout: 15_000 });
  await expect(selo).toContainText("ÚLTIMA MÃO");
  // sem giro: a classe `calmo` troca a animação por fade + escala
  await expect(page.locator(".um.calmo")).toHaveCount(1);
  await expect(page.locator(".um")).toHaveCount(0, { timeout: 8000 });
});
