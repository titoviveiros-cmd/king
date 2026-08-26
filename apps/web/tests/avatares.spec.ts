/**
 * O SELETOR DE AVATARES no navegador de verdade.
 *
 * A coleção é fechada em oito, e a ordem é a do produto. O que só o navegador prova é que as oito
 * cabem na tela e são alcançáveis por um dedo — inclusive nos viewports mais apertados, onde uma
 * fileira de oito é justamente o que costuma vazar para fora.
 */
import { test, expect, type Page } from "@playwright/test";
import { insideViewport, fmt, type Box } from "./helpers/geometry.js";
import { boxOf } from "./helpers/mesa.js";

const SUBPIXEL = 1;

/** A coleção final, na ordem oficial. Espelha `AVATARES`. */
const COLECAO = [
  "Leão", "Coruja", "Raposa", "Macaco", "Panda", "Tucano", "Unicórnio", "Sapo",
];

async function abrirSeletor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Jogar com amigos" }).click();
  await expect(page.locator(".hm-avatares")).toBeVisible({ timeout: 15_000 });
}

test("são oito, na ordem oficial, com Macaco e Unicórnio", async ({ page }) => {
  await abrirSeletor(page);

  const opcoes = page.locator(".hm-avatares button");
  await expect(opcoes).toHaveCount(8);

  const rotulos = await opcoes.evaluateAll(
    (bs) => bs.map((b) => b.getAttribute("aria-label") ?? b.getAttribute("title") ?? b.textContent ?? ""),
  );
  for (let i = 0; i < 8; i++) {
    expect(rotulos[i], `posição ${i + 1}`).toContain(COLECAO[i]);
  }

  // A capivara era quem ficava à esquerda do sapo, com 🦫 por não ter emoji próprio.
  expect(rotulos.join(" | ")).not.toMatch(/Capivara/i);
});

test("Macaco, Unicórnio e Sapo são escolhíveis", async ({ page }) => {
  await abrirSeletor(page);

  for (const nome of ["Macaco", "Unicórnio", "Sapo"]) {
    const b = page.getByRole("button", { name: nome, exact: true });
    await expect(b, `${nome} não está no seletor`).toBeVisible();
    await b.click();
    // A escolha fica marcada: identidade sem retorno visual é escolha que a pessoa não confirma.
    await expect(b).toHaveAttribute("aria-pressed", "true");
  }
});

test("as oito cabem na tela, alcançáveis pelo dedo", async ({ page }, ti) => {
  await abrirSeletor(page);
  const vp = page.viewportSize()!;
  const opcoes = page.locator(".hm-avatares button");

  for (let i = 0; i < 8; i++) {
    const c = await boxOf(opcoes.nth(i), `avatar ${i + 1}`);
    expect(
      insideViewport(c as Box, vp, SUBPIXEL),
      `[${ti.project.name} · ${vp.width}×${vp.height}] ${COLECAO[i]} fora da tela ${fmt(c)}`,
    ).toBe(true);
    expect(Math.round(Math.min(c.width, c.height)), `${COLECAO[i]}: alvo de toque`)
      .toBeGreaterThanOrEqual(30);
  }

  // E a página não ganha rolagem horizontal por causa da fileira.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow, "o seletor criou rolagem horizontal").toBe(false);
});

test("um avatar aposentado guardado no aparelho não quebra a abertura", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
      // Quem escolheu a capivara antes da troca.
      window.localStorage.setItem("king:avatar", "capivara");
    } catch { /* headless sem storage: segue */ }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Jogar com amigos" }).click();
  await expect(page.locator(".hm-avatares")).toBeVisible({ timeout: 15_000 });

  // Cai no unicórnio, e não no leão padrão: a escolha antiga migra em vez de sumir.
  await expect(page.getByRole("button", { name: "Unicórnio", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
});
