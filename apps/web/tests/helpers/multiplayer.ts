/**
 * Levar o teste até as telas de MULTIPLAYER — Lobby e Mesa com gente do outro lado.
 *
 * Existe porque metade dos defeitos que um iPhone real encontrou vivia exatamente aqui: o
 * "ESTOU PRONTO" cortado no Lobby e o botão social espremido na Mesa. Nenhuma das duas telas era
 * alcançável pela suíte — e o que não é alcançável não é protegido.
 *
 * O build de e2e (`--mode e2e`) aponta o cliente para o Colyseus que o Playwright sobe junto.
 */
import { expect, type Browser, type Page } from "@playwright/test";

/** Prepara o armazenamento antes do primeiro load: sem áudio e sem tutorial no caminho. */
export async function prepararSessao(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }),
      );
      window.localStorage.setItem(
        "king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }),
      );
    } catch { /* headless sem storage: segue */ }
  });
}

async function abrirPainelDeAmigos(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Jogar com amigos" }).click();
  // Se o multiplayer estivesse indisponível, o painel traria o aviso em vez dos campos.
  await expect(
    page.locator(".hm-online input").first(),
    "o build de e2e precisa apontar para o servidor local (ver .env.e2e)",
  ).toBeVisible({ timeout: 15_000 });
}

/** Cria a sala e devolve o código de 4 dígitos. */
export async function criarSala(page: Page, apelido: string, avatar: string): Promise<string> {
  await prepararSessao(page);
  await abrirPainelDeAmigos(page);

  await page.locator(".hm-online input").first().fill(apelido);
  await page.getByRole("button", { name: avatar, exact: true }).click();
  await page.getByRole("button", { name: "Criar uma sala" }).click();

  const codigo = page.locator(".sl-cod");
  await expect(codigo).toBeVisible({ timeout: 20_000 });
  const texto = (await codigo.textContent()) ?? "";
  const so4 = /(\d{4})/.exec(texto)?.[1];
  if (!so4) throw new Error(`código de sala não encontrado em "${texto}"`);
  return so4;
}

/** Entra numa sala existente. */
export async function entrarNaSala(page: Page, codigo: string, apelido: string, avatar: string): Promise<void> {
  await prepararSessao(page);
  await abrirPainelDeAmigos(page);

  const campos = page.locator(".hm-online input");
  await campos.first().fill(apelido);
  await page.getByRole("button", { name: avatar, exact: true }).click();
  await campos.last().fill(codigo);
  await page.getByRole("button", { name: "Entrar na sala" }).click();

  await expect(page.locator(".sl-lugares")).toBeVisible({ timeout: 20_000 });
}

/**
 * Duas pessoas e dois bots, com a partida em curso.
 *
 * Devolve as duas páginas — os defeitos de layout aparecem em QUEM OLHA, então às vezes é a tela
 * de quem entrou (e não a de quem criou) que precisa ser medida.
 */
export async function mesaEmPartida(
  browser: Browser, viewport: { width: number; height: number },
): Promise<{ anfitriao: Page; convidado: Page; fechar: () => Promise<void> }> {
  const ctxA = await browser.newContext({ viewport });
  const ctxB = await browser.newContext({ viewport });
  const anfitriao = await ctxA.newPage();
  const convidado = await ctxB.newPage();

  const codigo = await criarSala(anfitriao, "Tito", "Sapo");
  await entrarNaSala(convidado, codigo, "Raiza", "Panda");

  // O anfitrião completa a mesa com dois bots.
  await expect(anfitriao.locator(".sl-bot.add")).toHaveCount(2, { timeout: 20_000 });
  await anfitriao.locator(".sl-bot.add").first().click();
  await expect(anfitriao.locator(".sl-bot.add")).toHaveCount(1, { timeout: 20_000 });
  await anfitriao.locator(".sl-bot.add").first().click();
  await expect(anfitriao.locator(".sl-lugar.robo")).toHaveCount(2, { timeout: 20_000 });

  await anfitriao.getByRole("button", { name: /Estou pronto/ }).click();
  await convidado.getByRole("button", { name: /Estou pronto/ }).click();

  await expect(anfitriao.locator(".mesa")).toBeVisible({ timeout: 30_000 });
  await expect(convidado.locator(".mesa")).toBeVisible({ timeout: 30_000 });

  return {
    anfitriao,
    convidado,
    fechar: async () => { await ctxA.close(); await ctxB.close(); },
  };
}
