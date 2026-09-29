/**
 * A PRIVACIDADE, ALCANÇÁVEL E LEGÍVEL — em todos os viewports da suíte.
 *
 * O link entrou na linha do rodapé da Home, e a Home precisa caber até em 852×300. Aqui se prova
 * que ele não custou nada: o "Jogar agora" continua inteiro na tela, não há rolagem lateral, o
 * link não cruza nenhum outro elemento e é alcançável (nos três viewports da validação pedida,
 * 667×375, 852×393 e 1600×900, sem rolar nada). E que a página abre, cabe na largura, não pede
 * nada a terceiros e devolve ao jogo.
 */
import { expect, test, type Page } from "@playwright/test";
import { SEL } from "./helpers/mesa.js";

const SEM_ROLAR = new Set(["667x375", "852x393", "1600x900"]);
const link = (page: Page) => page.locator(".home .foot .hm-privacidade");

async function semAnimacao(page: Page) {
  await page.evaluate(() => document.querySelectorAll("*").forEach((el) => el.getAnimations().forEach((a) => {
    if ((a.effect?.getTiming().iterations ?? 1) !== Infinity) a.finish();
  })));
}

test("Home: o link de Privacidade está no rodapé, alcançável, sem empurrar nem cruzar nada", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.locator(SEL.startBtn)).toBeVisible();
  await semAnimacao(page);
  const vp = page.viewportSize()!;

  await expect(link(page)).toHaveAttribute("href", "/privacidade.html");
  await expect(link(page)).toHaveText("Privacidade");

  // O CTA principal continua INTEIRO na tela.
  const cta = (await page.locator(SEL.startBtn).boundingBox())!;
  expect(cta.y).toBeGreaterThanOrEqual(0);
  expect(cta.y + cta.height).toBeLessThanOrEqual(vp.height);

  // Sem rolagem lateral, nem da página nem da Home.
  const lateral = await page.evaluate(() => {
    const h = document.querySelector(".home")!;
    return { doc: document.documentElement.scrollWidth - innerWidth, home: h.scrollWidth - h.clientWidth };
  });
  expect(lateral.doc).toBeLessThanOrEqual(0);
  expect(lateral.home).toBeLessThanOrEqual(0);

  // Nenhum outro elemento visível da Home cruza o link.
  const cruzamentos = await page.evaluate(() => {
    const r = document.querySelector(".home .foot .hm-privacidade")!.getBoundingClientRect();
    return [...document.querySelectorAll(".home *")].filter((el) => {
      if (el.contains(document.querySelector(".hm-privacidade")) || el.classList.contains("hm-privacidade")) return false;
      const o = el.getBoundingClientRect();
      return o.width > 0 && o.height > 0 && o.left < r.right - 1 && o.right > r.left + 1 && o.top < r.bottom - 1 && o.bottom > r.top + 1;
    }).map((el) => el.className || el.tagName);
  });
  expect(cruzamentos).toEqual([]);

  // Alcançável: nos viewports da validação, sem rolar; nos demais, rolando a Home.
  if (!SEM_ROLAR.has(info.project.name)) await link(page).scrollIntoViewIfNeeded();
  const l = (await link(page).boundingBox())!;
  expect(l.x).toBeGreaterThanOrEqual(0);
  expect(l.x + l.width).toBeLessThanOrEqual(vp.width);
  expect(l.y).toBeGreaterThanOrEqual(0);
  expect(l.y + l.height, "o link tem de estar na tela").toBeLessThanOrEqual(vp.height);
});

test("a página abre, cabe na largura, não pede nada a terceiros e volta ao jogo", async ({ page }) => {
  const pedidos: string[] = [];
  page.on("request", (r) => pedidos.push(r.url()));
  await page.goto("/");
  await expect(page.locator(SEL.startBtn)).toBeVisible();
  const origem = new URL(page.url()).origin;
  await semAnimacao(page);
  await link(page).scrollIntoViewIfNeeded();
  pedidos.length = 0;
  await link(page).click();

  await expect(page).toHaveURL(/\/privacidade\.html$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacidade" })).toBeVisible();
  await expect(page.getByText("NUNCA é enviado ao PostHog")).toBeVisible();
  const largura = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(largura, "sem rolagem lateral").toBeLessThanOrEqual(0);
  expect(pedidos.filter((u) => !u.startsWith(origem)), "a página não fala com ninguém de fora").toEqual([]);

  await page.getByRole("link", { name: "Voltar ao jogo" }).first().click();
  await expect(page.locator(SEL.startBtn)).toBeVisible();
});
