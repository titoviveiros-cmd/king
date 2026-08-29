/**
 * A TELA FINAL CABE — medida, e não conferida de olho.
 *
 * ══ O QUE ACONTECEU ══
 *
 * O ranking do placar final é uma pilha de linhas ABSOLUTAS em `top:0`, cada uma deslocada por
 * `translateY(--fimrow * posição)` dentro de um container de altura fixa. É esse arranjo que
 * permite a reordenação animada: as quatro linhas trocam de lugar mudando só o `transform`.
 *
 * A rodada do balão social escreveu `.fimlinha{position:relative}` para dar à linha um bloco de
 * contenção — que ela já tinha, por ser absoluta. A troca devolveu as quatro ao fluxo normal:
 * cada linha passou a ocupar a própria altura E a receber o deslocamento por cima. A lista
 * dobrou de tamanho, a última posição terminou 12px abaixo da tela a 852×300, e o
 * `overflow:hidden` do fundo cortou o resto sem dizer nada.
 *
 * ══ POR QUE NENHUM TESTE VIU ══
 *
 * Havia um teste da tela final, e ele afirmava que `.fimchips`, `.fimdest` e `.fimrank` estavam
 * dentro do viewport. Os três continuaram dentro — quem saiu foi o CONTEÚDO do `.fimrank`, que é
 * outra caixa. "O container cabe" não é "o que está dentro dele cabe": com `position:absolute` os
 * filhos não empurram o pai, então a caixa de fora pode estar perfeita enquanto a de dentro
 * transborda.
 *
 * Por isso aqui se mede DUAS coisas em toda checagem: a caixa contra o viewport, e o conteúdo
 * contra a própria caixa (`scrollHeight` × `clientHeight`). É a segunda que pega este defeito, e
 * é a que faltava.
 */
import { test, expect, type Page } from "@playwright/test";
import { fmt, insideViewport, intersects, type Box } from "./helpers/geometry.js";
import { boxOf, SEL, iniciarPartidaLocal } from "./helpers/mesa.js";

const SUBPIXEL = 1;

/** Blocos que precisam estar inteiros na tela final, do topo ao selo. */
const BLOCOS = [
  [".fimgrid", "o quadro inteiro"],
  [".fimheroi", "a coluna do vencedor"],
  [".fimtitulo", "o nome de quem venceu"],
  [".fimacoes", "a fileira de botões"],
  [".fimdados", "a coluna do resultado"],
  [".fimrank", "o ranking"],
  [".fimdest", "o destaque narrativo"],
  [".fimchips", "o selo da melhor mão"],
] as const;

/**
 * Uma partida levada até a tela final, na etapa `completo` — a mais cheia das cinco.
 *
 * A mão 10 é a última: começar por ela é o caminho mais curto até o encerramento jogando pela
 * interface de verdade. A encenação termina sozinha; um toque encurta.
 */
async function telaFinal(page: Page): Promise<void> {
  await chegarAoFim(page);
  await page.locator(".fim").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await expect(page.locator(".fimacoes"), "a encenação não chegou à etapa final")
    .toBeVisible({ timeout: 20_000 });
  await estabilizar(page);
}

/** Joga a mão 10 até o placar final aparecer — e para ANTES do toque que pula a encenação. */
async function chegarAoFim(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  await page.goto("/?seed=42&mao=10");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });

  const anuncio = page.locator(".um");
  if (await anuncio.count()) await anuncio.click().catch(() => {});
  await expect(anuncio).toHaveCount(0, { timeout: 12_000 });

  for (let i = 0; i < 400 && !(await page.locator(".fim").count()); i++) {
    const trunfo = page.locator(".trumpbtn").first();
    if (await trunfo.count()) { await trunfo.click({ timeout: 5000 }).catch(() => {}); continue; }
    const carta = page.locator(SEL.handCardLegal).first();
    if (await carta.count()) {
      await carta.click({ timeout: 5000 }).catch(() => {});
      if (await page.locator(SEL.handCardSelected).count()) {
        await page.locator(SEL.handCardSelected).first().click({ timeout: 5000 }).catch(() => {});
      }
      continue;
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator(".fim"), "a partida não chegou ao placar final").toBeVisible({ timeout: 20_000 });
}

/**
 * Espera a tela PARAR de se mexer. Medir no meio de uma animação mede um quadro, não a tela.
 *
 * São duas coisas em movimento, e a primeira versão esperava só uma. As LINHAS se reposicionam por
 * `transform` com transição — era o que estava coberto. A COLUNA DO HERÓI também anima: a coroa
 * entra em escala, o título chega com `soco`, e os CTAs só nascem na etapa final. Enquanto isso o
 * `scrollHeight` dela passa do `clientHeight` por um ou dois pixels, e a asserção de transbordo
 * acusava um defeito que era só o quadro em que ela caiu — passava isolada e falhava sob carga,
 * que é a assinatura de teste que mede animação em vez de layout.
 */
async function estabilizar(page: Page): Promise<void> {
  // PRIMEIRO, esperar as animações ACABAREM — e não parecerem paradas.
  //
  // Comparar duas leituras separadas por um intervalo é um teste de "parece parado", e `soco`
  // engana esse teste: a curva achata no pico (`scale:1.06` aos 55%), então duas medições
  // arredondadas podem coincidir bem no alto e passar por estáveis. Foi essa a leitura que o CI
  // pegou a 1024×768, acusando o título 4px fora da tela quando em repouso ele cabe exato.
  //
  // `getAnimations()` responde a pergunta certa: o navegador sabe quando acabou, e não há
  // amostragem que erre isso.
  await expect(async () => {
    const correndo = await page.evaluate(() => {
      const alvo = document.querySelector(".fim");
      if (!alvo) return -1;
      return alvo.getAnimations({ subtree: true }).filter((a) => {
        if (a.playState !== "running") return false;
        // A coroa flutua para sempre (`floatIdle`, `infinite`) enquanto a tela final existir.
        // Esperar por ela seria esperar o resto da partida: o que interessa são as animações de
        // ENTRADA, que terminam. Uma repetição infinita nunca "acaba" e não desloca nada.
        const t = a.effect?.getComputedTiming();
        return !!t && t.iterations !== Infinity;
      }).length;
    });
    expect(correndo, "a encenação do placar final ainda está animando").toBe(0);
  }).toPass({ timeout: 15_000 });

  // E DEPOIS confirmar a quietude por medição — as linhas do ranking se movem por transição, que
  // termina, mas o `toPass` acima pode ganhar num quadro em que a próxima ainda não começou.
  await expect(async () => {
    const antes = await instantaneo(page);
    await page.waitForTimeout(200);
    expect(await instantaneo(page)).toEqual(antes);
  }).toPass({ timeout: 15_000 });
}

/**
 * O bastante para saber se alguma coisa ainda se move — e são TRÊS coisas, não duas.
 *
 * A caixa do herói responde pelo que muda o LAYOUT (a coroa entrando, os CTAs nascendo). O título
 * precisa de leitura própria porque a animação dele é `scale`, e `scale` não mexe em layout
 * nenhum: `scrollHeight` fica parado enquanto o elemento ainda cresce e encolhe na tela.
 *
 * `soco` passa por `scale:1.06` aos 55% e termina em `1`. Medido a 1024×768 no CI, o título
 * apanhado nesse pico tinha 434px numa coluna de 409 — e a asserção de "cabe na tela" acusava o
 * nome do vencedor saindo 4px pela esquerda. Não estava: a caixa em repouso é exatamente a
 * coluna. Era a comemoração, fotografada no meio.
 */
async function instantaneo(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const cx = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    };
    const h = document.querySelector(".fimheroi") as HTMLElement | null;
    return JSON.stringify({
      linha: cx(".fimlinha"),
      titulo: cx(".fimtitulo"),
      heroi: h ? [h.scrollHeight, h.clientHeight] : null,
    });
  });
}

/** `scrollHeight` × `clientHeight`: o conteúdo transborda a própria caixa? */
async function transbordo(page: Page, seletor: string): Promise<{ sh: number; ch: number }> {
  return await page.locator(seletor).evaluate(
    (el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
}

/** Afirma o essencial da tela final. Reusada por cada variação de conteúdo. */
async function cabeInteira(page: Page, vp: { width: number; height: number }, cenario: string) {
  for (const [sel, quem] of BLOCOS) {
    if (!(await page.locator(sel).count())) continue;
    const caixa = await boxOf(page.locator(sel), sel);
    expect(insideViewport(caixa as Box, vp, SUBPIXEL),
      `[${cenario}] ${quem} (${sel}) não cabe na tela: ${JSON.stringify(caixa)} em ${vp.width}×${vp.height}`,
    ).toBe(true);
  }

  // O CONTEÚDO CONTRA A PRÓPRIA CAIXA — a medição que faltava.
  for (const sel of [".fimgrid", ".fimdados", ".fimheroi"]) {
    const { sh, ch } = await transbordo(page, sel);
    expect(sh, `[${cenario}] ${sel} transborda ${sh - ch}px do próprio espaço`)
      .toBeLessThanOrEqual(ch + SUBPIXEL);
  }

  // A ÚLTIMA LINHA DO RANKING, que é a que some primeiro quando algo dá errado.
  const linhas = page.locator(".fimlinha");
  const total = await linhas.count();
  expect(total, `[${cenario}] o ranking ficou sem linhas`).toBeGreaterThan(0);
  const ultima = await boxOf(linhas.nth(total - 1), "última linha do ranking");
  expect(insideViewport(ultima as Box, vp, SUBPIXEL),
    `[${cenario}] a última posição do ranking está cortada: ${JSON.stringify(ultima)}`).toBe(true);

  // E dentro do container dela: as linhas são absolutas, então NÃO empurram o pai — sair da
  // caixa é silencioso, e foi exatamente assim que o defeito passou.
  const caixaRank = await boxOf(page.locator(".fimrank"), ".fimrank");
  expect(ultima.y + ultima.height,
    `[${cenario}] a última linha escapou do ranking (fundo ${ultima.y + ultima.height}, ` +
    `caixa termina em ${caixaRank.y + caixaRank.height})`)
    .toBeLessThanOrEqual(caixaRank.y + caixaRank.height + SUBPIXEL);

  // NENHUM CTA fora da tela: são o que a pessoa precisa tocar para sair daqui.
  const botoes = page.locator(".fimacoes button");
  for (let i = 0; i < await botoes.count(); i++) {
    const b = await boxOf(botoes.nth(i), `botão ${i}`);
    const rotulo = (await botoes.nth(i).textContent())?.trim() || `botão ${i}`;
    expect(insideViewport(b as Box, vp, SUBPIXEL),
      `[${cenario}] o botão "${rotulo}" está fora da tela: ${JSON.stringify(b)}`).toBe(true);
  }
}

test.describe("o placar final cabe na tela", () => {
  test("com os quatro jogadores, nada é cortado", async ({ page }, ti) => {
    test.setTimeout(180_000);
    await telaFinal(page);
    const vp = page.viewportSize()!;

    await expect(page.locator(".fimlinha")).toHaveCount(4);
    await cabeInteira(page, vp, "4 jogadores");

    if (process.env.KING_SHOTS) {
      await page.screenshot({ path: `${process.env.KING_SHOTS}/fim-4-jogadores-${ti.project.name}.png` });
    }
  });

  /**
   * O BOTÃO SOCIAL, QUE SÓ EXISTE NO MULTIPLAYER.
   *
   * Chegar a um placar final multiplayer custa dez mãos com dois navegadores — caro demais para
   * uma pergunta que é de GEOMETRIA. O que muda naquela tela é um elemento a mais na fileira dos
   * CTAs, e quem decide o tamanho dele é o CSS. Então o elemento é injetado com as classes de
   * verdade e a fileira é medida como qualquer outra.
   *
   * É stress de layout, não simulação de multiplayer: o que se afirma aqui é que a tela aguenta
   * o quarto controle, e nada sobre o comportamento dele.
   */
  test("com o botão social na fileira, a tela continua cabendo", async ({ page }, ti) => {
    test.setTimeout(180_000);
    await telaFinal(page);
    const vp = page.viewportSize()!;

    await page.locator(".fimacoes").evaluate((acoes) => {
      const b = document.createElement("button");
      b.className = "soc soc-fim";
      b.setAttribute("aria-label", "Mensagens rápidas");
      b.textContent = "💬";
      acoes.appendChild(b);
    });
    await page.waitForTimeout(120);

    await expect(page.locator(".soc-fim")).toBeVisible();
    await cabeInteira(page, vp, "com botão social");

    const social = await boxOf(page.locator(".soc-fim"), "botão social");
    // Alvo de dedo: o padrão do projeto para controle tocável.
    expect(Math.min(social.width, social.height),
      "o botão social ficou menor que um alvo de dedo").toBeGreaterThanOrEqual(40);

    if (process.env.KING_SHOTS) {
      await page.screenshot({ path: `${process.env.KING_SHOTS}/fim-social-${ti.project.name}.png` });
    }
  });

  /**
   * NOMES LONGOS E PONTUAÇÕES LARGAS.
   *
   * O KING é sempre de quatro, então quatro linhas é o caso real e o pior caso de ALTURA. O que
   * ainda pode crescer é o conteúdo de cada linha: um apelido no limite do campo e um saldo de
   * quatro dígitos com sinal. Nenhum dos dois pode empurrar a linha para fora da caixa.
   */
  test("com apelidos longos e saldos de quatro dígitos, nada estoura", async ({ page }, ti) => {
    test.setTimeout(180_000);
    await telaFinal(page);
    const vp = page.viewportSize()!;

    await page.evaluate(() => {
      const nomes = document.querySelectorAll(".fimlinha .nm");
      const notas = document.querySelectorAll(".fimlinha .sc");
      const longos = ["WWWWWWWWWWWWWW", "João Guilherme", "Christopher", "Maria Aparecida"];
      const saldos = ["−1250", "+1250", "−975", "0"];
      nomes.forEach((n, i) => { n.textContent = longos[i % longos.length]; });
      notas.forEach((s, i) => { s.textContent = saldos[i % saldos.length]; });
    });
    await page.waitForTimeout(120);

    await cabeInteira(page, vp, "nomes longos e saldos largos");

    // E o nome não pode invadir a coluna do saldo: são duas colunas do mesmo grid.
    const linhas = page.locator(".fimlinha");
    for (let i = 0; i < await linhas.count(); i++) {
      const nome = await boxOf(linhas.nth(i).locator(".nm"), `nome ${i}`);
      const nota = await boxOf(linhas.nth(i).locator(".sc"), `saldo ${i}`);
      expect(nome.x + nome.width,
        `o apelido da linha ${i} invadiu a coluna da pontuação`).toBeLessThanOrEqual(nota.x + SUBPIXEL);
    }

    if (process.env.KING_SHOTS) {
      await page.screenshot({ path: `${process.env.KING_SHOTS}/fim-nomes-longos-${ti.project.name}.png` });
    }
  });

  /**
   * MENOS LINHAS TAMBÉM PRECISA FICAR EM PÉ.
   *
   * A altura do ranking é `--fimrow × número de linhas`, calculada no componente. Com duas ou três
   * linhas a caixa encolhe junto — e o que se afirma é que a composição não desmonta quando isso
   * acontece: a coluna do resultado continua ancorada e o que restou continua dentro do viewport.
   */
  for (const quantas of [2, 3]) {
    test(`com ${quantas} linhas no ranking, a composição não desmonta`, async ({ page }) => {
      test.setTimeout(180_000);
      await telaFinal(page);
      const vp = page.viewportSize()!;

      await page.evaluate((n) => {
        const rank = document.querySelector(".fimrank") as HTMLElement;
        const linhas = [...document.querySelectorAll(".fimlinha")];
        linhas.slice(n).forEach((l) => l.remove());
        // A altura da caixa é derivada do número de linhas — acompanha, como no componente.
        rank.style.height = `calc(var(--fimrow) * ${n})`;
      }, quantas);
      await page.waitForTimeout(150);
      await estabilizar(page);

      await expect(page.locator(".fimlinha")).toHaveCount(quantas);
      await cabeInteira(page, vp, `${quantas} linhas`);
    });
  }
});

/**
 * TOCAR PARA PULAR TEM DE FICAR PULADO.
 *
 * Os quatro temporizadores da encenação eram agendados de uma vez na montagem e ninguém os
 * cancelava. `pular()` levava a tela direto a "completo" — e um instante depois os agendamentos
 * antigos disparavam nas marcas deles e REBOBINAVAM tudo para "contagem", "ranking", "campeao".
 * Quem tocava via a tela final aparecer inteira e voltar a se animar sozinha, e no meio da
 * reanimação as linhas do ranking se sobrepõem umas às outras.
 *
 * A afirmação é temporal de propósito, e AMOSTRADA. A primeira versão deste teste tocava, esperava
 * e conferia a etapa uma vez no fim — e passava com o defeito ligado, porque a linha do tempo
 * inteira dura 4,3s e já tinha terminado de rebobinar quando a conferência acontecia. O estado
 * final era o certo; o caminho até ele é que era errado, e é o caminho que a pessoa vê.
 *
 * Então mede-se o intervalo: toca assim que a tela aparece e observa a etapa de 200 em 200ms por
 * mais que a duração da encenação. Uma única amostra fora de "completo" reprova.
 */
test("um toque pula a encenação, e ela não volta sozinha", async ({ page }) => {
  test.setTimeout(180_000);
  await chegarAoFim(page);
  await page.locator(".fim").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await expect(page.locator(".fim")).toHaveClass(/etapa-completo/, { timeout: 5000 });

  const vistas: string[] = [];
  for (let i = 0; i < 30; i++) {
    const classe = (await page.locator(".fim").getAttribute("class")) ?? "";
    vistas.push(classe.replace("fim etapa-", ""));
    await page.waitForTimeout(200);
  }

  const desviou = vistas.filter((e) => e !== "completo");
  expect(desviou,
    `a encenação rebobinou depois do toque — etapas vistas: ${[...new Set(vistas)].join(" → ")}`,
  ).toEqual([]);
  await expect(page.locator(".fimacoes"), "os botões sumiram depois do toque").toBeVisible();
  await expect(page.locator(".fimpular"), '"toque para pular" voltou depois do toque')
    .toHaveCount(0);
});

/**
 * A MENSAGEM SOCIAL NA LINHA DO RANKING — medida, que é o que faltava.
 *
 * ══ O DEFEITO QUE ESTE ARQUIVO NÃO PEGOU ══
 *
 * O balão do placar final tinha teste de RENDER — a frase aparece na linha de quem falou, e em
 * nenhuma outra. Passava, e estava certo: o elemento estava no lugar certo da árvore.
 *
 * O que ninguém mediu foi a CAIXA dele. O override de posicionamento trocava a ancoragem para
 * `top`/`right` sem zerar o `left`/`bottom` da regra base, e um absoluto com as duas bordas
 * definidas não se ajusta ao conteúdo: estica na horizontal e é esmagado na vertical. Medido a
 * 852×300, o balão tinha 151px de largura por OITO de altura, atravessando o nome e encostando na
 * pontuação, com o texto vazando. Na tela lia como um botão dourado colado sobre a linha — e foi
 * um teste físico, não a suíte, que viu.
 *
 * Agora o balão divide a célula do nome e quem distribui o espaço é o flex. Estas asserções são
 * de GEOMETRIA porque é onde o defeito morava: presença na árvore já estava provada.
 *
 * O balão só existe no multiplayer, e chegar a um placar final multiplayer custa dez mãos com
 * dois navegadores. O elemento é injetado com as classes de verdade, como o botão social logo
 * acima — a pergunta é de layout, e quem responde é o CSS.
 */
test("a mensagem social cabe na linha, sem cobrir nome, avatar, posição ou pontuação", async ({ page }, ti) => {
  test.setTimeout(180_000);
  await telaFinal(page);
  const vp = page.viewportSize()!;

  const LINHA_ALVO = 2; // a terceira, como na evidência do relato
  await page.evaluate((i) => {
    const linha = document.querySelectorAll(".fimlinha")[i];
    const b = document.createElement("span");
    b.className = "balao";
    b.setAttribute("role", "status");
    b.textContent = "Revanche?";
    (linha.querySelector(".nmlinha") ?? linha).appendChild(b);
  }, LINHA_ALVO);
  await page.waitForTimeout(150);

  const linha = page.locator(".fimlinha").nth(LINHA_ALVO);
  const balao = linha.locator(".balao");
  await expect(balao, "a mensagem não foi renderizada na linha").toHaveCount(1);

  const cx = await boxOf(balao, "balão social");

  // 1 · A CAIXA COMPORTA O TEXTO. Oito pixels de altura foi o defeito; o piso é a linha de texto.
  const fonte = await balao.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fonte, "a mensagem ficou pequena demais para ser lida").toBeGreaterThanOrEqual(11);
  expect(cx.height, `a caixa do balão colapsou: ${cx.height}px para uma fonte de ${fonte}px`)
    .toBeGreaterThanOrEqual(fonte * 1.4);

  // 2 · A CAIXA É DO CONTEÚDO, e não esticada entre duas bordas. Uma caixa muito mais larga que o
  // texto é a assinatura exata do `left` + `right` não zerados.
  const larguraDoTexto = await balao.evaluate((el) => el.scrollWidth);
  expect(cx.width, `o balão tem ${cx.width}px para um texto de ${larguraDoTexto}px — caixa esticada`)
    .toBeLessThanOrEqual(larguraDoTexto + 4);

  // 3 · NÃO COBRE NADA DA LINHA. É a exigência do relato, item a item.
  for (const [sel, quem] of [
    [".p", "a posição"], [".av", "o avatar"], [".nm", "o nome"], [".sc", "a pontuação"],
  ] as [string, string][]) {
    const alvo = linha.locator(sel);
    if (!(await alvo.count())) continue;
    const outro = await boxOf(alvo.first(), quem);
    expect(intersects(cx as Box, outro as Box, SUBPIXEL),
      `[${ti.project.name}] a mensagem cobre ${quem}\n   balão: ${fmt(cx)}\n   ${quem}: ${fmt(outro)}`,
    ).toBe(false);
  }

  // 4 · CABE NA LINHA E NA TELA — nada de vazar por cima da linha vizinha.
  const caixaDaLinha = await boxOf(linha, "linha do ranking");
  expect(cx.y, "o balão subiu para fora da linha").toBeGreaterThanOrEqual(caixaDaLinha.y - SUBPIXEL);
  expect(cx.y + cx.height, "o balão desceu para fora da linha")
    .toBeLessThanOrEqual(caixaDaLinha.y + caixaDaLinha.height + SUBPIXEL);
  expect(insideViewport(cx as Box, vp, SUBPIXEL),
    `[${ti.project.name}] a mensagem saiu da tela: ${fmt(cx)}`).toBe(true);

  // 5 · E NÃO SE DISFARÇA DE CTA. Os botões desta tela são pílulas douradas SÓLIDAS; a mensagem é
  // o negativo disso. Se um dia alguém reaproveitar o estilo do botão aqui, isto acusa.
  const fundo = await balao.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(fundo, "o balão voltou a usar o gradiente dourado dos botões").toBe("none");

  // 6 · E A TELA CONTINUA INTEIRA com a mensagem nela.
  await cabeInteira(page, vp, "com mensagem social na linha");

  if (process.env.KING_SHOTS) {
    await page.screenshot({ path: `${process.env.KING_SHOTS}/fim-balao-${ti.project.name}.png` });
  }
});
