/**
 * O STACK LOCAL DA PROVA ONLINE DA SEQUÊNCIA — tudo de verdade, menos o Supabase hospedado.
 *
 *   Postgres 17 (embutido) COM TLS ─ certificados gerados aqui (CA própria, SAN 127.0.0.1);
 *     └─ bootstrap + migrações REAIS: identidade, progresso e SEQUÊNCIA;
 *   Supabase falso (./supabaseFalso.ts) ─ convidado anônimo, JWKS, REST com RLS de verdade;
 *   servidor do jogo COMPILADO (apps/server/dist) ─ identidade `permanent` conferindo JWT pelo
 *     JWKS, progresso `database` falando com o Postgres por TLS como `king_server`, outbox em disco;
 *   web (build `e2e-sequencia`, servida pelo `webServer` do Playwright).
 *
 * O MARCO: a migração grava o rollout com o relógio real e a margem de 5 min deixa de fora a
 * partida iniciada logo depois. Para a prova não esperar 5 minutos, o marco recua 10 min ("o
 * rollout aconteceu há 10 minutos") — gatilhos de imutabilidade desligados só para isso, num banco
 * descartável, e religados.
 *
 * Nada aqui toca rede externa, Supabase hospedado, Vercel ou VPS.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { subirSupabaseFalso, type SupabaseFalso } from "./supabaseFalso.js";

const RAIZ = new URL("../../../", import.meta.url);
const ler = (rel: string) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
export const PORTA_DO_JOGO = 2569;

function openssl(): string {
  for (const c of ["openssl", "C:/Program Files/Git/mingw64/bin/openssl.exe", "C:/Program Files/Git/usr/bin/openssl.exe"]) {
    try { execFileSync(c, ["version"], { stdio: "ignore" }); return c; } catch { /* próximo */ }
  }
  throw new Error("openssl não encontrado (precisa do Git for Windows ou do openssl no PATH)");
}

function certificados(dir: string) {
  const o = openssl();
  const p = (n: string) => join(dir, n).replace(/\\/g, "/");
  execFileSync(o, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", p("ca.key"), "-out", p("ca.pem"),
    "-days", "2", "-subj", "/CN=KING e2e CA local"], { stdio: "ignore" });
  execFileSync(o, ["req", "-newkey", "rsa:2048", "-nodes", "-keyout", p("servidor.key"), "-out", p("servidor.csr"),
    "-subj", "/CN=127.0.0.1"], { stdio: "ignore" });
  writeFileSync(p("ext.cnf"), "subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=CA:FALSE\n" +
    "keyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n");
  execFileSync(o, ["x509", "-req", "-in", p("servidor.csr"), "-CA", p("ca.pem"), "-CAkey", p("ca.key"), "-CAcreateserial",
    "-out", p("servidor.crt"), "-days", "2", "-extfile", p("ext.cnf")], { stdio: "ignore" });
  return { ca: p("ca.pem"), cert: p("servidor.crt"), chave: p("servidor.key") };
}

async function portaLivre(): Promise<number> {
  return await new Promise((ok, erro) => {
    const s = createServer();
    s.on("error", erro);
    s.listen(0, "127.0.0.1", () => { const porta = (s.address() as { port: number }).port; s.close(() => ok(porta)); });
  });
}

async function esperarNoLog(arquivo: string, padrao: RegExp, ms: number): Promise<void> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const t = existsSync(arquivo) ? readFileSync(arquivo, "utf8") : "";
    if (padrao.test(t)) return;
    if (/configuração .* inválida|open_auth|sonda do progresso falhou|Error:/i.test(t)) throw new Error(`servidor do jogo não subiu:\n${t}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`servidor do jogo não ficou pronto em ${ms} ms:\n${existsSync(arquivo) ? readFileSync(arquivo, "utf8") : "(sem log)"}`);
}

export interface StackDaSequencia {
  pgPorta: number;
  senhaAdmin: string;
  banco: string;
  supabase: string;
  log: string;
}

export default async function subirStack(): Promise<() => Promise<void>> {
  const dir = mkdtempSync(join(tmpdir(), "king-e2e-sequencia-"));
  const tls = certificados(dir);
  const senhaAdmin = randomBytes(18).toString("base64url");
  const senhaServidor = randomBytes(18).toString("base64url");
  const pgPorta = await portaLivre();

  const banco = new EmbeddedPostgres({
    databaseDir: join(dir, "data"), port: pgPorta, user: "postgres", password: senhaAdmin, persistent: false,
    authMethod: "scram-sha-256", initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {},
    postgresFlags: ["-c", "ssl=on", "-c", `ssl_cert_file=${tls.cert}`, "-c", `ssl_key_file=${tls.chave}`],
  });
  await banco.initialise();
  await banco.start();

  const conectar = async (database: string) => {
    const c = new pg.Client({ host: "127.0.0.1", port: pgPorta, database, user: "postgres", password: senhaAdmin });
    await c.connect();
    return c;
  };
  const adm = await conectar("postgres");
  await adm.query("create database king");
  await adm.end();
  const c = await conectar("king");
  await c.query(ler("supabase/tests/bootstrap-supabase-local.sql"));
  await c.query(ler("supabase/migrations/20260830120000_identidade.sql"));
  await c.query(ler("supabase/migrations/20260925120000_progresso.sql"));
  // KING_E2E_SEM_SEQUENCIA=1: o banco como a Production está HOJE, sem a migração da sequência —
  // para provar que a web nova funciona com o esquema antigo (playwright.sequencia-compat.config.ts).
  if (!process.env.KING_E2E_SEM_SEQUENCIA) {
    await c.query(ler("supabase/migrations/20261001120000_sequencia.sql"));
    // "o rollout aconteceu há 10 minutos" — ver o cabeçalho
    await c.query("alter table king_private.sequencia_inicio disable trigger user");
    await c.query("update king_private.sequencia_inicio set aplicado_em = aplicado_em - interval '10 minutes', " +
      "partidas_a_partir_de = partidas_a_partir_de - interval '10 minutes'");
    await c.query("alter table king_private.sequencia_inicio enable trigger user");
  }
  await c.query(`alter role king_server login password '${senhaServidor}'`);
  await c.end();

  // datas do PostgREST são texto (AAAA-MM-DD), não Date
  pg.types.setTypeParser(1082, (v: string) => v);
  const pool = new pg.Pool({ host: "127.0.0.1", port: pgPorta, database: "king", user: "postgres", password: senhaAdmin, max: 4 });
  const supabase: SupabaseFalso = await subirSupabaseFalso(pool);

  const envIdentidade = join(dir, "king.env");
  writeFileSync(envIdentidade, `KING_IDENTITY_MODE=permanent\nSUPABASE_URL=${supabase.origem}\n`);
  const envProgresso = join(dir, "progress.env");
  const outbox = join(dir, "outbox");
  writeFileSync(envProgresso, [
    "KING_PROGRESS_MODE=database",
    `KING_PROGRESS_DATABASE_URL=postgresql://king_server:${senhaServidor}@127.0.0.1:${pgPorta}/king`,
    `KING_PROGRESS_SSL_ROOT_CERT=${tls.ca}`,
    `KING_PROGRESS_OUTBOX_DIR=${outbox.replace(/\\/g, "/")}`,
  ].join("\n") + "\n");

  const log = join(dir, "servidor-do-jogo.log");
  const fd = openSync(log, "a");
  const ambiente = { ...process.env };
  for (const k of Object.keys(ambiente)) if (/^(SUPABASE_|KING_)/.test(k)) delete ambiente[k];
  const servidor: ChildProcess = spawn(process.execPath, [fileURLToPath(new URL("apps/server/dist/index.js", RAIZ))], {
    env: { ...ambiente, PORT: String(PORTA_DO_JOGO), KING_ENV_FILE: envIdentidade, KING_PROGRESS_ENV_FILE: envProgresso, NODE_ENV: "test" },
    stdio: ["ignore", fd, fd],
  });
  await esperarNoLog(log, /\[king\] progresso: closed/, 60_000);

  const info: StackDaSequencia = { pgPorta, senhaAdmin, banco: "king", supabase: supabase.origem, log };
  process.env.KING_E2E_SEQUENCIA = JSON.stringify(info);

  return async () => {
    servidor.kill();
    await supabase.fechar().catch(() => {});
    await pool.end().catch(() => {});
    await banco.stop().catch(() => {});
    if (!process.env.KING_E2E_MANTER) rmSync(dir, { recursive: true, force: true });
  };
}
