/**
 * O MINITORNEIO de ponta a ponta, no app real: Home → formato → participantes → chave → mesas de
 * bots → confronto → a SUA partida (Mesa solo de verdade) → classificação → avanço ou eliminação,
 * e a retomada depois de recarregar a página.
 *
 * Encurtado pelos parâmetros de QA que já existem: `?seed=` fixa a semente (o torneio inteiro se
 * repete) e `?mao=10` faz a SUA partida começar na última mão. As mesas de bots jogam as 10 mãos
 * sempre. O torneio fica marcado como "modo de teste" — e o teste confere o selo.
 *
 * Roda em poucos viewports (paisagem de celular + desktop): o fluxo é longo e a geometria das
 * telas é a mesma família de caixas em todos eles. A matriz inteira fica para as specs de layout.
 */
import { test, expect, type Page } from "@playwright/test";
import { SEL } from "./helpers/mesa.js";

const VIEWPORTS_DO_FLUXO = new Set(["852x393", "844x390", "667x375", "1600x900"]);

test.beforeEach(async ({ page }, info) => {
  test.skip(!VIEWPORTS_DO_FLUXO.has(info.project.name), "fluxo longo: roda só nos viewports do torneio");
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial", JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
});

async function semRolagemLateral(page: Page, onde: string): Promise<void> {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s, `rolagem lateral em ${onde}`).toBeLessThanOrEqual(o.c + 1);
}

/** O botão precisa estar inteiro na tela (ou alcançável rolando o corpo da tela) e clicável. */
async function tocar(page: Page, nome: RegExp | string): Promise<void> {
  const b = page.getByRole("button", { name: nome }).first();
  await expect(b).toBeVisible({ timeout: 20_000 });
  await b.scrollIntoViewIfNeeded();
  await b.click();
}

/** Joga a partida do humano até a classificação da mesa aparecer (primeira carta legal sempre). */
async function jogarAteAClassificacao(page: Page): Promise<void> {
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 500 && !(await page.locator(".tn-tabela").count()); i++) {
    const anuncio = page.locator(".um");
    // O anúncio da mão 10 sai sozinho: entre o count() e o clique ele pode sumir, e um clique sem
    // prazo esperaria para sempre por um elemento que não volta.
    if (await anuncio.count()) { await anuncio.click({ timeout: 2000 }).catch(() => {}); continue; }
    const trunfo = page.locator(".trumpbtn").first();
    if (await trunfo.count()) { await trunfo.click({ timeout: 2000 }).catch(() => {}); continue; }
    const carta = page.locator(SEL.handCardLegal).first();
    if (await carta.count()) {
      // O leque SOBREPÕE as cartas e as legais sobem girando: o ponto de toque de uma carta pode
      // cair na vizinha, e o clique do Playwright espera para sempre. O evento vai direto à carta.
      await carta.dispatchEvent("click").catch(() => {});
      if (await page.locator(SEL.handCardSelected).count()) {
        await page.locator(SEL.handCardSelected).first().dispatchEvent("click").catch(() => {});
      }
      continue;
    }
    await page.waitForTimeout(200);
  }
  await expect(page.locator(".tn-tabela"), "a partida não voltou para a classificação do torneio").toBeVisible({ timeout: 20_000 });
  // O Placar Final do solo NÃO aparece no torneio ("Jogar novamente" refaria uma mesa decidida).
  await expect(page.locator(".fim")).toHaveCount(0);
}

test("minitorneio: seleção → partida → classificação → avanço/eliminação → retomada após reload", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/?seed=7&mao=10");

  // ── Home: três modalidades ──
  await expect(page.getByRole("button", { name: "▶ Jogar agora" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Minitorneio" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continuar torneio/ })).toHaveCount(0);
  await tocar(page, "Minitorneio");
  await page.locator('.hm-avdialogo .hm-av[aria-label="Sapo"]').click();

  // ── formato ──
  await expect(page.getByRole("heading", { name: "Escolha o seu torneio" })).toBeVisible();
  await semRolagemLateral(page, "escolha do formato");
  await tocar(page, /Minitorneio: 16 participantes/);
  await expect(page.locator(".tn-qa"), "torneio de QA precisa dizer que é teste").toBeVisible();

  // ── participantes ──
  await expect(page.locator(".tn-elenco li")).toHaveCount(16);
  await expect(page.locator(".tn-elenco .tn-eu")).toHaveCount(1);
  await semRolagemLateral(page, "apresentação");
  await tocar(page, "Sortear as mesas");

  // ── chave: 4 mesas iniciais, semifinais e final a definir ──
  await expect(page.getByRole("region", { name: /Chave do Minitorneio/ })).toBeVisible();
  await expect(page.locator(".tn-mesa:not(.tn-mesa-vaga)")).toHaveCount(4);
  await expect(page.locator(".tn-mesa-vaga")).toHaveCount(3);
  await expect(page.locator(".tn-meu-caminho")).toHaveCount(1);
  await semRolagemLateral(page, "chave");
  await tocar(page, "Jogar as outras mesas");

  // ── confronto (as outras 3 mesas foram jogadas em fatias, sem travar) ──
  await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".tn-adversarios li")).toHaveCount(4);
  await semRolagemLateral(page, "confronto");

  // ── reload NO MEIO da partida: ela recomeça do zero, sem resultado nenhum ──
  await tocar(page, "▶ Jogar");
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await tocar(page, /Continuar torneio/);
  await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("status").filter({ hasText: "recomeça do início" })).toBeVisible();

  // ── a partida inteira (a mão 10, pelo QA) ──
  await tocar(page, "▶ Jogar");
  await jogarAteAClassificacao(page);
  await expect(page.locator(".tn-tabela li")).toHaveCount(4);
  await expect(page.locator(".tn-tabela li.tn-passou")).toHaveCount(2);
  await expect(page.locator(".tn-tabela li.tn-eu")).toHaveCount(1);
  await semRolagemLateral(page, "classificação");
  await tocar(page, "Continuar");

  // ── avanço OU eliminação: o caminho depende da partida, as duas telas são verificadas ──
  const avancou = page.locator(".tn-avanco");
  const caiu = page.locator(".tn-eliminado");
  await expect(avancou.or(caiu)).toBeVisible({ timeout: 20_000 });
  await semRolagemLateral(page, "avanço/eliminação");

  if (await avancou.count()) {
    await expect(page.getByRole("list", { name: "O seu caminho" })).toBeVisible();
    await tocar(page, "Continuar");
    await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".tn-fase-rotulo")).toContainText(/Semifinal/);
    // ── retomada: o checkpoint guarda a fase nova e o resultado confirmado ──
    await page.reload();
    await tocar(page, /Continuar torneio/);
    await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tn-fase-rotulo")).toContainText(/Semifinal/);
    await tocar(page, "Ver a chave");
    await expect(page.locator(".tn-mesa:not(.tn-mesa-vaga)")).toHaveCount(6);
    // a mesa da primeira fase continua com UM resultado só (nada duplicado pelo reload)
    await expect(page.locator(".tn-meu-caminho")).toHaveCount(2);
  } else {
    await expect(page.getByRole("status")).toContainText(/Terminou em [34]º/);
    // retomada no estado de eliminado
    await page.reload();
    await tocar(page, /Continuar torneio/);
    await expect(page.locator(".tn-eliminado")).toBeVisible({ timeout: 20_000 });
    await tocar(page, "Ver quem será o campeão");
    await expect(page.locator(".tn-fim")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /Campeão:/ })).toBeVisible();
    await semRolagemLateral(page, "fim");
    // torneio encerrado não se oferece para continuar
    await tocar(page, "Home");
    await expect(page.getByRole("button", { name: /Continuar torneio/ })).toHaveCount(0);
  }
});

test("save corrompido: descartado com aviso, e a Home não oferece continuar", async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("king:torneio", JSON.stringify({ v: 1, formato: "mini16", semente: 1, avatar: "leao", qa: false, maoInicial: 1, resultados: { f0m0: { pontos: [999, 0, 0, 0], negativas: [0, 0, 0, 0], ilesas: [0, 0, 0, 0] } }, emPartida: null })); } catch { /* */ }
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Minitorneio" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continuar torneio/ })).toHaveCount(0);
});
