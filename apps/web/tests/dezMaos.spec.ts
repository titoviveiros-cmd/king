/**
 * AS 10 MÃOS — a consulta rápida, no navegador de verdade.
 *
 * A tela existe porque faltava resposta para uma pergunta que aparece no meio da partida: "qual
 * é a próxima mão mesmo?". A porta é o card do contrato, que a pessoa já olha o tempo todo.
 *
 * O que estes testes cobram, e por quê:
 *   • as dez mãos aparecem, na ordem, com a mão 5 e a mão 6 no lugar certo (era o erro do
 *     tutorial antigo, e não pode voltar por outra porta);
 *   • seis negativas e quatro positivas, contadas, não presumidas;
 *   • a mão em curso é destacada por mais de um sinal — cor sozinha não informa a todo mundo;
 *   • abrir e fechar não mexe na partida: mesma mão, mesma vaza, mesmas cartas;
 *   • com o resumo aberto, um toque no meio da tela NÃO joga carta nenhuma.
 */
import { test, expect, type Page } from "@playwright/test";
import { insideViewport, fmt, type Box } from "./helpers/geometry.js";
import { boxOf, SEL, openMesaStress } from "./helpers/mesa.js";

const SUBPIXEL = 1;

async function abrirResumo(page: Page): Promise<void> {
  await page.locator(SEL.hud).click();
  await expect(page.locator(".dm")).toBeVisible();
}

test("o card do contrato abre o resumo, e ele traz as dez mãos na ordem", async ({ page }) => {
  await openMesaStress(page);
  await abrirResumo(page);

  const itens = page.locator(".dm-item");
  await expect(itens).toHaveCount(10);

  // A ORDEM É A DO JOGO. Conferida linha a linha, com os nomes que a mesa usa em voz alta.
  const esperado = [
    "Não pegar Vazas", "Não pegar Copas", "Não pegar Damas", "Não pegar Reis e Valetes",
    "Não pegar o Rei de Copas", "Não pegar as duas últimas",
    "Positiva", "Positiva", "Positiva", "Positiva",
  ];
  for (let i = 0; i < 10; i++) {
    await expect(itens.nth(i).locator(".dm-txt b"), `linha ${i + 1}`).toHaveText(esperado[i]);
  }

  // seis negativas, quatro positivas — contadas
  await expect(page.locator(".dm-item.neg")).toHaveCount(6);
  await expect(page.locator(".dm-item.pos")).toHaveCount(4);

  // a mão 5 é o Rei de Copas e vem ANTES da mão 6
  await expect(itens.nth(4)).toContainText("Rei de Copas");
  await expect(itens.nth(4)).toContainText("−160");
  await expect(itens.nth(5)).toContainText("duas últimas");
  await expect(itens.nth(5)).toContainText("−90");

  // e a regra da escolha do trunfo está escrita como rotação, não como "você escolhe"
  const nota = page.locator(".dm-nota");
  await expect(nota).toContainText("4 mãos positivas");
  await expect(nota).toContainText("um jogador diferente");
  await expect(nota).toContainText("Sem Trunfo");
});

test("a mão em curso é destacada por mais de um sinal", async ({ page }) => {
  await openMesaStress(page);
  await abrirResumo(page);

  const atual = page.locator(".dm-item.atual");
  await expect(atual).toHaveCount(1);
  // 1) a palavra, que também é o que um leitor de tela lê
  await expect(atual).toContainText("ATUAL");
  // 2) e a moldura, que não depende de distinguir cor nenhuma
  const borda = await atual.evaluate((e) => getComputedStyle(e).borderTopColor);
  const outra = await page.locator(".dm-item:not(.atual)").first()
    .evaluate((e) => getComputedStyle(e).borderTopColor);
  expect(borda, "a mão atual precisa de moldura própria").not.toBe(outra);

  // e é a mão que o card do contrato está anunciando
  const mao = (await page.locator(`${SEL.hud} .ph`).textContent())?.match(/Mão (\d+)/)?.[1];
  await expect(atual.locator(".dm-n")).toHaveText(mao!);
});

test("abrir e fechar o resumo não mexe na partida", async ({ page }) => {
  await openMesaStress(page);

  const antes = {
    hud: await page.locator(SEL.hud).innerText(),
    cartas: await page.locator(SEL.handCard).count(),
    vaza: await page.locator(".trick .slot").count(),
  };

  await abrirResumo(page);
  await page.locator(".dm-x").click();
  await expect(page.locator(".dm")).toHaveCount(0);

  expect(await page.locator(SEL.hud).innerText()).toBe(antes.hud);
  expect(await page.locator(SEL.handCard).count()).toBe(antes.cartas);
  expect(await page.locator(".trick .slot").count()).toBe(antes.vaza);

  // e o jogo continua jogável logo depois
  await expect(page.locator(SEL.handCardLegal).first()).toBeVisible();
});

test("com o resumo aberto, nenhum toque atravessa até o leque", async ({ page }) => {
  await openMesaStress(page);
  const cartas = await page.locator(SEL.handCard).count();

  const carta = await boxOf(page.locator(SEL.handCardLegal).first(), "carta legal");
  await abrirResumo(page);

  // toque exatamente onde havia uma carta jogável
  await page.mouse.click(carta.x + carta.width / 2, carta.y + carta.height / 2);
  await page.waitForTimeout(200);

  // nada foi jogado: ou o resumo continua aberto, ou ele fechou pelo scrim — nunca uma jogada
  expect(await page.locator(SEL.handCard).count(), "uma carta foi jogada por baixo do resumo")
    .toBe(cartas);
});

test("fecha por scrim, por botão e por Esc", async ({ page }) => {
  await openMesaStress(page);

  await abrirResumo(page);
  await page.locator(".dm-x").click();
  await expect(page.locator(".dm")).toHaveCount(0);

  await abrirResumo(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".dm")).toHaveCount(0);

  await abrirResumo(page);
  await page.locator(".dm-scrim").click({ position: { x: 4, y: 4 } });
  await expect(page.locator(".dm")).toHaveCount(0);
});

test("o resumo cabe na tela, e o fechar é alcançável pelo dedo", async ({ page }, ti) => {
  await openMesaStress(page);
  const vp = page.viewportSize()!;
  await abrirResumo(page);

  const painel = await boxOf(page.locator(".dm"), "dm");
  expect(
    insideViewport(painel as Box, vp, SUBPIXEL),
    `[${ti.project.name} · ${vp.width}×${vp.height}] o resumo saiu da tela ${fmt(painel)}`,
  ).toBe(true);

  const x = await boxOf(page.locator(".dm-x"), "dm-x");
  expect(Math.round(Math.min(x.width, x.height)), "alvo de toque do fechar").toBeGreaterThanOrEqual(44 - SUBPIXEL);
  expect(insideViewport(x as Box, vp, SUBPIXEL), "o fechar saiu da tela").toBe(true);

  // A Mesa NÃO ganha rolagem por causa do resumo. Se precisar rolar, rola por dentro dele.
  const rolagem = await page.evaluate(() => ({
    v: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    h: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  expect(rolagem, "a página não pode rolar com o resumo aberto").toEqual({ v: false, h: false });
});
