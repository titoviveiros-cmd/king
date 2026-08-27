/**
 * O BALÃO SOCIAL NA MESA — UM LADO POR ASSENTO.
 *
 * ══ O QUE A MEDIÇÃO ENCONTROU ══
 *
 * O relato foi que a mensagem de uma jogadora lateral colidia com o card de Trunfo. Medindo os
 * quatro assentos numa partida real com trunfo, TRÊS estavam errados:
 *
 *   • ESQUERDA — subia direto para dentro do card de Trunfo, que mora na mesma coluna, logo
 *     acima do card. A 852x300: balão x 18..144 / y 135..159 contra trunfo x 9..127 / y 99..144.
 *   • TOPO — o card subiu numa rodada anterior e acima dele não sobrou nada. O balão nascia em
 *     y −11: inteiramente fora da tela. Ninguém nunca viu uma mensagem do jogador de cima.
 *   • VOCÊ — ancorado por `right:0` num card de 90px, um balão de 126px começava em x −35.
 *     Também fora da tela, e é por isso que "nem quem enviou via".
 *   • DIREITA — o único correto, e o único que não mudou.
 *
 * ══ POR QUE ESTE TESTE INJETA O BALÃO ══
 *
 * Fazer um bot mandar mensagem não é possível, e esperar que a distribuição entregue os quatro
 * assentos falando seria testar a sorte. A POSIÇÃO do balão é CSS puro ancorado no card do
 * assento — não depende de quem falou, nem do texto. Injetar um balão em cada card mede a mesma
 * geometria que o produto produz, nos quatro, de forma determinística. O texto injetado é a frase
 * MAIS LONGA do catálogo fechado, que é o pior caso de largura.
 *
 * O que o teste NÃO faz é afirmar que a mensagem chega — isso é `socialPlacar.spec.ts`, com dois
 * clientes de verdade e o servidor no meio.
 */
import { test, expect, type Page } from "@playwright/test";
import { SEL } from "./helpers/mesa.js";
import { insideViewport, overlapArea, type Box } from "./helpers/geometry.js";

const PASTA = process.env.KING_SHOTS;
/** A pior largura possível: 23 caracteres, a maior frase de `social.ts`. */
const FRASE_MAIS_LONGA = "−160 com carinho 😈";

const ASSENTOS = [
  { sel: ".youtag", rotulo: "jogador inferior" },
  { sel: ".opp.left", rotulo: "lateral esquerdo" },
  { sel: ".opp.top", rotulo: "jogador superior" },
  { sel: ".opp.right", rotulo: "lateral direito" },
] as const;

/** Tudo que o balão não pode cobrir. Cartas entram por último, e todas. */
const INTOCAVEIS = [
  ".trumpslot", ".hud", ".topbtn", ".mprelogio", ".confirmchip", ".castigo",
] as const;

async function mesaPositivaComTrunfo(page: Page): Promise<boolean> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  // A mão 7 é positiva: é ela que faz nascer o card de Trunfo, que é o vizinho em disputa.
  await page.goto("/?seed=42&mao=7");
  await page.locator(SEL.startBtn).click();
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  for (let i = 0; i < 40; i++) {
    if (await page.locator(".trumpslot").count()) return true;
    const t = page.locator(".trumpbtn").first();
    if (await t.count()) { await t.click({ timeout: 4000 }).catch(() => {}); continue; }
    await page.waitForTimeout(200);
  }
  return (await page.locator(".trumpslot").count()) > 0;
}

/** Põe um balão no card do assento e devolve a caixa dele. Remove tudo ao sair. */
async function balaoEm(page: Page, sel: string): Promise<Box | null> {
  return page.evaluate(({ sel, texto }) => {
    document.querySelectorAll(".balao").forEach((n) => n.remove());
    const card = document.querySelector(sel);
    if (!card) return null;
    const b = document.createElement("span");
    b.className = "balao";
    b.textContent = texto;
    card.appendChild(b);
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, { sel, texto: FRASE_MAIS_LONGA });
}

async function caixasDe(page: Page, sel: string): Promise<Box[]> {
  const caixas: Box[] = [];
  for (const el of await page.locator(sel).all()) {
    const b = await el.boundingBox();
    if (b && b.width > 0 && b.height > 0) caixas.push(b as Box);
  }
  return caixas;
}

for (const assento of ASSENTOS) {
  test(`o balão do ${assento.rotulo} não cobre o Trunfo nem carta nenhuma`, async ({ page }, ti) => {
    test.setTimeout(120_000);
    const vp = page.viewportSize()!;
    test.skip(!(await mesaPositivaComTrunfo(page)), "a mão positiva não montou dentro do orçamento");

    const balao = await balaoEm(page, assento.sel);
    expect(balao, `o card do ${assento.rotulo} não existe nesta mesa`).not.toBeNull();

    // ── 1 · ESTÁ NA TELA. Foi assim que o do topo e o do jogador local se perderam: nasciam em
    //        coordenada negativa e ninguém nunca os viu.
    expect(
      insideViewport(balao!, vp, 1),
      `[${ti.project.name}] o balão do ${assento.rotulo} saiu da tela: ` +
      `x ${Math.round(balao!.x)}..${Math.round(balao!.x + balao!.width)}, ` +
      `y ${Math.round(balao!.y)}..${Math.round(balao!.y + balao!.height)}`,
    ).toBe(true);

    // ── 2 · NÃO COBRE O TRUNFO. Feedback passageiro não esconde informação permanente.
    for (const sel of INTOCAVEIS) {
      for (const [i, alvo] of (await caixasDe(page, sel)).entries()) {
        expect(
          Math.round(overlapArea(balao!, alvo)),
          `[${ti.project.name}] o balão do ${assento.rotulo} cobre ${sel}[${i}]`,
        ).toBe(0);
      }
    }

    // ── 3 · NEM CARTA NENHUMA: as da vaza e as do leque.
    for (const [i, carta] of (await caixasDe(page, ".card")).entries()) {
      expect(
        Math.round(overlapArea(balao!, carta)),
        `[${ti.project.name}] o balão do ${assento.rotulo} cobre a carta ${i}`,
      ).toBe(0);
    }

    // ── 4 · NEM O CARD DE OUTRO JOGADOR. Cobrir o próprio é aceitável quando não há para onde
    //        ir (é o caso do topo em tela baixa); cobrir o de outro trocaria o autor da fala.
    for (const outro of ASSENTOS) {
      if (outro.sel === assento.sel) continue;
      for (const alvo of await caixasDe(page, outro.sel)) {
        expect(
          Math.round(overlapArea(balao!, alvo)),
          `[${ti.project.name}] o balão do ${assento.rotulo} cobre o card do ${outro.rotulo}`,
        ).toBe(0);
      }
    }

    if (PASTA) {
      const nome = assento.rotulo.replace(/[^\w]+/g, "-");
      await page.screenshot({ path: `${PASTA}/social-trunfo-${nome}-${ti.project.name}.png` });
    }
  });
}

/**
 * OS QUATRO AO MESMO TEMPO.
 *
 * Um por vez prova que cada direção é livre. Os quatro juntos provam que as direções não foram
 * escolhidas para o mesmo lugar — que é o erro fácil de cometer quando se resolve um assento de
 * cada vez.
 */
test("os quatro balões coexistem sem se cobrirem", async ({ page }, ti) => {
  test.setTimeout(120_000);
  const vp = page.viewportSize()!;
  test.skip(!(await mesaPositivaComTrunfo(page)), "a mão positiva não montou dentro do orçamento");

  const caixas = await page.evaluate(({ alvos, texto }) => {
    document.querySelectorAll(".balao").forEach((n) => n.remove());
    const out: { rotulo: string; caixa: { x: number; y: number; width: number; height: number } }[] = [];
    for (const { sel, rotulo } of alvos) {
      const card = document.querySelector(sel);
      if (!card) continue;
      const b = document.createElement("span");
      b.className = "balao";
      b.textContent = texto;
      card.appendChild(b);
    }
    for (const { sel, rotulo } of alvos) {
      const b = document.querySelector(`${sel} .balao`);
      if (!b) continue;
      const r = b.getBoundingClientRect();
      out.push({ rotulo, caixa: { x: r.x, y: r.y, width: r.width, height: r.height } });
    }
    return out;
  }, { alvos: ASSENTOS.map((a) => ({ sel: a.sel, rotulo: a.rotulo })), texto: FRASE_MAIS_LONGA });

  expect(caixas.length, "nem todos os assentos têm card nesta mesa").toBe(ASSENTOS.length);
  for (const { rotulo, caixa } of caixas) {
    expect(insideViewport(caixa as Box, vp, 1), `${rotulo} fora da tela`).toBe(true);
  }
  for (let i = 0; i < caixas.length; i++) {
    for (let j = i + 1; j < caixas.length; j++) {
      expect(
        Math.round(overlapArea(caixas[i].caixa as Box, caixas[j].caixa as Box)),
        `[${ti.project.name}] o balão de ${caixas[i].rotulo} cobre o de ${caixas[j].rotulo}`,
      ).toBe(0);
    }
  }

  if (PASTA) await page.screenshot({ path: `${PASTA}/social-quatro-assentos-${ti.project.name}.png` });
});
