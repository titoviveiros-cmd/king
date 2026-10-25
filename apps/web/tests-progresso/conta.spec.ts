/**
 * O PAINEL "CONTA" PELO CAMINHO REAL (Fase 9) — SDK do Supabase, sessão guardada, a função de
 * exclusão — contra o projeto FICTÍCIO desta suíte, com a rede interceptada. Nada sai para a internet.
 *
 * Prova, em cada viewport do projeto (inclusive 852×300):
 *   - sem conta neste navegador: o botão "Conta" nem aparece, e nada vai ao Supabase;
 *   - com conta: o botão abre o painel, que cabe na tela;
 *   - EXCLUIR: o botão só age com "EXCLUIR" digitado; o pedido leva o token da sessão e a
 *     confirmação; a sessão local só some DEPOIS da resposta positiva; e recomeçar volta à Home
 *     sem conta;
 *   - falha no servidor: a conta continua inteira (a sessão fica) e o aviso é neutro.
 */
import { expect, test, type Page } from "@playwright/test";

const REF = "abcdefghijklmnopqrst";
const HOST = `https://${REF}.supabase.co`;
const CHAVE_DA_SESSAO = `sb-${REF}-auth-token`;
const ID = "11111111-1111-4111-8111-111111111111";

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sessaoGuardada() {
  const agora = Math.floor(Date.now() / 1000);
  const jwt = [b64url({ alg: "HS256", typ: "JWT" }), b64url({ sub: ID, role: "authenticated", aud: "authenticated", exp: agora + 3600, is_anonymous: true }), "assinatura-ficticia"].join(".");
  return { access_token: jwt, refresh_token: "ficticio", token_type: "bearer", expires_in: 3600, expires_at: agora + 3600,
    user: { id: ID, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} } };
}

async function comSessao(page: Page) {
  const s = sessaoGuardada();
  // Só na PRIMEIRA carga: depois de excluir, o recomeço não pode ganhar a sessão de volta.
  await page.addInitScript(([k, v]) => {
    if (!sessionStorage.getItem("king-e2e-semeado")) { localStorage.setItem(k, v); sessionStorage.setItem("king-e2e-semeado", "1"); }
  }, [CHAVE_DA_SESSAO, JSON.stringify(s)] as const);
  return s;
}

interface Pedido { metodo: string; caminho: string; autorizacao: string | null; corpo: string | null }

async function supabaseFicticio(page: Page, exclusao: { status: number; corpo: unknown }) {
  const pedidos: Pedido[] = [];
  await page.route(`${HOST}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    pedidos.push({ metodo: req.method(), caminho: url.pathname, autorizacao: req.headers()["authorization"] ?? null, corpo: req.postData() });
    if (url.pathname === "/functions/v1/excluir-conta") {
      return route.fulfill({ status: exclusao.status, contentType: "application/json", body: JSON.stringify(exclusao.corpo),
        headers: { "access-control-allow-origin": "*" } });
    }
    if (url.pathname === "/rest/v1/meu_progresso") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ xp_total: 370, nivel: 3, xp_no_nivel: 120, xp_do_nivel: 200 }]) });
    }
    // logout?scope=local de uma conta já excluída: 404, que o SDK ignora e apaga a sessão local.
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return pedidos;
}

const botaoConta = (page: Page) => page.getByRole("button", { name: "Conta", exact: true });
const painel = (page: Page) => page.getByRole("dialog");
const sessaoNoNavegador = (page: Page) => page.evaluate((k) => localStorage.getItem(k), CHAVE_DA_SESSAO);

test("sem conta neste navegador, a Home não oferece o painel — e nada vai ao Supabase", async ({ page }) => {
  const pedidos = await supabaseFicticio(page, { status: 200, corpo: {} });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /jogar agora/i })).toBeVisible();
  await expect(botaoConta(page)).toHaveCount(0);
  expect(pedidos).toEqual([]);
});

test("excluir: só com EXCLUIR digitado; o aparelho só esquece a conta DEPOIS do OK do servidor", async ({ page }) => {
  const sessao = await comSessao(page);
  const pedidos = await supabaseFicticio(page, { status: 200, corpo: { estado: "excluida", apple: "nao-se-aplica" } });
  await page.goto("/");
  await botaoConta(page).click();
  await expect(painel(page)).toBeVisible();
  await expect(painel(page).getByRole("heading", { name: "Conta" })).toBeVisible();
  await expect(painel(page)).toContainText("Você joga como convidado neste aparelho.");

  // O painel cabe: nada de rolagem lateral, e o cartão dentro da tela.
  const vp = page.viewportSize()!;
  const caixa = (await painel(page).boundingBox())!;
  expect(caixa.x).toBeGreaterThanOrEqual(0);
  expect(caixa.x + caixa.width).toBeLessThanOrEqual(vp.width);
  expect(caixa.y).toBeGreaterThanOrEqual(0);
  expect(caixa.y + caixa.height).toBeLessThanOrEqual(vp.height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

  await painel(page).getByRole("button", { name: "Excluir conta" }).click();
  await expect(painel(page).getByRole("heading", { name: "Excluir conta" })).toBeVisible();
  const excluir = painel(page).getByRole("button", { name: "Excluir minha conta" });
  await expect(excluir).toBeDisabled();
  const campo = painel(page).getByRole("textbox");
  await campo.fill("excluir");
  await expect(excluir, "minúsculas não confirmam").toBeDisabled();
  await campo.fill("EXCLUIR");
  await expect(excluir).toBeEnabled();
  expect(pedidos.filter((p) => p.caminho.startsWith("/functions/")), "nada foi pedido antes do clique").toEqual([]);

  await excluir.click();
  await expect(painel(page).getByRole("heading", { name: "Conta excluída" })).toBeVisible();
  const pedido = pedidos.find((p) => p.caminho === "/functions/v1/excluir-conta")!;
  expect(pedido.metodo).toBe("POST");
  expect(pedido.autorizacao).toBe(`Bearer ${sessao.access_token}`);
  expect(JSON.parse(pedido.corpo!)).toEqual({ confirmacao: "EXCLUIR" });
  await expect.poll(() => sessaoNoNavegador(page)).toBeNull();

  await painel(page).getByRole("button", { name: "Voltar ao início" }).click();
  await expect(page.getByRole("button", { name: /jogar agora/i })).toBeVisible();
  await expect(botaoConta(page), "depois de excluir, não há conta para gerenciar").toHaveCount(0);
});

test("falha no servidor: a conta continua inteira e o aviso é neutro", async ({ page }) => {
  await comSessao(page);
  await supabaseFicticio(page, { status: 502, corpo: { erro: "falha-ao-excluir" } });
  await page.goto("/");
  await botaoConta(page).click();
  await painel(page).getByRole("button", { name: "Excluir conta" }).click();
  await painel(page).getByRole("textbox").fill("EXCLUIR");
  await painel(page).getByRole("button", { name: "Excluir minha conta" }).click();
  await expect(painel(page).getByRole("status")).toHaveText(/Não foi possível excluir agora\. Sua conta continua como estava/);
  expect(await sessaoNoNavegador(page), "a sessão sumiu sem a exclusão ter acontecido").not.toBeNull();
  await expect(painel(page).getByRole("heading", { name: "Excluir conta" })).toBeVisible();
});

test("fechar o painel volta à Home intacta", async ({ page }) => {
  await comSessao(page);
  await supabaseFicticio(page, { status: 200, corpo: {} });
  await page.goto("/");
  await botaoConta(page).click();
  await painel(page).getByRole("button", { name: "Voltar ao jogo" }).click();
  await expect(painel(page)).toHaveCount(0);
  expect(await sessaoNoNavegador(page)).not.toBeNull();
});
