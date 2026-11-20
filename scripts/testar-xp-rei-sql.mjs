// TESTES DA PENALIDADE DO REI NO XP (Entrega C) — Postgres REAL, descartável, com conexões independentes.
//
// Sobe um Postgres 17 embutido num diretório temporário FORA do repositório, aplica o bootstrap que
// emula o mínimo do Supabase, as migrações do progresso (e a dos recordes, como o banco pode estar) e,
// por cima, a da penalidade — aplicada por um papel NÃO superusuário (`supa_postgres`, membro do dono),
// como o `postgres` do SQL Editor. Cada teste roda num banco próprio, clonado do modelo. Contas e XP são
// SINTÉTICOS; o crédito é o de verdade (`creditar_partida_v2` e a v1 intocada).
//
// ══ AS CORRIDAS ══
//
// Sem cronômetro, como na suíte do progresso: uma conexão de fora segura a linha do jogador com a MESMA
// trava da função (`for update`), as chamadas são disparadas, e o teste espera o PRÓPRIO Postgres dizer
// que cada uma está parada (`pg_blocking_pids`) antes de soltar. Com a trava da função, nenhuma leu o
// passado quando para; sem ela, todas já leram — e o resultado muda de forma determinística.
//
// ══ AS QUATRO COMBINAÇÕES ══
//
// O servidor COMPILADO (apps/server/dist, o mesmo artefato da VPS) contra banco com e sem a migração; e o
// "servidor antigo", que é exatamente a chamada v1 de sempre (CHAMADA_DE_CREDITO + parametrosDoCredito).
//
// Com `--provas`, cada proteção é removida por uma MUTAÇÃO EM MEMÓRIA do texto da migração (ou do
// rollback) e os testes que dependem dela precisam REPROVAR.
//
//   node scripts/testar-xp-rei-sql.mjs [--provas]
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { ARQUIVO_DO_ROLLOUT, lerMigracao, montarRollout } from "./montar-rollout-xp-rei.mjs";

const RAIZ = new URL("../", import.meta.url);
const ler = (rel) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
const BOOTSTRAP = ler("supabase/tests/bootstrap-supabase-local.sql");
const PROGRESSO = [
  "supabase/migrations/20260830120000_identidade.sql",
  "supabase/migrations/20260925120000_progresso.sql",
  "supabase/migrations/20261001120000_sequencia.sql",
  "supabase/migrations/20261025130000_credito_com_conta_excluida.sql",
  "supabase/migrations/20261026120000_retencao_das_lapides.sql",
].map(ler);
const RECORDES = ler("supabase/migrations/20261120120000_recordes.sql");
const MIGRACAO = lerMigracao();
const ROLLBACK = ler("supabase/rollback/20261121120000_xp_penalidade_rei_rollback.sql");
const CHECKPOINT_1 = ler("supabase/rollout/xp-rei-checkpoint-1-antes.sql");
const CHECKPOINT_3 = ler("supabase/rollout/xp-rei-checkpoint-3-depois.sql");
const ROLLOUT = ler(ARQUIVO_DO_ROLLOUT);

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
const SENHA_ESTRANHO = randomBytes(18).toString("base64url");
let PORTA = 0;
const conectar = async (database, user = "postgres", password = SENHA_ADMIN) => {
  const c = new pg.Client({ host: "127.0.0.1", port: PORTA, database, user, password });
  c.on("error", () => {});
  await c.connect();
  return c;
};

/** Um modelo: progresso (+ recordes, por padrão) e, se `migracao` não for null, a Entrega C por cima. */
async function criarModelo(nome, migracao, { recordes = true } = {}) {
  const adm = await conectar("postgres");
  await adm.query(`create database ${nome} owner supa_postgres`);
  await adm.end();
  const c = await conectar(nome);
  try {
    await c.query(BOOTSTRAP);
    for (const m of PROGRESSO) await c.query(m);
    if (recordes) await c.query(RECORDES);
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
    async estranho() { const c = await conectar(nome, "estranho", SENHA_ESTRANHO); abertos.push(c); return c; },
    async outraAdmin() { const c = await conectar(nome); abertos.push(c); return c; },
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

// ── o tempo das partidas ──
/** Um dia diferente por partida (no passado): o crédito não vê sobreposição nem soma o dia. */
let diaDaPartida = 0;
function outroDia() {
  const fim = new Date(Date.UTC(2026, 0, 1, 15, 0, 0) + (diaDaPartida++) * 86_400_000);
  return { ini: new Date(fim.getTime() - 25 * 60_000).toISOString(), fim: fim.toISOString() };
}
/** A i-ésima partida (0..) de UM dia de São Paulo, 30 min uma da outra, sem se sobrepor. */
function noMesmoDia(i, dia = "2026-03-10") {
  const ini = new Date(Date.parse(`${dia}T08:00:00-03:00`) + i * 30 * 60_000);
  return { ini: ini.toISOString(), fim: new Date(ini.getTime() + 20 * 60_000).toISOString() };
}

const CHAMADA_V1 = "select player_id, posicao, xp_delta, novo from king_private.creditar_partida($1::uuid, $2::timestamptz, $3::timestamptz, $4::smallint, $5::smallint, $6::jsonb)";
const CHAMADA_V2 = "select player_id, posicao, xp_delta, novo from king_private.creditar_partida_v2($1::uuid, $2::timestamptz, $3::timestamptz, $4::smallint, $5::smallint, $6::jsonb)";
/**
 * O crédito REAL. `humanos`: [{id, posicao, participou?, rei?}]. `versao` 2 manda `capturou_rei`; 1 é o
 * contrato de sempre (o do servidor antigo, e o da pendência antiga do outbox).
 */
async function creditar(c, humanos, { versao = 2, partida = randomUUID(), quando = outroDia(), bruto = null } = {}) {
  const itens = bruto ?? humanos.map((h) => ({
    player_id: h.id, posicao: h.posicao, participou: h.participou ?? true, ...(versao === 2 ? { capturou_rei: h.rei ?? false } : {}),
  }));
  const { rows } = await c.query(versao === 2 ? CHAMADA_V2 : CHAMADA_V1,
    [partida, quando.ini, quando.fim, humanos.length, 4 - humanos.length, JSON.stringify(itens)]);
  return { partida, linhas: rows };
}
const xpDe = (linhas, id) => linhas.find((l) => l.player_id === id)?.xp_delta;
const composicao = async (admin, partida) => Object.fromEntries((await admin.query(
  "select player_id, versao_regra, xp_bruto, penalidade_rei, reducao_diaria, xp_liquido from public.xp_composicao where partida_id = $1",
  [partida])).rows.map((r) => [r.player_id, [r.xp_bruto, r.penalidade_rei, r.reducao_diaria, r.xp_liquido, r.versao_regra]]));
const versaoDa = async (admin, partida) => (await admin.query("select versao_regra from king_private.partidas where id = $1", [partida])).rows[0]?.versao_regra;
const total = async (admin, id) => (await admin.query("select xp_total from public.progresso where player_id = $1", [id])).rows[0]?.xp_total ?? 0;
async function retratoDoXp(admin) {
  const r = await admin.query(`select (select coalesce(sum(xp_total),0) from public.progresso)::bigint as total,
    (select count(*) from public.xp_eventos)::bigint as lancamentos, (select coalesce(sum(xp_delta),0) from public.xp_eventos)::bigint as ledger,
    (select count(*) from king_private.partidas)::bigint as partidas,
    (select count(*) from public.progresso g where g.xp_total <> (select coalesce(sum(e.xp_delta),0) from public.xp_eventos e where e.player_id = g.player_id))::bigint as divergentes`);
  return JSON.stringify(r.rows[0]);
}
/** O ledger coerente: o agregado bate com a soma, e cada composição bate com o SEU lançamento. */
async function ledgerCoerente(admin) {
  const r = (await admin.query(`select
      (select count(*) from public.progresso g where g.xp_total <> (select coalesce(sum(e.xp_delta),0) from public.xp_eventos e where e.player_id = g.player_id))::int as agregado,
      (select count(*) from public.xp_composicao c join public.xp_eventos e using (partida_id, player_id, motivo) where c.xp_liquido <> e.xp_delta)::int as composicao,
      (select count(*) from public.xp_composicao c join king_private.partidas p on p.id = c.partida_id where p.versao_regra <> 2)::int as versao`)).rows[0];
  afirmar(r.agregado === 0 && r.composicao === 0 && r.versao === 0, `ledger incoerente: ${JSON.stringify(r)}`);
}

// ── corridas sem relógio (o mesmo método da suíte do progresso) ──
async function segurarJogador(b, id) {
  const c = await b.outraAdmin();
  await c.query("begin");
  await c.query("select 1 from public.progresso where player_id = $1 for update", [id]);
  return { pid: c.processID, soltar: () => c.query("commit") };
}
function disparar(c, humanos, opcoes) {
  const p = creditar(c, humanos, opcoes);
  const estado = { terminou: false };
  p.then(() => { estado.terminou = true; }, () => { estado.terminou = true; });
  return { pid: c.processID, p, estado };
}
async function paradaOuTerminou(b, chamada, por) {
  const prazo = Date.now() + 60_000;
  while (Date.now() < prazo) {
    const { rows: [r] } = await b.admin.query("select pg_blocking_pids($1) as quem", [chamada.pid]);
    if (chamada.estado.terminou) return "terminou";
    if (r.quem.length && r.quem.every((q) => por.includes(q))) return "parada";
    await new Promise((ok) => setTimeout(ok, 5));
  }
  throw new Error("a chamada nem parou nem terminou em 60 s");
}
async function corridaSobATrava(b, jogador, disparos) {
  const trava = await segurarJogador(b, jogador);
  const chamadas = disparos.map(([c, humanos, opcoes]) => disparar(c, humanos, opcoes));
  const por = [trava.pid, ...chamadas.map((c) => c.pid)];
  for (const c of chamadas) afirmar(await paradaOuTerminou(b, c, por) === "parada", "uma chamada terminou com o jogador travado por fora");
  await trava.soltar();
  return Promise.all(chamadas.map((c) => c.p));
}
/** Cinco partidas no mesmo dia para A (e um parceiro): a próxima do dia é a 6ª; a seguinte, a 7ª. */
async function cincoNoDia(srv, a, x) {
  for (let i = 0; i < 5; i++) await creditar(srv, [{ id: a, posicao: 2 }, { id: x, posicao: 1 }], { quando: noMesmoDia(i) });
}

const TESTES = [
  { id: "X1", nome: "a regra do documento: com captura 1º 90 · 2º 70 · 3º 55 · 4º 40; sem captura 150/130/115/100; composição e versão 2 gravadas", async fn(b) {
    const [a, c, d, e] = await b.jogadores(4);
    const srv = await b.servidor();
    const esperado = { 1: [150, 90], 2: [130, 70], 3: [115, 55], 4: [100, 40] };
    for (const [quem, pos] of [[a, 1], [c, 2], [d, 3], [e, 4]]) {
      const mesa = [{ id: a, posicao: 1 }, { id: c, posicao: 2 }, { id: d, posicao: 3 }, { id: e, posicao: 4 }].map((h) => ({ ...h, rei: h.id === quem }));
      const { partida, linhas } = await creditar(srv, mesa);
      afirmar(linhas.length === 4 && linhas.every((l) => l.novo), `lançamentos: ${JSON.stringify(linhas)}`);
      for (const h of mesa) {
        const [bruto, comRei] = esperado[h.posicao];
        afirmar(xpDe(linhas, h.id) === (h.rei ? comRei : bruto), `posição ${h.posicao} (rei=${h.rei}) recebeu ${xpDe(linhas, h.id)}`);
      }
      const comp = await composicao(b.admin, partida);
      afirmar(JSON.stringify(comp[quem]) === JSON.stringify([esperado[pos][0], 60, 0, esperado[pos][1], 2]), `composição do capturador: ${JSON.stringify(comp[quem])}`);
      afirmar(Object.keys(comp).length === 4, "faltou composição");
      afirmar(await versaoDa(b.admin, partida) === 2, "a partida não ficou na regra 2");
    }
    // cada um capturou uma vez: 3 partidas cheias + 1 com −60
    afirmar(await total(b.admin, a) === 150 * 3 + 90 && await total(b.admin, e) === 100 * 3 + 40, "o agregado não bate");
    await ledgerCoerente(b.admin);
  } },
  { id: "X2", nome: "redução diária DEPOIS da penalidade: a 6ª do dia é cheia (90), a 7ª vira 22 (90÷4); o 4º com captura vira 10", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const srv = await b.servidor();
    await cincoNoDia(srv, a, x);
    const sexta = await creditar(srv, [{ id: a, posicao: 1, rei: true }, { id: x, posicao: 2 }], { quando: noMesmoDia(5) });
    afirmar(xpDe(sexta.linhas, a) === 90, `6ª: ${xpDe(sexta.linhas, a)}`);
    const setima = await creditar(srv, [{ id: a, posicao: 1, rei: true }, { id: x, posicao: 2 }], { quando: noMesmoDia(6) });
    afirmar(xpDe(setima.linhas, a) === 22 && xpDe(setima.linhas, x) === 32, `7ª: ${JSON.stringify(setima.linhas)}`);
    afirmar(JSON.stringify((await composicao(b.admin, setima.partida))[a]) === JSON.stringify([150, 60, 68, 22, 2]), "composição da 7ª");
    afirmar(JSON.stringify((await composicao(b.admin, setima.partida))[x]) === JSON.stringify([130, 0, 98, 32, 2]), "composição do parceiro");
    const oitava = await creditar(srv, [{ id: a, posicao: 4, rei: true }, { id: x, posicao: 1 }], { quando: noMesmoDia(7) });
    afirmar(xpDe(oitava.linhas, a) === 10, `4º com captura na 8ª: ${xpDe(oitava.linhas, a)}`);
    afirmar(JSON.stringify((await composicao(b.admin, oitava.partida))[a]) === JSON.stringify([100, 60, 30, 10, 2]), "composição da 8ª");
    await ledgerCoerente(b.admin);
  } },
  { id: "X3", nome: "sem XP negativo: capturador que abandonou ou em partida sobreposta recebe 0, sem penalidade; o saldo nunca desce", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const srv = await b.servidor();
    const antes = await creditar(srv, [{ id: a, posicao: 1 }, { id: x, posicao: 2 }], { quando: noMesmoDia(0, "2026-04-02") });
    const saldo = await total(b.admin, a);
    afirmar(saldo === 150, `saldo inicial ${saldo}`);
    const aband = await creditar(srv, [{ id: a, posicao: 4, participou: false, rei: true }, { id: x, posicao: 1 }]);
    afirmar(xpDe(aband.linhas, a) === 0, `abandono com captura: ${xpDe(aband.linhas, a)}`);
    afirmar(JSON.stringify((await composicao(b.admin, aband.partida))[a]) === JSON.stringify([0, 0, 0, 0, 2]), "composição do abandono");
    // sobreposta à 1ª (mesmo intervalo de tempo)
    const sob = await creditar(srv, [{ id: a, posicao: 1, rei: true }, { id: x, posicao: 2 }], { quando: noMesmoDia(0, "2026-04-02") });
    afirmar(antes.partida !== sob.partida && xpDe(sob.linhas, a) === 0, `sobreposta com captura: ${xpDe(sob.linhas, a)}`);
    afirmar(await total(b.admin, a) === saldo, "o saldo mudou");
    const negativos = (await b.admin.query("select count(*)::int n from public.xp_eventos where xp_delta < 0")).rows[0].n;
    afirmar(negativos === 0, "lançamento negativo no ledger");
    await ledgerCoerente(b.admin);
  } },
  { id: "X4", nome: "a porta v2 recusa (22023) contrato errado — campo a mais, fato ausente ou não booleano, DOIS capturadores — e não grava nada", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const srv = await b.servidor();
    const base = (extra = {}, extraX = {}) => [
      { player_id: a, posicao: 1, participou: true, capturou_rei: false, ...extra },
      { player_id: x, posicao: 2, participou: true, capturou_rei: false, ...extraX },
    ];
    const semFato = base().map(({ capturou_rei: _c, ...h }) => h);
    for (const [nome, bruto] of [
      ["dois capturadores", base({ capturou_rei: true }, { capturou_rei: true })],
      ["XP escondido", base({ xp: 150 })],
      ["penalidade escondida", base({ penalidade_rei: 0 })],
      ["sem o fato (contrato v1 na porta v2)", semFato],
      ["fato em texto", base({ capturou_rei: "true" })],
      ["fato nulo", base({ capturou_rei: null })],
      ["fato numérico", base({ capturou_rei: 1 })],
    ]) await reprova(creditar(srv, [{ id: a }, { id: x }], { bruto }), "22023", nome);
    // e a v1 continua recusando o campo novo: o contrato antigo NÃO afrouxou
    await reprova(creditar(srv, [{ id: a }, { id: x }], { versao: 1, bruto: base() }), "22023", "v1 aceitou capturou_rei");
    const n = (await b.admin.query("select (select count(*) from king_private.partidas)::int + (select count(*) from public.xp_eventos)::int + (select count(*) from public.xp_composicao)::int as n")).rows[0].n;
    afirmar(n === 0, "algo foi gravado");
  } },
  { id: "X5", nome: "crédito ÚNICO na repetição: v2→v2, v1→v2 e v2→v1 devolvem o que existe (novo=false); ledger, composição, saldo e versão não mudam", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const srv = await b.servidor();
    const mesa = [{ id: a, posicao: 1, rei: true }, { id: x, posicao: 2 }];
    const um = await creditar(srv, mesa);
    const dois = await creditar(srv, mesa, { partida: um.partida, quando: outroDia() }); // até com datas diferentes
    afirmar(dois.linhas.length === 2 && dois.linhas.every((l) => !l.novo) && xpDe(dois.linhas, a) === 90, `v2→v2: ${JSON.stringify(dois.linhas)}`);
    const tres = await creditar(srv, mesa, { versao: 1, partida: um.partida });
    afirmar(tres.linhas.every((l) => !l.novo) && xpDe(tres.linhas, a) === 90, `v2→v1 recalculou: ${JSON.stringify(tres.linhas)}`);
    // a pendência ANTIGA creditada pela v1 e reenviada pela v2: fica a regra 1
    const velha = await creditar(srv, mesa, { versao: 1 });
    const de_novo = await creditar(srv, mesa, { partida: velha.partida });
    afirmar(de_novo.linhas.every((l) => !l.novo) && xpDe(de_novo.linhas, a) === 150, `v1→v2 recalculou: ${JSON.stringify(de_novo.linhas)}`);
    afirmar(await versaoDa(b.admin, velha.partida) === 1 && await versaoDa(b.admin, um.partida) === 2, "a versão mudou");
    afirmar(Object.keys(await composicao(b.admin, velha.partida)).length === 0, "a partida da v1 ganhou composição");
    const n = (await b.admin.query("select (select count(*) from public.xp_eventos)::int as l, (select count(*) from public.xp_composicao)::int as c")).rows[0];
    afirmar(n.l === 4 && n.c === 2, `duplicou: ${JSON.stringify(n)}`);
    afirmar(await total(b.admin, a) === 240, `saldo ${await total(b.admin, a)}`);
    await ledgerCoerente(b.admin);
  } },
  { id: "X6", nome: "CORRIDA da MESMA partida (v2 × v2 e v1 × v2, duas conexões, sob a trava): um crédito só", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const srv = await b.servidor();
    await creditar(srv, [{ id: a, posicao: 2 }, { id: x, posicao: 1 }]); // A já tem linha de progresso
    for (const versoes of [[2, 2], [1, 2]]) {
      const partida = randomUUID();
      const quando = outroDia();
      const mesa = [{ id: a, posicao: 1, rei: true }, { id: x, posicao: 2 }];
      const r = await corridaSobATrava(b, a, await Promise.all(versoes.map(async (versao) => [await b.servidor(), mesa, { versao, partida, quando }])));
      const novos = r.flatMap((x) => x.linhas).filter((l) => l.novo).length;
      afirmar(novos === 2, `${versoes}: ${novos} lançamentos novos`);
      const n = (await b.admin.query("select count(*)::int n from public.xp_eventos where partida_id = $1", [partida])).rows[0].n;
      afirmar(n === 2, `${versoes}: ledger com ${n}`);
    }
    await ledgerCoerente(b.admin);
  } },
  { id: "X7", nome: "CORRIDA de partidas DIFERENTES do mesmo jogador (6ª e 7ª do dia, sob a trava): exatamente UMA reduzida", async fn(b) {
    const [a, x, w] = await b.jogadores(3);
    const srv = await b.servidor();
    await cincoNoDia(srv, a, x);
    const r = await corridaSobATrava(b, a, [
      [await b.servidor(), [{ id: a, posicao: 1, rei: true }, { id: x, posicao: 2 }], { quando: noMesmoDia(5) }],
      [await b.servidor(), [{ id: a, posicao: 1, rei: true }, { id: w, posicao: 2 }], { quando: noMesmoDia(6) }],
    ]);
    const xps = r.map((x) => xpDe(x.linhas, a)).sort((p, q) => p - q);
    afirmar(JSON.stringify(xps) === "[22,90]", `XP das duas: ${JSON.stringify(xps)}`);
    await ledgerCoerente(b.admin);
  } },
  { id: "X8", nome: "RLS e privilégios: cada um lê SÓ a própria composição; anon e o servidor não leem; ninguém da API escreve; a regra e a porta fechadas; CHECKs valem até para o dono", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const srv = await b.servidor();
    const { partida } = await creditar(srv, [{ id: a, posicao: 1, rei: true }, { id: x, posicao: 2 }]);
    const visto = (await (await b.como(a)).query("select player_id, xp_liquido from public.xp_composicao")).rows;
    afirmar(visto.length === 1 && visto[0].player_id === a && visto[0].xp_liquido === 90, `A enxergou ${JSON.stringify(visto)}`);
    const cli = await b.como(a);
    await reprova(cli.query("insert into public.xp_composicao (partida_id, player_id, versao_regra, xp_bruto, penalidade_rei, reducao_diaria, xp_liquido) values ($1, $2, 2, 150, 0, 0, 150)", [partida, a]), "42501", "insert direto");
    await reprova(cli.query("update public.xp_composicao set penalidade_rei = 0, xp_liquido = 150"), "42501", "update direto");
    await reprova(cli.query("delete from public.xp_composicao"), "42501", "delete direto");
    await reprova(creditar(cli, [{ id: a, posicao: 1 }, { id: x, posicao: 2 }]), "42501", "cliente executou a porta v2");
    await reprova(cli.query("select king_private.xp_da_regra_v2(1::smallint, true, false, 0, false)"), "42501", "cliente executou a regra");
    await reprova(srv.query("select king_private.xp_da_regra_v2(1::smallint, true, false, 0, false)"), "42501", "o servidor executou a regra direto");
    await reprova(srv.query("select * from public.xp_composicao"), "42501", "o servidor leu a tabela");
    await reprova((await b.anonimo()).query("select * from public.xp_composicao"), "42501", "anon leu");
    afirmar((await (await b.como(null)).query("select count(*)::int n from public.xp_composicao")).rows[0].n === 0, "authenticated sem sub leu algo");
    const priv = (await b.admin.query(`select has_function_privilege('authenticated', 'king_private.creditar_partida_v2(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)', 'execute') as cli,
      has_function_privilege('service_role', 'king_private.creditar_partida_v2(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)', 'execute') as svc,
      has_function_privilege('king_server', 'king_private.creditar_partida_v2(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)', 'execute') as srv,
      has_table_privilege('service_role', 'public.xp_composicao', 'select') as svc_le`)).rows[0];
    afirmar(!priv.cli && !priv.svc && priv.srv && !priv.svc_le, `privilégios: ${JSON.stringify(priv)}`);
    const f = (await b.admin.query(`select pg_get_userbyid(proowner) as dono, prosecdef, proconfig from pg_proc where proname = 'creditar_partida_v2'`)).rows[0];
    afirmar(f.dono === "king_progress_owner" && f.prosecdef && f.proconfig?.join() === 'search_path=""', JSON.stringify(f));
    // os CHECKs da composição valem até para quem passa por cima da RLS
    const dono = await b.outraAdmin();
    await dono.query("set role king_progress_owner");
    await reprova(dono.query("update public.xp_composicao set xp_liquido = xp_liquido + 1 where partida_id = $1", [partida]), "23514", "soma incoerente aceita");
    await reprova(dono.query("update public.xp_composicao set penalidade_rei = 30, xp_liquido = xp_bruto - 30 - reducao_diaria where partida_id = $1", [partida]), "23514", "penalidade fora da faixa aceita");
  } },
  { id: "X9", nome: "exclusão de conta: quem excluiu ANTES do crédito fica de fora sozinho (lápide); excluir DEPOIS leva lançamento e composição em cascata", async fn(b) {
    const [a, x, w] = await b.jogadores(3);
    const srv = await b.servidor();
    await b.admin.query("delete from auth.users where id = $1", [a]);
    const { partida, linhas } = await creditar(srv, [{ id: a, posicao: 1, rei: true }, { id: x, posicao: 2 }, { id: w, posicao: 3 }]);
    afirmar(linhas.length === 2 && !linhas.some((l) => l.player_id === a) && xpDe(linhas, x) === 130, `crédito com conta excluída: ${JSON.stringify(linhas)}`);
    afirmar(Object.keys(await composicao(b.admin, partida)).length === 2, "composição de quem excluiu");
    await b.admin.query("delete from auth.users where id = $1", [x]);
    const sobrou = await composicao(b.admin, partida);
    afirmar(Object.keys(sobrou).join() === w, `sobrou: ${JSON.stringify(sobrou)}`);
    await ledgerCoerente(b.admin);
  } },
  { id: "X10", nome: "rollback tira SÓ a Entrega C: XP, ledger e partidas v2 intactos; a v1 segue creditando; a migração reaplica", async fn(b, { migracao, rollback }) {
    const [a, x] = await b.jogadores(2);
    const srv = await b.servidor();
    const { partida } = await creditar(srv, [{ id: a, posicao: 1, rei: true }, { id: x, posicao: 2 }]);
    const xp = await retratoDoXp(b.admin);
    const s = await b.supabase();
    await s.query(rollback);
    const o = (await b.admin.query(`select to_regclass('public.xp_composicao') as t,
      to_regprocedure('king_private.creditar_partida_v2(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)') as f,
      to_regprocedure('king_private.xp_da_regra_v2(smallint,boolean,boolean,integer,boolean)') as r`)).rows[0];
    afirmar(!o.t && !o.f && !o.r, `o rollback deixou: ${JSON.stringify(o)}`);
    afirmar(await retratoDoXp(b.admin) === xp, "o rollback mexeu no XP");
    afirmar(await versaoDa(b.admin, partida) === 2, "o rollback reescreveu a versão da partida");
    const v1 = await creditar(srv, [{ id: a, posicao: 1 }, { id: x, posicao: 2 }], { versao: 1 });
    afirmar(xpDe(v1.linhas, a) === 150, "a v1 parou depois do rollback");
    await s.query(migracao);
    const de_novo = await creditar(await b.servidor(), [{ id: a, posicao: 1, rei: true }, { id: x, posicao: 2 }]);
    afirmar(xpDe(de_novo.linhas, a) === 90, "reaplicada, a v2 não credita");
  } },
];

// ══ O SERVIDOR COMPILADO — o MESMO repositório que vai para a VPS (apps/server/dist) ════════════════
const repositorioDoServidor = async (b) => {
  const { repositorioPg, parametrosDoCredito, CHAMADA_DE_CREDITO } = await import(new URL("apps/server/dist/progresso/repositorio.js", RAIZ).href);
  const pool = new pg.Pool({ host: "127.0.0.1", port: PORTA, database: b.nome, user: "king_server", password: SENHA_SERVIDOR, max: 2 });
  return { repo: repositorioPg({ pool }), pool, parametrosDoCredito, CHAMADA_DE_CREDITO, fechar: () => pool.end() };
};
const resultadoDoServidor = async (humanos, { capturouRei = 0, pontos = false } = {}) => {
  const { resultadoParaCredito } = await import(new URL("apps/server/dist/progresso/resultado.js", RAIZ).href);
  const { ini, fim } = outroDia();
  const assentos = [0, 1, 2, 3].map((seat) => humanos[seat]
    ? { seat, playerId: humanos[seat], bot: false, permanente: true, conectado: true, jogadasTotais: 40, jogadasProprias: 40 }
    : { seat, playerId: `bot:${seat}`, bot: true, permanente: false, conectado: true, jogadasTotais: 40, jogadasProprias: 0 });
  return resultadoParaCredito({
    partidaId: randomUUID(), iniciadaEm: new Date(ini), terminadaEm: new Date(fim), assentos,
    posicoes: { 0: 1, 1: 2, 2: 3, 3: 4 }, capturouRei,
    ...(pontos ? { pontos: { 0: 210, 1: 60, 2: -40, 3: -230 } } : {}),
  });
};
const silenciar = async (fn) => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };
const TESTES_DO_SERVIDOR = [
  { id: "S1", nome: "servidor NOVO + banco NOVO: regra 2 pela v2 (com placar na mesma transação); a reentrega não duplica; a pendência ANTIGA vai pela v1", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const { repo, fechar } = await repositorioDoServidor(b);
    try {
      const r = await resultadoDoServidor([a, c], { capturouRei: 0, pontos: true });
      afirmar(r.regra === 2, "o servidor não marcou a regra 2");
      const l1 = await repo.creditar(r);
      const l2 = await repo.creditar(r);
      afirmar(l1.every((l) => l.novo) && l2.every((l) => !l.novo), "o crédito não é idempotente");
      afirmar(l1.find((l) => l.playerId === a).xpDelta === 90 && l1.find((l) => l.playerId === c).xpDelta === 130, `XP: ${JSON.stringify(l1)}`);
      afirmar(await versaoDa(b.admin, r.partidaId) === 2, "não ficou na regra 2");
      const p = (await b.admin.query("select player_id, pontos from public.placares_online where partida_id = $1 order by pontos desc", [r.partidaId])).rows;
      afirmar(p.length === 2 && p[0].player_id === a && p[0].pontos === 210, `placar: ${JSON.stringify(p)}`);
      // a pendência gravada ANTES da entrega (sem `regra`, sem `capturouRei`)
      const velho = { ...(await resultadoDoServidor([a, c], { capturouRei: null })) };
      afirmar(velho.regra === undefined, "o resultado sem fato saiu com regra");
      const lv = await repo.creditar(velho);
      afirmar(lv.find((l) => l.playerId === a).xpDelta === 150 && await versaoDa(b.admin, velho.partidaId) === 1, "a pendência antiga não foi pela regra 1");
      await ledgerCoerente(b.admin);
    } finally { await fechar(); }
  } },
  { id: "S2", nome: "servidor ANTIGO + banco NOVO: a chamada v1 de sempre credita pela regra 1, sem composição", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const { pool, parametrosDoCredito, CHAMADA_DE_CREDITO, fechar } = await repositorioDoServidor(b);
    try {
      const r = await resultadoDoServidor([a, c], { capturouRei: null });
      const { rows } = await pool.query(CHAMADA_DE_CREDITO, parametrosDoCredito(r));
      afirmar(rows.find((l) => l.player_id === a).xp_delta === 150, `XP: ${JSON.stringify(rows)}`);
      afirmar(await versaoDa(b.admin, r.partidaId) === 1, "versão");
      afirmar(Object.keys(await composicao(b.admin, r.partidaId)).length === 0, "composição numa partida v1");
    } finally { await fechar(); }
  } },
  { id: "S3", nome: "CORRIDA de duas entregas da MESMA partida pelo servidor (retry correndo com a 1ª): um crédito só", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const s1 = await repositorioDoServidor(b);
    const s2 = await repositorioDoServidor(b);
    try {
      const r = await resultadoDoServidor([a, c], { capturouRei: 1, pontos: true });
      const [l1, l2] = await Promise.all([s1.repo.creditar(r), s2.repo.creditar(r)]);
      afirmar([...l1, ...l2].filter((l) => l.novo).length === 2, `novos: ${JSON.stringify([l1, l2])}`);
      afirmar(await total(b.admin, c) === 70, `saldo de C ${await total(b.admin, c)}`);
      await ledgerCoerente(b.admin);
    } finally { await s1.fechar(); await s2.fechar(); }
  } },
];
/** Rodam num banco SEM a Entrega C (o de hoje): servidor novo antes do banco, e o de sempre. */
const TESTES_DO_SERVIDOR_BANCO_ANTIGO = [
  { id: "S4", nome: "servidor NOVO + banco ANTIGO: 42883 na v2 → a MESMA partida pela v1 (regra 1), com e sem placar; nada fica preso", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const { repo, fechar } = await repositorioDoServidor(b);
    try {
      for (const pontos of [false, true]) {
        const r = await resultadoDoServidor([a, c], { capturouRei: 0, pontos });
        const l = await silenciar(() => repo.creditar(r));
        afirmar(l.length === 2 && l.every((x) => x.novo) && l.find((x) => x.playerId === a).xpDelta === 150, `pontos=${pontos}: ${JSON.stringify(l)}`);
        afirmar(await versaoDa(b.admin, r.partidaId) === 1, "versão");
        const p = (await b.admin.query("select count(*)::int n from public.placares_online where partida_id = $1", [r.partidaId])).rows[0].n;
        afirmar(p === (pontos ? 2 : 0), `placar com pontos=${pontos}: ${p}`);
        const de_novo = await silenciar(() => repo.creditar(r));
        afirmar(de_novo.every((x) => !x.novo), "a reentrega duplicou");
      }
    } finally { await fechar(); }
  } },
  { id: "S5", nome: "servidor ANTIGO + banco ANTIGO: o crédito de sempre (controle)", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const { pool, parametrosDoCredito, CHAMADA_DE_CREDITO, fechar } = await repositorioDoServidor(b);
    try {
      const r = await resultadoDoServidor([a, c], { capturouRei: null });
      const { rows } = await pool.query(CHAMADA_DE_CREDITO, parametrosDoCredito(r));
      afirmar(rows.length === 2 && rows.find((l) => l.player_id === a).xp_delta === 150, JSON.stringify(rows));
    } finally { await fechar(); }
  } },
  { id: "S6", nome: "NADA RETROATIVO: aplicar a Entrega C sobre XP já creditado não muda XP, ledger, partidas nem versões; a v1 não ganha composição", async fn(b) {
    const [a, c] = await b.jogadores(2);
    const srv = await b.servidor();
    for (let i = 0; i < 3; i++) await creditar(srv, [{ id: a, posicao: 1 + i }, { id: c, posicao: 4 - i }], { versao: 1 });
    const xp = await retratoDoXp(b.admin);
    const versoes = (await b.admin.query("select string_agg(versao_regra::text, ',' order by id) v from king_private.partidas")).rows[0].v;
    await (await b.supabase()).query(MIGRACAO);
    afirmar(await retratoDoXp(b.admin) === xp, "a migração mexeu no XP");
    afirmar((await b.admin.query("select string_agg(versao_regra::text, ',' order by id) v from king_private.partidas")).rows[0].v === versoes, "versões mudaram");
    afirmar((await b.admin.query("select count(*)::int n from public.xp_composicao")).rows[0].n === 0, "composição retroativa");
  } },
];

// ══ O ROLLOUT DE PRODUCTION — o ARQUIVO exato que seria colado no SQL Editor ═════════════════════
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
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','king_private') and c.relkind in ('r','v','m','S','p','f','i')
       union all select p.oid::regprocedure::text || ' ' || coalesce(p.proacl::text, '-') || ' ' || pg_get_userbyid(p.proowner) || ' ' || p.prosecdef || ' ' || md5(p.prosrc)
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','king_private')
       union all select 'schema ' || nspname || ' ' || coalesce(nspacl::text, '-') from pg_namespace where nspname in ('public','king_private')
       union all select 'constraint ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint
         where connamespace in ('public'::regnamespace, 'king_private'::regnamespace)
       union all select 'trigger ' || tgrelid::regclass::text || ' ' || tgname from pg_trigger where not tgisinternal
       union all select 'policy ' || polrelid::regclass::text || ' ' || polname from pg_policy) as t) as tudo`);
  return JSON.stringify(r.rows[0].tudo) + (await retratoDoXp(admin));
}
const semXpRei = async (admin) => (await admin.query(`select to_regclass('public.xp_composicao') is null
  and to_regprocedure('king_private.creditar_partida_v2(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)') is null
  and to_regprocedure('king_private.xp_da_regra_v2(smallint,boolean,boolean,integer,boolean)') is null as ok`)).rows[0].ok;
/** Um banco "como Production hoje" com partidas creditadas de verdade pela v1. */
async function semear(b) {
  const [a, c] = await b.jogadores(2);
  const srv = await b.servidor();
  await creditar(srv, [{ id: a, posicao: 1 }, { id: c, posicao: 2 }], { versao: 1 });
  await creditar(srv, [{ id: a, posicao: 3 }, { id: c, posicao: 1 }], { versao: 1 });
  return [a, c];
}
const DEFEITOS = [
  ["porta-para-o-cliente", "  to king_server;\n\ncomment on table public.xp_composicao", "  to king_server, authenticated;\n\ncomment on table public.xp_composicao"],
  ["sem-rls", "alter table public.xp_composicao enable row level security;\n", ""],
  ["politica-aberta", "for select to authenticated using ((select auth.uid()) = player_id);", "for select to authenticated using (true);"],
  ["cliente-escreve", "grant select on table public.xp_composicao to authenticated;", "grant select, insert on table public.xp_composicao to authenticated;"],
  ["sem-cascade", "references public.xp_eventos (partida_id, player_id, motivo) on delete cascade,", "references public.xp_eventos (partida_id, player_id, motivo),"],
  ["sem-soma", "  constraint xp_composicao_soma       check (xp_liquido >= 0 and xp_liquido = xp_bruto - penalidade_rei - reducao_diaria)\n", "  constraint xp_composicao_soma       check (xp_liquido >= 0)\n"],
  ["penalidade-50", "case when p_capturou_rei and b.bruto > 0 then 60 else 0 end", "case when p_capturou_rei and b.bruto > 0 then 50 else 0 end"],
  ["reducao-antes", "select d.bruto, d.pen, d.base - d.base / d.divisor, d.base / d.divisor from d", "select d.bruto, d.pen, d.base - (d.bruto / d.divisor - d.pen), d.bruto / d.divisor - d.pen from d"],
  ["regra-para-o-servidor", "  from public, anon, authenticated, service_role, king_server;", "  from public, anon, authenticated, service_role;\ngrant execute on function king_private.xp_da_regra_v2(smallint, boolean, boolean, integer, boolean) to king_server;"],
  ["mexe-na-v1", "reset role;\nrevoke create on schema public from king_progress_owner;",
    "comment on function king_private.creditar_partida(uuid, timestamptz, timestamptz, smallint, smallint, jsonb) is 'x';\ngrant execute on function king_private.creditar_partida(uuid, timestamptz, timestamptz, smallint, smallint, jsonb) to authenticated;\nreset role;\nrevoke create on schema public from king_progress_owner;"],
  ["mexe-no-xp", "reset role;\nrevoke create on schema public from king_progress_owner;", "update public.progresso set xp_total = xp_total + 1;\nreset role;\nrevoke create on schema public from king_progress_owner;"],
  ["retroativo", "reset role;\nrevoke create on schema public from king_progress_owner;", "update king_private.partidas set versao_regra = 2;\nreset role;\nrevoke create on schema public from king_progress_owner;"],
  ["esquece-de-fechar-o-schema", "reset role;\nrevoke create on schema public from king_progress_owner;\n", "reset role;\n"],
];
const comDefeito = (de, para) => { afirmar(MIGRACAO.split(de).length === 2, `defeito: trecho não encontrado 1 vez: ${de.slice(0, 60)}`); return MIGRACAO.replace(de, () => para); };
async function checkpoint(c, sql) {
  // SÓ LEITURA de verdade: numa transação read only, que recusaria qualquer escrita
  await c.query("begin transaction read only");
  try { return (await c.query(sql)).rows; } finally { await c.query("rollback"); }
}
const TESTES_DO_ROLLOUT = [
  { id: "R1", nome: "o ARQUIVO do rollout é a migração VERBATIM (sha256 no cabeçalho) e confere com o montador", async fn() {
    afirmar(ROLLOUT === montarRollout(), "o arquivo gravado diverge do que o montador monta hoje");
    afirmar(ROLLOUT.split(MIGRACAO).length === 2, "a migração não está inteira, uma vez, no arquivo");
    afirmar(ROLLOUT.includes(createHash("sha256").update(MIGRACAO).digest("hex")), "sha256 errado");
    afirmar(/^begin;$/m.test(ROLLOUT) && /^commit;$/m.test(ROLLOUT), "sem BEGIN/COMMIT");
  } },
  { id: "R2", nome: "aplicado INTEIRO pelo papel do SQL Editor: relatório, v2 creditando, v1 intacta, XP idêntico; checkpoints 1 e 3 (só leitura) antes e depois", async fn(b) {
    const [a, c] = await semear(b);
    const xp = await retratoDoXp(b.admin);
    const s = await b.supabase();
    const [c1] = await checkpoint(s, CHECKPOINT_1);
    afirmar(c1.pronto_para_aplicar === true && Number(c1.partidas) === 2 && Number(c1.partidas_fora_da_v1) === 0, `checkpoint 1: ${JSON.stringify(c1)}`);
    const [c3antes] = await checkpoint(s, CHECKPOINT_3);
    afirmar(c3antes.tudo_certo === false, "checkpoint 3 deu certo ANTES do rollout");
    const r = await colar(s, ROLLOUT);
    afirmar(r.erro === null, `o rollout falhou: ${r.erro}`);
    afirmar(r.linha.resultado === "PENALIDADE DO REI (ENTREGA C) APLICADA E CONFERIDA" && String(r.linha.composicoes_gravadas) === "0"
      && r.linha.servidor_credita_v2 && r.linha.servidor_credita_v1, JSON.stringify(r.linha));
    afirmar(await retratoDoXp(b.admin) === xp, "o rollout mexeu no XP");
    const [c3] = await checkpoint(s, CHECKPOINT_3);
    afirmar(c3.tudo_certo === true && c3.credito_v1_md5 === c1.credito_v1_md5 && c3.regra_v1_md5 === c1.regra_v1_md5
      && c3.xp_total === c1.xp_total && c3.schema_public_acl === c1.schema_public_acl, `checkpoint 3: ${JSON.stringify(c3)}`);
    afirmar((await checkpoint(s, CHECKPOINT_1))[0].pronto_para_aplicar === false, "checkpoint 1 ainda pronto depois do rollout");
    const srv = await b.servidor();
    afirmar(xpDe((await creditar(srv, [{ id: a, posicao: 1, rei: true }, { id: c, posicao: 2 }])).linhas, a) === 90, "a v2 não credita depois do rollout");
    afirmar(xpDe((await creditar(srv, [{ id: a, posicao: 1 }, { id: c, posicao: 2 }], { versao: 1 })).linhas, a) === 150, "a v1 parou depois do rollout");
  } },
  { id: "R3", nome: "colado DUAS vezes: a segunda recusa na parte 1 e não altera nada", async fn(b) {
    await semear(b);
    const s = await b.supabase();
    afirmar((await colar(s, ROLLOUT)).erro === null, "1ª aplicação falhou");
    const antes = await retratoDoBanco(b.admin);
    const r = await colar(s, ROLLOUT);
    afirmar(r.erro?.includes("ROLLOUT XP-REI ABORTADO (parte 1)"), `a 2ª não recusou: ${r.erro}`);
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
      afirmar(await semXpRei(b.admin), `defeito ${nome}: sobrou objeto`);
      afirmar(await retratoDoBanco(b.admin) === antes, `defeito ${nome}: o banco mudou`);
    }
  } },
  { id: "R5", nome: "pré-condições inválidas são RECUSADAS na parte 1 sem alterar nada: aplicador sem o dono, servidor membro do dono, pedaço já presente", async fn(b) {
    await semear(b);
    const antes = await retratoDoBanco(b.admin);
    // (a) um aplicador que não herda o dono dedicado
    const r1 = await colar(await b.estranho(), ROLLOUT);
    afirmar(r1.erro?.includes("ROLLOUT XP-REI ABORTADO (parte 1)") && r1.erro.includes("não herda"), `estranho: ${r1.erro}`);
    // (b) o servidor promovido a dono
    await b.admin.query("grant king_progress_owner to king_server");
    const r2 = await colar(await b.supabase(), ROLLOUT);
    afirmar(r2.erro?.includes("king_server é membro"), `servidor dono: ${r2.erro}`);
    await b.admin.query("revoke king_progress_owner from king_server");
    // (c) um pedaço da entrega já presente (um arquivo que parou no meio)
    await b.admin.query("create table public.xp_composicao (x int)");
    const r3 = await colar(await b.supabase(), ROLLOUT);
    afirmar(r3.erro?.includes("já existe, inteira ou em parte"), `pedaço presente: ${r3.erro}`);
    await b.admin.query("drop table public.xp_composicao");
    afirmar(await retratoDoBanco(b.admin) === antes, "uma recusa alterou o banco");
  } },
  { id: "R6", nome: "ROLLBACK logo depois do rollout: volta EXATAMENTE ao banco de antes (catálogo, privilégios, constraints e XP)", async fn(b) {
    await semear(b);
    const s = await b.supabase();
    const antes = await retratoDoBanco(b.admin);
    afirmar((await colar(s, ROLLOUT)).erro === null, "rollout falhou");
    const r = await colar(s, ROLLBACK);
    afirmar(r.erro === null, `rollback falhou: ${r.erro}`);
    afirmar(await semXpRei(b.admin), "o rollback deixou objeto");
    afirmar(await retratoDoBanco(b.admin) === antes, "não voltou EXATAMENTE ao de antes");
  } },
  { id: "R7", nome: "ROLLBACK depois de créditos v2: estrutura de antes; o XP creditado FICA (nada retroativo); o servidor novo cai na v1; checkpoint 1 pronto de novo", async fn(b) {
    const [a, c] = await semear(b);
    const s = await b.supabase();
    const estrutura = (x) => x.slice(0, x.lastIndexOf("]") + 1);
    const antes = estrutura(await retratoDoBanco(b.admin));
    afirmar((await colar(s, ROLLOUT)).erro === null, "rollout falhou");
    const { repo, fechar } = await repositorioDoServidor(b);
    try {
      const r = await resultadoDoServidor([a, c], { capturouRei: 0 });
      await repo.creditar(r);
      const xp = await retratoDoXp(b.admin);
      afirmar((await colar(s, ROLLBACK)).erro === null, "rollback falhou");
      afirmar(estrutura(await retratoDoBanco(b.admin)) === antes, "a estrutura não voltou à de antes");
      afirmar(await retratoDoXp(b.admin) === xp && await versaoDa(b.admin, r.partidaId) === 2, "o rollback mexeu no XP creditado");
      const depois = await resultadoDoServidor([a, c], { capturouRei: 0 });
      const l = await silenciar(() => repo.creditar(depois));
      afirmar(l.find((x) => x.playerId === a).xpDelta === 150 && await versaoDa(b.admin, depois.partidaId) === 1, "o servidor novo não caiu na v1");
      const [c1] = await checkpoint(s, CHECKPOINT_1);
      afirmar(c1.pronto_para_aplicar === true && Number(c1.partidas_fora_da_v1) === 1, `checkpoint 1 depois do rollback: ${JSON.stringify(c1)}`);
    } finally { await fechar(); }
  } },
];

const MUTACOES = [
  { id: "sem-penalidade", alvos: ["X1", "X2"], de: "case when p_capturou_rei and b.bruto > 0 then 60 else 0 end", para: "case when p_capturou_rei and b.bruto > 0 then 0 else 0 end" },
  { id: "reducao-antes-da-penalidade", alvos: ["X2"], de: "select d.bruto, d.pen, d.base - d.base / d.divisor, d.base / d.divisor from d",
    para: "select d.bruto, d.pen, d.base - greatest(d.bruto / d.divisor - d.pen, 0), greatest(d.bruto / d.divisor - d.pen, 0) from d" },
  { id: "penalidade-negativa", alvos: ["X3"], de: "case when p_capturou_rei and b.bruto > 0 then 60", para: "case when p_capturou_rei then 60" },
  { id: "sobreposicao-ignorada", alvos: ["X3"], de: "                and q.iniciada_em < p_terminada\n                and q.terminada_em > p_iniciada\n           ) as sobreposta,\n           (\n             select count(*)::integer\n               from public.xp_eventos as e\n               join king_private.partidas as q on q.id = e.partida_id\n              where e.player_id = r.pid\n                and e.xp_delta > 0",
    para: "                and false\n           ) as sobreposta,\n           (\n             select count(*)::integer\n               from public.xp_eventos as e\n               join king_private.partidas as q on q.id = e.partida_id\n              where e.player_id = r.pid\n                and e.xp_delta > 0" },
  { id: "aceita-dois-capturadores", alvos: ["X4"], de: "       where (e.value -> 'capturou_rei') = 'true'::jsonb) > 1 then", para: "       where (e.value -> 'capturou_rei') = 'true'::jsonb) > 4 then" },
  { id: "aceita-campos-livres", alvos: ["X4"], de: "    if v_chaves is distinct from array['capturou_rei', 'participou', 'player_id', 'posicao']::text[] then", para: "    if false then" },
  { id: "aceita-fato-nao-booleano", alvos: ["X4"], de: "    if jsonb_typeof(v_item -> 'capturou_rei') <> 'boolean' then", para: "    if false then" },
  { id: "grava-como-v1", alvos: ["X1"], de: "values (p_partida, p_iniciada, p_terminada, p_humanos, p_bots, 2)", para: "values (p_partida, p_iniciada, p_terminada, p_humanos, p_bots, 1)" },
  { id: "sem-idempotencia", alvos: ["X5", "X6"], de: "values (p_partida, p_iniciada, p_terminada, p_humanos, p_bots, 2)\n  on conflict (id) do nothing;", para: "values (p_partida, p_iniciada, p_terminada, p_humanos, p_bots, 2);" },
  { id: "sem-trava", alvos: ["X7"], de: "  perform 1 from public.progresso as g where g.player_id = any (v_ids) order by g.player_id for update;\n", para: "" },
  { id: "sem-composicao", alvos: ["X1"], de: "      join lancados as l on l.player_id = c.pid", para: "      join lancados as l on false" },
  { id: "composicao-sem-soma", alvos: ["X8"], de: "  constraint xp_composicao_soma       check (xp_liquido >= 0 and xp_liquido = xp_bruto - penalidade_rei - reducao_diaria)\n", para: "  constraint xp_composicao_soma       check (xp_liquido >= 0)\n" },
  { id: "penalidade-qualquer", alvos: ["X8"], de: "check (penalidade_rei in (0, 60) and penalidade_rei <= xp_bruto)", para: "check (penalidade_rei <= xp_bruto)" },
  { id: "rls-le-todo-mundo", alvos: ["X8"], de: "for select to authenticated using ((select auth.uid()) = player_id);", para: "for select to authenticated using (true);" },
  { id: "porta-para-o-cliente", alvos: ["X8"], de: "  to king_server;\n\ncomment on table public.xp_composicao",
    para: "  to king_server, authenticated;\ngrant usage on schema king_private to authenticated;\n\ncomment on table public.xp_composicao" },
  { id: "regra-para-o-servidor", alvos: ["X8"], de: "  from public, anon, authenticated, service_role, king_server;",
    para: "  from public, anon, authenticated, service_role;\ngrant execute on function king_private.xp_da_regra_v2(smallint, boolean, boolean, integer, boolean) to king_server;" },
  { id: "cliente-escreve", alvos: ["X8"], de: "grant select on table public.xp_composicao to authenticated;",
    para: "grant select, insert, update, delete on table public.xp_composicao to authenticated;\ncreate policy xp_composicao_gravo on public.xp_composicao for all to authenticated using (true) with check (true);" },
  { id: "sem-cascade", alvos: ["X9"], de: "references public.xp_eventos (partida_id, player_id, motivo) on delete cascade,", para: "references public.xp_eventos (partida_id, player_id, motivo)," },
  { id: "v2-sem-lapide", alvos: ["X9"], de: "      if not exists (select 1 from king_private.contas_excluidas as x where x.player_id = v_id) then\n        raise;\n      end if;\n      v_excluidos := v_excluidos || v_id;", para: "      raise;" },
  { id: "rollback-esquece-a-tabela", alvos: ["X10"], rollback: true, de: "drop table public.xp_composicao;", para: "" },
  { id: "rollback-esquece-a-porta", alvos: ["X10"], rollback: true, de: "drop function king_private.creditar_partida_v2(uuid, timestamptz, timestamptz, smallint, smallint, jsonb);\n", para: "" },
];

async function rodar(migracao, rollback, testes, opcoes = {}) {
  const modelo = `m_${randomBytes(4).toString("hex")}`;
  await criarModelo(modelo, migracao, opcoes);
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
function relatar(testes, reprovados) {
  let falhou = false;
  for (const t of testes) {
    const r = reprovados.find((x) => x.id === t.id);
    if (r) { falhou = true; console.error(`  XX  ${t.id} ${t.nome}\n        ${r.motivo}`); }
    else console.log(`  ok  ${t.id} ${t.nome}`);
  }
  return falhou;
}

const PROVAS = process.argv.includes("--provas");
const dir = mkdtempSync(join(tmpdir(), "king-xp-rei-sql-"));
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
  await adm.query("create role estranho login nosuperuser inherit password '" + SENHA_ESTRANHO + "'");
  await adm.end();

  let mutacoesOk = 0;
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
      else { mutacoesOk += 1; console.log(`  ok  ${m.id}: reprovou ${m.alvos.join(", ")}`); }
    }
  }

  console.log("\nPENALIDADE DO REI — migração e rollback originais");
  const reprovados = await rodar(MIGRACAO, ROLLBACK, TESTES);
  falhou = relatar(TESTES, reprovados) || falhou;

  console.log("\nSERVIDOR COMPILADO — as quatro combinações servidor × banco");
  const reprovadosS = await rodar(MIGRACAO, ROLLBACK, TESTES_DO_SERVIDOR);
  falhou = relatar(TESTES_DO_SERVIDOR, reprovadosS) || falhou;
  const reprovadosA = await rodar(null, ROLLBACK, TESTES_DO_SERVIDOR_BANCO_ANTIGO);
  falhou = relatar(TESTES_DO_SERVIDOR_BANCO_ANTIGO, reprovadosA) || falhou;

  console.log("\nROLLOUT DE PRODUCTION — o arquivo exato, num banco como o de hoje (contas e XP sintéticos)");
  const reprovadosR = await rodar(null, ROLLBACK, TESTES_DO_ROLLOUT);
  falhou = relatar(TESTES_DO_ROLLOUT, reprovadosR) || falhou;
  // independência: o mesmo rollout num banco SEM os recordes
  const semRec = [{ ...TESTES_DO_ROLLOUT.find((t) => t.id === "R2"), id: "R2b", nome: "o rollout num banco SEM os recordes (Entrega D não aplicada): aplica e confere igual" }];
  const reprovadosB = await rodar(null, ROLLBACK, semRec, { recordes: false });
  falhou = relatar(semRec, reprovadosB) || falhou;

  const todos = TESTES.length + TESTES_DO_SERVIDOR.length + TESTES_DO_SERVIDOR_BANCO_ANTIGO.length + TESTES_DO_ROLLOUT.length + semRec.length;
  const verdes = todos - reprovados.length - reprovadosS.length - reprovadosA.length - reprovadosR.length - reprovadosB.length;
  console.log(`\n${verdes}/${todos} testes verdes${PROVAS ? `, ${mutacoesOk}/${MUTACOES.length} mutações reprovadas pelos alvos` : ""}`);
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
