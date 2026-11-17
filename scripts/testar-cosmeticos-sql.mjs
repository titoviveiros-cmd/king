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
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { ARQUIVO_DO_ROLLOUT, montarRollout } from "./montar-rollout-cosmeticos.mjs";

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
  if (migracao === null) return; // modelo "como Production hoje": tudo, menos os cosméticos
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

// ══ O ROLLOUT DE PRODUCTION — os ARQUIVOS exatos que seriam colados no SQL Editor ═════════════════
//
// Cada teste parte de um banco "como Production hoje" (todas as migrações anteriores, nenhum
// cosmético), com contas e XP SINTÉTICOS, e aplica os arquivos pelo papel do SQL Editor
// (`supa_postgres`, não superusuário).
const ROLLOUT = ler(ARQUIVO_DO_ROLLOUT);
const CHECKPOINT_1 = ler("supabase/rollout/cosmeticos-checkpoint-1-antes.sql");
const CHECKPOINT_3 = ler("supabase/rollout/cosmeticos-checkpoint-3-depois.sql");

/** Roda um arquivo inteiro como o SQL Editor: devolve a última tela, ou o erro (e limpa a sessão). */
async function colar(c, sql) {
  try {
    const r = await c.query(sql);
    const ultima = Array.isArray(r) ? r[r.length - 1] : r;
    return { linha: ultima.rows[0], erro: null };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { linha: null, erro: e.message };
  }
}
/** Contas sintéticas: XP alto, zero, sem progresso, e uma partida creditada DE VERDADE (ledger). */
async function semear(b) {
  const ids = await b.jogadores(1000, 0, null, 450);
  const fim = ontem();
  await (await b.servidor()).query(
    "select * from king_private.creditar_partida($1::uuid, $2::timestamptz, $3::timestamptz, 2::smallint, 2::smallint, $4::jsonb)",
    [randomUUID(), new Date(fim.getTime() - 20 * 60_000).toISOString(), fim.toISOString(),
      JSON.stringify([{ player_id: ids[2], posicao: 1, participou: true }, { player_id: ids[3], posicao: 2, participou: true }])]);
  return ids; // [1000 XP, 0 XP (fica em 0), sem progresso → creditado, 450 → creditado]
}
/** Tudo o que é privilégio, política e dono em `public`/`king_private` — para comparar antes/depois. */
async function retratoDoBanco(admin) {
  const r = await admin.query(`select
    (select array_agg(x order by x collate "C") from (
       select c.oid::regclass::text || ' ' || coalesce(c.relacl::text, '-') || ' ' || pg_get_userbyid(c.relowner) as x
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','king_private') and c.relkind in ('r','v','m','S','p','f')
       union all select p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, '-') || ' ' || pg_get_userbyid(p.proowner) || ' ' || p.prosecdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','king_private')
       union all select 'schema ' || nspname || ' ' || coalesce(nspacl::text, '-') from pg_namespace where nspname in ('public','king_private')
       union all select 'policy ' || polrelid::regclass::text || ' ' || polname from pg_policy) as t) as tudo`);
  return JSON.stringify(r.rows[0].tudo) + (await retratoDoXp(admin));
}
const semCosmeticos = async (admin) => (await admin.query(`select to_regclass('public.cosmeticos_equipados') is null
  and to_regprocedure('public.equipar_cosmetico(text,boolean)') is null and to_regprocedure('king_private.cosmeticos_da_sala(uuid[])') is null
  and to_regprocedure('king_private.nivel_do_cosmetico(text)') is null as ok`)).rows[0].ok;

/** Defeitos plausíveis na migração: o arquivo do rollout com cada um precisa ABORTAR sem gravar nada. */
const DEFEITOS = [
  ["equipar-para-anon", "grant execute on function public.equipar_cosmetico(text, boolean) to authenticated;",
    "grant execute on function public.equipar_cosmetico(text, boolean) to authenticated, anon;"],
  ["sem-rls", "alter table public.cosmeticos_equipados enable row level security;\n", ""],
  ["politica-aberta", "for select to authenticated using ((select auth.uid()) = player_id);", "for select to authenticated using (true);"],
  ["catalogo-errado", "when 'baralho-imperial' then 4", "when 'baralho-imperial' then 3"],
  ["cliente-escreve", "grant select on table public.cosmeticos_equipados to authenticated;",
    "grant select, update on table public.cosmeticos_equipados to authenticated;"],
  ["sala-para-o-servico", "grant execute on function king_private.cosmeticos_da_sala(uuid[]) to king_server;",
    "grant execute on function king_private.cosmeticos_da_sala(uuid[]) to king_server, service_role;"],
  ["mexe-no-xp", "reset role;\nrevoke create on schema public from king_progress_owner;",
    "update public.progresso set xp_total = xp_total + 100;\nreset role;\nrevoke create on schema public from king_progress_owner;"],
  ["esquece-de-fechar-o-schema", "revoke create on schema public from king_progress_owner;\n", ""],
  ["sem-cascade", "references public.players (id) on delete cascade,", "references public.players (id),"],
];

const TESTES_DO_ROLLOUT = [
  { id: "R1", nome: "o ARQUIVO do rollout é a migração VERBATIM (sha256 no cabeçalho) e confere com o montador", async fn() {
    afirmar(ROLLOUT === montarRollout(), "o arquivo gravado diverge do que o montador monta hoje");
    afirmar(ROLLOUT.split(MIGRACAO).length === 2, "a migração não está inteira, uma vez, dentro do arquivo");
    afirmar(ROLLOUT.includes(createHash("sha256").update(MIGRACAO).digest("hex")), "o sha256 do cabeçalho não é o da migração");
    afirmar(/^begin;$/m.test(ROLLOUT) && /^commit;$/m.test(ROLLOUT), "sem BEGIN/COMMIT");
  } },
  { id: "R2", nome: "aplicado INTEIRO pelo papel do SQL Editor: checkpoint 1 pronto → arquivo → relatório → checkpoint 3 tudo certo, progresso idêntico", async fn(b) {
    const [mil, zero] = await semear(b);
    const s = await b.supabase();
    const c1 = (await colar(s, CHECKPOINT_1)).linha;
    afirmar(c1?.pronto_para_aplicar === true, `checkpoint 1 não está pronto: ${JSON.stringify(c1)}`);
    const xp = await retratoDoXp(b.admin);
    const r = await colar(s, ROLLOUT);
    afirmar(r.erro === null, `o rollout falhou: ${r.erro}`);
    afirmar(r.linha.resultado === "COSMÉTICOS (ENTREGA B) APLICADA E CONFERIDA", `relatório: ${JSON.stringify(r.linha)}`);
    const c3 = (await colar(s, CHECKPOINT_3)).linha;
    afirmar(c3?.tudo_certo === true, `checkpoint 3: ${c3?.detalhe}`);
    for (const k of ["linhas_de_progresso", "xp_total", "lancamentos", "xp_no_ledger", "partidas", "credito_md5", "nivel_md5", "schema_public_acl"]) {
      afirmar(String(c3[k]) === String(c1[k]), `${k}: antes ${c1[k]}, depois ${c3[k]}`);
    }
    afirmar(c3.escolhas_gravadas === "0" || c3.escolhas_gravadas === 0, "nasceu com escolhas gravadas");
    afirmar(await retratoDoXp(b.admin) === xp, "o rollout mexeu no XP");
    // e funciona: quem tem nível equipa, quem não tem é recusado
    afirmar((await equipar(await b.como(mil), "reacao-coroa")).rows[0].reacao_coroa === true, "1000 XP não equipou");
    await reprova(equipar(await b.como(zero), "moldura-real"), "42501", "0 XP equipou");
  } },
  { id: "R3", nome: "colado DUAS vezes: a segunda recusa na parte 1 e não altera nada", async fn(b) {
    await semear(b);
    const s = await b.supabase();
    afirmar((await colar(s, ROLLOUT)).erro === null, "1ª aplicação falhou");
    const [eu] = await b.jogadores(1000);
    await equipar(await b.como(eu), "moldura-real");
    const antes = await retratoDoBanco(b.admin);
    const r = await colar(s, ROLLOUT);
    afirmar(r.erro?.includes("ROLLOUT COSMÉTICOS ABORTADO (parte 1)"), `a 2ª não recusou na parte 1: ${r.erro}`);
    afirmar(await retratoDoBanco(b.admin) === antes, "a 2ª aplicação alterou o banco");
    afirmar((await b.admin.query("select count(*)::int as n from public.cosmeticos_equipados")).rows[0].n === 1, "a escolha gravada sumiu");
  } },
  { id: "R4", nome: `arquivo com DEFEITO na migração aborta nas conferências e não grava NADA (${DEFEITOS.length} defeitos)`, async fn(b) {
    await semear(b);
    const s = await b.supabase();
    const antes = await retratoDoBanco(b.admin);
    for (const [nome, de, para] of DEFEITOS) {
      afirmar(MIGRACAO.split(de).length === 2, `defeito ${nome}: trecho não encontrado exatamente 1 vez`);
      const r = await colar(s, montarRollout(MIGRACAO.replace(de, para)));
      afirmar(r.erro !== null, `defeito ${nome}: o arquivo foi APLICADO (${JSON.stringify(r.linha)})`);
      afirmar(/CONFER[ÊE]NCIA \d FALHOU/.test(r.erro), `defeito ${nome}: abortou, mas não pela conferência: ${r.erro}`);
      afirmar(await semCosmeticos(b.admin), `defeito ${nome}: sobrou objeto dos cosméticos`);
      afirmar(await retratoDoBanco(b.admin) === antes, `defeito ${nome}: o banco mudou`);
    }
  } },
  { id: "R5", nome: "ROLLBACK depois do rollout: volta EXATAMENTE ao banco de antes (checkpoint 1 pronto de novo), XP intacto", async fn(b) {
    await semear(b);
    const s = await b.supabase();
    const antes = await retratoDoBanco(b.admin);
    afirmar((await colar(s, ROLLOUT)).erro === null, "rollout falhou");
    const [eu] = await b.jogadores(1000);
    await equipar(await b.como(eu), "baralho-imperial");
    const depoisDoRollout = await retratoDoXp(b.admin);
    const r = await colar(s, ROLLBACK);
    afirmar(r.erro === null, `rollback falhou: ${r.erro}`);
    afirmar(await semCosmeticos(b.admin), "o rollback deixou objeto dos cosméticos");
    afirmar(await retratoDoXp(b.admin) === depoisDoRollout, "o rollback mexeu no XP");
    // o banco de antes, só com a conta nova do teste a mais (ela é dado, não privilégio)
    const comConta = antes.slice(0, antes.indexOf("{\"total\""));
    afirmar((await retratoDoBanco(b.admin)).startsWith(comConta), "privilégios/políticas/donos não voltaram ao de antes");
    afirmar((await colar(s, CHECKPOINT_1)).linha?.pronto_para_aplicar === true, "checkpoint 1 não voltou a pronto");
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
  console.log("\nROLLOUT DE PRODUCTION — os arquivos exatos, num banco como o de hoje (contas e XP sintéticos)");
  const reprovadosR = await rodar(null, ROLLBACK, TESTES_DO_ROLLOUT);
  for (const t of TESTES_DO_ROLLOUT) {
    const r = reprovadosR.find((x) => x.id === t.id);
    if (r) { falhou = true; console.error(`  XX  ${t.id} ${t.nome}\n        ${r.motivo}`); }
    else console.log(`  ok  ${t.id} ${t.nome}`);
  }
  const total = TESTES.length + TESTES_DO_ROLLOUT.length;
  console.log(`\n${total - reprovados.length - reprovadosR.length}/${total} testes verdes${PROVAS ? `, ${MUTACOES.length} mutações` : ""}`);
} catch (e) {
  falhou = true;
  console.error("\nERRO DE INFRAESTRUTURA:", e?.message ?? e);
} finally {
  if (banco) await banco.stop().catch(() => {});
  // No Windows o Postgres às vezes ainda segura um arquivo da pasta logo depois do stop (EPERM).
  // A pasta é descartável e o veredito já está decidido: tenta de novo e, se ainda assim falhar,
  // só avisa, sem trocar o resultado dos testes.
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
  catch (e) { console.warn(`\naviso: a pasta temporária ${dir} ficou para trás (${e?.code ?? e}); pode apagar à mão.`); }
}
console.log(falhou ? "\nREPROVADO\n" : "\nAPROVADO\n");
process.exit(falhou ? 1 : 0);

