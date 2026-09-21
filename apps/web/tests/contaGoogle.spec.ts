/**
 * O VÍNCULO DE CONTA NO NAVEGADOR REAL — e, principalmente, a sua AUSÊNCIA.
 *
 * O que os testes de unidade provam é a decisão (`auth/conta.test.ts`) e o que a Home escreve
 * (`ui/homeConta.test.tsx`). O que só o navegador prova é o resto:
 *
 *   • numa publicação SEM vínculo configurado — que é a Production de hoje — a Home não ganha
 *     botão nenhum. Um convite para conectar o Google antes de o Google existir seria um caminho
 *     para o erro, publicado;
 *   • uma URL de retorno de OAuth aberta nessa publicação não quebra nada: a Home continua de pé,
 *     o jogo continua jogável e nada de credencial aparece na página.
 *
 * O build de e2e não tem `VITE_SUPABASE_*` nem `VITE_KING_GOOGLE_LINK`, e é exatamente por isso
 * que ele serve para medir o estado desligado. O fluxo ligado, com Google de verdade, é da fase
 * seguinte — aqui não se inventa provedor.
 */
import { test, expect, type Page } from "@playwright/test";
import { iniciarPartidaLocal } from "./helpers/mesa.js";

const RETORNO = "/?conta=google&code=codigo-de-mentira&sb_flow_id=flow-de-mentira";

async function abrir(page: Page, caminho: string): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }),
      );
      window.localStorage.setItem("king:tutorial", JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  await page.goto(caminho);
  await expect(page.locator(".home")).toBeVisible({ timeout: 20_000 });
}

test("sem vínculo configurado, a Home não oferece conta nenhuma", async ({ page }) => {
  await abrir(page, "/");

  await expect(page.locator(".hm-conta")).toHaveCount(0);
  await expect(page.locator(".hm-conta-btn")).toHaveCount(0);
  expect(await page.locator(".home").innerText()).not.toMatch(/google/i);

  // e o que a Home sempre teve continua lá
  await expect(page.locator(".btn.gold").first()).toBeVisible();
  await expect(page.locator(".hm-tutorial")).toHaveCount(1);
});

test("uma URL de retorno de OAuth não derruba a Home nem impede jogar", async ({ page }) => {
  const erros: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  page.on("pageerror", (e) => erros.push(String(e)));

  await abrir(page, RETORNO);

  // a Home está de pé, sem seção de conta (publicação sem vínculo) e sem tela de erro
  await expect(page.locator(".hm-conta")).toHaveCount(0);
  await expect(page.locator(".btn.gold").first()).toBeVisible();

  // e o jogo continua jogável: conta é um extra, nunca um pedágio
  await iniciarPartidaLocal(page);
  await expect(page.locator(".mesa")).toBeVisible({ timeout: 20_000 });

  expect(erros, `console com erro: ${erros.join(" | ")}`).toHaveLength(0);
});

test("nada de credencial fica na página quando se chega por uma URL de retorno", async ({ page }) => {
  await abrir(page, RETORNO);

  // o `code` de mentira não é ecoado em lugar nenhum do documento
  const html = await page.content();
  expect(html).not.toContain("codigo-de-mentira");
  expect(html).not.toContain("flow-de-mentira");

  // e o armazenamento não ganhou transação nenhuma: sem provedor, não há vínculo para conduzir
  const chaves = await page.evaluate(() => Object.keys(window.localStorage));
  expect(chaves).not.toContain("king:vinculo");
  for (const chave of chaves) {
    const valor = await page.evaluate((k) => window.localStorage.getItem(k) ?? "", chave);
    expect(valor, `${chave} guardou algo parecido com credencial`).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
  }
});
