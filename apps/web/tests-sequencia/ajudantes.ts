/**
 * O que as provas online (tests-sequencia/*.spec.ts) têm em comum: o navegador redirecionado para o
 * Supabase falso, o lobby até a mesa, a partida jogada inteira pelos dois aparelhos e o Placar
 * levado à etapa completa. Ver `stack.ts` para o stack e `partidaOnline.spec.ts` para a prova.
 */
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import pg from "pg";
import { criarSala, entrarNaSala } from "../tests/helpers/multiplayer.js";
import type { StackDaSequencia } from "./stack.js";

export const HOST = "https://abcdefghijklmnopqrst.supabase.co";
export const CHAVE_DA_SESSAO = "sb-abcdefghijklmnopqrst-auth-token";

export const stack = (): StackDaSequencia => JSON.parse(process.env.KING_E2E_SEQUENCIA ?? "null");

export async function banco(): Promise<pg.Client> {
  const s = stack();
  const c = new pg.Client({ host: "127.0.0.1", port: s.pgPorta, database: s.banco, user: "postgres", password: s.senhaAdmin });
  await c.connect();
  return c;
}

/**
 * Um navegador por pessoa. Toda chamada ao Supabase fictício do build vai para o Supabase falso
 * local. `respostas` anota "MÉTODO caminho → status" de cada uma, para a prova conferir.
 */
export async function contexto(browser: Browser, respostas: string[] = []): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 852, height: 393 }, deviceScaleFactor: 1 });
  const origem = stack().supabase;
  await ctx.route(`${HOST}/**`, async (route) => {
    const u = new URL(route.request().url());
    const resposta = await route.fetch({ url: `${origem}${u.pathname}${u.search}` });
    respostas.push(`${route.request().method()} ${u.pathname}${u.search} → ${resposta.status()}`);
    await route.fulfill({ response: resposta });
  });
  return ctx;
}

export const idDaSessao = async (page: Page) =>
  page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? "null") as { user?: { id?: string } } | null)?.user?.id ?? null, CHAVE_DA_SESSAO);

/** Do lobby até a mesa: o anfitrião completa com dois bots e os dois marcam pronto. */
export async function comecarPartida(a: Page, b: Page, apelidos: [string, string]): Promise<void> {
  const codigo = await criarSala(a, apelidos[0], "Sapo");
  await entrarNaSala(b, codigo, apelidos[1], "Panda");
  await expect(a.locator(".sl-bot.add")).toHaveCount(2, { timeout: 20_000 });
  await a.locator(".sl-bot.add").first().click();
  await expect(a.locator(".sl-bot.add")).toHaveCount(1, { timeout: 20_000 });
  await a.locator(".sl-bot.add").first().click();
  await expect(a.locator(".sl-lugar.robo")).toHaveCount(2, { timeout: 20_000 });
  await a.getByRole("button", { name: /Estou pronto/ }).click();
  await b.getByRole("button", { name: /Estou pronto/ }).click();
  await expect(a.locator(".mesa")).toBeVisible({ timeout: 30_000 });
  await expect(b.locator(".mesa")).toBeVisible({ timeout: 30_000 });
}

/**
 * Joga a partida INTEIRA pelos dois aparelhos: carta legal na vez de cada um, trunfo quando é a
 * escolha dele, "Estou pronto" entre as mãos. `entreMaos` é chamado depois de cada pronto.
 */
export async function jogarAteOFim(jogadores: { nome: string; page: Page }[], entreMaos?: (nome: string, mao: number) => Promise<void>) {
  const maos = new Map(jogadores.map((j) => [j.nome, 0]));
  const prazo = Date.now() + 35 * 60_000;
  while (Date.now() < prazo) {
    let emJogo = 0;
    for (const { nome, page } of jogadores) {
      if (await page.locator(".fim").count()) continue;
      emJogo++;
      const anuncio = page.locator(".um");
      if (await anuncio.count()) await anuncio.click({ timeout: 1_000 }).catch(() => {});
      const pronto = page.locator(".pl-toggle:not(.on)");
      if (await pronto.count()) {
        await pronto.click({ timeout: 1_000 }).catch(() => {});
        const n = (maos.get(nome) ?? 0) + 1;
        maos.set(nome, n);
        if (entreMaos) await entreMaos(nome, n);
        continue;
      }
      const trunfo = page.locator(".trumpbtn").first();
      if (await trunfo.count()) { await trunfo.click({ timeout: 1_000 }).catch(() => {}); continue; }
      const legal = page.locator(".hand .card.legal").first();
      if (await legal.count()) await legal.click({ timeout: 1_000 }).catch(() => {});
    }
    if (emJogo === 0) return;
    await jogadores[0].page.waitForTimeout(120);
  }
  throw new Error("a partida não terminou em 35 minutos");
}

/** Leva o Placar Final até a etapa `completo` (onde mora o bloco de XP). */
export async function placarCompleto(page: Page): Promise<void> {
  await expect(page.locator(".fim")).toBeVisible({ timeout: 60_000 });
  await page.locator(".fim").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await expect(page.locator(".fimacoes")).toBeVisible({ timeout: 30_000 });
}
