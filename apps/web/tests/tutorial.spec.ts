/**
 * APRENDA KING no navegador real, em cada viewport do projeto.
 *
 * O que os testes de unidade não conseguem provar e este arquivo prova:
 *   • o tutorial se apresenta sozinho na primeira visita — e nunca mais depois;
 *   • dá para CONCLUIR do começo ao fim sem ficar preso em passo nenhum;
 *   • a cromagem do tutorial não cobre HUD, card do jogador nem controles do topo;
 *   • pular funciona, e pular não é concluir;
 *   • com movimento reduzido e com áudio desligado, tudo continua funcionando.
 *
 * A varredura de colisões é a mesma disciplina de `layout.spec.ts`: componentes DIFERENTES não
 * podem se cruzar. Foi assim que se descobriu que a barra de progresso caía sobre o HUD do
 * contrato — justamente o HUD que o passo 3 manda o jogador olhar.
 */
import { test, expect, type Page } from "@playwright/test";
import { intersects, insideViewport, fmt, type Box, type Viewport } from "./helpers/geometry.js";
import { boxOf, SEL } from "./helpers/mesa.js";

const SUBPIXEL = 1;

const vpOf = (page: Page): Viewport => {
  const v = page.viewportSize();
  if (!v) throw new Error("viewport não definido");
  return v;
};

/** Zera o progresso e o áudio ANTES de a página carregar. Primeira visita de verdade. */
async function primeiraVisita(page: Page, extra?: () => void): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("king:tutorial");
      window.localStorage.setItem(
        "king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }),
      );
    } catch { /* headless sem storage: segue */ }
  });
  if (extra) await page.addInitScript(extra);
  await page.goto("/");
}

/**
 * Percorre o tutorial inteiro clicando o que estiver disponível: Continuar, um naipe de trunfo
 * ou uma carta legal. Devolve a trilha para o erro dizer ONDE travou.
 */
async function percorrer(page: Page, limite = 60): Promise<string[]> {
  const trilha: string[] = [];
  for (let i = 0; i < limite; i++) {
    if (!(await page.locator(".tut").count())) return trilha;
    const rotulo = (await page.locator(".tut-passo").textContent())?.trim() ?? "?";
    const ok = page.locator(".tut-ok");
    const trunfo = page.locator(".trumpbtn").first();
    const carta = page.locator(SEL.handCardLegal).first();

    if (await ok.count()) { trilha.push(`${rotulo}:continuar`); await ok.click(); }
    else if (await trunfo.count()) { trilha.push(`${rotulo}:trunfo`); await trunfo.click(); }
    else if (await carta.count()) { trilha.push(`${rotulo}:carta`); await carta.click(); }
    else {
      throw new Error(
        `TUTORIAL TRAVOU no passo ${rotulo} — nada clicável.\n   trilha: ${trilha.join(" → ")}`,
      );
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`tutorial não terminou em ${limite} passos: ${trilha.join(" → ")}`);
}

test("primeira visita: o tutorial se apresenta sozinho, na mesa de verdade", async ({ page }) => {
  await primeiraVisita(page);

  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".tut-passo")).toHaveText(/^1\/\d+$/);
  // a mesa é a real: leque, adversários e HUD do contrato
  await expect(page.locator(SEL.handCard).first()).toBeVisible();
  await expect(page.locator(SEL.hud)).toBeVisible();
  await expect(page.locator(".opp")).toHaveCount(3);
  // e o Rei diz uma linha
  await expect(page.locator(".rei-fala")).toHaveCount(1);
});

test("a cromagem do tutorial não cobre HUD, card do jogador nem controles do topo", async ({ page }, ti) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  const vp = vpOf(page);
  const proj = ti.project.name;
  const barra = await boxOf(page.locator(".tut-barra"), "tut-barra");
  const rei = await boxOf(page.locator(".rei"), "rei");
  const alvos: [string, Box][] = [
    ["hud", await boxOf(page.locator(SEL.hud), "hud")],
    ["youtag", await boxOf(page.locator(SEL.youtag), "youtag")],
    ["topbtn", await boxOf(page.locator(SEL.topbtn), "topbtn")],
  ];

  for (const [nome, alvo] of alvos) {
    for (const [meuNome, meu] of [["tut-barra", barra], ["rei", rei]] as [string, Box][]) {
      expect(
        intersects(meu, alvo, SUBPIXEL),
        `[${proj} · ${vp.width}×${vp.height}] COLISÃO: ${meuNome} × ${nome}\n` +
        `   ${meuNome}: ${fmt(meu)}\n   ${nome}: ${fmt(alvo)}`,
      ).toBe(false);
    }
  }

  for (const [nome, caixa] of [["tut-barra", barra], ["rei", rei]] as [string, Box][]) {
    expect(
      insideViewport(caixa, vp, SUBPIXEL),
      `[${proj} · ${vp.width}×${vp.height}] FORA DO VIEWPORT: ${nome} ${fmt(caixa)}`,
    ).toBe(true);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, "a página não pode rolar na horizontal").toBe(false);
});

test("dá para concluir do começo ao fim, sem ficar preso", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  const trilha = await percorrer(page);

  // saiu do tutorial e caiu na Home
  await expect(page.locator(".tut")).toHaveCount(0);
  await expect(page.locator(".home")).toBeVisible();
  // e agiu de verdade em pelo menos uma carta e no trunfo
  expect(trilha.filter((t) => t.endsWith(":carta")).length).toBeGreaterThanOrEqual(3);
  expect(trilha.some((t) => t.endsWith(":trunfo"))).toBe(true);

  const salvo = await page.evaluate(() => window.localStorage.getItem("king:tutorial"));
  expect(salvo && JSON.parse(salvo).concluido).toBe(true);
});

test("concluído, não abre mais sozinho — e vira 'Rever'", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });
  await percorrer(page);

  await page.reload();
  await expect(page.locator(".home")).toBeVisible();
  await expect(page.locator(".tut")).toHaveCount(0);
  await expect(page.locator(".hm-tutorial")).toHaveText(/rever/i);

  // e continua acessível para quem quiser
  await page.locator(".hm-tutorial").click();
  await expect(page.locator(".tut")).toBeVisible();
  await expect(page.locator(".tut-passo")).toHaveText(/^1\//);
});

test("pular pede confirmação, sai — e pular NÃO é concluir", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  await page.locator(".tut-ok").click();          // avança um passo, para haver progresso
  await page.locator(".tut-pular").click();
  await expect(page.locator(".tut-confirma")).toBeVisible();

  // desistir de sair mantém o tutorial
  await page.locator(".tut-confirma .btn.ghost").click();
  await expect(page.locator(".tut-confirma")).toHaveCount(0);
  await expect(page.locator(".tut")).toBeVisible();

  await page.locator(".tut-pular").click();
  await page.locator(".tut-confirma .btn.violet").click();
  await expect(page.locator(".home")).toBeVisible();

  const salvo = await page.evaluate(() => window.localStorage.getItem("king:tutorial"));
  const p = JSON.parse(salvo!);
  expect(p.iniciado, "pulou, mas já tinha começado").toBe(true);
  expect(p.concluido, "pular não é concluir").toBe(false);
  // não se impõe de novo, mas guardou onde parou
  await page.reload();
  await expect(page.locator(".tut")).toHaveCount(0);
  await expect(page.locator(".hm-tutorial")).toHaveText(/aprenda/i);
});

test("com MOVIMENTO REDUZIDO, o tutorial continua completável", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });
  await percorrer(page);
  await expect(page.locator(".home")).toBeVisible();
});

test("com ÁUDIO E VIBRAÇÃO DESLIGADOS, nada depende do som", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(String(e)));

  await primeiraVisita(page); // primeiraVisita já grava música/efeitos/haptics em false
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  // a instrução do passo continua legível sem som nenhum
  await expect(page.locator(".rei-fala")).toHaveText(/\S/);
  await percorrer(page);
  await expect(page.locator(".home")).toBeVisible();
  expect(erros, `erros de página: ${erros.join(" | ")}`).toEqual([]);
});
