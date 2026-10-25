// A SESSÃO NÃO SOME CALADA (red team da Fase 9) — com o SDK REAL do Supabase e a rede trocada.
//
// O SDK trata 5xx como passageiro e guarda a sessão; um 429 na renovação, não: com o token de acesso
// vencido, ele APAGA a sessão, e o próximo `token()` criaria outro convidado por cima. O que se prova:
// o 429 da renovação vira 503 (a sessão fica); uma recusa de verdade (refresh token inexistente) apaga
// a sessão E deixa o aviso para o jogador; a nossa saída de propósito (excluir a conta) não deixa aviso.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MARCA_DE_SESSAO_PERDIDA,
  clienteCompartilhado,
  esquecerPortaDeAutenticacao,
  fetchDaSessao,
  lerSessaoPerdida,
  registrarArmazenamentoDaSessao,
  sairDeProposito,
} from "./clienteSupabase.js";

const URL_SUPABASE = "https://abcdefgh.supabase.co";
const CHAVE = "sb-abcdefgh-auth-token";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

function sessao({ vencida }: { vencida: boolean }) {
  const agora = Math.floor(Date.now() / 1000);
  const exp = vencida ? agora - 60 : agora + 3600;
  const jwt = [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: "11111111-2222-3333-4444-555555555555", exp, aud: "authenticated", role: "authenticated" }), "assinatura"].join(".");
  return JSON.stringify({
    access_token: jwt, refresh_token: "rt-do-convidado", token_type: "bearer", expires_in: 3600, expires_at: exp,
    user: { id: "11111111-2222-3333-4444-555555555555", aud: "authenticated", is_anonymous: true },
  });
}

function ambiente(resposta: (url: string) => Response) {
  const guardado = new Map<string, string>();
  const local = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => local.get(k) ?? null,
    setItem: (k: string, v: string) => { local.set(k, v); },
    removeItem: (k: string) => { local.delete(k); },
  });
  const pedidos: string[] = [];
  vi.stubGlobal("fetch", async (entrada: RequestInfo | URL) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    pedidos.push(url);
    return resposta(url);
  });
  registrarArmazenamentoDaSessao(Promise.resolve({
    getItem: async (k: string) => guardado.get(k) ?? null,
    setItem: async (k: string, v: string) => { guardado.set(k, v); },
    removeItem: async (k: string) => { guardado.delete(k); },
  }));
  return { guardado, local, pedidos };
}

const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });

afterEach(() => { esquecerPortaDeAutenticacao(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("fetchDaSessao", () => {
  it("429 só na RENOVAÇÃO vira 503; o resto passa como veio", async () => {
    vi.stubGlobal("fetch", async () => json(429, { error_code: "over_request_rate_limit" }));
    expect((await fetchDaSessao(`${URL_SUPABASE}/auth/v1/token?grant_type=refresh_token`)).status).toBe(503);
    expect((await fetchDaSessao(`${URL_SUPABASE}/auth/v1/signup`)).status).toBe(429);
    expect((await fetchDaSessao(`${URL_SUPABASE}/rest/v1/meu_progresso`)).status).toBe(429);
  });
});

describe("com o SDK real", () => {
  it("renovação com 429 (limite por IP): a sessão do convidado FICA guardada, e não há aviso", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { guardado, local } = ambiente((url) =>
      url.includes("grant_type=refresh_token") ? json(429, { error_code: "over_request_rate_limit", msg: "rate limit" }) : json(404, {}));
    guardado.set(CHAVE, sessao({ vencida: true }));
    const cliente = (await clienteCompartilhado({ url: URL_SUPABASE, anonKey: "chave-publica" }))!;
    const leitura = cliente.auth.getSession();
    await vi.advanceTimersByTimeAsync(40_000); // as novas tentativas do SDK (passageiro) se esgotam
    const { data, error } = await leitura;
    expect(data.session).toBeNull();
    expect(error, "o SDK deveria dizer que a renovação falhou (passageiro)").not.toBeNull();
    expect(guardado.has(CHAVE), "o SDK apagou a sessão do convidado por causa de um 429").toBe(true);
    expect(local.get(MARCA_DE_SESSAO_PERDIDA)).toBeUndefined();
  });

  it("renovação recusada DE VERDADE (refresh token inexistente): o SDK apaga — e o aviso fica, uma vez", async () => {
    const { guardado } = ambiente((url) =>
      url.includes("grant_type=refresh_token") ? json(400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" }) : json(404, {}));
    guardado.set(CHAVE, sessao({ vencida: true }));
    const cliente = (await clienteCompartilhado({ url: URL_SUPABASE, anonKey: "chave-publica" }))!;
    await cliente.auth.getSession();
    await new Promise((r) => setTimeout(r, 0));
    expect(guardado.has(CHAVE)).toBe(false);
    expect(lerSessaoPerdida(), "a perda da sessão passou calada").toBe(true);
    expect(lerSessaoPerdida(), "o aviso aparece uma vez só").toBe(false);
  });

  it("sair DE PROPÓSITO (excluir a conta) não deixa aviso", async () => {
    const { guardado } = ambiente((url) => (url.includes("/logout") ? new Response(null, { status: 204 }) : json(404, {})));
    guardado.set(CHAVE, sessao({ vencida: false }));
    const cliente = (await clienteCompartilhado({ url: URL_SUPABASE, anonKey: "chave-publica" }))!;
    await sairDeProposito(() => cliente.auth.signOut({ scope: "local" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(guardado.has(CHAVE)).toBe(false);
    expect(lerSessaoPerdida()).toBe(false);
  });
});
