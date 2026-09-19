// PROVA DOS PORTÕES DE IDENTIDADE — deploy e verificadores em MODO A e MODO B.
//
// Sem VPS, sem Supabase real e sem rede externa: um JWKS servido aqui, tokens assinados aqui, e
// servidores compilados de verdade, isolados (um em permanent, outro em legacy). Cada caso roda o
// script de produção como processo separado e confere código de saída e mensagem.
//
//   A  smoke contaminado pelo ambiente de produção continua isolado em legacy
//   B  verificar-implantacao permanent: aprova o servidor certo (4005/4003); reprova o que aceita sem token
//   L  verificar-implantacao legacy: contrato completo; reprova servidor em MODO B
//   I  contrato completo no artefato isolado, mesmo com o ambiente contaminado
//   D  T4 contra servidor JÁ NO AR (--server-url): prova A..E sem iniciar servidor
//   E  verificar-ultima-mao permanent: sem credenciais FALHA; com duas, entra
//   F  modo efetivo: o declarado tem de ser o registrado no boot; o deploy confere depois do restart
//   K  os códigos do verificador batem com os do protocolo compilado
//
// USO: npm run build:server && node scripts/testar-gates-identidade.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { CHAVES_DE_IDENTIDADE, subirServidorIsolado } from "./lib/servidor-isolado.mjs";

const RAIZ = new URL("../", import.meta.url);
const caminho = (rel) => fileURLToPath(new URL(rel, RAIZ));
const { CODIGO } = await import(new URL("apps/server/dist/protocol/index.js", RAIZ).href);
const BASE = 3100 + Math.floor(Math.random() * 300);

const resultados = [];
function registrar(nome, ok, detalhe = "") {
  resultados.push({ nome, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

/** O ambiente do filho: nenhuma chave de identidade nem credencial herdada da shell. */
function limpo() {
  const e = { ...process.env };
  for (const k of [...CHAVES_DE_IDENTIDADE, "KING_T4_ACCESS_TOKEN", "KING_T4_SERVER_URL", "KING_VERIFICACAO_TOKEN_A",
    "KING_VERIFICACAO_TOKEN_B", "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) delete e[k];
  return e;
}

/** Roda um script como processo separado — ASSÍNCRONO, para o JWKS deste processo continuar respondendo. */
function rodar(script, args = [], { env = {}, entrada, limiteMs = 240_000 } = {}) {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [caminho(`scripts/${script}`), ...args], {
      env: { ...limpo(), ...env }, stdio: ["pipe", "pipe", "pipe"],
    });
    let saida = "";
    filho.stdout.on("data", (d) => { saida += d; });
    filho.stderr.on("data", (d) => { saida += d; });
    const t = setTimeout(() => filho.kill(), limiteMs);
    filho.on("exit", (codigo) => { clearTimeout(t); resolve({ codigo, saida }); });
    if (entrada !== undefined) filho.stdin.end(entrada); else filho.stdin.end();
  });
}

const tmp = mkdtempSync(join(tmpdir(), "king-gates-"));
let perm = null;
let leg = null;
let jwks = null;
try {
  // ── o emissor local ──
  const par = await generateKeyPair("ES256");
  const publica = { ...(await exportJWK(par.publicKey)), kid: "gates", alg: "ES256", use: "sig" };
  const corpo = JSON.stringify({ keys: [publica] });
  jwks = createServer((_q, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(corpo); });
  await new Promise((r) => jwks.listen(0, "127.0.0.1", r));
  const URL_JWKS = `http://127.0.0.1:${jwks.address().port}`;
  const assinar = (sub) => new SignJWT({ sub, is_anonymous: true, role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: publica.kid })
    .setIssuedAt().setIssuer(`${URL_JWKS}/auth/v1`).setAudience("authenticated").setExpirationTime("10m")
    .sign(par.privateKey);
  const tA = await assinar(randomUUID());
  const tB = await assinar(randomUUID());

  // ── os dois servidores de verdade ──
  perm = await subirServidorIsolado({ porta: BASE, modo: "permanent", supabaseUrl: URL_JWKS });
  leg = await subirServidorIsolado({ porta: BASE + 1, modo: "legacy" });
  if (!perm.isolado || !leg.isolado) throw new Error("os servidores de teste não subiram isolados");
  console.log(`\nPORTÕES DE IDENTIDADE — permanent em ${perm.url}, legacy em ${leg.url}\n`);

  // Um ambiente "de produção em permanent" que NÃO pode vazar para o smoke nem para o contrato isolado.
  const contaminado = join(tmp, "producao.env");
  writeFileSync(contaminado, `KING_IDENTITY_MODE=permanent\nSUPABASE_URL=${URL_JWKS}\n`);
  const ambienteDeProducao = { KING_ENV_FILE: contaminado, KING_IDENTITY_MODE: "permanent", SUPABASE_URL: URL_JWKS, pm_id: "0" };

  // A
  const a = await rodar("smoke-server.mjs", [], { env: { ...ambienteDeProducao, SMOKE_PORT: String(BASE + 2) } });
  registrar("A. smoke com ambiente de produção permanent continua isolado em legacy e aprova o artefato",
    a.codigo === 0 && a.saida.includes("artefato isolado: identity mode legacy"), `saída ${a.codigo}`);

  // B
  const b1 = await rodar("verificar-implantacao.mjs", [perm.url, "--modo=permanent"]);
  registrar("B1. verificar-implantacao permanent aprova o servidor em MODO B (4005 e 4003 exatos)",
    b1.codigo === 0 && b1.saida.includes(`sem token: recusado com ${CODIGO.CREDENCIAL_AUSENTE}`)
      && b1.saida.includes(`token inválido: recusado com ${CODIGO.IDENTIDADE_RECUSADA}`)
      && b1.saida.includes("processo continua vivo"), `saída ${b1.codigo}`);
  const b2 = await rodar("verificar-implantacao.mjs", [leg.url, "--modo=permanent"]);
  registrar("B2. verificar-implantacao permanent REPROVA servidor que aceita entrada sem token",
    b2.codigo === 1 && b2.saida.includes("SEM token foi ACEITA"), `saída ${b2.codigo}`);

  // L
  const l1 = await rodar("verificar-implantacao.mjs", [leg.url, "--modo=legacy"]);
  registrar("L1. verificar-implantacao legacy: contrato completo aprovado no servidor legacy",
    l1.codigo === 0 && l1.saida.includes("partida iniciada") && l1.saida.includes("IMPLANTAÇÃO APROVADA"), `saída ${l1.codigo}`);
  const l2 = await rodar("verificar-implantacao.mjs", [perm.url]);
  registrar("L2. verificar-implantacao legacy REPROVA servidor em MODO B (não deduz o modo)",
    l2.codigo === 1, `saída ${l2.codigo}`);

  // I
  const i1 = await rodar("verificar-artefato-isolado.mjs", [String(BASE + 3)], { env: ambienteDeProducao });
  registrar("I. contrato completo no artefato novo isolado, com o ambiente de produção permanent por perto",
    i1.codigo === 0 && i1.saida.includes("isolado em legacy") && i1.saida.includes("IMPLANTAÇÃO APROVADA"), `saída ${i1.codigo}`);

  // D
  const d1 = await rodar("verificar-modo-b-real.mjs", [`--server-url=${perm.url}`, "--fonte=env"], {
    env: { KING_T4_ACCESS_TOKEN: tA, SUPABASE_URL: URL_JWKS },
  });
  registrar("D1. T4 contra servidor já no ar: A..E aprovados sem iniciar servidor",
    d1.codigo === 0 && d1.saida.includes("5/5") && d1.saida.includes("nenhum servidor é iniciado")
      && !d1.saida.includes(tA) && !d1.saida.includes(tA.split(".")[2]), `saída ${d1.codigo}`);
  const d2 = await rodar("verificar-modo-b-real.mjs", [`--server-url=${perm.url}`, "--fonte=local"]);
  registrar("D2. T4 recusa --fonte=local contra servidor remoto (não finge prova)", d2.codigo === 2, `saída ${d2.codigo}`);

  // E
  const e1 = await rodar("verificar-ultima-mao.mjs", [perm.url, "1", "--modo=permanent"]);
  registrar("E1. verificar-ultima-mao permanent SEM credenciais falha explicitamente",
    e1.codigo === 1 && e1.saida.includes("credenciais de verificação necessárias"), `saída ${e1.codigo}`);
  const e2 = await rodar("verificar-ultima-mao.mjs", [perm.url, "1", "--modo=permanent"], {
    env: { KING_VERIFICACAO_TOKEN_A: tA, KING_VERIFICACAO_TOKEN_B: tA },
  });
  registrar("E2. verificar-ultima-mao permanent com a MESMA pessoa duas vezes falha",
    e2.codigo === 1 && e2.saida.includes("pessoas diferentes"), `saída ${e2.codigo}`);
  const e3 = await rodar("verificar-ultima-mao.mjs", [perm.url, "0.1", "--modo=permanent"], {
    env: { KING_VERIFICACAO_TOKEN_A: tA, KING_VERIFICACAO_TOKEN_B: tB },
  });
  registrar("E3. verificar-ultima-mao permanent com duas credenciais: os dois humanos entram",
    e3.saida.includes("segundo humano no assento") && !e3.saida.includes(tA) && !e3.saida.includes(tB),
    `saída ${e3.codigo} (orçamento curto: inconclusivo é esperado depois de entrar)`);
  const e4 = await rodar("verificar-ultima-mao.mjs", [leg.url, "0.1"]);
  registrar("E4. verificar-ultima-mao legacy continua entrando sem credencial",
    e4.saida.includes("segundo humano no assento"), `saída ${e4.codigo}`);

  // F
  const f = async (modo, log) => (await rodar("conferir-modo-efetivo.mjs", [modo], { entrada: log })).codigo;
  const [f1, f2, f3, f4, f5] = [
    await f("permanent", "0|king | [king] identity mode: permanent · SUPABASE_URL: configured\n"),
    await f("permanent", "[king] identity mode: permanent\n...\n[king] identity mode: legacy · env file: absent\n"),
    await f("permanent", "nenhuma linha de modo aqui\n"),
    await f("legacy", "[king] identity mode: legacy · SUPABASE_URL: ignored (legacy)\n"),
    await f("banana", "[king] identity mode: legacy\n"),
  ];
  registrar("F1. modo efetivo: aprova o declarado; reprova rebaixamento, ausência e uso inválido",
    f1 === 0 && f2 === 1 && f3 === 1 && f4 === 0 && f5 === 1, `ok=${f1} rebaixado=${f2} ausente=${f3} legacy=${f4} inválido=${f5}`);

  // F4 — O LOG DO PM2 É HISTÓRICO: vale a declaração do BOOT MAIS RECENTE, nunca "qualquer ocorrência".
  const historicoPL = "0|king | [king] identity mode: permanent · SUPABASE_URL: configured\n0|king | ...\n"
    + "0|king | [king] identity mode: legacy · SUPABASE_URL: ignored (legacy)\n";
  const historicoLP = "0|king | [king] identity mode: legacy · SUPABASE_URL: absent\n0|king | ...\n"
    + "0|king | [king] identity mode: permanent · SUPABASE_URL: configured\n";
  const semBoot = "0|king | servidor escutando\n0|king | sala 1234 criada\n";
  const [h1, h2, h3, h4, h5] = [
    await f("permanent", historicoPL), await f("legacy", historicoPL),
    await f("permanent", historicoLP), await f("legacy", historicoLP),
    await f("permanent", semBoot),
  ];
  registrar("F4. modo efetivo = boot MAIS RECENTE do log histórico (e sem boot, reprova)",
    h1 === 1 && h2 === 0 && h3 === 0 && h4 === 1 && h5 === 1,
    `P→L esp.permanent=${h1} (1) · P→L esp.legacy=${h2} (0) · L→P esp.permanent=${h3} (0) · L→P esp.legacy=${h4} (1) · sem boot=${h5} (1)`);

  const deploy = readFileSync(caminho("scripts/deploy-vps.sh"), "utf8");
  const linhas = deploy.split(/\r?\n/);
  const idx = (t) => linhas.findIndex((l) => l.includes(t));
  const reinicio = idx('reiniciar || abortar "o servidor nao voltou online"');
  const efetivo = idx('node scripts/conferir-modo-efetivo.mjs "$MODO"');
  const contrato = idx('node scripts/verificar-implantacao.mjs ws://127.0.0.1:2567 --modo="$MODO"');
  const isolado = idx("node scripts/verificar-artefato-isolado.mjs");
  const escreveArquivo = linhas.filter((l) => l.includes("$ENV_FILE")
    && (/sed\s+-i/.test(l) || /\btee\b/.test(l) || /[^2&]>{1,2}\s*"?\$ENV_FILE/.test(l)));
  registrar("F2. deploy: modo efetivo e contrato do modo conferidos DEPOIS do restart; contrato isolado ANTES",
    reinicio > 0 && efetivo > reinicio && contrato > reinicio && isolado > 0 && isolado < reinicio,
    `restart@${reinicio} efetivo@${efetivo} contrato@${contrato} isolado@${isolado}`);
  registrar("F3. deploy: sem o bloqueio artificial, sem escrever em $ENV_FILE, e com a pendência do T4 explícita",
    !deploy.includes("ainda nao suportado") && escreveArquivo.length === 0
      && deploy.includes("DEPLOY TRANSACIONAL APROVADO") && deploy.includes("T4 REAL POS-DEPLOY AINDA PENDENTE"),
    `linhas que escrevem no arquivo: ${escreveArquivo.length}`);

  // K
  const fonte = readFileSync(caminho("scripts/verificar-implantacao.mjs"), "utf8");
  const k1 = Number(/CREDENCIAL_AUSENTE = (\d+)/.exec(fonte)?.[1]);
  const k2 = Number(/IDENTIDADE_RECUSADA = (\d+)/.exec(fonte)?.[1]);
  registrar("K. os códigos do verificador batem com o protocolo compilado",
    k1 === CODIGO.CREDENCIAL_AUSENTE && k2 === CODIGO.IDENTIDADE_RECUSADA, `${k1}/${k2}`);
} catch (e) {
  registrar("preparação", false, e instanceof Error ? e.message : String(e));
} finally {
  if (perm) await perm.parar();
  if (leg) await leg.parar();
  if (jwks) await new Promise((r) => jwks.close(() => r()));
  rmSync(tmp, { recursive: true, force: true });
}

const falhas = resultados.filter((r) => !r.ok).length;
console.log(`\n${falhas === 0 ? "✅ PORTÕES APROVADOS" : `❌ PORTÕES REPROVADOS (${falhas})`} — ${resultados.length - falhas}/${resultados.length}`);
process.exit(falhas === 0 ? 0 : 1);
