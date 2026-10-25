// A EXCLUSÃO DE CONTA NO SERVIDOR (Fase 9) — a função inteira, com JWT de verdade (jose, ES256) e a
// rede trocada por uma dublê que registra cada chamada à API de administração e à Apple.
//
// O que se prova: só o dono do token exclui (o corpo não escolhe quem); sem confirmação nada é
// apagado; a exclusão é real (`should_soft_delete: false`) e idempotente; a Apple é revogada ANTES
// de apagar e, se falhar, a exclusão segue; e o log nunca carrega token, id nem e-mail.
import { describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, exportPKCS8, generateKeyPair } from "jose";
import * as jose from "jose";
import { CONFIRMACAO, criarExclusao, criarVerificador, origensPermitidas, type ConfiguracaoDaExclusao } from "./nucleo.ts";

const URL_SUPABASE = "https://abcdefgh.supabase.co";
const EMISSOR = `${URL_SUPABASE}/auth/v1`;
const SUB = "11111111-2222-3333-4444-555555555555";
const OUTRO = "99999999-8888-7777-6666-555555555555";
const SERVICO = "chave-de-servico-de-teste";
const APP_ORIGEM = "https://playkingcards.com.br";

const projeto = await generateKeyPair("ES256");
const estranho = await generateKeyPair("ES256");
const jwkPublica = { ...(await exportJWK(projeto.publicKey)), kid: "k1", alg: "ES256" };
const chaves = createLocalJWKSet({ keys: [jwkPublica] });
const verificar = criarVerificador(jose as never, URL_SUPABASE, chaves);

const appleChaves = await generateKeyPair("ES256", { extractable: true });
const APPLE = {
  teamId: "TEAMID1234",
  keyId: "KEYID12345",
  clientId: "br.com.playkingcards.king",
  chavePrivada: await exportPKCS8(appleChaves.privateKey),
};

async function token(o: { sub?: string; iss?: string; aud?: string; chave?: CryptoKey; exp?: string; anonimo?: boolean } = {}) {
  return await new SignJWT({ role: "authenticated", is_anonymous: o.anonimo ?? false })
    .setProtectedHeader({ alg: "ES256", kid: "k1" })
    .setIssuer(o.iss ?? EMISSOR)
    .setAudience(o.aud ?? "authenticated")
    .setSubject(o.sub ?? SUB)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "1h")
    .sign(o.chave ?? projeto.privateKey);
}

const idTokenApple = (sub: string) => `x.${Buffer.from(JSON.stringify({ sub, iss: "https://appleid.apple.com" })).toString("base64url")}.y`;

interface Cenario {
  usuario?: { identities: unknown[] } | null;
  leituraStatus?: number;
  exclusaoStatus?: number;
  appleToken?: { status: number; corpo?: Record<string, unknown> };
  appleRevoga?: number;
  redeCai?: "leitura" | "exclusao";
}

function redeFalsa(c: Cenario) {
  const chamadas: { metodo: string; url: string; corpo?: string; cabecalhos: Record<string, string> }[] = [];
  const rede = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const metodo = init?.method ?? "GET";
    const corpo = init?.body === undefined ? undefined : String(init.body);
    chamadas.push({ metodo, url: u, corpo, cabecalhos: { ...(init?.headers as Record<string, string>) } });
    if (u.startsWith("https://appleid.apple.com/auth/token")) {
      const t = c.appleToken ?? { status: 200, corpo: { refresh_token: "rt-apple", access_token: "at-apple", id_token: idTokenApple("apple-sub-001") } };
      return new Response(JSON.stringify(t.corpo ?? {}), { status: t.status });
    }
    if (u.startsWith("https://appleid.apple.com/auth/revoke")) return new Response(null, { status: c.appleRevoga ?? 200 });
    if (u.startsWith(`${EMISSOR}/admin/users/`)) {
      if (metodo === "GET") {
        if (c.redeCai === "leitura") throw new TypeError("fetch failed");
        if (c.usuario === null) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify({ id: SUB, ...(c.usuario ?? { identities: [] }) }), { status: c.leituraStatus ?? 200 });
      }
      if (metodo === "DELETE") {
        if (c.redeCai === "exclusao") throw new TypeError("fetch failed");
        return new Response("{}", { status: c.exclusaoStatus ?? 200 });
      }
    }
    return new Response("inesperado", { status: 599 });
  }) as typeof fetch;
  return { rede, chamadas };
}

function montar(c: Cenario = {}, cfg: Partial<ConfiguracaoDaExclusao> = {}) {
  const { rede, chamadas } = redeFalsa(c);
  const log: string[] = [];
  const executar = criarExclusao(
    { supabaseUrl: URL_SUPABASE, chaveDeServico: SERVICO, origens: origensPermitidas(undefined), apple: APPLE, ...cfg },
    { verificarToken: verificar, rede, agora: () => Date.now(), registrar: (e) => log.push(e) },
  );
  return { executar, chamadas, log };
}

const pedir = (o: { token?: string; corpo?: unknown; metodo?: string; origem?: string; bruto?: string } = {}) =>
  new Request("https://abcdefgh.supabase.co/functions/v1/excluir-conta", {
    method: o.metodo ?? "POST",
    headers: {
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      ...(o.origem ? { origin: o.origem } : {}),
      "content-type": "application/json",
    },
    ...(o.metodo === "GET" || o.metodo === "OPTIONS"
      ? {}
      : { body: o.bruto ?? JSON.stringify("corpo" in o ? o.corpo : { confirmacao: CONFIRMACAO }) }),
  });

const exclusoes = (ch: ReturnType<typeof montar>["chamadas"]) => ch.filter((x) => x.metodo === "DELETE");

describe("quem pode excluir", () => {
  it("sem credencial: 401, e a API de administração nem é tocada", async () => {
    const m = montar();
    const r = await m.executar(pedir());
    expect(r.status).toBe(401);
    expect(m.chamadas).toEqual([]);
  });

  it("JWT de outro emissor, outra audiência, outra chave, vencido, ou com sub que não é UUID: 401", async () => {
    for (const t of [
      await token({ iss: "https://outro.supabase.co/auth/v1" }),
      await token({ aud: "anon" }),
      await token({ chave: estranho.privateKey }),
      await token({ exp: "-1h" }),
      await token({ sub: "../../admin" }),
      "nao.e.jwt",
    ]) {
      const m = montar();
      const r = await m.executar(pedir({ token: t }));
      expect(r.status).toBe(401);
      expect(m.chamadas).toEqual([]);
    }
  });

  it("defesa em profundidade: um verificador que devolvesse um sub estranho não chega à API", async () => {
    const { rede, chamadas } = redeFalsa({});
    const executar = criarExclusao(
      { supabaseUrl: URL_SUPABASE, chaveDeServico: SERVICO, origens: [], apple: null },
      { verificarToken: async () => ({ sub: "../../admin/users" }), rede, agora: () => Date.now() },
    );
    expect((await executar(pedir({ token: "qualquer" }))).status).toBe(401);
    expect(chamadas).toEqual([]);
  });

  it("o corpo NÃO escolhe quem é excluído: só o `sub` do token", async () => {
    const m = montar();
    const r = await m.executar(pedir({ token: await token(), corpo: { confirmacao: CONFIRMACAO, userId: OUTRO, sub: OUTRO } }));
    expect(r.status).toBe(200);
    expect(m.chamadas.every((x) => !x.url.includes(OUTRO))).toBe(true);
    expect(exclusoes(m.chamadas).map((x) => x.url)).toEqual([`${EMISSOR}/admin/users/${SUB}`]);
  });

  it("sem a confirmação explícita, nada é apagado", async () => {
    for (const corpo of [{}, { confirmacao: "excluir" }, { confirmacao: true }, null]) {
      const m = montar();
      const r = await m.executar(pedir({ token: await token(), corpo }));
      expect(r.status, JSON.stringify(corpo)).toBe(400);
      expect(exclusoes(m.chamadas)).toEqual([]);
    }
    const m = montar();
    expect((await m.executar(pedir({ token: await token(), bruto: "{nao json" }))).status).toBe(400);
    expect((await m.executar(pedir({ token: await token(), bruto: JSON.stringify({ confirmacao: CONFIRMACAO, x: "y".repeat(9000) }) }))).status).toBe(413);
    expect(exclusoes(m.chamadas)).toEqual([]);
  });
});

describe("a exclusão em si", () => {
  it("convidado (anônimo, sem provedor): exclusão REAL, com a chave de serviço só no servidor", async () => {
    const m = montar({ usuario: { identities: [] } });
    const r = await m.executar(pedir({ token: await token({ anonimo: true }) }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: "excluida", apple: "nao-se-aplica" });
    const [del] = exclusoes(m.chamadas);
    expect(JSON.parse(del.corpo!)).toEqual({ should_soft_delete: false });
    expect(del.cabecalhos.authorization).toBe(`Bearer ${SERVICO}`);
    expect(m.chamadas.some((x) => x.url.includes("appleid.apple.com"))).toBe(false);
  });

  it("idempotente: usuário que já não existe é \"ja-excluida\" (200), sem novo DELETE", async () => {
    const m = montar({ usuario: null });
    const r = await m.executar(pedir({ token: await token() }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ estado: "ja-excluida", apple: "nao-se-aplica" });
    expect(exclusoes(m.chamadas)).toEqual([]);
    const corrida = montar({ exclusaoStatus: 404 });
    expect(await (await corrida.executar(pedir({ token: await token() }))).json()).toEqual({ estado: "ja-excluida", apple: "nao-se-aplica" });
  });

  it("toque duplo (dois pedidos juntos): os dois respondem 200, nenhum vira erro", async () => {
    let existe = true;
    const base = redeFalsa({});
    const rede = (async (url: string | URL, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET" && String(url).includes("/admin/users/")) {
        return new Response(existe ? JSON.stringify({ identities: [] }) : "{}", { status: existe ? 200 : 404 });
      }
      if (init?.method === "DELETE") { const s = existe ? 200 : 404; existe = false; return new Response("{}", { status: s }); }
      return base.rede(url, init);
    }) as typeof fetch;
    const executar = criarExclusao(
      { supabaseUrl: URL_SUPABASE, chaveDeServico: SERVICO, origens: [], apple: null },
      { verificarToken: verificar, rede, agora: () => Date.now() },
    );
    const t = await token();
    const [a, b] = await Promise.all([executar(pedir({ token: t })), executar(pedir({ token: t }))]);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it("leitura indisponível: 502 e NADA apagado; exclusão que falha: 502 (o app deixa tentar de novo)", async () => {
    for (const c of [{ leituraStatus: 500 }, { redeCai: "leitura" as const }]) {
      const m = montar(c);
      const r = await m.executar(pedir({ token: await token() }));
      expect(r.status).toBe(502);
      expect(exclusoes(m.chamadas)).toEqual([]);
    }
    for (const c of [{ exclusaoStatus: 500 }, { redeCai: "exclusao" as const }]) {
      const m = montar(c);
      const r = await m.executar(pedir({ token: await token() }));
      expect(r.status).toBe(502);
      expect((await r.json()).erro).toBe("falha-ao-excluir");
    }
  });

  it("Google vinculado: nenhuma chamada à Apple", async () => {
    const m = montar({ usuario: { identities: [{ provider: "google", identity_data: { sub: "g-1" } }] } });
    expect((await (await m.executar(pedir({ token: await token() }))).json()).apple).toBe("nao-se-aplica");
    expect(m.chamadas.some((x) => x.url.includes("appleid.apple.com"))).toBe(false);
  });
});

describe("a revogação da Apple", () => {
  const comApple = { usuario: { identities: [{ provider: "apple", identity_data: { sub: "apple-sub-001" } }] } };

  it("troca o código NOVO e REVOGA o refresh token — antes de apagar", async () => {
    const m = montar(comApple);
    const r = await m.executar(pedir({ token: await token(), corpo: { confirmacao: CONFIRMACAO, apple: { codigo: "codigo-novo" } } }));
    expect(await r.json()).toEqual({ estado: "excluida", apple: "revogada" });
    const ordem = m.chamadas.map((x) => `${x.metodo} ${x.url.replace(URL_SUPABASE, "").split("?")[0]}`);
    expect(ordem).toEqual([
      `GET /auth/v1/admin/users/${SUB}`,
      "POST https://appleid.apple.com/auth/token",
      "POST https://appleid.apple.com/auth/revoke",
      `DELETE /auth/v1/admin/users/${SUB}`,
    ]);
    const troca = new URLSearchParams(m.chamadas[1].corpo);
    expect(troca.get("grant_type")).toBe("authorization_code");
    expect(troca.get("code")).toBe("codigo-novo");
    expect(troca.get("client_id")).toBe(APPLE.clientId);
    const revoga = new URLSearchParams(m.chamadas[2].corpo);
    expect(revoga.get("token")).toBe("rt-apple");
    expect(revoga.get("token_type_hint")).toBe("refresh_token");
  });

  it("sem código (exclusão feita fora do iPhone): exclui mesmo assim, e avisa \"sem-codigo\"", async () => {
    const m = montar(comApple);
    expect(await (await m.executar(pedir({ token: await token() }))).json()).toEqual({ estado: "excluida", apple: "sem-codigo" });
    expect(exclusoes(m.chamadas)).toHaveLength(1);
  });

  it("código de OUTRO Apple ID: não revoga a conta de ninguém, e a exclusão segue", async () => {
    const m = montar({ ...comApple, appleToken: { status: 200, corpo: { refresh_token: "rt-x", id_token: idTokenApple("apple-de-outra-pessoa") } } });
    const r = await m.executar(pedir({ token: await token(), corpo: { confirmacao: CONFIRMACAO, apple: { codigo: "c" } } }));
    expect(await r.json()).toEqual({ estado: "excluida", apple: "outra-conta" });
    expect(m.chamadas.some((x) => x.url.endsWith("/auth/revoke"))).toBe(false);
  });

  it("Apple fora do ar, ou segredos ausentes: a exclusão NÃO fica refém da Apple", async () => {
    const fora = montar({ ...comApple, appleToken: { status: 500 } });
    expect(await (await fora.executar(pedir({ token: await token(), corpo: { confirmacao: CONFIRMACAO, apple: { codigo: "c" } } }))).json())
      .toEqual({ estado: "excluida", apple: "falhou" });
    const semSegredo = montar(comApple, { apple: null });
    expect(await (await semSegredo.executar(pedir({ token: await token(), corpo: { confirmacao: CONFIRMACAO, apple: { codigo: "c" } } }))).json())
      .toEqual({ estado: "excluida", apple: "nao-configurada" });
  });
});

describe("CORS e privacidade", () => {
  it("preflight só devolve permissão para as origens do app", async () => {
    const m = montar();
    const ok = await m.executar(pedir({ metodo: "OPTIONS", origem: APP_ORIGEM }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(APP_ORIGEM);
    for (const o of ["https://localhost", "capacitor://localhost"]) {
      expect((await m.executar(pedir({ metodo: "OPTIONS", origem: o }))).headers.get("access-control-allow-origin")).toBe(o);
    }
    const fora = await m.executar(pedir({ metodo: "OPTIONS", origem: "https://evil.example" }));
    expect(fora.headers.get("access-control-allow-origin")).toBeNull();
    expect((await m.executar(pedir({ metodo: "GET" }))).status).toBe(405);
  });

  it("KING_ORIGENS_EXTRAS só aceita https://", () => {
    expect(origensPermitidas("https://preview.example.com, http://inseguro.com, javascript:alert(1)")).toContain("https://preview.example.com");
    expect(origensPermitidas("http://inseguro.com")).not.toContain("http://inseguro.com");
  });

  it("o log só tem o desfecho: nunca token, id ou e-mail", async () => {
    const m = montar({ usuario: { identities: [{ provider: "apple", identity_data: { sub: "apple-sub-001", email: "x@privaterelay.appleid.com" } }] } });
    const t = await token();
    await m.executar(pedir({ token: t, corpo: { confirmacao: CONFIRMACAO, apple: { codigo: "codigo-secreto" } } }));
    const tudo = m.log.join("\n");
    expect(tudo).toMatch(/exclusao: ok/);
    for (const proibido of [t, SUB, "apple-sub-001", "privaterelay", "codigo-secreto", "rt-apple", SERVICO]) {
      expect(tudo.includes(proibido), proibido).toBe(false);
    }
  });
});
