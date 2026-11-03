/**
 * O COFRE NO ANDROID, COM O CAPACITOR DE VERDADE — o defeito do AAB 0.1.0 (vc1).
 *
 * No 1º teste físico, "Jogar com amigos → Criar sala" ficava em "Conectando…" para sempre. A sessão
 * do convidado só nasce depois que o cofre do sistema fica pronto (`arranque.ts`), e o cofre nunca
 * ficava: o plugin do Capacitor é um Proxy que responde a QUALQUER propriedade — inclusive `then`.
 * Devolvido por uma função `async`, o JavaScript o trata como promessa, chama `plugin.then(...)`, o
 * Capacitor procura um método nativo "then" que não existe, e a resolução nunca acontece.
 *
 * Os outros testes usam um cofre dublê (objeto comum), e por isso nunca viram o defeito. Aqui o
 * `@capacitor/core` e o plugin são os REAIS; só a ponte nativa é simulada, no ponto exato em que o
 * core a lê no Android (`androidBridge` + `Capacitor.PluginHeaders` + `nativePromise`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LocalSimples } from "../auth/sessaoNativa.js";

const METODOS_NATIVOS = [
  "setSynchronizeKeychain", "internalGetItem", "internalSetItem", "internalRemoveItem",
  "internalClearItemsWithPrefix", "internalGetPrefixedKeys",
];

// UMA ponte para o arquivo inteiro: o `@capacitor/core` vem de node_modules e o Node o guarda em
// cache — ele lê `globalThis.Capacitor` uma vez só. Entre testes, zeram-se só os registros.
const chamadas: string[] = [];
const guardado = new Map<string, string>();

/** O que o lado Java do plugin faria, em memória. */
function simularAndroid() {
  const g = globalThis as Record<string, unknown>;
  g.androidBridge = { postMessage() {} };
  g.Capacitor = {
    PluginHeaders: [{ name: "SecureStorage", methods: METODOS_NATIVOS.map((name) => ({ name, rtype: "promise" })) }],
    nativePromise: async (plugin: string, metodo: string, op: Record<string, unknown> = {}) => {
      chamadas.push(`${plugin}.${metodo}`);
      const chave = String(op.prefixedKey ?? "");
      if (metodo === "internalGetItem") return { data: guardado.get(chave) ?? null };
      if (metodo === "internalSetItem") { guardado.set(chave, String(op.data)); return undefined; }
      if (metodo === "internalRemoveItem") return { success: guardado.delete(chave) };
      if (metodo === "internalGetPrefixedKeys") return { keys: [...guardado.keys()] };
      return undefined;
    },
  };
}

function localNaMemoria(): LocalSimples {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

const pendurou = (ms: number) => new Promise<"pendurou">((ok) => setTimeout(() => ok("pendurou"), ms));

beforeAll(() => { simularAndroid(); });
beforeEach(() => { chamadas.length = 0; guardado.clear(); });
afterAll(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.androidBridge;
  delete g.Capacitor;
});

describe("cofre do plugin real no Android (Capacitor 8)", () => {
  it("carregar o cofre TERMINA — no vc1 a promessa nunca resolvia", async () => {
    const { carregarCofreDoPlugin } = await import("./arranque.js");
    const r = await Promise.race([carregarCofreDoPlugin().then(() => "pronto" as const), pendurou(1000)]);
    expect(r).toBe("pronto");
  });

  it("o cofre carregado não é 'thenable' — nunca mais vira promessa por acidente", async () => {
    const { carregarCofreDoPlugin } = await import("./arranque.js");
    const cofre = await Promise.race([carregarCofreDoPlugin(), pendurou(1000)]);
    expect(cofre).not.toBe("pendurou");
    expect(typeof (cofre as { then?: unknown }).then).toBe("undefined");
  });

  it("a sessão nativa inteira fica pronta e passa pelo cofre nativo", async () => {
    const { carregarCofreDoPlugin, prepararSessaoNativa } = await import("./arranque.js");
    const local = localNaMemoria();
    const pronta = prepararSessaoNativa({
      nativo: () => true,
      urlDaIdentidade: () => "https://abcdefghijklmnopqrst.supabase.co",
      carregarCofre: carregarCofreDoPlugin,
      local: () => local,
    }).then(() => "pronta" as const);
    expect(await Promise.race([pronta, pendurou(1000)])).toBe("pronta");
    // o marcador consultou o cofre de verdade (a ponte nativa), não um substituto
    expect(chamadas).toContain("SecureStorage.internalGetItem");
    expect(guardado.size).toBe(0);
  });
});
