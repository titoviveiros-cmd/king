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

/**
 * A FAIXA TEM ESPAÇO PRÓPRIO — e é isso que este teste mede, não "quase não encosta".
 *
 * Histórico curto, porque explica a régua: três correções tentaram fazer a faixa CONVIVER com a
 * Mesa por baixo (mover para a direita, reservar corredor, mascarar o fundo). Todas passaram em
 * teste e foram reprovadas no aparelho, porque camada sobre camada é sobreposição administrada,
 * não sobreposição eliminada. Agora a faixa é uma fatia do topo e a Mesa começa onde ela acaba.
 * A verificação certa, portanto, é uma só: as duas caixas não se tocam, e tudo que é jogo mora
 * dentro da Mesa.
 */
test("a faixa do tutorial reserva o topo — a Mesa inteira começa abaixo dela", async ({ page }, ti) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  const vp = vpOf(page);
  const proj = ti.project.name;
  const faixa = await boxOf(page.locator(".tut-faixa"), "tut-faixa");
  const mesa = await boxOf(page.locator(".mesa"), "mesa");

  expect(
    Math.round(mesa.y),
    `[${proj} · ${vp.width}×${vp.height}] a Mesa invade a faixa: faixa ${fmt(faixa)}, mesa ${fmt(mesa)}`,
  ).toBeGreaterThanOrEqual(Math.round(faixa.y + faixa.height) - SUBPIXEL);

  // Nada do jogo pode cruzar a faixa. A lista é o que a pessoa precisa ver e tocar.
  const alvos: [string, Box][] = [
    ["hud", await boxOf(page.locator(SEL.hud), "hud")],
    ["youtag", await boxOf(page.locator(SEL.youtag), "youtag")],
    ["topbtn", await boxOf(page.locator(SEL.topbtn), "topbtn")],
    ["adversário do topo", await boxOf(page.locator(".opp.top"), "opp.top")],
    ["leque", await boxOf(page.locator(".hand"), "hand")],
    ["vaza", await boxOf(page.locator(".trick"), "trick")],
  ];
  for (const [nome, alvo] of alvos) {
    expect(
      intersects(faixa, alvo, SUBPIXEL),
      `[${proj} · ${vp.width}×${vp.height}] COLISÃO: faixa × ${nome}\n` +
      `   faixa: ${fmt(faixa)}\n   ${nome}: ${fmt(alvo)}`,
    ).toBe(false);
    expect(
      insideViewport(alvo, vp, SUBPIXEL),
      `[${proj} · ${vp.width}×${vp.height}] FORA DO VIEWPORT: ${nome} ${fmt(alvo)}`,
    ).toBe(true);
  }

  // E o que a faixa carrega continua inteiro na tela.
  for (const sel of [".tut-passo", ".tut-pular", ".tut-voltar", ".rei-fala"]) {
    const c = await boxOf(page.locator(sel), sel);
    expect(
      insideViewport(c, vp, SUBPIXEL),
      `[${proj} · ${vp.width}×${vp.height}] FORA DO VIEWPORT: ${sel} ${fmt(c)}`,
    ).toBe(true);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, "a página não pode rolar na horizontal").toBe(false);
});

/**
 * O PROGRESSO E O PULAR PRECISAM SER VISTOS E TOCADOS.
 *
 * Os dois vinham como texto miúdo e cinza. "Pouco destaque" e "pouca presença visual" não são
 * opinião quando a consequência é não saber em que etapa se está e não perceber que dá para sair.
 * Aqui a régua é o dedo (44px) e a tela (contido no viewport).
 */
test("progresso e Pular: visíveis, legíveis e com alvo de dedo", async ({ page }, ti) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });
  const vp = vpOf(page);

  await expect(page.locator(".tut-passo")).toHaveText(/^1\/16$/);
  await expect(page.locator(".tut-passo")).toHaveAttribute("aria-label", "Passo 1 de 16");

  const pular = await boxOf(page.locator(".tut-pular"), "tut-pular");
  expect(
    Math.round(pular.height),
    `[${ti.project.name} · ${vp.width}×${vp.height}] Pular com ${Math.round(pular.height)}px de altura`,
  ).toBeGreaterThanOrEqual(44 - SUBPIXEL);
  expect(insideViewport(pular, vp, SUBPIXEL), "Pular saiu da tela").toBe(true);

  // O badge do passo tem de ser MAIS pesado que a fala: é a âncora de "onde estou".
  const peso = await page.evaluate(() => {
    const g = (s: string) => getComputedStyle(document.querySelector(s)!);
    return {
      passo: parseFloat(g(".tut-passo b").fontSize),
      fala: parseFloat(g(".rei-fala").fontSize),
      fundo: g(".tut-passo").backgroundImage + g(".tut-passo").backgroundColor,
    };
  });
  expect(peso.passo, "o número do passo precisa ser maior que a fala").toBeGreaterThan(peso.fala);
  expect(peso.fundo, "o passo precisa de fundo próprio, não ser só texto").not.toMatch(/^none *rgba\(0, 0, 0, 0\)$/);
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

  // OS DEZESSEIS, um a um. Chegar ao fim não prova que nenhum passo foi pulado — prova só que a
  // saída existe. Aqui a trilha é conferida contador por contador: 1/16 até 16/16, na ordem e
  // sem buraco. Um passo de AÇÃO aparece duas vezes na trilha, e é assim que tem de ser: uma
  // para a carta ou o trunfo, outra para o Avançar que só surge depois da resposta do Rei.
  const vistos: string[] = [];
  for (const t of trilha) {
    const c = t.split(":")[0];
    if (vistos.at(-1) !== c) vistos.push(c);
  }
  expect(vistos).toEqual(Array.from({ length: 16 }, (_, i) => `${i + 1}/16`));

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

/**
 * VOLTAR PARA UM PASSO PRÁTICO JÁ CUMPRIDO, DENTRO DA MESMA MESA.
 *
 * O passo 4 (negar) e o 5 vivem na mesma cena. Voltar do 5 para o 4 não remonta nada: a carta que
 * o aluno jogou continua jogada, e o motor não desfaz jogada. Então o passo revisitado tem de
 * virar LEITURA. Se ele voltasse a exigir a carta, exigiria uma carta que não está mais na mão:
 * o pedido impossível, que é o deadlock clássico deste tutorial.
 */
test("VOLTAR depois de jogar, na mesma mesa, não pede a jogada de novo", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  // até 4/16, o passo de negar
  for (let i = 0; i < 12; i++) {
    if ((await page.locator(".tut-passo").textContent())?.trim() === "4/16") break;
    const ok = page.locator(".tut-ok"), carta = page.locator(SEL.handCardLegal).first();
    if (await ok.count()) await ok.click(); else if (await carta.count()) await carta.click();
    await page.waitForTimeout(110);
  }
  await expect(page.locator(".tut-passo")).toHaveText("4/16");
  await expect(page.locator(".tut-acao")).toBeVisible();

  await page.locator(SEL.handCardLegal).first().click();
  await expect(page.locator(".tut-ok")).toBeVisible();
  await page.locator(".tut-ok").click();
  await expect(page.locator(".tut-passo")).toHaveText("5/16");

  await page.locator(".tut-voltar").click();
  await expect(page.locator(".tut-passo")).toHaveText("4/16");
  await expect(page.locator(".tut-acao"), "voltou a pedir uma carta já jogada").toHaveCount(0);
  await expect(page.locator(".tut-ok")).toBeVisible();
});

/**
 * E O CASO OPOSTO: voltar ATRAVESSANDO cena remonta a mesa, e aí o passo prático volta a ser
 * prático — o que é correto, porque a carta voltou para a mão. O que não pode acontecer é pedir
 * a ação sem ter como cumpri-la.
 */
test("VOLTAR para um passo prático de outra cena continua jogável", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  // 3/16 é prático (servir) e 4/16 troca de cena
  for (let i = 0; i < 8; i++) {
    if ((await page.locator(".tut-passo").textContent())?.trim() === "3/16") break;
    await page.locator(".tut-ok").click();
    await page.waitForTimeout(110);
  }
  await page.locator(SEL.handCardLegal).first().click();
  await page.locator(".tut-ok").click();
  await expect(page.locator(".tut-passo")).toHaveText("4/16");

  await page.locator(".tut-voltar").click();
  await expect(page.locator(".tut-passo")).toHaveText("3/16");
  // pede a carta de novo, e a carta ESTÁ lá: pedido possível, não deadlock
  await expect(page.locator(".tut-acao")).toBeVisible();
  const carta = page.locator(SEL.handCardLegal).first();
  await expect(carta).toBeVisible();
  await exigirAoAlcance(page, carta, "a carta legal depois de voltar", "3/16", []);
  await carta.click();
  await expect(page.locator(".tut-ok")).toBeVisible();
});

/* ══════════════════ O FLUXO INTEIRO, MEDIDO A CADA PASSO ══════════════════
 *
 * O teste de conclusão prova que dá para chegar ao fim. Este prova outra coisa, que é onde os
 * defeitos reais moraram: que em NENHUM dos dezesseis passos a faixa encosta no jogo. Cada passo
 * troca a fala, e vários trocam a mesa inteira (cada mão negativa monta a sua). Medir só a foto
 * inicial deixaria passar exatamente o que o aparelho pegou.
 */
test("os dezesseis passos, um a um: sem colisão, sem clipping, sem travar", async ({ page }, ti) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });
  const vp = vpOf(page);
  const proj = ti.project.name;

  const trilha: string[] = [];
  const vistos: string[] = [];

  for (let i = 0; i < 60; i++) {
    if (!(await page.locator(".tut").count())) break;
    const rotulo = (await page.locator(".tut-passo").textContent())?.trim() ?? "?";
    if (vistos.at(-1) !== rotulo) vistos.push(rotulo);

    // 1. a faixa não toca no jogo, neste passo, nesta mesa
    const faixa = await boxOf(page.locator(".tut-faixa"), "tut-faixa");
    const daMesa = new Map<string, Box>();
    for (const [nome, sel] of [
      ["hud", SEL.hud], ["youtag", SEL.youtag], ["topbtn", SEL.topbtn],
      ["leque", ".hand"], ["vaza", ".trick"], ["adversário do topo", ".opp.top"],
      ["adversário da esquerda", ".opp.left"], ["adversário da direita", ".opp.right"],
    ] as [string, string][]) {
      const alvo = await boxOf(page.locator(sel), sel);
      daMesa.set(nome, alvo);
      expect(
        intersects(faixa, alvo, SUBPIXEL),
        `[${proj} · ${vp.width}×${vp.height}] passo ${rotulo}: faixa × ${nome}\n` +
        `   faixa: ${fmt(faixa)}\n   ${nome}: ${fmt(alvo)}`,
      ).toBe(false);
      expect(
        insideViewport(alvo, vp, SUBPIXEL),
        `[${proj} · ${vp.width}×${vp.height}] passo ${rotulo}: ${nome} cortado ${fmt(alvo)}`,
      ).toBe(true);
    }

    // 1b. E A MESA CONTINUA COERENTE COM MENOS ALTURA. Mover o tutorial para o topo encurtou a
    //     Mesa, e foi assim que o slot de trunfo passou a cobrir o adversário da esquerda na fase
    //     positiva: a coluna esquerda é uma pilha, e a pilha não cabia mais.
    if (await page.locator(".trumpslot").count()) {
      const slot = await boxOf(page.locator(".trumpslot"), "trumpslot");
      for (const nome of ["adversário da esquerda", "hud", "leque"]) {
        expect(
          intersects(slot, daMesa.get(nome)!, SUBPIXEL),
          `[${proj} · ${vp.width}×${vp.height}] passo ${rotulo}: trunfo × ${nome}\n` +
          `   trunfo: ${fmt(slot)}\n   ${nome}: ${fmt(daMesa.get(nome)!)}`,
        ).toBe(false);
      }
    }

    // 2. a instrução do passo está escrita, INTEIRA. Reticências no meio de uma regra é regra
    //    não ensinada: a copy tem de caber na faixa, e quem não cabe é a copy, não o layout.
    await expect(page.locator(".rei-fala"), `passo ${rotulo} sem fala`).toHaveText(/\S/);
    const cortada = await page.locator(".rei-fala").evaluate((e) => ({
      corta: e.scrollHeight > e.clientHeight + 1,
      texto: (e.textContent ?? "").slice(0, 70),
      s: e.scrollHeight, c: e.clientHeight,
    }));
    expect(
      cortada.corta,
      `[${proj} · ${vp.width}×${vp.height}] passo ${rotulo}: a fala está cortada ` +
      `(${cortada.s}px de texto em ${cortada.c}px)\n   "${cortada.texto}..."`,
    ).toBe(false);

    // 3. e há um caminho adiante, alcançável por um dedo
    const ok = page.locator(".tut-ok");
    const trunfo = page.locator(".trumpbtn").first();
    const carta = page.locator(SEL.handCardLegal).first();
    if (await ok.count()) {
      await exigirAoAlcance(page, ok, "o botao Avançar", rotulo, trilha);
      trilha.push(`${rotulo}:continuar`); await ok.click();
    } else if (await trunfo.count()) {
      await exigirAoAlcance(page, trunfo, "o botao de trunfo", rotulo, trilha);
      trilha.push(`${rotulo}:trunfo`); await trunfo.click();
    } else if (await carta.count()) {
      await exigirAoAlcance(page, carta, "a carta legal", rotulo, trilha);
      trilha.push(`${rotulo}:carta`); await carta.click();
    } else {
      throw new Error(`TUTORIAL TRAVOU no passo ${rotulo}: ${trilha.join(" -> ")}`);
    }
    await page.waitForTimeout(120);
  }

  expect(vistos, `trilha: ${trilha.join(" -> ")}`)
    .toEqual(Array.from({ length: 16 }, (_, i) => `${i + 1}/16`));
  // e as cinco práticas aconteceram de verdade
  expect(trilha.filter((t) => t.endsWith(":carta")).length).toBe(4);
  expect(trilha.filter((t) => t.endsWith(":trunfo")).length).toBe(1);

  await expect(page.locator(".home")).toBeVisible();
  const salvo = await page.evaluate(() => window.localStorage.getItem("king:tutorial"));
  expect(JSON.parse(salvo!).concluido, "tutorial_completed").toBe(true);
});

/**
 * VOLTAR ATRAVESSANDO MICROCENÁRIO.
 *
 * O passo 6 vive na mesa do "negar" e o passo 7 monta a mão 2 do zero. Voltar do 7 para o 6
 * desmonta uma cena e remonta outra, e é aí que um estado didático corrompido apareceria: passo
 * pedindo ação já feita, mesa de uma mão com a fala de outra, ou nada clicável.
 */
test("VOLTAR entre microcenários não corrompe o estado", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  // até 7/16, que é a primeira mão com cena própria (mão 2)
  for (let i = 0; i < 20; i++) {
    if ((await page.locator(".tut-passo").textContent())?.trim() === "7/16") break;
    const ok = page.locator(".tut-ok"), carta = page.locator(SEL.handCardLegal).first();
    if (await ok.count()) await ok.click(); else if (await carta.count()) await carta.click();
    await page.waitForTimeout(110);
  }
  await expect(page.locator(".tut-passo")).toHaveText("7/16");
  await expect(page.locator(SEL.hud)).toContainText("Mão 2");
  const falaDo7 = await page.locator(".rei-fala").textContent();

  await page.locator(".tut-voltar").click();
  await expect(page.locator(".tut-passo")).toHaveText("6/16");
  await expect(page.locator(SEL.hud)).toContainText("Mão 1");
  await expect(page.locator(".tut-acao"), "passo de leitura não pode pedir ação").toHaveCount(0);
  await expect(page.locator(".tut-ok")).toBeVisible();

  await page.locator(".tut-ok").click();
  await expect(page.locator(".tut-passo")).toHaveText("7/16");
  await expect(page.locator(".rei-fala")).toHaveText(falaDo7!);
  await expect(page.locator(SEL.hud)).toContainText("Mão 2");
});

/**
 * A SEQUÊNCIA DAS MÃOS É A DO JOGO — e agora dá para ver isso na tela.
 *
 * A versão anterior explicava as mãos 2, 3, 4 e 6 com o card do contrato preso na mão 5. Quem
 * olhava lia uma coisa e via outra, e a mão 5 parecia não existir na sequência. O card agora
 * confirma o que o Rei diz, passo a passo.
 */
test("cada mão negativa é explicada com o card do contrato daquela mão", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  const esperado: Record<string, string> = {
    "6/16": "Mão 1", "7/16": "Mão 2", "8/16": "Mão 3",
    "9/16": "Mão 4", "10/16": "Mão 5", "11/16": "Mão 6",
  };
  const vistos: string[] = [];

  for (let i = 0; i < 40; i++) {
    const rotulo = (await page.locator(".tut-passo").textContent())?.trim() ?? "";
    if (esperado[rotulo] && !vistos.includes(rotulo)) {
      vistos.push(rotulo);
      await expect(page.locator(SEL.hud), `passo ${rotulo}`).toContainText(esperado[rotulo]);
    }
    if (rotulo === "12/16") break;
    const ok = page.locator(".tut-ok"), carta = page.locator(SEL.handCardLegal).first();
    if (await ok.count()) await ok.click(); else if (await carta.count()) await carta.click();
    else throw new Error(`travou em ${rotulo}`);
    await page.waitForTimeout(110);
  }

  expect(vistos).toEqual(["6/16", "7/16", "8/16", "9/16", "10/16", "11/16"]);
});

/* ══════════════════ O TRUNFO APARECE QUANDO SERVE ══════════════════
 *
 * Achado em uso e reportado duas rodadas antes de poder ser corrigido: os cinco naipes de trunfo
 * ficavam na tela UM PASSO ANTES do passo que pede a escolha, e clicar neles não fazia nada.
 *
 * A causa não era a Mesa, que estava certa: ela mostra o painel quando o motor diz que o assento
 * humano tem trunfo a escolher. Era o roteiro, que montava a mão 7 um passo cedo — e a mão 7 nasce
 * esperando a escolha.
 *
 * Estes testes cobram os três momentos, e o do meio é o que faltava.
 */
test("os controles de trunfo só existem no passo que os pede", async ({ page }, ti) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });
  const vp = vpOf(page);

  // ── ANTES: passo a passo até o 12, sem nenhum controle de trunfo em lugar nenhum ──
  const antes: string[] = [];
  for (let i = 0; i < 40; i++) {
    const rotulo = (await page.locator(".tut-passo").textContent())?.trim() ?? "?";
    if (rotulo === "13/16") break;
    antes.push(rotulo);

    expect(
      await page.locator(".trumpbtn").count(),
      `[${ti.project.name}] passo ${rotulo}: controle de trunfo na tela antes da hora`,
    ).toBe(0);
    // e nem a affordance enganosa do painel, nem o aviso de "alguém escolhendo"
    expect(await page.locator(".trumpov").count(), `passo ${rotulo}: painel de trunfo`).toBe(0);
    expect(await page.locator(".pickmsg").count(), `passo ${rotulo}: aviso de escolha`).toBe(0);

    const ok = page.locator(".tut-ok");
    const carta = page.locator(SEL.handCardLegal).first();
    if (await ok.count()) await ok.click();
    else if (await carta.count()) await carta.click();
    else throw new Error(`travou no passo ${rotulo}`);
    await page.waitForTimeout(110);
  }
  expect(antes, "não chegou ao passo do trunfo").toContain("12/16");

  // ── NO PASSO: exatamente cinco opções, todas alcançáveis ──
  await expect(page.locator(".tut-passo")).toHaveText("13/16");
  const opcoes = page.locator(".trumpbtn");
  await expect(opcoes).toHaveCount(5);

  const rotulos = (await opcoes.allTextContents()).map((t) => t.replace(/[^\p{L} ]/gu, "").trim());
  for (const esperado of ["Copas", "Ouros", "Paus", "Espadas", "Sem Trunfo"]) {
    expect(rotulos, `falta a opção ${esperado}`).toContain(esperado);
  }

  for (let i = 0; i < 5; i++) {
    const c = await boxOf(opcoes.nth(i), `trunfo ${i}`);
    expect(
      insideViewport(c, vp, SUBPIXEL),
      `[${ti.project.name} · ${vp.width}×${vp.height}] a opção ${rotulos[i]} está fora da tela`,
    ).toBe(true);
    await exigirAoAlcance(page, opcoes.nth(i), `a opção ${rotulos[i]}`, "13/16", []);
  }

  // e o passo se anuncia como AÇÃO, em vez de parecer leitura
  await expect(page.locator(".tut-acao")).toBeVisible();

  // ── DEPOIS: a escolha vale, o tutorial anda, e não sobra controle nenhum ──
  await opcoes.first().click();
  await page.waitForTimeout(160);

  await expect(page.locator(".trumpbtn"), "sobrou controle de trunfo depois da escolha").toHaveCount(0);
  await expect(page.locator(".trumpslot"), "a escolha não ficou refletida na Mesa").toBeVisible();
  await expect(page.locator(".tut-ok"), "o tutorial não liberou o avanço").toBeVisible();

  await page.locator(".tut-ok").click();
  await expect(page.locator(".tut-passo")).toHaveText("14/16");
});

test("um toque onde o painel de trunfo ficava não faz nada antes da hora", async ({ page }) => {
  await primeiraVisita(page);
  await expect(page.locator(".tut")).toBeVisible({ timeout: 20_000 });

  // até o passo 12, o que anunciava as positivas
  for (let i = 0; i < 40; i++) {
    if ((await page.locator(".tut-passo").textContent())?.trim() === "12/16") break;
    const ok = page.locator(".tut-ok");
    const carta = page.locator(SEL.handCardLegal).first();
    if (await ok.count()) await ok.click(); else if (await carta.count()) await carta.click();
    await page.waitForTimeout(110);
  }
  await expect(page.locator(".tut-passo")).toHaveText("12/16");

  // O centro da mesa é onde o painel morava. Tocar ali agora não pode produzir efeito nenhum:
  // nem escolher trunfo, nem avançar o passo, nem jogar carta.
  const antes = await page.locator(SEL.handCard).count();
  const vp = vpOf(page);
  await page.mouse.click(vp.width / 2, vp.height * 0.42);
  await page.waitForTimeout(250);

  await expect(page.locator(".tut-passo")).toHaveText("12/16");
  expect(await page.locator(SEL.handCard).count()).toBe(antes);
  expect(await page.locator(".trumpslot").count(), "escolheu trunfo sem pedir").toBe(0);
});
