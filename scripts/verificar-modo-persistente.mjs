// PROVA D5 — o processo COMPILADO tira o modo de identidade do arquivo persistente, não da shell.
//
// Sem VPS, sem rede externa e sem Supabase: os arquivos ficam num diretório temporário, o
// servidor sobe em portas locais e a entrada é feita sem token (a recusa do MODO B acontece antes
// de qualquer consulta ao JWKS, então a URL do projeto aqui é fictícia e nunca é chamada).
//
// O que se prova, com processos de verdade:
//   1. shell SEM SUPABASE_URL + arquivo permanent (sob PM2 simulado) → o processo fica em
//      permanent e recusa entrada sem token com 4005;
//   2. shell com legacy/URL velhos + arquivo permanent → o arquivo vence;
//   3. arquivo legacy → sobe e entra sem token (MODO A);
//   4. permanent sem URL → NÃO sobe (78);
//   5. modo inválido → NÃO sobe (78);
//   6. sob PM2 sem arquivo → NÃO sobe (78);
//   7. sem PM2 e sem arquivo (local/CI) → legacy;
//   8. o portão do deploy (`conferir-identidade.mjs`) aprova só o que é coerente.
//
// USO: npm run build:server && node scripts/verificar-modo-persistente.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";

const RAIZ = new URL("../", import.meta.url);
const ENTRADA = fileURLToPath(new URL("apps/server/dist/index.js", RAIZ));
const PORTAO = fileURLToPath(new URL("scripts/conferir-identidade.mjs", RAIZ));
const { PROTOCOL_VERSION, CODIGO } = await import(new URL("apps/server/dist/protocol/index.js", RAIZ).href);

const URL_FICTICIA = "https://kingprovad5aaaaaaaaaaa.supabase.co";
const URL_VELHA = "https://kingprovavelhabbbbbbbbb.supabase.co";
const CHAVES = ["KING_IDENTITY_MODE", "SUPABASE_URL", "SUPABASE_JWT_AUDIENCE", "KING_ENV_FILE", "pm_id"];
const PADRAO = "/etc/king/server.env";

const dir = mkdtempSync(join(tmpdir(), "king-d5-"));
let proximaPorta = 2610 + Math.floor(Math.random() * 200);
const resultados = [];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function registrar(nome, ok, detalhe = "") {
  resultados.push({ nome, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

/** A shell que reinicia o processo: nenhuma chave de identidade, nenhum marcador de PM2. */
function shellLimpa() {
  const e = { ...process.env };
  for (const k of CHAVES) delete e[k];
  return e;
}

function arquivo(nome, texto) {
  const p = join(dir, nome);
  writeFileSync(p, texto);
  return p;
}

/** Sobe o servidor compilado e espera: ou a porta responde, ou o processo morre. */
async function subir(extra) {
  const porta = proximaPorta++;
  const filho = spawn(process.execPath, [ENTRADA], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...shellLimpa(), ...extra, PORT: String(porta) },
  });
  let saida = "";
  let codigo = null;
  let morreu = false;
  filho.stdout.on("data", (d) => { saida += d; });
  filho.stderr.on("data", (d) => { saida += d; });
  filho.on("exit", (c) => { morreu = true; codigo = c; });
  for (let i = 0; i < 100 && !morreu; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}`, { signal: AbortSignal.timeout(500) });
      if (r.status > 0) break;
    } catch { /* subindo */ }
    await dormir(150);
  }
  return {
    porta,
    get saida() { return saida; },
    get morreu() { return morreu; },
    get codigo() { return codigo; },
    async parar() {
      if (!morreu) { filho.kill(); for (let i = 0; i < 30 && !morreu; i++) await dormir(100); }
    },
  };
}

/** Tenta entrar sem token. Devolve o SERVER_WELCOME ou o código da recusa. */
async function entrarSemToken(porta) {
  const client = new Client(`ws://127.0.0.1:${porta}`);
  try {
    const sala = await client.create("king", { protocolVersion: PROTOCOL_VERSION, nick: "prova-d5" });
    const w = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("sem SERVER_WELCOME")), 8000);
      sala.onMessage("SERVER_WELCOME", (m) => { clearTimeout(t); resolve(m); });
      for (const m of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "SERVER_ERROR", "STATE_UPDATE",
        "ACTION_REJECTED", "READY_STATE", "TURN_CLOCK", "AUTO_ACTION", "SOCIAL_MESSAGE"]) sala.onMessage(m, () => {});
    });
    await sala.leave(true).catch(() => {});
    return { entrou: true, boasVindas: w };
  } catch (e) {
    return { entrou: false, codigo: e?.code };
  }
}

const semVazamento = (saida) => !saida.includes("kingprovad5") && !saida.includes("kingprovavelha");

try {
  const permanente = arquivo("permanente.env", `KING_IDENTITY_MODE=permanent\nSUPABASE_URL=${URL_FICTICIA}\n`);
  const legado = arquivo("legado.env", `KING_IDENTITY_MODE=legacy\nSUPABASE_URL=${URL_FICTICIA}\n`);
  const semUrl = arquivo("sem-url.env", "KING_IDENTITY_MODE=permanent\n");
  const invalido = arquivo("invalido.env", `KING_IDENTITY_MODE=banana\nSUPABASE_URL=${URL_FICTICIA}\n`);

  console.log("\nPROVA D5 — modo de identidade vindo do arquivo persistente\n");

  // 1
  {
    const s = await subir({ pm_id: "0", KING_ENV_FILE: permanente });
    const e = s.morreu ? null : await entrarSemToken(s.porta);
    registrar("1. shell sem SUPABASE_URL + arquivo permanent → processo em permanent, sem token = 4005",
      !s.morreu && s.saida.includes("identity mode: permanent") && s.saida.includes("SUPABASE_URL: configured")
        && e && !e.entrou && e.codigo === CODIGO.CREDENCIAL_AUSENTE && semVazamento(s.saida),
      s.morreu ? `processo morreu (${s.codigo})` : `boot: "${(s.saida.match(/identity mode[^\n]*/) ?? ["?"])[0]}"; entrada: ${e.entrou ? "ACEITA (MODO A!)" : `recusada ${e.codigo}`}`);
    await s.parar();
  }
  // 2
  {
    const s = await subir({ pm_id: "0", KING_ENV_FILE: permanente, KING_IDENTITY_MODE: "legacy", SUPABASE_URL: URL_VELHA });
    const e = s.morreu ? null : await entrarSemToken(s.porta);
    registrar("2. shell com legacy e URL velhos + arquivo permanent → o arquivo vence",
      !s.morreu && e && !e.entrou && e.codigo === CODIGO.CREDENCIAL_AUSENTE && semVazamento(s.saida),
      s.morreu ? `processo morreu (${s.codigo})` : `entrada: ${e.entrou ? "ACEITA (a shell venceu!)" : `recusada ${e.codigo}`}`);
    await s.parar();
  }
  // 3
  {
    const s = await subir({ pm_id: "0", KING_ENV_FILE: legado });
    const e = s.morreu ? null : await entrarSemToken(s.porta);
    registrar("3. arquivo legacy → MODO A: entra sem token, identidade efêmera",
      !s.morreu && s.saida.includes("identity mode: legacy") && e?.entrou === true
        && e.boasVindas.you.identidadePermanente === false,
      s.morreu ? `processo morreu (${s.codigo})` : `entrada: ${e.entrou ? "aceita" : `recusada ${e.codigo}`}`);
    await s.parar();
  }
  // 4, 5, 6
  for (const [nome, extra] of [
    ["4. permanent sem SUPABASE_URL → não sobe", { pm_id: "0", KING_ENV_FILE: semUrl }],
    ["5. modo inválido → não sobe", { pm_id: "0", KING_ENV_FILE: invalido }],
    ["6. sob PM2 sem arquivo → não sobe", { pm_id: "0", KING_ENV_FILE: join(dir, "nao-existe.env") }],
  ]) {
    const s = await subir(extra);
    registrar(nome, s.morreu && s.codigo === 78 && s.saida.includes("configuração de identidade inválida") && semVazamento(s.saida),
      s.morreu ? `saiu com ${s.codigo}` : "SUBIU (não devia)");
    await s.parar();
  }
  // 6b — o caminho padrão, sem KING_ENV_FILE: só dá para provar onde /etc/king não existe.
  if (!existsSync(PADRAO)) {
    const s = await subir({ pm_id: "0" });
    registrar("6b. sob PM2, caminho padrão ausente → não sobe", s.morreu && s.codigo === 78,
      s.morreu ? `saiu com ${s.codigo}` : "SUBIU (não devia)");
    await s.parar();
  } else {
    registrar("6b. (pulado: esta máquina tem /etc/king/server.env)", true);
  }
  // 7
  if (!existsSync(PADRAO)) {
    const s = await subir({});
    const e = s.morreu ? null : await entrarSemToken(s.porta);
    registrar("7. sem PM2 e sem arquivo (local/CI) → legacy, como sempre",
      !s.morreu && s.saida.includes("identity mode: legacy") && e?.entrou === true,
      s.morreu ? `processo morreu (${s.codigo})` : `entrada: ${e.entrou ? "aceita" : `recusada ${e.codigo}`}`);
    await s.parar();
  } else {
    registrar("7. (pulado: esta máquina tem /etc/king/server.env)", true);
  }
  // 8 — o portão do deploy
  const portao = (arq) => {
    const r = spawnSync(process.execPath, [PORTAO, arq], { env: shellLimpa(), encoding: "utf8" });
    return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
  };
  const pP = portao(permanente);
  const pL = portao(legado);
  const pS = portao(semUrl);
  const pI = portao(invalido);
  const pA = portao(join(dir, "nao-existe.env"));
  registrar("8. portão do deploy: aprova permanent/legacy coerentes, reprova sem URL, inválido e ausente",
    pP.codigo === 0 && pP.saida.includes("identity mode: permanent") && pL.codigo === 0
      && pS.codigo === 1 && pI.codigo === 1 && pA.codigo === 1
      && [pP, pL, pS, pI, pA].every((p) => semVazamento(p.saida)),
    `permanent=${pP.codigo} legacy=${pL.codigo} sem-url=${pS.codigo} inválido=${pI.codigo} ausente=${pA.codigo}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const falhas = resultados.filter((r) => !r.ok).length;
console.log(`\n${falhas === 0 ? "✅ PROVA D5 APROVADA" : `❌ PROVA D5 REPROVADA (${falhas})`} — ${resultados.length - falhas}/${resultados.length}`);
process.exit(falhas === 0 ? 0 : 1);
