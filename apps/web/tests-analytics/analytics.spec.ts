/**
 * O ANALYTICS PELO CAMINHO REAL — SDK do PostHog baixado sob demanda, init, before_send, envio —
 * contra um host FICTÍCIO (`https://ph.king-e2e.test`) cuja rede é interceptada aqui. Nenhum byte
 * sai para a internet, e nenhum projeto PostHog é tocado.
 *
 * Prova, lendo o que DE FATO sairia pela rede (o corpo de cada envio, descomprimido):
 *   - a abertura: `app_open` anônimo, com tráfego de TESTE, sem URL, sem referrer, sem pessoa;
 *   - que nada além do envio de eventos acontece: sem `/flags`, sem script de terceiros, sem
 *     gravação de sessão, sem `$pageview` — e nenhum host além do nosso e do fictício;
 *   - `first_match_started` UMA vez por instalação, mesmo recarregando;
 *   - partida local até o fim: `match_finished` com modo, posição e empate; revanche; e o
 *     compartilhamento do resultado medido pelo método, nunca pelo texto;
 *   - partida online com 2 humanos + 2 bots: sala criada, código copiado, sala entrada, partida
 *     começada — e um reload no meio que NÃO conta a partida de novo;
 *   - PostHog bloqueado (adblock) ou o pedaço do SDK que não chega: o jogo segue igual.
 *
 * O próprio SDK descarta tudo que vem de navegador automatizado: `navigator.webdriver` ligado OU
 * user agent "HeadlessChrome" (um teste abaixo prova isso). Por isso os testes que precisam VER
 * eventos abrem o contexto com um user agent de Chrome comum e o `webdriver` desligado. O
 * tráfego continua sendo de teste pelo build (`VITE_KING_TRAFEGO=test`) — que é justamente o que
 * se quer provar: mesmo que a automação escape do filtro do SDK, ela chega marcada.
 */
import { gunzipSync } from "node:zlib";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ESQUEMA, ESQUEMA_DO_CONTEXTO, EVENTOS } from "../src/analytics/analytics.js";
import { PROPRIEDADES_DO_SDK } from "../src/analytics/posthogSdk.js";
import { SEL, iniciarPartidaLocal } from "../tests/helpers/mesa.js";
import { criarSala, entrarNaSala } from "../tests/helpers/multiplayer.js";

const HOST = "https://ph.king-e2e.test";
const NOSSA_ORIGEM = "http://localhost:4175";
/** O servidor do JOGO (matchmaking do Colyseus por HTTP, depois WebSocket). Não é analytics. */
const SERVIDOR_DO_JOGO = "http://localhost:2568";

interface EventoCapturado {
  event: string;
  properties: Record<string, unknown>;
  [k: string]: unknown;
}

interface Rede {
  eventos: EventoCapturado[];
  corpos: string[];
  caminhos: string[];
  externos: string[];
}

/** Descomprime o corpo como o PostHog receberia: gzip, base64 em formulário ou JSON puro. */
function decodificar(buf: Buffer): { texto: string; eventos: EventoCapturado[] } {
  let texto = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  if (texto.startsWith("data=")) texto = Buffer.from(decodeURIComponent(texto.slice(5)), "base64").toString("utf8");
  const j = JSON.parse(texto) as unknown;
  const lista = Array.isArray(j) ? j : ((j as { batch?: unknown[] }).batch ?? [j]);
  return { texto, eventos: lista as EventoCapturado[] };
}

/**
 * Abre um CONTEXTO (todas as páginas dele): sem áudio, sem tutorial, com cara de navegador de
 * gente (a menos que `automatizado`), e o PostHog fictício interceptado — respondendo, bloqueado
 * ou fora do ar.
 */
async function novoContexto(
  browser: Browser,
  opcoes: { automatizado?: boolean; posthog?: "ok" | "bloqueado" | "fora" } = {},
): Promise<{ ctx: BrowserContext; rede: Rede }> {
  const versao = browser.version().split(".")[0];
  const ctx = await browser.newContext(opcoes.automatizado ? {} : {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${versao}.0.0.0 Safari/537.36`,
  });
  return { ctx, rede: await prepararContexto(ctx, { webdriver: opcoes.automatizado ?? false, posthog: opcoes.posthog }) };
}

async function prepararContexto(ctx: BrowserContext, opcoes: { webdriver: boolean; posthog?: "ok" | "bloqueado" | "fora" }): Promise<Rede> {
  const rede: Rede = { eventos: [], corpos: [], caminhos: [], externos: [] };
  await ctx.addInitScript((webdriver) => {
    try {
      window.localStorage.setItem("king.audio", JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial", JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* segue */ }
    if (!webdriver) {
      Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true });
      // As "marcas" do navegador também denunciam o headless; sem elas, vale o user agent comum.
      Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => undefined, configurable: true });
    }
  }, opcoes.webdriver);
  ctx.on("request", (req) => {
    const u = new URL(req.url());
    if (![NOSSA_ORIGEM, HOST, SERVIDOR_DO_JOGO].includes(u.origin) && !u.protocol.startsWith("ws") && u.protocol !== "data:") rede.externos.push(u.origin);
  });
  await ctx.route(`${HOST}/**`, async (route) => {
    const req = route.request();
    rede.caminhos.push(`${req.method()} ${new URL(req.url()).pathname}`);
    if (opcoes.posthog === "bloqueado") return route.abort("blockedbyclient");
    if (opcoes.posthog === "fora") return route.fulfill({ status: 503, body: "" });
    const corpo = req.postDataBuffer();
    if (corpo) {
      const { texto, eventos } = decodificar(corpo);
      rede.corpos.push(texto);
      rede.eventos.push(...eventos);
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"status":1}' });
  });
  return rede;
}

const contar = (rede: Rede, nome: string) => rede.eventos.filter((e) => e.event === nome).length;
const ultimo = (rede: Rede, nome: string) => [...rede.eventos].reverse().find((e) => e.event === nome);

/** As chaves que PODEM aparecer num evento que sai: as técnicas do SDK, o contexto e o esquema. */
function chavesPermitidas(evento: string): Set<string> {
  return new Set<string>([
    ...PROPRIEDADES_DO_SDK,
    "$process_person_profile",
    "$geoip_disable",
    ...Object.keys(ESQUEMA_DO_CONTEXTO),
    ...Object.keys((ESQUEMA as Record<string, object>)[evento] ?? {}),
  ]);
}

/** O que vale para TODO evento que saiu, em qualquer teste. */
function conferirTudoQueSaiu(rede: Rede, proibidos: string[] = []) {
  expect(rede.externos, "nenhum host além do nosso, do servidor do jogo e do PostHog fictício").toEqual([]);
  for (const c of rede.caminhos) expect(c, "só envio de evento: sem /flags, sem script, sem gravação").toMatch(/^POST \/(e|i\/v0\/e|batch|capture)\/?$/);
  for (const ev of rede.eventos) {
    expect(EVENTOS as readonly string[], `evento que não é do KING saiu: ${ev.event}`).toContain(ev.event);
    for (const k of Object.keys(ev.properties)) expect(chavesPermitidas(ev.event).has(k), `${ev.event}.${k}`).toBe(true);
    expect(ev.properties.$process_person_profile, "nenhum perfil de pessoa").toBe(false);
    expect(ev.properties.$geoip_disable, "GeoIP desligado em todo evento").toBe(true);
    expect(Object.keys(ev.properties).filter((k) => /geoip|latitude|longitude|postal|city|timezone|^\$ip$/i.test(k)), "nenhuma localização").toEqual(["$geoip_disable"]);
    expect(ev.properties.traffic_type, "e2e é tráfego de TESTE").toBe("test");
    expect(ev.properties.platform).toBe("web");
    expect(ev).not.toHaveProperty("$set");
    expect(ev).not.toHaveProperty("$set_once");
  }
  const tudo = rede.corpos.join("\n");
  for (const p of proibidos) expect(tudo, `"${p}" escapou para a rede`).not.toContain(p);
  expect(tudo).not.toMatch(/\$current_url|\$referrer|\$pathname|\$initial_|localhost:4175/);
}

test("a abertura: app_open anônimo, de teste, sem URL, sem referrer, sem pessoa", async ({ browser }) => {
  const { ctx, rede } = await novoContexto(browser);
  const page = await ctx.newPage();
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(String(e)));

  await page.goto("/?utm_source=Instagram&utm_medium=social&utm_campaign=Promo%C3%A7%C3%A3o%20de%20Ver%C3%A3o&utm_content=0315&nick=Tito&fbclid=IwAR0abc123&email=tito%40example.com");
  await expect(page.locator(SEL.startBtn)).toBeVisible();
  await expect.poll(() => contar(rede, "app_open"), { timeout: 15_000 }).toBe(1);

  const p = ultimo(rede, "app_open")!.properties;
  expect(p).toMatchObject({
    first_open: true, utm_source: "instagram", utm_medium: "social", utm_campaign: "promocao_de_verao",
    first_utm_source: "instagram", first_utm_campaign: "promocao_de_verao",
    environment: "development", traffic_type: "test", platform: "web",
  });
  expect(p, "utm_content só de dígitos tem cara de código de sala").not.toHaveProperty("utm_content");
  expect(typeof p.distinct_id).toBe("string");
  expect(typeof p.$session_id).toBe("string");

  // Um tempo a mais: nada de $pageview, $pageleave, autocapture ou web vitals chega depois.
  await page.locator(".home").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(2500);
  expect(rede.eventos.map((e) => e.event)).toEqual(["app_open"]);
  conferirTudoQueSaiu(rede, ["Tito", "0315", "IwAR0abc123", "tito@example.com", "Promoção", "fbclid", "nick"]);

  // O QUE FICA NO APARELHO: o SDK guarda a URL de entrada nas propriedades da sessão. Não sai (o
  // before_send derruba), mas nem gravada ela carrega apelido, e-mail ou id de clique.
  const guardado = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ph_")).map((k) => localStorage.getItem(k)).join("\n"));
  expect(guardado, "o SDK guardou alguma coisa").toContain("distinct_id");
  for (const p of ["Tito", "tito%40example.com", "tito@example.com", "IwAR0abc123"]) expect(guardado, p).not.toContain(p);
  expect(erros).toEqual([]);
  await ctx.close();
});

test("first_match_started sai UMA vez por instalação — mesmo recarregando", async ({ browser }) => {
  const { ctx, rede } = await novoContexto(browser);
  const page = await ctx.newPage();

  await page.goto("/?seed=42&mao=10");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => contar(rede, "first_match_started"), { timeout: 15_000 }).toBe(1);
  expect(ultimo(rede, "match_started")!.properties).toMatchObject({ modo: "local", humanos: 1, bots: 3 });
  expect(ultimo(rede, "first_match_started")!.properties).toMatchObject({ modo: "local" });

  await page.reload();
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => contar(rede, "match_started"), { timeout: 15_000 }).toBe(2);
  await page.waitForTimeout(1500);
  expect(contar(rede, "first_match_started"), "a segunda partida não é a primeira").toBe(1);
  expect(rede.eventos.filter((e) => e.event === "app_open").map((e) => e.properties.first_open)).toEqual([true, false]);
  conferirTudoQueSaiu(rede);
  await ctx.close();
});

/** Joga a mão 10 até o placar final e espera a encenação terminar. */
async function jogarAteOFim(page: Page): Promise<void> {
  await page.goto("/?seed=42&mao=10");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  const anuncio = page.locator(".um");
  if (await anuncio.count()) await anuncio.click().catch(() => {});
  for (let i = 0; i < 400 && !(await page.locator(".fim").count()); i++) {
    const trunfo = page.locator(".trumpbtn").first();
    if (await trunfo.count()) { await trunfo.click({ timeout: 5000 }).catch(() => {}); continue; }
    const carta = page.locator(SEL.handCardLegal).first();
    if (await carta.count()) {
      await carta.click({ timeout: 5000 }).catch(() => {});
      if (await page.locator(SEL.handCardSelected).count()) await page.locator(SEL.handCardSelected).first().click({ timeout: 5000 }).catch(() => {});
      continue;
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator(".fim")).toBeVisible({ timeout: 20_000 });
  await page.locator(".fim").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await expect(page.locator(".fimacoes")).toBeVisible({ timeout: 20_000 });
}

test("partida local até o fim: match_finished, compartilhar pelo método e revanche", async ({ browser }) => {
  const { ctx, rede } = await novoContexto(browser);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: NOSSA_ORIGEM });
  const page = await ctx.newPage();

  await jogarAteOFim(page);
  await expect.poll(() => contar(rede, "match_finished"), { timeout: 15_000 }).toBe(1);
  const fim = ultimo(rede, "match_finished")!.properties;
  expect(fim.modo).toBe("local");
  expect([1, 2, 3, 4]).toContain(fim.posicao);
  expect(typeof fim.empate).toBe("boolean");

  const compartilhar = page.locator(".fimacoes button", { hasText: /compartilhar/i });

  // 1) sem folha do sistema: vai para a área de transferência
  await page.evaluate(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
  await compartilhar.click();
  await expect.poll(() => contar(rede, "result_shared"), { timeout: 10_000 }).toBe(1);
  expect(ultimo(rede, "result_shared")!.properties.method).toBe("clipboard");

  // 2) folha do sistema que conclui
  await page.waitForTimeout(2400); // o aviso "Resultado copiado" volta a ser o botão
  await page.evaluate(() => { Object.defineProperty(navigator, "share", { value: async () => {}, configurable: true }); });
  await compartilhar.click();
  await expect.poll(() => contar(rede, "result_shared"), { timeout: 10_000 }).toBe(2);
  expect(ultimo(rede, "result_shared")!.properties.method).toBe("native_share");

  // 3) desistir da folha NÃO é compartilhar
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { value: async () => { throw new DOMException("cancelou", "AbortError"); }, configurable: true });
  });
  await compartilhar.click();
  await page.waitForTimeout(1500);
  expect(contar(rede, "result_shared")).toBe(2);

  const texto = await page.evaluate(() => navigator.clipboard.readText());
  expect(texto.length, "o texto compartilhado existe").toBeGreaterThan(10);
  expect(rede.corpos.join("\n"), "o texto compartilhado nunca vai para a medição").not.toContain(texto.slice(0, 20));

  await page.locator(".fimacoes .btn.gold").click();
  await expect.poll(() => contar(rede, "rematch_clicked"), { timeout: 10_000 }).toBe(1);
  expect(ultimo(rede, "rematch_clicked")!.properties).toMatchObject({ modo: "local", posicao: fim.posicao });
  await expect.poll(() => contar(rede, "match_started"), { timeout: 10_000 }).toBe(2);
  conferirTudoQueSaiu(rede);
  await ctx.close();
});

test("online, 2 humanos + 2 bots: sala, convite, partida — e o reload NÃO conta a partida de novo", async ({ browser }) => {
  const { ctx: ctxA, rede: redeA } = await novoContexto(browser);
  const { ctx: ctxB, rede: redeB } = await novoContexto(browser);
  await ctxA.grantPermissions(["clipboard-read", "clipboard-write"], { origin: NOSSA_ORIGEM });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  const codigo = await criarSala(a, "Tito", "Sapo");
  await a.locator(".sl-cod").click();
  await expect.poll(() => contar(redeA, "invite_code_copied"), { timeout: 10_000 }).toBe(1);
  await entrarNaSala(b, codigo, "Raiza", "Panda");

  await expect(a.locator(".sl-bot.add")).toHaveCount(2, { timeout: 20_000 });
  await a.locator(".sl-bot.add").first().click();
  await expect(a.locator(".sl-bot.add")).toHaveCount(1, { timeout: 20_000 });
  await a.locator(".sl-bot.add").first().click();
  await expect(a.locator(".sl-lugar.robo")).toHaveCount(2, { timeout: 20_000 });
  await a.getByRole("button", { name: /Estou pronto/ }).click();
  await b.getByRole("button", { name: /Estou pronto/ }).click();
  await expect(a.locator(".mesa")).toBeVisible({ timeout: 30_000 });
  await expect(b.locator(".mesa")).toBeVisible({ timeout: 30_000 });

  await expect.poll(() => contar(redeA, "match_started"), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => contar(redeB, "match_started"), { timeout: 15_000 }).toBe(1);
  expect(contar(redeA, "room_created")).toBe(1);
  expect(contar(redeA, "room_joined")).toBe(0);
  expect(contar(redeB, "room_joined")).toBe(1);
  expect(contar(redeB, "room_created")).toBe(0);
  for (const rede of [redeA, redeB]) {
    expect(ultimo(rede, "match_started")!.properties).toMatchObject({ modo: "online", humanos: 2, bots: 2 });
    // `first_match_started` sai numa requisição PRÓPRIA (`request_batching: false`), emitida logo
    // DEPOIS de `match_started`: ter visto um não garante ter visto o outro. Conferir na hora deu
    // `undefined` na CI 36933634241 (852×393), e atrasar só essa requisição em 400 ms reproduz a
    // falha toda vez. Espera-se pelo evento — exatamente UM — antes de conferir o que ele traz.
    await expect.poll(() => contar(rede, "first_match_started"), { timeout: 15_000 }).toBe(1);
    expect(ultimo(rede, "first_match_started")!.properties).toMatchObject({ modo: "online" });
  }

  // RELOAD NO MEIO DA PARTIDA: a Home oferece voltar, a Mesa remonta, o servidor manda o estado
  // de novo — e a partida continua sendo UMA.
  await b.reload();
  await b.getByRole("button", { name: "Jogar com amigos" }).click();
  await b.getByRole("button", { name: /voltar para a minha sala/i }).click();
  await expect(b.locator(".mesa")).toBeVisible({ timeout: 30_000 });
  await b.waitForTimeout(2500);
  expect(contar(redeB, "match_started"), "a mesma partida não conta duas vezes").toBe(1);
  expect(contar(redeB, "first_match_started")).toBe(1);
  expect(contar(redeB, "app_open")).toBe(2);
  expect(contar(redeB, "room_joined"), "voltar para a própria sala não é entrar numa nova").toBe(1);

  conferirTudoQueSaiu(redeA, ["Tito", "Raiza", codigo]);
  conferirTudoQueSaiu(redeB, ["Tito", "Raiza", codigo]);
  await ctxA.close();
  await ctxB.close();
});

for (const cenario of ["bloqueado", "fora"] as const) {
  test(`PostHog ${cenario === "bloqueado" ? "bloqueado por adblock" : "fora do ar"}: o jogo segue igual`, async ({ browser }) => {
    const { ctx, rede } = await novoContexto(browser, { posthog: cenario });
    const page = await ctx.newPage();
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(String(e)));

    await page.goto("/?seed=42&mao=10");
    await iniciarPartidaLocal(page);
    await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
    const anuncio = page.locator(".um");
    if (await anuncio.count()) await anuncio.click().catch(() => {});
    await expect(page.locator(SEL.handCardLegal).first()).toBeVisible({ timeout: 20_000 });
    const antes = await page.locator(SEL.handCard).count();
    await page.locator(SEL.handCardLegal).first().click();
    if (await page.locator(SEL.handCardSelected).count()) await page.locator(SEL.handCardSelected).first().click();
    await expect.poll(() => page.locator(SEL.handCard).count(), { timeout: 10_000 }).toBeLessThan(antes);
    expect(rede.caminhos.length, "o SDK tentou enviar").toBeGreaterThan(0);
    expect(erros).toEqual([]);
    await ctx.close();
  });
}

test("PostHog bloqueado nos DOIS aparelhos: o multiplayer cria sala, recebe amigo e começa a partida", async ({ browser }) => {
  const { ctx: ctxA, rede: redeA } = await novoContexto(browser, { posthog: "bloqueado" });
  const { ctx: ctxB, rede: redeB } = await novoContexto(browser, { posthog: "bloqueado" });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const erros: string[] = [];
  for (const p of [a, b]) p.on("pageerror", (e) => erros.push(String(e)));

  const codigo = await criarSala(a, "Tito", "Sapo");
  await entrarNaSala(b, codigo, "Raiza", "Panda");
  await expect(a.locator(".sl-bot.add")).toHaveCount(2, { timeout: 20_000 });
  await a.locator(".sl-bot.add").first().click();
  await expect(a.locator(".sl-bot.add")).toHaveCount(1, { timeout: 20_000 });
  await a.locator(".sl-bot.add").first().click();
  await expect(a.locator(".sl-lugar.robo")).toHaveCount(2, { timeout: 20_000 });
  await a.getByRole("button", { name: /Estou pronto/ }).click();
  await b.getByRole("button", { name: /Estou pronto/ }).click();
  await expect(a.locator(".mesa")).toBeVisible({ timeout: 30_000 });
  await expect(b.locator(".mesa")).toBeVisible({ timeout: 30_000 });

  expect(redeA.caminhos.length + redeB.caminhos.length, "o SDK tentou enviar — e foi barrado").toBeGreaterThan(0);
  expect(redeA.eventos.length + redeB.eventos.length, "nada chegou ao PostHog").toBe(0);
  expect(erros).toEqual([]);
  await ctxA.close();
  await ctxB.close();
});

test("o pedaço do SDK não chega: o jogo segue e nada é enviado", async ({ browser }) => {
  const { ctx, rede } = await novoContexto(browser);
  await ctx.route(/\/assets\/posthogSdk-[^/]+\.js$/, (route) => route.abort("blockedbyclient"));
  const page = await ctx.newPage();
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(String(e)));

  await page.goto("/?seed=42&mao=10");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  expect(rede.caminhos).toEqual([]);
  expect(erros).toEqual([]);
  await ctx.close();
});

test("navegador automatizado (webdriver + HeadlessChrome): o próprio SDK descarta — automação nunca vira dado", async ({ browser }) => {
  const { ctx, rede } = await novoContexto(browser, { automatizado: true });
  const page = await ctx.newPage();
  await page.goto("/?seed=42&mao=10");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => navigator.webdriver)).toBe(true);
  expect(rede.eventos, "nenhum evento de navegador automatizado").toEqual([]);
  await ctx.close();
});

// ═══════════════════════════════ CONVITE POR LINK (Fase 7) ═══════════════════════════════
//
// O convidado abre EXATAMENTE o link que o anfitrião mandou — o domínio público, servido aqui pelo
// build local —, e nada entra sozinho: nenhum pedido ao servidor do jogo antes do toque em "Entrar
// na sala". E o código da sala, que é a chave dela, não aparece em evento nenhum nem no que o
// analytics guarda no aparelho.

const ORIGEM_PUBLICA = "https://playkingcards.com.br";
const CHAMADA = "Vem jogar KING comigo 👑\nEntre na minha sala:";

/** O domínio público, servido pelo build local: o link do convite é aberto tal como foi mandado. */
async function servirComoProducao(ctx: BrowserContext): Promise<void> {
  await ctx.route(`${ORIGEM_PUBLICA}/**`, async (route) => {
    const u = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: `${NOSSA_ORIGEM}${u.pathname}${u.search}` }) });
  });
}

/** Tudo que a página pede ao servidor do JOGO (matchmaking por HTTP e WebSocket). */
function vigiarServidorDoJogo(page: Page): string[] {
  const pedidos: string[] = [];
  page.on("websocket", (ws) => pedidos.push(ws.url()));
  page.on("request", (r) => { if (r.url().startsWith(SERVIDOR_DO_JOGO)) pedidos.push(r.url()); });
  return pedidos;
}

/**
 * Onde o código seria vazamento: um valor IGUAL a ele, ou "sala=" em qualquer texto. Procurar os
 * quatro dígitos soltos daria falso positivo em carimbo de tempo e uuid; igualdade não dá.
 */
function vazamentosDoCodigo(valor: unknown, codigo: string, caminho = "$"): string[] {
  if (typeof valor === "string") return valor === codigo || valor.includes("sala=") ? [caminho] : [];
  if (typeof valor === "number") return String(valor) === codigo ? [caminho] : [];
  if (Array.isArray(valor)) return valor.flatMap((v, i) => vazamentosDoCodigo(v, codigo, `${caminho}[${i}]`));
  if (valor && typeof valor === "object") {
    return Object.entries(valor).flatMap(([k, v]) => [
      ...(k === codigo ? [`${caminho}.${k}`] : []), ...vazamentosDoCodigo(v, codigo, `${caminho}.${k}`),
    ]);
  }
  return [];
}

/** O que o ANALYTICS guarda no aparelho (PostHog e o nosso estado). A recuperação da sala é do jogo. */
async function guardadoPeloAnalytics(page: Page): Promise<Array<[string, unknown]>> {
  const itens = await page.evaluate(() => [localStorage, sessionStorage].flatMap((s) =>
    Object.keys(s).filter((k) => /^ph_|analytics|posthog/i.test(k)).map((k) => [k, s.getItem(k) ?? ""] as [string, string])));
  return itens.map(([k, v]) => { try { return [k, JSON.parse(v)]; } catch { return [k, v]; } });
}

const entrarComAvatar = async (page: Page, apelido: string) => {
  await page.locator(".hm-online input").first().fill(apelido);
  await page.getByRole("button", { name: "Entrar na sala" }).click();
  await page.locator('.hm-avdialogo .hm-av[aria-label="Panda"]').click();
};

test("convite por link: o convidado abre o link, NADA entra sozinho, e o código não vai para o PostHog", async ({ browser }) => {
  const { ctx: ctxA, rede: redeA } = await novoContexto(browser);
  const { ctx: ctxB, rede: redeB } = await novoContexto(browser);
  // A folha de compartilhar do anfitrião (headless não tem): registra o que seria mandado.
  await ctxA.addInitScript(() => {
    const w = window as unknown as { __folha: unknown[]; __folhaRecusa?: boolean };
    w.__folha = [];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (d: unknown) => {
        if (w.__folhaRecusa) throw Object.assign(new Error("recusou"), { name: "NotAllowedError" });
        w.__folha.push(d);
      },
    });
  });
  await ctxA.grantPermissions(["clipboard-read", "clipboard-write"], { origin: NOSSA_ORIGEM });
  const a = await ctxA.newPage();
  const codigo = await criarSala(a, "Tito", "Sapo");
  const link = `${ORIGEM_PUBLICA}/?sala=${codigo}`;

  // 1. Com folha: o link no campo url, o texto sem ele — e nenhum evento (não há evento de compartilhar).
  await a.locator(".sl-convidar").click();
  await expect(a.locator(".sl-convidar")).toHaveText("Enviado ✓");
  expect(await a.evaluate(() => (window as unknown as { __folha: unknown[] }).__folha))
    .toEqual([{ title: "KING", text: CHAMADA, url: link }]);
  // 2. Folha recusada: copia o texto inteiro, e SÓ AÍ conta invite_code_copied.
  await a.evaluate(() => { (window as unknown as { __folhaRecusa: boolean }).__folhaRecusa = true; });
  await a.locator(".sl-convidar").click();
  await expect(a.locator(".sl-convidar")).toHaveText("Copiado ✓");
  // No Windows a área de transferência devolve CRLF; o texto é o mesmo.
  expect((await a.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(`${CHAMADA}\n${link}`);
  await expect.poll(() => contar(redeA, "invite_code_copied"), { timeout: 10_000 }).toBe(1);

  // 3. O convidado abre o link: o MESMO caminho e parâmetro, no build local. (O domínio público
  //    servido daqui fica para o teste sem servidor, abaixo: o Chrome não deixa um site público
  //    falar com o servidor do jogo em localhost — Private Network Access.)
  const b = await ctxB.newPage();
  const doJogo = vigiarServidorDoJogo(b);
  const aberto = `${NOSSA_ORIGEM}${new URL(link).pathname}${new URL(link).search}`;
  await b.goto(aberto);
  await expect(b.locator(".hm-online")).toBeVisible({ timeout: 15_000 });
  await expect(b.locator(".hm-online input").last()).toHaveValue(codigo);
  await expect.poll(() => b.url(), { message: "a barra continuou com o código" }).toBe(`${NOSSA_ORIGEM}/`);
  expect(await b.evaluate(() => performance.getEntriesByType("navigation")[0].name), "a barra foi limpa SEM recarregar").toBe(aberto);
  await expect(b.getByRole("button", { name: "Entrar na sala" })).toBeFocused();

  // 4. NADA ENTROU: nenhum pedido ao servidor do jogo, e o anfitrião continua sozinho na sala.
  await b.waitForTimeout(1500);
  expect(doJogo, "abrir o link conectou ao servidor do jogo").toEqual([]);
  await expect(a.locator(".sl-lugar:not(.vago)")).toHaveCount(1);

  // 5. Só o toque entra — e o anfitrião vê o convidado chegar.
  await entrarComAvatar(b, "Raiza");
  await expect(b.locator(".sl-lugares")).toBeVisible({ timeout: 20_000 });
  await expect(a.locator(".sl-lugar:not(.vago)")).toHaveCount(2, { timeout: 20_000 });
  await expect.poll(() => contar(redeB, "room_joined"), { timeout: 15_000 }).toBe(1);

  // 6. PRIVACIDADE: o código em nenhum evento, nem na barra, nem no que o analytics guarda.
  for (const rede of [redeA, redeB]) {
    rede.externos.splice(0, rede.externos.length, ...rede.externos.filter((o) => o !== ORIGEM_PUBLICA));
    conferirTudoQueSaiu(rede, ["sala=", "playkingcards"]);
    expect(vazamentosDoCodigo(rede.eventos, codigo), "o código da sala apareceu num evento").toEqual([]);
  }
  expect(b.url()).not.toContain(codigo);
  for (const pagina of [a, b]) {
    for (const [chave, valor] of await guardadoPeloAnalytics(pagina)) {
      expect(vazamentosDoCodigo(valor, codigo), `${chave} guardou o código`).toEqual([]);
    }
  }
  await ctxA.close();
  await ctxB.close();
});

test("convite por link: link malformado, sala que enche no caminho e sala encerrada", async ({ browser }) => {
  const { ctx: ctxA } = await novoContexto(browser);
  const { ctx: ctxB } = await novoContexto(browser);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const doJogo = vigiarServidorDoJogo(b);

  // MALFORMADO: a barra é limpa, o painel abre com o aviso e nada conecta.
  await b.goto(`${NOSSA_ORIGEM}/?sala=12ab`);
  await expect(b.locator(".hm-aviso-convite")).toHaveText("Esse link de convite não é válido. Digite o código da sala.");
  await expect(b.locator(".hm-online input").last()).toHaveValue("");
  await expect.poll(() => b.url()).toBe(`${NOSSA_ORIGEM}/`);
  expect(doJogo).toEqual([]);

  // A SALA ENCHE entre abrir o link e tocar: a recusa volta para o painel, com o motivo, o apelido
  // e o código mantidos — e nada girando.
  const codigo = await criarSala(a, "Tito", "Sapo");
  await b.goto(`${NOSSA_ORIGEM}/?sala=${codigo}`);
  await expect(b.locator(".hm-online input").last()).toHaveValue(codigo);
  for (let i = 1; i <= 3; i++) {
    await a.locator(".sl-bot.add").first().click();
    await expect(a.locator(".sl-lugar.robo")).toHaveCount(i, { timeout: 20_000 });
  }
  await entrarComAvatar(b, "Raiza");
  await expect(b.locator(".hm-aviso-convite")).toHaveText("Essa sala já tem quatro jogadores.", { timeout: 20_000 });
  await expect(b.locator(".hm-online input").first()).toHaveValue("Raiza");
  await expect(b.locator(".hm-online input").last()).toHaveValue(codigo);
  await expect(b.getByRole("button", { name: "Entrar na sala" })).toBeEnabled();

  // ENCERRADA: o anfitrião sai e a sala acaba; tentar de novo diz que ela não existe.
  await a.getByRole("button", { name: "Sair" }).click();
  await expect(a.getByRole("button", { name: "Jogar com amigos" })).toBeVisible({ timeout: 15_000 });
  await a.waitForTimeout(1000);
  await b.getByRole("button", { name: "Entrar na sala" }).click();
  await b.locator('.hm-avdialogo .hm-av[aria-label="Panda"]').click();
  await expect(b.locator(".hm-aviso-convite")).toHaveText("Sala não encontrada. Confira o código.", { timeout: 20_000 });
  await expect(b.locator(".hm-online input").first()).toHaveValue("Raiza");
  await ctxA.close();
  await ctxB.close();
});

test("convite por link: recarregar, voltar e duas abas nunca entram sozinhos", async ({ browser }) => {
  const { ctx } = await novoContexto(browser);
  await servirComoProducao(ctx);
  const link = `${ORIGEM_PUBLICA}/?sala=4821`;
  const p1 = await ctx.newPage();
  const p2 = await ctx.newPage();
  const doJogo = vigiarServidorDoJogo(p1);
  const doJogo2 = vigiarServidorDoJogo(p2);

  // O MESMO LINK EM DUAS ABAS: as duas preenchem, nenhuma entra.
  await p1.goto(link);
  await p2.goto(link);
  for (const p of [p1, p2]) {
    await expect(p.locator(".hm-online input").last()).toHaveValue("4821");
    await expect.poll(() => p.url()).toBe(`${ORIGEM_PUBLICA}/`);
  }

  // RECARREGAR: a barra já está limpa — volta a Home de sempre, sem painel e sem convite.
  await p1.reload();
  await expect(p1.getByRole("button", { name: "Jogar com amigos" })).toBeVisible();
  await expect(p1.locator(".hm-online")).toHaveCount(0);

  // VOLTAR E AVANÇAR: o link não reaparece na barra, e nada conecta.
  await p2.goBack();
  await p2.goForward();
  await expect.poll(() => p2.url()).toBe(`${ORIGEM_PUBLICA}/`);
  await p2.waitForTimeout(1500);
  expect([...doJogo, ...doJogo2], "algum caminho conectou ao servidor do jogo sem toque").toEqual([]);
  await ctx.close();
});
