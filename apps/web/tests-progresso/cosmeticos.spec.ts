/**
 * OS ITENS DA COROA NA HOME (Entrega B), pelo caminho real — SDK do Supabase, sessão guardada,
 * PostgREST — contra um projeto FICTÍCIO cuja rede é interceptada aqui. Nenhum byte sai para a
 * internet. O "banco" deste arquivo imita a regra da migração: equipar abaixo do nível é RECUSADO
 * com 42501, e o que fica gravado é o que o próximo aparelho lê.
 *
 * Prova, nos viewports do projeto:
 *   - a vitrine diz bloqueado/desbloqueado/equipado pelo nível do BANCO;
 *   - equipar e desequipar vão ao banco, e a recusa do banco aparece e não muda nada;
 *   - "NOVO ITEM DESBLOQUEADO!" aparece UMA vez — recarregar a Home não repete;
 *   - o Baralho Imperial vale numa partida contra os bots, sem mudar o tamanho de nenhuma carta;
 *   - outro aparelho da mesma conta lê a mesma escolha;
 *   - sem a migração no banco, a Home é exatamente a de antes;
 *   - tudo cabe na tela, inclusive a 852×300, e com MOVIMENTO REDUZIDO nada anima.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const REF = "abcdefghijklmnopqrst";
const HOST = `https://${REF}.supabase.co`;
const CHAVE_DA_SESSAO = `sb-${REF}-auth-token`;
const UID = "11111111-1111-4111-8111-111111111111";
const NIVEIS = { "moldura-real": 2, "baralho-imperial": 4, "reacao-coroa": 6 } as const;
/** As toalhas da mesa (parte 2): nível de cada uma, como no banco. */
const TOALHAS = { imperial: 1, verde: 1, vinho: 8, esmeralda: 10 } as const;
type ToalhaId = keyof typeof TOALHAS;
type Item = keyof typeof NIVEIS;
const COLUNA: Record<Item, "moldura_real" | "baralho_imperial" | "reacao_coroa"> = {
  "moldura-real": "moldura_real", "baralho-imperial": "baralho_imperial", "reacao-coroa": "reacao_coroa",
};

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sessaoGuardada() {
  const agora = Math.floor(Date.now() / 1000);
  const jwt = [b64url({ alg: "HS256", typ: "JWT" }), b64url({ sub: UID, role: "authenticated", aud: "authenticated", exp: agora + 3600, is_anonymous: true }), "assinatura-ficticia"].join(".");
  return { access_token: jwt, refresh_token: "ficticio", token_type: "bearer", expires_in: 3600, expires_at: agora + 3600,
    user: { id: UID, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} } };
}
async function comSessao(page: Page) {
  await page.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, [CHAVE_DA_SESSAO, JSON.stringify(sessaoGuardada())] as const);
}

/** A linha de `meu_progresso` para um nível. */
const progressoNo = (nivel: number) => ({ player_id: UID, xp_total: 25 * (nivel - 1) * (nivel + 2), nivel, xp_no_nivel: 0, xp_do_nivel: 50 * nivel + 50 });

/** O "banco" compartilhado entre aparelhos do mesmo teste. */
interface Banco {
  nivel: number;
  /** `null` = a tabela não existe (migração não aplicada). */
  linha: Record<string, boolean | string> | null;
  chamadas: string[];
  /** Força o banco a recusar o próximo equipar (cliente com vitrine desatualizada). */
  recusarProximo?: boolean;
}
const novoBanco = (nivel: number, linha: Record<string, boolean | string> | null = {}): Banco => ({ nivel, linha, chamadas: [] });

async function supabaseFicticio(page: Page, banco: Banco) {
  await page.route(`${HOST}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    banco.chamadas.push(`${req.method()} ${url.pathname}`);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/rest/v1/meu_progresso") return json(200, [progressoNo(banco.nivel)]);
    if (url.pathname === "/rest/v1/cosmeticos_equipados") {
      if (!banco.linha) return json(404, { code: "42P01", message: "relation does not exist" });
      const vazia = Object.keys(banco.linha).length === 0;
      // a coluna `toalha` tem padrão no banco: toda linha existente a traz
      return json(200, vazia ? [] : [{ toalha: "imperial", ...banco.linha }]);
    }
    if (url.pathname === "/rest/v1/rpc/equipar_cosmetico" && req.method() === "POST") {
      const { p_item, p_equipado } = JSON.parse(req.postData() ?? "{}") as { p_item: Item; p_equipado: boolean };
      if (!(p_item in NIVEIS)) return json(400, { code: "22023", message: "item fora do catálogo" });
      if (banco.recusarProximo || (p_equipado && banco.nivel < NIVEIS[p_item])) {
        banco.recusarProximo = false;
        return json(403, { code: "42501", message: "nível insuficiente" });
      }
      banco.linha = { moldura_real: false, baralho_imperial: false, reacao_coroa: false, ...(banco.linha ?? {}), [COLUNA[p_item]]: p_equipado };
      // `equipar_cosmetico` devolve SÓ as três colunas dela
      return json(200, [{ moldura_real: banco.linha.moldura_real, baralho_imperial: banco.linha.baralho_imperial, reacao_coroa: banco.linha.reacao_coroa }]);
    }
    if (url.pathname === "/rest/v1/rpc/equipar_toalha" && req.method() === "POST") {
      const { p_toalha } = JSON.parse(req.postData() ?? "{}") as { p_toalha: ToalhaId };
      if (!(p_toalha in TOALHAS)) return json(400, { code: "22023", message: "toalha fora do catálogo" });
      if (banco.recusarProximo || banco.nivel < TOALHAS[p_toalha]) {
        banco.recusarProximo = false;
        return json(403, { code: "42501", message: "nível insuficiente" });
      }
      banco.linha = { moldura_real: false, baralho_imperial: false, reacao_coroa: false, ...(banco.linha ?? {}), toalha: p_toalha };
      return json(200, [{ toalha: p_toalha }]);
    }
    return json(404, {});
  });
}

const itensBtn = (page: Page) => page.locator(".pg-itens");
/** "Jogar agora", escolhendo um bicho se a Home pedir — o mesmo caminho de `iniciarPartidaLocal`. */
async function jogarContraOsBots(page: Page) {
  await page.getByRole("button", { name: /jogar agora/i }).click();
  const seletor = page.locator(".hm-avdialogo");
  if (await seletor.count()) {
    await seletor.locator(".hm-av").first().click();
    await expect(seletor).toHaveCount(0, { timeout: 10_000 });
  }
}
const vitrine = (page: Page) => page.locator(".ovcard.itens");
const item = (page: Page, id: string) => page.locator(`.it-item[data-item="${id}"]`);
const celebracao = (page: Page) => page.locator(".novoitem");

async function abrirHome(page: Page, banco: Banco, { celebrados }: { celebrados?: Item[] } = {}) {
  await comSessao(page);
  if (celebrados) {
    await page.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); },
      ["king:cosmeticos:celebrados", JSON.stringify({ [UID]: celebrados })] as const);
  }
  await supabaseFicticio(page, banco);
  await page.goto("/");
  await expect(page.locator(".hm-progresso")).toBeVisible();
}

test("nível 1: a vitrine mostra os três BLOQUEADOS, com o nível de cada um, e nada para equipar", async ({ page }) => {
  const banco = novoBanco(1);
  await abrirHome(page, banco);
  await expect(itensBtn(page)).toHaveText("👑 0/5");
  await expect(celebracao(page)).toHaveCount(0);
  await itensBtn(page).click();
  await expect(vitrine(page)).toBeVisible();
  for (const [id, n] of Object.entries(NIVEIS)) {
    await expect(item(page, id as Item).locator(".it-estado")).toHaveText(`🔒 Nível ${n}`);
    await expect(item(page, id as Item).locator(".it-botao")).toHaveCount(0);
  }
  await expect(vitrine(page)).toContainText("partidas contra os bots não contam");
  expect(banco.chamadas.filter((c) => c.startsWith("POST"))).toEqual([]);
});

test("subiu para o nível 4: NOVO ITEM DESBLOQUEADO! aparece UMA vez — recarregar não repete", async ({ page }) => {
  const banco = novoBanco(4);
  await abrirHome(page, banco);
  await expect(celebracao(page)).toBeVisible();
  await expect(celebracao(page).locator(".ni-titulo")).toHaveText("NOVO ITEM DESBLOQUEADO!");
  await expect(celebracao(page).locator(".ni-itens li")).toHaveCount(2);
  // dispensa com um toque fora do cartão, e nada fica interceptando a Home
  await page.mouse.click(5, 5);
  await expect(celebracao(page)).toHaveCount(0, { timeout: 2_000 });
  await expect(page.getByRole("button", { name: /jogar agora/i })).toBeEnabled();
  await page.reload();
  await expect(page.locator(".hm-progresso")).toBeVisible();
  await expect(itensBtn(page)).toHaveText("👑 2/5");
  await page.waitForTimeout(800);
  await expect(celebracao(page)).toHaveCount(0);
});

test("a celebração some SOZINHA e 'Ver itens' leva à vitrine", async ({ page }) => {
  await abrirHome(page, novoBanco(2));
  await expect(celebracao(page)).toBeVisible();
  await expect(celebracao(page)).toHaveCount(0, { timeout: 7_000 });
  const outra = await page.context().newPage();
  await comSessao(outra);
  await supabaseFicticio(outra, novoBanco(6));
  await outra.goto("/");
  await expect(celebracao(outra)).toBeVisible();
  await expect(celebracao(outra).locator(".ni-itens li")).toHaveCount(2); // a moldura já foi celebrada neste aparelho
  await celebracao(outra).getByRole("button", { name: "Ver itens" }).click();
  await expect(vitrine(outra)).toBeVisible();
  await outra.close();
});

/**
 * A mão é medida PARADA. Desde a animação de distribuição e pouso (Entrega A), as cartas chegam com
 * `transform` por ~1,3 s, e o `getBoundingClientRect` mede a carta em voo. Espera as animações
 * finitas da mão terminarem por conta própria (sem `finish()`), para comparar tamanhos finais.
 */
async function maoParada(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const mao = document.querySelector(".hand");
    return !!mao && mao.getAnimations({ subtree: true })
      .filter((a) => a.effect?.getTiming().iterations !== Infinity)
      .every((a) => a.playState === "finished");
  }, undefined, { timeout: 10_000 });
}

test("equipar e desequipar vão ao BANCO; o Baralho Imperial vale na partida contra os bots sem mudar o tamanho de carta nenhuma", async ({ page }) => {
  const banco = novoBanco(4);
  await abrirHome(page, banco, { celebrados: ["moldura-real", "baralho-imperial", "reacao-coroa"] });
  // tamanho das cartas SEM o baralho, como referência
  await jogarContraOsBots(page);
  await expect(page.locator(".hand .card")).toHaveCount(13, { timeout: 20_000 });
  await maoParada(page);
  const semBaralho = await page.locator(".hand .card").evaluateAll((cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  await page.goto("/");

  await itensBtn(page).click();
  await item(page, "baralho-imperial").getByRole("button", { name: "Equipar" }).click();
  await expect(item(page, "baralho-imperial").locator(".it-estado")).toHaveText("Equipado");
  expect(banco.chamadas).toContain("POST /rest/v1/rpc/equipar_cosmetico");
  expect(banco.linha).toMatchObject({ baralho_imperial: true });
  await expect(page.locator("html")).toHaveAttribute("data-baralho", "imperial");
  await vitrine(page).getByRole("button", { name: "Voltar" }).click();

  await jogarContraOsBots(page);
  await expect(page.locator(".hand .card")).toHaveCount(13, { timeout: 20_000 });
  await maoParada(page);
  const comBaralho = await page.locator(".hand .card").evaluateAll((cs) => cs.map((c) => {
    const r = c.getBoundingClientRect(); const s = getComputedStyle(c);
    return { tam: [Math.round(r.width), Math.round(r.height)], contorno: s.outlineStyle, face: c.textContent };
  }));
  expect(comBaralho.map((c) => c.tam), "o baralho mudou o tamanho de alguma carta").toEqual(semBaralho);
  expect(comBaralho.every((c) => c.contorno === "solid"), "o acabamento imperial não chegou às cartas").toBe(true);
  expect(comBaralho.every((c) => /[A2-9JQK]|10/.test(c.face ?? "")), "uma face perdeu o valor").toBe(true);

  await page.goto("/");
  await itensBtn(page).click();
  await item(page, "baralho-imperial").getByRole("button", { name: "Desequipar" }).click();
  await expect(item(page, "baralho-imperial").locator(".it-estado")).toHaveText("Desbloqueado");
  await expect(page.locator("html")).not.toHaveAttribute("data-baralho", "imperial");
  expect(banco.linha).toMatchObject({ baralho_imperial: false });
});

test("a RECUSA do banco aparece e não muda nada (vitrine desatualizada ou cliente adulterado)", async ({ page }) => {
  const banco = novoBanco(6);
  await abrirHome(page, banco, { celebrados: ["moldura-real", "baralho-imperial", "reacao-coroa"] });
  await itensBtn(page).click();
  banco.recusarProximo = true;
  await item(page, "reacao-coroa").getByRole("button", { name: "Equipar" }).click();
  await expect(vitrine(page).locator(".it-aviso")).toContainText("ainda não foi liberado");
  await expect(item(page, "reacao-coroa").locator(".it-estado")).toHaveText("Desbloqueado");
  expect(banco.linha).toEqual({});
});

test("OUTRO APARELHO da mesma conta lê a mesma escolha (o baralho chega pelo banco, não pelo cache)", async ({ browser }) => {
  const banco = novoBanco(5, { moldura_real: true, baralho_imperial: true, reacao_coroa: false });
  const ctx = await (browser as Browser).newContext();
  const page = await ctx.newPage();
  await abrirHome(page, banco, { celebrados: ["moldura-real", "baralho-imperial"] });
  await expect(page.locator("html")).toHaveAttribute("data-baralho", "imperial");
  await itensBtn(page).click();
  await expect(item(page, "moldura-real").locator(".it-estado")).toHaveText("Equipado");
  await expect(item(page, "baralho-imperial").locator(".it-estado")).toHaveText("Equipado");
  await expect(item(page, "reacao-coroa").locator(".it-estado")).toHaveText("🔒 Nível 6");
  await ctx.close();
});

test("SEM A MIGRAÇÃO no banco: sem vitrine, sem celebração — a Home é a de antes", async ({ page }) => {
  const banco = novoBanco(6, null);
  await abrirHome(page, banco);
  await page.waitForTimeout(1200);
  await expect(itensBtn(page)).toHaveCount(0);
  await expect(celebracao(page)).toHaveCount(0);
  await expect(page.locator(".hm-progresso")).toContainText("Nível6");
});

test("tudo cabe: o card com o botão de itens não vaza, e a vitrine fica inteira na tela (com rolagem própria se preciso)", async ({ page }, ti) => {
  const banco = novoBanco(4, { moldura_real: true, baralho_imperial: false, reacao_coroa: false });
  await abrirHome(page, banco, { celebrados: ["moldura-real", "baralho-imperial"] });
  await page.waitForFunction(() =>
    document.querySelector(".hm-progresso")!.getAnimations({ subtree: true }).every((a) => a.playState === "finished"));
  const vp = page.viewportSize()!;
  const card = (await page.locator(".hm-progresso").boundingBox())!;
  const btn = (await itensBtn(page).boundingBox())!;
  expect(card.x + card.width).toBeLessThanOrEqual(vp.width);
  expect(btn.x + btn.width, "o botão saiu do card").toBeLessThanOrEqual(card.x + card.width + 0.5);
  expect(btn.height, "alvo de dedo").toBeGreaterThanOrEqual(24);
  const vaza = await page.locator(".hm-progresso").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(vaza, `[${ti.project.name}] o card vaza ${vaza}px`).toBeLessThanOrEqual(0);
  const lateral = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(lateral).toBeLessThanOrEqual(0);

  await itensBtn(page).click();
  const v = (await vitrine(page).boundingBox())!;
  expect(v.x).toBeGreaterThanOrEqual(0);
  expect(v.y).toBeGreaterThanOrEqual(0);
  expect(v.x + v.width).toBeLessThanOrEqual(vp.width);
  expect(v.y + v.height).toBeLessThanOrEqual(vp.height + 0.5);
  // cada botão de equipar é alcançável (rolando a vitrine, se a tela for baixa) e tem alvo de dedo
  for (const id of ["moldura-real", "baralho-imperial"] as const) {
    const b = item(page, id).locator(".it-botao");
    await b.scrollIntoViewIfNeeded();
    const caixa = (await b.boundingBox())!;
    expect(caixa.y + caixa.height).toBeLessThanOrEqual(vp.height + 0.5);
    expect(caixa.height).toBeGreaterThanOrEqual(30);
  }
  if (process.env.KING_SHOTS) await page.screenshot({ path: `${process.env.KING_SHOTS}/itens-vitrine-${ti.project.name}.png` });
});

test("com MOVIMENTO REDUZIDO, a celebração diz tudo sem animar", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await abrirHome(page, novoBanco(2));
  await expect(celebracao(page)).toBeVisible();
  await expect(celebracao(page).locator(".ni-titulo")).toHaveText("NOVO ITEM DESBLOQUEADO!");
  const animando = await celebracao(page).evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length);
  expect(animando).toBe(0);
});

// ═══════════════════ A TOALHA DA MESA (nova categoria) e a vitrine por categoria ═══════════════════

const TODOS_CELEBRADOS: string[] = ["moldura-real", "baralho-imperial", "reacao-coroa", "mesa-vinho", "mesa-esmeralda"];

test("nível 8: a Vinho Clássica é desbloqueada, celebrada UMA vez, e o contador da Home diz 4/5", async ({ page }) => {
  const banco = novoBanco(8);
  await abrirHome(page, banco, { celebrados: ["moldura-real", "baralho-imperial", "reacao-coroa"] });
  await expect(celebracao(page)).toBeVisible();
  await expect(celebracao(page).locator(".ni-itens li")).toHaveText(["Vinho Clássica"]);
  await page.mouse.click(5, 5);
  await expect(celebracao(page)).toHaveCount(0, { timeout: 2_000 });
  await expect(itensBtn(page)).toHaveText("👑 4/5");
});

test("MESA equipável: escolher a Vinho vai ao BANCO (equipar_toalha) e vale na partida contra os bots; voltar à Noite Imperial também", async ({ page }, ti) => {
  const banco = novoBanco(8);
  await abrirHome(page, banco, { celebrados: TODOS_CELEBRADOS as Item[] });
  await itensBtn(page).click();
  await expect(item(page, "mesa-imperial").locator(".it-estado")).toHaveText("Em uso");
  await expect(item(page, "mesa-esmeralda").locator(".it-estado")).toHaveText("🔒 Nível 10");
  await expect(item(page, "mesa-esmeralda").locator(".it-botao")).toHaveCount(0);
  await item(page, "mesa-vinho").getByRole("button", { name: "Usar" }).click();
  await expect(item(page, "mesa-vinho").locator(".it-estado")).toHaveText("Em uso");
  await expect(item(page, "mesa-imperial").locator(".it-estado")).toHaveText("Livre");
  expect(banco.chamadas).toContain("POST /rest/v1/rpc/equipar_toalha");
  expect(banco.linha).toMatchObject({ toalha: "vinho" });
  await vitrine(page).getByRole("button", { name: "Voltar" }).click();

  await jogarContraOsBots(page);
  await expect(page.locator(".mesa")).toHaveAttribute("data-tema", "vinho", { timeout: 20_000 });
  await expect(page.locator(".hand .card")).toHaveCount(13, { timeout: 20_000 });
  await maoParada(page);
  if (process.env.KING_SHOTS) await page.screenshot({ path: `${process.env.KING_SHOTS}/mesa-vinho-solo-${ti.project.name}.png` });

  await page.goto("/");
  await itensBtn(page).click();
  await item(page, "mesa-imperial").getByRole("button", { name: "Usar" }).click();
  await expect(item(page, "mesa-imperial").locator(".it-estado")).toHaveText("Em uso");
  expect(banco.linha).toMatchObject({ toalha: "imperial" });
  await vitrine(page).getByRole("button", { name: "Voltar" }).click();
  await jogarContraOsBots(page);
  await expect(page.locator(".mesa")).toHaveAttribute("data-tema", "imperial", { timeout: 20_000 });
});

test("a RECUSA do banco na toalha aparece e a mesa não muda", async ({ page }) => {
  const banco = novoBanco(10);
  await abrirHome(page, banco, { celebrados: TODOS_CELEBRADOS as Item[] });
  await itensBtn(page).click();
  banco.recusarProximo = true;
  await item(page, "mesa-esmeralda").getByRole("button", { name: "Usar" }).click();
  await expect(vitrine(page).locator(".it-aviso")).toContainText("ainda não foi liberado");
  await expect(item(page, "mesa-imperial").locator(".it-estado")).toHaveText("Em uso");
  expect(banco.linha).toEqual({});
});

test("a vitrine é organizada por CATEGORIA, aponta o PRÓXIMO desbloqueio e cabe na tela (rolando por dentro)", async ({ page }, ti) => {
  const banco = novoBanco(6, { moldura_real: true, baralho_imperial: true, reacao_coroa: false });
  await abrirHome(page, banco, { celebrados: TODOS_CELEBRADOS as Item[] });
  await itensBtn(page).click();
  await expect(vitrine(page).locator(".it-cat-titulo")).toHaveText(["Molduras", "Baralhos", "Mesas", "Reações"]);
  await expect(vitrine(page).locator(".it-proximo")).toHaveText("Próximo: Vinho Clássica no nível 8");
  await expect(vitrine(page).locator(".sub")).toContainText("3 de 5");
  const vp = page.viewportSize()!;
  const v = (await vitrine(page).boundingBox())!;
  expect(v.y).toBeGreaterThanOrEqual(0);
  expect(v.y + v.height, "a vitrine passou da tela").toBeLessThanOrEqual(vp.height + 0.5);
  // título e Voltar sempre à vista; o último item alcançável rolando a LISTA (não a página)
  await expect(vitrine(page).getByRole("button", { name: "Voltar" })).toBeInViewport();
  await expect(vitrine(page).locator("#it-titulo")).toBeInViewport();
  await item(page, "reacao-coroa").scrollIntoViewIfNeeded();
  await expect(item(page, "reacao-coroa")).toBeInViewport();
  const lateral = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(lateral).toBeLessThanOrEqual(0);
  if (process.env.KING_SHOTS) {
    await vitrine(page).locator(".it-lista").evaluate((el) => { el.scrollTop = 0; });
    await page.screenshot({ path: `${process.env.KING_SHOTS}/vitrine-categorias-${ti.project.name}.png` });
  }
});

test("o BARALHO IMPERIAL premium: verso com brasão e faces marfim com filete de ouro, SEM mudar tamanho nem a marca de jogável", async ({ page }, ti) => {
  const banco = novoBanco(4, { moldura_real: false, baralho_imperial: true, reacao_coroa: false });
  await abrirHome(page, banco, { celebrados: ["moldura-real", "baralho-imperial"] });
  await expect(page.locator("html")).toHaveAttribute("data-baralho", "imperial");
  await jogarContraOsBots(page);
  await expect(page.locator(".hand .card")).toHaveCount(13, { timeout: 20_000 });
  await maoParada(page);
  const estilo = await page.locator(".hand .card").first().evaluate((c) => {
    const s = getComputedStyle(c);
    return { borda: s.borderTopColor, contorno: s.outlineStyle, fundo: s.backgroundImage };
  });
  expect(estilo.contorno).toBe("solid");
  expect(estilo.borda).toBe("rgb(212, 168, 58)"); // a borda em ouro (mesma largura)
  expect(estilo.fundo).toContain("radial-gradient");
  // a carta jogável continua com a MESMA marca turquesa (o estado do jogo não é do cosmético)
  const legal = page.locator(".hand .card.legal").first();
  if (await legal.count()) {
    const marca = await legal.evaluate((c) => getComputedStyle(c, "::after").backgroundColor);
    expect(marca).toBe("rgb(45, 212, 191)");
  }
  if (process.env.KING_SHOTS) await page.screenshot({ path: `${process.env.KING_SHOTS}/baralho-imperial-premium-${ti.project.name}.png` });
});
