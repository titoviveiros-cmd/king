// TESTES DA MIGRAÇÃO DE PROGRESSO — Postgres REAL, descartável, com conexões independentes.
//
// Sobe um Postgres 17 embutido (`embedded-postgres`, só devDependency) num diretório temporário
// FORA do repositório, aplica o bootstrap que emula o mínimo do Supabase e as migrações reais, e
// roda os testes. Ao terminar, o banco é destruído.
//
// ══ COMO AS CORRIDAS SÃO PROVADAS ══
//
// Corrida que depende de sorte — ou de cronômetro — não prova nada. A serialização POR JOGADOR (T4,
// T4b, T6, T9) é provada sem relógio: uma conexão de fora segura a linha do jogador com a MESMA
// trava da função (`for update`), as chamadas são disparadas, e o teste espera o PRÓPRIO Postgres
// dizer que cada uma está parada (`pg_blocking_pids`). Com a trava da função, elas param ANTES de
// olhar o passado; sem ela, só param no UPDATE final, DEPOIS de ler e gravar o ledger — e o
// `pg_locks` mostra isso. Solta a trava, e o resultado é o mesmo em máquina rápida ou lenta.
// (O T3 — a MESMA partida duas vezes — ainda usa a variante em que o marcador
// `-- [ponto-de-corrida]` vira `perform pg_sleep(0.4)`; lá a prova é a chave única, não o tempo.)
//
// ══ RED → GREEN ══
//
// Com `--provas`, cada proteção é removida por uma MUTAÇÃO EM MEMÓRIA do texto da migração — o
// arquivo em disco nunca é tocado — e os testes que dependem dela precisam REPROVAR. Depois, a
// migração original precisa passar em tudo.
//
// ══ SEQUÊNCIA (Fase 6A) ══
//
// Os modelos aplicam também `20261001120000_sequencia.sql`; o `modelo_sem_sequencia` é o banco de
// Production de hoje, onde o S16 aplica a migração e o S17 o rollback. Os testes S* usam instantes
// FIXOS com fuso explícito (março de 2026) — nenhuma conclusão depende de que horas são agora,
// exceto o S13, que prova a view com o relógio do próprio banco. As mutações `seq-*` mexem no
// texto da migração da sequência (`trocasSeq`) ou no do progresso (`trocas`).
//
// USO:
//   node scripts/testar-progresso-sql.mjs            # suíte GREEN
//   node scripts/testar-progresso-sql.mjs --provas   # mutações (RED) + suíte GREEN
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { gerarSenha, validarVerificador, verificadorScram } from "./lib/scram.mjs";

const RAIZ = new URL("../", import.meta.url);
const ler = (rel) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
const BOOTSTRAP = ler("supabase/tests/bootstrap-supabase-local.sql");
const IDENTIDADE = ler("supabase/migrations/20260830120000_identidade.sql");
const PROGRESSO = ler("supabase/migrations/20260925120000_progresso.sql");
const SEQUENCIA = ler("supabase/migrations/20261001120000_sequencia.sql");
const ROLLBACK_SEQUENCIA = ler("supabase/rollback/20261001120000_sequencia_rollback.sql");

const MARCADOR = "  -- [ponto-de-corrida]";
const JANELA_MS = 400;
const TRAVA = "  perform 1 from public.progresso as g where g.player_id = any (v_ids) order by g.player_id for update;\n";

/** Cada mutação remove UMA proteção. `alvos` são os testes que precisam reprovar sem ela. */
const MUTACOES = {
  "sem-trava": {
    trocas: [[TRAVA, ""]],
    alvos: ["T4", "T6", "T9"],
  },
  // O erro oposto: serializar TODO MUNDO. Correto, mas uma mesa passaria a esperar a outra à toa.
  "trava-global": {
    trocas: [[TRAVA, "  lock table public.progresso in exclusive mode;\n"]],
    alvos: ["T4b"],
  },
  "sem-idempotencia": {
    trocas: [["  values (p_partida, p_iniciada, p_terminada, p_humanos, p_bots, 1)\n  on conflict (id) do nothing;\n",
              "  values (p_partida, p_iniciada, p_terminada, p_humanos, p_bots, 1);\n"]],
    alvos: ["T2", "T3", "T21"],
  },
  "sem-sobreposicao": {
    trocas: [["                and q.terminada_em > p_iniciada\n", "                and false\n"]],
    alvos: ["T5", "T6"],
  },
  "sem-reducao": {
    trocas: [["/ case when p_anteriores_no_dia >= 6 then 4 else 1 end", "/ 1"]],
    alvos: ["T8", "T9"],
  },
  "sem-unicidade-no-resultado": {
    trocas: [["  if cardinality(v_ids) <> p_humanos then\n    raise exception 'jogador repetido no resultado' using errcode = '22023';\n  end if;\n", ""]],
    alvos: ["T13"],
  },
  "aceita-campo-extra": {
    trocas: [["    if v_chaves is distinct from array['participou', 'player_id', 'posicao']::text[] then",
              "    if not (v_chaves @> array['participou', 'player_id', 'posicao']::text[]) then"]],
    alvos: ["T13b"],
  },
  "escrita-aberta": {
    trocas: [["grant select on table public.progresso     to authenticated;",
              "grant select, insert, update on table public.progresso to authenticated;\n" +
              "grant select, insert, update on table public.xp_eventos to authenticated;\n" +
              "create policy progresso_aberto on public.progresso for all to authenticated using (true) with check (true);\n" +
              "create policy eventos_aberto on public.xp_eventos for all to authenticated using (true) with check (true);"]],
    alvos: ["T14", "T15"],
  },
  "execucao-aberta": {
    trocas: [["grant usage on schema king_private to king_server;", "grant usage on schema king_private to king_server, authenticated;"],
             ["  to king_server;\n\ncomment on table public.xp_eventos", "  to king_server, authenticated;\n\ncomment on table public.xp_eventos"]],
    alvos: ["T16"],
  },
  "leitura-alheia": {
    trocas: [["for select to authenticated using ((select auth.uid()) = player_id);\ncreate policy progresso_leio_o_meu",
              "for select to authenticated using (true);\ncreate policy progresso_leio_o_meu"],
             ["create policy progresso_leio_o_meu on public.progresso\n  for select to authenticated using ((select auth.uid()) = player_id);",
              "create policy progresso_leio_o_meu on public.progresso\n  for select to authenticated using (true);"]],
    alvos: ["T17"],
  },

  // ── SEQUÊNCIA (Fase 6A). `trocasSeq` muta o texto da migração da sequência; `trocas`, o do
  //    progresso. Cada uma é um defeito plausível de quem implementa streak. ──
  "seq-sem-trava-do-dia": {
    // conta PARTIDAS em vez de DIAS: a 2ª partida do mesmo dia viraria +1
    trocasSeq: [["count(distinct i.dia)::integer as tamanho", "count(*)::integer as tamanho"]],
    alvos: ["S2", "S11"],
  },
  "seq-qualquer-data": {
    // "ontem" vira "qualquer dia anterior": todos os dias numa ilha só, buraco nenhum quebra
    trocasSeq: [["d.dia - (dense_rank() over (order by d.dia))::integer as ilha", "0 as ilha"]],
    alvos: ["S4", "S9"],
  },
  "seq-sem-reset": {
    // a Home mostraria a sequência de semanas atrás como se estivesse viva
    trocasSeq: [["select case when p_ultimo_dia >= public.dia_de_sao_paulo(p_agora) - 1 then p_atual else 0 end", "select p_atual"]],
    alvos: ["S12", "S13"],
  },
  "seq-dia-de-graca": {
    // um dia sem jogar não quebraria: congelamento disfarçado, que a regra proíbe
    trocasSeq: [["public.dia_de_sao_paulo(p_agora) - 1 then p_atual", "public.dia_de_sao_paulo(p_agora) - 2 then p_atual"]],
    alvos: ["S12"],
  },
  "seq-aceita-duplicata": {
    // o reenvio da mesma partida passa direto: lança de novo em vez de devolver o que já existe
    trocas: [
      ["  constraint xp_eventos_uma_vez unique (partida_id, player_id, motivo),\n", ""],
      ["  if not found then\n    return query", "  if false then\n    return query"],
      ["on conflict on constraint xp_eventos_uma_vez do nothing", "on conflict do nothing"],
    ],
    alvos: ["S7", "S8"],
  },
  "seq-sem-xp": {
    // partida que rendeu 0 (abandono, participação insuficiente, sobreposta) qualificaria o dia
    trocasSeq: [["       and e.xp_delta > 0\n", "       and e.xp_delta >= 0\n"]],
    alvos: ["S10"],
  },
  // ── SEM BACKFILL (correção final da 6A): nada anterior ao rollout conta ──
  "seq-backfill": {
    // a migração volta a "preencher pelo histórico": marco no começo dos tempos + UPDATE retroativo
    trocasSeq: [
      ["values (now(), (select coalesce(max(e.id), 0) from public.xp_eventos as e));", "values ('-infinity', 0);"],
      ["-- todo mundo (os defaults acima), e o marco garante que o histórico também não volte pelo gatilho.\n",
       "-- todo mundo (os defaults acima), e o marco garante que o histórico também não volte pelo gatilho.\n" +
       "update public.progresso as g set sequencia_atual = s.atual, sequencia_recorde = greatest(g.sequencia_recorde, s.recorde),\n" +
       "  sequencia_ultimo_dia = s.ultimo_dia, sequencia_partida = s.partida\n" +
       "  from public.progresso as p cross join lateral king_private.sequencia_de(p.player_id) as s where g.player_id = p.player_id;\n"],
    ],
    alvos: ["S16", "S17"],
  },
  "seq-historico-no-recalculo": {
    // sem o marco no cálculo: o primeiro crédito pós-rollout reconstrói o histórico pelo gatilho
    trocasSeq: [["       and e.id > m.ultimo_evento_anterior\n       and q.iniciada_em >= m.inicio\n", ""]],
    alvos: ["S16"],
  },
  "seq-xp-anterior-ao-rollout": {
    // XP lançado ANTES do rollout passaria a contar (aqui, de partida com início marcado depois do marco)
    trocasSeq: [["       and e.id > m.ultimo_evento_anterior\n", ""]],
    alvos: ["S16"],
  },
  "seq-partida-anterior-ao-rollout": {
    // crédito ATRASADO de partida pré-rollout, ou partida que ATRAVESSOU o rollout, passaria a contar
    trocasSeq: [["       and q.iniciada_em >= m.inicio\n", ""]],
    alvos: ["S16"],
  },
  "seq-qualquer-origem": {
    // uma origem futura de XP que não é partida (bônus, evento) qualificaria o dia
    trocasSeq: [["       and e.motivo = 'partida_concluida'\n", ""]],
    alvos: ["S19"],
  },
  // ── QUEM ESCREVE NO LEDGER: um escritor novo ou um GRANT de escrita precisam ser vistos ──
  "ledger-segundo-escritor": {
    trocasSeq: [["comment on table king_private.sequencia_inicio is",
      "create function king_private.bonus_de_boas_vindas(p uuid) returns void language sql security definer set search_path = '' as $$\n" +
      "  insert into public.xp_eventos (player_id, partida_id, motivo, posicao, xp_delta) select p, q.id, 'partida_concluida', 1, 50 from king_private.partidas as q limit 1\n$$;\n" +
      "comment on table king_private.sequencia_inicio is"]],
    alvos: ["S18"],
  },
  "ledger-escrita-service-role": {
    trocasSeq: [["comment on table king_private.sequencia_inicio is", "grant insert on table public.xp_eventos to service_role;\ncomment on table king_private.sequencia_inicio is"]],
    alvos: ["S18"],
  },
  "seq-solo-no-recalculo": {
    // uma partida solo gravada por um escritor futuro qualificaria o dia
    trocasSeq: [["       and q.humanos >= 2\n", ""]],
    alvos: ["S19"],
  },
  "seq-em-utc": {
    trocasSeq: [["select (p_instante at time zone 'America/Sao_Paulo')::date", "select (p_instante at time zone 'UTC')::date"]],
    alvos: ["S5", "S6", "S12"],
  },
  "seq-conta-solo": {
    // partida com 1 humano (local/solo contra bots) chegaria ao crédito — e à sequência
    trocas: [
      ["humanos between 2 and 4 and bots between 0 and 2", "humanos between 1 and 4 and bots between 0 and 3"],
      ["if p_humanos < 2 or p_humanos > 4", "if p_humanos < 1 or p_humanos > 4"],
    ],
    alvos: ["S10b"],
  },
};

function mutar(texto, trocas) {
  let t = texto;
  for (const [de, para] of trocas) {
    const n = t.split(de).length - 1;
    if (n !== 1) throw new Error(`âncora de mutação encontrada ${n}x: ${de.slice(0, 70)}`);
    t = t.replace(de, () => para); // literal: `$$` do SQL não é padrão de substituição
  }
  return t;
}
const comJanela = (texto) => mutar(texto, [[MARCADOR, `  perform pg_sleep(${JANELA_MS / 1000});`]]);

// ─────────────────────────── infraestrutura ───────────────────────────

async function portaLivre() {
  return await new Promise((ok, erro) => {
    const s = createServer();
    s.on("error", erro);
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

const SENHA_ADMIN = randomBytes(18).toString("base64url");
const SENHA_SERVIDOR = randomBytes(18).toString("base64url"); // só existe dentro do banco descartável
let PORTA = 0;

const conectar = async (database, user = "postgres", password = SENHA_ADMIN) => {
  const c = new pg.Client({ host: "127.0.0.1", port: PORTA, database, user, password });
  await c.connect();
  return c;
};

/**
 * O ROLLOUT DOS TESTES DE CALENDÁRIO. A migração grava o marco com `now()`, e o crédito não aceita
 * fim no futuro — então os testes S1–S15 vivem num banco cujo rollout aconteceu em 01/01/2026 e
 * usam partidas de março. Os testes de NÃO-BACKFILL (S16, S17) não usam isto: aplicam a migração de
 * verdade, com o relógio real, sobre um banco que já tem histórico.
 */
const ROLLOUT_DOS_TESTES = "2026-01-01T00:00:00-03:00";

/** `textoSequencia` null = o banco como está em Production hoje, SEM a migração da sequência. */
async function criarModelo(nome, textoProgresso, textoSequencia) {
  const adm = await conectar("postgres");
  await adm.query(`create database ${nome}`);
  await adm.end();
  const c = await conectar(nome);
  try {
    await c.query(BOOTSTRAP);
    await c.query(IDENTIDADE);
    await c.query(textoProgresso);
    if (textoSequencia) {
      await c.query(textoSequencia);
      await c.query("update king_private.sequencia_inicio set inicio = $1", [ROLLOUT_DOS_TESTES]);
    }
  } finally {
    await c.end();
  }
}

let contador = 0;
async function bancoDeTeste(modelo) {
  const nome = `t_${++contador}_${randomBytes(3).toString("hex")}`;
  const adm = await conectar("postgres");
  await adm.query(`create database ${nome} template ${modelo}`);
  await adm.end();
  const admin = await conectar(nome);
  const abertos = [admin];
  return {
    nome, admin,
    async servidor() { const c = await conectar(nome, "king_server", SENHA_SERVIDOR); abertos.push(c); return c; },
    async como(sub) {
      const c = await conectar(nome);
      abertos.push(c);
      await c.query("set role authenticated");
      if (sub) await c.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, role: "authenticated" })]);
      return c;
    },
    async anonimo() { const c = await conectar(nome); abertos.push(c); await c.query("set role anon"); return c; },
    async outraAdmin() { const c = await conectar(nome); abertos.push(c); return c; },
    async jogadores(n) {
      const ids = Array.from({ length: n }, () => randomUUID());
      for (const id of ids) await admin.query("insert into auth.users (id) values ($1)", [id]);
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

// ─────────────────────────── domínio dos testes ───────────────────────────

/** Meio-dia de ONTEM em São Paulo: passado garantido, e todo mundo no mesmo dia da regra. */
function ancora() {
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const d = new Date(`${hoje}T12:00:00-03:00`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}
const BASE = ancora();
/** A k-ésima partida do dia: 10 minutos cada, sem sobrepor a próxima. */
const janelaDaPartida = (k) => ({ iniciada: new Date(BASE + k * 20 * 60_000), terminada: new Date(BASE + k * 20 * 60_000 + 10 * 60_000) });

async function creditar(c, { partida = randomUUID(), iniciada, terminada, humanos, bots, extra }) {
  const resultado = humanos.map((h) => ({ player_id: h.id, posicao: h.posicao, participou: h.participou ?? true, ...(extra ?? {}) }));
  const r = await c.query(
    "select player_id, posicao, xp_delta, novo from king_private.creditar_partida($1::uuid, $2::timestamptz, $3::timestamptz, $4::smallint, $5::smallint, $6::jsonb)",
    [partida, iniciada.toISOString(), terminada.toISOString(), humanos.length, bots ?? 4 - humanos.length, JSON.stringify(resultado)],
  );
  return { partida, linhas: r.rows };
}
const xpDe = (linhas, id) => linhas.find((l) => l.player_id === id)?.xp_delta;
async function total(admin, id) {
  const r = await admin.query("select xp_total from public.progresso where player_id = $1", [id]);
  return r.rows[0]?.xp_total ?? 0;
}

// ── sequência: relógio CONTROLADO. Todo instante é fixo, com fuso explícito, no passado. ──

/** Partida que TERMINA no instante dado, com `min` minutos de duração. */
const terminandoEm = (iso, min = 10) => { const t = new Date(iso); return { iniciada: new Date(t.getTime() - min * 60_000), terminada: t }; };
const dupla = (a, x) => [{ id: a, posicao: 1 }, { id: x, posicao: 2 }];
/** O RETRATO gravado em `progresso` (sem linha = nunca creditado). */
async function sequencia(admin, id) {
  const r = await admin.query(
    "select sequencia_atual as atual, sequencia_recorde as recorde, sequencia_ultimo_dia::text as dia, sequencia_partida as partida from public.progresso where player_id = $1", [id]);
  return r.rows[0] ?? { atual: 0, recorde: 0, dia: null, partida: null };
}
const DIA_SP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
/** O dia de São Paulo calculado FORA do banco — o oráculo não pode usar o código que testa. */
const diaSP = (d) => DIA_SP.format(d);
const numeroDoDia = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;

/**
 * O ORÁCULO: a regra escrita como o produto a descreve — "primeiro dia = 1, ontem = +1, hoje =
 * igual, buraco = 1" — em JavaScript, sem nada do SQL. `eventos` = o ledger de UM jogador.
 */
function oraculo(eventos) {
  const positivos = eventos.filter((e) => e.xp > 0);
  if (!positivos.length) return { atual: 0, recorde: 0, dia: null, partida: null };
  const dias = [...new Set(positivos.map((e) => e.dia))].sort();
  let corrida = 1, recorde = 1;
  for (let i = 1; i < dias.length; i++) {
    corrida = numeroDoDia(dias[i]) - numeroDoDia(dias[i - 1]) === 1 ? corrida + 1 : 1;
    recorde = Math.max(recorde, corrida);
  }
  const ultimo = dias.at(-1);
  const partida = positivos.filter((e) => e.dia === ultimo).sort((p, q) => p.id - q.id)[0].partida;
  return { atual: corrida, recorde, dia: ultimo, partida };
}
function mulberry32(semente) {
  let s = semente >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** O dia de São Paulo `k` dias antes de `iso` (AAAA-MM-DD). */
const diaMenos = (iso, k) => new Date((numeroDoDia(iso) - k) * 86_400_000).toISOString().slice(0, 10);
/** O marco do rollout que a migração gravou. */
async function marco(admin) {
  const r = await admin.query("select inicio, ultimo_evento_anterior::int as ultimo from king_private.sequencia_inicio");
  return r.rows[0] ?? null;
}
const ZERADO = JSON.stringify({ atual: 0, recorde: 0, dia: null, partida: null });
/** Quantos jogadores têm QUALQUER traço de sequência. */
async function naoZerados(admin) {
  const r = await admin.query("select count(*)::int n from public.progresso where sequencia_atual <> 0 or sequencia_recorde <> 0 " +
    "or sequencia_ultimo_dia is not null or sequencia_partida is not null");
  return r.rows[0].n;
}
async function resumoDoLedger(admin) {
  return (await admin.query("select count(*)::int n, coalesce(sum(xp_delta), 0)::int soma, coalesce(max(id), 0)::int ultimo from public.xp_eventos")).rows[0];
}

function afirmar(cond, msg) { if (!cond) throw new Error(msg); }
async function reprova(promessa, padrao, msg) {
  try { await promessa; } catch (e) {
    if (padrao && !padrao.test(String(e.message))) throw new Error(`${msg} — falhou pelo motivo errado: ${e.message}`);
    return;
  }
  throw new Error(msg);
}

/** A "transação 1": segura a linha do jogador com a MESMA trava da função, até `soltar()`. */
async function segurarJogador(b, id) {
  const c = await b.outraAdmin();
  await c.query("begin");
  await c.query("select 1 from public.progresso where player_id = $1 for update", [id]);
  return { pid: c.processID, soltar: () => c.query("commit") };
}

/** Crédito disparado SEM esperar; a rejeição fica anotada, nunca solta. */
function disparar(c, args) {
  const p = creditar(c, args);
  const estado = { terminou: false };
  p.then(() => { estado.terminou = true; }, () => { estado.terminou = true; });
  return { pid: c.processID, p, estado };
}

/**
 * Até o Postgres dizer que a chamada está PARADA esperando só as conexões `por` — ou que terminou.
 * Não há limiar: cada desfecho é determinado pelo código SQL. O prazo só impede a suíte de pendurar.
 */
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

/** Quantos locks a conexão tem no LEDGER — tocou `xp_eventos` = já olhou o passado. */
async function tocouOLedger(b, pid) {
  const r = await b.admin.query("select count(*)::int n from pg_locks where pid = $1 and relation = 'public.xp_eventos'::regclass", [pid]);
  return r.rows[0].n > 0;
}

/**
 * Corrida SEM relógio: segura o jogador, dispara as chamadas, espera TODAS pararem (na trava da
 * função, ou — sem ela — no UPDATE final), e só então solta. Sem a trava, todas já leram o mesmo
 * passado quando param; com ela, nenhuma leu, e passam uma de cada vez.
 */
async function corridaSobATrava(b, jogador, pares) {
  const trava = await segurarJogador(b, jogador);
  const chamadas = pares.map(([c, args]) => disparar(c, args));
  const por = [trava.pid, ...chamadas.map((c) => c.pid)];
  for (const c of chamadas) afirmar(await paradaOuTerminou(b, c, por) === "parada", "uma chamada terminou com o jogador travado por fora");
  await trava.soltar();
  return Promise.all(chamadas.map((c) => c.p));
}

// ─────────────────────────── os testes ───────────────────────────
// `janela: true` = roda no modelo com o amplificador de corrida.

const TESTES = [
  { id: "T1", nome: "partida elegível credita uma vez, com a regra M2", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    const { linhas } = await creditar(s, { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 3 }] });
    afirmar(xpDe(linhas, a) === 150 && xpDe(linhas, x) === 115, `XP inesperado: ${JSON.stringify(linhas)}`);
    afirmar(linhas.every((l) => l.novo === true), "lançamentos novos deveriam vir com novo=true");
    afirmar(await total(b.admin, a) === 150 && await total(b.admin, x) === 115, "progresso não bate");
  } },
  { id: "T2", nome: "retry da mesma partida não duplica e devolve o que já existe", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    const args = { partida: randomUUID(), ...janelaDaPartida(0), humanos: [{ id: a, posicao: 2 }, { id: x, posicao: 4 }] };
    await creditar(s, args);
    const segunda = await creditar(s, args);
    afirmar(segunda.linhas.length === 2 && segunda.linhas.every((l) => l.novo === false), "o retry deveria devolver os mesmos lançamentos com novo=false");
    afirmar(await total(b.admin, a) === 130, "o retry somou de novo");
    const n = await b.admin.query("select count(*)::int n from public.xp_eventos where partida_id = $1", [args.partida]);
    afirmar(n.rows[0].n === 2, "o ledger duplicou");
  } },
  { id: "T3", janela: true, nome: "a MESMA partida, em duas conexões ao mesmo tempo, credita uma vez", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const [s1, s2] = [await b.servidor(), await b.servidor()];
    const args = { partida: randomUUID(), ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }] };
    const [r1, r2] = await Promise.all([creditar(s1, args), creditar(s2, args)]);
    const novos = [...r1.linhas, ...r2.linhas].filter((l) => l.novo).length;
    afirmar(novos === 2, `deveria haver exatamente 2 lançamentos novos, houve ${novos}`);
    afirmar(await total(b.admin, a) === 150, `progresso de A = ${await total(b.admin, a)}, esperado 150`);
  } },
  { id: "T4", nome: "partidas DIFERENTES com o mesmo jogador serializam NA TRAVA, antes de olhar o passado", async fn(b) {
    const [a, x, w] = await b.jogadores(3);
    const [s0, s1] = [await b.servidor(), await b.servidor()];
    // O CASO DIFÍCIL: A já tem linha em `progresso`. No primeiro crédito de um jogador, o
    // INSERT ... ON CONFLICT espera a linha ainda não confirmada da outra transação — uma
    // serialização ACIDENTAL que esconde a falta da trava. Com a linha já existente, só a trava
    // explícita serializa.
    await creditar(s0, { ...janelaDaPartida(9), humanos: [{ id: a, posicao: 4 }, { id: w, posicao: 1 }] });
    const trava = await segurarJogador(b, a); // a transação 1
    const segunda = disparar(s1, { ...janelaDaPartida(1), humanos: [{ id: a, posicao: 2 }, { id: x, posicao: 1 }] });
    const onde = await paradaOuTerminou(b, segunda, [trava.pid]);
    const olhouAntes = onde === "parada" && await tocouOLedger(b, segunda.pid);
    await trava.soltar();
    afirmar(onde === "parada", "a segunda partida terminou sem esperar o jogador travado");
    afirmar(!olhouAntes, "a segunda partida parou só DEPOIS de ler e gravar o ledger — não houve trava por jogador antes do passado");
    const { linhas } = await segunda.p; // soltou a 1: a 2 prossegue
    afirmar(xpDe(linhas, a) === 130 && await total(b.admin, a) === 230, `A = ${await total(b.admin, a)}, esperado 100 + 130`);
  } },
  { id: "T4b", nome: "jogadores DISTINTOS não esperam a trava de quem não está na mesa, e nada se corrompe", async fn(b) {
    const [a, x, y, z] = await b.jogadores(4);
    const [s0, s1] = [await b.servidor(), await b.servidor()];
    await creditar(s0, { ...janelaDaPartida(9), humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }] });
    const trava = await segurarJogador(b, a);
    const outra = disparar(s1, { ...janelaDaPartida(0), humanos: [{ id: y, posicao: 1 }, { id: z, posicao: 2 }] });
    const onde = await paradaOuTerminou(b, outra, [trava.pid]);
    await trava.soltar();
    afirmar(onde === "terminou", "uma mesa SEM o jogador travado ficou esperando por ele — a trava não é por jogador");
    await outra.p;
    for (const [id, esperado] of [[a, 150], [x, 130], [y, 150], [z, 130]]) {
      afirmar(await total(b.admin, id) === esperado, `progresso corrompido para um jogador distinto`);
    }
  } },
  { id: "T5", nome: "partida sobreposta no tempo à anterior do mesmo jogador rende 0", async fn(b) {
    const [a, x, y] = await b.jogadores(3);
    const s = await b.servidor();
    const j = janelaDaPartida(0);
    await creditar(s, { ...j, humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }] });
    const meio = { iniciada: new Date(j.iniciada.getTime() + 5 * 60_000), terminada: new Date(j.terminada.getTime() + 5 * 60_000) };
    const { linhas } = await creditar(s, { ...meio, humanos: [{ id: a, posicao: 1 }, { id: y, posicao: 2 }] });
    afirmar(xpDe(linhas, a) === 0, `A estava em duas mesas ao mesmo tempo e ganhou ${xpDe(linhas, a)}`);
    afirmar(xpDe(linhas, y) === 130, "quem não estava na outra mesa ganha normalmente");
  } },
  { id: "T6", nome: "corrida de sobreposição não premia as duas partidas (jogador que JÁ tem progresso)", async fn(b) {
    const [a, x, y, w] = await b.jogadores(4);
    const [s0, s1, s2] = [await b.servidor(), await b.servidor(), await b.servidor()];
    // Mesmo cuidado do T4: sem progresso prévio, a espera acidental do INSERT mascararia a corrida.
    await creditar(s0, { ...janelaDaPartida(9), humanos: [{ id: a, posicao: 4 }, { id: w, posicao: 1 }] });
    const j = janelaDaPartida(0);
    const meio = { iniciada: new Date(j.iniciada.getTime() + 5 * 60_000), terminada: new Date(j.terminada.getTime() + 5 * 60_000) };
    const [r1, r2] = await corridaSobATrava(b, a, [
      [s1, { ...j, humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }] }],
      [s2, { ...meio, humanos: [{ id: a, posicao: 1 }, { id: y, posicao: 2 }] }],
    ]);
    const positivas = [xpDe(r1.linhas, a), xpDe(r2.linhas, a)].filter((v) => v > 0).length;
    afirmar(positivas === 1, `A ganhou XP em ${positivas} de 2 partidas sobrepostas`);
  } },
  { id: "T7", nome: "as 6 primeiras partidas com XP do dia rendem 100%", async fn(b) {
    const [a, ...outros] = await b.jogadores(7);
    const s = await b.servidor();
    for (let k = 0; k < 6; k++) {
      const { linhas } = await creditar(s, { ...janelaDaPartida(k), humanos: [{ id: a, posicao: 1 }, { id: outros[k], posicao: 2 }] });
      afirmar(xpDe(linhas, a) === 150, `a ${k + 1}ª partida rendeu ${xpDe(linhas, a)}`);
    }
  } },
  { id: "T8", nome: "a 7ª partida com XP do dia rende 25% (redução após 6 partidas)", async fn(b) {
    const [a, ...outros] = await b.jogadores(8);
    const s = await b.servidor();
    for (let k = 0; k < 6; k++) await creditar(s, { ...janelaDaPartida(k), humanos: [{ id: a, posicao: 1 }, { id: outros[k], posicao: 2 }] });
    const { linhas } = await creditar(s, { ...janelaDaPartida(6), humanos: [{ id: a, posicao: 1 }, { id: outros[6], posicao: 2 }] });
    afirmar(xpDe(linhas, a) === 37, `a 7ª rendeu ${xpDe(linhas, a)}, esperado 37 (150/4)`);
    afirmar(xpDe(linhas, outros[6]) === 130, "a redução é por jogador, não por mesa");
  } },
  { id: "T9", nome: "na fronteira 6ª/7ª, duas partidas simultâneas não levam as duas 100%", async fn(b) {
    const [a, ...outros] = await b.jogadores(8);
    const [s0, s1, s2] = [await b.servidor(), await b.servidor(), await b.servidor()];
    for (let k = 0; k < 5; k++) await creditar(s0, { ...janelaDaPartida(k), humanos: [{ id: a, posicao: 1 }, { id: outros[k], posicao: 2 }] });
    const [r1, r2] = await corridaSobATrava(b, a, [
      [s1, { ...janelaDaPartida(5), humanos: [{ id: a, posicao: 1 }, { id: outros[5], posicao: 2 }] }],
      [s2, { ...janelaDaPartida(6), humanos: [{ id: a, posicao: 1 }, { id: outros[6], posicao: 2 }] }],
    ]);
    const xs = [xpDe(r1.linhas, a), xpDe(r2.linhas, a)].sort((p, q) => p - q);
    afirmar(xs[0] === 37 && xs[1] === 150, `na fronteira A recebeu ${xs.join(" e ")}, esperado 37 e 150`);
  } },
  { id: "T10", nome: "abandono rende 0, e o lançamento fica registrado", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    const { linhas } = await creditar(s, { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1, participou: false }, { id: x, posicao: 2 }] });
    afirmar(xpDe(linhas, a) === 0 && await total(b.admin, a) === 0, "quem abandonou ganhou XP");
    afirmar(linhas.length === 2, "o abandono também é lançado, com zero, para auditoria e idempotência");
  } },
  { id: "T11", nome: "bot não entra: id sintético reprova a chamada inteira", async fn(b) {
    const [a] = await b.jogadores(1);
    const s = await b.servidor();
    await reprova(creditar(s, { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: "bot:1", posicao: 2 }] }), /player_id inválido/, "um bot foi aceito no resultado");
    afirmar(await total(b.admin, a) === 0, "a chamada reprovada deixou rastro");
  } },
  { id: "T12", nome: "jogador inexistente reprova a transação inteira", async fn(b) {
    const [a] = await b.jogadores(1);
    const s = await b.servidor();
    const partida = randomUUID();
    await reprova(creditar(s, { partida, ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: randomUUID(), posicao: 2 }] }), /foreign key|violates/, "um id sem jogador foi aceito");
    const n = await b.admin.query("select count(*)::int n from king_private.partidas where id = $1", [partida]);
    afirmar(n.rows[0].n === 0 && await total(b.admin, a) === 0, "a transação reprovada deixou a partida ou o XP gravados");
  } },
  { id: "T13", nome: "jogador repetido no resultado reprova", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    await reprova(creditar(s, { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: a, posicao: 2 }, { id: x, posicao: 3 }] }), /repetido/, "o mesmo jogador entrou duas vezes");
  } },
  { id: "T13b", nome: "resultado com campo de XP reprova — o servidor não informa XP", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    await reprova(creditar(s, { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }], extra: { xp: 9999 } }), /campos inesperados/, "um campo de XP foi aceito");
    afirmar(await total(b.admin, a) === 0, "o XP informado vazou para o total");
  } },
  { id: "T13c", nome: "composição inconsistente reprova", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    await reprova(creditar(s, { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }], bots: 1 }), /composição/, "2 humanos + 1 bot foi aceito");
    const j = janelaDaPartida(0);
    await reprova(creditar(s, { iniciada: j.terminada, terminada: j.iniciada, humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }] }), /início/, "fim antes do início foi aceito");
  } },
  { id: "T14", nome: "authenticated não INSERE em progresso nem no ledger", async fn(b) {
    const [a] = await b.jogadores(1);
    const c = await b.como(a);
    await reprova(c.query("insert into public.progresso (player_id, xp_total) values ($1, 999999)", [a]), /permission denied|row-level security/, "o jogador inseriu o próprio progresso");
    await reprova(c.query("insert into public.xp_eventos (player_id, partida_id, motivo, posicao, xp_delta) values ($1, gen_random_uuid(), 'partida_concluida', 1, 150)", [a]), /permission denied|row-level security|foreign key/, "o jogador inseriu no ledger");
  } },
  { id: "T15", nome: "authenticated não ATUALIZA o próprio total", async fn(b) {
    const [a, x] = await b.jogadores(2);
    await creditar(await b.servidor(), { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 4 }, { id: x, posicao: 1 }] });
    const c = await b.como(a);
    try { await c.query("update public.progresso set xp_total = 999999 where player_id = $1", [a]); } catch { /* recusado: ótimo */ }
    afirmar(await total(b.admin, a) === 100, "o jogador alterou o próprio xp_total");
  } },
  { id: "T16", nome: "cliente não executa creditar_partida (nem authenticated, nem anon)", async fn(b) {
    const [a, x] = await b.jogadores(2);
    for (const c of [await b.como(a), await b.anonimo()]) {
      await reprova(creditar(c, { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }] }), /permission denied/, "um cliente executou a função de crédito");
    }
    afirmar(await total(b.admin, a) === 0, "o cliente conseguiu creditar");
  } },
  { id: "T16b", nome: "king_server não escreve direto em tabela nenhuma", async fn(b) {
    const [a] = await b.jogadores(1);
    const s = await b.servidor();
    await reprova(s.query("insert into public.progresso (player_id, xp_total) values ($1, 5)", [a]), /permission denied/, "king_server escreveu direto em progresso");
    await reprova(s.query("select * from public.xp_eventos"), /permission denied/, "king_server lê o ledger direto");
    await reprova(s.query("select king_private.xp_da_regra(1::smallint, true, false, 0)"), /permission denied/, "king_server chama a regra direto");
  } },
  { id: "T17", nome: "A não lê o progresso nem o ledger de B", async fn(b) {
    const [a, x] = await b.jogadores(2);
    await creditar(await b.servidor(), { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }] });
    const c = await b.como(a);
    const p = await c.query("select player_id from public.progresso");
    const e = await c.query("select player_id from public.xp_eventos");
    afirmar(p.rows.length === 1 && p.rows[0].player_id === a, `A enxerga ${p.rows.length} linha(s) de progresso`);
    afirmar(e.rows.every((r) => r.player_id === a), "A enxerga lançamentos de B");
    const anon = await b.anonimo();
    await reprova(anon.query("select * from public.progresso"), /permission denied/, "anon lê progresso");
  } },
  { id: "T18", nome: "meu_progresso: sem linha, XP 0 e nível 1; com XP, os números certos", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const zero = (await (await b.como(a)).query("select * from public.meu_progresso")).rows;
    afirmar(zero.length === 1 && zero[0].xp_total === 0 && zero[0].nivel === 1 && zero[0].xp_no_nivel === 0 && zero[0].xp_do_nivel === 100,
      `sem linha: ${JSON.stringify(zero)}`);
    await creditar(await b.servidor(), { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }] });
    const um = (await (await b.como(a)).query("select * from public.meu_progresso")).rows[0];
    afirmar(um.xp_total === 150 && um.nivel === 2 && um.xp_no_nivel === 50 && um.xp_do_nivel === 150, `com 150 XP: ${JSON.stringify(um)}`);
    const anon = await b.anonimo();
    await reprova(anon.query("select * from public.meu_progresso"), /permission denied/, "anon lê meu_progresso");
  } },
  { id: "T19", nome: "nível: bordas, tabela aprovada e varredura de 0 a 70.000", async fn(b) {
    const bordas = [[0, 1], [99, 1], [100, 2], [249, 2], [250, 3], [699, 4], [700, 5], [2699, 9], [2700, 10]];
    for (const [xp, n] of bordas) {
      const r = await b.admin.query("select public.nivel_de($1) n", [xp]);
      afirmar(r.rows[0].n === n, `nivel_de(${xp}) = ${r.rows[0].n}, esperado ${n}`);
    }
    const tabela = { 1: 0, 2: 100, 3: 250, 5: 700, 10: 2700, 20: 10450, 30: 23200, 50: 63700 };
    for (const [n, xp] of Object.entries(tabela)) {
      const r = await b.admin.query("select public.xp_para_nivel($1)::int x", [Number(n)]);
      afirmar(r.rows[0].x === xp, `xp_para_nivel(${n}) = ${r.rows[0].x}, esperado ${xp}`);
    }
    const v = await b.admin.query(`
      select count(*)::int erros from generate_series(0, 70000) as g(xp)
       where not (public.xp_para_nivel(public.nivel_de(g.xp)) <= g.xp
                  and g.xp < public.xp_para_nivel(public.nivel_de(g.xp) + 1))`);
    afirmar(v.rows[0].erros === 0, `${v.rows[0].erros} valores de XP caem no nível errado`);
  } },
  { id: "T20", nome: "soma do ledger = progresso.xp_total, para todo mundo", async fn(b) {
    const ids = await b.jogadores(5);
    const s = await b.servidor();
    for (let k = 0; k < 9; k++) {
      const quem = [ids[k % 5], ids[(k + 1) % 5], ids[(k + 2) % 5]];
      await creditar(s, { ...janelaDaPartida(k), humanos: quem.map((id, i) => ({ id, posicao: i + 1, participou: k % 4 !== i })) });
    }
    const r = await b.admin.query(`
      select count(*)::int divergentes from public.progresso g
       where g.xp_total <> (select coalesce(sum(e.xp_delta), 0) from public.xp_eventos e where e.player_id = g.player_id)`);
    afirmar(r.rows[0].divergentes === 0, `${r.rows[0].divergentes} jogador(es) com total diferente do ledger`);
  } },
  { id: "T21", nome: "servidor ↔ banco: crash DEPOIS do COMMIT e ANTES de limpar o outbox não duplica", async fn(b) {
    // Os módulos REAIS do servidor (compilados em apps/server/dist), falando com este Postgres
    // como `king_server`. Nada de dublê: o que se prova aqui é a idempotência de ponta a ponta.
    const { OutboxDeProgresso } = await import(new URL("apps/server/dist/progresso/outbox.js", RAIZ).href);
    const { repositorioPg } = await import(new URL("apps/server/dist/progresso/repositorio.js", RAIZ).href);
    const { ServicoDeProgresso } = await import(new URL("apps/server/dist/progresso/servico.js", RAIZ).href);
    const [a, x] = await b.jogadores(2);
    const dirOutbox = mkdtempSync(join(tmpdir(), "king-outbox-real-"));
    const pool = new pg.Pool({ host: "127.0.0.1", port: PORTA, database: b.nome, user: "king_server", password: SENHA_SERVIDOR, max: 2 });
    const repo = repositorioPg({ pool });
    const semEspera = { esperas: [0], esperar: async () => {}, log: () => {} };
    try {
      const j = janelaDaPartida(0);
      const partida = {
        partidaId: randomUUID(), iniciadaEm: j.iniciada, terminadaEm: j.terminada,
        posicoes: { 0: 1, 1: 2, 2: 3, 3: 4 },
        assentos: [
          { seat: 0, playerId: a, bot: false, permanente: true, conectado: true, jogadasTotais: 30, jogadasProprias: 30 },
          { seat: 1, playerId: "bot:1", bot: true, permanente: false, conectado: true, jogadasTotais: 30, jogadasProprias: 0 },
          { seat: 2, playerId: x, bot: false, permanente: true, conectado: true, jogadasTotais: 30, jogadasProprias: 18 },
          { seat: 3, playerId: "bot:3", bot: true, permanente: false, conectado: true, jogadasTotais: 30, jogadasProprias: 0 },
        ],
      };
      // 1ª vida: o COMMIT acontece e o processo "morre" antes de remover a pendência
      class OutboxQueMorre extends OutboxDeProgresso { remover() { throw new Error("o processo morreu aqui"); } }
      const primeira = new ServicoDeProgresso(new OutboxQueMorre(dirOutbox), repo, semEspera);
      afirmar((await primeira.iniciar()).estado === "closed", "a sonda do boot não fechou o disjuntor");
      primeira.partidaEncerrada(partida);
      await primeira.ocioso();
      afirmar(await total(b.admin, a) === 150 && await total(b.admin, x) === 115, "a primeira vida não creditou (x participou com 18/30 = 60%)");
      afirmar(new OutboxDeProgresso(dirOutbox).pendentes().validas.length === 1, "a pendência deveria ter sobrado no outbox");
      // 2ª vida: boot — UMA sonda, closed, e reprocessa a MESMA partida
      const { estado, balanco } = await new ServicoDeProgresso(new OutboxDeProgresso(dirOutbox), repo, semEspera).iniciar();
      afirmar(estado === "closed" && balanco?.entregues === 1 && balanco?.pendentes === 0, `boot: ${estado} ${JSON.stringify(balanco)}`);
      afirmar(await total(b.admin, a) === 150 && await total(b.admin, x) === 115, "o reprocessamento somou de novo");
      const n = await b.admin.query("select count(*)::int n from public.xp_eventos where partida_id = $1", [partida.partidaId]);
      afirmar(n.rows[0].n === 2, "o ledger duplicou no reprocessamento");
      afirmar(new OutboxDeProgresso(dirOutbox).pendentes().validas.length === 0, "a pendência não saiu do outbox depois de confirmada");
    } finally {
      await repo.encerrar().catch(() => {});
      rmSync(dirOutbox, { recursive: true, force: true });
    }
  } },
  { id: "T22", nome: "a credencial da ferramenta (scripts/lib/scram.mjs) autentica por SCRAM num Postgres de verdade", async fn(b) {
    // A suíte sobe com `scram-sha-256`: o login abaixo é a troca SCRAM completa — o servidor confere
    // a prova do cliente pela StoredKey e assina com a ServerKey, que o cliente confere.
    const papel = `t22_${randomBytes(4).toString("hex")}`;
    const senha = gerarSenha();
    const verificador = verificadorScram(senha);
    afirmar(validarVerificador(verificador), "a ferramenta gerou verificador inválido");
    await b.admin.query(`create role ${papel} login password '${verificador}'`);
    try {
      const guardado = await b.admin.query("select rolpassword = $1 as igual from pg_authid where rolname = $2", [verificador, papel]);
      afirmar(guardado.rows[0].igual, "o Postgres não guardou o verificador como veio — tratou como senha em texto");
      const c = await conectar(b.nome, papel, senha);
      const quem = (await c.query("select current_user as u")).rows[0].u;
      await c.end();
      afirmar(quem === papel, "o login com a senha certa não entrou como o papel");
      let codigo = null;
      try { const e = await conectar(b.nome, papel, `${senha}x`); await e.end(); } catch (e) { codigo = e.code; }
      afirmar(codigo === "28P01", `senha errada deveria dar 28P01, deu ${codigo}`);
      // O INSTRUMENTO: a troca é SCRAM mesmo? Com `password`, o servidor só confere a ServerKey. Uma
      // StoredKey adulterada (ServerKey intacta) SÓ é recusada numa troca SCRAM de verdade.
      const metodos = await b.admin.query("select distinct auth_method from pg_hba_file_rules where type = 'host'");
      afirmar(metodos.rows.length === 1 && metodos.rows[0].auth_method === "scram-sha-256",
        `pg_hba não está em scram-sha-256: ${JSON.stringify(metodos.rows)}`);
      const [, iter, sal, stored, server] = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verificador);
      const adulterada = Buffer.from(stored, "base64");
      adulterada[0] ^= 0xff;
      await b.admin.query(`alter role ${papel} password 'SCRAM-SHA-256$${iter}:${sal}$${adulterada.toString("base64")}:${server}'`);
      let recusada = null;
      try { const e = await conectar(b.nome, papel, senha); await e.end(); } catch (e) { recusada = e.code; }
      afirmar(recusada === "28P01", `StoredKey adulterada deveria ser recusada (28P01), deu ${recusada} — a troca não é SCRAM`);
    } finally {
      await b.admin.query(`drop role if exists ${papel}`);
    }
  } },
  { id: "T23", nome: "a sonda da ativação com 28P01 DE VERDADE: uma confirmação, e acabou", async fn(b) {
    // A sonda REAL (apps/server/dist/progresso/sonda.js) contra este Postgres. Só o TLS fica de fora
    // (o Postgres embutido não tem certificado); parser, repositório e lógica de sonda são os mesmos.
    const { sondarProgresso } = await import(new URL("apps/server/dist/progresso/sonda.js", RAIZ).href);
    const { repositorioPg } = await import(new URL("apps/server/dist/progresso/repositorio.js", RAIZ).href);
    const papel = `t23_${randomBytes(4).toString("hex")}`;
    const [certa, velha] = [gerarSenha(), gerarSenha()];
    const dir = mkdtempSync(join(tmpdir(), "king-t23-"));
    const arquivo = join(dir, "progress.env.pendente");
    writeFileSync(arquivo, [
      "KING_PROGRESS_MODE=database",
      `KING_PROGRESS_DATABASE_URL=postgresql://${papel}:${certa}@127.0.0.1:${PORTA}/${b.nome}`,
      `KING_PROGRESS_SSL_ROOT_CERT=${fileURLToPath(new URL("scripts/ops/fixtures/ca-teste.pem", RAIZ))}`,
    ].join("\n"));
    const semTls = ({ url }) => repositorioPg({ pool: new pg.Pool({ connectionString: url, max: 1 }) });
    const agendados = [];
    const agendar = (fn, ms) => { agendados.push({ fn, ms }); };
    const ate = async (cond) => { for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)); afirmar(cond(), "a sonda não chegou ao ponto esperado"); };
    const trocar = (senha) => b.admin.query(`alter role ${papel} password '${verificadorScram(senha)}'`);
    await b.admin.query(`create role ${papel} login password '${verificadorScram(certa)}'`);
    try {
      // (a) credencial certa: closed de primeira
      const a = await sondarProgresso({ arquivo, criarRepositorio: semTls, agendar });
      afirmar(a.desfecho === "closed" && a.tentativas === 1 && agendados.length === 0, `certa: ${JSON.stringify(a)}`);
      // (b) O CASO DO POOLER: o banco ainda recusa (senha velha); a confirmação chega DEPOIS da troca
      await trocar(velha);
      const pb = sondarProgresso({ arquivo, criarRepositorio: semTls, agendar });
      await ate(() => agendados.length === 1);
      afirmar(agendados[0].ms === 30_000, `confirmação agendada para ${agendados[0].ms} ms`);
      await trocar(certa);
      agendados.shift().fn();
      const rb = await pb;
      afirmar(rb.desfecho === "closed" && rb.tentativas === 2 && rb.codigos.join(",") === "28P01/autenticacao,ok", `pooler: ${JSON.stringify(rb)}`);
      // (c) senha errada de verdade: 28P01, confirmação 28P01, open_auth — e NENHUMA terceira
      await trocar(velha);
      const pc = sondarProgresso({ arquivo, criarRepositorio: semTls, agendar });
      await ate(() => agendados.length === 1);
      agendados.shift().fn();
      const rc = await pc;
      afirmar(rc.desfecho === "open_auth" && rc.tentativas === 2 && rc.saida === 10 && agendados.length === 0, `errada: ${JSON.stringify(rc)}`);
    } finally {
      await b.admin.query(`drop role if exists ${papel}`);
      rmSync(dir, { recursive: true, force: true });
    }
  } },

  // ═════════════════════ SEQUÊNCIA (Fase 6A) — relógio controlado ═════════════════════
  // Os instantes são fixos (março de 2026, fuso explícito) e as conclusões não dependem de que
  // horas são agora. A única exceção é o S13, que prova a view com o relógio do próprio banco.

  { id: "S1", nome: "sequência A — primeira qualificação: 1, recorde 1, e a partida que qualificou", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    const { partida } = await creditar(s, { ...terminandoEm("2026-03-10T15:00:00-03:00"), humanos: dupla(a, x) });
    const q = await sequencia(b.admin, a);
    afirmar(q.atual === 1 && q.recorde === 1 && q.dia === "2026-03-10" && q.partida === partida, `A: ${JSON.stringify(q)}`);
    const qx = await sequencia(b.admin, x);
    afirmar(qx.atual === 1 && qx.partida === partida, `o 2º colocado (130 XP) também qualifica o dia: ${JSON.stringify(qx)}`);
  } },
  { id: "S2", nome: "sequência B — 2ª partida no MESMO dia: XP normal, sequência igual, a 1ª continua sendo a que qualificou", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    const p1 = await creditar(s, { ...terminandoEm("2026-03-10T15:00:00-03:00"), humanos: dupla(a, x) });
    const p2 = await creditar(s, { ...terminandoEm("2026-03-10T21:30:00-03:00"), humanos: dupla(a, x) });
    afirmar(xpDe(p2.linhas, a) === 150 && await total(b.admin, a) === 300, "a 2ª partida do dia deveria render XP normalmente");
    const q = await sequencia(b.admin, a);
    afirmar(q.atual === 1 && q.recorde === 1 && q.dia === "2026-03-10", `2 partidas no dia 10 deram sequência ${q.atual}`);
    afirmar(q.partida === p1.partida, "a 2ª partida do dia tomou o lugar da que qualificou — o Placar dela fingiria um avanço");
  } },
  { id: "S3", nome: "sequência C/D — dia seguinte: 2; o outro dia seguinte: 3", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    const esperado = [["2026-03-10", 1], ["2026-03-11", 2], ["2026-03-12", 3]];
    for (const [dia, n] of esperado) {
      const { partida } = await creditar(s, { ...terminandoEm(`${dia}T19:00:00-03:00`), humanos: dupla(a, x) });
      const q = await sequencia(b.admin, a);
      afirmar(q.atual === n && q.recorde === n && q.dia === dia && q.partida === partida, `em ${dia}: ${JSON.stringify(q)}, esperado ${n}`);
    }
  } },
  { id: "S4", nome: "sequência E/F — um dia sem jogar: volta a 1; o recorde fica, e só cresce quando é superado", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    const passos = [["10", 1, 1], ["11", 2, 2], ["12", 3, 3], /* 13: não jogou */ ["14", 1, 3], ["15", 2, 3], ["16", 3, 3], ["17", 4, 4]];
    for (const [dia, atual, recorde] of passos) {
      await creditar(s, { ...terminandoEm(`2026-03-${dia}T12:00:00-03:00`), humanos: dupla(a, x) });
      const q = await sequencia(b.admin, a);
      afirmar(q.atual === atual && q.recorde === recorde, `dia ${dia}: atual ${q.atual} recorde ${q.recorde}, esperado ${atual}/${recorde}`);
    }
  } },
  { id: "S5", nome: "sequência G — virada 23:59 → 00:00 em São Paulo conta como dia seguinte", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    await creditar(s, { ...terminandoEm("2026-03-10T23:59:00-03:00", 19), humanos: dupla(a, x) });
    const { partida, linhas } = await creditar(s, {
      iniciada: new Date("2026-03-10T23:59:30-03:00"), terminada: new Date("2026-03-11T00:00:30-03:00"), humanos: dupla(a, x) });
    afirmar(xpDe(linhas, a) === 150, "a partida da virada deveria render XP (não se sobrepõe à anterior)");
    const q = await sequencia(b.admin, a);
    afirmar(q.atual === 2 && q.dia === "2026-03-11" && q.partida === partida, `23:59 → 00:00:30 deu ${JSON.stringify(q)}`);
  } },
  { id: "S6", nome: "sequência H — 02:30 UTC ainda é o dia ANTERIOR em São Paulo", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    const p1 = await creditar(s, { ...terminandoEm("2026-03-11T12:00:00-03:00"), humanos: dupla(a, x) });
    // 2026-03-12T02:30Z = 11/03 23:30 em São Paulo: MESMO dia da anterior
    await creditar(s, { ...terminandoEm("2026-03-12T02:30:00Z"), humanos: dupla(a, x) });
    let q = await sequencia(b.admin, a);
    afirmar(q.atual === 1 && q.dia === "2026-03-11" && q.partida === p1.partida, `02:30 UTC virou dia novo: ${JSON.stringify(q)}`);
    // 2026-03-12T03:30Z = 12/03 00:30 em São Paulo: agora sim, dia seguinte
    await creditar(s, { ...terminandoEm("2026-03-12T03:30:00Z"), humanos: dupla(a, x) });
    q = await sequencia(b.admin, a);
    afirmar(q.atual === 2 && q.dia === "2026-03-12", `03:30 UTC (00:30 SP) deveria ser o dia 12: ${JSON.stringify(q)}`);
  } },
  { id: "S7", nome: "sequência I — o mesmo crédito repetido (mesma conexão e outra instância) não mexe em XP nem em sequência", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    const args = { partida: randomUUID(), ...terminandoEm("2026-03-10T15:00:00-03:00"), humanos: dupla(a, x) };
    await creditar(s, args);
    const antes = await sequencia(b.admin, a);
    for (const c of [s, s, await b.servidor()]) {
      const r = await creditar(c, args);
      afirmar(r.linhas.length === 2 && r.linhas.every((l) => l.novo === false), `o reenvio deveria devolver o que já existe: ${JSON.stringify(r.linhas)}`);
    }
    afirmar(await total(b.admin, a) === 150, `o reenvio somou XP: ${await total(b.admin, a)}`);
    const n = await b.admin.query("select count(*)::int n from public.xp_eventos where partida_id = $1", [args.partida]);
    afirmar(n.rows[0].n === 2, "o ledger duplicou");
    afirmar(JSON.stringify(await sequencia(b.admin, a)) === JSON.stringify(antes), "o reenvio mexeu na sequência");
    await creditar(s, { ...terminandoEm("2026-03-11T15:00:00-03:00"), humanos: dupla(a, x) });
    afirmar((await sequencia(b.admin, a)).atual === 2, "depois dos reenvios, o dia seguinte deveria dar 2");
  } },
  { id: "S8", nome: "sequência J — retry do outbox (crash DEPOIS do COMMIT): XP e sequência não contam duas vezes", async fn(b) {
    // Módulos REAIS do servidor (apps/server/dist), como no T21.
    const { OutboxDeProgresso } = await import(new URL("apps/server/dist/progresso/outbox.js", RAIZ).href);
    const { repositorioPg } = await import(new URL("apps/server/dist/progresso/repositorio.js", RAIZ).href);
    const { ServicoDeProgresso } = await import(new URL("apps/server/dist/progresso/servico.js", RAIZ).href);
    const [a, x] = await b.jogadores(2);
    const dirOutbox = mkdtempSync(join(tmpdir(), "king-outbox-seq-"));
    const pool = new pg.Pool({ host: "127.0.0.1", port: PORTA, database: b.nome, user: "king_server", password: SENHA_SERVIDOR, max: 2 });
    const repo = repositorioPg({ pool });
    const semEspera = { esperas: [0], esperar: async () => {}, log: () => {} };
    const partidaEm = (iso) => {
      const j = terminandoEm(iso);
      return {
        partidaId: randomUUID(), iniciadaEm: j.iniciada, terminadaEm: j.terminada, posicoes: { 0: 1, 1: 2, 2: 3, 3: 4 },
        assentos: [
          { seat: 0, playerId: a, bot: false, permanente: true, conectado: true, jogadasTotais: 30, jogadasProprias: 30 },
          { seat: 1, playerId: "bot:1", bot: true, permanente: false, conectado: true, jogadasTotais: 30, jogadasProprias: 0 },
          { seat: 2, playerId: x, bot: false, permanente: true, conectado: true, jogadasTotais: 30, jogadasProprias: 30 },
          { seat: 3, playerId: "bot:3", bot: true, permanente: false, conectado: true, jogadasTotais: 30, jogadasProprias: 0 },
        ],
      };
    };
    try {
      class OutboxQueMorre extends OutboxDeProgresso { remover() { throw new Error("o processo morreu aqui"); } }
      const primeira = new ServicoDeProgresso(new OutboxQueMorre(dirOutbox), repo, semEspera);
      afirmar((await primeira.iniciar()).estado === "closed", "a sonda do boot não fechou o disjuntor");
      const p1 = partidaEm("2026-03-10T15:00:00-03:00");
      primeira.partidaEncerrada(p1);
      await primeira.ocioso();
      const depoisDaPrimeira = await sequencia(b.admin, a);
      afirmar(depoisDaPrimeira.atual === 1 && depoisDaPrimeira.partida === p1.partidaId, `1ª vida: ${JSON.stringify(depoisDaPrimeira)}`);
      afirmar(new OutboxDeProgresso(dirOutbox).pendentes().validas.length === 1, "a pendência deveria ter sobrado no outbox");
      // 2ª vida: o boot reprocessa a MESMA partida
      const { balanco } = await new ServicoDeProgresso(new OutboxDeProgresso(dirOutbox), repo, semEspera).iniciar();
      afirmar(balanco?.entregues === 1 && balanco?.pendentes === 0, `boot: ${JSON.stringify(balanco)}`);
      afirmar(await total(b.admin, a) === 150, `o reprocessamento somou XP: ${await total(b.admin, a)}`);
      afirmar(JSON.stringify(await sequencia(b.admin, a)) === JSON.stringify(depoisDaPrimeira), "o reprocessamento mexeu na sequência");
      // 3ª vida: a partida do dia seguinte, entregue normalmente
      const terceira = new ServicoDeProgresso(new OutboxDeProgresso(dirOutbox), repo, semEspera);
      await terceira.iniciar();
      terceira.partidaEncerrada(partidaEm("2026-03-11T15:00:00-03:00"));
      await terceira.ocioso();
      const q = await sequencia(b.admin, a);
      afirmar(q.atual === 2 && q.recorde === 2 && await total(b.admin, a) === 300, `dia seguinte depois do retry: ${JSON.stringify(q)}`);
    } finally {
      await repo.encerrar().catch(() => {});
      rmSync(dirOutbox, { recursive: true, force: true });
    }
  } },
  { id: "S9", nome: "sequência — crédito ATRASADO (outbox fora de ordem) entra no dia certo", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    const p12 = await creditar(s, { ...terminandoEm("2026-03-12T15:00:00-03:00"), humanos: dupla(a, x) });
    await creditar(s, { ...terminandoEm("2026-03-10T15:00:00-03:00"), humanos: dupla(a, x) });
    let q = await sequencia(b.admin, a);
    afirmar(q.atual === 1 && q.recorde === 1 && q.dia === "2026-03-12" && q.partida === p12.partida, `10 e 12 (buraco no 11): ${JSON.stringify(q)}`);
    await creditar(s, { ...terminandoEm("2026-03-11T15:00:00-03:00"), humanos: dupla(a, x) }); // chegou por último
    q = await sequencia(b.admin, a);
    afirmar(q.atual === 3 && q.recorde === 3 && q.dia === "2026-03-12" && q.partida === p12.partida, `o dia 11 atrasado deveria fechar 10-11-12: ${JSON.stringify(q)}`);
  } },
  { id: "S10", nome: "elegibilidade — partida sem XP (abandono / participação insuficiente) não qualifica o dia", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    // `participou: false` é como o servidor entrega abandono E participação insuficiente (<60%)
    const fora = (dia) => creditar(s, { ...terminandoEm(`2026-03-${dia}T15:00:00-03:00`), humanos: [{ id: a, posicao: 1, participou: false }, { id: x, posicao: 2 }] });
    const dentro = (dia) => creditar(s, { ...terminandoEm(`2026-03-${dia}T15:00:00-03:00`), humanos: dupla(a, x) });
    await fora("10");
    let q = await sequencia(b.admin, a);
    afirmar(q.atual === 0 && q.recorde === 0 && q.dia === null && q.partida === null, `0 XP qualificou o dia: ${JSON.stringify(q)}`);
    afirmar((await sequencia(b.admin, x)).atual === 1, "quem jogou de verdade na mesma mesa qualifica");
    await dentro("11");
    await fora("12");
    q = await sequencia(b.admin, a);
    afirmar(q.atual === 1 && q.dia === "2026-03-11", `o dia 12 sem XP mexeu na sequência: ${JSON.stringify(q)}`);
    await dentro("13");
    q = await sequencia(b.admin, a);
    afirmar(q.atual === 1 && q.recorde === 1, `o dia 12 sem XP deveria ser buraco: ${JSON.stringify(q)}`);
  } },
  { id: "S10b", nome: "elegibilidade — partida local/solo (1 humano + bots) e bot não chegam ao crédito nem à sequência", async fn(b) {
    const [a] = await b.jogadores(1);
    const s = await b.servidor();
    await reprova(creditar(s, { ...terminandoEm("2026-03-10T15:00:00-03:00"), humanos: [{ id: a, posicao: 1 }], bots: 3 }), /composição/, "uma partida solo (1 humano + 3 bots) foi creditada");
    await reprova(creditar(s, { ...terminandoEm("2026-03-10T16:00:00-03:00"), humanos: [{ id: a, posicao: 1 }, { id: "bot:1", posicao: 2 }] }), /player_id inválido/, "um bot entrou no crédito");
    const q = await sequencia(b.admin, a);
    afirmar(q.atual === 0 && q.recorde === 0 && await total(b.admin, a) === 0, `solo/bot deixou rastro: ${JSON.stringify(q)}`);
  } },
  { id: "S11", nome: "concorrência — duas partidas simultâneas do mesmo jogador: o dia conta uma vez; dias seguidos somam", async fn(b) {
    const [a, w, x, y, z, v] = await b.jogadores(6);
    const [s0, s1, s2] = [await b.servidor(), await b.servidor(), await b.servidor()];
    await creditar(s0, { ...terminandoEm("2026-03-09T15:00:00-03:00"), humanos: dupla(a, w) }); // A já tem linha (caso difícil do T4)
    await corridaSobATrava(b, a, [
      [s1, { ...terminandoEm("2026-03-10T15:00:00-03:00"), humanos: dupla(a, x) }],
      [s2, { ...terminandoEm("2026-03-10T18:00:00-03:00"), humanos: dupla(a, y) }],
    ]);
    let q = await sequencia(b.admin, a);
    const primeira = (await b.admin.query(
      "select e.partida_id from public.xp_eventos e join king_private.partidas p on p.id = e.partida_id where e.player_id = $1 and p.terminada_em >= '2026-03-10T00:00:00-03:00' order by e.id limit 1", [a])).rows[0].partida_id;
    afirmar(q.atual === 2 && q.recorde === 2 && q.dia === "2026-03-10" && q.partida === primeira, `duas simultâneas no dia 10: ${JSON.stringify(q)}`);
    await corridaSobATrava(b, a, [
      [s1, { ...terminandoEm("2026-03-11T15:00:00-03:00"), humanos: dupla(a, z) }],
      [s2, { ...terminandoEm("2026-03-12T15:00:00-03:00"), humanos: dupla(a, v) }],
    ]);
    q = await sequencia(b.admin, a);
    afirmar(q.atual === 4 && q.recorde === 4 && q.dia === "2026-03-12", `dias 11 e 12 simultâneos: ${JSON.stringify(q)}`);
  } },
  { id: "S12", nome: "valor EFETIVO com relógio fixo: viva até o fim de ontem, quebrada no primeiro segundo de anteontem, em SP", async fn(b) {
    const [a] = await b.jogadores(1);
    const c = await b.como(a); // roda como o JOGADOR: é assim que a view as chama
    const casos = [
      [3, "2026-03-11", "2026-03-11T15:00:00-03:00", 3],  // qualificou hoje
      [3, "2026-03-11", "2026-03-12T15:00:00-03:00", 3],  // qualificou ontem: viva, esperando hoje
      [3, "2026-03-11", "2026-03-12T23:59:59-03:00", 3],  // último segundo de "ontem"
      [3, "2026-03-11", "2026-03-13T00:00:00-03:00", 0],  // virou o dia sem jogar: quebrou
      [3, "2026-03-11", "2026-03-20T12:00:00-03:00", 0],  // semanas depois
      [3, "2026-03-11", "2026-03-13T02:30:00Z", 3],       // 02:30 UTC do dia 13 = 23:30 do dia 12 em SP
      [0, null, "2026-03-11T15:00:00-03:00", 0],          // nunca qualificou
    ];
    for (const [atual, dia, agora, esperado] of casos) {
      const r = (await c.query("select public.sequencia_efetiva($1, $2::date, $3::timestamptz) as v", [atual, dia, agora])).rows[0].v;
      afirmar(r === esperado, `efetiva(${atual}, ${dia}, ${agora}) = ${r}, esperado ${esperado}`);
    }
    const hoje = [
      ["2026-03-11", "2026-03-11T00:00:00-03:00", true],
      ["2026-03-11", "2026-03-11T23:59:59-03:00", true],
      ["2026-03-11", "2026-03-12T00:00:00-03:00", false],
      ["2026-03-11", "2026-03-12T01:00:00Z", true],       // 22:00 do dia 11 em SP
      [null, "2026-03-11T12:00:00-03:00", false],
    ];
    for (const [dia, agora, esperado] of hoje) {
      const r = (await c.query("select public.sequencia_qualificada_hoje($1::date, $2::timestamptz) as v", [dia, agora])).rows[0].v;
      afirmar(r === esperado, `qualificada_hoje(${dia}, ${agora}) = ${r}, esperado ${esperado}`);
    }
  } },
  { id: "S13", nome: "meu_progresso com o relógio DO BANCO: efetiva, recorde, hoje, último dia e partida; colunas antigas intactas", async fn(b) {
    const [a, x, c, y, d] = await b.jogadores(5);
    const s = await b.servidor();
    for (const dia of ["10", "11", "12"]) await creditar(s, { ...terminandoEm(`2026-03-${dia}T15:00:00-03:00`), humanos: dupla(c, y) });
    const fim = new Date(Date.now() - 1000);
    const { partida } = await creditar(s, { iniciada: new Date(fim.getTime() - 10 * 60_000), terminada: fim, humanos: dupla(a, x) });
    const ler = async (id) => (await (await b.como(id)).query(
      "select sequencia_atual, sequencia_recorde, sequencia_hoje, sequencia_ultimo_dia::text as dia, sequencia_partida from public.meu_progresso")).rows[0];
    const va = await ler(a);
    afirmar(va.sequencia_atual === 1 && va.sequencia_recorde === 1 && va.dia === diaSP(fim) && va.sequencia_partida === partida, `quem acabou de jogar: ${JSON.stringify(va)}`);
    if (diaSP(fim) === diaSP(new Date())) afirmar(va.sequencia_hoje === true, "jogou hoje e a view diz que não");
    const vc = await ler(c);
    afirmar(vc.sequencia_atual === 0 && vc.sequencia_recorde === 3 && vc.sequencia_hoje === false && vc.dia === "2026-03-12",
      `corrida de março vista hoje deveria estar QUEBRADA (0), com recorde 3: ${JSON.stringify(vc)}`);
    afirmar((await sequencia(b.admin, c)).atual === 3, "o retrato guardado é o da corrida (3); quem zera é a leitura efetiva");
    const vd = await ler(d);
    afirmar(vd.sequencia_atual === 0 && vd.sequencia_recorde === 0 && vd.sequencia_hoje === false && vd.dia === null && vd.sequencia_partida === null,
      `nunca jogou online: ${JSON.stringify(vd)}`);
    const cols = (await b.admin.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'meu_progresso' order by ordinal_position")).rows.map((r) => r.column_name);
    afirmar(cols.join(",") === "player_id,xp_total,nivel,xp_no_nivel,xp_do_nivel,sequencia_atual,sequencia_recorde,sequencia_hoje,sequencia_ultimo_dia,sequencia_partida",
      `colunas de meu_progresso: ${cols.join(",")}`);
  } },
  { id: "S14", nome: "sequência gravada = ORÁCULO independente, para todo mundo (60 partidas, 6 jogadores, chegada fora de ordem)", async fn(b) {
    const ids = await b.jogadores(6);
    const s = await b.servidor();
    const rnd = mulberry32(0x6a);
    for (let k = 0; k < 60; k++) {
      const mesa = [...ids];
      for (let i = mesa.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [mesa[i], mesa[j]] = [mesa[j], mesa[i]]; }
      const n = 2 + Math.floor(rnd() * 3);
      const dia = 1 + Math.floor(rnd() * 24), hora = Math.floor(rnd() * 24), minuto = Math.floor(rnd() * 50);
      const fim = new Date(Date.UTC(2026, 2, dia, hora + 3, minuto)); // hora de SP = UTC−3; 21h–23h já é o dia seguinte em UTC
      await creditar(s, { iniciada: new Date(fim.getTime() - 8 * 60_000), terminada: fim,
        humanos: mesa.slice(0, n).map((id, i) => ({ id, posicao: i + 1, participou: rnd() < 0.85 })) });
    }
    const ev = (await b.admin.query(
      "select e.id::text as id, e.player_id, e.partida_id, e.xp_delta, q.terminada_em from public.xp_eventos e join king_private.partidas q on q.id = e.partida_id")).rows;
    let buracos = 0, maior = 0, zeros = 0;
    for (const id of ids) {
      const meus = ev.filter((e) => e.player_id === id).map((e) => ({ id: Number(e.id), partida: e.partida_id, dia: diaSP(e.terminada_em), xp: e.xp_delta }));
      const esperado = oraculo(meus);
      const real = await sequencia(b.admin, id);
      afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${id.slice(0, 8)}: gravado ${JSON.stringify(real)} ≠ oráculo ${JSON.stringify(esperado)}`);
      if (esperado.atual < esperado.recorde) buracos++;
      maior = Math.max(maior, esperado.recorde);
      zeros += meus.filter((e) => e.xp === 0).length;
    }
    // o instrumento: o sorteio precisa ter produzido os casos que importam
    afirmar(buracos > 0 && maior >= 3 && zeros > 0, `sorteio pobre demais: buracos=${buracos} maior=${maior} zeros=${zeros}`);
  } },
  { id: "S15", nome: "segurança — ninguém escreve a sequência; funções com search_path vazio, dono dedicado e EXECUTE mínimo", async fn(b) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    await creditar(s, { ...terminandoEm("2026-03-10T15:00:00-03:00"), humanos: dupla(a, x) });
    const c = await b.como(a);
    try { await c.query("update public.progresso set sequencia_atual = 99, sequencia_recorde = 99 where player_id = $1", [a]); } catch { /* recusado: ótimo */ }
    afirmar((await sequencia(b.admin, a)).atual === 1, "o jogador alterou a própria sequência");
    await reprova(c.query("select * from king_private.sequencia_de($1)", [a]), /permission denied/, "o jogador chamou o cálculo do ledger");
    await reprova(s.query("select * from king_private.sequencia_de($1)", [a]), /permission denied/, "king_server chamou o cálculo do ledger");
    await reprova(s.query("update public.progresso set sequencia_atual = 9"), /permission denied/, "king_server escreveu a sequência direto");
    const funcs = ["public.dia_de_sao_paulo(timestamptz)", "public.sequencia_efetiva(integer, date, timestamptz)",
      "public.sequencia_qualificada_hoje(date, timestamptz)", "king_private.sequencia_de(uuid)", "king_private.sequencia_apos_lancamento()"];
    for (const f of funcs) {
      const { rows: [r] } = await b.admin.query(
        "select pg_get_userbyid(p.proowner) as dono, p.prosecdef, p.proconfig, p.proacl is not null as acl_explicita, " +
        "exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0) as publico, " +
        "has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('king_server', p.oid, 'execute') as servidor, " +
        "has_function_privilege('authenticated', p.oid, 'execute') as autenticado " +
        "from pg_proc p where p.oid = $1::regprocedure", [f]);
      afirmar(r.dono === "king_progress_owner", `${f}: dono ${r.dono}`);
      afirmar(r.prosecdef === false, `${f}: SECURITY DEFINER sem necessidade`);
      afirmar(JSON.stringify(r.proconfig) === JSON.stringify(['search_path=""']), `${f}: search_path ${JSON.stringify(r.proconfig)}`);
      afirmar(r.acl_explicita && !r.publico && !r.anon && !r.servidor, `${f}: EXECUTE aberto demais ${JSON.stringify(r)}`);
      afirmar(r.autenticado === f.startsWith("public."), `${f}: authenticated ${r.autenticado ? "PODE" : "não pode"} executar`);
    }
    const t = await b.admin.query("select tgenabled from pg_trigger where tgname = 'xp_eventos_sequencia' and tgrelid = 'public.xp_eventos'::regclass");
    afirmar(t.rows.length === 1 && t.rows[0].tgenabled === "O", "o gatilho da sequência não está ativo");
    const cred = await b.admin.query("select has_function_privilege('king_server', 'king_private.creditar_partida(uuid, timestamptz, timestamptz, smallint, smallint, jsonb)', 'execute') as ok");
    afirmar(cred.rows[0].ok, "a migração tirou do servidor a única porta que ele tinha");
    // o MARCO do rollout: privado, com RLS, do dono dedicado, sem acesso para ninguém da API
    const { rows: [mk] } = await b.admin.query(
      "select pg_get_userbyid(c.relowner) as dono, c.relrowsecurity as rls, " +
      "(select bool_or(has_table_privilege(r, 'king_private.sequencia_inicio', p)) from unnest(array['anon','authenticated','service_role','king_server']) as r, " +
      "unnest(array['SELECT','INSERT','UPDATE','DELETE']) as p) as alguem " +
      "from pg_class c where c.oid = 'king_private.sequencia_inicio'::regclass");
    afirmar(mk.dono === "king_progress_owner" && mk.rls === true && mk.alguem === false, `marco do rollout exposto: ${JSON.stringify(mk)}`);
    for (const f of funcs) {
      const r = await b.admin.query("select has_function_privilege('service_role', $1::regprocedure, 'execute') as ok", [f]);
      afirmar(!r.rows[0].ok, `service_role executa ${f}`);
    }
  } },
  // ═══════════════ SEM BACKFILL HISTÓRICO (correção final da 6A) ═══════════════
  // S16/S17 aplicam a migração DE VERDADE — relógio real, marco real — sobre o banco de Production
  // de hoje, que já tem XP. Nada anterior ao rollout pode virar sequência.

  { id: "S16", semSequencia: true, nome: "SEM BACKFILL — sobre banco COM XP histórico: todos zerados; o 1º crédito depois dá 1; nada pré-rollout entra", async fn(b, ctx) {
    const [a, x, y, z, w, v, u] = await b.jogadores(7);
    const s = await b.servidor();
    // A. O HISTÓRICO, antes da migração: A e X jogaram nos 3 dias anteriores e hoje mais cedo. Se o
    //    histórico entrasse, o 1º crédito de depois daria 4 ou 5 — nunca 1.
    const hoje = diaSP(new Date());
    for (const k of [3, 2, 1]) await creditar(s, { ...terminandoEm(`${diaMenos(hoje, k)}T12:00:00-03:00`), humanos: dupla(a, x) });
    const cedo = new Date(Date.now() - 2 * 3_600_000);
    await creditar(s, { iniciada: new Date(cedo.getTime() - 10 * 60_000), terminada: cedo, humanos: dupla(a, x) });
    // Z e W: XP lançado ANTES da migração, de partida com início E fim marcados à frente (relógio do
    //    servidor adiantado; o crédito aceita fim até 5 min no futuro). Só o id do marco a barra.
    const adiantada = { iniciada: new Date(Date.now() + 60_000), terminada: new Date(Date.now() + 4 * 60_000) };
    await creditar(s, { ...adiantada, humanos: dupla(z, w) });
    const antes = await resumoDoLedger(b.admin);
    const xpAntes = { a: await total(b.admin, a), z: await total(b.admin, z) };

    // B. a migração, como o Tito a aplicaria
    await b.admin.query(ctx.sequencia);

    // C. todo mundo zerado — retrato e leitura. É AQUI que um backfill tem de ser pego.
    afirmar(await naoZerados(b.admin) === 0, "a migração preencheu sequência a partir do histórico");
    for (const id of [a, x, z, w]) {
      const q = await sequencia(b.admin, id);
      afirmar(JSON.stringify(q) === ZERADO, `${id.slice(0, 8)} depois da migração: ${JSON.stringify(q)}`);
    }
    const m = await marco(b.admin);
    afirmar(m && m.inicio instanceof Date && m.ultimo === antes.ultimo, `marco ${JSON.stringify(m)}; o ledger terminava no lançamento ${antes.ultimo}`);
    const va = (await (await b.como(a)).query(
      "select sequencia_atual, sequencia_recorde, sequencia_hoje, sequencia_ultimo_dia, sequencia_partida from public.meu_progresso")).rows[0];
    afirmar(va.sequencia_atual === 0 && va.sequencia_recorde === 0 && va.sequencia_hoje === false && va.sequencia_ultimo_dia === null && va.sequencia_partida === null,
      `meu_progresso de A depois da migração: ${JSON.stringify(va)}`);
    const depois = await resumoDoLedger(b.admin);
    afirmar(depois.n === antes.n && depois.soma === antes.soma && await total(b.admin, a) === xpAntes.a, "a migração mexeu no XP ou no ledger");

    // D/E. o PRIMEIRO crédito elegível depois da migração (partida iniciada depois do marco)
    const fim = new Date(m.inicio.getTime() + 61_000);
    const { partida } = await creditar(s, { iniciada: new Date(m.inicio.getTime() + 1_000), terminada: fim, humanos: dupla(a, y) });
    const qa = await sequencia(b.admin, a);
    afirmar(qa.atual === 1 && qa.recorde === 1 && qa.dia === diaSP(fim) && qa.partida === partida,
      `1º crédito pós-migração de quem tinha 4 dias de histórico: ${JSON.stringify(qa)}`);
    afirmar((await sequencia(b.admin, y)).atual === 1, "quem nunca tinha jogado também começa em 1");

    // F. o histórico não participa — nem do recálculo, nem de quem só tem histórico
    const rec = (await b.admin.query("select atual, recorde from king_private.sequencia_de($1)", [a])).rows[0];
    afirmar(rec.atual === 1 && rec.recorde === 1, `o recálculo do ledger enxergou o histórico: ${JSON.stringify(rec)}`);
    afirmar(JSON.stringify(await sequencia(b.admin, x)) === ZERADO, "X só tem histórico e ganhou sequência");

    // crédito ATRASADO (outbox) de partida que terminou ANTES do marco: o XP entra; a sequência, não.
    // E o recálculo que ele dispara também não pode aproveitar o lançamento de Z feito antes do marco.
    const atrasada = new Date(m.inicio.getTime() - 30 * 60_000);
    const { linhas } = await creditar(s, { iniciada: new Date(atrasada.getTime() - 10 * 60_000), terminada: atrasada, humanos: dupla(z, w) });
    afirmar(xpDe(linhas, z) === 150 && await total(b.admin, z) === xpAntes.z + 150, "o XP do crédito atrasado deveria entrar normalmente");
    // partida que ATRAVESSOU o rollout (começou antes, terminou depois): partida anterior, não conta
    const atravessou = await creditar(s, { iniciada: new Date(m.inicio.getTime() - 5 * 60_000), terminada: new Date(m.inicio.getTime() + 20_000), humanos: dupla(v, u) });
    afirmar(xpDe(atravessou.linhas, v) === 150, "o XP da partida que atravessou o rollout deveria entrar normalmente");
    for (const id of [z, w, v, u]) {
      const q = await sequencia(b.admin, id);
      afirmar(JSON.stringify(q) === ZERADO, `XP ou partida anterior ao rollout contou para ${id.slice(0, 8)}: ${JSON.stringify(q)}`);
    }
  } },
  { id: "S17", semSequencia: true, nome: "rollback remove só a sequência (XP e ledger intactos) e REAPLICAR não reconstrói nada", async fn(b, ctx) {
    const [a, x] = await b.jogadores(2);
    const s = await b.servidor();
    const hoje = diaSP(new Date());
    for (const k of [2, 1]) await creditar(s, { ...terminandoEm(`${diaMenos(hoje, k)}T12:00:00-03:00`), humanos: dupla(a, x) });
    await b.admin.query(ctx.sequencia);
    afirmar(await naoZerados(b.admin) === 0, "a 1ª aplicação preencheu sequência a partir do histórico");
    const m1 = await marco(b.admin);
    afirmar(m1 && m1.inicio instanceof Date, `marco da 1ª aplicação: ${JSON.stringify(m1)}`);
    await creditar(s, { iniciada: new Date(m1.inicio.getTime() + 1_000), terminada: new Date(m1.inicio.getTime() + 31_000), humanos: dupla(a, x) });
    afirmar((await sequencia(b.admin, a)).atual === 1, "o 1º crédito depois da 1ª aplicação deveria dar 1");
    const ledger1 = await resumoDoLedger(b.admin);
    const xp1 = await total(b.admin, a);

    // G. rollback
    await b.admin.query(ROLLBACK_SEQUENCIA);
    const cols = async (tabela) => (await b.admin.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [tabela])).rows.map((r) => r.column_name).join(",");
    afirmar(await cols("meu_progresso") === "player_id,xp_total,nivel,xp_no_nivel,xp_do_nivel", `view depois do rollback: ${await cols("meu_progresso")}`);
    afirmar(await cols("progresso") === "player_id,xp_total,atualizado_em", `progresso depois do rollback: ${await cols("progresso")}`);
    const sobras = await b.admin.query(
      "select (select count(*)::int from pg_trigger where tgname = 'xp_eventos_sequencia')" +
      " + (select count(*)::int from pg_proc where proname in ('dia_de_sao_paulo','sequencia_efetiva','sequencia_qualificada_hoje','sequencia_de','sequencia_apos_lancamento'))" +
      " + (select count(*)::int from pg_class where oid = to_regclass('king_private.sequencia_inicio')) as n");
    afirmar(sobras.rows[0].n === 0, "o rollback deixou gatilho, função ou marco para trás");
    const ledgerR = await resumoDoLedger(b.admin);
    afirmar(JSON.stringify(ledgerR) === JSON.stringify(ledger1) && await total(b.admin, a) === xp1, "o rollback mexeu no XP ou no ledger");
    // com a sequência fora do ar, o crédito e a leitura seguem como antes dela
    const f2 = new Date(Date.now() + 2 * 60_000);
    await creditar(s, { iniciada: new Date(f2.getTime() - 30_000), terminada: f2, humanos: dupla(a, x) });
    const mp = (await (await b.como(a)).query("select * from public.meu_progresso")).rows[0];
    afirmar(mp.xp_total === xp1 + 150 && Object.keys(mp).length === 5, `crédito e leitura sem a sequência: ${JSON.stringify(mp)}`);

    // H. reaplicar
    await b.admin.query(ctx.sequencia);
    // I. sem reconstrução: nem o histórico, nem o que contou na 1ª aplicação, nem o crédito durante o rollback
    afirmar(await naoZerados(b.admin) === 0, "reaplicar reconstruiu sequência a partir do ledger");
    for (const id of [a, x]) afirmar(JSON.stringify(await sequencia(b.admin, id)) === ZERADO, "reaplicar devolveu sequência antiga");
    const m2 = await marco(b.admin);
    afirmar(m2.inicio > m1.inicio && m2.ultimo > m1.ultimo, `o marco não foi renovado: ${JSON.stringify({ m1, m2 })}`);
    // e o fluxo normal recomeça do 1
    const f3 = new Date(m2.inicio.getTime() + 4 * 60_000);
    await creditar(s, { iniciada: new Date(f3.getTime() - 30_000), terminada: f3, humanos: dupla(a, x) });
    const q = await sequencia(b.admin, a);
    afirmar(q.atual === 1 && q.recorde === 1, `1º crédito depois da reaplicação: ${JSON.stringify(q)}`);
    const div = await b.admin.query(
      "select count(*)::int n from public.progresso g where g.xp_total <> (select coalesce(sum(e.xp_delta), 0) from public.xp_eventos e where e.player_id = g.player_id)");
    afirmar(div.rows[0].n === 0, "XP total divergiu do ledger depois do ciclo migração → rollback → migração");
  } },

  // ═══════════════ QUEM ESCREVE NO LEDGER (a sequência nasce dele) ═══════════════

  { id: "S18", nome: "escritores do ledger: só creditar_partida lança XP — no catálogo e em TODAS as migrações do repositório", async fn(b) {
    // 1. escrita direta no ledger: ninguém da API, nem service_role, nem o servidor da partida
    for (const papel of ["anon", "authenticated", "service_role", "king_server"]) {
      for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
        const r = await b.admin.query("select has_table_privilege($1, 'public.xp_eventos', $2) as ok", [papel, priv]);
        afirmar(!r.rows[0].ok, `${papel} tem ${priv} em xp_eventos`);
      }
    }
    // 2. função que INSERE no ledger: uma só, a do crédito
    const escritoras = (await b.admin.query(
      "select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
      "where n.nspname not in ('pg_catalog', 'information_schema') and p.prosrc ~* $1 order by 1", ["insert\\s+into\\s+(public\\.)?xp_eventos\\M"])).rows.map((r) => r.f);
    afirmar(escritoras.join(",") === "king_private.creditar_partida", `funções que escrevem no ledger: ${escritoras.join(", ")}`);
    // 3. SECURITY DEFINER: lista FECHADA e justificada. Uma nova derruba o teste e obriga revisão.
    //    creditar_partida — a porta do crédito; criar_player — gatilho da identidade, só cria o perfil.
    const definidoras = (await b.admin.query(
      "select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
      "where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema') order by 1")).rows.map((r) => r.f);
    afirmar(definidoras.join(",") === "king_private.creditar_partida,public.criar_player", `funções SECURITY DEFINER: ${definidoras.join(", ")}`);
    // 4. quem executa o crédito: só king_server
    for (const [papel, pode] of [["anon", false], ["authenticated", false], ["service_role", false], ["king_server", true]]) {
      const r = await b.admin.query("select has_function_privilege($1, 'king_private.creditar_partida(uuid, timestamptz, timestamptz, smallint, smallint, jsonb)', 'execute') as ok", [papel]);
      afirmar(r.rows[0].ok === pode, `${papel} ${pode ? "não executa" : "executa"} creditar_partida`);
    }
    // 5. o ledger só aceita o motivo de partida
    const motivo = (await b.admin.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'xp_eventos_motivo'")).rows[0].d;
    afirmar(/'partida_concluida'/.test(motivo) && (motivo.match(/'[^']+'/g) ?? []).length === 1, `motivos aceitos no ledger: ${motivo}`);
    // 6. ESTÁTICO: todas as migrações do repositório, inclusive as que ainda vão ser escritas.
    //    Um escritor novo, um GRANT de escrita ou um motivo novo derruba ESTE teste — e obriga a
    //    revisar o discriminador da sequência (ver S19) antes de seguir.
    const dirMig = new URL("supabase/migrations/", RAIZ);
    const arquivos = readdirSync(dirMig).filter((n) => n.endsWith(".sql")).sort();
    const insercoes = [], grants = [], motivos = [];
    for (const n of arquivos) {
      const t = readFileSync(new URL(n, dirMig), "utf8").replace(/--[^\n]*/g, "");
      for (const _ of t.matchAll(/insert\s+into\s+(public\.)?xp_eventos\b/gi)) insercoes.push(n);
      if (/grant\s+[^;]*\b(insert|update|delete|truncate|all)\b[^;]*\bon\s+(table\s+)?public\.xp_eventos\b/i.test(t)) grants.push(n);
      for (const _ of t.matchAll(/xp_eventos_motivo/gi)) motivos.push(n);
    }
    afirmar(insercoes.join() === "20260925120000_progresso.sql", `INSERT no ledger nas migrações: ${insercoes.join(", ")}`);
    afirmar(grants.length === 0, `GRANT de escrita no ledger em: ${grants.join(", ")}`);
    afirmar(motivos.join() === "20260925120000_progresso.sql", `o conjunto de motivos do ledger mudou em: ${motivos.join(", ")}`);
  } },
  { id: "S19", nome: "origem: XP que não é de partida online (bônus futuro, partida solo de um escritor futuro) não qualifica dia", async fn(b) {
    const [a, x, w] = await b.jogadores(3);
    const s = await b.servidor();
    // A já tem linha de progresso (abandono, 0 XP): o gatilho tem onde gravar se errar
    await creditar(s, { ...terminandoEm("2026-03-09T15:00:00-03:00"), humanos: [{ id: a, posicao: 1, participou: false }, { id: x, posicao: 2 }] });
    const { partida } = await creditar(s, { ...terminandoEm("2026-03-10T15:00:00-03:00"), humanos: dupla(x, w) });
    const confere = async (quando) => {
      const q = await sequencia(b.admin, a);
      const r = (await b.admin.query("select atual, recorde from king_private.sequencia_de($1)", [a])).rows[0];
      afirmar(JSON.stringify(q) === ZERADO && r.atual === 0 && r.recorde === 0, `${quando}: ${JSON.stringify({ q, r })}`);
    };
    // (a) uma ORIGEM NOVA de XP, como uma migração futura poderia criar
    await b.admin.query("alter table public.xp_eventos drop constraint xp_eventos_motivo, " +
      "add constraint xp_eventos_motivo check (motivo in ('partida_concluida', 'bonus_futuro'))");
    await b.admin.query("insert into public.xp_eventos (player_id, partida_id, motivo, posicao, xp_delta) values ($1, $2, 'bonus_futuro', 1, 50)", [a, partida]);
    await confere("um bônus que não é partida qualificou o dia");
    // (b) uma partida SOLO gravada por um escritor futuro (a composição do banco relaxada à força)
    await b.admin.query("alter table king_private.partidas drop constraint partidas_composicao");
    const solo = randomUUID();
    await b.admin.query("insert into king_private.partidas (id, iniciada_em, terminada_em, humanos, bots, versao_regra) " +
      "values ($1, '2026-03-11T14:50:00-03:00', '2026-03-11T15:00:00-03:00', 1, 3, 1)", [solo]);
    await b.admin.query("insert into public.xp_eventos (player_id, partida_id, motivo, posicao, xp_delta) values ($1, $2, 'partida_concluida', 1, 150)", [a, solo]);
    await confere("uma partida solo qualificou o dia");
    // controle: partida online de verdade continua contando — e só ela
    await creditar(s, { ...terminandoEm("2026-03-12T15:00:00-03:00"), humanos: dupla(a, x) });
    const q = await sequencia(b.admin, a);
    afirmar(q.atual === 1 && q.recorde === 1 && q.dia === "2026-03-12", `a partida online depois das origens falsas: ${JSON.stringify(q)}`);
  } },
];

// ─────────────────────────── execução ───────────────────────────

async function rodar(testes, modelos, { esperaReprovar = false } = {}) {
  const resultados = [];
  for (const t of testes) {
    const b = await bancoDeTeste(t.semSequencia ? modelos.semSequencia : t.janela ? modelos.janela : modelos.plano);
    let erro = null;
    try { await t.fn(b, { sequencia: modelos.textoSequencia }); } catch (e) { erro = e; } finally { await b.fechar(); }
    resultados.push({ t, erro });
    const marca = esperaReprovar ? (erro ? "🔴 RED" : "⚠️  PASSOU") : (erro ? "✗" : "✓");
    console.log(`   ${marca} ${t.id} ${t.nome}${erro ? `\n        → ${String(erro.message).split("\n")[0]}` : ""}`);
  }
  return resultados;
}

const PROVAS = process.argv.includes("--provas");
const dir = mkdtempSync(join(tmpdir(), "king-progresso-sql-"));
let banco = null;
let falhou = false;
try {
  PORTA = await portaLivre();
  banco = new EmbeddedPostgres({
    databaseDir: join(dir, "data"), port: PORTA, user: "postgres", password: SENHA_ADMIN,
    persistent: false, onLog: () => {}, onError: () => {},
    // SCRAM como no Supabase: todo login aqui é a troca SCRAM completa (o T22 depende disso).
    authMethod: "scram-sha-256",
    // UTF-8 como no Supabase. Sem isto, no Windows o cluster nasce em WIN1252 e recusa os
    // comentários da própria migração.
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
  });
  await banco.initialise();
  await banco.start();
  const v = await conectar("postgres");
  const versao = (await v.query("select current_setting('server_version') v")).rows[0].v;
  await v.end();
  console.log(`\nPROGRESSO — testes SQL em Postgres ${versao} descartável (porta ${PORTA})\n`);

  // Modelos: as migrações ORIGINAIS, a mesma com a janela de corrida alargada, e o banco como está
  // em Production hoje (sem a sequência), onde a migração da sequência é aplicada pelo próprio teste.
  await criarModelo("modelo_plano", PROGRESSO, SEQUENCIA);
  await criarModelo("modelo_janela", comJanela(PROGRESSO), SEQUENCIA);
  await criarModelo("modelo_sem_sequencia", PROGRESSO, null);
  // O LOGIN do servidor existe SÓ neste banco descartável, com senha aleatória desta execução.
  const adm = await conectar("postgres");
  await adm.query(`alter role king_server login password '${SENHA_SERVIDOR}'`);
  await adm.end();

  if (PROVAS) {
    console.log("RED — cada proteção removida em memória; os testes que dependem dela PRECISAM reprovar\n");
    for (const [nome, m] of Object.entries(MUTACOES)) {
      const mutado = mutar(PROGRESSO, m.trocas ?? []);
      const mutadoSeq = mutar(SEQUENCIA, m.trocasSeq ?? []);
      const sufixo = nome.replace(/-/g, "_");
      await criarModelo(`modelo_plano_${sufixo}`, mutado, mutadoSeq);
      await criarModelo(`modelo_janela_${sufixo}`, comJanela(mutado), mutadoSeq);
      console.log(`  mutação: ${nome}`);
      const alvos = TESTES.filter((t) => m.alvos.includes(t.id));
      if (alvos.length !== m.alvos.length) throw new Error(`mutação ${nome}: alvo inexistente em ${m.alvos.join(",")}`);
      const r = await rodar(alvos, { plano: `modelo_plano_${sufixo}`, janela: `modelo_janela_${sufixo}`,
        semSequencia: "modelo_sem_sequencia", textoSequencia: mutadoSeq }, { esperaReprovar: true });
      const passaram = r.filter((x) => !x.erro).map((x) => x.t.id);
      if (passaram.length) { falhou = true; console.log(`   ✗ MUTAÇÃO NÃO DETECTADA por: ${passaram.join(", ")}`); }
    }
    console.log("");
  }

  console.log("GREEN — migração original\n");
  const r = await rodar(TESTES, { plano: "modelo_plano", janela: "modelo_janela", semSequencia: "modelo_sem_sequencia", textoSequencia: SEQUENCIA });
  const falhas = r.filter((x) => x.erro).length;
  if (falhas) falhou = true;
  console.log(`\n${falhou ? "❌ REPROVADO" : "✅ APROVADO"} — ${r.length - falhas}/${r.length} testes verdes${PROVAS ? `, ${Object.keys(MUTACOES).length} mutações` : ""}`);
} catch (e) {
  falhou = true;
  console.error("\n❌ ERRO DE INFRAESTRUTURA:", e?.message ?? e);
} finally {
  if (banco) await banco.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}
process.exit(falhou ? 1 : 0);
