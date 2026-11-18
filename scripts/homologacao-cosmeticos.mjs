#!/usr/bin/env node
// HOMOLOGAÇÃO ISOLADA DAS ENTREGAS B e C — para testar no iPhone (e em qualquer aparelho do mesmo Wi-Fi)
// SEM banco real, sem Supabase real, sem a VPS. Tudo nasce neste PC e morre ao sair (Ctrl+C).
//
//   Postgres 17 local, com TLS (CA própria) ── todas as migrações + o ROLLOUT dos cosméticos,
//      │                                         aplicado pelo arquivo exato de Production
//      ├── "mini Supabase" (/auth/v1, /rest/v1): só os endpoints que a web usa, sobre o banco
//      │     REAL desta máquina — RLS, GRANTs e a porta `equipar_item` de verdade, com o JWT
//      │     de cada aparelho (ES256, JWKS local)
//      ├── servidor de jogo DESTA branch (apps/server/dist), identidade `permanent` + progresso
//      │     `database` pelo papel `king_server`, com TLS verificado contra a CA própria
//      └── web DESTA branch, construída apontando para cá
//
//   Uma porta HTTPS só (padrão 8443) serve a web, o mini Supabase, o painel /homolog e repassa o
//   matchmaking e o WebSocket ao servidor de jogo. Assim o aparelho aceita UM certificado.
//
//   node scripts/homologacao-cosmeticos.mjs [--ip 192.168.x.y] [--porta 8443] [--sem-build]
//
// O painel https://IP:PORTA/homolog lista as contas que entraram e dá XP SINTÉTICO a cada uma — o XP
// EXATO de cada nível de 1 a 18 — só neste banco descartável, para ver cada desbloqueio da curva do
// catálogo (Entrega C) na hora em que ele acontece.
// Pré-requisitos: `npm run build` já rodado nesta árvore (o servidor compilado) e `openssl` no PATH.
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, importJWK } from "jose";
import { spawn, spawnSync } from "node:child_process";
import { createServer as criarHttps } from "node:https";
import { createServer as criarHttp, request as pedirHttp } from "node:http";
import { connect as conectarTcp, createServer as criarTcp } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const RAIZ = new URL("../", import.meta.url);
const caminho = (rel) => new URL(rel, RAIZ).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ler = (rel) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
const arg = (nome, padrao) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : padrao; };

const IP = arg("--ip", Object.values(networkInterfaces()).flat()
  .find((n) => n && n.family === "IPv4" && !n.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(n.address))?.address ?? "127.0.0.1");
const PORTA = Number(arg("--porta", "8443"));
const ORIGEM = `https://${IP}:${PORTA}`;
const livre = () => new Promise((ok) => { const s = criarTcp(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
const PORTA_PG = await livre();
const PORTA_JOGO = await livre();
const PORTA_JWKS = await livre(); // loopback: o servidor de jogo só aceita http:// no 127.0.0.1
const DIR = mkdtempSync(join(tmpdir(), "king-homologacao-"));
const fwd = (p) => p.replace(/\\/g, "/");
const log = (...a) => console.log("[homologação]", ...a);
const filhos = [];
let banco = null;

async function encerrar(codigo = 0) {
  for (const f of filhos) { try { f.kill(); } catch { /* já saiu */ } }
  if (banco) await banco.stop().catch(() => {});
  try { rmSync(DIR, { recursive: true, force: true }); } catch { /* arquivo preso no Windows: o tmp limpa depois */ }
  process.exit(codigo);
}
process.on("SIGINT", () => { log("encerrando…"); void encerrar(0); });

// ── 1. CA própria + certificados (Postgres: localhost; HTTPS: o IP do Wi-Fi) ─────────────────
function openssl(...a) {
  const r = spawnSync("openssl", a, { cwd: DIR, env: { ...process.env, MSYS_NO_PATHCONV: "1" }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`openssl ${a[0]} falhou: ${r.stderr}`);
}
openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-days", "3", "-subj", "/CN=KING homologacao local CA");
for (const [nome, san] of [["pg", "DNS:localhost,IP:127.0.0.1"], ["web", `IP:${IP},DNS:localhost,IP:127.0.0.1`]]) {
  writeFileSync(join(DIR, `${nome}.ext`), `subjectAltName=${san}\n`);
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", `${nome}.key`, "-out", `${nome}.csr`, "-subj", `/CN=${nome === "pg" ? "localhost" : IP}`);
  openssl("x509", "-req", "-in", `${nome}.csr`, "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", `${nome}.crt`, "-days", "3", "-extfile", `${nome}.ext`);
}

// ── 2. Postgres com TLS + o banco como Production + o ROLLOUT dos cosméticos ─────────────────
const SENHA = { admin: randomBytes(18).toString("base64url"), servidor: randomBytes(18).toString("base64url"), editor: randomBytes(18).toString("base64url") };
banco = new EmbeddedPostgres({
  databaseDir: join(DIR, "data"), port: PORTA_PG, user: "postgres", password: SENHA.admin, persistent: false,
  authMethod: "scram-sha-256", initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {},
  postgresFlags: ["-c", "ssl=on", "-c", `ssl_cert_file=${fwd(join(DIR, "pg.crt"))}`, "-c", `ssl_key_file=${fwd(join(DIR, "pg.key"))}`],
});
await banco.initialise();
await banco.start();
const conectar = async (database, user = "postgres", password = SENHA.admin) => {
  const c = new pg.Client({ host: "127.0.0.1", port: PORTA_PG, database, user, password });
  await c.connect();
  return c;
};
{
  const adm = await conectar("postgres");
  await adm.query(`create role supa_postgres login nosuperuser inherit password '${SENHA.editor}'`);
  await adm.query("create database king owner supa_postgres");
  await adm.end();
  const c = await conectar("king");
  await c.query(ler("supabase/tests/bootstrap-supabase-local.sql"));
  for (const m of ["20260830120000_identidade", "20260925120000_progresso", "20261001120000_sequencia",
    "20261025130000_credito_com_conta_excluida", "20261026120000_retencao_das_lapides"]) {
    await c.query(ler(`supabase/migrations/${m}.sql`));
  }
  await c.query(`alter role king_server login password '${SENHA.servidor}'`);
  await c.query("grant king_progress_owner to supa_postgres; grant usage on schema auth to supa_postgres");
  await c.end();
  // os cosméticos entram pelo MESMO arquivo que iria para o SQL Editor de Production
  const editor = await conectar("king", "supa_postgres", SENHA.editor);
  const r = await editor.query(ler("supabase/rollout/cosmeticos-aplicar.sql"));
  const ultima = Array.isArray(r) ? r[r.length - 1] : r;
  if (ultima.rows[0]?.resultado !== "COSMÉTICOS (ENTREGA B) APLICADA E CONFERIDA") throw new Error("o rollout não conferiu");
  await editor.end();
  log("banco: todas as migrações + rollout dos cosméticos APLICADO E CONFERIDO");
}
const admin = new pg.Pool({ host: "127.0.0.1", port: PORTA_PG, database: "king", user: "postgres", password: SENHA.admin, max: 6 });

// ── 3. Identidade: chave ES256 desta execução; JWKS no loopback para o servidor de jogo ───────
const { privateKey, publicKey } = await generateKeyPair("ES256");
const JWK = { ...(await exportJWK(publicKey)), kid: "homologacao", alg: "ES256", use: "sig" };
const ISS = `http://127.0.0.1:${PORTA_JWKS}/auth/v1`;
criarHttp((q, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ keys: [JWK] }));
}).listen(PORTA_JWKS, "127.0.0.1");
const chavePublica = await importJWK(JWK, "ES256");
const renovacoes = new Map(); // refresh token → uid
async function sessao(uid) {
  const agora = Math.floor(Date.now() / 1000);
  const access_token = await new SignJWT({ sub: uid, role: "authenticated", aud: "authenticated", is_anonymous: true })
    .setProtectedHeader({ alg: "ES256", kid: "homologacao" }).setIssuer(ISS).setIssuedAt(agora).setExpirationTime(agora + 3600)
    .sign(privateKey);
  const refresh_token = randomBytes(24).toString("base64url");
  renovacoes.set(refresh_token, uid);
  return { access_token, token_type: "bearer", expires_in: 3600, expires_at: agora + 3600, refresh_token, user: usuario(uid) };
}
const usuario = (id) => ({ id, aud: "authenticated", role: "authenticated", is_anonymous: true, email: "", phone: "",
  app_metadata: { provider: "anonymous", providers: ["anonymous"] }, user_metadata: {}, identities: [],
  created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
async function quem(q) {
  const t = /^Bearer (.+)$/i.exec(q.headers.authorization ?? "")?.[1];
  if (!t) return null;
  try { return (await jwtVerify(t, chavePublica, { issuer: ISS, audience: "authenticated" })).payload; } catch { return null; }
}
/** Uma consulta COMO O APARELHO: papel `authenticated` e o `sub` no JWT, como o PostgREST faz. */
async function comoCliente(claims, sql, params) {
  const c = await admin.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const r = await c.query(sql, params);
    await c.query("commit");
    return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

// ── 4. Servidor de jogo DESTA branch ───────────────────────────────────────────────────────
if (!existsSync(caminho("apps/server/dist/index.js"))) throw new Error("rode `npm run build` antes (servidor compilado ausente)");
writeFileSync(join(DIR, "server.env"), `KING_IDENTITY_MODE=permanent\nSUPABASE_URL=http://127.0.0.1:${PORTA_JWKS}\n`);
mkdirSync(join(DIR, "outbox"));
writeFileSync(join(DIR, "progress.env"), [
  "KING_PROGRESS_MODE=database",
  `KING_PROGRESS_DATABASE_URL=postgres://king_server:${encodeURIComponent(SENHA.servidor)}@localhost:${PORTA_PG}/king`,
  `KING_PROGRESS_SSL_ROOT_CERT=${join(DIR, "ca.crt")}`,
  `KING_PROGRESS_OUTBOX_DIR=${join(DIR, "outbox")}`, ""].join("\n"));
const jogo = spawn(process.execPath, [caminho("apps/server/dist/index.js")], {
  env: { ...process.env, PORT: String(PORTA_JOGO), KING_ENV_FILE: join(DIR, "server.env"), KING_PROGRESS_ENV_FILE: join(DIR, "progress.env") },
  stdio: ["ignore", "pipe", "pipe"],
});
filhos.push(jogo);
jogo.stdout.on("data", (d) => { for (const l of String(d).split("\n")) if (/progress|progresso|identity|listening|escutando/i.test(l)) log("jogo:", l.trim()); });
jogo.stderr.on("data", (d) => log("jogo (erro):", String(d).trim()));

// ── 5. Web DESTA branch, apontando para cá ─────────────────────────────────────────────────
const WEB = join(DIR, "web");
if (!process.argv.includes("--sem-build") || !existsSync(join(WEB, "index.html"))) {
  const b = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "build", "--mode", "e2e", "--outDir", WEB, "--emptyOutDir"], {
    cwd: caminho("apps/web"), shell: process.platform === "win32", encoding: "utf8",
    env: { ...process.env, VITE_SUPABASE_URL: ORIGEM, VITE_SUPABASE_PUBLISHABLE_KEY: "homologacao-local", VITE_KING_SERVER_URL: `wss://${IP}:${PORTA}` },
  });
  if (b.status !== 0) throw new Error(`build da web falhou: ${b.stderr || b.stdout}`);
  log("web construída para", ORIGEM);
}

// ── 6. A porta HTTPS única ─────────────────────────────────────────────────────────────────
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer, x-supabase-api-version",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-expose-headers": "content-range, x-supabase-api-version",
};
const json = (res, status, corpo) => { res.writeHead(status, { ...CORS, "content-type": "application/json" }); res.end(corpo === undefined ? "" : JSON.stringify(corpo)); };
const corpo = (q) => new Promise((ok) => { let s = ""; q.on("data", (d) => { s += d; }); q.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { ok({}); } }); });
const erroPg = (res, e) => json(res, e.code === "42501" ? 403 : 400, { code: e.code ?? "PGRST000", message: e.message, details: null, hint: null });
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".txt": "text/plain" };
const UUID = /^[0-9a-f-]{36}$/i;

async function rest(q, res, url) {
  const c = await quem(q);
  if (!c) return json(res, 401, { code: "PGRST301", message: "JWT inválido ou ausente" });
  const objeto = (q.headers.accept ?? "").includes("vnd.pgrst.object");
  const devolver = (linhas) => objeto
    ? (linhas.length === 1 ? json(res, 200, linhas[0]) : json(res, 406, { code: "PGRST116", message: `${linhas.length} linhas` }))
    : json(res, 200, linhas);
  try {
    if (q.method === "GET" && url.pathname === "/rest/v1/meu_progresso") return devolver(await comoCliente(c, "select * from public.meu_progresso"));
    if (q.method === "GET" && url.pathname === "/rest/v1/cosmeticos_equipados") {
      return devolver(await comoCliente(c, "select moldura, baralho, reacoes, toalha from public.cosmeticos_equipados"));
    }
    if (q.method === "GET" && url.pathname === "/rest/v1/xp_eventos") {
      const id = /^eq\.(.+)$/.exec(url.searchParams.get("partida_id") ?? "")?.[1] ?? "";
      if (!UUID.test(id)) return json(res, 400, { code: "22P02", message: "partida_id" });
      return devolver(await comoCliente(c, "select xp_delta, posicao from public.xp_eventos where partida_id = $1", [id]));
    }
    if (q.method === "POST" && url.pathname === "/rest/v1/rpc/equipar_item") {
      const b = await corpo(q);
      return devolver(await comoCliente(c, "select * from public.equipar_item($1, $2)", [b.p_item ?? null, b.p_equipado ?? null]));
    }
    // as portas das partes 1 e 2 continuam respondendo (o cliente da Entrega B ainda as usaria)
    if (q.method === "POST" && url.pathname === "/rest/v1/rpc/equipar_cosmetico") {
      const b = await corpo(q);
      return devolver(await comoCliente(c, "select * from public.equipar_cosmetico($1, $2)", [b.p_item ?? null, b.p_equipado ?? null]));
    }
    if (q.method === "POST" && url.pathname === "/rest/v1/rpc/equipar_toalha") {
      const b = await corpo(q);
      return devolver(await comoCliente(c, "select * from public.equipar_toalha($1)", [b.p_toalha ?? null]));
    }
    return json(res, 404, { code: "PGRST205", message: `não existe nesta homologação: ${q.method} ${url.pathname}` });
  } catch (e) { return erroPg(res, e); }
}

async function auth(q, res, url) {
  if (q.method === "POST" && url.pathname === "/auth/v1/signup") {
    const uid = randomUUID();
    await admin.query("insert into auth.users (id) values ($1)", [uid]); // o gatilho cria `players`
    log("conta anônima criada", uid.slice(0, 8));
    return json(res, 200, await sessao(uid));
  }
  if (q.method === "POST" && url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
    const b = await corpo(q);
    const uid = renovacoes.get(b.refresh_token);
    if (!uid) return json(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
    renovacoes.delete(b.refresh_token);
    return json(res, 200, await sessao(uid));
  }
  if (q.method === "GET" && url.pathname === "/auth/v1/user") {
    const c = await quem(q);
    return c ? json(res, 200, usuario(c.sub)) : json(res, 401, { code: 401, msg: "invalid JWT" });
  }
  if (q.method === "POST" && url.pathname === "/auth/v1/logout") return json(res, 204);
  return json(res, 404, { code: 404, msg: `não existe nesta homologação: ${url.pathname}` });
}

/** O XP em que cada nível começa, do 1 ao 18 (a curva de `public.xp_para_nivel`): 0, 100, 250, …, 8500. */
const XP_DOS_NIVEIS = Array.from({ length: 18 }, (_, i) => (i === 0 ? 0 : 25 * (i + 1) * (i + 2) - 50));

const PAINEL = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Homologação — XP sintético</title><style>body{font:16px system-ui;margin:16px;background:#111;color:#eee}button{font-size:15px;margin:2px;padding:8px}td{padding:6px}</style>
<h1>Homologação isolada (banco descartável)</h1><p>XP <b>sintético</b>: só existe neste PC. Cada botão é o NÍVEL (N2 a N18), com o XP exato de onde ele começa.</p>
<table id="t"></table><script>
const NIVEIS=${JSON.stringify(XP_DOS_NIVEIS)};
async function carregar(){const r=await fetch("/homolog/contas");const l=await r.json();
document.getElementById("t").innerHTML=l.map(c=>"<tr><td>"+c.id.slice(0,8)+"</td><td>"+c.xp+" XP · nível "+c.nivel+"</td><td>"+NIVEIS.map((x,i)=>"<button onclick=dar('"+c.id+"',"+x+")>N"+(i+1)+"</button>").join("")+"</td><td>"+c.equipados+"</td></tr>").join("")||"<tr><td>nenhuma conta ainda: abra o jogo e entre numa sala online</td></tr>";}
async function dar(id,xp){await fetch("/homolog/xp",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id,xp})});carregar();}
carregar();setInterval(carregar,3000);</script>`;

async function painel(q, res, url) {
  if (url.pathname === "/homolog") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(PAINEL); }
  if (url.pathname === "/homolog/contas") {
    const r = await admin.query(`select p.id::text, coalesce(g.xp_total, 0) as xp, public.nivel_de(coalesce(g.xp_total, 0)) as nivel,
      concat_ws(' · ', 'moldura ' || c.moldura, 'baralho ' || c.baralho, 'reações ' || nullif(array_to_string(c.reacoes, ','), ''), 'mesa ' || c.toalha) as equipados
      from public.players p left join public.progresso g on g.player_id = p.id left join public.cosmeticos_equipados c on c.player_id = p.id order by p.id`);
    return json(res, 200, r.rows);
  }
  if (url.pathname === "/homolog/xp" && q.method === "POST") {
    const b = await corpo(q);
    if (!UUID.test(b.id ?? "") || !XP_DOS_NIVEIS.includes(b.xp)) return json(res, 400, { erro: "id/xp" });
    await admin.query(`insert into public.progresso (player_id, xp_total) values ($1, $2)
      on conflict (player_id) do update set xp_total = excluded.xp_total`, [b.id, b.xp]);
    log(`XP sintético: ${b.id.slice(0, 8)} → ${b.xp}`);
    return json(res, 200, { ok: true });
  }
  return json(res, 404, {});
}

function estatico(res, url) {
  let arquivo = join(WEB, decodeURIComponent(url.pathname));
  if (!arquivo.startsWith(WEB) || !existsSync(arquivo) || statSync(arquivo).isDirectory()) arquivo = join(WEB, "index.html");
  res.writeHead(200, { "content-type": TIPOS[extname(arquivo)] ?? "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(arquivo));
}

const https = criarHttps({ key: readFileSync(join(DIR, "web.key")), cert: readFileSync(join(DIR, "web.crt")) }, async (q, res) => {
  const url = new URL(q.url, ORIGEM);
  try {
    // o CORS do matchmaking é do próprio Colyseus (como em Production): o preflight vai junto para ele
    if (q.method === "OPTIONS" && !url.pathname.startsWith("/matchmake")) { res.writeHead(204, CORS); return res.end(); }
    if (url.pathname.startsWith("/auth/v1/")) return await auth(q, res, url);
    if (url.pathname.startsWith("/rest/v1/")) return await rest(q, res, url);
    if (url.pathname.startsWith("/homolog")) return await painel(q, res, url);
    if (url.pathname.startsWith("/matchmake")) {
      const p = pedirHttp({ host: "127.0.0.1", port: PORTA_JOGO, path: q.url, method: q.method, headers: { ...q.headers, host: `127.0.0.1:${PORTA_JOGO}` } },
        (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
      p.on("error", () => json(res, 502, { erro: "servidor de jogo fora" }));
      return void q.pipe(p);
    }
    return estatico(res, url);
  } catch (e) { return json(res, 500, { erro: String(e?.message ?? e) }); }
});
// WebSocket (wss → ws do servidor de jogo, no loopback)
https.on("upgrade", (q, socket, cabeca) => {
  const alvo = conectarTcp(PORTA_JOGO, "127.0.0.1", () => {
    const linhas = [`${q.method} ${q.url} HTTP/1.1`];
    for (let i = 0; i < q.rawHeaders.length; i += 2) {
      linhas.push(`${q.rawHeaders[i]}: ${q.rawHeaders[i].toLowerCase() === "host" ? `127.0.0.1:${PORTA_JOGO}` : q.rawHeaders[i + 1]}`);
    }
    alvo.write(linhas.join("\r\n") + "\r\n\r\n");
    if (cabeca?.length) alvo.write(cabeca);
    socket.pipe(alvo).pipe(socket);
  });
  alvo.on("error", () => socket.destroy());
  socket.on("error", () => alvo.destroy());
});
await new Promise((ok) => https.listen(PORTA, "0.0.0.0", ok));

console.log(`
══════════════════════════════════════════════════════════════════════
 HOMOLOGAÇÃO ISOLADA NO AR (nada real é tocado)
   Jogo:   ${ORIGEM}
   Painel: ${ORIGEM}/homolog   (XP sintético por conta)
   CA:     ${join(DIR, "ca.crt")}   (só se o aparelho recusar o certificado)
 Ctrl+C encerra e apaga tudo.
══════════════════════════════════════════════════════════════════════`);
if (process.argv.includes("--sair-apos-subir")) await encerrar(0);
