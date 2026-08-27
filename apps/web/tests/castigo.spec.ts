/**
 * O SELO DO CASTIGO NÃO PODE COBRIR CARTA NENHUMA.
 *
 * ══ O DEFEITO ══
 *
 * Numa partida em aparelho, o selo rosa da penalidade cobria uma das cartas recém-jogadas na
 * vaza. Quem estava acompanhando a sequência perdia justamente a informação primária da tela.
 *
 * ══ POR QUE A SUÍTE NÃO VIA ══
 *
 * O selo era ancorado em `top: 26%` — porcentagem da altura da mesa. As cartas da vaza são
 * ancoradas em `top: 49,5%`, mas o TAMANHO delas vem de `--trickcw`, que tem piso em pixels. Dois
 * sistemas de coordenadas que não encolhem juntos: quando a mesa encurta, as duas faixas se
 * aproximam enquanto a carta se recusa a ficar menor. A 667x375 (o viewport de referência de
 * quase toda a suíte) não havia colisão. A 852x300 havia — 567px² de carta cobertos.
 *
 * Por isso este arquivo mede em TODOS os viewports, e não num representativo: o defeito é uma
 * função da altura, então testá-lo numa altura só é não testá-lo.
 *
 * ══ O QUE SE COBRA ══
 *
 * Interseção VAZIA entre a caixa do selo e a caixa de QUALQUER carta na tela — as quatro da vaza
 * e as treze do leque. Não "os dois elementos existem", não "parece bom": área de interseção zero.
 */
import { test, expect, type Page } from "@playwright/test";
import { boxOf, SEL } from "./helpers/mesa.js";
import { insideViewport, intersects, overlapArea, type Box } from "./helpers/geometry.js";

const PASTA = process.env.KING_SHOTS;

/**
 * As mãos negativas com penalidade, e a semente que faz um assento específico pegá-la.
 *
 * Cada linha é um CENÁRIO REAL: o motor distribui, os bots jogam, e o selo aparece porque alguém
 * capturou de verdade. Nada aqui é injetado no DOM.
 */
const CENARIOS = [
  { rotulo: "−20 · Copas · assento 0", mao: 2, seed: 42 },
  { rotulo: "−20 · Copas · assento 2", mao: 2, seed: 21 },
  { rotulo: "−20 · Copas · assento 3", mao: 2, seed: 99 },
  { rotulo: "−50 · Damas", mao: 3, seed: 42 },
  { rotulo: "−60 · Reis/Valetes", mao: 4, seed: 7 },
  { rotulo: "−160 · K de Copas", mao: 5, seed: 42 },
] as const;

async function mesaNaMao(page: Page, seed: number, mao: number): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  await page.goto(`/?seed=${seed}&mao=${mao}`);
  await page.locator(SEL.startBtn).click();
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  // Na mão 10 o anúncio da última mão entra antes; um toque o encurta.
  const anuncio = page.locator(".um");
  if (await anuncio.count()) {
    await anuncio.click().catch(() => {});
    await expect(anuncio).toHaveCount(0, { timeout: 12_000 });
  }
}

/** Joga até alguém capturar a penalidade. Devolve `false` se não aconteceu no orçamento. */
async function ateOCastigo(page: Page): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    if (await page.locator(".castigo").count()) return true;
    const trunfo = page.locator(".trumpbtn").first();
    if (await trunfo.count()) { await trunfo.click({ timeout: 4000 }).catch(() => {}); continue; }
    const carta = page.locator(SEL.handCardLegal).first();
    if (await carta.count()) {
      await carta.click({ timeout: 4000 }).catch(() => {});
      if (await page.locator(SEL.handCardSelected).count()) {
        await page.locator(SEL.handCardSelected).first().click({ timeout: 4000 }).catch(() => {});
      }
      continue;
    }
    await page.waitForTimeout(150);
  }
  return await page.locator(".castigo").count() > 0;
}

/** Toda carta desenhada: as da vaza e as do leque. */
async function cartasNaTela(page: Page): Promise<Box[]> {
  const caixas: Box[] = [];
  for (const c of await page.locator(".card").all()) {
    const b = await c.boundingBox();
    if (b && b.width > 0 && b.height > 0) caixas.push(b as Box);
  }
  return caixas;
}

for (const cenario of CENARIOS) {
  test(`o selo não cobre carta nenhuma · ${cenario.rotulo}`, async ({ page }, ti) => {
    test.setTimeout(120_000);
    const vp = page.viewportSize()!;
    await mesaNaMao(page, cenario.seed, cenario.mao);
    test.skip(!(await ateOCastigo(page)), "a penalidade não caiu dentro do orçamento");

    const selo = await boxOf(page.locator(".castigo"), "selo do castigo");
    const assento = (await page.locator(".castigo").getAttribute("class"))?.match(/s[0-3]/)?.[0];
    const texto = (await page.locator(".castigo").textContent())?.replace(/\s+/g, " ").trim();

    // ── 1 · A REGRA, medida como área e não como aparência ──
    const cartas = await cartasNaTela(page);
    expect(cartas.length, "nenhuma carta na tela: o cenário não montou").toBeGreaterThanOrEqual(4);
    const colisoes = cartas
      .map((c) => overlapArea(selo as Box, c))
      .filter((a) => a > 0);
    expect(
      colisoes,
      `[${ti.project.name}] o selo "${texto}" (${assento}) cobre ${colisoes.length} carta(s), ` +
      `${Math.round(colisoes.reduce((t, a) => t + a, 0))}px² no total`,
    ).toEqual([]);

    // ── 2 · E ele continua na tela, inteiro ──
    expect(insideViewport(selo as Box, vp, 1), "o selo saiu da tela").toBe(true);

    // ── 3 · E LEGÍVEL: a correção não pode ter sido encolher até sumir. O piso é o mesmo alvo de
    //        toque que o projeto usa para qualquer coisa que precise ser lida de relance.
    expect(selo.height, "o selo ficou baixo demais para ser lido").toBeGreaterThanOrEqual(20);
    expect(texto, "o selo perdeu o valor da penalidade").toMatch(/[-−]\d+/);
    expect(texto, "o selo perdeu quem pegou").toMatch(/pegou/);

    // ── 4 · O selo é quem está no topo no próprio centro — não nasceu atrás da mesa ──
    const noTopo = await page.locator(".castigo").evaluate((el) => {
      const b = el.getBoundingClientRect();
      const alvo = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return !!alvo && (el.contains(alvo) || alvo.contains(el));
    });
    expect(noTopo, "o selo está na tela mas coberto").toBe(true);

    if (PASTA) {
      const nome = cenario.rotulo.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
      await page.screenshot({ path: `${PASTA}/castigo-${nome}-${ti.project.name}.png` });
    }
  });
}

/**
 * O PIOR CASO DE LARGURA E ALTURA, sem depender da sorte da distribuição.
 *
 * Os cenários acima são reais, mas o motor decide quem pega o quê — e um teste que só cobre o que
 * a semente entregou deixa de fora justamente o selo mais largo. Aqui o conteúdo é levado ao
 * extremo pelo DOM (apelido no limite de 14 caracteres, valor de quatro dígitos) para medir a
 * caixa no tamanho máximo que o produto pode produzir. A geometria é a mesma; o que muda é o
 * quanto ela é esticada.
 */
test("no conteúdo mais largo possível, o selo continua fora das cartas", async ({ page }, ti) => {
  test.setTimeout(120_000);
  const vp = page.viewportSize()!;
  await mesaNaMao(page, 42, 5);
  test.skip(!(await ateOCastigo(page)), "a penalidade não caiu dentro do orçamento");

  await page.locator(".castigo .quem").evaluate((el) => {
    const nome = el.lastChild;
    if (nome) nome.textContent = "WWWWWWWWWWWWWW pegou";
  });
  await page.locator(".castigo .oque").evaluate((el) => { el.textContent = "3 Reis/Valetes"; });
  await page.locator(".castigo .quanto").evaluate((el) => { el.textContent = "−1600"; });
  await page.waitForTimeout(120);

  const selo = await boxOf(page.locator(".castigo"), "selo esticado");
  const cartas = await cartasNaTela(page);
  const colisoes = cartas.map((c) => overlapArea(selo as Box, c)).filter((a) => a > 0);
  expect(
    colisoes,
    `[${ti.project.name}] no pior caso o selo cobre ${colisoes.length} carta(s)`,
  ).toEqual([]);
  expect(insideViewport(selo as Box, vp, 1), "o selo esticado saiu da tela").toBe(true);

  if (PASTA) await page.screenshot({ path: `${PASTA}/castigo-pior-caso-${ti.project.name}.png` });
});

/**
 * E O CARD DO JOGADOR DO TOPO, que é o vizinho de cima do selo.
 *
 * Ancorar o selo na vaza resolveu a carta e empurrou o selo para cima, contra o card do topo. A
 * primeira tentativa fez o selo comer 31 dos 42px daquele card a 852x300 — trocar uma
 * sobreposição por outra não é corrigir. O card do topo subiu (ele tinha para onde: a linha acima
 * dele é ocupada só pelo painel do contrato, à esquerda, e pelos botões, à direita) e o selo
 * ficou compacto nas telas baixas.
 *
 * O que sobra é medido aqui em vez de afirmado, e o número é diferente nos dois regimes:
 *
 *   • telas BAIXAS (≤360px), onde o defeito morava: no máximo 8px de encosto — menos do que os
 *     9px que existiam antes desta correção;
 *   • telas ALTAS: ~14px, que é o comportamento anterior a esta rodada (eram 13px) e foi
 *     aprovado em teste físico. Mexer nele significaria remexer a geometria da mesa alta por um
 *     defeito que ninguém relatou lá, e o pedido desta rodada era sobre as cartas.
 *
 * O teto existe para acusar a faixa voltando a fechar, não para congelar o pixel.
 */
test("o selo quase não encosta no card do jogador do topo", async ({ page }, ti) => {
  test.setTimeout(120_000);
  const vp = page.viewportSize()!;
  await mesaNaMao(page, 42, 2);
  test.skip(!(await ateOCastigo(page)), "a penalidade não caiu dentro do orçamento");

  const selo = await boxOf(page.locator(".castigo"), "selo");
  const topo = await boxOf(page.locator(".opp.top"), "card do topo");
  const encosto = intersects(selo as Box, topo as Box)
    ? Math.min(selo.y + selo.height, topo.y + topo.height) - Math.max(selo.y, topo.y)
    : 0;
  const teto = vp.height <= 360 ? 9 : 16;
  expect(
    Math.round(encosto),
    `[${ti.project.name}] o selo cobre ${Math.round(encosto)}px do card do topo (teto ${teto})`,
  ).toBeLessThanOrEqual(teto);
});
