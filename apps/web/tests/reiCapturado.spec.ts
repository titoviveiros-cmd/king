/**
 * "O REI FOI CAPTURADO!" no navegador de verdade (mão 5, semente 42: o motor faz alguém levar a
 * vaza com o K♥ — nada é injetado no DOM).
 *
 * O risco de uma cena no meio da partida não é ela ser feia: é ATRAPALHAR. Estes testes medem que
 * ela cabe na tela, diz quem pegou e quanto custou, sai sozinha, que o toque encurta sem avançar a
 * partida, que a mesa assume depois (selo + aura) e que ela não volta.
 */
import { test, expect, type Page } from "@playwright/test";
import { insideViewport } from "./helpers/geometry.js";
import { boxOf, SEL, iniciarPartidaLocal } from "./helpers/mesa.js";

async function mesaNaMao5(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  await page.goto("/?seed=42&mao=5");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
}

/**
 * Joga (a 1ª carta legal) até a cena abrir. `false` se a captura não aconteceu no orçamento.
 * O orçamento é de TEMPO, não de voltas: na semente 42 o K♥ cai na 7ª vaza, ~25s de bots e pausas.
 */
async function ateACena(page: Page): Promise<boolean> {
  const prazo = Date.now() + 75_000;
  while (Date.now() < prazo) {
    if (await page.locator(".rc").count()) return true;
    const carta = page.locator(SEL.handCardLegal).first();
    if (await carta.count()) {
      await carta.click({ timeout: 4000 }).catch(() => {});
      if (await page.locator(SEL.handCardSelected).count()) {
        await page.locator(SEL.handCardSelected).first().click({ timeout: 4000 }).catch(() => {});
      }
      continue;
    }
    await page.waitForTimeout(60);
  }
  return await page.locator(".rc").count() > 0;
}

test("a captura do K♥ abre a cena: inteira na tela, quem pegou e −160, e depois a mesa assume", async ({ page }) => {
  test.setTimeout(120_000);
  await mesaNaMao5(page);
  test.skip(!(await ateACena(page)), "o K♥ não foi capturado dentro do orçamento");
  const vp = page.viewportSize()!;

  // A cena, num retrato só: nada da mesa anima junto com ela
  const retrato = await page.evaluate(() => ({
    titulo: document.querySelector(".rc-titulo")?.textContent,
    nome: document.querySelector(".rc-nome")?.textContent ?? "",
    pontos: document.querySelector(".rc-pontos")?.textContent,
    selo: document.querySelectorAll(".castigo").length,
    aura: document.querySelectorAll(".kcaptura").length,
  }));
  expect(retrato.titulo).toBe("O REI FOI CAPTURADO!");
  expect(retrato.nome).toMatch(/pegou o K♥$/);
  expect(retrato.pontos).toMatch(/^[-−]160$/);
  expect(retrato.selo, "o selo entrou junto com a cena").toBe(0);
  expect(retrato.aura, "a aura da mesa animou junto com a cena").toBe(0);
  const cena = await boxOf(page.locator(".rc-cena"), "cena do Rei");
  expect(insideViewport(cena, vp, 1), "a cena saiu da tela").toBe(true);

  // Sai sozinha (2s), e a mesa assume com o selo e o MESMO jogador
  await expect(page.locator(".rc")).toHaveCount(0, { timeout: 4_000 });
  await expect(page.locator(".castigo.king")).toBeVisible();
  const quem = retrato.nome.replace(/ pegou o K♥$/, "");
  await expect(page.locator(".castigo")).toContainText(quem === "Você" ? "Você pegou" : `${quem} pegou`);
  await expect(page.locator(".trick .card.kcaptura")).toHaveCount(1);

  // E não volta
  await page.waitForTimeout(900);
  await expect(page.locator(".rc")).toHaveCount(0);
});

test("um toque encerra a cena sem avançar a partida, e nada fica interceptando a mesa", async ({ page }) => {
  test.setTimeout(120_000);
  await mesaNaMao5(page);
  test.skip(!(await ateACena(page)), "o K♥ não foi capturado dentro do orçamento");
  const vp = page.viewportSize()!;
  const vaza = await page.locator(".hud .vz").textContent();

  await page.mouse.click(Math.round(vp.width / 2), Math.round(vp.height * 0.12));
  await expect(page.locator(".rc")).toHaveCount(0, { timeout: 1_500 });
  // a partida está onde estava: mesma vaza, a pausa de leitura segue com o selo
  await expect(page.locator(".hud .vz")).toHaveText(vaza ?? "");
  await expect(page.locator(".castigo.king")).toBeVisible();
  const livre = await page.evaluate(() => !document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest(".rc"));
  expect(livre, "a cena saiu mas continua interceptando").toBe(true);
});

test("com MOVIMENTO REDUZIDO a cena diz tudo sem faíscas", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mesaNaMao5(page);
  test.skip(!(await ateACena(page)), "o K♥ não foi capturado dentro do orçamento");
  await expect(page.locator(".rc.calmo")).toHaveCount(1);
  await expect(page.locator(".rc-faiscas")).toHaveCount(0);
  await expect(page.locator(".rc-titulo")).toHaveText("O REI FOI CAPTURADO!");
  await expect(page.locator(".rc-pontos")).toHaveText(/^[-−]160$/);
  await expect(page.locator(".rc")).toHaveCount(0, { timeout: 4_000 });
});
