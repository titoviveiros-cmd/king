/**
 * MULTIPLAYER NO APP ANDROID (ponte nativa simulada) — o defeito do AAB 0.1.0 vc1.
 *
 * Relato do 1º teste físico: "Jogar com amigos → Criar sala" ficava em "CONECTANDO…", os quatro
 * assentos em "Aguardando…", e nem o criador aparecia como anfitrião. Causa: o cofre da sessão nunca
 * ficava pronto no Android (o plugin do Capacitor tratado como promessa — ver
 * `src/nativo/cofreNativo.test.ts`), e `conectar()` esperava sem prazo.
 *
 * O bundle aqui é o do app (identidade + servidor); antes do primeiro script da página, entra a
 * ponte que o Capacitor do Android injeta no WebView, com o lado nativo dos plugins em memória. O
 * Supabase é fictício (interceptado), e o servidor é o Colyseus local. Medem-se as etapas na ordem:
 * credencial (cofre + convidado) → matchmaking → socket → estado da sala → anfitrião.
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const SUPABASE = "https://abcdefghijklmnopqrst.supabase.co";

/** A ponte do Capacitor no Android, como o WebView a entrega: antes de qualquer script do app. */
async function instalarPonteAndroid(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const cofre = new Map<string, string>();
    const chamadas: string[] = [];
    w.__ponte = { chamadas, cofre };
    const prom = (n: string) => ({ name: n, rtype: "promise" });
    w.androidBridge = { postMessage() {} };
    w.Capacitor = {
      // O que a native-bridge.js do Capacitor expõe ANTES do core: o app decide "sou nativo" por aqui.
      isNativePlatform: () => true,
      getPlatform: () => "android",
      PluginHeaders: [
        {
          name: "SecureStorage",
          methods: ["setSynchronizeKeychain", "internalGetItem", "internalSetItem", "internalRemoveItem",
            "internalClearItemsWithPrefix", "internalGetPrefixedKeys"].map(prom),
        },
        { name: "App", methods: ["getLaunchUrl", "exitApp", "getInfo", "getState", "minimizeApp"].map(prom).concat([{ name: "addListener", rtype: "callback" }, { name: "removeListener", rtype: "promise" }]) },
        { name: "SocialLogin", methods: ["initialize", "login", "logout", "isLoggedIn"].map(prom) },
      ],
      nativePromise: async (plugin: string, metodo: string, op: Record<string, unknown> = {}) => {
        chamadas.push(`${plugin}.${metodo}`);
        const chave = String(op.prefixedKey ?? "");
        if (plugin === "SecureStorage") {
          if (metodo === "internalGetItem") return { data: cofre.get(chave) ?? null };
          if (metodo === "internalSetItem") { cofre.set(chave, String(op.data)); return undefined; }
          if (metodo === "internalRemoveItem") return { success: cofre.delete(chave) };
          if (metodo === "internalGetPrefixedKeys") return { keys: [...cofre.keys()] };
          if (metodo === "internalClearItemsWithPrefix") { cofre.clear(); return undefined; }
          return undefined;
        }
        if (plugin === "App" && metodo === "getLaunchUrl") return { url: "" };
        return undefined;
      },
      nativeCallback: (plugin: string, metodo: string) => { chamadas.push(`${plugin}.${metodo}`); return String(Math.random()); },
    };
    try {
      localStorage.setItem("king.audio", JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      localStorage.setItem("king:tutorial", JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* sem storage */ }
  });
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** O Supabase fictício: cada aparelho ganha UM convidado. Registra o que foi pedido. */
async function supabaseFicticio(ctx: BrowserContext, id: string, pedidos: string[]): Promise<void> {
  await ctx.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    pedidos.push(`${req.method()} ${new URL(req.url()).pathname}`);
    if (req.method() === "OPTIONS") return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } });
    if (/\/auth\/v1\/signup$/.test(new URL(req.url()).pathname)) {
      const agora = Math.floor(Date.now() / 1000);
      const jwt = [b64url({ alg: "HS256", typ: "JWT" }), b64url({ sub: id, role: "authenticated", aud: "authenticated", exp: agora + 3600, is_anonymous: true }), "assinatura-ficticia"].join(".");
      return route.fulfill({
        status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ access_token: jwt, refresh_token: "ficticio", token_type: "bearer", expires_in: 3600, expires_at: agora + 3600,
          user: { id, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} } }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" });
  });
}

/**
 * NADA SAI DA MÁQUINA. Fora o Supabase fictício (interceptado acima) e o que roda aqui (preview e
 * servidor local), toda requisição HTTP é BARRADA e anotada — o teste reprova se a
 * lista não terminar vazia. É a garantia de que a CI nunca cria conta nem sala em Production, mesmo
 * que um dia o build ganhe outro endereço por engano.
 */
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);
const daqui = (u: URL) => LOCAL.has(u.hostname) || u.origin === SUPABASE || u.protocol === "data:" || u.protocol === "blob:";

async function isolar(ctx: BrowserContext, fora: string[]): Promise<void> {
  await ctx.route((u) => !daqui(u), (route) => { fora.push(route.request().url()); return route.abort("blockedbyclient"); });
  // Socket não tem rota: com `routeWebSocket` (só os de fora, ou todos com `connectToServer`) o
  // socket LOCAL do Colyseus ficou pendurado no Playwright 1.62. Não faz falta — no Colyseus o socket
  // só existe depois do matchmaking, que é HTTP e passa por aqui; e o Supabase fictício é o único
  // endereço de identidade do build.
}

async function aparelho(browser: import("@playwright/test").Browser, id: string) {
  const ctx = await browser.newContext();
  const pedidos: string[] = [];
  const fora: string[] = [];
  await isolar(ctx, fora);
  await instalarPonteAndroid(ctx);
  await supabaseFicticio(ctx, id, pedidos);
  const page = await ctx.newPage();
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  return { ctx, page, pedidos, erros, fora };
}

async function abrirPainel(page: Page) {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.())).toBe(true);
  await page.getByRole("button", { name: "Jogar com amigos" }).click();
  await expect(page.locator(".hm-online input").first()).toBeVisible({ timeout: 15_000 });
}

async function escolherAvatar(page: Page, avatar: string) {
  const dialogo = page.locator(".hm-avdialogo");
  await expect(dialogo).toBeVisible({ timeout: 10_000 });
  await page.locator(`.hm-avdialogo .hm-av[aria-label="${avatar}"]`).click();
  await expect(dialogo).toHaveCount(0, { timeout: 10_000 });
}

test("Android: criar sala sai do 'Conectando…' e mostra o anfitrião; 2º jogador, bots, pronto e partida", async ({ browser }) => {
  const a = await aparelho(browser, "11111111-1111-4111-8111-111111111111");
  const b = await aparelho(browser, "22222222-2222-4222-8222-222222222222");
  try {
    // ── ANFITRIÃO (as etapas, na ordem em que o vc1 travava) ──
    await abrirPainel(a.page);
    await a.page.locator(".hm-online input").first().fill("Tito");
    const t0 = Date.now();
    await a.page.getByRole("button", { name: "Criar uma sala" }).click();
    await escolherAvatar(a.page, "Sapo");

    // 1. credencial: o cofre nativo foi usado e o convidado nasceu UMA vez
    await expect.poll(() => a.pedidos.filter((p) => p.endsWith("/auth/v1/signup")).length, { timeout: 15_000 }).toBe(1);
    const chamadasA = await a.page.evaluate(() => (window as unknown as { __ponte: { chamadas: string[] } }).__ponte.chamadas);
    expect(chamadasA).toContain("SecureStorage.internalSetItem");
    // 2–4. matchmaking, socket e estado: o código da sala aparece (antes: nunca aparecia)
    const cod = a.page.locator(".sl-cod");
    await expect(cod).toBeVisible({ timeout: 15_000 });
    const codigo = /(\d{4})/.exec((await cod.textContent()) ?? "")?.[1];
    expect(codigo, "código de 4 dígitos").toBeTruthy();
    // 5. anfitrião: o próprio assento, com apelido, avatar e a marca de anfitrião
    const meu = a.page.locator(".sl-lugar.voce");
    await expect(meu).toContainText("Tito");
    await expect(meu).toContainText("anfitrião");
    await expect(meu.locator(".sl-av-troca")).toBeEnabled();
    await expect(a.page.locator(".sl-lb")).not.toHaveText(/Conectando/);
    console.log(`[medida] criar → anfitrião visível: ${Date.now() - t0} ms`);

    // ── 2º JOGADOR (outro aparelho Android) ──
    await abrirPainel(b.page);
    const campos = b.page.locator(".hm-online input");
    await campos.first().fill("Raiza");
    await campos.last().fill(codigo!);
    await b.page.getByRole("button", { name: "Entrar na sala" }).click();
    await escolherAvatar(b.page, "Panda");
    for (const p of [a.page, b.page]) {
      await expect(p.locator(".sl-lugar:not(.vago):not(.robo)")).toHaveCount(2, { timeout: 15_000 });
      await expect(p.locator(".sl-lugares")).toContainText("Tito");
      await expect(p.locator(".sl-lugares")).toContainText("Raiza");
    }
    await expect(b.page.locator(".sl-cod")).toContainText(codigo!);

    // ── BOTS: adicionar e remover (só o anfitrião) ──
    await expect(b.page.locator(".sl-bot.add")).toHaveCount(0);
    await a.page.locator(".sl-bot.add").first().click();
    await expect(b.page.locator(".sl-lugar.robo")).toHaveCount(1, { timeout: 15_000 });
    await a.page.locator(".sl-bot.rem").first().click();
    await expect(b.page.locator(".sl-lugar.robo")).toHaveCount(0, { timeout: 15_000 });
    await a.page.locator(".sl-bot.add").first().click();
    await expect(a.page.locator(".sl-bot.add")).toHaveCount(1, { timeout: 15_000 });
    await a.page.locator(".sl-bot.add").first().click();
    await expect(b.page.locator(".sl-lugar.robo")).toHaveCount(2, { timeout: 15_000 });

    // ── PRONTO e INÍCIO ──
    await a.page.getByRole("button", { name: /Estou pronto/ }).click();
    await expect(b.page.locator(".sl-lugar.pronto")).toHaveCount(1, { timeout: 15_000 });
    await b.page.getByRole("button", { name: /Estou pronto/ }).click();
    await expect(a.page.locator(".mesa")).toBeVisible({ timeout: 30_000 });
    await expect(b.page.locator(".mesa")).toBeVisible({ timeout: 30_000 });

    // ── QUEDA E VOLTA: o convidado perde a rede e volta; a mesa continua a dele ──
    await b.ctx.setOffline(true);
    await b.page.waitForTimeout(1_500);
    await b.ctx.setOffline(false);
    await expect(b.page.locator(".mesa")).toBeVisible({ timeout: 30_000 });
    await expect(a.page.locator(".mesa")).toBeVisible();

    expect([...a.fora, ...b.fora], "requisição para fora da máquina").toEqual([]);
    expect(a.erros, "erro de página no anfitrião").toEqual([]);
    expect(b.erros, "erro de página no convidado").toEqual([]);
  } finally {
    await a.ctx.close();
    await b.ctx.close();
  }
});

test("Android: servidor que não responde → mensagem e volta ao painel no prazo, sem 'Conectando…' eterno", async ({ browser }) => {
  const a = await aparelho(browser, "33333333-3333-4333-8333-333333333333");
  try {
    // O matchmaking nunca responde (rede presa, servidor engasgado): a requisição fica pendurada.
    await a.ctx.route("**/matchmake/**", () => { /* nunca responde */ });
    await abrirPainel(a.page);
    await a.page.locator(".hm-online input").first().fill("Tito");
    await a.page.getByRole("button", { name: "Criar uma sala" }).click();
    await escolherAvatar(a.page, "Sapo");
    await expect(a.page.locator(".sl-lb")).toHaveText(/Conectando/, { timeout: 10_000 });
    // No prazo (20 s), a pessoa volta ao painel com o motivo e o apelido — e pode tentar de novo.
    await expect(a.page.locator(".hm-aviso")).toContainText(/demorou a responder/i, { timeout: 30_000 });
    await expect(a.page.locator(".hm-online input").first()).toHaveValue("Tito");
    await expect(a.page.getByRole("button", { name: "Criar uma sala" })).toBeEnabled();
    await expect(a.page.locator(".sl-lb")).toHaveCount(0);
    expect(a.fora, "requisição para fora da máquina").toEqual([]);
  } finally {
    await a.ctx.close();
  }
});

test("Android: 1 humano + 3 bots — o anfitrião completa a mesa, marca pronto e a partida começa (sem XP, avisado)", async ({ browser }) => {
  // Regra de 03/11/2026 (2º QA físico: "1 humano + 3 bots não inicia"). Exige o servidor deste
  // commit: o piso vem nas boas-vindas, e um servidor anterior seguiria pedindo a 2ª pessoa.
  const a = await aparelho(browser, "44444444-4444-4444-8444-444444444444");
  try {
    await abrirPainel(a.page);
    await a.page.locator(".hm-online input").first().fill("Tito");
    await a.page.getByRole("button", { name: "Criar uma sala" }).click();
    await escolherAvatar(a.page, "Sapo");
    await expect(a.page.locator(".sl-lugar.voce")).toContainText("anfitrião", { timeout: 15_000 });

    for (let n = 1; n <= 3; n++) {
      await a.page.locator(".sl-bot.add").first().click();
      await expect(a.page.locator(".sl-lugar.robo")).toHaveCount(n, { timeout: 15_000 });
    }
    // o rodapé diz que começa com você e que não vale XP
    await expect(a.page.locator(".foot")).toHaveText(/começa quando você estiver pronto.*sem XP/);

    await a.page.getByRole("button", { name: /Estou pronto/ }).click();
    await expect(a.page.locator(".mesa")).toBeVisible({ timeout: 30_000 });

    // queda e volta com um humano só: a mesa continua a dele
    await a.ctx.setOffline(true);
    await a.page.waitForTimeout(1_500);
    await a.ctx.setOffline(false);
    await expect(a.page.locator(".mesa")).toBeVisible({ timeout: 30_000 });

    expect(a.fora, "requisição para fora da máquina").toEqual([]);
    expect(a.erros, "erro de página").toEqual([]);
  } finally {
    await a.ctx.close();
  }
});
