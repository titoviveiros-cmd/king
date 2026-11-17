/**
 * A HOME COM O CARD DE PROGRESSO **E** A PORTA DOS ITENS — o pior caso de largura, nos 13 tamanhos
 * da matriz principal (`playwright.config.ts`).
 *
 * O defeito que este arquivo trava: com a pílula 👑 no fim do card (Entrega B), a frase do convite
 * ("🔥 Comece hoje: jogue online") NÃO quebra linha e a pilha lateral podia encolher abaixo do
 * próprio texto (`min-width:0`). O texto então vazava por cima da pílula. A caixa do elemento
 * continuava dentro do card — por isso a medição antiga passava —, mas o TEXTO não.
 *
 * Aqui se mede o TEXTO de verdade (`Range.getBoundingClientRect`), não a caixa:
 *   - nenhum texto do card encosta em outro texto ou na pílula;
 *   - nenhum texto sai do card, e o card não sai da tela;
 *   - o card não cobre nenhum botão da Home.
 */
import { expect, test, type Page } from "@playwright/test";

const REF = "abcdefghijklmnopqrst";
const HOST = `https://${REF}.supabase.co`;
const CHAVE_DA_SESSAO = `sb-${REF}-auth-token`;
const UID = "11111111-1111-4111-8111-111111111111";

/** Os 13 da matriz principal. */
const TAMANHOS = [
  [667, 375], [740, 360], [780, 360], [800, 360], [844, 390], [852, 393], [874, 402], [956, 440],
  [1024, 768], [1600, 900], [852, 330], [740, 320], [852, 300],
] as const;

/** Os casos mais LARGOS de cada parte do card. */
const CASOS = {
  // o convite (a frase mais longa) com recorde, nível de um dígito
  convite: { player_id: UID, xp_total: 9999, nivel: 9, xp_no_nivel: 1234, xp_do_nivel: 1350,
    sequencia_atual: 0, sequencia_recorde: 365, sequencia_hoje: false, sequencia_ultimo_dia: "2026-03-12", sequencia_partida: null },
  // sequência longa, nível de dois dígitos
  viva: { player_id: UID, xp_total: 99999, nivel: 12, xp_no_nivel: 1234, xp_do_nivel: 1350,
    sequencia_atual: 364, sequencia_recorde: 365, sequencia_hoje: true, sequencia_ultimo_dia: "2026-10-01", sequencia_partida: null },
} as const;

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sessaoGuardada() {
  const agora = Math.floor(Date.now() / 1000);
  const jwt = [b64url({ alg: "HS256", typ: "JWT" }), b64url({ sub: UID, role: "authenticated", aud: "authenticated", exp: agora + 3600, is_anonymous: true }), "assinatura-ficticia"].join(".");
  return { access_token: jwt, refresh_token: "ficticio", token_type: "bearer", expires_in: 3600, expires_at: agora + 3600,
    user: { id: UID, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} } };
}

async function abrir(page: Page, linha: Record<string, unknown>) {
  await page.addInitScript(([k, v]) => {
    localStorage.setItem(k, v);
    // os itens já foram celebrados: a celebração não cobre a Home durante a medição
    localStorage.setItem("king:cosmeticos:celebrados", JSON.stringify({ "11111111-1111-4111-8111-111111111111":
      ["moldura-real", "baralho-imperial", "reacao-coroa", "mesa-vinho", "mesa-esmeralda"] }));
  }, [CHAVE_DA_SESSAO, JSON.stringify(sessaoGuardada())] as const);
  await page.route(`${HOST}/**`, async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/rest/v1/meu_progresso") return json(200, [linha]);
    if (p === "/rest/v1/cosmeticos_equipados") return json(200, []);
    return json(404, {});
  });
  await page.goto("/");
  await expect(page.locator(".pg-itens")).toBeVisible();
  await page.waitForFunction(() =>
    document.querySelector(".hm-progresso")!.getAnimations({ subtree: true }).every((a) => a.playState === "finished"));
}

interface Caixa { nome: string; x: number; y: number; w: number; h: number }

/** O retângulo do TEXTO de cada parte (não da caixa), a pílula, o card e os botões da Home. */
const medir = (page: Page) => page.evaluate(() => {
  const texto = (el: Element) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect(); };
  const cx = (nome: string, r: DOMRect) => ({ nome, x: r.x, y: r.y, w: r.width, h: r.height });
  const card = document.querySelector(".hm-progresso")!;
  const partes: Caixa[] = [];
  for (const sel of [".pg-nivel", ".pg-numeros", ".pg-total", ".pg-seq", ".pg-recorde"]) {
    const el = card.querySelector(sel);
    if (el && getComputedStyle(el).display !== "none") partes.push(cx(sel, texto(el)));
  }
  const barra = card.querySelector(".pg-barra");
  if (barra) partes.push(cx(".pg-barra", barra.getBoundingClientRect()));
  partes.push(cx(".pg-itens", card.querySelector(".pg-itens")!.getBoundingClientRect()));
  const botoes = [...document.querySelectorAll(".home button, .home a")]
    .filter((b) => !card.contains(b) && b.getBoundingClientRect().width > 0)
    .map((b) => cx(b.textContent?.trim().slice(0, 20) || b.className, b.getBoundingClientRect()));
  return { partes, card: cx("card", card.getBoundingClientRect()), botoes, vw: innerWidth, vh: innerHeight,
    rolaLado: document.documentElement.scrollWidth > innerWidth };
});

const cruza = (a: Caixa, b: Caixa, folga = 0) =>
  a.x < b.x + b.w - folga && b.x < a.x + a.w - folga && a.y < b.y + b.h - folga && b.y < a.y + a.h - folga;

for (const [caso, linha] of Object.entries(CASOS)) {
  test(`card de progresso + porta dos itens (${caso}): nenhum texto sobreposto, nos 13 tamanhos`, async ({ page }, ti) => {
    test.skip(ti.project.name !== "852x393", "o teste percorre os 13 tamanhos sozinho");
    test.setTimeout(120_000);
    await abrir(page, linha);
    const falhas: string[] = [];
    for (const [w, h] of TAMANHOS) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(60);
      const m = await medir(page);
      const t = `${w}x${h}`;
      if (m.rolaLado) falhas.push(`${t}: a Home rola para o lado`);
      if (m.card.x < 0 || m.card.x + m.card.w > m.vw + 0.5 || m.card.y + m.card.h > m.vh + 0.5) falhas.push(`${t}: o card sai da tela`);
      for (const p of m.partes) {
        if (p.x < m.card.x - 0.5 || p.x + p.w > m.card.x + m.card.w + 0.5) falhas.push(`${t}: o texto de ${p.nome} sai do card`);
      }
      for (let i = 0; i < m.partes.length; i++) {
        for (let j = i + 1; j < m.partes.length; j++) {
          const [a, b] = [m.partes[i], m.partes[j]];
          // dentro da pilha lateral as linhas são empilhadas: só a sobreposição real conta
          if (cruza(a, b, 0.5)) falhas.push(`${t}: ${a.nome} sobrepõe ${b.nome}`);
        }
      }
      for (const b of m.botoes) if (cruza(m.card, b, 0.5)) falhas.push(`${t}: o card cobre o botão "${b.nome}"`);
      if (process.env.KING_SHOTS) await page.screenshot({ path: `${process.env.KING_SHOTS}/home-card-${caso}-${t}.png` });
    }
    expect(falhas, falhas.join("\n")).toEqual([]);
  });
}
