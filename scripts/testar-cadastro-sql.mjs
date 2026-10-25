// TESTES DO GANCHO "CONTA SÓ NASCE COMO CONVIDADO" — Postgres REAL, descartável.
//
// Sobe um Postgres 17 embutido (o mesmo `embedded-postgres` da suíte de progresso) num diretório
// temporário FORA do repositório, aplica o bootstrap que emula o mínimo do Supabase e a migração
// real, e roda os testes. Ao terminar, o banco é destruído.
//
// O que se prova: o convidado passa; quem nasceria com Google/Apple é recusado (por qualquer um dos
// três lugares onde o Auth pode dizer isso); NENHUM formato estranho de evento faz a função lançar
// (lançar reprovaria até o cadastro do convidado); só o Auth executa; e o rollback desfaz.
//
// Com `--provas`, cada proteção é removida por uma MUTAÇÃO EM MEMÓRIA do texto da migração — o
// arquivo em disco nunca é tocado — e os testes que dependem dela precisam REPROVAR.
//
//   node scripts/testar-cadastro-sql.mjs [--provas]
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";

const RAIZ = new URL("../", import.meta.url);
const ler = (rel) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
const BOOTSTRAP = ler("supabase/tests/bootstrap-supabase-local.sql");
const MIGRACAO = ler("supabase/migrations/20261025120000_cadastro_so_convidado.sql");
const ROLLBACK = ler("supabase/rollback/20261025120000_cadastro_so_convidado_rollback.sql");
const FUNCAO = "public.king_antes_de_criar_usuario";

const afirmar = (cond, msg) => { if (!cond) throw new Error(msg); };

async function portaLivre() {
  return await new Promise((ok, erro) => {
    const s = createServer();
    s.on("error", erro);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

const SENHA = randomBytes(18).toString("base64url");
let PORTA = 0;
const conectar = async (database) => {
  const c = new pg.Client({ host: "127.0.0.1", port: PORTA, database, user: "postgres", password: SENHA });
  await c.connect();
  return c;
};

/** Chama o gancho como o Auth chama (papel supabase_auth_admin). */
async function gancho(c, evento) {
  await c.query("set role supabase_auth_admin");
  try {
    const r = await c.query(`select ${FUNCAO}($1::jsonb) as r`, [evento === undefined ? null : JSON.stringify(evento)]);
    return r.rows[0].r;
  } finally {
    await c.query("reset role");
  }
}
const recusou = (r) => r?.error?.http_code === 403 && typeof r?.error?.message === "string";
const aceitou = (r) => r && typeof r === "object" && Object.keys(r).length === 0;
const usuario = (u) => ({ metadata: { uuid: "x", time: "2026-10-25T12:00:00Z", name: "before-user-created", ip_address: "127.0.0.1" }, user: u });

const TESTES = [
  { id: "C1", nome: "o convidado anônimo passa (o caminho de todo jogador)", async fn(c) {
    for (const u of [
      { id: "u", aud: "authenticated", role: "authenticated", email: "", phone: "", is_anonymous: true, app_metadata: {}, identities: [] },
      { is_anonymous: true, app_metadata: { provider: "anonymous", providers: ["anonymous"] } },
      { is_anonymous: true },
    ]) afirmar(aceitou(await gancho(c, usuario(u))), `convidado recusado: ${JSON.stringify(u)}`);
  } },
  { id: "C2", nome: "nasce com Google/Apple pelo app_metadata.provider → recusado (403)", async fn(c) {
    for (const p of ["google", "apple"]) {
      afirmar(recusou(await gancho(c, usuario({ is_anonymous: false, app_metadata: { provider: p } }))), `${p} passou pelo provider`);
    }
  } },
  { id: "C3", nome: "nasce com Google/Apple só na lista providers → recusado", async fn(c) {
    for (const p of ["google", "apple"]) {
      afirmar(recusou(await gancho(c, usuario({ app_metadata: { providers: ["email", p] } }))), `${p} passou pela lista providers`);
    }
  } },
  { id: "C4", nome: "nasce com Google/Apple só nas identities → recusado", async fn(c) {
    for (const p of ["google", "apple"]) {
      afirmar(recusou(await gancho(c, usuario({ app_metadata: {}, identities: [{ provider: p, identity_data: { sub: "1" } }] }))), `${p} passou pelas identities`);
    }
  } },
  { id: "C5", nome: "cadastro por e-mail não é recusado aqui (é desligado no painel, não no gancho)", async fn(c) {
    afirmar(aceitou(await gancho(c, usuario({ email: "a@b.c", app_metadata: { provider: "email", providers: ["email"] }, identities: [{ provider: "email" }] }))), "e-mail recusado");
  } },
  { id: "C6", nome: "NENHUM formato estranho faz o gancho lançar (lançar derrubaria o cadastro do convidado)", async fn(c) {
    const estranhos = [
      undefined, null, {}, [], "texto", 42,
      { user: null }, { user: "texto" }, { user: [] },
      usuario({ app_metadata: [] }), usuario({ app_metadata: "google" }), usuario({ app_metadata: { provider: 42 } }),
      usuario({ app_metadata: { providers: "google" } }), usuario({ app_metadata: { providers: [1, null, {}] } }),
      usuario({ identities: {} }), usuario({ identities: "google" }), usuario({ identities: [null, 1, "google", []] }),
      usuario({ identities: [{ provider: null }, { provider: 7 }] }),
    ];
    for (const e of estranhos) {
      let r;
      try { r = await gancho(c, e); } catch (erro) { throw new Error(`lançou com ${JSON.stringify(e)}: ${erro.message}`); }
      afirmar(aceitou(r), `formato estranho recusado: ${JSON.stringify(e)} → ${JSON.stringify(r)}`);
    }
  } },
  { id: "C7", nome: "só o Auth executa: anon/authenticated/public não; e não é SECURITY DEFINER", async fn(c) {
    for (const [papel, pode] of [["supabase_auth_admin", true], ["anon", false], ["authenticated", false], ["service_role", false]]) {
      const r = await c.query("select has_function_privilege($1, $2, 'execute') as ok", [papel, `${FUNCAO}(jsonb)`]);
      afirmar(r.rows[0].ok === pode, `${papel} ${pode ? "não executa" : "executa"} o gancho`);
    }
    const d = await c.query("select prosecdef from pg_proc where oid = $1::regprocedure", [`${FUNCAO}(jsonb)`]);
    afirmar(d.rows[0].prosecdef === false, "o gancho virou SECURITY DEFINER");
  } },
  { id: "C8", nome: "rollback desfaz, e a migração reaplica (create or replace)", async fn(c) {
    await c.query(ROLLBACK);
    const sumiu = await c.query("select to_regprocedure($1) as f", [`${FUNCAO}(jsonb)`]);
    afirmar(sumiu.rows[0].f === null, "o rollback não removeu a função");
    await c.query(MIGRACAO);
    await c.query(MIGRACAO);
    afirmar(recusou(await gancho(c, usuario({ app_metadata: { provider: "google" } }))), "reaplicada, não recusa mais");
  } },
];

/** Cada mutação remove UMA proteção; `alvos` são os testes que precisam reprovar sem ela. */
const MUTACOES = [
  { id: "sem-provider", alvos: ["C2"], de: "if v_meta ->> 'provider' in ('google', 'apple') then", para: "if false then" },
  { id: "sem-providers", alvos: ["C3"], de: "(v_provedores ? 'google' or v_provedores ? 'apple')", para: "false" },
  { id: "sem-identities", alvos: ["C4"], de: "and i.valor ->> 'provider' in ('google', 'apple')", para: "and false" },
  { id: "sem-guarda-de-array", alvos: ["C6"], de: "if jsonb_typeof(v_identidades) = 'array' then", para: "if v_identidades is not null then" },
  { id: "sem-grant-ao-auth", alvos: ["C1", "C7"], de: "grant execute on function public.king_antes_de_criar_usuario(jsonb) to supabase_auth_admin;", para: "" },
  { id: "sem-revoke", alvos: ["C7"], de: "revoke execute on function public.king_antes_de_criar_usuario(jsonb) from public, anon, authenticated, service_role;", para: "" },
];

async function rodar(textoDaMigracao) {
  const nome = `c_${randomBytes(4).toString("hex")}`;
  const adm = await conectar("postgres");
  await adm.query(`create database ${nome}`);
  await adm.end();
  const c = await conectar(nome);
  const reprovados = [];
  try {
    await c.query(BOOTSTRAP);
    await c.query("do $$ begin if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin noinherit; end if; end $$;");
    await c.query(textoDaMigracao);
    for (const t of TESTES) {
      try { await t.fn(c); } catch (e) { reprovados.push({ id: t.id, motivo: e.message }); }
      await c.query("reset role").catch(() => {});
      // C8 reaplica a migração ORIGINAL: depois dele, mutação não vale mais — ele roda por último.
    }
  } finally {
    await c.end();
    const adm2 = await conectar("postgres");
    await adm2.query(`drop database if exists ${nome} with (force)`);
    await adm2.end();
  }
  return reprovados;
}

const PROVAS = process.argv.includes("--provas");
const dir = mkdtempSync(join(tmpdir(), "king-cadastro-sql-"));
let banco = null;
let falhou = false;
try {
  PORTA = await portaLivre();
  banco = new EmbeddedPostgres({
    databaseDir: join(dir, "data"), port: PORTA, user: "postgres", password: SENHA,
    persistent: false, onLog: () => {}, onError: () => {}, authMethod: "scram-sha-256",
    // O Windows criaria o cluster em WIN1252: comentários e mensagens em português precisam de UTF8.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  await banco.initialise();
  await banco.start();

  if (PROVAS) {
    console.log("\nMUTAÇÕES (cada uma precisa REPROVAR os seus alvos)");
    for (const m of MUTACOES) {
      afirmar(MIGRACAO.includes(m.de), `mutação ${m.id}: trecho não encontrado na migração`);
      const reprovados = (await rodar(MIGRACAO.replace(m.de, m.para))).map((r) => r.id);
      const faltou = m.alvos.filter((a) => !reprovados.includes(a));
      if (faltou.length > 0) { falhou = true; console.error(`  XX  ${m.id}: sobreviveu em ${faltou.join(", ")}`); }
      else console.log(`  ok  ${m.id}: reprovou ${m.alvos.join(", ")}`);
    }
  }

  console.log("\nGANCHO \"CONTA SÓ NASCE COMO CONVIDADO\" — migração original");
  const reprovados = await rodar(MIGRACAO);
  for (const t of TESTES) {
    const r = reprovados.find((x) => x.id === t.id);
    if (r) { falhou = true; console.error(`  XX  ${t.id} ${t.nome}\n        ${r.motivo}`); }
    else console.log(`  ok  ${t.id} ${t.nome}`);
  }
} finally {
  if (banco) await banco.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
console.log(falhou ? "\nREPROVADO\n" : "\nAPROVADO\n");
process.exit(falhou ? 1 : 0);
