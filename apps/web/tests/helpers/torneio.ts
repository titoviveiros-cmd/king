/**
 * Ajudantes dos E2E do mini-torneio (web e Android simulado).
 *
 * NADA AQUI DECIDE RESULTADO. A partida do humano é jogada pela interface de verdade: o teste toca
 * na carta (ou no trunfo) que o Bot Normal jogaria no lugar dele, perguntando ao piloto de teste
 * (`src/torneio/pilotoDeTeste.ts`, que só existe nos builds de e2e). O motor, os bots, o sorteio e
 * o desempate seguem sendo os do jogo.
 */
import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SEL } from "./mesa.js";

/** A grafia antiga, em qualquer caixa, com ou sem espaço. A oficial (com hífen) não casa. */
export const GRAFIA_ANTIGA = /mini\s*torneio/i;

type Sugestao = { tipo: "trunfo"; rotulo: string } | { tipo: "carta"; rotulo: string } | null;

/** O texto que a pessoa vê (e ouve pelo leitor de tela) não pode ter a grafia antiga. */
export async function semGrafiaAntiga(page: Page, onde: string): Promise<void> {
  const texto = await page.evaluate(() => {
    const rotulos = [...document.querySelectorAll("[aria-label],[title],[placeholder],[alt]")]
      .map((e) => ["aria-label", "title", "placeholder", "alt"].map((a) => e.getAttribute(a) ?? "").join(" "));
    return [document.title, document.body.innerText, document.body.textContent ?? "", ...rotulos].join("\n");
  });
  expect(texto, `grafia antiga na tela: ${onde}`).not.toMatch(GRAFIA_ANTIGA);
}

export async function semRolagemLateral(page: Page, onde: string): Promise<void> {
  const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  expect(o.s, `rolagem lateral em ${onde}`).toBeLessThanOrEqual(o.c + 1);
}

/** O botão precisa estar inteiro na tela (rolando o corpo da tela, se for o caso) e clicável. */
export async function tocar(page: Page, nome: RegExp | string): Promise<void> {
  const b = page.getByRole("button", { name: nome }).first();
  await expect(b).toBeVisible({ timeout: 30_000 });
  await b.scrollIntoViewIfNeeded();
  await dentroDaTela(page, b, `botão ${String(nome)}`);
  await b.click();
}

/** A caixa inteira dentro da viewport (com 1 px de folga de arredondamento). */
export async function dentroDaTela(page: Page, alvo: ReturnType<Page["locator"]>, oque: string): Promise<void> {
  const box = await alvo.boundingBox();
  const vp = page.viewportSize()!;
  expect(box, `${oque} sem caixa`).not.toBeNull();
  expect(box!.x, `${oque} cortado à esquerda`).toBeGreaterThanOrEqual(-1);
  expect(box!.y, `${oque} cortado em cima`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${oque} cortado à direita`).toBeLessThanOrEqual(vp.width + 1);
  expect(box!.y + box!.height, `${oque} cortado embaixo`).toBeLessThanOrEqual(vp.height + 1);
}

/** Captura para revisão visual, só quando `KING_TELAS_DIR` aponta uma pasta (nunca no CI). */
export async function foto(page: Page, info: TestInfo, nome: string): Promise<void> {
  const dir = process.env.KING_TELAS_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${info.project.name}-${nome}.png`) });
}

/**
 * Joga a partida do humano até a classificação da mesa, tocando no que o Bot Normal jogaria.
 * O anúncio da última mão (`.um`) é dispensado por toque, como a pessoa faria.
 */
export async function jogarComPiloto(page: Page): Promise<void> {
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__kingPilotoDoTorneio),
    { message: "o piloto de teste não está no build (o build de e2e foi usado?)" }).toBe("function");
  for (let i = 0; i < 1500; i++) {
    if (await page.locator(".tn-tabela").count()) break;
    const anuncio = page.locator(".um");
    // O anúncio sai sozinho: entre o count() e o clique ele pode sumir — clique com prazo curto.
    if (await anuncio.count()) { await anuncio.click({ timeout: 2000 }).catch(() => {}); continue; }
    const s = await page.evaluate(() => (window as unknown as { __kingPilotoDoTorneio: () => Sugestao }).__kingPilotoDoTorneio());
    if (s?.tipo === "trunfo") {
      const b = page.locator(".trumpbtn", { hasText: s.rotulo });
      if (await b.count()) { await b.first().click({ timeout: 2000 }).catch(() => {}); continue; }
    } else if (s?.tipo === "carta") {
      const carta = page.locator(`.hand .card[role="button"][aria-label="${s.rotulo}"]`);
      if (await carta.count()) {
        // O leque SOBREPÕE as cartas: o ponto de toque de uma pode cair na vizinha. O evento vai
        // direto à carta escolhida. No toque (ponteiro grosso) o 1º toque seleciona e o 2º joga.
        await carta.dispatchEvent("click").catch(() => {});
        const sel = page.locator(`.hand .card.sel[role="button"][aria-label="${s.rotulo}"]`);
        if (await sel.count()) await sel.dispatchEvent("click").catch(() => {});
        continue;
      }
    }
    await page.waitForTimeout(120);
  }
  await expect(page.locator(".tn-tabela"), "a partida não voltou para a classificação do torneio").toBeVisible({ timeout: 30_000 });
  // O Placar Final do solo NÃO aparece no torneio ("Jogar novamente" refaria uma mesa decidida).
  await expect(page.locator(".fim")).toHaveCount(0);
}

/**
 * O encaminhamento da chave, lido do DOM: cada mesa da fase f+1 reúne exatamente os que passaram
 * (✓) nas mesas 2k e 2k+1 da fase f. Na final só o campeão leva o selo.
 */
export async function conferirEncaminhamento(page: Page, fases: number): Promise<void> {
  const colunas = await page.locator(".tn-chave .tn-col").evaluateAll((cols) =>
    cols.map((c) => [...c.querySelectorAll(".tn-mesa:not(.tn-mesa-vaga)")].map((m) => ({
      nomes: [...m.querySelectorAll(".tn-nome")].map((n) => n.textContent ?? ""),
      passaram: [...m.querySelectorAll("li.tn-passou .tn-nome")].map((n) => n.textContent ?? ""),
    }))));
  expect(colunas).toHaveLength(fases);
  for (let f = 0; f + 1 < fases; f++) {
    expect(colunas[f + 1].length * 2, `fase ${f + 1}: metade das mesas da fase ${f}`).toBe(colunas[f].length);
    colunas[f + 1].forEach((mesa, k) => {
      const vindos = [...colunas[f][2 * k].passaram, ...colunas[f][2 * k + 1].passaram].sort();
      expect([...mesa.nomes].sort(), `mesa ${k} da fase ${f + 1}`).toEqual(vindos);
    });
    for (const m of colunas[f]) expect(m.passaram, `fase ${f}: 2 avançam por mesa`).toHaveLength(2);
  }
  expect(colunas[fases - 1]).toHaveLength(1);
  expect(colunas[fases - 1][0].passaram).toHaveLength(1);
}

/** Marca, no próprio navegador, quando a celebração entra e sai (performance.now()). */
export const RELOGIO_DA_CELEBRACAO = () => {
  const w = window as unknown as { __celebra: Array<{ inicio: number; fim?: number }> };
  w.__celebra = [];
  new MutationObserver(() => {
    const aberta = !!document.querySelector(".tn-celebra");
    const ultima = w.__celebra[w.__celebra.length - 1];
    if (aberta && (!ultima || ultima.fim !== undefined)) w.__celebra.push({ inicio: performance.now() });
    else if (!aberta && ultima && ultima.fim === undefined) ultima.fim = performance.now();
  }).observe(document, { childList: true, subtree: true });
};

export async function celebracoes(page: Page): Promise<Array<{ inicio: number; fim?: number }>> {
  return page.evaluate(() => (window as unknown as { __celebra: Array<{ inicio: number; fim?: number }> }).__celebra);
}

/**
 * Observa a rede da página: tudo que não for o próprio preview (HTTP) e TODO WebSocket. O mini-torneio
 * não fala com servidor nenhum — nem Colyseus, nem Supabase, nem progresso/XP.
 */
export function vigiarRede(page: Page, origemDoApp: string) {
  const externas: string[] = [];
  const sockets: string[] = [];
  const ligado = { v: false };
  page.on("request", (r) => {
    if (!ligado.v) return;
    const u = r.url();
    if (u.startsWith("data:") || u.startsWith("blob:")) return;
    if (!u.startsWith(origemDoApp)) externas.push(`${r.method()} ${u}`);
  });
  page.on("websocket", (ws) => { if (ligado.v) sockets.push(ws.url()); });
  return {
    ligar: () => { ligado.v = true; },
    desligar: () => { ligado.v = false; },
    externas,
    sockets,
  };
}
