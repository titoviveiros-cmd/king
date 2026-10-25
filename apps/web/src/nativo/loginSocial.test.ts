// A FONTE NATIVA DE CREDENCIAL (Fase 9) — o adaptador sobre o `@capgo/capacitor-social-login`.
//
// A dublê do plugin registra cada chamada. O que se prova: o provedor recebe só o HASH do nonce; a
// Apple pede só e-mail e devolve o código para a revogação; cancelar é "cancelado"; a cópia do token
// que o plugin guarda é apagada depois de TODO pedido; um segundo toque não abre outra tela; e no
// iPhone o Google nunca existe sem a Apple.
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarFonteDeLoginSocial, provedoresNativos, type PluginDeLoginSocial } from "./loginSocial.js";

const HASH = "a".repeat(64);

function pluginFalso(resposta: (provider: string) => Promise<{ result?: unknown }>, o: { logoutTrava?: boolean } = {}) {
  const chamadas: { metodo: string; arg: unknown }[] = [];
  const plugin: PluginDeLoginSocial & { chamadas: typeof chamadas } = {
    chamadas,
    async initialize(arg) { chamadas.push({ metodo: "initialize", arg }); },
    async login(arg) { chamadas.push({ metodo: "login", arg }); return resposta(arg.provider); },
    logout(arg) {
      chamadas.push({ metodo: "logout", arg });
      return o.logoutTrava ? new Promise<void>(() => {}) : Promise.resolve();
    },
  };
  return plugin;
}

const ok = (result: unknown) => async () => ({ result });
const ID_TOKEN = "eyJ.cabecalho.assinatura";

afterEach(() => { vi.useRealTimers(); });

describe("quais provedores cada plataforma oferece", () => {
  it("Android: Google só com o client ID web; nunca Apple", () => {
    expect(provedoresNativos({ plataforma: "android" })).toEqual([]);
    expect(provedoresNativos({ plataforma: "android", googleWebClientId: "web.apps.googleusercontent.com" })).toEqual(["google"]);
    expect(provedoresNativos({ plataforma: "android", googleIosClientId: "ios.apps.googleusercontent.com" })).toEqual([]);
  });

  it("iPhone: Apple sempre, e o Google só ao lado dela (diretriz 4.8)", () => {
    expect(provedoresNativos({ plataforma: "ios" })).toEqual(["apple"]);
    expect(provedoresNativos({ plataforma: "ios", googleIosClientId: "ios.apps.googleusercontent.com" })).toEqual(["apple", "google"]);
    for (const cfg of [{}, { googleWebClientId: "w" }, { googleIosClientId: "i" }, { googleWebClientId: "w", googleIosClientId: "i" }]) {
      const lista = provedoresNativos({ plataforma: "ios", ...cfg });
      expect(lista.includes("google") && !lista.includes("apple"), JSON.stringify(cfg)).toBe(false);
    }
  });
});

describe("a fonte de credencial", () => {
  it("sem provedor nenhum, não há fonte (e o plugin nem é inicializado)", async () => {
    const plugin = pluginFalso(ok({}));
    expect(await criarFonteDeLoginSocial(plugin, { plataforma: "android" })).toBeNull();
    expect(plugin.chamadas).toEqual([]);
  });

  it("inicializa Google em modo online e a Apple com o código de autorização ligado", async () => {
    const plugin = pluginFalso(ok({}));
    await criarFonteDeLoginSocial(plugin, { plataforma: "ios", googleIosClientId: " ios.apps.googleusercontent.com ", googleWebClientId: "web" });
    expect(plugin.chamadas[0]).toEqual({
      metodo: "initialize",
      arg: {
        google: { webClientId: "web", iOSClientId: "ios.apps.googleusercontent.com", mode: "online" },
        apple: { useProperTokenExchange: true },
      },
    });
  });

  it("Google: o provedor recebe o HASH do nonce, sem escolha automática de conta; a cópia do token é apagada DEPOIS", async () => {
    const plugin = pluginFalso(ok({ idToken: ID_TOKEN, accessToken: { token: "at-google" }, profile: { email: "x@y" } }));
    const fonte = (await criarFonteDeLoginSocial(plugin, { plataforma: "android", googleWebClientId: "web" }))!;
    const r = await fonte.obter("google", HASH);
    expect(r).toEqual({ tipo: "credencial", credencial: { idToken: ID_TOKEN, accessToken: "at-google" } });
    const login = plugin.chamadas.find((c) => c.metodo === "login")!.arg as { options: Record<string, unknown> };
    expect(login.options).toEqual({ nonce: HASH, filterByAuthorizedAccounts: false, autoSelectEnabled: false });
    expect(plugin.chamadas.map((c) => c.metodo)).toEqual(["initialize", "login", "logout"]);
    expect(plugin.chamadas[2].arg).toEqual({ provider: "google", clearCachedUserInfo: true });
  });

  it("Apple: só o escopo de e-mail, o hash do nonce, e o código de autorização para a revogação", async () => {
    const plugin = pluginFalso(ok({ idToken: ID_TOKEN, authorizationCode: "codigo-apple", accessToken: null, profile: { user: "001" } }));
    const fonte = (await criarFonteDeLoginSocial(plugin, { plataforma: "ios" }))!;
    const r = await fonte.obter("apple", HASH);
    expect(r).toEqual({ tipo: "credencial", credencial: { idToken: ID_TOKEN, codigoDeAutorizacao: "codigo-apple" } });
    const login = plugin.chamadas.find((c) => c.metodo === "login")!.arg as { options: Record<string, unknown> };
    expect(login.options).toEqual({ scopes: ["email"], nonce: HASH });
    expect(plugin.chamadas.at(-1)).toEqual({ metodo: "logout", arg: { provider: "apple", clearCachedUserInfo: true } });
  });

  it("cancelar é \"cancelado\" (nos dois formatos do plugin) — e a cópia é apagada mesmo assim", async () => {
    for (const erro of [Object.assign(new Error("Google Sign-In cancelled by user"), { code: "USER_CANCELLED" }), new Error("The user canceled")]) {
      const plugin = pluginFalso(async () => { throw erro; });
      const fonte = (await criarFonteDeLoginSocial(plugin, { plataforma: "ios" }))!;
      expect(await fonte.obter("apple", HASH)).toEqual({ tipo: "cancelado" });
      expect(plugin.chamadas.at(-1)?.metodo).toBe("logout");
    }
  });

  it("erro do provedor, ou resposta sem ID token, é \"erro\" — nunca uma credencial vazia", async () => {
    const falha = pluginFalso(async () => { throw new Error("network"); });
    const f1 = (await criarFonteDeLoginSocial(falha, { plataforma: "android", googleWebClientId: "web" }))!;
    expect(await f1.obter("google", HASH)).toEqual({ tipo: "erro" });
    expect(falha.chamadas.at(-1)?.metodo).toBe("logout");
    const vazia = pluginFalso(ok({ idToken: null, accessToken: null }));
    const f2 = (await criarFonteDeLoginSocial(vazia, { plataforma: "android", googleWebClientId: "web" }))!;
    expect(await f2.obter("google", HASH)).toEqual({ tipo: "erro" });
  });

  it("toque duplo: com a tela do provedor aberta, o segundo pedido NÃO abre outra", async () => {
    let soltar!: (v: { result: unknown }) => void;
    const plugin = pluginFalso(() => new Promise((r) => { soltar = r; }));
    const fonte = (await criarFonteDeLoginSocial(plugin, { plataforma: "android", googleWebClientId: "web" }))!;
    const primeiro = fonte.obter("google", HASH);
    expect(await fonte.obter("google", HASH)).toEqual({ tipo: "erro" });
    soltar({ result: { idToken: ID_TOKEN } });
    expect((await primeiro).tipo).toBe("credencial");
    expect(plugin.chamadas.filter((c) => c.metodo === "login")).toHaveLength(1);
    // e, terminado o primeiro, um novo pedido volta a funcionar
    const de_novo = pluginFalso(ok({ idToken: ID_TOKEN }));
    const f3 = (await criarFonteDeLoginSocial(de_novo, { plataforma: "android", googleWebClientId: "web" }))!;
    await f3.obter("google", HASH);
    expect((await f3.obter("google", HASH)).tipo).toBe("credencial");
  });

  it("provedor que este app não oferece nem chega ao plugin", async () => {
    const plugin = pluginFalso(ok({ idToken: ID_TOKEN }));
    const fonte = (await criarFonteDeLoginSocial(plugin, { plataforma: "android", googleWebClientId: "web" }))!;
    expect(await fonte.obter("apple", HASH)).toEqual({ tipo: "erro" });
    expect(plugin.chamadas.some((c) => c.metodo === "login")).toBe(false);
  });

  it("um logout que trava não prende o jogador: a credencial sai no limite", async () => {
    vi.useFakeTimers();
    const plugin = pluginFalso(ok({ idToken: ID_TOKEN }), { logoutTrava: true });
    const fonte = (await criarFonteDeLoginSocial(plugin, { plataforma: "android", googleWebClientId: "web" }))!;
    const r = fonte.obter("google", HASH);
    await vi.advanceTimersByTimeAsync(3000);
    expect((await r).tipo).toBe("credencial");
  });
});
