/**
 * ÚLTIMA VAZA — a consulta que faltava.
 *
 * Numa partida real a pergunta "quem jogou a Dama?" apareceu mais de uma vez e não tinha resposta:
 * quatro cartas caem, alguém leva, e a mesa recolhe.
 *
 * O que estes testes cobram é o que a informação PODE e NÃO PODE ser:
 *   • pública, e só pública: as quatro cartas desta vaza foram jogadas abertas;
 *   • completa: ordem, quem jogou cada uma, quem venceu, e o que a vaza custou;
 *   • indisponível antes da primeira vaza fechar, em vez de abrir uma tela vazia;
 *   • independente de turno: consultar não é jogar.
 */
import { test, expect, type Page } from "@playwright/test";
import { insideViewport, type Box } from "./helpers/geometry.js";
import { boxOf, SEL, openMesaStress } from "./helpers/mesa.js";

const SUBPIXEL = 1;

/** Fecha a primeira vaza jogando pela tela, como uma pessoa faria. */
async function fecharUmaVaza(page: Page): Promise<void> {
  const c = page.locator(SEL.handCardLegal).first();
  await c.click();
  if (await page.locator(SEL.handCardSelected).count()) await c.click();
  await page.locator(".topvaza:not([disabled])").waitFor({ timeout: 20_000 });
}

test("antes da primeira vaza não há o que consultar, e o botão diz isso", async ({ page }) => {
  await openMesaStress(page);
  const botao = page.locator(".topvaza");
  await expect(botao).toBeVisible();
  await expect(botao).toBeDisabled();
  await expect(page.locator(".uv")).toHaveCount(0);
});

test("depois da vaza fechar, mostra as quatro cartas, a ordem, quem jogou e quem venceu", async ({ page }) => {
  await openMesaStress(page);
  await fecharUmaVaza(page);

  await page.locator(".topvaza").click();
  await expect(page.locator(".uv")).toBeVisible();

  // QUATRO cartas, uma de cada jogador, na ordem em que foram jogadas.
  await expect(page.locator(".uv-carta")).toHaveCount(4);
  const ordens = await page.locator(".uv-ordem").allTextContents();
  expect(ordens.map((t) => t.trim())).toEqual(["1", "2", "3", "4"]);

  // Cada carta tem dono, e os quatro são diferentes.
  const nomes = (await page.locator(".uv-quem").allTextContents())
    .map((t) => t.replace(/venceu/i, "").trim());
  expect(nomes).toHaveLength(4);
  expect(new Set(nomes).size).toBe(4);

  // UM vencedor, marcado por mais de um sinal (a palavra e a moldura da carta).
  await expect(page.locator(".uv-carta.venceu")).toHaveCount(1);
  await expect(page.locator(".uv-carta.venceu .uv-quem")).toContainText(/venceu/i);
  await expect(page.locator(".uv-fim b")).toContainText("ganhou a vaza");
});

test("a carta mostra o valor: o selo da ordem não cobre o número", async ({ page }) => {
  await openMesaStress(page);
  await fecharUmaVaza(page);
  await page.locator(".topvaza").click();

  // O número da carta é a informação mais básica que existe. Na primeira versão o selo da ordem
  // era absoluto no canto superior esquerdo, exatamente onde a carta desenha o próprio valor.
  const valores = await page.locator(".uv-carta .card .idx b").allTextContents();
  expect(valores).toHaveLength(4);
  for (const v of valores) expect(v.trim()).toMatch(/^(?:[2-9]|10|[JQKA])$/);

  // E o selo da ordem não encosta na carta: ele mora ACIMA dela, no fluxo.
  //
  // A checagem é de CAIXA, e não de `elementFromPoint`. O `.pip` da carta é um glifo centrado com
  // `inset:0` e fundo transparente, então ele sempre "responde" no ponto central do valor sem
  // esconder nada — perguntar por elemento no ponto daria falso negativo aqui.
  const badge = await boxOf(page.locator(".uv-ordem").first(), "uv-ordem");
  const carta = await boxOf(page.locator(".uv-carta .card").first(), "carta");
  const cruza = badge.x < carta.x + carta.width && carta.x < badge.x + badge.width
    && badge.y < carta.y + carta.height && carta.y < badge.y + badge.height;
  expect(cruza, "o selo da ordem está por cima da carta").toBe(false);
});

test("mostra o que a vaza custou, e só quando custou algo", async ({ page }) => {
  await openMesaStress(page);
  await fecharUmaVaza(page);
  await page.locator(".topvaza").click();

  // A mão 1 é "não pegar vazas": TODA vaza custa −20 a quem leva.
  const pontos = page.locator(".uv-pontos");
  await expect(pontos).toHaveCount(1);
  await expect(pontos).toContainText("−20");
  await expect(pontos).toContainText("vaza");
});

test("nenhuma carta que não seja desta vaza aparece no painel", async ({ page }) => {
  await openMesaStress(page);
  await fecharUmaVaza(page);
  await page.locator(".topvaza").click();

  // Sigilo: o painel fala de quatro cartas jogadas ABERTAS. Mão de ninguém entra aqui, e o teto
  // é exatamente quatro — se um dia alguém plugar o histórico inteiro, este teste cai.
  const cartas = await page.locator(".uv .card").count();
  expect(cartas).toBe(4);
});

test("consultar não joga: fecha e a partida continua onde estava", async ({ page }) => {
  await openMesaStress(page);
  await fecharUmaVaza(page);

  const antes = {
    hud: await page.locator(SEL.hud).innerText(),
    cartas: await page.locator(SEL.handCard).count(),
  };

  await page.locator(".topvaza").click();
  await expect(page.locator(".uv")).toBeVisible();
  await page.locator(".uv-x").click();
  await expect(page.locator(".uv")).toHaveCount(0);

  expect(await page.locator(SEL.hud).innerText()).toBe(antes.hud);
  expect(await page.locator(SEL.handCard).count()).toBe(antes.cartas);
});

test("fecha por botão, por Esc e pelo scrim", async ({ page }) => {
  await openMesaStress(page);
  await fecharUmaVaza(page);

  for (const fechar of [
    async () => page.locator(".uv-x").click(),
    async () => page.keyboard.press("Escape"),
    async () => page.locator(".uv-scrim").click({ position: { x: 4, y: 4 } }),
  ]) {
    await page.locator(".topvaza").click();
    await expect(page.locator(".uv")).toBeVisible();
    await fechar();
    await expect(page.locator(".uv")).toHaveCount(0);
  }
});

test("o painel cabe na tela e o botão do topo tem alvo de dedo", async ({ page }, ti) => {
  await openMesaStress(page);
  const vp = page.viewportSize()!;
  await fecharUmaVaza(page);

  const botao = await boxOf(page.locator(".topvaza"), "topvaza");
  expect(Math.round(botao.height), "alvo de toque do botão").toBeGreaterThanOrEqual(34 - SUBPIXEL);
  expect(insideViewport(botao as Box, vp, SUBPIXEL), "o botão saiu da tela").toBe(true);

  await page.locator(".topvaza").click();
  const painel = await boxOf(page.locator(".uv"), "uv");
  expect(
    insideViewport(painel as Box, vp, SUBPIXEL),
    `[${ti.project.name} · ${vp.width}×${vp.height}] o painel saiu da tela`,
  ).toBe(true);

  const rolagem = await page.evaluate(() => ({
    v: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    h: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  expect(rolagem, "a Mesa não pode rolar por causa do painel").toEqual({ v: false, h: false });
});
