/**
 * T5 — A IDENTIDADE DE CONVIDADO NO PREVIEW REAL (FASE 1).
 *
 * ══ QUANDO RODA ══
 *
 * SÓ com `KING_PREVIEW_URL` definida — e só num Preview publicado COM `VITE_SUPABASE_URL` e
 * `VITE_SUPABASE_PUBLISHABLE_KEY`. Sem a variável, o teste é pulado: o build local de e2e não tem
 * provedor de identidade e não deve ter. Na CI ele não roda.
 *
 * Preview com proteção da Vercel: passe `VERCEL_PROTECTION_BYPASS` (o segredo de "Protection
 * Bypass for Automation"), SÓ por variável de ambiente. Ele vai apenas na PRIMEIRA navegação, na
 * query, com `x-vercel-set-bypass-cookie=true`; dali em diante quem abre a porta é o cookie que a
 * Vercel grava para o domínio do Preview. Nunca vira cabeçalho do contexto — um cabeçalho global
 * atingiria, cross-origin, o servidor do jogo e dispararia preflight de CORS. Nunca é impresso.
 * Rode com `--reporter=list --trace=off`: o relatório html e o trace guardam a URL de cada passo.
 *
 *   KING_PREVIEW_URL=https://king-xxxx.vercel.app npx playwright test identidadePreview.spec.ts \
 *     --config apps/web/playwright.config.ts --project=800x360 --reporter=list --trace=off
 *
 * ══ O QUE PROVA ══
 *
 *   1. a primeira visita cria a sessão de convidado (`sb-<ref>-auth-token` no localStorage);
 *   2. a entrada na sala leva `accessToken`, e o `sub` dele é o usuário da sessão;
 *   3. o reload preserva o MESMO `sub` — nenhum convidado novo;
 *   4. uma nova aba preserva o MESMO `sub`;
 *   5. o servidor da FASE 1 continua no MODO A: entra, IGNORA o token (o `playerId` do
 *      `SERVER_WELCOME` é sorteado, diferente do `sub`, e `identidadePermanente` é falso).
 *
 * Nenhum token é impresso: compara-se só o `sub`, e o log mostra o `sub` mascarado.
 */
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { criarSala } from "./helpers/multiplayer.js";
import { semSegredo, urlDeEntrada } from "./helpers/bypassVercel.js";

const require = createRequire(import.meta.url);
const { unpack } = require("@colyseus/msgpackr") as { unpack: (b: Buffer) => unknown };

const PREVIEW = process.env.KING_PREVIEW_URL?.trim().replace(/\/+$/, "");
const BYPASS = process.env.VERCEL_PROTECTION_BYPASS?.trim();

test.use({ baseURL: PREVIEW });

const mascarar = (id?: string) => (id && id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : "∅");

/** O `sub` de um JWT, sem verificar assinatura — aqui só se compara quem é, não se é válido. */
function subDe(token: string): string | undefined {
  const corpo = token.split(".")[1];
  if (!corpo) return undefined;
  return (JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as { sub?: string }).sub;
}

interface Observado { tokensEnviados: string[]; boasVindas: { playerId: string; identidadePermanente: boolean }[] }

/** Observa a entrada na sala: o corpo do matchmake (HTTP) e o SERVER_WELCOME (WebSocket). */
function observar(page: Page): Observado {
  const o: Observado = { tokensEnviados: [], boasVindas: [] };
  page.on("request", (r) => {
    if (r.method() !== "POST" || !/\/matchmake\//.test(r.url())) return;
    const corpo = r.postDataJSON() as { accessToken?: string } | null;
    if (corpo?.accessToken) o.tokensEnviados.push(corpo.accessToken);
  });
  page.on("websocket", (ws) => {
    ws.on("framereceived", ({ payload }) => {
      if (typeof payload === "string") return;
      const b = payload as Buffer;
      if (b[0] !== 13) return;
      const p = b[1];
      let len = 0;
      let ini = 0;
      if ((p & 0xe0) === 0xa0) { len = p & 0x1f; ini = 2; } else if (p === 0xd9) { len = b[2]; ini = 3; } else return;
      if (b.subarray(ini, ini + len).toString("utf8") !== "SERVER_WELCOME") return;
      const w = unpack(b.subarray(ini + len)) as { you: { playerId: string; identidadePermanente: boolean } };
      o.boasVindas.push({ playerId: w.you.playerId, identidadePermanente: w.you.identidadePermanente });
    });
  });
  return o;
}

/** O usuário da sessão guardada pelo SDK — só o id, nunca o token. */
async function usuarioDaSessao(page: Page): Promise<string | undefined> {
  return await page.evaluate(() => {
    const chave = Object.keys(localStorage).find((k) => /^sb-.+-auth-token$/.test(k));
    if (!chave) return undefined;
    try {
      const s = JSON.parse(localStorage.getItem(chave) ?? "null") as { user?: { id?: string }; access_token?: string } | null;
      return s?.access_token && s.user?.id ? s.user.id : undefined;
    } catch { return undefined; }
  });
}

/**
 * A PORTA DA VERCEL — atravessada uma vez, e o resto do contexto vive do cookie.
 *
 * Sem segredo não faz nada: um Preview sem proteção abre direto, e um protegido reprova adiante,
 * na tela de login, com o motivo visível. Com segredo, a navegação inicial pede à Vercel que grave
 * o cookie de bypass; o teste confere que a página ficou no domínio do Preview (e não foi mandada
 * para o login) e que há cookie para esse domínio. Nenhuma mensagem carrega o segredo.
 */
async function passarPelaProtecao(page: Page): Promise<void> {
  if (!BYPASS) return;
  try {
    await page.goto(urlDeEntrada(PREVIEW!, BYPASS), { waitUntil: "domcontentloaded" });
  } catch (e) {
    throw new Error(`a navegação inicial do Preview falhou: ${semSegredo(String((e as Error)?.message ?? e), BYPASS)}`);
  }
  const ficouNoPreview = new URL(page.url()).host === new URL(PREVIEW!).host;
  expect(ficouNoPreview, "a Vercel mandou para o login — o segredo de bypass não foi aceito").toBe(true);
  const cookies = await page.context().cookies(PREVIEW!);
  expect(cookies.length, "a Vercel não gravou cookie para o domínio do Preview").toBeGreaterThan(0);
}

/** Cria uma sala e devolve o `sub` enviado e o que o servidor respondeu. */
async function entrar(page: Page, o: Observado, apelido: string) {
  const antesT = o.tokensEnviados.length;
  const antesW = o.boasVindas.length;
  await criarSala(page, apelido, "Sapo");
  await expect.poll(() => o.boasVindas.length, { timeout: 20_000 }).toBeGreaterThan(antesW);
  expect(o.tokensEnviados.length, "a entrada na sala não levou accessToken").toBeGreaterThan(antesT);
  const sub = subDe(o.tokensEnviados.at(-1)!);
  return { sub, boasVindas: o.boasVindas.at(-1)! };
}

test("FASE 1: convidado real persiste e o servidor continua no MODO A", async ({ context }, ti) => {
  test.skip(!PREVIEW, "defina KING_PREVIEW_URL para rodar contra um Preview com identidade");
  test.skip(ti.project.name !== "800x360", "roda uma vez");
  test.setTimeout(180_000);

  // 1 + 2 — primeira visita
  const pagina = await context.newPage();
  const o = observar(pagina);
  // A única navegação com o segredo. Reload e nova aba (mesmo contexto) dependem só do cookie.
  await passarPelaProtecao(pagina);
  const primeira = await entrar(pagina, o, "T5 um");
  const usuario = await usuarioDaSessao(pagina);
  console.log(`T5 convidado: ${mascarar(usuario)}`);
  expect(usuario, "a primeira visita não criou sessão de convidado").toBeTruthy();
  expect(primeira.sub, "o accessToken enviado não é do usuário da sessão").toBe(usuario);

  // 5 — MODO A: o servidor ignorou o token
  expect(primeira.boasVindas.identidadePermanente, "o servidor está em MODO B — não é a Fase 1").toBe(false);
  expect(primeira.boasVindas.playerId, "o playerId veio do token — o servidor não está em MODO A").not.toBe(usuario);

  // 3 — reload
  await pagina.reload();
  const depoisDoReload = await entrar(pagina, o, "T5 dois");
  expect(await usuarioDaSessao(pagina), "o reload trocou o convidado").toBe(usuario);
  expect(depoisDoReload.sub, "depois do reload, o token enviado é de outro usuário").toBe(usuario);

  // 4 — nova aba no mesmo navegador
  const aba = await context.newPage();
  const oAba = observar(aba);
  const naAba = await entrar(aba, oAba, "T5 tres");
  expect(await usuarioDaSessao(aba), "a nova aba criou outro convidado").toBe(usuario);
  expect(naAba.sub, "a nova aba enviou o token de outro usuário").toBe(usuario);
  expect(naAba.boasVindas.identidadePermanente).toBe(false);
});
