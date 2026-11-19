/**
 * OS ITENS DA COROA NA HOME (Entregas B e C), pelo caminho real — SDK do Supabase, sessão guardada,
 * PostgREST — contra um projeto FICTÍCIO cuja rede é interceptada aqui. Nenhum byte sai para a
 * internet. O "banco" deste arquivo imita a regra da migração do catálogo: equipar abaixo do nível é
 * RECUSADO com 42501; moldura e baralho são UM por vez; as reações se somam; e o que fica gravado é o
 * que o próximo aparelho lê.
 *
 * Prova, nos viewports do projeto:
 *   - a vitrine diz bloqueado/desbloqueado/equipado pelo nível do BANCO, na curva combinada;
 *   - equipar e desequipar vão ao banco (UMA porta, `equipar_item`), e a recusa aparece e não muda nada;
 *   - "NOVO ITEM DESBLOQUEADO!" aparece UMA vez — recarregar a Home não repete;
 *   - cada um dos CINCO baralhos vale numa partida contra os bots, sem mudar o tamanho de nenhuma carta;
 *   - as mesas novas valem contra os bots; outro aparelho da mesma conta lê a mesma escolha;
 *   - sem a migração no banco, a Home é exatamente a de antes;
 *   - tudo cabe na tela, inclusive a 852×300, e com MOVIMENTO REDUZIDO nada anima.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const REF = "abcdefghijklmnopqrst";
const HOST = `https://${REF}.supabase.co`;
const CHAVE_DA_SESSAO = `sb-${REF}-auth-token`;
const UID = "11111111-1111-4111-8111-111111111111";
/** O catálogo do banco (migração 20261119120000): nível de cada item. */
const NIVEIS: Record<string, number> = {
  "moldura-real": 2, "moldura-rubi": 7, "moldura-onix": 11, "moldura-diamante": 15, "moldura-esmeralda": 16,
  "baralho-imperial": 4, "baralho-safira": 9, "baralho-ouro-negro": 13, "baralho-rubi": 17, "baralho-marfim": 18,
  "reacao-fogo": 5, "reacao-coroa": 6, "reacao-caveira": 10, "reacao-aplauso": 14,
  "mesa-imperial": 1, "mesa-verde": 1, "mesa-vinho": 3, "mesa-azul": 8, "mesa-esmeralda": 10, "mesa-preta": 12,
};
const TOTAL = 18; // os itens de nível
const ORDEM_DAS_REACOES = ["fogo", "coroa", "caveira", "aplauso"];
const BARALHOS = ["imperial", "safira", "ouro-negro", "rubi", "marfim"] as const;

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

interface Linha { moldura: string | null; baralho: string | null; reacoes: string[]; toalha: string }
const LINHA_PADRAO: Linha = { moldura: null, baralho: null, reacoes: [], toalha: "imperial" };

/** O "banco" compartilhado entre aparelhos do mesmo teste. */
interface Banco {
  nivel: number;
  /** `null` = a tabela não existe; `"antiga"` = só as partes 1–2 (sem as colunas do catálogo); `{}` = sem linha ainda. */
  linha: Partial<Linha> | null | "antiga";
  chamadas: string[];
  /** Força o banco a recusar o próximo equipar (cliente com vitrine desatualizada). */
  recusarProximo?: boolean;
}
const novoBanco = (nivel: number, linha: Banco["linha"] = {}): Banco => ({ nivel, linha, chamadas: [] });

async function supabaseFicticio(page: Page, banco: Banco) {
  await page.route(`${HOST}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    banco.chamadas.push(`${req.method()} ${url.pathname}`);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/rest/v1/meu_progresso") return json(200, [progressoNo(banco.nivel)]);
    if (url.pathname === "/rest/v1/cosmeticos_equipados") {
      if (!banco.linha) return json(404, { code: "42P01", message: "relation does not exist" });
      if (banco.linha === "antiga") return json(400, { code: "42703", message: "column cosmeticos_equipados.moldura does not exist" });
      return json(200, Object.keys(banco.linha).length === 0 ? [] : [{ ...LINHA_PADRAO, ...banco.linha }]);
    }
    if (url.pathname === "/rest/v1/rpc/equipar_item" && req.method() === "POST") {
      const { p_item, p_equipado } = JSON.parse(req.postData() ?? "{}") as { p_item: string; p_equipado: boolean };
      if (!(p_item in NIVEIS) || typeof p_equipado !== "boolean") return json(400, { code: "22023", message: "item fora do catálogo" });
      if (banco.recusarProximo || (p_equipado && banco.nivel < NIVEIS[p_item])) {
        banco.recusarProximo = false;
        return json(403, { code: "42501", message: "nível insuficiente" });
      }
      const l: Linha = { ...LINHA_PADRAO, ...(typeof banco.linha === "object" ? banco.linha : {}) };
      const [tipo, ...resto] = p_item.split("-");
      const v = resto.join("-");
      if (tipo === "moldura") l.moldura = p_equipado ? v : (l.moldura === v ? null : l.moldura);
      if (tipo === "baralho") l.baralho = p_equipado ? v : (l.baralho === v ? null : l.baralho);
      if (tipo === "mesa") l.toalha = p_equipado ? v : (l.toalha === v ? "imperial" : l.toalha);
      if (tipo === "reacao") l.reacoes = ORDEM_DAS_REACOES.filter((r) => (r === v ? p_equipado : l.reacoes.includes(r)));
      banco.linha = l;
      return json(200, [l]);
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
/** Todos os itens de nível até `n` já celebrados (para a celebração não cobrir o que se quer testar). */
const celebradosAte = (n: number) => Object.entries(NIVEIS).filter(([, x]) => x > 1 && x <= n).map(([id]) => id);

async function abrirHome(page: Page, banco: Banco, { celebrados }: { celebrados?: string[] } = {}) {
  await comSessao(page);
  if (celebrados) {
    await page.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); },
      ["king:cosmeticos:celebrados", JSON.stringify({ [UID]: celebrados })] as const);
  }
  await supabaseFicticio(page, banco);
  await page.goto("/");
  await expect(page.locator(".hm-progresso")).toBeVisible();
}

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

test("nível 1: a vitrine mostra os 18 desbloqueios BLOQUEADOS, com o nível de cada um; as livres sem botão", async ({ page }) => {
  const banco = novoBanco(1);
  await abrirHome(page, banco);
  await expect(itensBtn(page)).toHaveText(`👑 0/${TOTAL}`);
  await expect(celebracao(page)).toHaveCount(0);
  await itensBtn(page).click();
  await expect(vitrine(page)).toBeVisible();
  for (const [id, n] of Object.entries(NIVEIS).filter(([, x]) => x > 1)) {
    await expect(item(page, id).locator(".it-estado")).toHaveText(`🔒 Nível ${n}`);
    await expect(item(page, id).locator(".it-botao")).toHaveCount(0);
  }
  for (const id of ["reacao-risada", "reacao-choro"]) {
    await expect(item(page, id).locator(".it-estado")).toHaveText("Livre");
    await expect(item(page, id).locator(".it-botao")).toHaveCount(0);
  }
  await expect(vitrine(page)).toContainText("partidas contra os bots não contam");
  expect(banco.chamadas.filter((c) => c.startsWith("POST"))).toEqual([]);
});

test("subiu para o nível 4: NOVO ITEM DESBLOQUEADO! com os três da curva aparece UMA vez — recarregar não repete", async ({ page }) => {
  const banco = novoBanco(4);
  await abrirHome(page, banco);
  await expect(celebracao(page)).toBeVisible();
  await expect(celebracao(page).locator(".ni-titulo")).toHaveText("NOVO ITEM DESBLOQUEADO!");
  await expect(celebracao(page).locator(".ni-itens li > span:last-child")).toHaveText(["Moldura Real", "Vinho Imperial", "Baralho Imperial"]);
  await page.mouse.click(5, 5);
  await expect(celebracao(page)).toHaveCount(0, { timeout: 2_000 });
  await expect(page.getByRole("button", { name: /jogar agora/i })).toBeEnabled();
  await page.reload();
  await expect(page.locator(".hm-progresso")).toBeVisible();
  await expect(itensBtn(page)).toHaveText(`👑 3/${TOTAL}`);
  await page.waitForTimeout(800);
  await expect(celebracao(page)).toHaveCount(0);
});

test("subiu do 1 ao 18 de uma vez: a celebração mostra os QUATRO mais novos e 'e mais 14 itens', inteira na tela", async ({ page }, ti) => {
  await abrirHome(page, novoBanco(18));
  await expect(celebracao(page)).toBeVisible();
  await expect(celebracao(page).locator(".ni-itens li > span:last-child")).toHaveText(["Moldura Diamante do Rei", "Moldura Esmeralda Suprema", "Baralho Imperial Rubi", "Baralho Marfim Real"]);
  await expect(celebracao(page).locator(".ni-mais")).toHaveText(`e mais ${TOTAL - 4} itens`);
  const vp = page.viewportSize()!;
  const c = (await celebracao(page).locator(".ni-cartao").boundingBox())!;
  expect(c.y).toBeGreaterThanOrEqual(0);
  expect(c.y + c.height, "a celebração passou da tela").toBeLessThanOrEqual(vp.height + 0.5);
  await expect(celebracao(page).getByRole("button", { name: "Ver itens" })).toBeInViewport();
  if (process.env.KING_SHOTS) { await page.waitForTimeout(600); await page.screenshot({ path: `${process.env.KING_SHOTS}/celebracao-nivel18-${ti.project.name}.png` }); }
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
  // a moldura já foi celebrada neste aparelho: Vinho, Baralho, Fogo e Coroa
  await expect(celebracao(outra).locator(".ni-itens li")).toHaveCount(4);
  await celebracao(outra).getByRole("button", { name: "Ver itens" }).click();
  await expect(vitrine(outra)).toBeVisible();
  await outra.close();
});

test("UMA MOLDURA POR VEZ: equipar outra troca (pelo banco); desequipar a que está em uso tira", async ({ page }) => {
  const banco = novoBanco(16, { moldura: "real" });
  await abrirHome(page, banco, { celebrados: celebradosAte(18) });
  await itensBtn(page).click();
  await expect(item(page, "moldura-real").locator(".it-estado")).toHaveText("Equipado");
  await item(page, "moldura-esmeralda").getByRole("button", { name: "Equipar" }).click();
  await expect(item(page, "moldura-esmeralda").locator(".it-estado")).toHaveText("Equipado");
  await expect(item(page, "moldura-real").locator(".it-estado")).toHaveText("Desbloqueado");
  expect(banco.chamadas).toContain("POST /rest/v1/rpc/equipar_item");
  expect(banco.linha).toMatchObject({ moldura: "esmeralda" });
  await item(page, "moldura-esmeralda").getByRole("button", { name: "Desequipar" }).click();
  await expect(item(page, "moldura-esmeralda").locator(".it-estado")).toHaveText("Desbloqueado");
  expect(banco.linha).toMatchObject({ moldura: null });
  // e as reações de nível ligam e desligam uma a uma
  await item(page, "reacao-aplauso").getByRole("button", { name: "Equipar" }).click();
  await item(page, "reacao-fogo").getByRole("button", { name: "Equipar" }).click();
  await expect(item(page, "reacao-fogo").locator(".it-estado")).toHaveText("Equipado");
  expect(banco.linha).toMatchObject({ reacoes: ["fogo", "aplauso"] });
});

test("cada um dos CINCO baralhos vale na partida contra os bots, com verso e face próprios e SEM mudar o tamanho de carta nenhuma", async ({ page }, ti) => {
  test.setTimeout(150_000);
  const banco = novoBanco(18);
  await abrirHome(page, banco, { celebrados: celebradosAte(18) });
  await jogarContraOsBots(page);
  await expect(page.locator(".hand .card")).toHaveCount(13, { timeout: 20_000 });
  await maoParada(page);
  const tamanhos = () => page.locator(".hand .card").evaluateAll((cs) => cs.map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  const semBaralho = await tamanhos();
  const vistos = new Set<string>();
  for (const b of BARALHOS) {
    await page.goto("/");
    await itensBtn(page).click();
    await item(page, `baralho-${b}`).getByRole("button", { name: "Equipar" }).click();
    await expect(item(page, `baralho-${b}`).locator(".it-estado")).toHaveText("Equipado");
    expect(banco.linha).toMatchObject({ baralho: b });
    await expect(page.locator("html")).toHaveAttribute("data-baralho", b);
    await vitrine(page).getByRole("button", { name: "Voltar" }).click();
    await jogarContraOsBots(page);
    await expect(page.locator(".hand .card")).toHaveCount(13, { timeout: 20_000 });
    await maoParada(page);
    const cartas = await page.locator(".hand .card").evaluateAll((cs) => cs.map((c) => {
      const s = getComputedStyle(c);
      return { contorno: s.outlineStyle, face: c.textContent, pinta: `${s.borderTopColor}|${s.outlineColor}|${s.backgroundImage.slice(0, 60)}` };
    }));
    expect(await tamanhos(), `${b}: o baralho mudou o tamanho de alguma carta`).toEqual(semBaralho);
    expect(cartas.every((c) => c.contorno === "solid"), `${b}: o acabamento não chegou às cartas`).toBe(true);
    expect(cartas.every((c) => /[A2-9JQK]|10/.test(c.face ?? "")), `${b}: uma face perdeu o valor`).toBe(true);
    vistos.add(cartas[0].pinta);
    if (process.env.KING_SHOTS && ti.project.name === "852x393") await page.screenshot({ path: `${process.env.KING_SHOTS}/baralho-${b}-${ti.project.name}.png` });
  }
  expect(vistos.size, "dois baralhos com a MESMA face").toBe(BARALHOS.length);
  // a carta jogável continua com a MESMA marca turquesa (o estado do jogo não é do cosmético)
  const legal = page.locator(".hand .card.legal").first();
  if (await legal.count()) expect(await legal.evaluate((c) => getComputedStyle(c, "::after").backgroundColor)).toBe("rgb(45, 212, 191)");
});

test("a RECUSA do banco aparece e não muda nada (vitrine desatualizada ou cliente adulterado)", async ({ page }) => {
  const banco = novoBanco(6);
  await abrirHome(page, banco, { celebrados: celebradosAte(6) });
  await itensBtn(page).click();
  banco.recusarProximo = true;
  await item(page, "reacao-coroa").getByRole("button", { name: "Equipar" }).click();
  await expect(vitrine(page).locator(".it-aviso")).toContainText("ainda não foi liberado");
  await expect(item(page, "reacao-coroa").locator(".it-estado")).toHaveText("Desbloqueado");
  expect(banco.linha).toEqual({});
});

test("OUTRO APARELHO da mesma conta lê a mesma escolha (o baralho chega pelo banco, não pelo cache)", async ({ browser }) => {
  const banco = novoBanco(13, { moldura: "onix", baralho: "ouro-negro", reacoes: ["fogo"], toalha: "preta" });
  const ctx = await (browser as Browser).newContext();
  const page = await ctx.newPage();
  await abrirHome(page, banco, { celebrados: celebradosAte(13) });
  await expect(page.locator("html")).toHaveAttribute("data-baralho", "ouro-negro");
  await itensBtn(page).click();
  await expect(item(page, "moldura-onix").locator(".it-estado")).toHaveText("Equipado");
  await expect(item(page, "baralho-ouro-negro").locator(".it-estado")).toHaveText("Equipado");
  await expect(item(page, "mesa-preta").locator(".it-estado")).toHaveText("Em uso");
  await expect(item(page, "reacao-fogo").locator(".it-estado")).toHaveText("Equipado");
  await expect(item(page, "reacao-aplauso").locator(".it-estado")).toHaveText("🔒 Nível 14");
  await ctx.close();
});

test("SEM A MIGRAÇÃO no banco (nenhuma, ou só as partes 1–2): sem vitrine, sem celebração — a Home é a de antes", async ({ page }) => {
  for (const linha of [null, "antiga"] as const) {
    const p = await page.context().newPage();
    await abrirHome(p, novoBanco(6, linha));
    await p.waitForTimeout(1200);
    await expect(itensBtn(p)).toHaveCount(0);
    await expect(celebracao(p)).toHaveCount(0);
    await expect(p.locator(".hm-progresso")).toContainText("Nível6");
    await p.close();
  }
});

test("tudo cabe: o card com o botão de itens não vaza, e a vitrine fica inteira na tela (com rolagem própria)", async ({ page }, ti) => {
  const banco = novoBanco(10, { moldura: "rubi" });
  await abrirHome(page, banco, { celebrados: celebradosAte(10) });
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
  // cada botão é alcançável (rolando a vitrine) e tem alvo de dedo; nenhum item vaza para o lado
  for (const id of ["moldura-real", "baralho-safira", "mesa-esmeralda", "reacao-caveira"] as const) {
    const b = item(page, id).locator(".it-botao");
    await b.scrollIntoViewIfNeeded();
    const caixa = (await b.boundingBox())!;
    expect(caixa.y + caixa.height).toBeLessThanOrEqual(vp.height + 0.5);
    expect(caixa.height).toBeGreaterThanOrEqual(30);
  }
  const vazamLado = await vitrine(page).locator(".it-item").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(vazamLado, "item da vitrine vazando para o lado").toBe(0);
  if (process.env.KING_SHOTS) await page.screenshot({ path: `${process.env.KING_SHOTS}/itens-vitrine-${ti.project.name}.png` });
});

test("com MOVIMENTO REDUZIDO, a celebração diz tudo sem animar — e a moldura que gira fica parada", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await abrirHome(page, novoBanco(16));
  await expect(celebracao(page)).toBeVisible();
  await expect(celebracao(page).locator(".ni-titulo")).toHaveText("NOVO ITEM DESBLOQUEADO!");
  const animando = await celebracao(page).evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length);
  expect(animando).toBe(0);
});

// ═══════════════════ AS MESAS e a vitrine por categoria ═══════════════════

test("nível 3: a Vinho Imperial é desbloqueada, celebrada UMA vez, e o contador da Home diz 2/18", async ({ page }) => {
  const banco = novoBanco(3);
  await abrirHome(page, banco, { celebrados: ["moldura-real"] });
  await expect(celebracao(page)).toBeVisible();
  await expect(celebracao(page).locator(".ni-itens li > span:last-child")).toHaveText(["Vinho Imperial"]);
  await page.mouse.click(5, 5);
  await expect(celebracao(page)).toHaveCount(0, { timeout: 2_000 });
  await expect(itensBtn(page)).toHaveText(`👑 2/${TOTAL}`);
});

test("MESA equipável: a Azul Royal e a Preta Premium vão ao BANCO e valem na partida contra os bots; voltar à Noite Imperial também", async ({ page }, ti) => {
  const banco = novoBanco(12);
  await abrirHome(page, banco, { celebrados: celebradosAte(18) });
  for (const t of ["azul", "preta"]) {
    await page.goto("/");
    await itensBtn(page).click();
    await item(page, `mesa-${t}`).getByRole("button", { name: "Usar" }).click();
    await expect(item(page, `mesa-${t}`).locator(".it-estado")).toHaveText("Em uso");
    expect(banco.linha).toMatchObject({ toalha: t });
    await vitrine(page).getByRole("button", { name: "Voltar" }).click();
    await jogarContraOsBots(page);
    await expect(page.locator(".mesa")).toHaveAttribute("data-tema", t, { timeout: 20_000 });
    await expect(page.locator(".hand .card")).toHaveCount(13, { timeout: 20_000 });
    await maoParada(page);
    if (process.env.KING_SHOTS && ti.project.name === "852x393") await page.screenshot({ path: `${process.env.KING_SHOTS}/mesa-${t}-solo-${ti.project.name}.png` });
  }
  await page.goto("/");
  await itensBtn(page).click();
  await item(page, "mesa-imperial").getByRole("button", { name: "Usar" }).click();
  await expect(item(page, "mesa-imperial").locator(".it-estado")).toHaveText("Em uso");
  expect(banco.linha).toMatchObject({ toalha: "imperial" });
});

test("a RECUSA do banco na toalha aparece e a mesa não muda", async ({ page }) => {
  const banco = novoBanco(12);
  await abrirHome(page, banco, { celebrados: celebradosAte(18) });
  await itensBtn(page).click();
  banco.recusarProximo = true;
  await item(page, "mesa-preta").getByRole("button", { name: "Usar" }).click();
  await expect(vitrine(page).locator(".it-aviso")).toContainText("ainda não foi liberado");
  await expect(item(page, "mesa-imperial").locator(".it-estado")).toHaveText("Em uso");
  expect(banco.linha).toEqual({});
});

test("a vitrine é organizada por CATEGORIA, aponta o PRÓXIMO desbloqueio e cabe na tela (rolando por dentro)", async ({ page }, ti) => {
  const banco = novoBanco(6, { moldura: "real", baralho: "imperial" });
  await abrirHome(page, banco, { celebrados: celebradosAte(18) });
  await itensBtn(page).click();
  await expect(vitrine(page).locator(".it-cat-titulo")).toHaveText(["Molduras", "Baralhos", "Mesas", "Reações"]);
  await expect(vitrine(page).locator(".it-proximo")).toHaveText("Próximo: Moldura Rubi Real no nível 7");
  await expect(vitrine(page).locator(".sub")).toContainText(`5 de ${TOTAL}`);
  const vp = page.viewportSize()!;
  const v = (await vitrine(page).boundingBox())!;
  expect(v.y).toBeGreaterThanOrEqual(0);
  expect(v.y + v.height, "a vitrine passou da tela").toBeLessThanOrEqual(vp.height + 0.5);
  await expect(vitrine(page).getByRole("button", { name: "Voltar" })).toBeInViewport();
  await expect(vitrine(page).locator("#it-titulo")).toBeInViewport();
  await item(page, "reacao-aplauso").scrollIntoViewIfNeeded();
  await expect(item(page, "reacao-aplauso")).toBeInViewport();
  const lateral = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(lateral).toBeLessThanOrEqual(0);
  if (process.env.KING_SHOTS) {
    for (const [sec, nome] of [["cat-moldura", "molduras"], ["cat-baralho", "baralhos"], ["cat-mesa", "mesas"], ["cat-reacao", "reacoes"]] as const) {
      await vitrine(page).locator(`.${sec}`).evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${process.env.KING_SHOTS}/vitrine-${nome}-${ti.project.name}.png` });
    }
  }
});
