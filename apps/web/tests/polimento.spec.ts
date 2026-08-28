/**
 * POLIMENTO PÓS-PARTIDA FÍSICA — no navegador de verdade.
 *
 * Cada teste aqui nasceu de uma observação numa partida real de 10 mãos com dois humanos e dois
 * bots, e não de uma hipótese. O que se prova:
 *
 *   • o card de trunfo cabe o nome de quem escolheu, do "Leo" ao apelido no limite do campo, sem
 *     encostar em nada;
 *   • tocar num card de jogador abre o mini perfil, nos três lados e no seu próprio;
 *   • o perfil fecha e o jogo continua exatamente onde estava;
 *   • as mensagens rápidas existem TAMBÉM no placar entre as mãos, e é o mesmo sistema.
 */
import { test, expect, type Page } from "@playwright/test";
import { intersects, insideViewport, fmt, type Box } from "./helpers/geometry.js";
import { boxOf, SEL, openMesaStress, iniciarPartidaLocal } from "./helpers/mesa.js";

const SUBPIXEL = 1;

/** Nomes de teste, do curto ao limite do campo (14). "W" é o glifo mais largo da fonte. */
const NOMES = ["Você", "Leo", "Tito", "Alexandre", "João Guilherme", "Christopher", "WWWWWWWWWWWWWW"];

/**
 * Uma MESA com slot de trunfo na tela, pelo caminho mais curto que ainda é a tela de verdade.
 *
 * O slot só existe nas mãos positivas, e chegar à mão 7 jogando pela interface leva centenas de
 * cliques. A cena positiva do tutorial é a mesma Mesa, montada pelo motor de verdade na mão 7,
 * com a rotação mandando o aluno escolher o trunfo. Escolhido o naipe pela tela, o slot aparece
 * exatamente como numa partida.
 *
 * A Mesa do tutorial é mais BAIXA que a da partida (a faixa reserva o topo), então a geometria
 * medida aqui é a versão apertada do caso, não a folgada.
 */
async function mesaComTrunfo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  await page.goto("/");
  await page.locator(".tut").waitFor({ timeout: 20_000 });

  // A ORDEM IMPORTA, e custou uma execução para descobrir: a cena positiva já monta esperando o
  // trunfo, então os cinco naipes aparecem na tela UM PASSO ANTES do passo que pede a escolha.
  // Clicar neles ali não faz nada — o tutorial só aceita a ação no passo dela. Por isso "Avançar"
  // vem primeiro: enquanto houver instrução para ler, é ela que move a tela.
  for (let i = 0; i < 40; i++) {
    if (await page.locator(".trumpslot").count()) return;
    const ok = page.locator(".tut-ok");
    const trunfo = page.locator(".trumpbtn").first();
    const carta = page.locator(SEL.handCardLegal).first();
    if (await ok.count()) await ok.click();
    else if (await trunfo.count()) await trunfo.click();
    else if (await carta.count()) await carta.click();
    else break;
    await page.waitForTimeout(110);
  }
  await expect(page.locator(".trumpslot")).toBeVisible({ timeout: 10_000 });
}

test.describe("card de trunfo", () => {
  test("cabe do nome curto ao apelido no limite, sem invadir nada", async ({ page }, ti) => {
    await mesaComTrunfo(page);
    const vp = page.viewportSize()!;

    const alvo = page.locator(".trumpslot .who");
    await expect(alvo).toBeVisible();

    for (const nome of NOMES) {
      await alvo.evaluate((el, n) => { el.textContent = n; }, nome);
      await page.waitForTimeout(60);

      const slot = await boxOf(page.locator(".trumpslot"), "trumpslot");
      const simbolo = await boxOf(page.locator(".trumpslot .sym"), "símbolo do trunfo");

      // 1. O SÍMBOLO NUNCA SOME. É a informação de jogo; o nome é o acompanhamento.
      expect(simbolo.width, `[${nome}] o símbolo do trunfo desapareceu`).toBeGreaterThan(6);
      expect(simbolo.height, `[${nome}] o símbolo do trunfo desapareceu`).toBeGreaterThan(6);

      // 2. NÃO INVADE ZONA NENHUMA.
      for (const [quem, sel] of [
        ["hud", SEL.hud], ["card do jogador", SEL.youtag], ["botões do topo", SEL.topbtn],
        ["adversário da esquerda", ".opp.left"], ["vaza", ".trick"], ["leque", ".hand"],
      ] as [string, string][]) {
        const outro = await boxOf(page.locator(sel), sel);
        expect(
          intersects(slot, outro, SUBPIXEL),
          `[${ti.project.name} · ${vp.width}×${vp.height}] "${nome}": trunfo × ${quem}\n` +
          `   trunfo: ${fmt(slot)}\n   ${quem}: ${fmt(outro)}`,
        ).toBe(false);
      }

      // 3. E CONTINUA NA TELA.
      expect(insideViewport(slot as Box, vp, SUBPIXEL), `[${nome}] o card saiu da tela`).toBe(true);
    }
  });

  test("o card NÃO muda de tamanho, qualquer que seja o nome", async ({ page }, ti) => {
    await mesaComTrunfo(page);
    const alvo = page.locator(".trumpslot .who");

    // A largura fixa é o ponto do item: a coluna esquerda não pode mudar de tamanho a cada mão
    // positiva, conforme quem escolheu o trunfo. Medir todos os nomes e exigir UMA largura.
    const larguras: number[] = [];
    const alturas: number[] = [];
    for (const nome of NOMES) {
      await alvo.evaluate((el, n) => { el.textContent = n; }, nome);
      await page.waitForTimeout(60);
      const c = await boxOf(page.locator(".trumpslot"), "trumpslot");
      larguras.push(Math.round(c.width));
      alturas.push(Math.round(c.height));
    }

    expect(
      new Set(larguras).size,
      `[${ti.project.name}] o card mudou de largura: ${larguras.join(", ")}`,
    ).toBe(1);
    expect(
      new Set(alturas).size,
      `[${ti.project.name}] o card mudou de altura: ${alturas.join(", ")}`,
    ).toBe(1);
  });

  /**
   * A ALTURA DO CARD DE TRUNFO, CONTRA A DO CARD DE CIMA.
   *
   * O pedido foi "aumente a altura do card de Trunfo para cerca de metade do card informativo
   * imediatamente acima". A medição mostrou que o card já tinha 85% da altura do de cima nas
   * telas altas — e só 32% quando a Mesa encolhe abaixo de 360px e ele deita. É essa a tela do
   * relato: um iPhone deitado, com a barra do Safari, entra por aí.
   *
   * Então o piso vale onde o problema estava, e a largura não pode ter crescido junto: o pedido
   * foi explicitamente vertical.
   */
  test("deitado, o card de trunfo chega a cerca de metade do card de cima", async ({ page }, ti) => {
    const vp = page.viewportSize()!;
    test.skip(vp.height > 360, "acima de 360px o card fica em pé, e já tem 85% da altura do HUD");
    await mesaComTrunfo(page);

    const hud = await boxOf(page.locator(".hud"), "card do contrato");
    const slot = await boxOf(page.locator(".trumpslot"), "card de trunfo");
    const razao = slot.height / hud.height;

    expect(razao, `[${ti.project.name}] o card de trunfo ficou baixo demais: ${razao.toFixed(2)}`)
      .toBeGreaterThanOrEqual(0.45);
    expect(razao, `[${ti.project.name}] o card de trunfo passou do pedido: ${razao.toFixed(2)}`)
      .toBeLessThanOrEqual(0.62);
    // e não invade quem mora logo abaixo dele na coluna
    const esq = page.locator(".opp.left");
    if (await esq.count()) {
      const abaixo = await boxOf(esq, "adversário da esquerda");
      expect(abaixo.y, "o card de trunfo encostou no adversário da esquerda")
        .toBeGreaterThanOrEqual(slot.y + slot.height);
    }
    if (process.env.KING_SHOTS) {
      await page.screenshot({ path: `${process.env.KING_SHOTS}/trunfo-${ti.project.name}.png` });
    }
  });
});

test.describe("mini perfil", () => {
  test("abre pelos três adversários e também pelo seu próprio card", async ({ page }) => {
    await openMesaStress(page);

    for (const sel of [".opp.left", ".opp.top", ".opp.right", SEL.youtag]) {
      await page.locator(sel).click();
      await expect(page.locator(".pf"), `${sel} não abriu o perfil`).toBeVisible();
      // é o perfil DAQUELE jogador
      const nome = (await page.locator(`${sel} .n`).textContent())?.trim() ?? "";
      await expect(page.locator(".pf-id b")).toContainText(nome.replace(/Assistência|Bot/g, "").trim());
      await page.locator(".pf-x").click();
      await expect(page.locator(".pf")).toHaveCount(0);
    }
  });

  test("fecha por botão, por Esc e pelo scrim", async ({ page }) => {
    await openMesaStress(page);

    await page.locator(".opp.top").click();
    await page.locator(".pf-x").click();
    await expect(page.locator(".pf")).toHaveCount(0);

    await page.locator(".opp.top").click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".pf")).toHaveCount(0);

    await page.locator(".opp.top").click();
    await page.locator(".pf-scrim").click({ position: { x: 4, y: 4 } });
    await expect(page.locator(".pf")).toHaveCount(0);
  });

  test("depois de fechado, o jogo continua exatamente onde estava", async ({ page }) => {
    await openMesaStress(page);

    const antes = {
      hud: await page.locator(SEL.hud).innerText(),
      cartas: await page.locator(SEL.handCard).count(),
      vaza: await page.locator(SEL.trickCard).count(),
    };

    await page.locator(".opp.left").click();
    await expect(page.locator(".pf")).toBeVisible();
    await page.locator(".pf-x").click();
    await expect(page.locator(".pf")).toHaveCount(0);

    expect(await page.locator(SEL.hud).innerText()).toBe(antes.hud);
    expect(await page.locator(SEL.handCard).count()).toBe(antes.cartas);
    expect(await page.locator(SEL.trickCard).count()).toBe(antes.vaza);

    // e o leque volta a aceitar toque
    const carta = page.locator(SEL.handCardLegal).first();
    await expect(carta).toBeVisible();
    await carta.click();
    if (await page.locator(SEL.handCardSelected).count()) await carta.click();
    await expect(page.locator(SEL.handCard)).toHaveCount(antes.cartas - 1, { timeout: 10_000 });
  });

  test("com o perfil aberto, nenhum toque atravessa até o leque", async ({ page }) => {
    await openMesaStress(page);
    const cartas = await page.locator(SEL.handCard).count();
    const carta = await boxOf(page.locator(SEL.handCardLegal).first(), "carta legal");

    await page.locator(".opp.top").click();
    await expect(page.locator(".pf")).toBeVisible();
    await page.mouse.click(carta.x + carta.width / 2, carta.y + carta.height / 2);
    await page.waitForTimeout(200);

    expect(await page.locator(SEL.handCard).count(), "jogou carta por baixo do perfil").toBe(cartas);
  });

  test("não mostra XP, nível nem estatística que o jogo não guarda", async ({ page }) => {
    await openMesaStress(page);
    await page.locator(".opp.right").click();
    const texto = await page.locator(".pf").innerText();

    for (const proibido of [/\bXP\b/i, /\bn[íi]vel\b/i, /vit[óo]rias/i, /partidas jogadas/i]) {
      expect(texto, `apareceu ${proibido} sem fonte real`).not.toMatch(proibido);
    }
    await expect(page.locator(".pf-progresso")).toHaveCount(0);
  });

  test("o perfil cabe na tela e o fechar é alcançável pelo dedo", async ({ page }, ti) => {
    await openMesaStress(page);
    const vp = page.viewportSize()!;
    await page.locator(".opp.top").click();

    const painel = await boxOf(page.locator(".pf"), "pf");
    expect(
      insideViewport(painel as Box, vp, SUBPIXEL),
      `[${ti.project.name} · ${vp.width}×${vp.height}] o perfil saiu da tela ${fmt(painel)}`,
    ).toBe(true);

    const x = await boxOf(page.locator(".pf-x"), "pf-x");
    expect(Math.round(Math.min(x.width, x.height))).toBeGreaterThanOrEqual(44 - SUBPIXEL);

    const rolagem = await page.evaluate(() => ({
      v: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
      h: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    }));
    expect(rolagem, "a página não pode rolar com o perfil aberto").toEqual({ v: false, h: false });
  });
});

/**
 * "SEM TRUNFO" É DO MESMO TAMANHO QUE UM NAIPE.
 *
 * O card já prometia não mudar de tamanho por causa do NOME de quem escolheu. Faltava a mesma
 * promessa para o CONTEÚDO: um naipe é um glifo grande, "Sem Trunfo" é texto miúdo, e o card
 * encolhia 22px (80x73 contra 80x51 a 667x375). A mesma informação parecia menos importante por
 * acaso de tipografia.
 *
 * O teste escolhe as duas coisas na mesma mesa, pela interface, e compara as caixas.
 */
test("o card de Sem Trunfo tem o mesmo tamanho do card de um naipe", async ({ page }, ti) => {
  test.setTimeout(120_000);

  const escolher = async (indice: number) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("king.audio",
          JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
        window.localStorage.setItem("king:tutorial",
          JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
      } catch { /* headless sem storage: segue */ }
    });
    // A mão 7 é positiva e a rotação põe a escolha do trunfo na mão do jogador local.
    await page.goto("/?seed=42&mao=7");
    await iniciarPartidaLocal(page);
    await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
    const botoes = page.locator(".trumpbtn");
    await expect(botoes.first()).toBeVisible({ timeout: 15_000 });
    await botoes.nth(indice).click();
    await expect(page.locator(".trumpslot")).toBeVisible({ timeout: 10_000 });
    const caixa = await page.locator(".trumpslot").boundingBox();
    // O card ter o mesmo TAMANHO não bastou: ele cumpria a promessa por fora enquanto, por
    // dentro, "Sem Trunfo" tomava a largura da linha e o nome de quem escolheu virava "v…". Um
    // `not.toHaveText("")` passava tranquilo — `textContent` continua "Você" mesmo reticenciado
    // pelo CSS. Então mede-se o CORTE: `scrollWidth` maior que a caixa é reticência.
    const nomes: Record<string, boolean> = {};
    // O nome real volta ao fim: a evidência é uma foto da TELA, e uma foto com "WWWWWWWWWWWWWW"
    // no card mostra o instrumento em vez do produto.
    const original = (await page.locator(".trumpslot .who").textContent()) ?? "";
    for (const nome of [...NOMES, original]) {
      await page.locator(".trumpslot .who").evaluate((el, n) => { el.textContent = n; }, nome);
      await page.waitForTimeout(60);
      nomes[nome] = await page.locator(".trumpslot .who").evaluate(
        (el) => el.scrollWidth > Math.ceil(el.getBoundingClientRect().width) + 1);
    }
    const simCortado = await page.locator(".trumpslot .sym").evaluate(
      (el) => el.scrollWidth > Math.ceil(el.getBoundingClientRect().width) + 1);
    return { w: Math.round(caixa!.width), h: Math.round(caixa!.height), nomes, simCortado };
  };

  const comNaipe = await escolher(0);          // Copas
  const semTrunfo = await escolher(4);         // Sem Trunfo, o último

  expect({ w: semTrunfo.w, h: semTrunfo.h },
    `[${ti.project.name}] o card mudou de tamanho conforme a escolha`)
    .toEqual({ w: comNaipe.w, h: comNaipe.h });

  // A ESCOLHA NÃO PODE CUSTAR O NOME.
  //
  // Nome comprido reticenciar é o desenho: a caixa tem largura fixa e o apelido é quem cede. O
  // que não pode é a reticência DEPENDER da escolha do trunfo — "Você" cabia com Copas e não
  // cabia com Sem Trunfo, e a mesma pessoa aparecia nomeada ou não conforme o contrato da mão.
  // Por isso a afirmação é de IGUALDADE entre os dois estados, e não uma lista de quais nomes
  // cabem: essa lista muda com o viewport, e a promessa não.
  expect(semTrunfo.nomes,
    `[${ti.project.name}] "Sem Trunfo" corta nomes que um naipe não cortava`)
    .toEqual(comNaipe.nomes);

  // E o texto continua legível: não é o card que encolhe nem a letra que some.
  await expect(page.locator(".trumpslot .sym")).toHaveText(/Sem Trunfo/);
  const corpo = await page.locator(".trumpslot .sym").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(corpo, "'Sem Trunfo' ficou pequeno demais para ser lido").toBeGreaterThanOrEqual(13);
  expect(semTrunfo.simCortado, "'Sem Trunfo' saiu reticenciado").toBe(false);
  // e quem escolheu continua nomeado
  await expect(page.locator(".trumpslot .who")).not.toHaveText("");

  if (process.env.KING_SHOTS) {
    await page.screenshot({ path: `${process.env.KING_SHOTS}/trunfo-sem-trunfo-${ti.project.name}.png` });
  }
});
