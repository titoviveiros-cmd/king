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
 *   - falha no servidor: a conta continua inteira (a sessão fica) e o aviso é neutro;
 *   - a tela "Excluir conta" se lê INTEIRA e SEM ROLAR: o que fica por 30 dias (E-2) sem corte, sem
 *     reticências e sem sobreposição; "Excluir minha conta" e "Cancelar" à vista, sem nada por cima;
 *   - nos iPhones em paisagem, com a barra inferior (safe area), as duas ações continuam INTEIRAS à
 *     vista, sem rolar, também com EXCLUIR digitado e na falha; e girar liga e desliga a tela compacta.
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

/** O texto da retenção — o MESMO de `RETENCAO_DA_EXCLUSAO` (src/ui/PainelConta.tsx). Mudou lá, muda aqui. */
const RETENCAO = "Após excluir a conta, mantemos por 30 dias um identificador técnico e a data/hora para concluir créditos de XP. Pendências técnicas podem estender esse prazo até a resolução.";

test("a tela Excluir conta se lê INTEIRA e sem rolar: retenção sem corte nem reticências, nada sobreposto, as duas ações à vista", async ({ page }) => {
  await comSessao(page);
  await supabaseFicticio(page, { status: 200, corpo: { estado: "excluida", apple: "nao-se-aplica" } });
  await page.goto("/");
  await botaoConta(page).click();
  await painel(page).getByRole("button", { name: "Excluir conta" }).click();
  await expect(painel(page).getByRole("heading", { name: "Excluir conta" })).toBeVisible();
  const nota = painel(page).locator(".pc-nota");
  await expect(nota).toHaveText(RETENCAO);
  // Mede com as fontes embutidas carregadas e sem animação FINITA no meio (a 1ª moldura mente; uma
  // infinita, de destaque, não tem fim — finish() lançaria).
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const a of document.getAnimations()) if (a.effect?.getTiming().iterations !== Infinity) a.finish();
  });

  const m = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>("[role=dialog]")!;
    const nome = (el: Element) => el.matches("h2") ? "título" : el.matches("li") ? "item" : el.matches(".pc-nota") ? "retenção"
      : el.matches("span") ? "rótulo" : el.matches("input") ? "campo" : el.matches(".pc-excluir") ? "excluir" : "cancelar";
    const c = card.getBoundingClientRect();
    // o que o cartão MOSTRA (dentro da borda): o que passa disso só se veria rolando
    const vistaTopo = c.top + card.clientTop;
    const blocos = [...card.querySelectorAll<HTMLElement>("h2, .pc-lista li, .pc-nota, .pc-campo span, .pc-campo input, .pc-excluir, .pc-acoes .pc-link")]
      .map((el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { nome: nome(el), topo: b.top, base: b.bottom, esq: b.left, dir: b.right, altura: b.height,
          cortado: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
          reticencias: cs.textOverflow === "ellipsis", umaLinhaSo: cs.whiteSpace === "nowrap" };
      });
    return { cartao: { topo: vistaTopo, base: vistaTopo + card.clientHeight, esq: c.left, dir: c.right }, rolado: card.scrollTop,
      sobraLateral: card.scrollWidth - card.clientWidth, paginaLateral: document.documentElement.scrollWidth - innerWidth, blocos };
  });

  expect(m.paginaLateral, "rolagem lateral na página").toBeLessThanOrEqual(0);
  expect(m.sobraLateral, "rolagem lateral no painel").toBeLessThanOrEqual(0);
  expect(m.rolado, "o painel abriu rolado").toBe(0);
  for (const b of m.blocos) {
    expect(b.cortado, `${b.nome} cortado`).toBe(false);
    expect(b.reticencias, `${b.nome} com reticências`).toBe(false);
    expect(b.esq, `${b.nome} vaza à esquerda`).toBeGreaterThanOrEqual(m.cartao.esq);
    expect(b.dir, `${b.nome} vaza à direita`).toBeLessThanOrEqual(m.cartao.dir + 0.5);
    // decisão do titular (26/10): tudo à vista SEM rolar — as duas ações também, inclusive em 852×300
    expect(b.topo, `${b.nome} acima da dobra do painel`).toBeGreaterThanOrEqual(m.cartao.topo - 0.5);
    expect(b.base, `${b.nome} abaixo da dobra do painel`).toBeLessThanOrEqual(m.cartao.base + 0.5);
  }
  expect(m.blocos.find((b) => b.nome === "retenção")!.umaLinhaSo, "a retenção quebra linha, não corta").toBe(false);
  // nada encosta em nada — retângulos, porque em tela baixa as duas ações ficam lado a lado
  for (let i = 0; i < m.blocos.length; i++) {
    for (let j = i + 1; j < m.blocos.length; j++) {
      const [a, b] = [m.blocos[i], m.blocos[j]];
      const cruza = a.base > b.topo + 0.5 && b.base > a.topo + 0.5 && a.dir > b.esq + 0.5 && b.dir > a.esq + 0.5;
      expect(cruza, `${b.nome} encosta em ${a.nome}`).toBe(false);
    }
  }
  const [ultimoItem] = m.blocos.filter((b) => b.nome === "item").slice(-1);
  const retencao = m.blocos.find((b) => b.nome === "retenção")!;
  const rotulo = m.blocos.find((b) => b.nome === "rótulo")!;
  expect(retencao.topo, "a retenção vem logo depois da lista").toBeGreaterThanOrEqual(ultimoItem.base - 0.5);
  expect(rotulo.topo, "e antes da confirmação").toBeGreaterThanOrEqual(retencao.base - 0.5);

  for (const nome of ["excluir", "cancelar"]) {
    const b = m.blocos.find((x) => x.nome === nome)!;
    expect(b.altura, `alvo de toque: ${nome}`).toBeGreaterThanOrEqual(44);
    expect(b.dir - b.esq, `alvo de toque: ${nome}`).toBeGreaterThanOrEqual(44);
  }

  // as duas ações à vista sem rolar, e cada uma é ela mesma no ponto de toque (nada por cima)
  const excluir = painel(page).getByRole("button", { name: "Excluir minha conta" });
  const cancelar = painel(page).getByRole("button", { name: "Cancelar" });
  for (const acao of [excluir, cancelar]) {
    await expect(acao).toBeInViewport({ ratio: 1 });
    const noCentro = await acao.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
    });
    expect(noCentro, "algo cobre a ação").toBe(true);
  }
  // e a confirmação continua valendo — sem tirar nenhuma das duas da vista
  await expect(excluir).toBeDisabled();
  await painel(page).getByRole("textbox").fill("EXCLUIR");
  await expect(excluir).toBeEnabled();
  await expect(excluir).toBeInViewport({ ratio: 1 });
  await expect(cancelar).toBeInViewport({ ratio: 1 });
  expect(await painel(page).evaluate((el) => el.scrollTop), "digitar rolou o painel").toBe(0);
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
  // o aviso, o "tentar de novo" e o "Cancelar" INTEIROS à vista, sem procurar — também onde o painel rola
  // (a rolagem para com o respiro de baixo; sem ele, as ações ficavam 0,3px de fora)
  await expect(painel(page).getByRole("status")).toBeInViewport({ ratio: 1 });
  await expect(painel(page).getByRole("button", { name: "Excluir minha conta" })).toBeInViewport({ ratio: 1 });
  await expect(painel(page).getByRole("button", { name: "Cancelar" })).toBeInViewport({ ratio: 1 });
  // a falha não espreme o que se lê: quem rola é o painel, como no visual aprovado
  expect(await painel(page).locator(".pc-info").evaluate((el) => el.scrollHeight - el.clientHeight), "a falha cortou a lista ou a nota").toBeLessThanOrEqual(0);
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

/**
 * iPhone EM PAISAGEM, como no aparelho: a altura útil é a da janela MENOS a barra inferior (safe area).
 * As bordas de segurança entram pelas variáveis do tema — as mesmas que o `env()` preenche no aparelho.
 * A conta Apple (um item a mais na lista, limiar próprio) só existe no app com o vínculo ligado, que
 * nenhum build de e2e liga: o limiar dela é guardado em `painelConta.test.tsx`. A geometria é do
 * próprio teste: roda num projeto só.
 */
const IPHONES = [
  { nome: "iPhone 12/13 mini", w: 812, h: 375, lados: 50, barra: 21 },
  { nome: "iPhone 12/13/14", w: 844, h: 390, lados: 47, barra: 21 },
  { nome: "iPhone 14 Pro/15/16", w: 852, h: 393, lados: 59, barra: 21 },
  { nome: "iPhone SE", w: 667, h: 375, lados: 0, barra: 0 },
  { nome: "852×300 com a barra do iPhone", w: 852, h: 300, lados: 59, barra: 21 },
];

/** Ações e campo INTEIROS na área que o cartão mostra e fora da barra; nada por cima; nada sobreposto. */
async function asAcoesInteiras(page: Page, barra: number, quando: string) {
  const m = await page.evaluate((barra) => {
    const card = document.querySelector<HTMLElement>("[role=dialog]")!;
    const c = card.getBoundingClientRect();
    const topo = c.top + card.clientTop;
    const base = Math.min(topo + card.clientHeight, innerHeight - barra);
    const caixa = (el: HTMLElement) => { const b = el.getBoundingClientRect(); return { topo: b.top, base: b.bottom, esq: b.left, dir: b.right }; };
    const controles = [...card.querySelectorAll<HTMLElement>(".pc-excluir, .pc-acoes .pc-link, .pc-campo input")].map((el) => {
      const b = el.getBoundingClientRect();
      return { qual: el.matches("input") ? "campo" : el.textContent!.trim(), ...caixa(el), largura: b.width, altura: b.height,
        noPonto: el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)) };
    });
    const blocos = [...card.querySelectorAll<HTMLElement>("h2, .pc-info, .pc-campo span, .pc-campo input, .pc-aviso, .pc-excluir, .pc-acoes .pc-link")]
      .map((el) => ({ qual: el.className || el.tagName, ...caixa(el) }));
    return { topo, base, controles, blocos, lateral: document.documentElement.scrollWidth - innerWidth };
  }, barra);
  expect(m.lateral, `${quando}: rolagem lateral`).toBeLessThanOrEqual(0);
  for (const k of m.controles) {
    expect(k.topo, `${quando}: ${k.qual} acima da área à vista`).toBeGreaterThanOrEqual(m.topo - 0.5);
    // inteiro MESMO: nem o meio pixel que a rolagem em pixel inteiro deixava de fora
    expect(m.base - k.base, `${quando}: ${k.qual} abaixo da área à vista (ou na barra)`).toBeGreaterThanOrEqual(1);
    expect(k.noPonto, `${quando}: algo cobre ${k.qual}`).toBe(true);
    if (k.qual !== "campo") expect(Math.min(k.largura, k.altura), `${quando}: alvo de toque de ${k.qual}`).toBeGreaterThanOrEqual(44);
  }
  for (let i = 0; i < m.blocos.length; i++) {
    for (let j = i + 1; j < m.blocos.length; j++) {
      const [a, b] = [m.blocos[i], m.blocos[j]];
      const cruza = a.base > b.topo + 0.5 && b.base > a.topo + 0.5 && a.dir > b.esq + 0.5 && b.dir > a.esq + 0.5;
      expect(cruza, `${quando}: ${b.qual} encosta em ${a.qual}`).toBe(false);
    }
  }
}

for (const a of IPHONES) {
  test(`${a.nome}: as duas ações inteiras à vista, sem rolar — normal, com EXCLUIR e na falha`, async ({ page }, info) => {
    test.skip(info.project.name !== "852x393", "a geometria é do próprio teste: roda num projeto só");
    await page.setViewportSize({ width: a.w, height: a.h });
    await comSessao(page);
    await supabaseFicticio(page, { status: 502, corpo: { erro: "falha-ao-excluir" } });
    await page.goto("/");
    await page.addStyleTag({ content: `:root{--st:0px;--sb:${a.barra}px;--sl:${a.lados}px;--sr:${a.lados}px;}` });
    await botaoConta(page).click();
    await painel(page).getByRole("button", { name: "Excluir conta" }).click();
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (const x of document.getAnimations()) if (x.effect?.getTiming().iterations !== Infinity) x.finish();
    });

    await asAcoesInteiras(page, a.barra, "normal");
    expect(await painel(page).evaluate((el) => el.scrollTop), "o painel abriu rolado").toBe(0);
    const excluir = painel(page).getByRole("button", { name: "Excluir minha conta" });
    await expect(excluir).toBeDisabled();
    await painel(page).getByRole("textbox").fill("EXCLUIR");
    await expect(excluir).toBeEnabled();
    await asAcoesInteiras(page, a.barra, "com EXCLUIR");
    expect(await painel(page).evaluate((el) => el.scrollTop), "digitar rolou o painel").toBe(0);

    await excluir.click();
    await expect(painel(page).getByRole("status")).toHaveText(/Não foi possível excluir agora\. Sua conta continua como estava/);
    await expect(painel(page).getByRole("status")).toBeInViewport({ ratio: 0.99 });
    await asAcoesInteiras(page, a.barra, "na falha");

    // a altura muda com o aviso na tela (girar, a barra do navegador, o teclado) e, como no aparelho, cada
    // altura dura ao menos um quadro: a rolagem até as ações não fica velha
    await page.setViewportSize({ width: a.w, height: a.h + 80 });
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(null)))));
    await page.setViewportSize({ width: a.w, height: a.h });
    await expect(async () => { await asAcoesInteiras(page, a.barra, "na falha, depois de a altura mudar"); }).toPass({ timeout: 3000 });
  });
}

test("girar o aparelho: a tela compacta liga e desliga com a altura útil, sem reabrir o painel", async ({ page }, info) => {
  test.skip(info.project.name !== "852x393", "a geometria é do próprio teste: roda num projeto só");
  await comSessao(page);
  await supabaseFicticio(page, { status: 200, corpo: { estado: "excluida", apple: "nao-se-aplica" } });
  await page.goto("/");
  await botaoConta(page).click();
  await painel(page).getByRole("button", { name: "Excluir conta" }).click();
  const lado = () => painel(page).locator(".pc-acoes").evaluate((el) => getComputedStyle(el).flexDirection);
  await expect.poll(lado).toBe("column");
  await page.setViewportSize({ width: 852, height: 300 });
  await expect.poll(lado, "a altura útil caiu: as ações vão para o lado").toBe("row");
  await asAcoesInteiras(page, 0, "depois de encolher");
  await page.setViewportSize({ width: 852, height: 393 });
  await expect.poll(lado, "a altura voltou: o arranjo normal volta").toBe("column");
});
