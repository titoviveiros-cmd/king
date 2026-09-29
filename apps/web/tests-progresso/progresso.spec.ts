/**
 * O PROGRESSO NA HOME, PELO CAMINHO REAL — SDK do Supabase, sessão guardada, PostgREST — contra um
 * projeto FICTÍCIO cuja rede é interceptada aqui. Nenhum byte sai para a internet.
 *
 * Prova, em cada viewport do projeto:
 *   - com sessão e progresso: o card aparece, ABAIXO das ações, dentro da tela, sem rolagem
 *     lateral e sem sobrepor nada — e a única requisição é a LEITURA de `meu_progresso`;
 *   - sem sessão: NENHUMA requisição ao Supabase e nenhum convidado criado — só para desenhar XP;
 *   - Supabase fora do ar ou lento: a Home é a de sempre, na hora, e jogar funciona.
 */
import { expect, test, type Page } from "@playwright/test";

const REF = "abcdefghijklmnopqrst";
const HOST = `https://${REF}.supabase.co`;
const CHAVE_DA_SESSAO = `sb-${REF}-auth-token`;
const PROGRESSO = { xp_total: 370, nivel: 3, xp_no_nivel: 120, xp_do_nivel: 200 };

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sessaoGuardada() {
  const agora = Math.floor(Date.now() / 1000);
  const id = "11111111-1111-4111-8111-111111111111";
  const jwt = [b64url({ alg: "HS256", typ: "JWT" }), b64url({ sub: id, role: "authenticated", aud: "authenticated", exp: agora + 3600, is_anonymous: true }), "assinatura-ficticia"].join(".");
  return { access_token: jwt, refresh_token: "ficticio", token_type: "bearer", expires_in: 3600, expires_at: agora + 3600,
    user: { id, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} } };
}

async function comSessao(page: Page) {
  await page.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, [CHAVE_DA_SESSAO, JSON.stringify(sessaoGuardada())] as const);
}

/** Intercepta TUDO que for ao projeto fictício e registra. `meu_progresso` responde como mandado. */
async function supabaseFicticio(page: Page, { status = 200, atrasoMs = 0 } = {}) {
  const chamadas: string[] = [];
  await page.route(`${HOST}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    chamadas.push(`${req.method()} ${url.pathname}`);
    if (url.pathname === "/rest/v1/meu_progresso") {
      if (atrasoMs) await new Promise((r) => setTimeout(r, atrasoMs));
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(status === 200 ? [PROGRESSO] : { message: "indisponível" }) });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  return chamadas;
}

const card = (page: Page) => page.locator(".hm-progresso");
const jogarAgora = (page: Page) => page.getByRole("button", { name: /jogar agora/i });

test("com sessão: o card aparece abaixo das ações, na tela, sem rolagem lateral nem sobreposição", async ({ page }) => {
  await comSessao(page);
  const chamadas = await supabaseFicticio(page);
  await page.goto("/");
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText("Nível3");
  await expect(card(page)).toContainText("120 / 200 XP");
  // MEDIR O REPOUSO, NÃO UM QUADRO. O card entra com `riseIn`: nasce 18px abaixo e sobe. Nos
  // primeiros ~50ms ele cruza o "Aprenda KING" logo abaixo (medido: −3,6px a 852×300 e −7,6px a
  // 667×375; em repouso a folga é +14px e +10px). Foi esse quadro que o CI fotografou em
  // 29/09/2026 — sobreposição que não existe. Espera-se a animação ACABAR, como no placarFinal.
  await page.waitForFunction(() =>
    document.querySelector(".hm-progresso")!.getAnimations({ subtree: true }).every((a) => a.playState === "finished"));

  const vp = page.viewportSize()!;
  const cta = (await jogarAgora(page).boundingBox())!;
  const c = (await card(page).boundingBox())!;
  // secundário: DEPOIS da fileira de ações, e menor que ela na largura dos botões juntos
  expect(c.y).toBeGreaterThanOrEqual(cta.y + cta.height - 1);
  // dentro da tela, na horizontal sempre; o CTA principal, inteiro na tela
  expect(c.x).toBeGreaterThanOrEqual(0);
  expect(c.x + c.width).toBeLessThanOrEqual(vp.width);
  expect(cta.y).toBeGreaterThanOrEqual(0);
  expect(cta.y + cta.height).toBeLessThanOrEqual(vp.height);
  // sem rolagem lateral
  const lateral = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, home: (() => { const h = document.querySelector(".home")!; return h.scrollWidth - h.clientWidth; })() }));
  expect(lateral.doc).toBeLessThanOrEqual(0);
  expect(lateral.home).toBeLessThanOrEqual(0);
  // nada se sobrepõe ao card: nenhum outro elemento visível da Home cruza a área dele
  const cruzamentos = await page.evaluate(() => {
    const r = document.querySelector(".hm-progresso")!.getBoundingClientRect();
    return [...document.querySelectorAll(".home > *")].filter((el) => el !== document.querySelector(".hm-progresso")).map((el) => {
      const o = el.getBoundingClientRect();
      const cruza = o.width > 0 && o.height > 0 && o.left < r.right - 1 && o.right > r.left + 1 && o.top < r.bottom - 1 && o.bottom > r.top + 1;
      return cruza ? el.className || el.tagName : null;
    }).filter(Boolean);
  });
  expect(cruzamentos).toEqual([]);
  // só LEITURA: uma consulta a meu_progresso, e nenhuma chamada de autenticação/criação
  expect(chamadas.filter((c2) => !c2.startsWith("GET /rest/v1/meu_progresso"))).toEqual([]);
  expect(chamadas.length).toBeGreaterThanOrEqual(1);
});

test("sem sessão: nenhuma requisição ao Supabase, nenhum convidado criado, nenhum card", async ({ page }) => {
  const chamadas = await supabaseFicticio(page);
  await page.goto("/");
  await expect(jogarAgora(page)).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(card(page)).toHaveCount(0);
  expect(chamadas).toEqual([]);
  expect(await page.evaluate((k) => localStorage.getItem(k), CHAVE_DA_SESSAO)).toBeNull();
});

test("Supabase fora do ar: a Home de sempre, sem card, e jogar funciona", async ({ page }) => {
  await comSessao(page);
  await supabaseFicticio(page, { status: 503 });
  await page.goto("/");
  await expect(jogarAgora(page)).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(card(page)).toHaveCount(0);
  await jogarAgora(page).click();
  await expect(page.getByRole("dialog", { name: /escolha o seu avatar/i })).toBeVisible();
});

test("Supabase lento: a Home e as ações aparecem NA HORA; o card chega depois, sem empurrar o CTA para fora", async ({ page }) => {
  await comSessao(page);
  await supabaseFicticio(page, { atrasoMs: 2500 });
  await page.goto("/");
  await expect(jogarAgora(page)).toBeVisible({ timeout: 1500 });
  await expect(card(page)).toHaveCount(0);
  await expect(card(page)).toBeVisible({ timeout: 8000 });
  const vp = page.viewportSize()!;
  const cta = (await jogarAgora(page).boundingBox())!;
  expect(cta.y + cta.height).toBeLessThanOrEqual(vp.height);
});

test("sessão VENCIDA e renovação recusada: Home normal, sem card, e NENHUM convidado novo", async ({ page }) => {
  const vencida = { ...sessaoGuardada(), expires_at: Math.floor(Date.now() / 1000) - 3600 };
  await page.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, [CHAVE_DA_SESSAO, JSON.stringify(vencida)] as const);
  const chamadas = await supabaseFicticio(page, { status: 401 });
  await page.goto("/");
  await expect(jogarAgora(page)).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(card(page)).toHaveCount(0);
  // a renovação pode ser tentada (é do SDK); criar usuário, jamais
  expect(chamadas.filter((c) => /\/auth\/v1\/signup/.test(c))).toEqual([]);
  expect(chamadas.filter((c) => !/^(POST \/auth\/v1\/token|GET \/rest\/v1\/meu_progresso)/.test(c))).toEqual([]);
});

test("Google continua OFF: nenhum botão de conta Google na Home", async ({ page }) => {
  await comSessao(page);
  await supabaseFicticio(page);
  await page.goto("/");
  await expect(card(page)).toBeVisible();
  await expect(page.getByText(/google/i)).toHaveCount(0);
});
