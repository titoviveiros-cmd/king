/**
 * MINI-TORNEIO NO APP ANDROID (ponte nativa simulada) — o título, por toque, sem rede.
 *
 * O bundle é o do app (identidade + servidor configurados, `.env.e2e-nativo`), com a ponte do
 * Capacitor instalada antes do primeiro script, como em `multiplayerNativo.spec.ts` (a ponte é a
 * mesma, em versão enxuta: o mini-torneio só precisa que o app se reconheça nativo). Toque de
 * verdade (`hasTouch`/`isMobile` no projeto): carta se escolhe e se confirma com dois toques.
 *
 * O que se prova aqui, no Android: o mini-torneio de 16 vai até o título com a semente da vitória
 * (assento humano no piloto do Bot Normal, ver `tests/minitorneio.spec.ts`), a celebração aparece
 * e se dispensa por toque, e NENHUMA requisição sai para o Supabase (nem para lugar nenhum fora da
 * máquina) enquanto o torneio corre — torneio não credita XP online.
 */
import { expect, test, type BrowserContext } from "@playwright/test";
import {
  RELOGIO_DA_CELEBRACAO, celebracoes, dentroDaTela, foto, jogarComPiloto, semGrafiaAntiga, tocar,
} from "../tests/helpers/torneio.js";
import { MAO_DO_E2E, ROTULO_DO_AVATAR_DO_E2E, SEMENTES_DO_E2E } from "../tests/fixtures/torneioDeterministico.js";

const SUPABASE = "https://abcdefghijklmnopqrst.supabase.co";
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

async function instalarPonteAndroid(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const cofre = new Map<string, string>();
    const prom = (n: string) => ({ name: n, rtype: "promise" });
    w.androidBridge = { postMessage() {} };
    w.Capacitor = {
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
        const chave = String(op.prefixedKey ?? "");
        if (plugin === "SecureStorage") {
          if (metodo === "internalGetItem") return { data: cofre.get(chave) ?? null };
          if (metodo === "internalSetItem") { cofre.set(chave, String(op.data)); return undefined; }
          if (metodo === "internalRemoveItem") return { success: cofre.delete(chave) };
          if (metodo === "internalGetPrefixedKeys") return { keys: [...cofre.keys()] };
          return undefined;
        }
        if (plugin === "App" && metodo === "getLaunchUrl") return { url: "" };
        return undefined;
      },
      nativeCallback: () => String(Math.random()),
    };
    try {
      localStorage.setItem("king.audio", JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      localStorage.setItem("king:tutorial", JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* sem storage */ }
  });
}

test("Android: mini-torneio de 16 até o título, por toque, sem nenhuma requisição ao Supabase", async ({ browser }, info) => {
  test.setTimeout(420_000);
  const ctx = await browser.newContext();
  // Tudo que sai da máquina é anotado (e barrado). O Supabase fictício responde vazio e é anotado.
  const supabase: string[] = [];
  const fora: string[] = [];
  const gravando = { v: false };
  await ctx.route((u) => !LOCAL.has(u.hostname) && u.protocol !== "data:" && u.protocol !== "blob:", (route) => {
    const u = route.request().url();
    if (u.startsWith(SUPABASE)) {
      if (gravando.v) supabase.push(`${route.request().method()} ${new URL(u).pathname}`);
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" });
    }
    if (gravando.v) fora.push(u);
    return route.abort("blockedbyclient");
  });
  await instalarPonteAndroid(ctx);
  await ctx.addInitScript(RELOGIO_DA_CELEBRACAO);
  const page = await ctx.newPage();
  const sockets: string[] = [];
  page.on("websocket", (ws) => { if (gravando.v) sockets.push(ws.url()); });
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  try {
    await page.goto(`/?seed=${SEMENTES_DO_E2E.mini16.vitoria}&mao=${MAO_DO_E2E}`);
    await expect.poll(() => page.evaluate(() => (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.())).toBe(true);
    await semGrafiaAntiga(page, "Home (Android)");

    gravando.v = true;
    await tocar(page, "Jogar mini-torneio");
    await page.locator(`.hm-avdialogo .hm-av[aria-label="${ROTULO_DO_AVATAR_DO_E2E}"]`).tap();
    await tocar(page, /Mini-torneio: 16 participantes/);
    await tocar(page, "Sortear as mesas");
    await tocar(page, "Jogar as outras mesas");

    for (let f = 0; f < 3; f++) {
      await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 60_000 });
      await tocar(page, "▶ Jogar");
      await jogarComPiloto(page);
      await expect(page.locator(".tn-tabela li.tn-eu.tn-passou")).toHaveCount(1);
      await tocar(page, "Continuar");
      if (f < 2) { await expect(page.locator(".tn-avanco")).toBeVisible({ timeout: 20_000 }); await tocar(page, "Continuar"); }
    }

    const celebra = page.getByRole("dialog", { name: "Campeão do mini-torneio!" });
    await expect(celebra).toBeVisible({ timeout: 20_000 });
    await expect(celebra.locator(".tn-celebra-frase")).toHaveText("Você venceu o mini-torneio!");
    await expect(celebra.locator(".tn-particulas i")).toHaveCount(36);
    await page.waitForTimeout(1500);
    await dentroDaTela(page, celebra.locator(".tn-celebra-centro"), "centro da celebração (Android)");
    await semGrafiaAntiga(page, "celebração (Android)");
    await foto(page, info, "android-16-celebracao");
    await celebra.tap();
    await expect(celebra).toHaveCount(0);
    await expect(page.locator(".tn-fim.tn-fim-venci h1")).toHaveText("Campeão do mini-torneio!");
    expect(await celebracoes(page)).toHaveLength(1);
    await foto(page, info, "android-16-fim");
    gravando.v = false;

    expect(supabase, "requisição ao Supabase durante o mini-torneio (XP/progresso online)").toEqual([]);
    expect(fora, "requisição para fora da máquina durante o mini-torneio").toEqual([]);
    expect(sockets, "WebSocket aberto durante o mini-torneio").toEqual([]);
    expect(erros, "erro de página").toEqual([]);
  } finally {
    await ctx.close();
  }
});
