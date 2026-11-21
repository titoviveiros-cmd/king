/**
 * MEUS RECORDES (Entrega D), pelo caminho real — SDK do Supabase, sessão guardada, PostgREST — contra
 * um projeto FICTÍCIO cuja rede é interceptada aqui. Nenhum byte sai para a internet.
 *
 * Prova:
 *   - o botão 🏆 da Home abre a tela, que cabe inteira nos 13 tamanhos oficiais (rola por dentro);
 *   - a evolução e o próximo desbloqueio usam os números do banco (incluindo o XP do nível do item);
 *   - o Top 3 Online vem do banco, na ordem do banco (positivos, negativos, empate); o histórico mostra
 *     XP e colocação, nunca pontuação no lugar de XP;
 *   - sem conta, só o Solo — e sem recorde, o estado vazio;
 *   - a partida de depuração (`?mao=`) NÃO gera recorde; uma partida solo INTEIRA gera, e celebra uma vez.
 */
import { expect, test, type Page } from "@playwright/test";

const REF = "abcdefghijklmnopqrst";
const HOST = `https://${REF}.supabase.co`;
const CHAVE_DA_SESSAO = `sb-${REF}-auth-token`;
const UID = "11111111-1111-4111-8111-111111111111";
const TAMANHOS = [
  [667, 375], [740, 360], [780, 360], [800, 360], [844, 390], [852, 393], [874, 402], [956, 440],
  [1024, 768], [1600, 900], [852, 330], [740, 320], [852, 300],
] as const;

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sessaoGuardada() {
  const agora = Math.floor(Date.now() / 1000);
  const jwt = [b64url({ alg: "HS256", typ: "JWT" }), b64url({ sub: UID, role: "authenticated", aud: "authenticated", exp: agora + 3600, is_anonymous: true }), "assinatura-ficticia"].join(".");
  return { access_token: jwt, refresh_token: "ficticio", token_type: "bearer", expires_in: 3600, expires_at: agora + 3600,
    user: { id: UID, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} } };
}
const P = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
/** Nível 7 com 1500 XP (1350 é o começo do 7, 1750 o do 8): o banco de verdade daria isto. */
const PROGRESSO = { player_id: UID, xp_total: 1500, nivel: 7, xp_no_nivel: 150, xp_do_nivel: 400,
  sequencia_atual: 2, sequencia_recorde: 6, sequencia_hoje: true, sequencia_ultimo_dia: "2026-11-18", sequencia_partida: null };
/** O banco já devolve o Top 3 ordenado (pontos desc, terminada_em asc, partida_id asc). */
const TOP = [
  { partida_id: P(1), pontos: 320, terminada_em: "2026-11-02T18:00:00Z" },
  { partida_id: P(2), pontos: 320, terminada_em: "2026-11-09T18:00:00Z" },
  { partida_id: P(3), pontos: -45, terminada_em: "2026-11-15T18:00:00Z" },
];
const RECENTES = [
  { partida_id: P(4), posicao: 1, xp_delta: 150, criado_em: "2026-11-18T20:00:00Z" },
  { partida_id: P(3), posicao: 4, xp_delta: 100, criado_em: "2026-11-15T18:01:00Z" },
];

async function abrir(page: Page, { comConta = true, top = TOP, recentes = RECENTES, solo }: { comConta?: boolean; top?: unknown[]; recentes?: unknown[]; solo?: unknown } = {}) {
  const chamadas: string[] = [];
  await page.addInitScript(([k, v, comConta, solo]) => {
    if (comConta) localStorage.setItem(k as string, v as string);
    // tudo da Coroa já celebrado: nenhuma celebração cobre a Home durante a medição
    localStorage.setItem("king:cosmeticos:celebrados", JSON.stringify({ "11111111-1111-4111-8111-111111111111":
      ["moldura-real", "mesa-vinho", "baralho-imperial", "reacao-fogo", "reacao-coroa", "moldura-rubi"] }));
    if (solo) localStorage.setItem("king:recordes:solo", solo as string);
  }, [CHAVE_DA_SESSAO, JSON.stringify(sessaoGuardada()), comConta, solo ? JSON.stringify(solo) : ""] as const);
  await page.route(`${HOST}/**`, async (route) => {
    const u = new URL(route.request().url());
    chamadas.push(`${route.request().method()} ${u.pathname}${u.search}`);
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname === "/rest/v1/meu_progresso") return json(200, [PROGRESSO]);
    if (u.pathname === "/rest/v1/cosmeticos_equipados") return json(200, []);
    if (u.pathname === "/rest/v1/placares_online") return json(200, top);
    if (u.pathname === "/rest/v1/xp_eventos") return json(200, recentes);
    if (u.pathname === "/rest/v1/xp_por_nivel") return json(200, u.searchParams.get("nivel") === "eq.8" ? [{ xp: 1750 }] : []);
    return json(404, {});
  });
  await page.goto("/");
  await expect(page.locator(".recordesbtn")).toBeVisible();
  return chamadas;
}
const tela = (page: Page) => page.locator(".ovcard.recordes");

test("a tela com conta: evolução, próximo desbloqueio, Top 3 Online do banco e histórico — uma leitura por abertura", async ({ page }) => {
  const chamadas = await abrir(page);
  await page.locator(".recordesbtn").click();
  await expect(tela(page)).toBeVisible();
  await expect(tela(page).locator(".rec-nivel b")).toHaveText("7");
  await expect(tela(page).locator(".rec-evolucao")).toContainText("faltam 250 XP para o nível 8");
  await expect(tela(page).locator(".rec-evolucao")).toContainText("Recorde de sequência: 6 dias");
  // próximo item da curva (nível 8: Azul Royal), com o progresso REAL até o 8: (1500−1350)/(1750−1350) = 38%
  await expect(tela(page).locator(".rec-item-txt b")).toHaveText("Azul Royal");
  await expect(tela(page).locator(".rec-item-txt")).toContainText("no nível 8 · faltam 250 XP");
  await expect(tela(page).locator(".rec-proximo [role=progressbar]")).toHaveAttribute("aria-valuenow", "38");
  // Top 3 Online
  await tela(page).getByRole("tab", { name: "Online" }).click();
  await expect(tela(page).locator(".rec-top .rec-pontos")).toHaveText(["+320 pts", "+320 pts", "−45 pts"]);
  await expect(tela(page).locator(".rec-top .rec-meta")).toHaveText(["02/11/2026 · Online", "09/11/2026 · Online", "15/11/2026 · Online"]);
  // histórico: XP e colocação — a pontuação não aparece no lugar do XP
  await expect(tela(page).locator(".rec-recente .rec-resultado")).toHaveText(["Vitória", "4º lugar"]);
  await expect(tela(page).locator(".rec-recente .rec-xp")).toHaveText(["+150 XP", "+100 XP"]);
  await expect(tela(page).locator(".rec-historico")).not.toContainText("pts");
  // UMA leitura de cada, na abertura; nenhuma escrita
  const leituras = chamadas.filter((c) => /placares_online|xp_por_nivel|xp_eventos\?select=partida_id/.test(c));
  expect(leituras.filter((c) => c.includes("placares_online"))).toHaveLength(1);
  expect(leituras.filter((c) => c.includes("xp_por_nivel"))).toHaveLength(1);
  expect(leituras.filter((c) => c.includes("xp_eventos"))).toHaveLength(1);
  expect(chamadas.some((c) => c.startsWith("POST") || c.startsWith("PATCH") || c.startsWith("DELETE"))).toBe(false);
  expect(decodeURIComponent(chamadas.find((c) => c.includes("placares_online"))!)).toContain("order=pontos.desc,terminada_em.asc,partida_id.asc");
});

test("sem conta: só o Solo — vazio honesto antes do primeiro jogo, e o Top 3 deste aparelho depois", async ({ page }) => {
  await abrir(page, { comConta: false });
  await page.locator(".recordesbtn").click();
  await expect(tela(page).locator(".rec-recordes .rec-vazio")).toContainText("Nenhum recorde solo ainda");
  await expect(tela(page).locator(".rec-historico")).toHaveCount(0);
  await tela(page).getByRole("tab", { name: "Online" }).click();
  await expect(tela(page).locator(".rec-recordes .rec-vazio")).toContainText("Jogue uma partida online");
  const outra = await page.context().newPage();
  await abrir(outra, { comConta: false, solo: { v: 1, vistos: ["a", "b"], top: [
    { id: "a", pontos: 180, em: "2026-11-10T15:00:00Z" }, { id: "b", pontos: -220, em: "2026-11-12T15:00:00Z" }] } });
  await outra.locator(".recordesbtn").click();
  await expect(tela(outra).locator(".rec-top .rec-pontos")).toHaveText(["+180 pts", "−220 pts"]);
  await expect(tela(outra).locator(".rec-nota")).toContainText("deste aparelho");
  await outra.close();
});

test("cabe nos 13 tamanhos oficiais: tela inteira, sem rolagem lateral, Voltar à vista, último item alcançável; e o 🏆 não cobre nada da Home", async ({ page }, ti) => {
  test.skip(ti.project.name !== "852x393", "o teste percorre os 13 tamanhos sozinho");
  test.setTimeout(180_000);
  await abrir(page);
  const falhas: string[] = [];
  for (const [w, h] of TAMANHOS) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    // o botão na Home: dentro da tela, alvo de dedo, sem cruzar outro botão
    const home = await page.evaluate(() => {
      const b = document.querySelector(".recordesbtn")!.getBoundingClientRect();
      const outros = [...document.querySelectorAll(".home .row button")].filter((x) => !x.classList.contains("recordesbtn")).map((x) => x.getBoundingClientRect());
      const cruza = outros.some((o) => b.x < o.x + o.width - 1 && o.x < b.x + b.width - 1 && b.y < o.y + o.height - 1 && o.y < b.y + b.height - 1);
      // o MESMO alvo de toque dos botões redondos que já existem na fileira (som, tela cheia)
      const irmao = document.querySelector(".home .row .audiobtn:not(.recordesbtn)")!.getBoundingClientRect();
      return { dentro: b.right <= innerWidth && b.bottom <= innerHeight && b.x >= 0, alvo: Math.min(b.width, b.height) - Math.min(irmao.width, irmao.height), cruza, lado: document.documentElement.scrollWidth > innerWidth };
    });
    if (!home.dentro || home.alvo < -0.5 || home.cruza || home.lado) falhas.push(`${w}x${h} Home: ${JSON.stringify(home)}`);
    await page.locator(".recordesbtn").click();
    await expect(tela(page)).toBeVisible();
    await tela(page).getByRole("tab", { name: "Online" }).click();
    const t = await page.evaluate(() => {
      const c = document.querySelector(".ovcard.recordes")!.getBoundingClientRect();
      const voltar = document.querySelector(".rec-fechar")!.getBoundingClientRect();
      const vazaLado = [...document.querySelectorAll(".rec-secao, .rec-linha, .rec-recente")].filter((e) => e.scrollWidth > e.clientWidth + 1).length;
      return { c: [c.x, c.y, c.right, c.bottom], W: innerWidth, H: innerHeight, voltarNaTela: voltar.bottom <= innerHeight && voltar.top >= 0, vazaLado,
        lado: document.documentElement.scrollWidth > innerWidth };
    });
    if (t.c[0] < 0 || t.c[1] < 0 || t.c[2] > t.W || t.c[3] > t.H + 0.5 || !t.voltarNaTela || t.vazaLado > 0 || t.lado) falhas.push(`${w}x${h} tela: ${JSON.stringify(t)}`);
    const ultimo = tela(page).locator(".rec-recente").last();
    await ultimo.scrollIntoViewIfNeeded();
    if (!(await ultimo.isVisible())) falhas.push(`${w}x${h}: histórico inalcançável`);
    if (process.env.KING_SHOTS && [667, 852, 1600].includes(w)) {
      await tela(page).locator(".rec-lista").evaluate((el) => { el.scrollTop = 0; });
      await page.screenshot({ path: `${process.env.KING_SHOTS}/recordes-${w}x${h}.png` });
    }
    await tela(page).getByRole("button", { name: "Voltar" }).click();
    await expect(tela(page)).toHaveCount(0);
  }
  expect(falhas, falhas.join("\n")).toEqual([]);
});

test("banco SEM a migração dos recordes: a tela abre, o online diz 'indisponível' — nunca um zero inventado", async ({ page }) => {
  await page.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, [CHAVE_DA_SESSAO, JSON.stringify(sessaoGuardada())] as const);
  await page.route(`${HOST}/**`, async (route) => {
    const u = new URL(route.request().url());
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (u.pathname === "/rest/v1/meu_progresso") return json(200, [PROGRESSO]);
    if (u.pathname === "/rest/v1/cosmeticos_equipados") return json(200, []);
    if (u.pathname === "/rest/v1/xp_eventos") return json(200, RECENTES);
    return json(404, { code: "42P01", message: "relation does not exist" });
  });
  await page.goto("/");
  await page.locator(".recordesbtn").click();
  await tela(page).getByRole("tab", { name: "Online" }).click();
  await expect(tela(page).locator(".rec-recordes .rec-vazio")).toHaveText("Recordes online indisponíveis agora.");
  await expect(tela(page).locator(".rec-item-txt")).toContainText("no nível 8"); // o item aparece; só a barra some
  await expect(tela(page).locator(".rec-proximo [role=progressbar]")).toHaveCount(0);
});

// ═══ SOLO de verdade: depuração não conta; a partida inteira conta e celebra UMA vez ═══

async function jogarAteOFim(page: Page): Promise<void> {
  const prog = observadorDaPartida(page);
  for (let i = 0; i < 4000 && !(await page.locator(".fimacoes").count()); i++) {
    await prog.talvez(i);
    // o anúncio da ÚLTIMA MÃO fica por cima da Mesa e segura os cliques: fecha primeiro
    const aviso = page.locator(".um");
    if (await aviso.count()) { await aviso.click({ timeout: 1000 }).catch(prog.erro); await page.waitForTimeout(200); continue; }
    const trunfo = page.locator(".trumpbtn").first();
    if (await trunfo.count()) { await trunfo.click({ timeout: 3000 }).catch(prog.erro); continue; }
    const legal = page.locator('.hand .card[role="button"]').first();
    if (await legal.count()) {
      await legal.click({ timeout: 3000 }).catch(prog.erro);
      if (await page.locator(".hand .card.sel").count()) await page.locator(".hand .card.sel").first().click({ timeout: 3000 }).catch(prog.erro);
      continue;
    }
    for (const rotulo of [/próxima mão/i, /continuar/i]) {
      const b = page.getByRole("button", { name: rotulo }).first();
      if (await b.count()) await b.click({ timeout: 3000 }).catch(prog.erro);
    }
    if (await page.locator(".fim").count()) await page.locator(".fim").click({ position: { x: 5, y: 5 }, timeout: 1000 }).catch(prog.erro);
    await page.waitForTimeout(120);
  }
}

/**
 * TELEMETRIA DA PARTIDA LONGA — só registra, não decide nada.
 *
 * Na CI (Linux), a 1ª tentativa desta partida chegou a levar mais de 15 min (mão 7 aos 15 min; a
 * de depuração passou de 4 min só na mão 10), enquanto a repetição e qualquer execução local
 * levam ~6 min. A repetição é a única com trace, então a tentativa lenta não deixava evidência.
 * Isto imprime, no log da CI, a mão/vaza a cada mudança (no máximo a cada 10 s) e, se a mesa
 * ficar 45 s sem mudar, o estado da tela, o último erro de clique e o atraso real de um timer de
 * 50 ms dentro da página (mede se a página está com a thread ocupada ou com timers estrangulados).
 */
function observadorDaPartida(page: Page) {
  const t0 = Date.now();
  let marca = "", desde = t0, ultimaOlhada = 0, ultimoAlarme = 0, ultimoErro = "";
  const seg = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  return {
    erro: (e: unknown) => { ultimoErro = String((e as Error)?.message ?? e).split("\n").slice(0, 4).join(" ⏎ ").slice(0, 300); },
    async talvez(i: number) {
      if (Date.now() - ultimaOlhada < 10_000) return;
      ultimaOlhada = Date.now();
      const agora = await page.evaluate(() =>
        `${document.querySelector('button[aria-label^="Mão"]')?.getAttribute("aria-label")?.slice(0, 7) ?? "-"} ${(document.body.innerText.match(/Vaza \d+\/13/) ?? ["-"])[0]}`,
      ).catch(() => "?");
      if (agora !== marca) { console.log(`[partida ${seg()}] it${i} ${agora}`); marca = agora; desde = Date.now(); return; }
      if (Date.now() - desde < 45_000 || Date.now() - ultimoAlarme < 45_000) return;
      ultimoAlarme = Date.now();
      const estado = await page.evaluate(async () => {
        const ini = performance.now();
        const atraso = await new Promise<number>((r) => setTimeout(() => r(performance.now() - ini), 50));
        const raf = await new Promise<number>((r) => { const a = performance.now(); requestAnimationFrame(() => r(performance.now() - a)); });
        const prox = [...document.querySelectorAll("button")].find((b) => /pr[oó]xima/i.test(b.textContent ?? ""));
        return JSON.stringify({
          timer50: Math.round(atraso), raf: Math.round(raf), vis: document.visibilityState, foco: document.hasFocus(),
          mao: document.querySelectorAll(".hand .card").length, jogaveis: document.querySelectorAll('.hand .card[role="button"]').length,
          sel: document.querySelectorAll(".hand .card.sel").length,
          telas: [".um", ".rc", ".placar", ".fim", ".trumpbtn", ".novorecorde"].filter((s) => document.querySelector(s)),
          proxima: prox ? (prox.disabled ? "desabilitado" : "habilitado") : "-",
          animacoes: document.getAnimations().length,
        });
      }).catch((e) => `avaliação falhou: ${String(e).slice(0, 120)}`);
      console.log(`[partida ${seg()}] PARADA há ${((Date.now() - desde) / 1000).toFixed(0)}s em "${marca}" it${i} ${estado} último erro: ${ultimoErro || "-"}`);
    },
  };
}
const preparoDoSolo = (page: Page) => page.addInitScript(() => {
  try {
    localStorage.setItem("king.audio", JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
    localStorage.setItem("king:tutorial", JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
  } catch { /* segue */ }
});
async function comecarSolo(page: Page): Promise<void> {
  await page.getByRole("button", { name: /jogar agora/i }).click();
  const seletor = page.locator(".hm-avdialogo");
  if (await seletor.count()) { await seletor.locator(".hm-av").first().click(); await expect(seletor).toHaveCount(0, { timeout: 10_000 }); }
}

test("partida de DEPURAÇÃO (?mao=10) chega ao placar final e NÃO vira recorde nem celebra", async ({ page }, ti) => {
  test.skip(ti.project.name !== "852x393", "comportamento, não geometria");
  test.setTimeout(240_000);
  await preparoDoSolo(page);
  await page.goto("/?mao=10");
  await comecarSolo(page);
  await jogarAteOFim(page);
  await expect(page.locator(".fimacoes")).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.locator(".novorecorde")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("king:recordes:solo"))).toBeNull();
});

test("partida SOLO INTEIRA (10 mãos): entra no Top 3, celebra UMA vez depois da encenação, e a tela mostra o recorde", async ({ page }, ti) => {
  test.skip(ti.project.name !== "852x393", "uma partida inteira basta; a geometria tem teste próprio");
  test.setTimeout(900_000);
  await preparoDoSolo(page);
  await page.goto("/");
  await comecarSolo(page);
  await jogarAteOFim(page);
  await expect(page.locator(".fimacoes")).toBeVisible();
  const cel = page.locator(".novorecorde");
  await expect(cel).toBeVisible({ timeout: 5_000 });
  await expect(cel.locator(".nr-titulo")).toHaveText("NOVO RECORDE!");
  await expect(cel.locator(".nr-posicao")).toHaveText("1º do seu Top 3 · Solo");
  const placar = await page.evaluate(() => JSON.parse(localStorage.getItem("king:recordes:solo")!));
  expect(placar.top).toHaveLength(1);
  const sinal = (n: number) => (n > 0 ? `+${n.toLocaleString("pt-BR")}` : n < 0 ? `−${(-n).toLocaleString("pt-BR")}` : "0");
  await expect(cel.locator(".nr-pontos")).toHaveText(`${sinal(placar.top[0].pontos)} pts`);
  // a pontuação é a do placar final do jogador (o "Você" da linha dele)
  const minhaLinha = await page.locator(".fimlinha.voce .sc").textContent();
  expect(Number((minhaLinha ?? "").replace("−", "-").replace(/[^\d-]/g, ""))).toBe(placar.top[0].pontos);
  if (process.env.KING_SHOTS) { await page.waitForTimeout(900); await page.screenshot({ path: `${process.env.KING_SHOTS}/celebracao-recorde-solo-${ti.project.name}.png` }); }
  await cel.click();
  await expect(cel).toHaveCount(0, { timeout: 2_000 });
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("king:recordes:celebrados") ?? "[]").length)).toBe(1);
  // voltar à Home e abrir os recordes: o mesmo número, uma linha só
  await page.getByRole("button", { name: /^home$/i }).click();
  await page.locator(".recordesbtn").click();
  await expect(tela(page).locator(".rec-top .rec-pontos")).toHaveText([`${sinal(placar.top[0].pontos)} pts`]);
});
