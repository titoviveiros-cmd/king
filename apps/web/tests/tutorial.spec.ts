/**
 * APRENDA KING no navegador real, em cada viewport do projeto.
 *
 * O que os testes de unidade não conseguem provar e este arquivo prova:
 *   • o tutorial se apresenta sozinho na primeira visita — e nunca mais depois;
 *   • dá para CONCLUIR do começo ao fim sem ficar preso em passo nenhum;
 *   • a cromagem do tutorial não cobre HUD, card do jogador nem controles do topo;
 *   • pular funciona, e pular não é concluir;
 *   • com movimento reduzido e com áudio desligado, tudo continua funcionando.
 *
 * A varredura de colisões é a mesma disciplina de `layout.spec.ts`: componentes DIFERENTES não
 * podem se cruzar. Foi assim que se descobriu que a barra de progresso caía sobre o HUD do
 * contrato — justamente o HUD que o passo 3 manda o jogador olhar.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { intersects, insideViewport, fmt, type Box, type Viewport } from "./helpers/geometry.js";
import { boxOf, SEL } from "./helpers/mesa.js";

const SUBPIXEL = 1;

const vpOf = (page: Page): Viewport => {
  const v = page.viewportSize();
  if (!v) throw new Error("viewport não definido");
  return v;
};

/**
 * Primeira visita de verdade.
 *
 * NÃO limpa `king:tutorial` aqui, e a razão é uma armadilha que custou uma rodada de testes:
 * `addInitScript` roda a CADA navegação, inclusive no `reload()`. Limpar o progresso ali fazia
 * o tutorial reabrir depois do reload e reprovava os testes que checam justamente o contrário.
 * Não é preciso limpar: o Playwright dá um contexto novo por teste, com armazenamento vazio.
 *
 * O áudio, sim, precisa ser desligado antes do primeiro load (evita nós de Web Audio no
 * headless) — e desligado é como deve ficar durante toda a suíte.
 */
async function primeiraVisita(page: Page, extra?: () => void): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }),
      );
    } catch { /* headless sem storage: segue */ }
  });
  if (extra) await page.addInitScript(extra);
  await page.goto("/");
}

/**
 * Percorre o tutorial inteiro clicando o que estiver disponível: Continuar, um naipe de trunfo
 * ou uma carta legal. Devolve a trilha para o erro dizer ONDE travou.
 */
/**
 * O alvo está REALMENTE ao alcance de um dedo?
 *
 * O Playwright rola o elemento para dentro da tela antes de clicar, então um clique dele passa
 * mesmo quando um humano não conseguiria tocar. Numa tela que não rola — a Mesa — isso esconde
 * exatamente o defeito que o teste deveria pegar. Por isso a checagem é explícita: o alvo tem de
 * caber inteiro no viewport ANTES do clique, e o ponto central tem de pertencer a ele.
 */
async function exigirAoAlcance(
  page: Page, alvo: Locator, oQue: string, passo: string, trilha: string[],
): Promise<void> {
  const caixa = await alvo.boundingBox();
  const vp = page.viewportSize();
  if (!caixa || !vp) throw new Error(`${oQue} sem caixa no passo ${passo}`);

  const fora =
    caixa.y < 0 ? "acima do topo"
      : caixa.y + caixa.height > vp.height
        ? `abaixo da base (termina em ${Math.round(caixa.y + caixa.height)} de ${vp.height})`
        : caixa.x < 0 ? "à esquerda"
          : caixa.x + caixa.width > vp.width ? "à direita" : null;

  if (fora) {
    throw new Error(
      `DEADLOCK no passo ${passo}: ${oQue} está ${fora} — um dedo não alcança.\n` +
      `   caixa: x=${Math.round(caixa.x)} y=${Math.round(caixa.y)} ` +
      `${Math.round(caixa.width)}x${Math.round(caixa.height)} - viewport ${vp.width}x${vp.height}\n` +
      `   trilha: ${trilha.join(" -> ")}`,
    );
  }

  // E o toque precisa CHEGAR nele. O critério certo é conter, não ser igual: `elementFromPoint`
  // devolve o elemento mais interno, que num card é um filho (o pip do naipe) — e o evento sobe
  // até o card do mesmo jeito. Comparar por classe dava falso positivo exatamente aí.
  const alcanca = await alvo.evaluate((el, [x, y]) => {
    const noPonto = document.elementFromPoint(x, y);
    return {
      chega: !!noPonto && el.contains(noPonto),
      quem: noPonto ? (noPonto.className || noPonto.tagName).toString().slice(0, 40) : "nada",
    };
  }, [caixa.x + caixa.width / 2, caixa.y + caixa.height / 2] as [number, number]);

  if (!alcanca.chega) {
    throw new Error(
      `DEADLOCK no passo ${passo}: ${oQue} está COBERTO por "${alcanca.quem}" no seu ponto central.\n` +
      `   trilha: ${trilha.join(" -> ")}`,
    );
  }
}

async function percorrer(page: Page, limite = 60): Promise<string[]> {
  const trilha: string[] = [];
  for (let i = 0; i < limite; i++) {
    if (!(await page.locator(".tut").count())) return trilha;
    const rotulo = (await page.locator(".tut-passo").textContent())?.trim() ?? "?";
    const ok = page.locator(".tut-ok");
    const trunfo = page.locator(".trumpbtn").first();
    const carta = page.locator(SEL.handCardLegal).first();

    if (await ok.count()) {
      await exigirAoAlcance(page, ok, "o botao Continuar", rotulo, trilha);
      trilha.push(`${rotulo}:continuar`);
      await ok.click();
    } else if (await trunfo.count()) {
      await exigirAoAlcance(page, trunfo, "o botao de trunfo", rotulo, trilha);
      trilha.push(`${rotulo}:trunfo`);
      await trunfo.click();
    } else if (await carta.count()) {
      await exigirAoAlcance(page, carta, "a carta legal", rotulo, trilha);
      trilha.push(`${rotulo}:carta`);
      await carta.click();
    } else {
      throw new Error(
        `TUTORIAL TRAVOU no passo ${rotulo} — nada clicável.\n   trilha: ${trilha.join(" -> ")}`,
      );
    }
    await page.waitForTimeout(120);
  }
  throw new Error(`tutorial não terminou em ${limite} passos: ${trilha.join(" -> ")}`);
}

test("primeira visita: o tutorial se apresenta sozinho, na mesa de verdade", async ({ page }) => {
  await primeiraVisita(page);

  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".tut-passo")).toHaveText(/^1\/\d+$/);
  // a mesa é a real: leque, adversários e HUD do contrato
  await expect(page.locator(SEL.handCard).first()).toBeVisible();
  await expect(page.locator(SEL.hud)).toBeVisible();
  await expect(page.locator(".opp")).toHaveCount(3);
  // e o Rei diz uma linha
  await expect(page.locator(".rei-fala")).toHaveCount(1);
});

test("a cromagem do tutorial não cobre HUD, card do jogador nem controles do topo", async ({ page }, ti) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  const vp = vpOf(page);
  const proj = ti.project.name;
  const barra = await boxOf(page.locator(".tut-barra"), "tut-barra");
  const rei = await boxOf(page.locator(".rei"), "rei");
  const alvos: [string, Box][] = [
    ["hud", await boxOf(page.locator(SEL.hud), "hud")],
    ["youtag", await boxOf(page.locator(SEL.youtag), "youtag")],
    ["topbtn", await boxOf(page.locator(SEL.topbtn), "topbtn")],
  ];

  for (const [nome, alvo] of alvos) {
    for (const [meuNome, meu] of [["tut-barra", barra], ["rei", rei]] as [string, Box][]) {
      expect(
        intersects(meu, alvo, SUBPIXEL),
        `[${proj} · ${vp.width}×${vp.height}] COLISÃO: ${meuNome} × ${nome}\n` +
        `   ${meuNome}: ${fmt(meu)}\n   ${nome}: ${fmt(alvo)}`,
      ).toBe(false);
    }
  }

  for (const [nome, caixa] of [["tut-barra", barra], ["rei", rei]] as [string, Box][]) {
    expect(
      insideViewport(caixa, vp, SUBPIXEL),
      `[${proj} · ${vp.width}×${vp.height}] FORA DO VIEWPORT: ${nome} ${fmt(caixa)}`,
    ).toBe(true);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, "a página não pode rolar na horizontal").toBe(false);
});

test("dá para concluir do começo ao fim, sem ficar preso", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  const trilha = await percorrer(page);

  // saiu do tutorial e caiu na Home
  await expect(page.locator(".tut")).toHaveCount(0);
  await expect(page.locator(".home")).toBeVisible();
  // e agiu de verdade em pelo menos uma carta e no trunfo
  expect(trilha.filter((t) => t.endsWith(":carta")).length).toBeGreaterThanOrEqual(3);
  expect(trilha.some((t) => t.endsWith(":trunfo"))).toBe(true);

  const salvo = await page.evaluate(() => window.localStorage.getItem("king:tutorial"));
  expect(salvo && JSON.parse(salvo).concluido).toBe(true);
});

test("concluído, não abre mais sozinho — e vira 'Rever'", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });
  await percorrer(page);

  await page.reload();
  await expect(page.locator(".home")).toBeVisible();
  await expect(page.locator(".tut")).toHaveCount(0);
  await expect(page.locator(".hm-tutorial")).toHaveText(/rever/i);

  // e continua acessível para quem quiser
  await page.locator(".hm-tutorial").click();
  await expect(page.locator(".tut")).toBeVisible();
  await expect(page.locator(".tut-passo")).toHaveText(/^1\//);
});

test("pular pede confirmação, sai — e pular NÃO é concluir", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  await page.locator(".tut-ok").click();          // avança um passo, para haver progresso
  await page.locator(".tut-pular").click();
  await expect(page.locator(".tut-confirma")).toBeVisible();

  // desistir de sair mantém o tutorial
  await page.locator(".tut-confirma .btn.ghost").click();
  await expect(page.locator(".tut-confirma")).toHaveCount(0);
  await expect(page.locator(".tut")).toBeVisible();

  await page.locator(".tut-pular").click();
  await page.locator(".tut-confirma .btn.violet").click();
  await expect(page.locator(".home")).toBeVisible();

  const salvo = await page.evaluate(() => window.localStorage.getItem("king:tutorial"));
  const p = JSON.parse(salvo!);
  expect(p.iniciado, "pulou, mas já tinha começado").toBe(true);
  expect(p.concluido, "pular não é concluir").toBe(false);
  // não se impõe de novo, mas guardou onde parou
  await page.reload();
  await expect(page.locator(".tut")).toHaveCount(0);
  await expect(page.locator(".hm-tutorial")).toHaveText(/aprenda/i);
});

test("com MOVIMENTO REDUZIDO, o tutorial continua completável", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });
  await percorrer(page);
  await expect(page.locator(".home")).toBeVisible();
});

test("com ÁUDIO E VIBRAÇÃO DESLIGADOS, nada depende do som", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(String(e)));

  await primeiraVisita(page); // primeiraVisita já grava música/efeitos/haptics em false
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  // a instrução do passo continua legível sem som nenhum
  await expect(page.locator(".rei-fala")).toHaveText(/\S/);
  await percorrer(page);
  await expect(page.locator(".home")).toBeVisible();
  expect(erros, `erros de página: ${erros.join(" | ")}`).toEqual([]);
});

/**
 * A COROA DO REI não pode cruzar nada do jogo.
 *
 * No iPhone real ela apareceu por cima do avatar do jogador local. A faixa do guia é alinhada à
 * direita e o card do jogador mora na esquerda, então a colisão depende da largura da fala — o
 * que muda com o viewport. Por isso a verificação é por `DOMRect`, em todos eles.
 */
test("a coroa do guia não cruza avatar, cartas nem HUD", async ({ page }, ti) => {
  const vp = page.viewportSize()!;
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  const caixa = async (sel: string) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`${sel} sem caixa`);
    return b;
  };
  const cruza = (a: { x: number; y: number; width: number; height: number },
                 b: { x: number; y: number; width: number; height: number }) =>
    !(a.x + a.width < b.x || a.x > b.x + b.width || a.y + a.height < b.y || a.y > b.y + b.height);

  const coroa = await caixa(".rei-cara");
  const alvos: [string, string][] = [
    ["avatar do jogador local", `${SEL.youtag} .av`],
    ["card do jogador local", SEL.youtag],
    ["HUD do contrato", SEL.hud],
    ["utilidades do topo", SEL.topbtn],
  ];

  for (const [nome, sel] of alvos) {
    const alvo = await caixa(sel);
    expect(
      cruza(coroa, alvo),
      `[${ti.project.name} · ${vp.width}x${vp.height}] a coroa cruza ${nome}\n` +
      `   coroa: x ${Math.round(coroa.x)}..${Math.round(coroa.x + coroa.width)} ` +
      `y ${Math.round(coroa.y)}..${Math.round(coroa.y + coroa.height)}\n` +
      `   ${nome}: x ${Math.round(alvo.x)}..${Math.round(alvo.x + alvo.width)} ` +
      `y ${Math.round(alvo.y)}..${Math.round(alvo.y + alvo.height)}`,
    ).toBe(false);
  }

  // e a coroa tem de estar inteira na tela
  expect(
    coroa.x >= 0 && coroa.y >= 0 && coroa.x + coroa.width <= vp.width && coroa.y + coroa.height <= vp.height,
    "a coroa saiu do viewport",
  ).toBe(true);
});

test("passo de AÇÃO se anuncia — o tutorial nunca parece travado", async ({ page }, ti) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  // avança até o primeiro passo que pede uma carta
  for (let i = 0; i < 10 && await page.locator(".tut-ok").count(); i++) {
    await page.locator(".tut-ok").click();
    await page.waitForTimeout(100);
  }

  const pedido = page.locator(".tut-acao");
  await expect(pedido, `[${ti.project.name}] passo de ação sem indicador`).toBeVisible();
  await expect(pedido).toContainText("SUA VEZ");
  // AVANÇAR não pode estar lá oferecendo uma saída que não existe
  await expect(page.locator(".tut-ok")).toHaveCount(0);
  // e a carta pedida está acesa e ao alcance
  await expect(page.locator(SEL.handCardLegal).first()).toBeVisible();
  await expect(page.locator(".tut")).toHaveClass(/agindo/);
});

test("VOLTAR relê a instrução anterior sem desfazer jogada", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  // no primeiro passo não há para onde voltar
  await expect(page.locator(".tut-voltar")).toBeDisabled();

  await page.locator(".tut-ok").click();
  await expect(page.locator(".tut-passo")).toHaveText(/^2\//);
  await expect(page.locator(".tut-voltar")).toBeEnabled();

  const falaDoDois = await page.locator(".rei-fala").textContent();
  await page.locator(".tut-voltar").click();
  await expect(page.locator(".tut-passo")).toHaveText(/^1\//);
  expect(await page.locator(".rei-fala").textContent()).not.toBe(falaDoDois);

  // e avançar de novo volta para o mesmo lugar
  await page.locator(".tut-ok").click();
  await expect(page.locator(".tut-passo")).toHaveText(/^2\//);
  expect(await page.locator(".rei-fala").textContent()).toBe(falaDoDois);
});

test("VOLTAR depois de jogar não pede a jogada de novo", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  // chega ao passo de ação e cumpre
  while (await page.locator(".tut-ok").count()) {
    await page.locator(".tut-ok").click();
    await page.waitForTimeout(100);
  }
  const rotuloDaAcao = (await page.locator(".tut-passo").textContent())?.trim();
  await page.locator(SEL.handCardLegal).first().click();
  await expect(page.locator(".tut-ok")).toBeVisible();
  await page.locator(".tut-ok").click();

  // volta para o passo da ação: ele já foi cumprido, então NÃO pode voltar a exigir a carta —
  // a jogada é irreversível no motor, e pedir de novo seria pedir o impossível.
  await page.locator(".tut-voltar").click();
  await expect(page.locator(".tut-passo")).toHaveText(new RegExp(`^${rotuloDaAcao?.split("/")[0]}/`));
  await expect(page.locator(".tut-acao")).toHaveCount(0);
  await expect(page.locator(".tut-ok")).toBeVisible();
});
