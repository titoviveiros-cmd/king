// T1 — A IDENTIDADE PERMANENTE CONTRA O PROJETO SUPABASE REAL.
//
// ══ O QUE ESTE SCRIPT PROVA, E OS TESTES DO REPOSITÓRIO NÃO ══
//
// Os testes de `apps/server` provam a verificação contra um JWKS LOCAL, com chaves geradas pelo
// próprio teste. Nada ali toca o Supabase de verdade: nem a RLS, nem o trigger que cria o perfil,
// nem a chave que o projeto usa para assinar. Este script fala com o projeto real, como um
// aparelho falaria — e só com o que um aparelho tem: a URL e a chave PUBLICÁVEL.
//
//   1. dois convidados reais nascem (`signInAnonymously`);
//   2. cada `auth.users.id` tem exatamente um `public.players`;
//   3. A lê o próprio perfil;
//   4. A não lê o de B;
//   5. A não atualiza o de B;
//   6. A não insere usando o id de B;
//   7. A não apaga perfil nenhum;
//   8. o refresh mantém o mesmo `sub`;
//   9. o JWT real valida no JWKS real — `iss`, `aud = authenticated`, `alg ∈ {ES256, RS256}` — e
//      o VERIFICADOR DO SERVIDOR (o `dist` compilado, o mesmo que roda na VPS) o aceita;
//  10. nenhum token completo sai no log.
//
// ══ O QUE ELE NUNCA FAZ ══
//
//   · não usa `service_role` nem `sb_secret_…` — recusa rodar se receber uma;
//   · não cria mais que DOIS usuários, nem tenta de novo quando a criação falha;
//   · não imprime token, refresh token nem a chave: toda linha passa por uma trava antes de sair.
//
// Os dois convidados FICAM no projeto: apagar usuário exige `service_role`, que este script não
// tem e não deve ter. As sessões são encerradas no fim.
//
// USO (da raiz do repositório):
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_… \
//     node scripts/verificar-supabase-real.mjs
// Também aceita os nomes VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.
//
// SAÍDA: 0 aprovado · 1 reprovado · 2 não foi possível executar (configuração, rede, limite de taxa).
import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const URL_PROJETO = (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const CHAVE = (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
const MAXIMO_DE_CONVIDADOS = 2;
const ALGORITMOS = ["ES256", "RS256"];
const PLATEIA = "authenticated";

// ── A TRAVA DO LOG ─────────────────────────────────────────────────────────────────────────────
//
// Todo segredo visto é registrado aqui, e toda linha é conferida contra todos eles ANTES de ser
// impressa. Uma linha que carregaria um segredo não sai: vira falha do teste 10, com o motivo.
const segredos = new Set();
const saida = [];
let vazamentosBloqueados = 0;
function segredo(valor) {
  if (typeof valor === "string" && valor.length >= 16) {
    segredos.add(valor);
    // A assinatura sozinha também identifica o token — ela entra na lista separada.
    const partes = valor.split(".");
    if (partes.length === 3 && partes[2].length >= 16) segredos.add(partes[2]);
  }
}
function log(...partes) {
  const linha = partes.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  for (const s of segredos) {
    if (linha.includes(s)) {
      vazamentosBloqueados++;
      console.log("  [linha suprimida: carregaria um segredo]");
      return;
    }
  }
  saida.push(linha);
  console.log(linha);
}
const mascarar = (id) => (typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : "∅");

// ── RESULTADOS ─────────────────────────────────────────────────────────────────────────────────
const resultados = [];
function registrar(n, nome, ok, detalhe = "") {
  resultados.push({ n, nome, ok, detalhe });
  log(`  ${ok ? "✓" : "✗"} ${n}. ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
}

function sair(codigo, motivo) {
  if (motivo) log(`\n${codigo === 2 ? "⚠️  NÃO EXECUTADO" : "❌"} — ${motivo}`);
  process.exit(codigo);
}

// ── PRÉ-CONDIÇÕES ──────────────────────────────────────────────────────────────────────────────
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/i.test(URL_PROJETO)) {
  sair(2, "SUPABASE_URL ausente ou fora do formato https://<ref>.supabase.co");
}
if (!CHAVE) sair(2, "SUPABASE_PUBLISHABLE_KEY ausente");
segredo(CHAVE);
if (CHAVE.startsWith("sb_secret_")) sair(2, "recebi uma chave SECRETA. Este script só roda com a publicável.");
try {
  // Chave legada em formato JWT: recusar se for service_role.
  if (CHAVE.split(".").length === 3 && decodeJwt(CHAVE).role === "service_role") {
    sair(2, "recebi a service_role. Este script só roda com a chave publicável.");
  }
} catch { /* não é JWT: é o formato sb_publishable_, que é o esperado */ }

const EMISSOR = `${URL_PROJETO}/auth/v1`;
const JWKS_URL = new URL(`${EMISSOR}/.well-known/jwks.json`);

log(`\nT1 — identidade permanente contra o projeto real`);
log(`projeto: ${URL_PROJETO.replace(/^https:\/\/([a-z0-9]{4})[a-z0-9]*(\.supabase\.co)$/i, "https://$1…$2")}`);
log(`chave: ${CHAVE.slice(0, 15)}… (publicável)\n`);

// ── CONVIDADOS ─────────────────────────────────────────────────────────────────────────────────
//
// Cada cliente tem o SEU armazenamento em memória: são dois aparelhos, não duas abas. Com o
// armazenamento compartilhado, o segundo `signInAnonymously` sobrescreveria a sessão do primeiro.
function memoria() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

let convidadosCriados = 0;
async function novoConvidado(rotulo) {
  if (convidadosCriados >= MAXIMO_DE_CONVIDADOS) throw new Error("limite de convidados deste script atingido");
  convidadosCriados++;
  const cliente = createClient(URL_PROJETO, CHAVE, {
    auth: {
      storage: memoria(), storageKey: `king-t1-${rotulo}`,
      persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
    },
  });
  const { data, error } = await cliente.auth.signInAnonymously();
  if (error || !data?.session || !data?.user) {
    // Sem nova tentativa: um erro aqui é limite de taxa ou configuração, e repetir só cria usuário.
    sair(2, `não foi possível criar o convidado ${rotulo}: ${error?.status ?? ""} ${error?.code ?? error?.message ?? "sem sessão"}`);
  }
  segredo(data.session.access_token);
  segredo(data.session.refresh_token);
  return { rotulo, cliente, id: data.user.id, user: data.user, token: data.session.access_token };
}

const falhaDeRede = (e) => sair(2, `falha inesperada: ${e?.message ?? e}`);

try {
  // 1 ─────────────────────────────────────────────────────────────────────────────────────────
  const A = await novoConvidado("A");
  const B = await novoConvidado("B");
  const subA = decodeJwt(A.token).sub;
  const subB = decodeJwt(B.token).sub;
  log(`convidado A: ${mascarar(A.id)}   convidado B: ${mascarar(B.id)}\n`);
  registrar(1, "dois convidados reais criados",
    A.user.is_anonymous === true && B.user.is_anonymous === true && A.id !== B.id
      && subA === A.id && subB === B.id && convidadosCriados === 2,
    `anônimos=${A.user.is_anonymous}/${B.user.is_anonymous}, ids distintos=${A.id !== B.id}, sub=id em ambos=${subA === A.id && subB === B.id}, criados=${convidadosCriados}`);

  // 2 ─────────────────────────────────────────────────────────────────────────────────────────
  // Por usuário, pelo único caminho que um aparelho tem: a própria sessão. `players.id` é chave
  // primária, então "ao menos um" visto aqui é "exatamente um". A contagem GLOBAL
  // (auth.users × players) exige acesso administrativo e fica para o SQL Editor.
  const perfisDe = async (c) => c.cliente.from("players").select("id, display_name, avatar_id, created_at").eq("id", c.id);
  const pA = await perfisDe(A);
  const pB = await perfisDe(B);
  registrar(2, "cada auth.users.id tem exatamente 1 public.players",
    !pA.error && !pB.error && pA.data.length === 1 && pB.data.length === 1
      && pA.data[0].id === A.id && pB.data[0].id === B.id,
    `A=${pA.data?.length ?? pA.error?.code} linha(s), B=${pB.data?.length ?? pB.error?.code} linha(s), criadas pelo trigger no signup`);

  // 3 ─────────────────────────────────────────────────────────────────────────────────────────
  const todosVistosPorA = await A.cliente.from("players").select("id");
  registrar(3, "A lê o próprio perfil",
    !pA.error && pA.data?.[0]?.id === A.id,
    `perfil próprio visível; sem filtro, A enxerga ${todosVistosPorA.data?.length ?? "?"} linha(s) na tabela inteira`);

  // 4 ─────────────────────────────────────────────────────────────────────────────────────────
  const aLeB = await A.cliente.from("players").select("id").eq("id", B.id);
  registrar(4, "A não lê o perfil de B",
    !aLeB.error && aLeB.data.length === 0
      && !todosVistosPorA.error && todosVistosPorA.data.length === 1 && todosVistosPorA.data[0].id === A.id,
    `filtro por B → ${aLeB.data?.length ?? aLeB.error?.code} linha(s); tabela inteira vista por A → só a própria`);

  // 5 ─────────────────────────────────────────────────────────────────────────────────────────
  // CONTROLE POSITIVO primeiro: sem ele, "0 linhas atualizadas" em B provaria só que UPDATE não
  // funciona para ninguém. A escreve no PRÓPRIO perfil (dado de teste, dentro dos 14 caracteres).
  const aAtualizaA = await A.cliente.from("players").update({ display_name: "T1-A" }).eq("id", A.id).select("id");
  const aAtualizaB = await A.cliente.from("players").update({ display_name: "T1-invasor" }).eq("id", B.id).select("id");
  const bRelê = await perfisDe(B);
  registrar(5, "A não atualiza o perfil de B",
    !aAtualizaA.error && aAtualizaA.data.length === 1
      && !aAtualizaB.error && aAtualizaB.data.length === 0
      && bRelê.data?.[0]?.display_name !== "T1-invasor",
    `controle: A atualiza o próprio → ${aAtualizaA.data?.length ?? aAtualizaA.error?.code}; A atualiza B → ${aAtualizaB.data?.length ?? aAtualizaB.error?.code} linha(s); B relê display_name=${JSON.stringify(bRelê.data?.[0]?.display_name ?? null)}`);

  // 6 ─────────────────────────────────────────────────────────────────────────────────────────
  // O perfil de B JÁ EXISTE, então um erro de chave duplicada (23505) passaria sem provar nada de
  // RLS. O que se exige é 42501: a política WITH CHECK é avaliada antes do índice.
  const aInsereB = await A.cliente.from("players").insert({ id: B.id, display_name: "T1-invasor" });
  registrar(6, "A não insere usando o id de B",
    aInsereB.error?.code === "42501",
    `código=${aInsereB.error?.code ?? "nenhum erro"}${aInsereB.error?.code === "23505" ? " (chave duplicada — NÃO prova RLS)" : ""}`);

  // 7 ─────────────────────────────────────────────────────────────────────────────────────────
  const aApagaA = await A.cliente.from("players").delete().eq("id", A.id).select("id");
  const aApagaB = await A.cliente.from("players").delete().eq("id", B.id).select("id");
  const aRelê = await perfisDe(A);
  const bRelê2 = await perfisDe(B);
  registrar(7, "A não apaga perfil (nem o próprio, nem o de B)",
    !aApagaA.error && aApagaA.data.length === 0 && !aApagaB.error && aApagaB.data.length === 0
      && aRelê.data?.length === 1 && bRelê2.data?.length === 1,
    `apaga o próprio → ${aApagaA.data?.length ?? aApagaA.error?.code}; apaga B → ${aApagaB.data?.length ?? aApagaB.error?.code}; perfis continuam: A=${aRelê.data?.length}, B=${bRelê2.data?.length}`);

  // 8 ─────────────────────────────────────────────────────────────────────────────────────────
  const refresh = await A.cliente.auth.refreshSession();
  const tokenNovo = refresh.data?.session?.access_token;
  segredo(tokenNovo);
  segredo(refresh.data?.session?.refresh_token);
  const subNovo = tokenNovo ? decodeJwt(tokenNovo).sub : undefined;
  registrar(8, "refresh mantém o mesmo sub",
    !refresh.error && !!tokenNovo && subNovo === A.id && tokenNovo !== A.token,
    `token renovado=${!!tokenNovo && tokenNovo !== A.token}, sub antes=${mascarar(subA)}, depois=${mascarar(subNovo)}`);

  // 9 ─────────────────────────────────────────────────────────────────────────────────────────
  const jwks = await (await fetch(JWKS_URL)).json();
  const chaves = (jwks.keys ?? []).map((k) => `${k.kty}/${k.alg ?? "?"}/${k.crv ?? ""}`);
  const cabecalho = decodeProtectedHeader(A.token);
  let jose = null;
  let erroJose = null;
  try {
    jose = await jwtVerify(tokenNovo ?? A.token, createRemoteJWKSet(JWKS_URL), {
      issuer: EMISSOR, audience: PLATEIA, algorithms: ALGORITMOS, clockTolerance: "30s",
    });
  } catch (e) { erroJose = e?.code ?? e?.message; }

  // O VERIFICADOR DO SERVIDOR, e não uma cópia dele: é o `dist` que vai para a VPS.
  const distVerificador = new URL("../apps/server/dist/auth/identidade.js", import.meta.url);
  let servidor = { ok: false, detalhe: "dist do servidor ausente (rode npm run build:server)" };
  if (existsSync(distVerificador)) {
    const { verificadorDoAmbiente, IdentidadeRecusada } = await import(distVerificador.href);
    const verificador = verificadorDoAmbiente({ SUPABASE_URL: URL_PROJETO });
    const aceito = await verificador.verificar(B.token);
    // Negativa real: o mesmo token com o corpo trocado pelo de A.
    const [cab, , sig] = B.token.split(".");
    const corpoDeA = A.token.split(".")[1];
    let recusa = "aceitou (ERRADO)";
    try { await verificador.verificar(`${cab}.${corpoDeA}.${sig}`); } catch (e) {
      recusa = e instanceof IdentidadeRecusada ? e.motivo : `erro inesperado: ${e?.message}`;
    }
    servidor = {
      ok: aceito.playerId === B.id && aceito.provedor === "guest" && aceito.convidado === true && recusa === "assinatura-invalida",
      detalhe: `servidor aceita B → playerId=${mascarar(aceito.playerId)}, provedor=${aceito.provedor}; corpo trocado → recusado (${recusa})`,
    };
  }

  const p = jose?.payload ?? {};
  registrar(9, "JWT real valida no JWKS real",
    !!jose && ALGORITMOS.includes(jose.protectedHeader.alg) && p.iss === EMISSOR
      && (p.aud === PLATEIA || (Array.isArray(p.aud) && p.aud.includes(PLATEIA)))
      && p.sub === A.id && p.is_anonymous === true && servidor.ok,
    `JWKS: ${chaves.length} chave(s) [${chaves.join(", ")}]; alg=${cabecalho.alg}; iss correto=${p.iss === EMISSOR}; aud=${JSON.stringify(p.aud)}; role=${p.role}; is_anonymous=${p.is_anonymous}${erroJose ? `; jose recusou: ${erroJose}` : ""}`);
  log(`     ${servidor.detalhe}`);

  // encerra as sessões (os usuários ficam — apagar exige service_role)
  await A.cliente.auth.signOut().catch(() => {});
  await B.cliente.auth.signOut().catch(() => {});
} catch (e) {
  falhaDeRede(e);
}

// 10 ─────────────────────────────────────────────────────────────────────────────────────────
// A conferência final repete, sobre TUDO o que saiu, a mesma trava que já barrou cada linha.
const vazou = saida.some((linha) => [...segredos].some((s) => linha.includes(s)));
registrar(10, "nenhum token completo impresso",
  !vazou && vazamentosBloqueados === 0,
  `${segredos.size} segredo(s) vigiado(s); linhas bloqueadas=${vazamentosBloqueados}; vazamentos na saída=${vazou ? "SIM" : "0"}`);

const falhas = resultados.filter((r) => !r.ok);
log(`\n${falhas.length === 0 ? "✅ T1 APROVADO" : `❌ T1 REPROVADO (${falhas.length})`} — ${resultados.length - falhas.length}/${resultados.length}`);
process.exit(falhas.length === 0 ? 0 : 1);
