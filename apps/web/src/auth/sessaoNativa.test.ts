// A SESSÃO DO APP NO COFRE DO SISTEMA (Fase 9).
//
// O que se prova: o cofre é configurado SÓ DESTE APARELHO e sem iCloud antes de qualquer
// gravação; a sessão do WebView migra sem nunca se perder; o marcador síncrono acompanha a
// sessão; um cofre que falha vira memória — nunca texto puro —; e limpar apaga tudo.
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeychainAccess } from "@aparajita/capacitor-secure-storage/dist/esm/definitions.js";
import {
  ACESSO_SO_DESTE_APARELHO,
  MARCADOR_DE_SESSAO,
  PREFIXO_DO_COFRE,
  armazenamentoNoCofre,
  armazenamentoSoNaMemoria,
  limparSessaoDoCofre,
  marcadorDeSessao,
  migrarSessaoDoWebView,
  prepararCofre,
  sincronizarMarcador,
  type CofreDoSistema,
  type LocalSimples,
} from "./sessaoNativa.js";
import { prepararSessaoNativa } from "../nativo/arranque.js";
import { clienteCompartilhado, esquecerPortaDeAutenticacao } from "./clienteSupabase.js";

const CHAVE = "sb-abcdefgh-auth-token";
// Uma sessão bem formada e ainda válida: o SDK real a devolve sem rede (uma malformada ele apaga).
const SESSAO = JSON.stringify({
  access_token: "jwt-do-convidado",
  refresh_token: "rt-do-convidado",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "11111111-2222-3333-4444-555555555555", aud: "authenticated", is_anonymous: true },
});

function cofreFalso(o: { falharSet?: boolean; falharGet?: boolean; falharClear?: boolean; falharPreparo?: boolean } = {}) {
  const itens = new Map<string, string>();
  const chamadas: string[] = [];
  const cofre: CofreDoSistema & { itens: Map<string, string>; chamadas: string[] } = {
    itens,
    chamadas,
    async setKeyPrefix(p) { chamadas.push(`prefixo:${p}`); },
    async setSynchronize(s) { chamadas.push(`sincronizar:${s}`); },
    async setDefaultKeychainAccess(a) {
      chamadas.push(`acesso:${a}`);
      if (o.falharPreparo) throw new Error("keychain indisponível");
    },
    async getItem(k) { chamadas.push(`get:${k}`); if (o.falharGet) throw new Error("ilegível"); return itens.get(k) ?? null; },
    async setItem(k, v) { chamadas.push(`set:${k}`); if (o.falharSet) throw new Error("keystore"); itens.set(k, v); },
    async removeItem(k) { chamadas.push(`remove:${k}`); itens.delete(k); },
    async clear() { chamadas.push("clear"); if (o.falharClear) throw new Error("clear"); itens.clear(); },
  };
  return cofre;
}

function localFalso(inicial: Record<string, string> = {}) {
  const mapa = new Map(Object.entries(inicial));
  const local: LocalSimples & { mapa: Map<string, string> } = {
    mapa,
    getItem: (k) => mapa.get(k) ?? null,
    setItem: (k, v) => { mapa.set(k, v); },
    removeItem: (k) => { mapa.delete(k); },
  };
  return local;
}

afterEach(() => { esquecerPortaDeAutenticacao(); vi.unstubAllGlobals(); });

describe("o cofre é preparado do jeito certo ANTES de guardar qualquer coisa", () => {
  it("o acesso fixado é o afterFirstUnlockThisDeviceOnly do próprio plugin", () => {
    expect(ACESSO_SO_DESTE_APARELHO).toBe(KeychainAccess.afterFirstUnlockThisDeviceOnly);
  });

  it("prefixo próprio, sem sincronia com o iCloud, só deste aparelho", async () => {
    const cofre = cofreFalso();
    await prepararCofre(cofre);
    expect(cofre.chamadas).toEqual([`prefixo:${PREFIXO_DO_COFRE}`, "sincronizar:false", `acesso:${ACESSO_SO_DESTE_APARELHO}`]);
  });
});

describe("o armazenamento da sessão sobre o cofre", () => {
  it("grava, lê e remove pelo cofre; o marcador acende e apaga só com a chave da sessão", async () => {
    const cofre = cofreFalso();
    const local = localFalso();
    const a = armazenamentoNoCofre(cofre, CHAVE, local);
    await a.setItem(`${CHAVE}-code-verifier`, "verificador");
    expect(marcadorDeSessao(local), "outra chave do SDK não é sessão").toBe(false);
    await a.setItem(CHAVE, SESSAO);
    expect(cofre.itens.get(CHAVE)).toBe(SESSAO);
    expect(await a.getItem(CHAVE)).toBe(SESSAO);
    expect(marcadorDeSessao(local)).toBe(true);
    expect([...local.mapa.values()].some((v) => v.includes("jwt") || v.includes("rt-")), "token no localStorage").toBe(false);
    await a.removeItem(CHAVE);
    expect(cofre.itens.has(CHAVE)).toBe(false);
    expect(marcadorDeSessao(local)).toBe(false);
  });

  it("cofre que recusa gravar: a sessão fica na MEMÓRIA desta execução, e nada vai para o localStorage", async () => {
    const cofre = cofreFalso({ falharSet: true });
    const local = localFalso();
    const a = armazenamentoNoCofre(cofre, CHAVE, local);
    await a.setItem(CHAVE, SESSAO);
    expect(await a.getItem(CHAVE)).toBe(SESSAO);
    expect(local.mapa.get(CHAVE)).toBeUndefined();
    expect([...local.mapa.keys()]).toEqual([MARCADOR_DE_SESSAO]);
  });

  it("cofre ilegível (chave do Keystore perdida, arquivo de outro aparelho) é \"sem sessão\" — nunca erro", async () => {
    const a = armazenamentoNoCofre(cofreFalso({ falharGet: true }), CHAVE, localFalso());
    expect(await a.getItem(CHAVE)).toBeNull();
  });
});

describe("a migração da sessão de um build anterior (localStorage do WebView → cofre)", () => {
  it("a sessão vai para o cofre e SÓ DEPOIS some do localStorage", async () => {
    const cofre = cofreFalso();
    const local = localFalso({ [CHAVE]: SESSAO, [`${CHAVE}-user`]: "{}" });
    await migrarSessaoDoWebView(cofre, CHAVE, local);
    expect(cofre.itens.get(CHAVE)).toBe(SESSAO);
    expect(local.mapa.has(CHAVE)).toBe(false);
    expect(local.mapa.has(`${CHAVE}-user`)).toBe(false);
  });

  it("cofre que recusa: a sessão FICA no localStorage — o convidado nunca se perde na mudança", async () => {
    const local = localFalso({ [CHAVE]: SESSAO });
    await migrarSessaoDoWebView(cofreFalso({ falharSet: true }), CHAVE, local);
    expect(local.mapa.get(CHAVE)).toBe(SESSAO);
  });

  it("sessão nos dois lugares: a do cofre manda, e a cópia em texto puro sai", async () => {
    const cofre = cofreFalso();
    cofre.itens.set(CHAVE, "sessao-do-cofre");
    const local = localFalso({ [CHAVE]: SESSAO });
    await migrarSessaoDoWebView(cofre, CHAVE, local);
    expect(cofre.itens.get(CHAVE)).toBe("sessao-do-cofre");
    expect(local.mapa.has(CHAVE)).toBe(false);
  });
});

describe("o marcador síncrono e a limpeza", () => {
  it("o marcador espelha o cofre no arranque (inclusive iPhone reinstalado, com o Keychain cheio)", async () => {
    const cofre = cofreFalso();
    const local = localFalso();
    await sincronizarMarcador(cofre, CHAVE, local);
    expect(marcadorDeSessao(local)).toBe(false);
    cofre.itens.set(CHAVE, SESSAO);
    await sincronizarMarcador(cofre, CHAVE, local);
    expect(marcadorDeSessao(local)).toBe(true);
    await sincronizarMarcador(cofreFalso({ falharGet: true }), CHAVE, local);
    expect(marcadorDeSessao(local)).toBe(false);
  });

  it("limpar apaga o cofre do KING, o marcador e qualquer cópia antiga", async () => {
    const cofre = cofreFalso();
    cofre.itens.set(CHAVE, SESSAO);
    const local = localFalso({ [MARCADOR_DE_SESSAO]: "1", [CHAVE]: SESSAO });
    await limparSessaoDoCofre(cofre, CHAVE, local);
    expect(cofre.chamadas).toContain("clear");
    expect(cofre.itens.size).toBe(0);
    expect(local.mapa.size).toBe(0);
  });

  it("limpar com o clear falhando ainda remove a sessão e apaga o marcador", async () => {
    const cofre = cofreFalso({ falharClear: true });
    cofre.itens.set(CHAVE, SESSAO);
    const local = localFalso({ [MARCADOR_DE_SESSAO]: "1" });
    await limparSessaoDoCofre(cofre, CHAVE, local);
    expect(cofre.itens.has(CHAVE)).toBe(false);
    expect(marcadorDeSessao(local)).toBe(false);
  });
});

describe("o arranque nativo decide onde a sessão vive — e o cliente do Supabase obedece", () => {
  const url = "https://abcdefgh.supabase.co";
  const deps = (cofre: CofreDoSistema | Error, local: LocalSimples, nativo = true) => ({
    nativo: () => nativo,
    urlDaIdentidade: () => url,
    carregarCofre: async () => { if (cofre instanceof Error) throw cofre; return cofre; },
    local: () => local,
  });

  it("no app, o SDK REAL lê e grava a sessão no cofre (e não no localStorage)", async () => {
    const cofre = cofreFalso();
    const local = localFalso({ [CHAVE]: SESSAO });
    vi.stubGlobal("localStorage", local);
    await prepararSessaoNativa(deps(cofre, local));
    const cliente = await clienteCompartilhado({ url, anonKey: "chave-publica" });
    expect(cliente).not.toBeNull();
    const { data } = await cliente!.auth.getSession();
    expect(data.session?.access_token, "o SDK não achou a sessão migrada").toBe("jwt-do-convidado");
    expect(cofre.chamadas.filter((c) => c === `get:${CHAVE}`).length).toBeGreaterThan(0);
    expect(local.mapa.has(CHAVE), "a sessão continuou em texto puro").toBe(false);
    expect(cofre.itens.get(CHAVE)).toBe(SESSAO);
  });

  it("cofre que não abre: memória semeada com a sessão antiga (mesmo convidado nesta execução)", async () => {
    const local = localFalso({ [CHAVE]: SESSAO });
    vi.stubGlobal("localStorage", local);
    await prepararSessaoNativa(deps(new Error("plugin ausente"), local));
    const cliente = await clienteCompartilhado({ url, anonKey: "chave-publica" });
    const { data } = await cliente!.auth.getSession();
    expect(data.session?.access_token, "o convidado desta execução é o mesmo de antes").toBe("jwt-do-convidado");
    expect(local.mapa.get(CHAVE), "sem cofre, a cópia antiga não é apagada").toBe(SESSAO);
  });

  it("cofre que abre mas RECUSA a sessão antiga: esta execução continua o MESMO convidado (memória), e a cópia fica", async () => {
    const cofre = cofreFalso({ falharSet: true });
    const local = localFalso({ [CHAVE]: SESSAO });
    vi.stubGlobal("localStorage", local);
    await prepararSessaoNativa(deps(cofre, local));
    const cliente = await clienteCompartilhado({ url, anonKey: "chave-publica" });
    const { data } = await cliente!.auth.getSession();
    expect(data.session?.access_token, "nasceria outro convidado com o cofre vazio").toBe("jwt-do-convidado");
    expect(local.mapa.get(CHAVE), "a cópia antiga não pode sumir sem ter ido para o cofre").toBe(SESSAO);
  });

  it("cofre que não aceita o acesso ThisDeviceOnly NÃO é usado (nunca com o padrão que migra por backup)", async () => {
    const cofre = cofreFalso({ falharPreparo: true });
    const local = localFalso();
    vi.stubGlobal("localStorage", local);
    await prepararSessaoNativa(deps(cofre, local));
    const cliente = await clienteCompartilhado({ url, anonKey: "chave-publica" });
    await cliente!.auth.getSession();
    expect(cofre.chamadas.some((c) => c.startsWith("get:") || c.startsWith("set:"))).toBe(false);
  });

  it("na web, nada muda: nenhum cofre é carregado", async () => {
    const carregar = vi.fn();
    await prepararSessaoNativa({ nativo: () => false, urlDaIdentidade: () => url, carregarCofre: carregar, local: () => null });
    expect(carregar).not.toHaveBeenCalled();
  });

  it("a memória de reserva guarda e esquece", async () => {
    const m = armazenamentoSoNaMemoria({ chave: CHAVE, valor: SESSAO });
    expect(await m.getItem(CHAVE)).toBe(SESSAO);
    await m.removeItem(CHAVE);
    expect(await m.getItem(CHAVE)).toBeNull();
  });
});
