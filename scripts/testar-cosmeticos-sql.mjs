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
import { ARQUIVO_DO_ROLLOUT, lerMigracoes, montarRollout } from "./montar-rollout-cosmeticos.mjs";

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
// As três migrações dos cosméticos, na ordem (parte 1: moldura/baralho/reação; parte 2: a toalha; parte 3:
// o catálogo da Entrega C), e os três rollbacks na ordem INVERSA. Uma mutação troca um trecho que existe
// UMA vez no conjunto.
const MIGRACOES = lerMigracoes();
const MIGRACAO = MIGRACOES.join("\n");
const ROLLBACK_DA_MESA = ler("supabase/rollback/20261118120000_cosmeticos_mesa_rollback.sql");
const ROLLBACK_DO_CATALOGO = ler("supabase/rollback/20261119120000_cosmeticos_catalogo_rollback.sql");
const ROLLBACK = ROLLBACK_DO_CATALOGO + "\n" + ROLLBACK_DA_MESA + "\n" + ler("supabase/rollback/20261117120000_cosmeticos_rollback.sql");
/** Só o rollback da parte 3 (o primeiro dos três), do texto desta execução (a mutação pode tê-lo trocado). */
const soOCatalogo = (rollback) => rollback.slice(0, rollback.indexOf("-- ROLLBACK DA TOALHA DA MESA (20261118120000"));
/** As migrações com UM trecho trocado — na migração que o contém (exatamente uma vez no conjunto). */
function migracoesCom(de, para) {
  afirmar(MIGRACAO.split(de).length === 2, `trecho não encontrado exatamente 1 vez: ${de.slice(0, 60)}`);
  return MIGRACOES.map((m) => (m.includes(de) ? m.replace(de, () => para) : m)); // função: `$$` no SQL não é padrão de troca
}

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
const toalha = (c, t) => c.query("select toalha from public.equipar_toalha($1)", [t]);
const mesaDe = async (c, id) => (await c.query("select toalha, liberadas from king_private.toalhas_do_anfitriao($1::uuid)", [id])).rows;
// parte 3 (o catálogo da Entrega C)
const item = (c, i, sim = true) => c.query("select moldura, baralho, reacoes, toalha from public.equipar_item($1, $2)", [i, sim]);
const assentosDe = async (c, ids) => (await c.query(
  "select player_id, moldura, reacoes from king_private.cosmeticos_dos_assentos($1::uuid[])", [ids])).rows;
/** XP total em que o nível `n` começa (a curva de `public.xp_para_nivel`): 2 = 100, 10 = 2700, 18 = 8500. */
const xpDoNivel = (n) => 25 * n * (n + 1) - 50;
/** A curva combinada da Entrega C: [item, nível, onde o efeito aparece na linha]. */
const CATALOGO_C = [
  ["moldura-real", 2], ["moldura-rubi", 7], ["moldura-onix", 11], ["moldura-diamante", 15], ["moldura-esmeralda", 16],
  ["baralho-imperial", 4], ["baralho-safira", 9], ["baralho-ouro-negro", 13], ["baralho-rubi", 17], ["baralho-marfim", 18],
  ["reacao-fogo", 5], ["reacao-coroa", 6], ["reacao-caveira", 10], ["reacao-aplauso", 14],
  ["mesa-vinho", 3], ["mesa-azul", 8], ["mesa-esmeralda", 10], ["mesa-preta", 12],
];
/** O item está em efeito nesta linha de `equipar_item`? */
function temNaLinha(l, i) {
  const [tipo, ...resto] = i.split("-");
  const v = resto.join("-");
  return tipo === "moldura" ? l.moldura === v : tipo === "baralho" ? l.baralho === v
    : tipo === "reacao" ? l.reacoes.includes(v) : l.toalha === v;
}
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
    await reprova(c.query("insert into public.cosmeticos_equipados (player_id, reacoes) values ($1, '{coroa}')", [eu]), "42501", "insert direto");
    await reprova(c.query("update public.cosmeticos_equipados set reacoes = '{coroa}' where player_id = $1", [eu]), "42501", "update direto");
    await reprova(c.query("update public.cosmeticos_equipados set moldura = 'diamante', baralho = 'marfim' where player_id = $1", [eu]), "42501", "update direto do catálogo");
    await reprova(c.query("delete from public.cosmeticos_equipados where player_id = $1", [eu]), "42501", "delete direto");
    const [pobre] = await b.jogadores(0);
    await reprova((await b.como(pobre)).query(
      "insert into public.cosmeticos_equipados (player_id, moldura) values ($1, 'real')", [pobre]), "42501", "insert direto sem nível");
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
    await b.admin.query("insert into public.cosmeticos_equipados (player_id, moldura, reacoes) values ($1, 'real', '{coroa}')", [d]);
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
    afirmar(await semCosmeticos(b.admin), "o rollback deixou alguma função da toalha");
    afirmar(await retratoDoXp(b.admin) === antes, "o rollback mexeu no XP");
    await s.query(migracao);
    afirmar((await equipar(await b.como(eu), "moldura-real")).rows[0].moldura_real === true, "reaplicada, não equipa");
  } },

  // ══ A TOALHA DA MESA (parte 2) ══════════════════════════════════════════════════════════════
  { id: "K15", nome: "toalhas nas BORDAS da curva: vinho 249/250 (3), azul 1749/1750 (8), esmeralda 2699/2700 (10), preta 3849/3850 (12); as duas de sempre LIVRES", async fn(b) {
    for (const [t, abaixo, exato] of [["vinho", 249, 250], ["azul", 1749, 1750], ["esmeralda", 2699, 2700], ["preta", 3849, 3850]]) {
      const [quase, ja] = await b.jogadores(abaixo, exato);
      await reprova(toalha(await b.como(quase), t), "42501", `${t} com ${abaixo} XP`);
      afirmar((await toalha(await b.como(ja), t)).rows[0].toalha === t, `${t} com ${exato} XP não ficou escolhida`);
    }
    const [novo] = await b.jogadores(null); // nível 1, sem progresso nenhum
    const c = await b.como(novo);
    afirmar((await toalha(c, "verde")).rows[0].toalha === "verde", "Verde Clássica não é livre");
    afirmar((await toalha(c, "imperial")).rows[0].toalha === "imperial", "Noite Imperial não é livre");
  } },
  { id: "K16", nome: "toalha: catálogo FECHADO (22023), o banco recusa valor fora dele mesmo pelo admin, e o padrão é a Noite Imperial", async fn(b) {
    const [eu] = await b.jogadores(99999);
    const c = await b.como(eu);
    for (const t of ["roxa", "", "VINHO", "vinho ", "Azul", null]) await reprova(toalha(c, t), "22023", `toalha ${JSON.stringify(t)}`);
    await equipar(c, "moldura-real", false); // nasce a linha por outro item
    const r = await b.admin.query("select toalha from public.cosmeticos_equipados where player_id = $1", [eu]);
    afirmar(r.rows[0].toalha === "imperial", `padrão: ${r.rows[0].toalha}`);
    await reprova(b.admin.query("update public.cosmeticos_equipados set toalha = 'roxa' where player_id = $1", [eu]), "23514", "valor fora do catálogo gravado direto");
  } },
  { id: "K17", nome: "a MESA DO ANFITRIÃO: o servidor lê só o efeito (escolhida E com nível) e as liberadas; ninguém da API lê", async fn(b) {
    const [alto, medio, forjado, nunca] = await b.jogadores(2700, 1750, 100, null);
    await toalha(await b.como(alto), "esmeralda");
    await toalha(await b.como(medio), "azul");
    // linha forjada pelo admin: esmeralda sem nível. O efeito precisa ser a mesa padrão.
    await b.admin.query("insert into public.cosmeticos_equipados (player_id, toalha) values ($1, 'esmeralda')", [forjado]);
    const srv = await b.servidor();
    const ver = async (id) => (await mesaDe(srv, id))[0];
    const a = await ver(alto), m = await ver(medio), f = await ver(forjado), n = await ver(nunca);
    afirmar(a.toalha === "esmeralda" && a.liberadas.join() === "imperial,verde,vinho,azul,esmeralda", `nível 10: ${JSON.stringify(a)}`);
    afirmar(m.toalha === "azul" && m.liberadas.join() === "imperial,verde,vinho,azul", `nível 8: ${JSON.stringify(m)}`);
    afirmar(f.toalha === "imperial" && f.liberadas.join() === "imperial,verde", `forjada sem nível teve efeito: ${JSON.stringify(f)}`);
    afirmar(n.toalha === "imperial" && n.liberadas.join() === "imperial,verde", `quem nunca escolheu: ${JSON.stringify(n)}`);
    await reprova(mesaDe(srv, null), "22023", "sem jogador");
    await reprova(mesaDe(await b.como(alto), alto), "42501", "authenticated leu a mesa");
    await reprova(mesaDe(await b.anonimo(), alto), "42501", "anon leu a mesa");
    await reprova(toalha(srv, "verde"), "42501", "servidor escolheu toalha");
  } },
  { id: "K18", nome: "toalha: o cliente não grava a coluna direto; cada um só a própria; não apaga as outras escolhas (e vice-versa); não mexe no XP", async fn(b) {
    const [eu, outro] = await b.jogadores(2700, 2700);
    const c = await b.como(eu);
    await equipar(c, "moldura-real");
    const xp = await retratoDoXp(b.admin);
    afirmar((await toalha(c, "esmeralda")).rows[0].toalha === "esmeralda", "não escolheu");
    await reprova(c.query("update public.cosmeticos_equipados set toalha = 'vinho' where player_id = $1", [eu]), "42501", "update direto da toalha");
    await toalha(await b.como(outro), "vinho");
    const r = (await b.admin.query("select player_id, moldura_real, toalha from public.cosmeticos_equipados order by toalha")).rows;
    const meu = r.find((x) => x.player_id === eu);
    afirmar(meu.moldura_real === true && meu.toalha === "esmeralda", `a toalha apagou a moldura, ou o outro mexeu na minha: ${JSON.stringify(meu)}`);
    await equipar(c, "baralho-imperial");
    afirmar((await c.query("select toalha from public.cosmeticos_equipados")).rows[0].toalha === "esmeralda", "equipar outro item voltou a toalha");
    afirmar(await retratoDoXp(b.admin) === xp, "escolher toalha mexeu no XP");
  } },
  { id: "K19", nome: "toalha: privilégios exatos; o rollback SÓ da parte 2 tira a toalha e preserva as outras escolhas; reaplica", async fn(b, { rollback }) {
    const esperado = [
      ["public.equipar_toalha(text)", { authenticated: true, anon: false, service_role: false, king_server: false }],
      ["king_private.toalhas_do_anfitriao(uuid)", { authenticated: false, anon: false, service_role: false, king_server: true }],
      ["king_private.nivel_da_toalha(text)", { authenticated: false, anon: false, service_role: false, king_server: false }],
    ];
    for (const [f, papeis] of esperado) {
      for (const [papel, pode] of Object.entries(papeis)) {
        const r = await b.admin.query("select has_function_privilege($1, $2, 'execute') as ok", [papel, f]);
        afirmar(r.rows[0].ok === pode, `${papel} ${pode ? "não executa" : "executa"} ${f}`);
      }
    }
    const [eu] = await b.jogadores(2700);
    await equipar(await b.como(eu), "moldura-real");
    await toalha(await b.como(eu), "esmeralda");
    const s = await b.supabase();
    // os rollbacks das partes 3 e 2 são os DOIS primeiros (os desta execução, que a mutação pode ter trocado)
    await s.query(rollback.slice(0, rollback.indexOf("-- ROLLBACK DOS COSMÉTICOS (20261117120000")));
    const sobrou = (await b.admin.query(`select to_regprocedure('public.equipar_toalha(text)') as e,
      to_regprocedure('king_private.toalhas_do_anfitriao(uuid)') as m, to_regprocedure('king_private.nivel_da_toalha(text)') as n,
      exists (select 1 from pg_attribute where attrelid = 'public.cosmeticos_equipados'::regclass and attname = 'toalha' and not attisdropped) as col`)).rows[0];
    afirmar(!sobrou.e && !sobrou.m && !sobrou.n && !sobrou.col, `o rollback da mesa deixou: ${JSON.stringify(sobrou)}`);
    const linha = (await b.admin.query("select moldura_real from public.cosmeticos_equipados where player_id = $1", [eu])).rows[0];
    afirmar(linha?.moldura_real === true, "o rollback da mesa apagou a moldura");
    await s.query(MIGRACOES[1]);
    afirmar((await toalha(await b.como(eu), "vinho")).rows[0].toalha === "vinho", "reaplicada, não escolhe");
  } },

  // ══ O CATÁLOGO DA ENTREGA C (parte 3) ═══════════════════════════════════════════════════════
  { id: "K20", nome: "catálogo C: cada um dos 18 itens de nível nas BORDAS exatas da curva (um XP abaixo recusa, o exato equipa)", async fn(b) {
    for (const [i, nivel] of CATALOGO_C) {
      const [quase, ja] = await b.jogadores(xpDoNivel(nivel) - 1, xpDoNivel(nivel));
      await reprova(item(await b.como(quase), i), "42501", `${i} com ${xpDoNivel(nivel) - 1} XP`);
      const l = (await item(await b.como(ja), i)).rows[0];
      afirmar(temNaLinha(l, i), `${i} com ${xpDoNivel(nivel)} XP não ficou equipado: ${JSON.stringify(l)}`);
    }
    const [novo] = await b.jogadores(null);
    const c = await b.como(novo);
    afirmar((await item(c, "mesa-verde")).rows[0].toalha === "verde", "Verde Clássica não é livre pela porta nova");
    afirmar((await item(c, "mesa-imperial")).rows[0].toalha === "imperial", "Noite Imperial não é livre pela porta nova");
  } },
  { id: "K21", nome: "catálogo C: moldura e baralho são UM por vez (ou nenhum); reações se somam na ordem do catálogo; mesa volta à padrão; categorias independentes; XP intacto", async fn(b) {
    const [eu] = await b.jogadores(99999);
    const c = await b.como(eu);
    const xp = await retratoDoXp(b.admin);
    const l = async (i, sim = true) => (await item(c, i, sim)).rows[0];
    afirmar((await l("moldura-rubi")).moldura === "rubi", "rubi");
    afirmar((await l("moldura-diamante")).moldura === "diamante", "equipar outra moldura não trocou");
    afirmar((await l("moldura-rubi", false)).moldura === "diamante", "desequipar a que NÃO está em uso tirou a que está");
    afirmar((await l("moldura-diamante", false)).moldura === null, "desequipar a em uso não tirou");
    afirmar((await l("baralho-safira")).baralho === "safira", "safira");
    afirmar((await l("baralho-marfim")).baralho === "marfim", "equipar outro baralho não trocou");
    afirmar((await l("baralho-safira", false)).baralho === "marfim", "desequipar o baralho que não está em uso tirou o outro");
    afirmar((await l("reacao-aplauso")).reacoes.join() === "aplauso", "aplauso");
    afirmar((await l("reacao-fogo")).reacoes.join() === "fogo,aplauso", "as reações não somaram na ordem do catálogo");
    afirmar((await l("reacao-coroa")).reacoes.join() === "fogo,coroa,aplauso", "coroa");
    afirmar((await l("reacao-coroa")).reacoes.join() === "fogo,coroa,aplauso", "equipar de novo duplicou");
    afirmar((await l("reacao-fogo", false)).reacoes.join() === "coroa,aplauso", "desligar uma reação mexeu nas outras");
    afirmar((await l("mesa-preta")).toalha === "preta", "preta");
    afirmar((await l("mesa-azul", false)).toalha === "preta", "desequipar outra mesa trocou a em uso");
    const fim = await l("mesa-preta", false);
    afirmar(fim.toalha === "imperial" && fim.baralho === "marfim" && fim.moldura === null && fim.reacoes.join() === "coroa,aplauso",
      `uma categoria mexeu na outra: ${JSON.stringify(fim)}`);
    // os espelhos da parte 1 acompanham, e a porta antiga escreve nas colunas novas
    const e = (await equipar(c, "moldura-real")).rows[0];
    afirmar(e.moldura_real === true && e.reacao_coroa === true && e.baralho_imperial === false, `espelho: ${JSON.stringify(e)}`);
    afirmar((await c.query("select moldura from public.cosmeticos_equipados")).rows[0].moldura === "real", "a porta antiga não escreveu na coluna nova");
    afirmar(await retratoDoXp(b.admin) === xp, "equipar mexeu no XP");
  } },
  { id: "K22", nome: "catálogo C FECHADO: item fora dele, reação livre e vazio são recusados (22023); o banco recusa valor fora do catálogo mesmo pelo admin; espelho não é gravável", async fn(b) {
    const [eu] = await b.jogadores(99999);
    const c = await b.como(eu);
    for (const i of ["moldura-dourada", "moldura-", "moldura", "", "MOLDURA-RUBI", "moldura-rubi ", "reacao-risada", "reacao-choro",
      "mesa-roxa", "mesa-", "baralho-ouro", "x-real", "real", null]) {
      await reprova(item(c, i), "22023", `item ${JSON.stringify(i)}`);
    }
    await reprova(c.query("select * from public.equipar_item('moldura-rubi', null)"), "22023", "equipado nulo");
    await reprova(equipar(c, "moldura-rubi"), "22023", "a porta antiga aceitou item novo");
    await item(c, "moldura-rubi");
    for (const [sql, nome] of [["update public.cosmeticos_equipados set moldura = 'dourada'", "moldura"],
      ["update public.cosmeticos_equipados set baralho = 'azul'", "baralho"],
      ["update public.cosmeticos_equipados set reacoes = '{risada}'", "reação livre"],
      ["update public.cosmeticos_equipados set toalha = 'roxa'", "toalha"]]) {
      await reprova(b.admin.query(sql), "23514", `admin gravou ${nome} fora do catálogo`);
    }
    await reprova(b.admin.query("update public.cosmeticos_equipados set reacoes = array['fogo', null]"), null, "admin gravou reação nula");
    await reprova(b.admin.query("update public.cosmeticos_equipados set moldura_real = true"), null, "espelho gravável");
  } },
  { id: "K23", nome: "catálogo C: o SERVIDOR lê só o efeito (escolhido E com nível) de até 4 ids; a porta antiga da sala responde igual; ninguém da API lê", async fn(b) {
    const [alto, forjado, medio, nunca] = await b.jogadores(99999, 1000, 450, null);
    const c = await b.como(alto);
    for (const i of ["moldura-diamante", "reacao-fogo", "reacao-aplauso", "baralho-ouro-negro"]) await item(c, i);
    await item(await b.como(medio), "moldura-real");
    // forjada pelo admin no nível 6: moldura do 11 e uma reação do 10 — sem efeito; fogo e coroa valem
    await b.admin.query("insert into public.cosmeticos_equipados (player_id, moldura, reacoes) values ($1, 'onix', '{fogo,coroa,caveira}')", [forjado]);
    const srv = await b.servidor();
    const linhas = await assentosDe(srv, [alto, forjado, medio, nunca]);
    const de = (id) => linhas.find((l) => l.player_id === id);
    afirmar(de(alto)?.moldura === "diamante" && de(alto)?.reacoes.join() === "fogo,aplauso", `alto: ${JSON.stringify(de(alto))}`);
    afirmar(de(forjado)?.moldura === null && de(forjado)?.reacoes.join() === "fogo,coroa", `forjada teve efeito: ${JSON.stringify(de(forjado))}`);
    afirmar(de(medio)?.moldura === "real" && de(medio)?.reacoes.length === 0, `médio: ${JSON.stringify(de(medio))}`);
    afirmar(!de(nunca), "quem nunca equipou apareceu");
    afirmar(Object.keys(linhas[0]).join() === "player_id,moldura,reacoes", "a leitura da sala devolve mais que o efeito");
    const antiga = await salaDe(srv, [alto, forjado, medio]);
    const da = (id) => antiga.find((l) => l.player_id === id);
    afirmar(da(alto)?.moldura_real === false && da(alto)?.reacao_coroa === false, "porta antiga: alto");
    afirmar(da(forjado)?.moldura_real === false && da(forjado)?.reacao_coroa === true, "porta antiga: forjada");
    afirmar(da(medio)?.moldura_real === true, "porta antiga: médio");
    await reprova(assentosDe(srv, [alto, forjado, medio, nunca, randomUUID()]), "22023", "5 ids");
    await reprova(assentosDe(c, [alto]), "42501", "authenticated leu os assentos");
    await reprova(assentosDe(await b.anonimo(), [alto]), "42501", "anon leu os assentos");
    await reprova(item(srv, "mesa-verde"), "42501", "servidor equipou");
  } },
  { id: "K24", nome: "catálogo C: privilégios exatos das três funções novas; dono dedicado; SECURITY DEFINER só nas duas portas", async fn(b) {
    const esperado = [
      ["public.equipar_item(text,boolean)", { authenticated: true, anon: false, service_role: false, king_server: false }],
      ["king_private.cosmeticos_dos_assentos(uuid[])", { authenticated: false, anon: false, service_role: false, king_server: true }],
      ["king_private.nivel_do_item(text)", { authenticated: false, anon: false, service_role: false, king_server: false }],
    ];
    for (const [f, papeis] of esperado) {
      for (const [papel, pode] of Object.entries(papeis)) {
        const r = await b.admin.query("select has_function_privilege($1, $2, 'execute') as ok", [papel, f]);
        afirmar(r.rows[0].ok === pode, `${papel} ${pode ? "não executa" : "executa"} ${f}`);
      }
    }
    const r = (await b.admin.query(`select p.proname, pg_get_userbyid(p.proowner) as dono, p.prosecdef, p.proconfig from pg_proc p
      where p.proname in ('equipar_item', 'cosmeticos_dos_assentos', 'nivel_do_item') order by p.proname`)).rows;
    afirmar(r.length === 3, "faltou função");
    for (const f of r) {
      afirmar(f.dono === "king_progress_owner" && f.proconfig?.join() === 'search_path=""', `${f.proname}: dono ${f.dono}, ${f.proconfig}`);
      afirmar(f.prosecdef === (f.proname !== "nivel_do_item"), `${f.proname}: SECURITY DEFINER ${f.prosecdef}`);
    }
  } },
  { id: "K25", nome: "rollback SÓ da parte 3: as colunas antigas voltam graváveis com o valor certo, as portas antigas funcionam, o XP fica; reaplica", async fn(b, { rollback }) {
    const [a, d] = await b.jogadores(99999, 99999);
    for (const i of ["moldura-real", "reacao-coroa", "reacao-fogo", "mesa-azul"]) await item(await b.como(a), i);
    for (const i of ["moldura-rubi", "baralho-imperial", "mesa-esmeralda"]) await item(await b.como(d), i);
    const xp = await retratoDoXp(b.admin);
    const s = await b.supabase();
    await s.query(soOCatalogo(rollback));
    const sobrou = (await b.admin.query(`select to_regprocedure('public.equipar_item(text,boolean)') as e,
      to_regprocedure('king_private.cosmeticos_dos_assentos(uuid[])') as s, to_regprocedure('king_private.nivel_do_item(text)') as n,
      (select count(*)::int from pg_attribute where attrelid = 'public.cosmeticos_equipados'::regclass and not attisdropped
         and attname in ('moldura', 'baralho', 'reacoes')) as cols,
      (select count(*)::int from pg_attribute where attrelid = 'public.cosmeticos_equipados'::regclass and not attisdropped
         and attgenerated <> '') as geradas`)).rows[0];
    afirmar(!sobrou.e && !sobrou.s && !sobrou.n && sobrou.cols === 0 && sobrou.geradas === 0, `o rollback do catálogo deixou: ${JSON.stringify(sobrou)}`);
    const linha = async (id) => (await b.admin.query("select moldura_real, baralho_imperial, reacao_coroa, toalha from public.cosmeticos_equipados where player_id = $1", [id])).rows[0];
    const la = await linha(a), ld = await linha(d);
    afirmar(la.moldura_real === true && la.reacao_coroa === true && la.baralho_imperial === false && la.toalha === "imperial", `A: ${JSON.stringify(la)}`);
    afirmar(ld.moldura_real === false && ld.baralho_imperial === true && ld.toalha === "esmeralda", `D: ${JSON.stringify(ld)}`);
    // as portas antigas, com o texto delas: gravam nas colunas comuns e o catálogo de toalhas é o de quatro
    afirmar((await equipar(await b.como(d), "reacao-coroa")).rows[0].reacao_coroa === true, "a porta antiga não grava depois do rollback");
    await reprova(toalha(await b.como(d), "azul"), "22023", "a Azul ficou no catálogo");
    afirmar((await salaDe(await b.servidor(), [a]))[0]?.moldura_real === true, "a sala antiga não lê depois do rollback");
    afirmar(await retratoDoXp(b.admin) === xp, "o rollback do catálogo mexeu no XP");
    await s.query(MIGRACOES[2]);
    const volta = (await b.admin.query("select moldura, baralho, reacoes from public.cosmeticos_equipados where player_id = $1", [d])).rows[0];
    afirmar(volta.moldura === null && volta.baralho === "imperial" && volta.reacoes.join() === "coroa", `reaplicada, não migrou: ${JSON.stringify(volta)}`);
    afirmar((await item(await b.como(d), "moldura-onix")).rows[0].moldura === "onix", "reaplicada, não equipa");
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
  and to_regprocedure('king_private.nivel_do_cosmetico(text)') is null and to_regprocedure('public.equipar_toalha(text)') is null
  and to_regprocedure('king_private.toalhas_do_anfitriao(uuid)') is null and to_regprocedure('king_private.nivel_da_toalha(text)') is null
  and to_regprocedure('public.equipar_item(text,boolean)') is null and to_regprocedure('king_private.cosmeticos_dos_assentos(uuid[])') is null
  and to_regprocedure('king_private.nivel_do_item(text)') is null as ok`)).rows[0].ok;

/** Defeitos plausíveis na migração: o arquivo do rollout com cada um precisa ABORTAR sem gravar nada. */
const DEFEITOS = [
  ["equipar-para-anon", "grant execute on function public.equipar_cosmetico(text, boolean) to authenticated;",
    "grant execute on function public.equipar_cosmetico(text, boolean) to authenticated, anon;"],
  ["sem-rls", "alter table public.cosmeticos_equipados enable row level security;\n", ""],
  ["politica-aberta", "for select to authenticated using ((select auth.uid()) = player_id);", "for select to authenticated using (true);"],
  // (o catálogo da parte 1 pergunta ao da parte 3: o defeito mira o texto que vale)
  ["catalogo-errado", "when p_item = 'baralho-imperial'   then  4", "when p_item = 'baralho-imperial'   then  3"],
  ["cliente-escreve", "grant select on table public.cosmeticos_equipados to authenticated;",
    "grant select, update on table public.cosmeticos_equipados to authenticated;"],
  ["sala-para-o-servico", "grant execute on function king_private.cosmeticos_da_sala(uuid[]) to king_server;",
    "grant execute on function king_private.cosmeticos_da_sala(uuid[]) to king_server, service_role;"],
  // (as duas migrações abrem e fecham o schema: cada trecho abaixo é único no conjunto)
  ["mexe-no-xp", "   order by c.player_id;\nend $$;\n\nreset role;",
    "   order by c.player_id;\nend $$;\n\nupdate public.progresso set xp_total = xp_total + 100;\nreset role;"],
  // o ÚLTIMO fechamento (o da parte 3): é ele que deixaria o schema aberto
  ["esquece-de-fechar-o-schema", "order by n);\nend $$;\n\nreset role;\nrevoke create on schema public from king_progress_owner;\n",
    "order by n);\nend $$;\n\nreset role;\n"],
  ["sem-cascade", "references public.players (id) on delete cascade,", "references public.players (id),"],
  // os da parte 2 (a toalha)
  ["toalha-para-anon", "grant execute on function public.equipar_toalha(text) to authenticated;",
    "grant execute on function public.equipar_toalha(text) to authenticated, anon;"],
  ["catalogo-da-toalha-errado", "when p_toalha = 'vinho'     then  3", "when p_toalha = 'vinho'     then  4"],
  ["mesa-para-o-servico", "grant execute on function king_private.toalhas_do_anfitriao(uuid) to king_server;",
    "grant execute on function king_private.toalhas_do_anfitriao(uuid) to king_server, service_role;"],
  ["toalha-sem-catalogo-na-coluna",
    "alter table public.cosmeticos_equipados\n  add constraint cosmeticos_toalha_do_catalogo\n    check (toalha in ('imperial', 'verde', 'vinho', 'azul', 'esmeralda', 'preta'));", ""],
  // os da parte 3 (o catálogo da Entrega C)
  ["item-para-anon", "grant execute on function public.equipar_item(text, boolean) to authenticated;",
    "grant execute on function public.equipar_item(text, boolean) to authenticated, anon;"],
  ["assentos-para-o-servico", "grant execute on function king_private.cosmeticos_dos_assentos(uuid[]) to king_server;",
    "grant execute on function king_private.cosmeticos_dos_assentos(uuid[]) to king_server, service_role;"],
  ["catalogo-c-errado", "when p_item = 'moldura-diamante'   then 15", "when p_item = 'moldura-diamante'   then 14"],
  ["reacoes-sem-catalogo-na-coluna",
    "\n    constraint cosmeticos_reacoes_do_catalogo check (reacoes <@ array['fogo', 'coroa', 'caveira', 'aplauso']::text[])", ""],
  ["espelho-gravavel", "  add column reacao_coroa boolean not null generated always as ('coroa' = any (reacoes)) stored;",
    "  add column reacao_coroa boolean not null default false;"],
];

const TESTES_DO_ROLLOUT = [
  { id: "R1", nome: "o ARQUIVO do rollout é a migração VERBATIM (sha256 no cabeçalho) e confere com o montador", async fn() {
    afirmar(ROLLOUT === montarRollout(), "o arquivo gravado diverge do que o montador monta hoje");
    for (const [i, m] of MIGRACOES.entries()) {
      afirmar(ROLLOUT.split(m).length === 2, `a migração ${i + 1} não está inteira, uma vez, dentro do arquivo`);
      afirmar(ROLLOUT.includes(createHash("sha256").update(m).digest("hex")), `o sha256 do cabeçalho não é o da migração ${i + 1}`);
    }
    afirmar(ROLLOUT.indexOf(MIGRACOES[0]) < ROLLOUT.indexOf(MIGRACOES[1]), "as migrações estão fora de ordem");
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
    // e a toalha: 1000 XP (nível 6) tem as duas livres, não a do nível 8
    afirmar((await toalha(await b.como(mil), "verde")).rows[0].toalha === "verde", "a Verde não é livre depois do rollout");
    // (a curva nova: Vinho Imperial no 3, Azul Royal no 8)
    afirmar((await toalha(await b.como(mil), "vinho")).rows[0].toalha === "vinho", "nível 6 não escolheu a Vinho (nível 3)");
    await reprova(toalha(await b.como(mil), "azul"), "42501", "nível 6 escolheu a Azul");
    // e a porta do catálogo C: o nível 6 tem o Fogo, não a Moldura Rubi (7)
    afirmar((await item(await b.como(mil), "reacao-fogo")).rows[0].reacoes.join() === "fogo,coroa", "1000 XP não ligou o Fogo");
    await reprova(item(await b.como(mil), "moldura-rubi"), "42501", "nível 6 equipou a Moldura Rubi");
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
      const r = await colar(s, montarRollout(migracoesCom(de, para)));
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
  // (a parte 3 substitui as portas da parte 1: `equipar_cosmetico` passa a chamar `equipar_item`, e o
  // catálogo da parte 1 pergunta ao da parte 3. As mutações miram o texto que VALE depois das três.)
  { id: "sem-conferencia-de-nivel", alvos: ["K1", "K2", "K3", "K20"],
    de: "  if p_equipado and v_nivel > 1 then", para: "  if false then" },
  { id: "nivel-errado-no-catalogo", alvos: ["K1", "K20"], de: "when p_item = 'baralho-imperial'   then  4", para: "when p_item = 'baralho-imperial'   then  3" },
  { id: "sem-conferencia-de-identidade", alvos: ["K6"], de: "  if v_quem is null then\n    raise exception 'sem identidade' using errcode = '42501';\n  end if;\n",
    para: "" },
  // O defeito que esta suíte achou: `auth.uid()` dentro da função SECURITY DEFINER, como o dono, que
  // no Supabase não tem acesso ao schema `auth`. Toda chamada legítima falharia.
  { id: "auth-uid-como-dono", alvos: ["K1", "K10", "K20"],
    de: "  v_quem  uuid := nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),\n                                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid;\n  v_nivel integer := king_private.nivel_do_item(p_item);",
    para: "  v_quem  uuid := auth.uid();\n  v_nivel integer := king_private.nivel_do_item(p_item);" },
  { id: "aceita-item-fora-do-catalogo", alvos: ["K7", "K22"], de: "  if v_nivel is null or p_equipado is null then", para: "  if false then" },
  { id: "rls-le-todo-mundo", alvos: ["K5"], de: "for select to authenticated using ((select auth.uid()) = player_id);", para: "for select to authenticated using (true);" },
  { id: "cliente-escreve-direto", alvos: ["K4", "K13"], de: "grant select on table public.cosmeticos_equipados to authenticated;",
    para: "grant select, insert, update on table public.cosmeticos_equipados to authenticated;\ncreate policy cosmeticos_gravo_os_meus on public.cosmeticos_equipados for all to authenticated using (true) with check (true);" },
  { id: "sala-sem-efeito", alvos: ["K8", "K23"],
    de: "         case when public.nivel_de(coalesce(g.xp_total, 0)) >= king_private.nivel_do_item('moldura-' || c.moldura) then c.moldura end,",
    para: "         c.moldura," },
  { id: "sala-sem-limite", alvos: ["K8", "K23"], de: "  if 4 < cardinality(p_ids) then", para: "  if false then" },
  { id: "sala-para-o-cliente", alvos: ["K9", "K13"], de: "grant execute on function king_private.cosmeticos_da_sala(uuid[]) to king_server;",
    para: "grant execute on function king_private.cosmeticos_da_sala(uuid[]) to king_server, authenticated;\ngrant usage on schema king_private to authenticated;" },
  { id: "equipar-para-anon", alvos: ["K13"], de: "grant execute on function public.equipar_cosmetico(text, boolean) to authenticated;",
    para: "grant execute on function public.equipar_cosmetico(text, boolean) to authenticated, anon;" },
  { id: "sem-cascade", alvos: ["K12"], de: "references public.players (id) on delete cascade,", para: "references public.players (id)," },
  { id: "rollback-esquece-a-tabela", alvos: ["K14"], rollback: true, de: "drop table public.cosmeticos_equipados;", para: "" },
  // os da parte 2 (a toalha)
  { id: "toalha-sem-nivel", alvos: ["K15"], de: "  if v_exige > 1 then", para: "  if false then" },
  { id: "toalha-catalogo-errado", alvos: ["K15"], de: "when p_toalha = 'esmeralda' then 10", para: "when p_toalha = 'esmeralda' then  9" },
  { id: "toalha-aceita-fora-do-catalogo", alvos: ["K16"], de: "  if v_exige is null then\n    raise exception 'toalha fora do catálogo'",
    para: "  if false then\n    raise exception 'toalha fora do catálogo'" },
  { id: "toalha-sem-catalogo-na-coluna", alvos: ["K16", "K22"],
    de: "alter table public.cosmeticos_equipados\n  add constraint cosmeticos_toalha_do_catalogo\n    check (toalha in ('imperial', 'verde', 'vinho', 'azul', 'esmeralda', 'preta'));", para: "" },
  { id: "mesa-sem-efeito", alvos: ["K17"], de: "  select case when v_nivel >= king_private.nivel_da_toalha(v_escolha) then v_escolha else 'imperial' end,", para: "  select v_escolha," },
  { id: "mesa-para-o-cliente", alvos: ["K17", "K19"], de: "grant execute on function king_private.toalhas_do_anfitriao(uuid) to king_server;",
    para: "grant execute on function king_private.toalhas_do_anfitriao(uuid) to king_server, authenticated;\ngrant usage on schema king_private to authenticated;" },
  { id: "toalha-para-anon", alvos: ["K19"], de: "grant execute on function public.equipar_toalha(text) to authenticated;", para: "grant execute on function public.equipar_toalha(text) to authenticated, anon;" },
  { id: "toalha-apaga-as-outras", alvos: ["K18"], de: "    toalha        = p_toalha,\n", para: "    toalha        = p_toalha,\n    moldura       = null,\n" },
  { id: "rollback-da-mesa-esquece-a-coluna", alvos: ["K19"], rollback: true, de: "alter table public.cosmeticos_equipados drop column toalha;", para: "" },
  // os da parte 3 (o catálogo da Entrega C)
  { id: "catalogo-c-errado", alvos: ["K20"], de: "when p_item = 'moldura-diamante'   then 15", para: "when p_item = 'moldura-diamante'   then 14" },
  { id: "moldura-desequipa-a-outra", alvos: ["K21"], de: "                   when c.moldura = v_valor then null", para: "                   when true then null" },
  { id: "reacao-apaga-as-outras", alvos: ["K21"], de: "where case when r = v_valor then p_equipado else r = any (c.reacoes) end",
    para: "where case when r = v_valor then p_equipado else false end" },
  { id: "item-mexe-em-outra-categoria", alvos: ["K21"], de: "    baralho = case when v_tipo <> 'baralho' then c.baralho", para: "    baralho = case when v_tipo <> 'baralho' then null" },
  { id: "reacoes-sem-catalogo-na-coluna", alvos: ["K22"],
    de: "\n    constraint cosmeticos_reacoes_do_catalogo check (reacoes <@ array['fogo', 'coroa', 'caveira', 'aplauso']::text[])", para: "" },
  { id: "assentos-reacao-sem-efeito", alvos: ["K23"], de: "                where public.nivel_de(coalesce(g.xp_total, 0)) >= king_private.nivel_do_item('reacao-' || r)\n",
    para: "                where true\n" },
  { id: "assentos-para-o-cliente", alvos: ["K23", "K24"], de: "grant execute on function king_private.cosmeticos_dos_assentos(uuid[]) to king_server;",
    para: "grant execute on function king_private.cosmeticos_dos_assentos(uuid[]) to king_server, authenticated;\ngrant usage on schema king_private to authenticated;" },
  { id: "item-para-anon", alvos: ["K24"], de: "grant execute on function public.equipar_item(text, boolean) to authenticated;",
    para: "grant execute on function public.equipar_item(text, boolean) to authenticated, anon;" },
  { id: "rollback-do-catalogo-esquece-colunas", alvos: ["K25"], rollback: true, de: "  drop column baralho,\n  drop column reacoes;", para: "  drop column baralho;" },
  { id: "rollback-do-catalogo-perde-a-toalha-nova", alvos: ["K25"], rollback: true,
    de: "update public.cosmeticos_equipados set toalha = 'imperial' where toalha in ('azul', 'preta');", para: "update public.cosmeticos_equipados set toalha = 'imperial' where toalha in ('preta');" },
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
        ? await rodar(MIGRACAO, ROLLBACK.replace(m.de, () => m.para), testes)
        : await rodar(MIGRACAO.replace(m.de, () => m.para), ROLLBACK, testes)).map((r) => r.id);
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

