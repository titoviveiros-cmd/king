// TESTES DOS RECORDES (Entrega D) — Postgres REAL, descartável, com conexões independentes.
//
// Sobe um Postgres 17 embutido num diretório temporário FORA do repositório, aplica o bootstrap que
// emula o mínimo do Supabase, as migrações do progresso e, por cima, a dos recordes — aplicada por um
// papel NÃO superusuário (`supa_postgres`, membro do dono). Cada teste roda num banco próprio, clonado
// do modelo. Contas e XP são SINTÉTICOS; o crédito é o `creditar_partida` de verdade.
//
// Com `--provas`, cada proteção é removida por uma MUTAÇÃO EM MEMÓRIA do texto da migração (ou do
// rollback) e os testes que dependem dela precisam REPROVAR.
//
//   node scripts/testar-recordes-sql.mjs [--provas]
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { ARQUIVO_DO_ROLLOUT, lerMigracao, montarRollout } from "./montar-rollout-recordes.mjs";

const RAIZ = new URL("../", import.meta.url);
const ler = (rel) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
const BOOTSTRAP = ler("supabase/tests/bootstrap-supabase-local.sql");
const ANTERIORES = [
  "supabase/migrations/20260830120000_identidade.sql",
  "supabase/migrations/20260925120000_progresso.sql",
  "supabase/migrations/20261001120000_sequencia.sql",
  "supabase/migrations/20261025130000_credito_com_conta_excluida.sql",
  "supabase/migrations/20261026120000_retencao_das_lapides.sql",
].map(ler);
const MIGRACAO = lerMigracao();
const ROLLBACK = ler("supabase/rollback/20261120120000_recordes_rollback.sql");

const afirmar = (cond, msg) => { if (!cond) throw new Error(msg); };
async function portaLivre() {
  return await new Promise((ok, erro) => {
    const s = createServer();
    s.on("error", erro);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

const SENHA_ADMIN = randomBytes(18).toString("base64url");
const SENHA_SERVIDOR = randomBytes(18).toString("base64url");
const SENHA_SUPABASE = randomBytes(18).toString("base64url");
let PORTA = 0;
const conectar = async (database, user = "postgres", password = SENHA_ADMIN) => {
  const c = new pg.Client({ host: "127.0.0.1", port: PORTA, database, user, password });
  await c.connect();
  return c;
};

async function criarModelo(nome, migracao) {
  const adm = await conectar("postgres");
  await adm.query(`create database ${nome} owner supa_postgres`);
  await adm.end();
  const c = await conectar(nome);
  try {
    await c.query(BOOTSTRAP);
    for (const m of ANTERIORES) await c.query(m);
    await c.query(`alter role king_server login password '${SENHA_SERVIDOR}'`);
    await c.query("grant king_progress_owner to supa_postgres");
    await c.query("grant usage on schema auth to supa_postgres");
  } finally {
    await c.end();
  }
  if (migracao === null) return;
  const s = await conectar(nome, "supa_postgres", SENHA_SUPABASE);
  try { await s.query(migracao); } finally { await s.end(); }
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
    async como(sub) {
      const c = await conectar(nome);
      abertos.push(c);
      await c.query("set role authenticated");
      if (sub) await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, role: "authenticated" })]);
      return c;
    },
    async anonimo() { const c = await conectar(nome); abertos.push(c); await c.query("set role anon"); return c; },
    async jogadores(n) {
      const ids = [];
      for (let i = 0; i < n; i++) { const id = randomUUID(); await admin.query("insert into auth.users (id) values ($1)", [id]); ids.push(id); }
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

/** Um dia diferente por partida (no passado), para o crédito não ver partidas sobrepostas. */
let diaDaPartida = 0;
function janela() {
  const fim = new Date(Date.UTC(2026, 0, 1, 15, 0, 0) + (diaDaPartida++) * 86_400_000);
  return [new Date(fim.getTime() - 25 * 60_000).toISOString(), fim.toISOString()];
}
/** O CRÉDITO REAL de uma partida (king_server → creditar_partida). `humanos`: [{id, posicao, participou}]. */
async function creditar(srv, humanos, partida = randomUUID()) {
  const [ini, fim] = janela();
  await srv.query(
    "select * from king_private.creditar_partida($1::uuid, $2::timestamptz, $3::timestamptz, $4::smallint, $5::smallint, $6::jsonb)",
    [partida, ini, fim, humanos.length, 4 - humanos.length,
      JSON.stringify(humanos.map((h) => ({ player_id: h.id, posicao: h.posicao, participou: h.participou ?? true })))]);
  return { partida, fim };
}
const registrar = (srv, partida, placares) =>
  srv.query("select king_private.registrar_placares($1::uuid, $2::jsonb) as n", [partida, JSON.stringify(placares)]);
/** O Top 3 como o app pede: maior pontuação, depois a mais antiga, depois a partida. */
const top3 = async (c) => (await c.query(
  "select partida_id, pontos, posicao from public.placares_online order by pontos desc, terminada_em, partida_id limit 3")).rows;
async function retratoDoXp(admin) {
  const r = await admin.query(`select (select coalesce(sum(xp_total),0) from public.progresso)::bigint as total,
    (select count(*) from public.xp_eventos)::bigint as lancamentos, (select count(*) from king_private.partidas)::bigint as partidas`);
  return JSON.stringify(r.rows[0]);
}

const TESTES = [
  { id: "D1", nome: "crédito real → placar: só quem foi CREDITADO com XP entra; a POSIÇÃO vem do ledger; reenvio não duplica nem troca o valor", async fn(b) {
    const [a, c, d] = await b.jogadores(3);
    const srv = await b.servidor();
    // d jogou mas NÃO participou (abandono): 0 XP → sem placar
    const { partida } = await creditar(srv, [{ id: a, posicao: 1 }, { id: c, posicao: 2 }, { id: d, posicao: 3, participou: false }]);
    const r = await registrar(srv, partida, [{ player_id: a, pontos: 320 }, { player_id: c, pontos: -15 }, { player_id: d, pontos: -100 }]);
    afirmar(r.rows[0].n === 2, `gravou ${r.rows[0].n}, esperava 2`);
    const linhas = (await b.admin.query("select player_id, pontos, posicao from public.placares_online order by posicao")).rows;
    afirmar(JSON.stringify(linhas.map((l) => [l.player_id, l.pontos, l.posicao])) === JSON.stringify([[a, 320, 1], [c, -15, 2]]), `linhas: ${JSON.stringify(linhas)}`);
    // REENVIO (retry do outbox): nada novo, e o valor original fica — mesmo que o pedido mude
    const de_novo = await registrar(srv, partida, [{ player_id: a, pontos: 999 }, { player_id: c, pontos: -15 }]);
    afirmar(de_novo.rows[0].n === 0, "o reenvio gravou de novo");
    afirmar((await b.admin.query("select pontos from public.placares_online where player_id = $1", [a])).rows[0].pontos === 320, "o reenvio trocou a pontuação");
    afirmar((await b.admin.query("select count(*)::int as n from public.placares_online")).rows[0].n === 2, "linhas duplicadas");
  } },
  { id: "D2", nome: "a porta recusa partida NÃO creditada, forma inesperada, jogador repetido e pontuação fora da faixa", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const srv = await b.servidor();
    await reprova(registrar(srv, randomUUID(), [{ player_id: a, pontos: 10 }]), "22023", "partida inexistente");
    const { partida } = await creditar(srv, [{ id: a, posicao: 1 }, { id: c, posicao: 2 }]);
    for (const [nome, p] of [
      ["vazio", []], ["cinco", [1, 2, 3, 4, 5].map(() => ({ player_id: a, pontos: 1 }))],
      ["campo a mais", [{ player_id: a, pontos: 1, xp: 150 }]], ["sem pontos", [{ player_id: a }]],
      ["pontos texto", [{ player_id: a, pontos: "10" }]], ["pontos fração", [{ player_id: a, pontos: 10.5 }]],
      ["repetido", [{ player_id: a, pontos: 1 }, { player_id: a, pontos: 2 }]], ["não objeto", ["x"]],
    ]) await reprova(registrar(srv, partida, p), "22023", nome);
    await reprova(srv.query("select king_private.registrar_placares($1::uuid, '{}'::jsonb)", [partida]), "22023", "objeto em vez de lista");
    await reprova(registrar(srv, partida, [{ player_id: a, pontos: 5001 }]), "23514", "acima da faixa");
    await reprova(registrar(srv, partida, [{ player_id: a, pontos: -5001 }]), "23514", "abaixo da faixa");
    afirmar((await b.admin.query("select count(*)::int as n from public.placares_online")).rows[0].n === 0, "algo foi gravado");
  } },
  { id: "D3", nome: "Top 3 DETERMINÍSTICO: positivos, negativos e empates (empate → a conquista mais antiga primeiro)", async fn(b) {
    const [eu, outro] = await b.jogadores(2);
    const srv = await b.servidor();
    const jogadas = [];
    for (const pts of [-40, 210, 85, 210, -320, 85]) {
      const { partida, fim } = await creditar(srv, [{ id: eu, posicao: 2 }, { id: outro, posicao: 1 }]);
      await registrar(srv, partida, [{ player_id: eu, pontos: pts }, { player_id: outro, pontos: 999 }]);
      jogadas.push({ partida, fim, pts });
    }
    const t = await top3(await b.como(eu));
    // 210 (a 2ª partida, mais antiga), 210 (a 4ª), 85 (a 3ª, mais antiga que a 6ª)
    afirmar(JSON.stringify(t.map((l) => [l.partida_id, l.pontos])) === JSON.stringify([[jogadas[1].partida, 210], [jogadas[3].partida, 210], [jogadas[2].partida, 85]]),
      `top: ${JSON.stringify(t)}`);
    // só negativos: o Top 3 ainda existe e preserva o sinal
    const [neg] = await b.jogadores(1);
    for (const pts of [-500, -20, -20, -90]) {
      const { partida } = await creditar(srv, [{ id: neg, posicao: 4 }, { id: outro, posicao: 1 }]);
      await registrar(srv, partida, [{ player_id: neg, pontos: pts }]);
    }
    afirmar((await top3(await b.como(neg))).map((l) => l.pontos).join() === "-20,-20,-90", "top só de negativos");
    // usuário NOVO: vazio
    const [novo] = await b.jogadores(1);
    afirmar((await top3(await b.como(novo))).length === 0, "usuário novo com recorde");
  } },
  { id: "D4", nome: "isolamento: cada um lê só os PRÓPRIOS placares; anon e o servidor não leem a tabela; ninguém da API escreve", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const srv = await b.servidor();
    const { partida } = await creditar(srv, [{ id: a, posicao: 1 }, { id: c, posicao: 2 }]);
    await registrar(srv, partida, [{ player_id: a, pontos: 100 }, { player_id: c, pontos: 50 }]);
    const vistoA = (await (await b.como(a)).query("select player_id from public.placares_online")).rows;
    afirmar(vistoA.length === 1 && vistoA[0].player_id === a, `A enxergou ${JSON.stringify(vistoA)}`);
    const cli = await b.como(a);
    await reprova(cli.query("insert into public.placares_online (partida_id, player_id, pontos, posicao, terminada_em) values ($1, $2, 5000, 1, now())", [randomUUID(), a]), "42501", "insert direto");
    await reprova(cli.query("update public.placares_online set pontos = 5000"), "42501", "update direto");
    await reprova(cli.query("delete from public.placares_online"), "42501", "delete direto");
    await reprova(registrar(cli, partida, [{ player_id: a, pontos: 5000 }]), "42501", "cliente executou a porta");
    await reprova((await b.anonimo()).query("select * from public.placares_online"), "42501", "anon leu");
    await reprova(srv.query("select * from public.placares_online"), "42501", "servidor leu a tabela");
    await reprova((await b.como(null)).query("select king_private.registrar_placares($1::uuid, '[]'::jsonb)", [partida]), "42501", "authenticated sem sub executou");
  } },
  { id: "D5", nome: "na MESMA transação do crédito (como o servidor faz): tudo ou nada; e a CONCORRÊNCIA de duas entregas grava uma vez", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const srv = await b.servidor();
    // transação que falha DEPOIS do crédito: nem XP, nem placar
    const partida = randomUUID();
    const [ini, fim] = janela();
    await srv.query("begin");
    await srv.query("select * from king_private.creditar_partida($1::uuid, $2, $3, 2::smallint, 2::smallint, $4::jsonb)",
      [partida, ini, fim, JSON.stringify([{ player_id: a, posicao: 1, participou: true }, { player_id: c, posicao: 2, participou: true }])]);
    await reprova(registrar(srv, partida, [{ player_id: a, pontos: 9999 }]), "23514", "fora da faixa");
    await srv.query("rollback");
    afirmar((await b.admin.query("select count(*)::int as n from public.xp_eventos where partida_id = $1", [partida])).rows[0].n === 0, "o crédito ficou sem o placar");
    // duas entregas simultâneas da mesma partida (retry correndo com a 1ª): uma linha por jogador
    const { partida: p2 } = await creditar(srv, [{ id: a, posicao: 1 }, { id: c, posicao: 2 }]);
    const [s1, s2] = [await b.servidor(), await b.servidor()];
    const r = await Promise.all([registrar(s1, p2, [{ player_id: a, pontos: 70 }, { player_id: c, pontos: 30 }]), registrar(s2, p2, [{ player_id: a, pontos: 70 }, { player_id: c, pontos: 30 }])]);
    afirmar(r[0].rows[0].n + r[1].rows[0].n === 2, `gravou ${r[0].rows[0].n}+${r[1].rows[0].n}`);
    afirmar((await b.admin.query("select count(*)::int as n from public.placares_online where partida_id = $1", [p2])).rows[0].n === 2, "duplicou");
  } },
  { id: "D6", nome: "excluir a conta leva os placares junto (cascade) e não trava a exclusão; a partida continua para os outros", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const srv = await b.servidor();
    const { partida } = await creditar(srv, [{ id: a, posicao: 1 }, { id: c, posicao: 2 }]);
    await registrar(srv, partida, [{ player_id: a, pontos: 100 }, { player_id: c, pontos: 50 }]);
    await b.admin.query("delete from auth.users where id = $1", [a]);
    const n = (await b.admin.query("select player_id from public.placares_online")).rows;
    afirmar(n.length === 1 && n[0].player_id === c, `sobrou: ${JSON.stringify(n)}`);
  } },
  { id: "D7", nome: "xp_por_nivel é a MESMA curva do banco (N1=0 … N18=8500) e bate com meu_progresso; anon não lê", async fn(b) {
    const [eu] = await b.jogadores(1);
    const c = await b.como(eu);
    const r = (await c.query("select nivel, xp from public.xp_por_nivel where nivel <= 18 order by nivel")).rows;
    const esperado = [0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3250, 3850, 4500, 5200, 5950, 6750, 7600, 8500];
    afirmar(r.map((l) => Number(l.xp)).join() === esperado.join(), `curva: ${r.map((l) => l.xp).join()}`);
    afirmar((await c.query("select count(*)::int as n from public.xp_por_nivel")).rows[0].n === 100, "não são 100 níveis");
    await b.admin.query("insert into public.progresso (player_id, xp_total) values ($1, 2950)", [eu]);
    const p = (await c.query("select nivel, xp_no_nivel, xp_do_nivel from public.meu_progresso")).rows[0];
    const lim = (await c.query("select xp from public.xp_por_nivel where nivel in ($1, $2) order by nivel", [p.nivel, p.nivel + 1])).rows.map((l) => Number(l.xp));
    afirmar(p.nivel === 10 && 2950 - lim[0] === p.xp_no_nivel && lim[1] - lim[0] === p.xp_do_nivel, `meu_progresso ${JSON.stringify(p)} × ${lim}`);
    await reprova((await b.anonimo()).query("select * from public.xp_por_nivel"), "42501", "anon leu a curva");
  } },
  { id: "D8", nome: "privilégios exatos, dono dedicado, SECURITY DEFINER e search_path vazio", async fn(b) {
    const tab = (await b.admin.query(`select grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name in ('placares_online', 'xp_por_nivel') and grantee in ('anon','authenticated','service_role','king_server','PUBLIC')
      order by table_name, grantee, privilege_type`)).rows.map((r) => `${r.grantee}:${r.privilege_type}`).join(",");
    afirmar(tab === "authenticated:SELECT,authenticated:SELECT", `grants: ${tab}`);
    for (const [papel, pode] of Object.entries({ authenticated: false, anon: false, service_role: false, king_server: true })) {
      const r = await b.admin.query("select has_function_privilege($1, 'king_private.registrar_placares(uuid,jsonb)', 'execute') as ok", [papel]);
      afirmar(r.rows[0].ok === pode, `${papel} ${pode ? "não executa" : "executa"} a porta`);
    }
    const f = (await b.admin.query(`select pg_get_userbyid(proowner) as dono, prosecdef, proconfig from pg_proc where proname = 'registrar_placares'`)).rows[0];
    afirmar(f.dono === "king_progress_owner" && f.prosecdef && f.proconfig?.join() === 'search_path=""', JSON.stringify(f));
    afirmar((await b.admin.query("select relrowsecurity from pg_class where oid = 'public.placares_online'::regclass")).rows[0].relrowsecurity, "RLS desligada");
  } },
  { id: "D9", nome: "rollback tira SÓ os recordes (XP, ledger e partidas intactos) e a migração reaplica", async fn(b, { migracao, rollback }) {
    const [a, c] = await b.jogadores(2);
    const srv = await b.servidor();
    const { partida } = await creditar(srv, [{ id: a, posicao: 1 }, { id: c, posicao: 2 }]);
    await registrar(srv, partida, [{ player_id: a, pontos: 100 }]);
    const xp = await retratoDoXp(b.admin);
    const s = await b.supabase();
    await s.query(rollback);
    const o = (await b.admin.query(`select to_regclass('public.placares_online') as t, to_regclass('public.xp_por_nivel') as v,
      to_regprocedure('king_private.registrar_placares(uuid,jsonb)') as f`)).rows[0];
    afirmar(!o.t && !o.v && !o.f, `o rollback deixou: ${JSON.stringify(o)}`);
    afirmar(await retratoDoXp(b.admin) === xp, "o rollback mexeu no XP");
    await s.query(migracao);
    afirmar((await registrar(await b.servidor(), partida, [{ player_id: a, pontos: 100 }])).rows[0].n === 1, "reaplicada, não grava");
  } },
];

// ══ O SERVIDOR COMPILADO — o MESMO repositório que vai para a VPS (apps/server/dist) ════════════════
// Prova o que o servidor faz na transação do crédito: o placar entra junto; a reentrega não duplica;
// e o XP NUNCA depende do placar (banco sem a migração, ou placar recusado pelo banco).
const repositorioDoServidor = async (b) => {
  const { repositorioPg } = await import(new URL("apps/server/dist/progresso/repositorio.js", RAIZ).href);
  const pool = new pg.Pool({ host: "127.0.0.1", port: PORTA, database: b.nome, user: "king_server", password: SENHA_SERVIDOR, max: 2 });
  return { repo: repositorioPg({ pool }), fechar: () => pool.end() };
};
function resultado(humanos) {
  const [ini, fim] = janela();
  return { partidaId: randomUUID(), iniciadaEm: ini, terminadaEm: fim, bots: 4 - humanos.length,
    humanos: humanos.map((h) => ({ playerId: h.id, posicao: h.posicao, participou: h.participou ?? true, ...(h.pontos !== undefined ? { pontos: h.pontos } : {}) })) };
}
const TESTES_DO_SERVIDOR = [
  { id: "S1", nome: "servidor COM a migração: crédito + placar na mesma transação; a reentrega (retry do outbox) não duplica nada", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const { repo, fechar } = await repositorioDoServidor(b);
    try {
      const r = resultado([{ id: a, posicao: 1, pontos: 275 }, { id: c, posicao: 2, pontos: -40 }]);
      const l1 = await repo.creditar(r);
      const l2 = await repo.creditar(r);
      afirmar(l1.every((l) => l.novo) && l2.every((l) => !l.novo), "o crédito não é idempotente");
      const p = (await b.admin.query("select player_id, pontos, posicao from public.placares_online order by posicao")).rows;
      afirmar(JSON.stringify(p.map((x) => [x.player_id, x.pontos, x.posicao])) === JSON.stringify([[a, 275, 1], [c, -40, 2]]), JSON.stringify(p));
      // resultado ANTIGO (sem pontos, do outbox de antes): só o crédito, como sempre
      const velho = resultado([{ id: a, posicao: 2 }, { id: c, posicao: 1 }]);
      await repo.creditar(velho);
      afirmar((await b.admin.query("select count(*)::int as n from public.xp_eventos where partida_id = $1", [velho.partidaId])).rows[0].n === 2, "o resultado antigo não creditou");
      afirmar((await b.admin.query("select count(*)::int as n from public.placares_online")).rows[0].n === 2, "placar a mais");
    } finally { await fechar(); }
  } },
  { id: "S2", nome: "o XP NUNCA depende do placar: placar recusado pelo banco → XP creditado, sem placar", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const { repo, fechar } = await repositorioDoServidor(b);
    try {
      // fora da faixa do banco (o validador do servidor barraria; aqui se prova a última trincheira)
      const r = resultado([{ id: a, posicao: 1, pontos: 9999 }, { id: c, posicao: 2, pontos: 10 }]);
      const l = await repo.creditar(r);
      afirmar(l.length === 2 && l.every((x) => x.xpDelta > 0), `o XP não foi creditado: ${JSON.stringify(l)}`);
      afirmar((await b.admin.query("select count(*)::int as n from public.placares_online where partida_id = $1", [r.partidaId])).rows[0].n === 0, "placar parcial gravado");
    } finally { await fechar(); }
  } },
];

// ══ O ROLLOUT DE PRODUCTION — o ARQUIVO exato que seria colado no SQL Editor ═════════════════════
const ROLLOUT = ler(ARQUIVO_DO_ROLLOUT);
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
async function retratoDoBanco(admin) {
  const r = await admin.query(`select (select array_agg(x order by x collate "C") from (
       select c.oid::regclass::text || ' ' || coalesce(c.relacl::text, '-') || ' ' || pg_get_userbyid(c.relowner) as x
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','king_private') and c.relkind in ('r','v','m','S','p','f')
       union all select p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, '-') || ' ' || pg_get_userbyid(p.proowner) || ' ' || p.prosecdef
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','king_private')
       union all select 'schema ' || nspname || ' ' || coalesce(nspacl::text, '-') from pg_namespace where nspname in ('public','king_private')
       union all select 'policy ' || polrelid::regclass::text || ' ' || polname from pg_policy) as t) as tudo`);
  return JSON.stringify(r.rows[0].tudo) + (await retratoDoXp(admin));
}
const semRecordes = async (admin) => (await admin.query(`select to_regclass('public.placares_online') is null
  and to_regclass('public.xp_por_nivel') is null and to_regprocedure('king_private.registrar_placares(uuid,jsonb)') is null as ok`)).rows[0].ok;
/** Um banco "como Production hoje" com uma partida creditada de verdade. */
async function semear(b) {
  const [a, c] = await b.jogadores(2);
  await creditar(await b.servidor(), [{ id: a, posicao: 1 }, { id: c, posicao: 2 }]);
  return [a, c];
}
const DEFEITOS = [
  ["porta-para-o-cliente", "grant execute on function king_private.registrar_placares(uuid, jsonb) to king_server;",
    "grant execute on function king_private.registrar_placares(uuid, jsonb) to king_server, authenticated;"],
  ["sem-rls", "alter table public.placares_online enable row level security;\n", ""],
  ["politica-aberta", "for select to authenticated using ((select auth.uid()) = player_id);", "for select to authenticated using (true);"],
  ["cliente-escreve", "grant select on table public.placares_online to authenticated;", "grant select, insert on table public.placares_online to authenticated;"],
  ["sem-cascade", "references public.players (id) on delete cascade,", "references public.players (id),"],
  ["sem-faixa", "  constraint placares_online_pontos  check (pontos between -5000 and 5000),\n", ""],
  ["curva-errada", "select n::integer as nivel, public.xp_para_nivel(n)::bigint as xp", "select n::integer as nivel, public.xp_para_nivel(n + 1)::bigint as xp"],
  ["mexe-no-xp", "reset role;\nrevoke create on schema public from king_progress_owner;", "update public.progresso set xp_total = xp_total + 1;\nreset role;\nrevoke create on schema public from king_progress_owner;"],
  ["esquece-de-fechar-o-schema", "reset role;\nrevoke create on schema public from king_progress_owner;\n", "reset role;\n"],
];
const comDefeito = (de, para) => { afirmar(MIGRACAO.split(de).length === 2, `defeito: trecho não encontrado 1 vez: ${de.slice(0, 60)}`); return MIGRACAO.replace(de, () => para); };
const TESTES_DO_ROLLOUT = [
  { id: "R1", nome: "o ARQUIVO do rollout é a migração VERBATIM (sha256 no cabeçalho) e confere com o montador", async fn() {
    afirmar(ROLLOUT === montarRollout(), "o arquivo gravado diverge do que o montador monta hoje");
    afirmar(ROLLOUT.split(MIGRACAO).length === 2, "a migração não está inteira, uma vez, no arquivo");
    afirmar(ROLLOUT.includes(createHash("sha256").update(MIGRACAO).digest("hex")), "sha256 errado");
    afirmar(/^begin;$/m.test(ROLLOUT) && /^commit;$/m.test(ROLLOUT), "sem BEGIN/COMMIT");
  } },
  { id: "R2", nome: "aplicado INTEIRO pelo papel do SQL Editor: relatório, porta funcionando, XP idêntico", async fn(b) {
    const [a, c] = await semear(b);
    const xp = await retratoDoXp(b.admin);
    const r = await colar(await b.supabase(), ROLLOUT);
    afirmar(r.erro === null, `o rollout falhou: ${r.erro}`);
    afirmar(r.linha.resultado === "RECORDES (ENTREGA D) APLICADA E CONFERIDA" && String(r.linha.placares_gravados) === "0", JSON.stringify(r.linha));
    afirmar(await retratoDoXp(b.admin) === xp, "o rollout mexeu no XP");
    const srv = await b.servidor();
    const { partida } = await creditar(srv, [{ id: a, posicao: 1 }, { id: c, posicao: 2 }]);
    afirmar((await registrar(srv, partida, [{ player_id: a, pontos: 140 }])).rows[0].n === 1, "a porta não grava depois do rollout");
  } },
  { id: "R3", nome: "colado DUAS vezes: a segunda recusa na parte 1 e não altera nada", async fn(b) {
    await semear(b);
    const s = await b.supabase();
    afirmar((await colar(s, ROLLOUT)).erro === null, "1ª aplicação falhou");
    const antes = await retratoDoBanco(b.admin);
    const r = await colar(s, ROLLOUT);
    afirmar(r.erro?.includes("ROLLOUT RECORDES ABORTADO (parte 1)"), `a 2ª não recusou: ${r.erro}`);
    afirmar(await retratoDoBanco(b.admin) === antes, "a 2ª aplicação alterou o banco");
  } },
  { id: "R4", nome: `arquivo com DEFEITO na migração aborta nas conferências e não grava NADA (${DEFEITOS.length} defeitos)`, async fn(b) {
    await semear(b);
    const s = await b.supabase();
    const antes = await retratoDoBanco(b.admin);
    for (const [nome, de, para] of DEFEITOS) {
      const r = await colar(s, montarRollout(comDefeito(de, para)));
      afirmar(r.erro !== null, `defeito ${nome}: o arquivo foi APLICADO`);
      afirmar(/CONFER[ÊE]NCIA \d FALHOU/.test(r.erro), `defeito ${nome}: abortou, mas não pela conferência: ${r.erro}`);
      afirmar(await semRecordes(b.admin), `defeito ${nome}: sobrou objeto`);
      afirmar(await retratoDoBanco(b.admin) === antes, `defeito ${nome}: o banco mudou`);
    }
  } },
  { id: "R5", nome: "ROLLBACK depois do rollout: volta EXATAMENTE ao banco de antes, XP intacto", async fn(b) {
    await semear(b);
    const s = await b.supabase();
    const antes = await retratoDoBanco(b.admin);
    afirmar((await colar(s, ROLLOUT)).erro === null, "rollout falhou");
    const r = await colar(s, ROLLBACK);
    afirmar(r.erro === null, `rollback falhou: ${r.erro}`);
    afirmar(await semRecordes(b.admin), "o rollback deixou objeto");
    afirmar(await retratoDoBanco(b.admin) === antes, "não voltou EXATAMENTE ao de antes");
  } },
];

const MUTACOES = [
  { id: "sem-exigir-xp", alvos: ["D1"], de: "where e.partida_id = p_partida and e.player_id = v_pid and e.xp_delta > 0", para: "where e.partida_id = p_partida and e.player_id = v_pid" },
  { id: "sem-idempotencia", alvos: ["D1", "D5"], de: "\n    on conflict on constraint placares_online_uma_vez do nothing;", para: ";" },
  { id: "aceita-partida-nao-creditada", alvos: ["D2"], de: "  if v_fim is null then\n    raise exception 'partida não creditada'", para: "  if false then\n    raise exception 'partida não creditada'" },
  { id: "aceita-forma-livre", alvos: ["D2"], de: "       or (select array_agg(k order by k) from jsonb_object_keys(v_item) as k) is distinct from array['player_id', 'pontos']::text[]\n", para: "\n" },
  { id: "aceita-repetido", alvos: ["D2"], de: "    if v_pid = any (v_vistos) then", para: "    if false then" },
  { id: "sem-faixa", alvos: ["D2", "D5"], de: "  constraint placares_online_pontos  check (pontos between -5000 and 5000),\n", para: "" },
  { id: "rls-le-todo-mundo", alvos: ["D4"], de: "for select to authenticated using ((select auth.uid()) = player_id);", para: "for select to authenticated using (true);" },
  { id: "porta-para-o-cliente", alvos: ["D4", "D8"], de: "grant execute on function king_private.registrar_placares(uuid, jsonb) to king_server;",
    para: "grant execute on function king_private.registrar_placares(uuid, jsonb) to king_server, authenticated;\ngrant usage on schema king_private to authenticated;" },
  { id: "cliente-escreve", alvos: ["D4", "D8"], de: "grant select on table public.placares_online to authenticated;",
    para: "grant select, insert, update, delete on table public.placares_online to authenticated;\ncreate policy placares_gravo on public.placares_online for all to authenticated using (true) with check (true);" },
  { id: "sem-cascade", alvos: ["D6"], de: "references public.players (id) on delete cascade,", para: "references public.players (id)," },
  { id: "curva-errada", alvos: ["D7"], de: "select n::integer as nivel, public.xp_para_nivel(n)::bigint as xp", para: "select n::integer as nivel, public.xp_para_nivel(n + 1)::bigint as xp" },
  { id: "posicao-do-pedido", alvos: ["D1"], de: "    select p_partida, e.player_id, (v_item ->> 'pontos')::integer, e.posicao, v_fim", para: "    select p_partida, e.player_id, (v_item ->> 'pontos')::integer, 1, v_fim" },
  { id: "rollback-esquece-a-tabela", alvos: ["D9"], rollback: true, de: "drop table public.placares_online;", para: "" },
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
const dir = mkdtempSync(join(tmpdir(), "king-recordes-sql-"));
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

  console.log("\nRECORDES — migração e rollback originais");
  const reprovados = await rodar(MIGRACAO, ROLLBACK, TESTES);
  for (const t of TESTES) {
    const r = reprovados.find((x) => x.id === t.id);
    if (r) { falhou = true; console.error(`  XX  ${t.id} ${t.nome}\n        ${r.motivo}`); }
    else console.log(`  ok  ${t.id} ${t.nome}`);
  }
  console.log("\nSERVIDOR COMPILADO — o repositório da VPS contra o banco");
  const reprovadosS = await rodar(MIGRACAO, ROLLBACK, TESTES_DO_SERVIDOR);
  // S3: banco SEM a migração (o servidor novo antes do banco): o crédito segue, o placar é pulado
  reprovadosS.push(...await rodar(null, ROLLBACK, [{ id: "S3", nome: "servidor novo com banco SEM a migração: o crédito segue normal, o placar é só pulado", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const { repo, fechar } = await repositorioDoServidor(b);
    try {
      const r = resultado([{ id: a, posicao: 1, pontos: 50 }, { id: c, posicao: 2, pontos: 20 }]);
      const l = await repo.creditar(r);
      afirmar(l.length === 2 && l.every((x) => x.novo && x.xpDelta > 0), `crédito: ${JSON.stringify(l)}`);
    } finally { await fechar(); }
  } }]));
  for (const t of [...TESTES_DO_SERVIDOR, { id: "S3", nome: "servidor novo com banco SEM a migração: o crédito segue normal, o placar é só pulado" }]) {
    const r = reprovadosS.find((x) => x.id === t.id);
    if (r) { falhou = true; console.error(`  XX  ${t.id} ${t.nome}\n        ${r.motivo}`); }
    else console.log(`  ok  ${t.id} ${t.nome}`);
  }
  console.log("\nROLLOUT DE PRODUCTION — o arquivo exato, num banco como o de hoje (contas e XP sintéticos)");
  const reprovadosR = await rodar(null, ROLLBACK, TESTES_DO_ROLLOUT);
  for (const t of TESTES_DO_ROLLOUT) {
    const r = reprovadosR.find((x) => x.id === t.id);
    if (r) { falhou = true; console.error(`  XX  ${t.id} ${t.nome}\n        ${r.motivo}`); }
    else console.log(`  ok  ${t.id} ${t.nome}`);
  }
  const total = TESTES.length + TESTES_DO_ROLLOUT.length + TESTES_DO_SERVIDOR.length + 1;
  console.log(`\n${total - reprovados.length - reprovadosR.length - reprovadosS.length}/${total} testes verdes${PROVAS ? `, ${MUTACOES.length} mutações` : ""}`);
} catch (e) {
  falhou = true;
  console.error("\nERRO DE INFRAESTRUTURA:", e?.message ?? e);
} finally {
  if (banco) await banco.stop().catch(() => {});
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); }
  catch (e) { console.warn(`\naviso: a pasta temporária ${dir} ficou para trás (${e?.code ?? e}); pode apagar à mão.`); }
}
console.log(falhou ? "\nREPROVADO\n" : "\nAPROVADO\n");
process.exit(falhou ? 1 : 0);
