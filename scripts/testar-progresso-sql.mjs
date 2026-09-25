// TESTES DA MIGRAÇÃO DE PROGRESSO — Postgres REAL, descartável, com conexões independentes.
//
// Sobe um Postgres 17 embutido (`embedded-postgres`, só devDependency) num diretório temporário
// FORA do repositório, aplica o bootstrap que emula o mínimo do Supabase e as migrações reais, e
// roda os testes. Ao terminar, o banco é destruído.
//
// ══ COMO AS CORRIDAS SÃO PROVADAS ══
//
// Corrida que depende de sorte não prova nada. Os testes de concorrência usam uma variante da
// migração em que o marcador `-- [ponto-de-corrida]` — que fica logo DEPOIS da trava por jogador
// — vira `perform pg_sleep(0.4)`. Isso alarga a janela entre "travei" e "olhei o passado" para
// 400 ms, e duas conexões independentes disparam ao mesmo tempo. Com a trava, a segunda espera a
// primeira; sem ela, as duas enxergam o mesmo passado.
//
// ══ RED → GREEN ══
//
// Com `--provas`, cada proteção é removida por uma MUTAÇÃO EM MEMÓRIA do texto da migração — o
// arquivo em disco nunca é tocado — e os testes que dependem dela precisam REPROVAR. Depois, a
// migração original precisa passar em tudo.
//
// USO:
//   node scripts/testar-progresso-sql.mjs            # suíte GREEN
//   node scripts/testar-progresso-sql.mjs --provas   # mutações (RED) + suíte GREEN
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
const IDENTIDADE = ler("supabase/migrations/20260830120000_identidade.sql");
const PROGRESSO = ler("supabase/migrations/20260925120000_progresso.sql");

const MARCADOR = "  -- [ponto-de-corrida]";
const JANELA_MS = 400;
const LIMIAR_SERIAL_MS = 700; // duas janelas de 400 ms em série passam disto; em paralelo, não

/** Cada mutação remove UMA proteção. `alvos` são os testes que precisam reprovar sem ela. */
const MUTACOES = {
  "sem-trava": {
    trocas: [["  perform 1 from public.progresso as g where g.player_id = any (v_ids) order by g.player_id for update;\n", ""]],
    alvos: ["T4", "T6", "T9"],
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
};

function mutar(texto, trocas) {
  let t = texto;
  for (const [de, para] of trocas) {
    const n = t.split(de).length - 1;
    if (n !== 1) throw new Error(`âncora de mutação encontrada ${n}x: ${de.slice(0, 70)}`);
    t = t.replace(de, para);
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

async function criarModelo(nome, textoProgresso) {
  const adm = await conectar("postgres");
  await adm.query(`create database ${nome}`);
  await adm.end();
  const c = await conectar(nome);
  try {
    await c.query(BOOTSTRAP);
    await c.query(IDENTIDADE);
    await c.query(textoProgresso);
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

function afirmar(cond, msg) { if (!cond) throw new Error(msg); }
async function reprova(promessa, padrao, msg) {
  try { await promessa; } catch (e) {
    if (padrao && !padrao.test(String(e.message))) throw new Error(`${msg} — falhou pelo motivo errado: ${e.message}`);
    return;
  }
  throw new Error(msg);
}
async function cronometrar(fn) { const t0 = performance.now(); const r = await fn(); return { r, ms: performance.now() - t0 }; }

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
  { id: "T4", janela: true, nome: "partidas DIFERENTES com o mesmo jogador serializam (jogador que JÁ tem progresso)", async fn(b) {
    const [a, x, y, w] = await b.jogadores(4);
    const [s0, s1, s2] = [await b.servidor(), await b.servidor(), await b.servidor()];
    // O CASO DIFÍCIL: A já tem linha em `progresso`. No primeiro crédito de um jogador, o
    // INSERT ... ON CONFLICT da segunda transação espera a linha ainda não confirmada da primeira
    // — uma serialização ACIDENTAL que esconde a falta da trava. Com a linha já existente, só a
    // trava explícita serializa.
    await creditar(s0, { ...janelaDaPartida(9), humanos: [{ id: a, posicao: 4 }, { id: w, posicao: 1 }] });
    const { ms } = await cronometrar(() => Promise.all([
      creditar(s1, { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }] }),
      creditar(s2, { ...janelaDaPartida(1), humanos: [{ id: a, posicao: 2 }, { id: y, posicao: 1 }] }),
    ]));
    afirmar(ms >= LIMIAR_SERIAL_MS, `as duas rodaram em paralelo (${Math.round(ms)} ms) — não houve serialização por jogador`);
    afirmar(await total(b.admin, a) === 380, "progresso de A deveria somar 100 + 150 + 130");
  } },
  { id: "T4b", janela: true, nome: "jogadores DISTINTOS não serializam à toa, e nada se corrompe", async fn(b) {
    const [a, x, y, z] = await b.jogadores(4);
    const [s1, s2] = [await b.servidor(), await b.servidor()];
    const { ms } = await cronometrar(() => Promise.all([
      creditar(s1, { ...janelaDaPartida(0), humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }] }),
      creditar(s2, { ...janelaDaPartida(0), humanos: [{ id: y, posicao: 1 }, { id: z, posicao: 2 }] }),
    ]));
    afirmar(ms < LIMIAR_SERIAL_MS, `jogadores distintos esperaram um pelo outro (${Math.round(ms)} ms)`);
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
  { id: "T6", janela: true, nome: "corrida de sobreposição não premia as duas partidas (jogador que JÁ tem progresso)", async fn(b) {
    const [a, x, y, w] = await b.jogadores(4);
    const [s0, s1, s2] = [await b.servidor(), await b.servidor(), await b.servidor()];
    // Mesmo cuidado do T4: sem progresso prévio, a espera acidental do INSERT mascararia a corrida.
    await creditar(s0, { ...janelaDaPartida(9), humanos: [{ id: a, posicao: 4 }, { id: w, posicao: 1 }] });
    const j = janelaDaPartida(0);
    const meio = { iniciada: new Date(j.iniciada.getTime() + 5 * 60_000), terminada: new Date(j.terminada.getTime() + 5 * 60_000) };
    const [r1, r2] = await Promise.all([
      creditar(s1, { ...j, humanos: [{ id: a, posicao: 1 }, { id: x, posicao: 2 }] }),
      creditar(s2, { ...meio, humanos: [{ id: a, posicao: 1 }, { id: y, posicao: 2 }] }),
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
  { id: "T9", janela: true, nome: "na fronteira 6ª/7ª, duas partidas simultâneas não levam as duas 100%", async fn(b) {
    const [a, ...outros] = await b.jogadores(8);
    const [s0, s1, s2] = [await b.servidor(), await b.servidor(), await b.servidor()];
    for (let k = 0; k < 5; k++) await creditar(s0, { ...janelaDaPartida(k), humanos: [{ id: a, posicao: 1 }, { id: outros[k], posicao: 2 }] });
    const [r1, r2] = await Promise.all([
      creditar(s1, { ...janelaDaPartida(5), humanos: [{ id: a, posicao: 1 }, { id: outros[5], posicao: 2 }] }),
      creditar(s2, { ...janelaDaPartida(6), humanos: [{ id: a, posicao: 1 }, { id: outros[6], posicao: 2 }] }),
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
      primeira.partidaEncerrada(partida);
      await primeira.ocioso();
      afirmar(await total(b.admin, a) === 150 && await total(b.admin, x) === 115, "a primeira vida não creditou (x participou com 18/30 = 60%)");
      afirmar(new OutboxDeProgresso(dirOutbox).pendentes().validas.length === 1, "a pendência deveria ter sobrado no outbox");
      // 2ª vida: boot reprocessa a MESMA partida
      const balanco = await new ServicoDeProgresso(new OutboxDeProgresso(dirOutbox), repo, semEspera).reprocessar();
      afirmar(balanco.entregues === 1 && balanco.pendentes === 0, `reprocessamento: ${JSON.stringify(balanco)}`);
      afirmar(await total(b.admin, a) === 150 && await total(b.admin, x) === 115, "o reprocessamento somou de novo");
      const n = await b.admin.query("select count(*)::int n from public.xp_eventos where partida_id = $1", [partida.partidaId]);
      afirmar(n.rows[0].n === 2, "o ledger duplicou no reprocessamento");
      afirmar(new OutboxDeProgresso(dirOutbox).pendentes().validas.length === 0, "a pendência não saiu do outbox depois de confirmada");
    } finally {
      await repo.encerrar().catch(() => {});
      rmSync(dirOutbox, { recursive: true, force: true });
    }
  } },
];

// ─────────────────────────── execução ───────────────────────────

async function rodar(testes, modelos, { esperaReprovar = false } = {}) {
  const resultados = [];
  for (const t of testes) {
    const b = await bancoDeTeste(t.janela ? modelos.janela : modelos.plano);
    let erro = null;
    try { await t.fn(b); } catch (e) { erro = e; } finally { await b.fechar(); }
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

  // Modelos: a migração ORIGINAL e a mesma com a janela de corrida alargada.
  await criarModelo("modelo_plano", PROGRESSO);
  await criarModelo("modelo_janela", comJanela(PROGRESSO));
  // O LOGIN do servidor existe SÓ neste banco descartável, com senha aleatória desta execução.
  const adm = await conectar("postgres");
  await adm.query(`alter role king_server login password '${SENHA_SERVIDOR}'`);
  await adm.end();

  if (PROVAS) {
    console.log("RED — cada proteção removida em memória; os testes que dependem dela PRECISAM reprovar\n");
    for (const [nome, m] of Object.entries(MUTACOES)) {
      const mutado = mutar(PROGRESSO, m.trocas);
      const sufixo = nome.replace(/-/g, "_");
      await criarModelo(`modelo_plano_${sufixo}`, mutado);
      await criarModelo(`modelo_janela_${sufixo}`, comJanela(mutado));
      console.log(`  mutação: ${nome}`);
      const alvos = TESTES.filter((t) => m.alvos.includes(t.id));
      const r = await rodar(alvos, { plano: `modelo_plano_${sufixo}`, janela: `modelo_janela_${sufixo}` }, { esperaReprovar: true });
      const passaram = r.filter((x) => !x.erro).map((x) => x.t.id);
      if (passaram.length) { falhou = true; console.log(`   ✗ MUTAÇÃO NÃO DETECTADA por: ${passaram.join(", ")}`); }
    }
    console.log("");
  }

  console.log("GREEN — migração original\n");
  const r = await rodar(TESTES, { plano: "modelo_plano", janela: "modelo_janela" });
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
