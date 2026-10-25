// O CONVIDADO NÃO PODE SER TROCADO POR UM SOLUÇO DE REDE (red team da Fase 8, 23/10/2026).
//
// Quando a renovação da sessão falha (rede ou 5xx; o 429 o SDK não repete), o SDK do Supabase MANTÉM a sessão
// guardada e responde `getSession() = { session: null, error }`. O `token()` antigo lia isso como
// "não há convidado" e criava OUTRO por cima — o jogador perdia a conta. No celular é rotina:
// voltar do segundo plano com o token vencido e a rede piscando.
import { afterEach, describe, expect, it, vi } from "vitest";

const estado: { porta: unknown } = { porta: null };
vi.mock("./clienteSupabase.js", () => ({
  portaDeAutenticacao: async () => estado.porta,
  clienteCompartilhado: async () => null,
}));
const { identidadeSupabase, contaConfigurada, provedoresDaConta } = await import("./identidade.js");
const { registrarFonteNativa, aoMudarFonteNativa } = await import("./credencialNativa.js");

function porta(sessao: { session: unknown; error?: unknown }) {
  const chamadas: string[] = [];
  estado.porta = {
    chamadas,
    async getSession() { chamadas.push("getSession"); return { data: { session: sessao.session }, error: sessao.error ?? null }; },
    async signInAnonymously() { chamadas.push("signInAnonymously"); return { data: { session: { access_token: "jwt-de-OUTRO-usuario" } } }; },
  };
  return chamadas;
}
const cfg = { url: "https://exemplo.supabase.co", anonKey: "chave-publica" };

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); registrarFonteNativa(null); });

describe("token(): renovação que falhou NÃO vira convidado novo", () => {
  it("sessão guardada + renovação com erro → sem token agora, e NINGUÉM é criado", async () => {
    const chamadas = porta({ session: null, error: { message: "Failed to fetch", code: "network" } });
    expect(await identidadeSupabase(cfg).token()).toBeUndefined();
    expect(chamadas, "criou outro convidado por cima do jogador").not.toContain("signInAnonymously");
  });

  it("aparelho sem sessão nenhuma (1ª vez online) → o convidado nasce, como sempre", async () => {
    const chamadas = porta({ session: null });
    expect(await identidadeSupabase(cfg).token()).toBe("jwt-de-OUTRO-usuario");
    expect(chamadas.filter((c) => c === "signInAnonymously")).toHaveLength(1);
  });

  it("sessão válida → o token dela, sem criar nada", async () => {
    const chamadas = porta({ session: { access_token: "jwt-do-convidado", user: { id: "u1" } } });
    expect(await identidadeSupabase(cfg).token()).toBe("jwt-do-convidado");
    expect(chamadas).not.toContain("signInAnonymously");
  });
});

describe("a conta na Home dentro do app", () => {
  const ligar = () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-publica");
    vi.stubEnv("VITE_KING_GOOGLE_LINK", "1");
  };
  const fonte = (provedores: ("google" | "apple")[]) => ({ provedores, obter: async () => ({ tipo: "cancelado" as const }) });

  it("na web, com o vínculo ligado, a conta aparece", () => {
    ligar();
    expect(contaConfigurada()).not.toBeNull();
  });

  it("no app SEM o plugin nativo, a conta não aparece (o OAuth da web não funciona em WebView)", () => {
    ligar();
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "android" });
    expect(contaConfigurada()).toBeNull();
  });

  it("no Android COM o plugin, aparece", () => {
    ligar();
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "android" });
    registrarFonteNativa(fonte(["google"]));
    expect(contaConfigurada()).not.toBeNull();
    expect(provedoresDaConta()).toEqual(["google"]);
  });

  it("no Android com o plugin mas SEM provedor (client ID ausente), não aparece", () => {
    ligar();
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "android" });
    registrarFonteNativa(fonte([]));
    expect(contaConfigurada()).toBeNull();
  });

  it("no iPhone, NUNCA só com Google: sem a Apple (diretriz 4.8), a conta não aparece", () => {
    ligar();
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "ios" });
    registrarFonteNativa(fonte(["google"]));
    expect(contaConfigurada()).toBeNull();
    expect(provedoresDaConta()).toEqual([]);
  });

  it("no iPhone COM a Apple, a conta aparece — com a Apple primeiro, sozinha ou com o Google", () => {
    ligar();
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "ios" });
    registrarFonteNativa(fonte(["apple"]));
    expect(contaConfigurada()).not.toBeNull();
    expect(provedoresDaConta()).toEqual(["apple"]);
    registrarFonteNativa(fonte(["apple", "google"]));
    expect(provedoresDaConta()).toEqual(["apple", "google"]);
  });

  it("plugin que se registra DEPOIS da primeira tela: quem ouve é avisado, e a conta passa a existir", () => {
    ligar();
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => "android" });
    expect(contaConfigurada(), "sem plugin ainda").toBeNull();
    let avisos = 0;
    const parar = aoMudarFonteNativa(() => { avisos++; });
    registrarFonteNativa(fonte(["google"]));
    expect(avisos).toBe(1);
    expect(contaConfigurada()).not.toBeNull();
    parar();
    registrarFonteNativa(null);
    expect(avisos, "cancelado, não ouve mais").toBe(1);
  });

  it("na web, o provedor é o Google (OAuth)", () => {
    ligar();
    expect(provedoresDaConta()).toEqual(["google"]);
  });
});
