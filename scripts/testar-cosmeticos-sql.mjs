// TESTES DOS COSMÉTICOS (Entrega B) — Postgres REAL, descartável, com conexões independentes.
//
// Sobe um Postgres 17 embutido (o mesmo `embedded-postgres` das outras suítes SQL) num diretório
// temporário FORA do repositório, aplica o bootstrap que emula o mínimo do Supabase, TODAS as
// migrações anteriores do repositório e, por cima, a dos cosméticos — aplicada por um papel NÃO
// superusuário (`supa_postgres`, membro do dono), como o `postgres` do SQL Editor do Supabase. Cada
// teste roda num banco próprio, clonado do modelo, e o banco é destruído no fim.
//
// O que se prova: o desbloqueio nas bordas exatas da curva (99/100, 449/450, 999/1000 XP); o XP que
// vale é o do BANCO (o crédito real da partida desbloqueia, e o cliente não tem como dizer o
// contrário); o cliente não escreve na tabela, não lê a de outro e não executa a porta do servidor;
// o servidor só lê o EFEITO, de no máximo quatro ids; nada disto mexe em XP; a exclusão de conta
// leva a escolha junto; e o rollback desfaz sem tocar no progresso.
//
// Com `--provas`, cada proteção é removida por uma MUTAÇÃO EM MEMÓRIA do texto da migração (ou do
// rollback) — o arquivo em disco nunca é tocado — e os testes que dependem dela precisam REPROVAR.
//
//   node scripts/testar-cosmeticos-sql.mjs [--provas]
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";

const RAIZ = new URL("../", import.meta.url);
const ler = (rel) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
const BOOTSTRAP = ler("supabase/tests/bootstrap-supabase-local.sql");
/** O banco como o repositório o descreve hoje, na ordem em que as migrações foram aplicadas. */
const ANTERIORES = [
  "supabase/migrations/20260830120000_identidade.sql",
  "supabase/migrations/20260925120000_progresso.sql",
  "supabase/migrations/20261001120000_sequencia.sql",
  "supabase/migrations/20261025130000_credito_com_conta_excluida.sql",
  "supabase/migrations/20261026120000_retencao_das_lapides.sql",
].map(ler);
const MIGRACAO = ler("supabase/migrations/20261117120000_cosmeticos.sql");
const ROLLBACK = ler("supabase/rollback/20261117120000_cosmeticos_rollback.sql");

const afirmar = (cond, msg) => { if (!cond) throw new Error(msg); };

async function portaLivre() {
  return await new Promise((ok, erro) => {
    const s = createServer();
    s.on("error", erro);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

const SENHA_ADMIN = randomBytes(18).toString("base64url");
const SENHA_SERVIDOR = randomBytes(18).toString("base64url"); // só existe dentro do banco descartável
const SENHA_SUPABASE = randomBytes(18).toString("base64url");
let PORTA = 0;
const conectar = async (database, user = "postgres", password = SENHA_ADMIN) => {
  const c = new pg.Client({ host: "127.0.0.1", port: PORTA, database, user, password });
  await c.connect();
  return c;
};

/** O modelo: tudo o que já existe + a migração dos cosméticos (original ou mutada). */
async function criarModelo(nome, migracao) {
  const adm = await conectar("postgres");
  // Dono do banco = o papel do SQL Editor: é ele quem pode conceder CREATE em `public`, como no Supabase.
  await adm.query(`create database ${nome} owner supa_postgres`);
  await adm.end();
  const c = await conectar(nome);
  try {
    await c.query(BOOTSTRAP);
    for (const m of ANTERIORES) await c.query(m);
    // Os papéis nasceram na migração do progresso (no cluster). O login do servidor e a pertença do
    // papel do SQL Editor ao dono existem SÓ neste banco descartável, com senha desta execução.
    await c.query(`alter role king_server login password '${SENHA_SERVIDOR}'`);
    await c.query("grant king_progress_owner to supa_postgres");
    // O `postgres` do Supabase enxerga o schema `auth` (é o que deixa a política citar `auth.uid()`).
    // O dono dedicado (`king_progress_owner`) NÃO: a função de equipar é testada sem esse acesso.
    await c.query("grant usage on schema auth to supa_postgres");
  } finally {
    await c.end();
  }
  const s = await conectar(nome, "supa_postgres", SENHA_SUPABASE);
  try {
    await s.query(migracao);
  } finally {
    await s.end();
  }
}

let contador = 0;
async function bancoDeTeste(modelo) {
  const nome = `t_${++contador}_${randomBytes(3).toString("hex")}`;
  const adm = await conectar("postgres");
  await adm.query(`create database ${nome} template ${modelo} owner supa_postgres`);
  await adm.end();
  const admin = await conectar(nome);
  const abertos = [admin];
  return {
    nome, admin,
    async servidor() { const c = await conectar(nome, "king_server", SENHA_SERVIDOR); abertos.push(c); return c; },
    async supabase() { const c = await conectar(nome, "supa_postgres", SENHA_SUPABASE); abertos.push(c); return c; },
    /** Um aparelho do jogador `sub`: papel `authenticated` e o `sub` no JWT, como no Supabase. */
    async como(sub) {
      const c = await conectar(nome);
      abertos.push(c);
      await c.query("set role authenticated");
      if (sub) await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, role: "authenticated" })]);
      return c;
    },
    async anonimo() { const c = await conectar(nome); abertos.push(c); await c.query("set role anon"); return c; },
    /** Jogadores com XP total dado (escrito pelo admin: é só o ponto de partida do teste). */
    async jogadores(...xps) {
      const ids = [];
      for (const xp of xps) {
        const id = randomUUID();
        await admin.query("insert into auth.users (id) values ($1)", [id]);
        if (xp !== null) await admin.query("insert into public.progresso (player_id, xp_total) values ($1, $2)", [id, xp]);
        ids.push(id);
      }
      return ids;
    },
    async fechar() {
      for (const c of abertos) await c.end().catch(() => {});
      const adm = await conectar("postgres");
      await adm.query(`drop database if exists ${nome} with (force)`);
      await adm.end();
    },
  };
}

async function reprova(promessa, codigo, msg) {
  try { await promessa; } catch (e) {
    afirmar(!codigo || e.code === codigo, `${msg}: esperava ${codigo}, veio ${e.code} (${e.message})`);
    return;
  }
  throw new Error(`${msg}: passou e devia ter sido recusado`);
}
const equipar = (c, item, sim = true) =>
  c.query("select moldura_real, baralho_imperial, reacao_coroa from public.equipar_cosmetico($1, $2)", [item, sim]);
const salaDe = async (c, ids) => (await c.query(
  "select player_id, moldura_real, reacao_coroa from king_private.cosmeticos_da_sala($1::uuid[])", [ids])).rows;
async function retratoDoXp(admin) {
  const r = await admin.query(`select (select coalesce(sum(xp_total),0) from public.progresso)::bigint as total,
    (select count(*) from public.xp_eventos)::bigint as lancamentos,
    (select coalesce(sum(xp_delta),0) from public.xp_eventos)::bigint as ledger`);
  return JSON.stringify(r.rows[0]);
}

/** Meio-dia de ONTEM em São Paulo: passado garantido para o crédito real da partida. */
function ontem() {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const d = new Date(`${hoje}T12:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

const CATALOGO = [
  { item: "moldura-real", nivel: 2, abaixo: 99, exato: 100 },
  { item: "baralho-imperial", nivel: 4, abaixo: 449, exato: 450 },
  { item: "reacao-coroa", nivel: 6, abaixo: 999, exato: 1000 },
];

const TESTES = [
  { id: "K1", nome: "desbloqueio nas BORDAS exatas da curva: 99/100, 449/450, 999/1000 XP", async fn(b) {
    for (const { item, abaixo, exato } of CATALOGO) {
      const [quase, ja] = await b.jogadores(abaixo, exato);
      await reprova(equipar(await b.como(quase), item), "42501", `${item} com ${abaixo} XP`);
      const r = (await equipar(await b.como(ja), item)).rows[0];
      afirmar(r[item.replace("-", "_")] === true, `${item} com ${exato} XP não ficou equipado`);
    }
  } },
  { id: "K2", nome: "nível 1 (sem progresso nenhum): nada equipa; desequipar é sempre permitido", async fn(b) {
    const [novo] = await b.jogadores(null);
    const c = await b.como(novo);
    for (const { item } of CATALOGO) await reprova(equipar(c, item), "42501", `${item} no nível 1`);
    const r = (await equipar(c, "moldura-real", false)).rows[0];
    afirmar(r.moldura_real === false && r.baralho_imperial === false && r.reacao_coroa === false, "desequipar no nível 1 falhou");
  } },
  { id: "K3", nome: "o XP que vale é o do CRÉDITO REAL da partida (king_server → creditar_partida)", async fn(b) {
    const [a, c2] = await b.jogadores(null, null);
    await reprova(equipar(await b.como(a), "moldura-real"), "42501", "moldura antes da partida");
    const fim = ontem();
    const inicio = new Date(fim.getTime() - 20 * 60_000);
    const srv = await b.servidor();
    await srv.query(
      "select * from king_private.creditar_partida($1::uuid, $2::timestamptz, $3::timestamptz, 2::smallint, 2::smallint, $4::jsonb)",
      [randomUUID(), inicio.toISOString(), fim.toISOString(),
        JSON.stringify([{ player_id: a, posicao: 1, participou: true }, { player_id: c2, posicao: 2, participou: true }])],
    );
    afirmar((await equipar(await b.como(a), "moldura-real")).rows[0].moldura_real === true, "1 partida creditada não desbloqueou a moldura");
    await reprova(equipar(await b.como(a), "baralho-imperial"), "42501", "baralho com 150 XP");
  } },
  { id: "K4", nome: "o cliente NÃO escreve na tabela (insert/update/delete/upsert direto = negado)", async fn(b) {
    const [eu] = await b.jogadores(5000);
    const c = await b.como(eu);
    await equipar(c, "moldura-real", false); // cria a linha pelo caminho legítimo
    await reprova(c.query("insert into public.cosmeticos_equipados (player_id, reacao_coroa) values ($1, true)", [eu]), "42501", "insert direto");
    await reprova(c.query("update public.cosmeticos_equipados set reacao_coroa = true where player_id = $1", [eu]), "42501", "update direto");
    await reprova(c.query("delete from public.cosmeticos_equipados where player_id = $1", [eu]), "42501", "delete direto");
    const [pobre] = await b.jogadores(0);
    await reprova((await b.como(pobre)).query(
      "insert into public.cosmeticos_equipados (player_id, moldura_real) values ($1, true)", [pobre]), "42501", "insert direto sem nível");
  } },
  { id: "K5", nome: "isolamento: cada um lê só a PRÓPRIA linha; ninguém equipa por outro", async fn(b) {
    const [a, outro] = await b.jogadores(1000, 1000);
    await equipar(await b.como(a), "moldura-real");
    await equipar(await b.como(outro), "reacao-coroa");
    const visto = (await (await b.como(a)).query("select player_id from public.cosmeticos_equipados")).rows;
    afirmar(visto.length === 1 && visto[0].player_id === a, `A enxergou ${visto.length} linha(s)`);
    // a função sempre grava em auth.uid(): não existe parâmetro de "para quem"
    const r = await b.admin.query("select reacao_coroa, moldura_real from public.cosmeticos_equipados where player_id = $1", [a]);
    afirmar(r.rows[0].reacao_coroa === false && r.rows[0].moldura_real === true, "a linha de A mudou pela ação do outro");
  } },
  { id: "K6", nome: "sem identidade: anon não executa nem lê; authenticated sem `sub` é recusado", async fn(b) {
    const anon = await b.anonimo();
    await reprova(equipar(anon, "moldura-real"), "42501", "anon equipou");
    await reprova(anon.query("select * from public.cosmeticos_equipados"), "42501", "anon leu a tabela");
    await reprova(equipar(await b.como(null), "moldura-real", false), "42501", "authenticated sem sub");
  } },
  { id: "K7", nome: "catálogo FECHADO: item desconhecido, vazio ou nulo é recusado (22023)", async fn(b) {
    const [eu] = await b.jogadores(99999);
    const c = await b.como(eu);
    for (const item of ["moldura-dourada", "", "MOLDURA-REAL", "moldura-real ", null]) {
      await reprova(equipar(c, item), "22023", `item ${JSON.stringify(item)}`);
    }
    await reprova(c.query("select * from public.equipar_cosmetico('moldura-real', null)"), "22023", "equipado nulo");
  } },
  { id: "K8", nome: "o SERVIDOR só lê o efeito (equipado E com nível), de no máximo 4 ids; não toca na tabela", async fn(b) {
    const [a, c2, d, e] = await b.jogadores(1000, 100, 0, null);
    await equipar(await b.como(a), "moldura-real");
    await equipar(await b.como(a), "reacao-coroa");
    await equipar(await b.como(c2), "moldura-real");
    // linha forjada pelo admin: equipada sem nível. O efeito precisa sair FALSO.
    await b.admin.query("insert into public.cosmeticos_equipados (player_id, moldura_real, reacao_coroa) values ($1, true, true)", [d]);
    const srv = await b.servidor();
    const linhas = await salaDe(srv, [a, c2, d, e]);
    const de = (id) => linhas.find((l) => l.player_id === id);
    afirmar(de(a)?.moldura_real === true && de(a)?.reacao_coroa === true, "A (nível 6) sem efeito");
    afirmar(de(c2)?.moldura_real === true && de(c2)?.reacao_coroa === false, "C (nível 2) com efeito errado");
    afirmar(de(d)?.moldura_real === false && de(d)?.reacao_coroa === false, "linha forjada sem nível teve efeito");
    afirmar(!de(e), "quem nunca equipou apareceu");
    await reprova(salaDe(srv, [a, c2, d, e, randomUUID()]), "22023", "5 ids");
    await reprova(srv.query("select * from public.cosmeticos_equipados"), "42501", "servidor leu a tabela");
    await reprova(equipar(srv, "moldura-real"), "42501", "servidor executou equipar");
  } },
  { id: "K9", nome: "o cliente não executa a porta do servidor (nem com nível alto)", async fn(b) {
    const [eu] = await b.jogadores(5000);
    await reprova(salaDe(await b.como(eu), [eu]), "42501", "authenticated leu a sala");
    await reprova(salaDe(await b.anonimo(), [eu]), "42501", "anon leu a sala");
  } },
  { id: "K10", nome: "persistência entre aparelhos: o que um aparelho grava, o outro lê; desequipar volta", async fn(b) {
    const [eu] = await b.jogadores(450);
    await equipar(await b.como(eu), "baralho-imperial");
    const outro = await b.como(eu); // outra conexão = outro aparelho da mesma conta
    const r = (await outro.query("select moldura_real, baralho_imperial, reacao_coroa from public.cosmeticos_equipados")).rows[0];
    afirmar(r.baralho_imperial === true && r.moldura_real === false && r.reacao_coroa === false, "o 2º aparelho não viu a escolha");
    await equipar(outro, "baralho-imperial", false);
    const r2 = (await (await b.como(eu)).query("select baralho_imperial from public.cosmeticos_equipados")).rows[0];
    afirmar(r2.baralho_imperial === false, "desequipar não persistiu");
  } },
  { id: "K11", nome: "equipar/desequipar NÃO muda XP, ledger nem nível", async fn(b) {
    const [a, c2] = await b.jogadores(1000, 450);
    const antes = await retratoDoXp(b.admin);
    for (const { item } of CATALOGO) { await equipar(await b.como(a), item); await equipar(await b.como(a), item, false); }
    await equipar(await b.como(c2), "baralho-imperial");
    afirmar(await retratoDoXp(b.admin) === antes, "o XP mudou");
  } },
  { id: "K12", nome: "excluir a conta leva a escolha junto (cascade) e não trava a exclusão", async fn(b) {
    const [eu] = await b.jogadores(1000);
    await equipar(await b.como(eu), "reacao-coroa");
    await b.admin.query("delete from auth.users where id = $1", [eu]);
    const r = await b.admin.query("select count(*)::int as n from public.cosmeticos_equipados where player_id = $1", [eu]);
    afirmar(r.rows[0].n === 0, "a escolha sobreviveu à exclusão da conta");
  } },
  { id: "K13", nome: "privilégios exatos: SELECT só para authenticated; EXECUTE de cada porta só para o seu papel", async fn(b) {
    const tab = await b.admin.query(`select grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'cosmeticos_equipados' and grantee in ('anon','authenticated','service_role','king_server','PUBLIC')`);
    const vistos = tab.rows.map((r) => `${r.grantee}:${r.privilege_type}`).sort().join(",");
    afirmar(vistos === "authenticated:SELECT", `grants da tabela: ${vistos}`);
    const esperado = [
      ["public.equipar_cosmetico(text,boolean)", { authenticated: true, anon: false, service_role: false, king_server: false }],
      ["king_private.cosmeticos_da_sala(uuid[])", { authenticated: false, anon: false, service_role: false, king_server: true }],
      ["king_private.nivel_do_cosmetico(text)", { authenticated: false, anon: false, service_role: false, king_server: false }],
    ];
    for (const [f, papeis] of esperado) {
      for (const [papel, pode] of Object.entries(papeis)) {
        const r = await b.admin.query("select has_function_privilege($1, $2, 'execute') as ok", [papel, f]);
        afirmar(r.rows[0].ok === pode, `${papel} ${pode ? "não executa" : "executa"} ${f}`);
      }
    }
    const rls = await b.admin.query("select relrowsecurity from pg_class where oid = 'public.cosmeticos_equipados'::regclass");
    afirmar(rls.rows[0].relrowsecurity === true, "RLS desligada");
    const dono = await b.admin.query(`select p.proname, pg_get_userbyid(p.proowner) as dono, p.prosecdef from pg_proc p
      where p.proname in ('equipar_cosmetico','cosmeticos_da_sala')`);
    for (const r of dono.rows) afirmar(r.dono === "king_progress_owner" && r.prosecdef, `${r.proname}: dono ${r.dono}, definer ${r.prosecdef}`);
  } },
  { id: "K14", nome: "rollback desfaz SÓ os cosméticos (XP intacto) e a migração reaplica", async fn(b, { migracao, rollback }) {
    const [eu] = await b.jogadores(1000);
    await equipar(await b.como(eu), "moldura-real");
    const antes = await retratoDoXp(b.admin);
    const s = await b.supabase();
    await s.query(rollback);
    const sobrou = await b.admin.query(`select to_regclass('public.cosmeticos_equipados') as t,
      to_regprocedure('public.equipar_cosmetico(text,boolean)') as e,
      to_regprocedure('king_private.cosmeticos_da_sala(uuid[])') as s,
      to_regprocedure('king_private.nivel_do_cosmetico(text)') as n`);
    const o = sobrou.rows[0];
    afirmar(!o.t && !o.e && !o.s && !o.n, `o rollback deixou: ${JSON.stringify(o)}`);
    afirmar(await retratoDoXp(b.admin) === antes, "o rollback mexeu no XP");
    await s.query(migracao);
    afirmar((await equipar(await b.como(eu), "moldura-real")).rows[0].moldura_real === true, "reaplicada, não equipa");
  } },
];

/** Cada mutação remove UMA proteção; `alvos` são os testes que precisam reprovar sem ela. */
const MUTACOES = [
  { id: "sem-conferencia-de-nivel", alvos: ["K1", "K2", "K3"],
    de: "    if public.nivel_de(v_xp) < v_exige then", para: "    if false then" },
  { id: "nivel-errado-no-catalogo", alvos: ["K1"], de: "when 'baralho-imperial' then 4", para: "when 'baralho-imperial' then 3" },
  { id: "sem-conferencia-de-identidade", alvos: ["K6"], de: "  if v_uid is null then\n    raise exception 'sem identidade' using errcode = '42501';\n  end if;\n", para: "" },
  // O defeito que esta suíte achou: `auth.uid()` dentro da função SECURITY DEFINER, como o dono, que
  // no Supabase não tem acesso ao schema `auth`. Toda chamada legítima falharia.
  { id: "auth-uid-como-dono", alvos: ["K1", "K10"],
    de: "  v_uid   uuid := nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),\n                                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid;",
    para: "  v_uid   uuid := auth.uid();" },
  { id: "aceita-item-fora-do-catalogo", alvos: ["K7"], de: "  if v_exige is null or p_equipado is null then", para: "  if false then" },
  { id: "rls-le-todo-mundo", alvos: ["K5"], de: "for select to authenticated using ((select auth.uid()) = player_id);", para: "for select to authenticated using (true);" },
  { id: "cliente-escreve-direto", alvos: ["K4", "K13"], de: "grant select on table public.cosmeticos_equipados to authenticated;",
    para: "grant select, insert, update on table public.cosmeticos_equipados to authenticated;\ncreate policy cosmeticos_gravo_os_meus on public.cosmeticos_equipados for all to authenticated using (true) with check (true);" },
  { id: "sala-sem-efeito", alvos: ["K8"], de: "         c.moldura_real and public.nivel_de(coalesce(g.xp_total, 0)) >= king_private.nivel_do_cosmetico('moldura-real'),",
    para: "         c.moldura_real," },
  { id: "sala-sem-limite", alvos: ["K8"], de: "  if cardinality(p_ids) > 4 then", para: "  if false then" },
  { id: "sala-para-o-cliente", alvos: ["K9", "K13"], de: "grant execute on function king_private.cosmeticos_da_sala(uuid[]) to king_server;",
    para: "grant execute on function king_private.cosmeticos_da_sala(uuid[]) to king_server, authenticated;\ngrant usage on schema king_private to authenticated;" },
  { id: "equipar-para-anon", alvos: ["K13"], de: "grant execute on function public.equipar_cosmetico(text, boolean) to authenticated;",
    para: "grant execute on function public.equipar_cosmetico(text, boolean) to authenticated, anon;" },
  { id: "sem-cascade", alvos: ["K12"], de: "references public.players (id) on delete cascade,", para: "references public.players (id)," },
  { id: "rollback-esquece-a-tabela", alvos: ["K14"], rollback: true, de: "drop table public.cosmeticos_equipados;", para: "" },
];

async function rodar(migracao, rollback, testes) {
  const modelo = `m_${randomBytes(4).toString("hex")}`;
  await criarModelo(modelo, migracao);
  const reprovados = [];
  try {
    for (const t of testes) {
      const b = await bancoDeTeste(modelo);
      try { await t.fn(b, { migracao, rollback }); } catch (e) { reprovados.push({ id: t.id, motivo: e.message }); } finally { await b.fechar(); }
    }
  } finally {
    const adm = await conectar("postgres");
    await adm.query(`drop database if exists ${modelo} with (force)`);
    await adm.end();
  }
  return reprovados;
}

const PROVAS = process.argv.includes("--provas");
const dir = mkdtempSync(join(tmpdir(), "king-cosmeticos-sql-"));
let banco = null;
let falhou = false;
try {
  PORTA = await portaLivre();
  banco = new EmbeddedPostgres({
    databaseDir: join(dir, "data"), port: PORTA, user: "postgres", password: SENHA_ADMIN,
    persistent: false, onLog: () => {}, onError: () => {}, authMethod: "scram-sha-256",
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  await banco.initialise();
  await banco.start();
  const adm = await conectar("postgres");
  // Os papéis do Supabase e do KING existem no CLUSTER: criados uma vez, antes de qualquer modelo.
  await adm.query("create role supa_postgres login nosuperuser inherit password '" + SENHA_SUPABASE + "'");
  await adm.end();

  if (PROVAS) {
    console.log("\nMUTAÇÕES (cada uma precisa REPROVAR os seus alvos)");
    for (const m of MUTACOES) {
      const alvo = m.rollback ? ROLLBACK : MIGRACAO;
      afirmar(alvo.split(m.de).length === 2, `mutação ${m.id}: trecho não encontrado exatamente 1 vez`);
      const testes = TESTES.filter((t) => m.alvos.includes(t.id));
      afirmar(testes.length === m.alvos.length, `mutação ${m.id}: alvo inexistente`);
      const reprovados = (m.rollback
        ? await rodar(MIGRACAO, ROLLBACK.replace(m.de, m.para), testes)
        : await rodar(MIGRACAO.replace(m.de, m.para), ROLLBACK, testes)).map((r) => r.id);
      const faltou = m.alvos.filter((a) => !reprovados.includes(a));
      if (faltou.length > 0) { falhou = true; console.error(`  XX  ${m.id}: sobreviveu em ${faltou.join(", ")}`); }
      else console.log(`  ok  ${m.id}: reprovou ${m.alvos.join(", ")}`);
    }
  }

  console.log("\nCOSMÉTICOS — migração e rollback originais");
  const reprovados = await rodar(MIGRACAO, ROLLBACK, TESTES);
  for (const t of TESTES) {
    const r = reprovados.find((x) => x.id === t.id);
    if (r) { falhou = true; console.error(`  XX  ${t.id} ${t.nome}\n        ${r.motivo}`); }
    else console.log(`  ok  ${t.id} ${t.nome}`);
  }
  console.log(`\n${TESTES.length - reprovados.length}/${TESTES.length} testes verdes${PROVAS ? `, ${MUTACOES.length} mutações` : ""}`);
} catch (e) {
  falhou = true;
  console.error("\nERRO DE INFRAESTRUTURA:", e?.message ?? e);
} finally {
  if (banco) await banco.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
console.log(falhou ? "\nREPROVADO\n" : "\nAPROVADO\n");
process.exit(falhou ? 1 : 0);

