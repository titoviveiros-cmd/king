/**
 * A VERSÃO NA HOME — no pacote de verdade, em todos os viewports da suíte.
 *
 * Prova a ligação que o teste de unidade não alcança: o build copiou a versão do package.json da
 * RAIZ (a mesma do `versionName` do Android) e a Home a mostra — discreta, inteira na tela, dentro
 * das áreas seguras, sem cobrir nada e sem receber toque. Medido com a Home parada no topo e
 * rolada até o fim, com e sem o painel "Jogar com amigos" aberto (é ele que faz a Home rolar nas
 * alturas baixas).
 */
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VERSAO = (JSON.parse(readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8")) as { version: string }).version;

async function abrirHome(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem("king:tutorial", JSON.stringify({ iniciado: true, concluido: true, passo: 0 })); } catch { /* sem storage */ }
  });
  await page.goto("/");
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.getAnimations({ subtree: true } as GetAnimationsOptions).forEach((a) => a.finish());
  });
}

/** Caixas de tudo o que se vê na Home (folhas com texto, botões, campos), menos a própria versão. */
const colisoes = (page: Page) => page.evaluate(() => {
  const v = document.querySelector(".hm-versao")!.getBoundingClientRect();
  const achados: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(".home *")) {
    if (el.closest(".hm-versao")) continue;
    const folha = el.children.length === 0 || /^(BUTTON|INPUT|A|LABEL)$/.test(el.tagName);
    if (!folha) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden") continue;
    const sobrepoe = r.left < v.right && r.right > v.left && r.top < v.bottom && r.bottom > v.top;
    if (sobrepoe) achados.push(`${el.tagName}.${el.className} "${(el.textContent ?? "").trim().slice(0, 24)}"`);
  }
  return achados;
});

const rolarAteOFim = (page: Page) => page.evaluate(() => {
  const h = document.querySelector(".home")!;
  h.scrollTop = h.scrollHeight;
});

test("a Home mostra a versão do projeto, discreta, inteira e sem cobrir nada", async ({ page }) => {
  await abrirHome(page);
  const versao = page.locator(".hm-versao");
  await expect(versao).toHaveText(`v${VERSAO}`);

  const vp = page.viewportSize()!;
  const caixa = (await versao.boundingBox())!;
  expect(caixa.x, "cortada à esquerda").toBeGreaterThanOrEqual(0);
  expect(caixa.y, "cortada no alto").toBeGreaterThanOrEqual(0);
  expect(caixa.x + caixa.width, "cortada à direita").toBeLessThanOrEqual(vp.width);
  expect(caixa.y + caixa.height, "cortada embaixo").toBeLessThanOrEqual(vp.height);
  // discreta: letra pequena, não disputa com o rodapé
  const estilo = await versao.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fonte: parseFloat(s.fontSize), toque: s.pointerEvents, z: Number(s.zIndex) };
  });
  expect(estilo.fonte).toBeLessThanOrEqual(12);
  expect(estilo.fonte).toBeGreaterThanOrEqual(8);
  expect(estilo.toque, "a versão não pode roubar toque").toBe("none");
  expect(estilo.z, "abaixo dos painéis (.ov = 50)").toBeLessThan(50);

  expect(await colisoes(page), "no topo").toEqual([]);
  await rolarAteOFim(page);
  expect(await colisoes(page), "rolada até o fim").toEqual([]);

  // com o painel de amigos aberto (a Home cresce e rola nas alturas baixas)
  await page.evaluate(() => { document.querySelector(".home")!.scrollTop = 0; });
  await page.getByRole("button", { name: "Jogar com amigos" }).click();
  await expect(page.locator(".hm-online")).toBeVisible();
  expect(await colisoes(page), "painel aberto, no topo").toEqual([]);
  await rolarAteOFim(page);
  expect(await colisoes(page), "painel aberto, rolada até o fim").toEqual([]);
});

test("com o recorte do aparelho (notch/barra), a versão fica dentro da área segura", async ({ page }) => {
  await abrirHome(page);
  // O Chromium não tem notch: as variáveis de área segura do tema são forçadas no próprio teste.
  await page.addStyleTag({ content: ":root{--sr:44px!important;--sb:21px!important;}" });
  const vp = page.viewportSize()!;
  const caixa = (await page.locator(".hm-versao").boundingBox())!;
  expect(vp.width - (caixa.x + caixa.width), "dentro da área segura à direita").toBeGreaterThanOrEqual(44);
  expect(vp.height - (caixa.y + caixa.height), "dentro da área segura embaixo").toBeGreaterThanOrEqual(21);
  expect(await colisoes(page)).toEqual([]);
});
