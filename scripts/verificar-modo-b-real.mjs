// T4 — O MODO B DE VERDADE, NUM SERVIDOR KING LOCAL COMPILADO.
//
// Sobe `apps/server/dist/index.js` em MODO B (arquivo de ambiente temporário com
// KING_IDENTITY_MODE=permanent) e fala com ele como um aparelho fala. Não usa VPS, não usa Vercel
// e não usa navegador.
//
//   A. token válido     → entra; playerId === sub; identidadePermanente === true; e o
//                         verificador compilado do servidor classifica a sessão como `guest`;
//   B. sem token        → recusado com 4005 — nenhum playerId sorteado no lugar;
//   C. token adulterado → recusado com 4003;
//   D. reconexão        → pelo recoveryToken, a MESMA identidade volta, sem criar outro convidado;
//   E. nada sensível    → nem a saída deste script nem a do servidor carregam token, assinatura,
//                         refresh token ou a chave publicável.
//
// FONTES DE IDENTIDADE
//   --fonte=real  (padrão) UM convidado anônimo real do Supabase. Configuração só por ambiente:
//                 SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (ou os nomes VITE_…). Recusa chave
//                 secreta e service_role. Nunca cria mais de um usuário, nem tenta de novo.
//   --fonte=local JWKS servido localmente e token assinado aqui mesmo: sem rede e sem usuário.
//                 É o que as provas causais (mutações no servidor) usam.
//   --fonte=env   um access token já existente em KING_T4_ACCESS_TOKEN (e, se houver,
//                 SUPABASE_URL para classificar o provedor). Não cria usuário. Só com --server-url.
//
// ALVO
//   (padrão)                  o script sobe o servidor LOCAL compilado em MODO B;
//   --server-url=wss://…      um servidor JÁ NO AR (ou KING_T4_SERVER_URL). Nenhum servidor é
//                             iniciado: prova-se o processo que realmente está atendendo. É o T4
//                             REAL PÓS-DEPLOY: rode-o do notebook depois de ativar o MODO B na VPS.
//
// SAÍDA: 0 aprovado · 1 reprovado · 2 não executado (configuração, rede, limite de taxa).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";
import { decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";

const FONTE = process.argv.find((a) => a.startsWith("--fonte="))?.split("=")[1] ?? "real";
const SERVER_URL = (process.argv.find((a) => a.startsWith("--server-url="))?.slice("--server-url=".length)
  ?? process.env.KING_T4_SERVER_URL ?? "").trim() || null;
const RAIZ = new URL("../", import.meta.url);
const ENTRADA = fileURLToPath(new URL("apps/server/dist/index.js", RAIZ));
const { PROTOCOL_VERSION, CODIGO } = await import(new URL("apps/server/dist/protocol/index.js", RAIZ).href);
const { verificadorDoAmbiente } = await import(new URL("apps/server/dist/auth/identidade.js", RAIZ).href);
const MAXIMO_DE_CONVIDADOS = 1;
const PLATEIA = "authenticated";

// ── A TRAVA DO LOG (a mesma do T1) ────────────────────────────────────────────────────────────
const segredos = new Set();
function segredo(v) {
  if (typeof v !== "string" || v.length < 16) return;
  segredos.add(v);
  const partes = v.split(".");
  if (partes.length === 3 && partes[2].length >= 16) segredos.add(partes[2]);
}
const limpar = (texto) => [...segredos].reduce((t, s) => t.split(s).join("***"), String(texto));
const saida = [];
let bloqueadas = 0;
function log(linha) {
  if ([...segredos].some((s) => linha.includes(s))) { bloqueadas++; console.log("  [linha suprimida: carregaria um segredo]"); return; }
  saida.push(linha);
  console.log(linha);
}
const mascarar = (id) => (typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : "∅");

const resultados = [];
function registrar(letra, nome, ok, detalhe = "") {
  resultados.push({ letra, ok });
  log(`  ${ok ? "✓" : "✗"} ${letra}. ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}
function naoExecutado(motivo) {
  log(`\n⚠️  T4 NÃO EXECUTADO — ${limpar(motivo)}`);
  process.exit(2);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ── A FONTE DE IDENTIDADE ─────────────────────────────────────────────────────────────────────
let convidadosCriados = 0;

async function fonteLocal() {
  const par = await generateKeyPair("ES256");
  const publica = { ...(await exportJWK(par.publicKey)), kid: "t4-local", alg: "ES256", use: "sig" };
  const corpo = JSON.stringify({ keys: [publica] });
  const jwks = createServer((_q, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(corpo); });
  await new Promise((r) => jwks.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${jwks.address().port}`;
  const sub = randomUUID();
  const token = await new SignJWT({ sub, is_anonymous: true, role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: publica.kid })
    .setIssuedAt().setIssuer(`${url}/auth/v1`).setAudience(PLATEIA).setExpirationTime("10m")
    .sign(par.privateKey);
  segredo(token);
  return { url, token, sub, fechar: async () => new Promise((r) => jwks.close(() => r())) };
}

async function fonteReal() {
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  const chave = (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(url)) naoExecutado("SUPABASE_URL ausente ou fora do formato https://<ref>.supabase.co");
  if (!chave) naoExecutado("SUPABASE_PUBLISHABLE_KEY ausente");
  segredo(chave);
  if (chave.startsWith("sb_secret_")) naoExecutado("recebi uma chave SECRETA; este teste só roda com a publicável");
  try { if (chave.split(".").length === 3 && decodeJwt(chave).role === "service_role") naoExecutado("recebi a service_role"); } catch { /* formato sb_publishable_ */ }

  if (convidadosCriados >= MAXIMO_DE_CONVIDADOS) naoExecutado("limite de convidados atingido");
  convidadosCriados++;
  const { createClient } = await import("@supabase/supabase-js");
  const m = new Map();
  const cliente = createClient(url, chave, {
    auth: {
      storage: { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } },
      storageKey: "king-t4", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    },
  });
  const { data, error } = await cliente.auth.signInAnonymously();
  // Sem nova tentativa: repetir só criaria outro usuário.
  if (error || !data?.session) naoExecutado(`o convidado não foi criado: ${error?.status ?? ""} ${error?.code ?? "sem sessão"}`);
  segredo(data.session.access_token);
  segredo(data.session.refresh_token);
  return {
    url, token: data.session.access_token, sub: data.user.id,
    fechar: async () => { await cliente.auth.signOut().catch(() => {}); },
  };
}

/** Um token que já existe, vindo do ambiente. Não cria usuário. */
async function fonteEnv() {
  const token = process.env.KING_T4_ACCESS_TOKEN?.trim();
  if (!token) naoExecutado("KING_T4_ACCESS_TOKEN ausente");
  segredo(token);
  let sub;
  try { sub = decodeJwt(token).sub; } catch { naoExecutado("KING_T4_ACCESS_TOKEN não é um JWT"); }
  if (!sub) naoExecutado("o token não tem sub");
  const url = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "") || null;
  return { url, token, sub, fechar: async () => {} };
}

// ── O SERVIDOR LOCAL EM MODO B ────────────────────────────────────────────────────────────────
function shellLimpa() {
  const e = { ...process.env };
  for (const k of ["KING_IDENTITY_MODE", "SUPABASE_URL", "SUPABASE_JWT_AUDIENCE", "KING_ENV_FILE", "pm_id",
    "SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) delete e[k];
  return e;
}

async function subirServidor(urlDoProjeto, dir) {
  const arquivo = join(dir, "server.env");
  writeFileSync(arquivo, `KING_IDENTITY_MODE=permanent\nSUPABASE_URL=${urlDoProjeto}\n`);
  const porta = 2700 + Math.floor(Math.random() * 200);
  const filho = spawn(process.execPath, [ENTRADA], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...shellLimpa(), KING_ENV_FILE: arquivo, PORT: String(porta) },
  });
  let texto = "";
  let morreu = false;
  filho.stdout.on("data", (d) => { texto += d; });
  filho.stderr.on("data", (d) => { texto += d; });
  filho.on("exit", () => { morreu = true; });
  for (let i = 0; i < 100 && !morreu; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${porta}`, { signal: AbortSignal.timeout(500) })).status > 0) break;
    } catch { /* subindo */ }
    await dormir(150);
  }
  return {
    porta,
    get saida() { return texto; },
    get morreu() { return morreu; },
    async parar() { if (!morreu) { filho.kill(); for (let i = 0; i < 30 && !morreu; i++) await dormir(100); } },
  };
}

const MENSAGENS = ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "SERVER_ERROR", "STATE_UPDATE",
  "ACTION_REJECTED", "READY_STATE", "TURN_CLOCK", "AUTO_ACTION", "SOCIAL_MESSAGE"];

function boasVindasDe(sala) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("SERVER_WELCOME não chegou")), 8000);
    sala.onMessage("SERVER_WELCOME", (m) => { clearTimeout(t); resolve(m); });
    for (const m of MENSAGENS) sala.onMessage(m, () => {});
  });
}

async function tentar(client, token) {
  try {
    const sala = await client.create("king", {
      protocolVersion: PROTOCOL_VERSION, nick: "T4", avatar: "raposa", ...(token ? { accessToken: token } : {}),
    });
    return { sala, boasVindas: await boasVindasDe(sala) };
  } catch (e) {
    return { codigo: e?.code, erro: limpar(e?.message ?? e) };
  }
}

/** O mesmo token com outro `sub` no corpo e a assinatura original. */
function adulterar(token) {
  const [cab, corpo, sig] = token.split(".");
  const claims = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
  const novo = Buffer.from(JSON.stringify({ ...claims, sub: randomUUID() })).toString("base64url");
  const t = `${cab}.${novo}.${sig}`;
  segredo(t);
  return t;
}

// ── A PROVA ───────────────────────────────────────────────────────────────────────────────────
log(`\nT4 — MODO B num servidor local compilado (fonte: ${FONTE})\n`);
if (!["real", "local", "env"].includes(FONTE)) naoExecutado("use --fonte=real, --fonte=local ou --fonte=env");
if (SERVER_URL && !/^wss?:\/\//i.test(SERVER_URL)) naoExecutado("--server-url precisa ser ws:// ou wss://");
if (SERVER_URL && FONTE === "local") naoExecutado("--fonte=local não serve com --server-url: o servidor alvo não confia no JWKS local");
if (!SERVER_URL && FONTE === "env") naoExecutado("--fonte=env só com --server-url");

const dir = mkdtempSync(join(tmpdir(), "king-t4-"));
let fonte = null;
let servidor = null;
try {
  fonte = FONTE === "local" ? await fonteLocal() : FONTE === "env" ? await fonteEnv() : await fonteReal();
  log(`convidado: ${mascarar(fonte.sub)} · convidados criados nesta execução: ${convidadosCriados}`);
  let alvo;
  if (SERVER_URL) {
    // O processo que REALMENTE está no ar. Nada é iniciado aqui; B (sem token = 4005) prova o modo.
    alvo = SERVER_URL;
    log(`servidor alvo: ${SERVER_URL} (já no ar — nenhum servidor é iniciado por este script)\n`);
  } else {
    servidor = await subirServidor(fonte.url, dir);
    if (servidor.morreu) naoExecutado(`o servidor local não subiu: ${servidor.saida.split("\n")[0]}`);
    const boot = (servidor.saida.match(/identity mode[^\n]*/) ?? [""])[0];
    log(`servidor: ${boot.replace(/\(.*server\.env\)/, "(arquivo temporário)")}\n`);
    if (!boot.startsWith("identity mode: permanent")) naoExecutado("o servidor não subiu em MODO B");
    alvo = `ws://127.0.0.1:${servidor.porta}`;
  }

  const client = new Client(alvo);

  // A
  const a = await tentar(client, fonte.token);
  // O provedor é classificado pelo verificador COMPILADO do servidor, quando a URL do projeto é conhecida.
  const id = fonte.url
    ? await verificadorDoAmbiente({ KING_IDENTITY_MODE: "permanent", SUPABASE_URL: fonte.url })
      .verificar(fonte.token).catch((e) => ({ erro: e?.motivo ?? "?" }))
    : null;
  registrar("A", "token válido entra com o sub como playerId",
    !!a.boasVindas && a.boasVindas.you.playerId === fonte.sub && a.boasVindas.you.identidadePermanente === true
      && (id === null || (id.playerId === fonte.sub && id.provedor === "guest" && id.convidado === true)),
    a.boasVindas
      ? `playerId=${mascarar(a.boasVindas.you.playerId)} (sub=${mascarar(fonte.sub)}), identidadePermanente=${a.boasVindas.you.identidadePermanente}, provedor(servidor)=${id ? (id.provedor ?? id.erro) : "não classificado (sem SUPABASE_URL)"}`
      : `recusado: ${a.codigo}`);
  const criadaEm = Date.now();

  // B
  const b = await tentar(client, undefined);
  if (b.sala) await b.sala.leave(true).catch(() => {});
  registrar("B", "sem token é recusado com 4005, sem playerId sorteado",
    !b.sala && b.codigo === CODIGO.CREDENCIAL_AUSENTE,
    b.sala ? `ACEITO com playerId ${mascarar(b.boasVindas.you.playerId)} (fallback!)` : `recusado: ${b.codigo}`);

  // C
  const c = await tentar(client, adulterar(fonte.token));
  if (c.sala) await c.sala.leave(true).catch(() => {});
  registrar("C", "token adulterado é recusado com 4003",
    !c.sala && c.codigo === CODIGO.IDENTIDADE_RECUSADA,
    c.sala ? "ACEITO (adulterado!)" : `recusado: ${c.codigo}`);

  // D — o caminho do app depois de RECARREGAR a página: a aba antiga some, e um cliente NOVO volta
  // pelo recoveryToken. A reconexão automática do SDK fica desligada na sala antiga — com ela
  // ligada, o próprio SDK reabria a sessão e disputava o token com a volta que se quer provar.
  if (a.sala) {
    await dormir(Math.max(0, 5500 - (Date.now() - criadaEm)));
    const recovery = a.boasVindas.you.recoveryToken;
    segredo(recovery);
    a.sala.reconnection.enabled = false;
    await Promise.race([a.sala.leave(false).catch(() => {}), dormir(1500)]);
    await dormir(300);
    let d = null;
    try {
      const volta = await new Client(alvo).reconnect(recovery);
      d = await boasVindasDe(volta);
      await volta.leave(true).catch(() => {});
    } catch (e) { d = { erro: limpar(e?.message ?? e) }; }
    registrar("D", "a reconexão devolve a mesma identidade, sem outro convidado",
      !!d?.you && d.you.playerId === fonte.sub && d.you.seat === a.boasVindas.you.seat
        && d.you.identidadePermanente === true && convidadosCriados === (FONTE === "real" ? 1 : 0),
      d?.you ? `playerId=${mascarar(d.you.playerId)}, assento ${d.you.seat}, convidados=${convidadosCriados}` : `falhou: ${d?.erro}`);
  } else {
    registrar("D", "a reconexão devolve a mesma identidade, sem outro convidado", false, "sem sala de A para reconectar");
  }
} catch (e) {
  naoExecutado(`falha inesperada: ${e?.message ?? e}`);
} finally {
  if (servidor) await servidor.parar();
  if (fonte) await fonte.fechar();
  rmSync(dir, { recursive: true, force: true });
}

// E
const doServidor = servidor?.saida ?? "";
const vazouServidor = [...segredos].some((s) => doServidor.includes(s));
const vazouAqui = saida.some((l) => [...segredos].some((s) => l.includes(s)));
registrar("E", "nada sensível na saída (deste script e do servidor)",
  !vazouServidor && !vazouAqui && bloqueadas === 0,
  `${segredos.size} segredo(s) vigiado(s); servidor=${vazouServidor ? "VAZOU" : "limpo"}; script=${vazouAqui || bloqueadas ? "VAZOU" : "limpo"}`);

const falhas = resultados.filter((r) => !r.ok).length;
log(`\n${falhas === 0 ? "✅ T4 APROVADO" : `❌ T4 REPROVADO (${falhas})`} — ${resultados.length - falhas}/${resultados.length} · fonte ${FONTE} · convidados criados: ${convidadosCriados}`);
process.exit(falhas === 0 ? 0 : 1);
