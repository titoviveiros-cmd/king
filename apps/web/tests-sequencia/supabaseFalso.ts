/**
 * UM SUPABASE FALSO, MAS COM O BANCO DE VERDADE — só para a prova online local da sequência.
 *
 * Emula as CINCO coisas que o KING usa do Supabase, e nada mais:
 *   • POST /auth/v1/signup            — convidado anônimo: cria `auth.users` (o gatilho da
 *                                       identidade cria o `players`) e devolve uma sessão;
 *   • POST /auth/v1/token (refresh)   — renova a sessão;
 *   • GET  /auth/v1/.well-known/jwks.json — a chave PÚBLICA que o servidor do jogo usa para conferir
 *                                       o token (o mesmo caminho do Supabase de verdade);
 *   • GET  /rest/v1/meu_progresso     — a leitura do jogador, executada como `authenticated` com os
 *   • GET  /rest/v1/xp_eventos          claims do token: o RLS de verdade decide o que ele vê.
 *
 * Os tokens são JWT ES256 assinados aqui; o emissor (`iss`) é ESTE servidor, no loopback por HTTP —
 * o servidor do jogo só aceita isso no loopback ("para prova local", `config/ambiente.ts`). O
 * navegador nunca fala com ele direto: o Playwright redireciona o host fictício do build para cá.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair, jwtVerify } from "jose";
import type pg from "pg";

export interface SupabaseFalso {
  origem: string;
  emissor: string;
  chamadas: string[];
  fechar(): Promise<void>;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

export async function subirSupabaseFalso(pool: pg.Pool): Promise<SupabaseFalso> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const kid = `king-e2e-${randomUUID().slice(0, 8)}`;
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
  const refreshes = new Map<string, string>();
  const chamadas: string[] = [];
  let emissor = "";

  const usuario = (id: string) => ({
    id, aud: "authenticated", role: "authenticated", email: "", phone: "", is_anonymous: true,
    app_metadata: { provider: "anonymous", providers: ["anonymous"] }, user_metadata: {}, identities: [],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });

  async function sessaoPara(id: string) {
    const agora = Math.floor(Date.now() / 1000);
    const access_token = await new SignJWT({
      role: "authenticated", is_anonymous: true, session_id: randomUUID(), aal: "aal1",
      app_metadata: { provider: "anonymous", providers: ["anonymous"] }, user_metadata: {},
    })
      .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
      .setSubject(id).setIssuer(emissor).setAudience("authenticated")
      .setIssuedAt(agora).setExpirationTime(agora + 3600)
      .sign(privateKey);
    const refresh_token = randomUUID();
    refreshes.set(refresh_token, id);
    return { access_token, token_type: "bearer", expires_in: 3600, expires_at: agora + 3600, refresh_token, user: usuario(id) };
  }

  async function claims(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) return null;
    try {
      const { payload } = await jwtVerify(h.slice(7), publicKey, { issuer: emissor, audience: "authenticated" });
      return payload as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const lerCorpo = (req: IncomingMessage) => new Promise<string>((ok, erro) => {
    let t = "";
    req.on("data", (c: Buffer) => { t += c.toString("utf8"); });
    req.on("end", () => ok(t));
    req.on("error", erro);
  });

  function responder(res: ServerResponse, status: number, corpo: unknown) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
    });
    res.end(corpo === null ? "" : JSON.stringify(corpo));
  }

  /** Uma leitura como o PostgREST faria: papel `authenticated`, claims do token, RLS valendo. */
  async function lerComoJogador(tabela: string, url: URL, c: Record<string, unknown>) {
    const sel = url.searchParams.get("select") ?? "*";
    const colunas = sel === "*" ? "*" : sel.split(",").map((x) => x.trim()).filter((x) => {
      if (!IDENT.test(x)) throw new Error(`coluna inválida: ${x}`);
      return true;
    }).join(", ");
    const filtros: string[] = [];
    const valores: unknown[] = [];
    for (const [chave, valor] of url.searchParams) {
      if (chave === "select") continue;
      if (!IDENT.test(chave) || !valor.startsWith("eq.")) throw new Error(`filtro não emulado: ${chave}=${valor}`);
      valores.push(valor.slice(3));
      filtros.push(`${chave} = $${valores.length}`);
    }
    const cliente = await pool.connect();
    try {
      await cliente.query("begin");
      await cliente.query("set local role authenticated");
      await cliente.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(c)]);
      const r = await cliente.query(`select ${colunas} from public.${tabela}${filtros.length ? ` where ${filtros.join(" and ")}` : ""}`, valores);
      await cliente.query("commit");
      return r.rows;
    } catch (e) {
      await cliente.query("rollback").catch(() => {});
      throw e;
    } finally {
      cliente.release();
    }
  }

  async function tratar(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    chamadas.push(`${req.method} ${url.pathname}`);
    if (req.method === "OPTIONS") return responder(res, 204, null);
    if (url.pathname === "/auth/v1/.well-known/jwks.json") return responder(res, 200, { keys: [jwk] });
    if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
      await lerCorpo(req);
      const id = randomUUID();
      await pool.query("insert into auth.users (id) values ($1)", [id]); // o gatilho cria o `players`
      return responder(res, 200, await sessaoPara(id));
    }
    if (url.pathname === "/auth/v1/token" && req.method === "POST" && url.searchParams.get("grant_type") === "refresh_token") {
      const corpo = JSON.parse((await lerCorpo(req)) || "{}") as { refresh_token?: string };
      const id = corpo.refresh_token ? refreshes.get(corpo.refresh_token) : undefined;
      if (!id) return responder(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
      return responder(res, 200, await sessaoPara(id));
    }
    if (url.pathname === "/auth/v1/user") {
      const c = await claims(req);
      return c ? responder(res, 200, usuario(String(c.sub))) : responder(res, 401, { message: "invalid JWT" });
    }
    if (url.pathname === "/auth/v1/logout") return responder(res, 204, null);
    const rest = /^\/rest\/v1\/(meu_progresso|xp_eventos)$/.exec(url.pathname);
    if (rest && req.method === "GET") {
      const c = await claims(req);
      if (!c) return responder(res, 401, { message: "JWT inválido" });
      return responder(res, 200, await lerComoJogador(rest[1], url, c));
    }
    return responder(res, 404, { message: `rota não emulada: ${req.method} ${url.pathname}` });
  }

  const server = createServer((req, res) => {
    tratar(req, res).catch((e: unknown) => responder(res, 500, { message: String((e as Error)?.message ?? e) }));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const porta = (server.address() as { port: number }).port;
  const origem = `http://127.0.0.1:${porta}`;
  emissor = `${origem}/auth/v1`;
  return {
    origem, emissor, chamadas,
    fechar: () => new Promise<void>((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }),
  };
}
