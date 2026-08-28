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
  // O SELETOR MUDOU DE LUGAR: ele não mora mais dentro do painel de multiplayer. Nada nasce
  // escolhido, e ele aparece quando uma ação precisa de identidade — aqui, "Jogar agora".
  await page.locator(".home .btn.gold").click();
  await expect(page.locator(".hm-avdialogo")).toBeVisible({ timeout: 15_000 });
}

test("são oito, na ordem oficial, com Macaco e Unicórnio", async ({ page }) => {
  await abrirSeletor(page);

  const opcoes = page.locator(".hm-avdialogo .hm-av");
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

/**
 * ESCOLHER É UM TOQUE, e o toque leva a ação junto.
 *
 * O seletor deixou de ser uma fileira parada na tela com um bicho já marcado: ele é a primeira
 * metade de uma ação que a pessoa já pediu. Escolher fecha o diálogo e a partida começa — não
 * existe estado intermediário de "escolhido mas parado", e é por isso que este teste não procura
 * mais um `aria-pressed` que sobrevive ao clique.
 */
test("Macaco, Unicórnio e Sapo são escolhíveis, e a escolha inicia a partida", async ({ page }) => {
  for (const nome of ["Macaco", "Unicórnio", "Sapo"]) {
    await abrirSeletor(page);
    const b = page.locator(`.hm-avdialogo .hm-av[aria-label="${nome}"]`);
    await expect(b, `${nome} não está no seletor`).toBeVisible();
    await b.click();
    await expect(page.locator(".hm-avdialogo")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(".mesa"), "escolher não levou à partida").toBeVisible({ timeout: 20_000 });
  }
});

/**
 * E O AVATAR ESCOLHIDO É O DO JOGADOR NA MESA — inclusive jogando só contra bots.
 *
 * Antes, o solo dava sempre o Leão a quem jogava: o avatar escolhido só existia no multiplayer, e
 * a mesma pessoa era uma no solo e outra na sala.
 */
test("o avatar escolhido é o do jogador na partida contra bots", async ({ page }) => {
  await abrirSeletor(page);
  await page.locator('.hm-avdialogo .hm-av[aria-label="Unicórnio"]').click();
  await expect(page.locator(".mesa")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".youtag .av"), "o solo ignorou a escolha")
    .toHaveAttribute("aria-label", "Unicórnio");
});

test("as oito cabem na tela, alcançáveis pelo dedo", async ({ page }, ti) => {
  await abrirSeletor(page);
  const vp = page.viewportSize()!;
  const opcoes = page.locator(".hm-avdialogo .hm-av");

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

/**
 * O QUE FICOU GUARDADO EM APARELHOS ANTIGOS NÃO PODE VOLTAR A DECIDIR NADA.
 *
 * Este teste medía a MIGRAÇÃO do avatar guardado: quem tinha "capivara" (aposentada) abria o
 * seletor com o unicórnio já marcado. A regra de produto mudou — nada nasce escolhido, e o jogo
 * não lê mais `king:avatar`. A chave continua no `localStorage` de quem jogou antes, e o que
 * importa agora é o oposto do que se media: que ela seja IGNORADA.
 */
test("avatar guardado por versões antigas é ignorado, não pré-seleciona nada", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
      // Quem escolheu a capivara antes da troca, e quem escolheu o sapo antes desta rodada.
      window.localStorage.setItem("king:avatar", "capivara");
    } catch { /* headless sem storage: segue */ }
  });
  await page.goto("/");
  await page.locator(".home .btn.gold").click();
  await expect(page.locator(".hm-avdialogo")).toBeVisible({ timeout: 15_000 });

  // NENHUM dos oito aparece marcado — nem o migrado, nem o padrão.
  const marcados = await page.locator('.hm-avdialogo .hm-av[aria-checked="true"]').count();
  expect(marcados, "o valor guardado voltou a pré-selecionar um avatar").toBe(0);
});
