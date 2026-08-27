/**
 * O QUE O TESTE FÍSICO ENCONTROU E A SUÍTE NÃO ENCONTRAVA.
 *
 * Dois defeitos deste arquivo tinham a mesma origem: o mundo do teste era mais confortável que o
 * mundo real.
 *
 *   • O chip "Toque de novo" só existe com `pointer: coarse`. Todos os projetos do Playwright
 *     rodam com mouse, então ele nunca foi desenhado numa medição — e a colisão dele com o botão
 *     de chat, que mora exatamente no mesmo canto, só apareceu na mão de uma pessoa.
 *   • A mesa verde só quebrava contra um servidor que não conhecia a mensagem do tema. O teste
 *     sobe o servidor do próprio commit, onde ela existe; a produção rodava outro. A causa raiz
 *     está registrada no `PROTOCOL_VERSION`, e o que se trava aqui é o outro lado: escolher
 *     QUALQUER mesa não pode mudar nada além da cor.
 */
import { test, expect, type Page } from "@playwright/test";
import { boxOf, SEL } from "./helpers/mesa.js";
import { insideViewport, intersects, type Box } from "./helpers/geometry.js";
import { mesaEmPartida } from "./helpers/multiplayer.js";

const SUBPIXEL = 1;
const PASTA = process.env.KING_SHOTS;

/** Espera chegar a vez do humano em alguma das duas telas e devolve quem pode jogar. */
async function quemJoga(a: Page, b: Page): Promise<Page | null> {
  for (let i = 0; i < 40; i++) {
    for (const p of [a, b]) {
      if (await p.locator(SEL.handCardLegal).count()) return p;
      const trunfo = p.locator(".trumpbtn").first();
      if (await trunfo.count()) { await trunfo.click({ timeout: 5000 }).catch(() => {}); }
    }
    await a.waitForTimeout(400);
  }
  return null;
}

/**
 * O CHIP DE CONFIRMAÇÃO E O BOTÃO DE CHAT.
 *
 * Os dois nasciam ancorados no mesmo pixel — `right: pad+sr; bottom: pad+sb` — e o chat, com
 * `z-index` maior, cobria parte da instrução. O jogador tocava a carta, o jogo dizia o que fazer
 * em seguida, e a frase nascia pela metade.
 */
test("o 'Toque de novo' e o botão de chat não disputam o mesmo canto", async ({ browser }, ti) => {
  test.setTimeout(180_000);
  const vp = ti.project.use.viewport!;
  const m = await mesaEmPartida(browser, vp, { toque: true });

  try {
    // A emulação de toque precisa ter valido: sem `pointer: coarse` não existe segundo toque, e
    // o teste estaria medindo uma tela que o produto não tem no celular.
    const grosso = await m.anfitriao.evaluate(() => matchMedia("(pointer: coarse)").matches);
    expect(grosso, "a emulação de toque não pegou — o chip não existiria").toBe(true);

    const page = await quemJoga(m.anfitriao, m.convidado);
    test.skip(page === null, "a vez do humano não chegou dentro do orçamento");

    await page!.locator(SEL.handCardLegal).first().click();
    const chip = page!.locator(".confirmchip");
    await expect(chip, "o segundo toque não pediu confirmação").toBeVisible({ timeout: 10_000 });

    const caixaChip = await boxOf(chip, "confirmchip");
    const caixaChat = await boxOf(page!.locator(".mesa .soc"), "botão de chat");

    // 1 · NÃO SE CRUZAM
    expect(intersects(caixaChip as Box, caixaChat as Box),
      "o chip de confirmação e o botão de chat se sobrepõem").toBe(false);

    // 2 · O CHIP ESTÁ INTEIRO NA TELA
    expect(insideViewport(caixaChip as Box, vp, SUBPIXEL), "o chip saiu da tela").toBe(true);
    expect(insideViewport(caixaChat as Box, vp, SUBPIXEL), "o botão de chat saiu da tela").toBe(true);

    // 3 · O CHIP É QUEM RESPONDE NO PRÓPRIO CENTRO — visível de verdade, não só renderizado
    const noTopo = await chip.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const alvo = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return !!alvo && (el.contains(alvo) || alvo.contains(el));
    });
    expect(noTopo, "o chip está na tela mas coberto").toBe(true);

    // 4 · NENHUM DOS DOIS COBRE CARTA DO LEQUE
    const cartas = await page!.locator(SEL.handCard).all();
    for (const [i, c] of cartas.entries()) {
      const cx = await c.boundingBox();
      if (!cx) continue;
      expect(intersects(caixaChip as Box, cx as Box), `o chip cobre a carta ${i}`).toBe(false);
      expect(intersects(caixaChat as Box, cx as Box), `o chat cobre a carta ${i}`).toBe(false);
    }

    // 5 · O CHAT CONTINUA ALCANÇÁVEL: a correção não pode ter empurrado um para fora do outro
    await expect(page!.locator(".mesa .soc")).toBeEnabled();

    if (PASTA) await page!.screenshot({ path: `${PASTA}/toque-de-novo-${ti.project.name}.png` });

    // 6 · E a mecânica não mudou: o segundo toque joga a carta
    await page!.locator(SEL.handCardSelected).first().click();
    await expect(page!.locator(".confirmchip")).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await m.fechar();
  }
});

/**
 * MATRIZ DE TEMAS.
 *
 * Não se testa só o verde. O tema é apresentação, e a promessa é forte: escolher qualquer mesa
 * não muda número de jogadores, ready, regras, criação da sala nem início da partida. Cada tema
 * faz o percurso inteiro — sala, segundo humano, dois bots, escolha do tema, prontos, Mesa, e
 * pelo menos uma vaza jogada.
 */
for (const tema of ["imperial", "verde"] as const) {
  test(`mesa ${tema}: a sala começa a partida normalmente`, async ({ browser }, ti) => {
    test.skip(ti.project.name !== "667x375", "comportamento, não geometria");
    test.setTimeout(180_000);
    const vp = ti.project.use.viewport!;
    const m = await mesaEmPartida(browser, vp, { tema });

    try {
      // 1 · A PARTIDA COMEÇOU nos dois aparelhos — é isto que o defeito impedia.
      for (const p of [m.anfitriao, m.convidado]) {
        await expect(p.locator(".mesa")).toBeVisible({ timeout: 30_000 });
        await expect(p.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
        // 2 · e os dois estão na MESMA mesa: o tema é estado compartilhado, não preferência local
        await expect(p.locator(`.mesa[data-tema="${tema}"]`)).toHaveCount(1);
      }

      // 3 · A MESA É A DE SEMPRE: quatro assentos, ninguém a mais, ninguém a menos.
      await expect(m.anfitriao.locator(".opp")).toHaveCount(3);
      await expect(m.anfitriao.locator(".youtag")).toHaveCount(1);

      // 4 · E JOGA. Uma vaza de verdade: o tema não pode ter mexido no motor.
      const page = await quemJoga(m.anfitriao, m.convidado);
      test.skip(page === null, "a vez do humano não chegou dentro do orçamento");
      const antes = await page!.locator(SEL.handCard).count();
      await page!.locator(SEL.handCardLegal).first().click();
      if (await page!.locator(SEL.handCardSelected).count()) {
        await page!.locator(SEL.handCardSelected).first().click();
      }
      await expect(page!.locator(SEL.handCard)).toHaveCount(antes - 1, { timeout: 20_000 });

      if (PASTA) await m.anfitriao.screenshot({ path: `${PASTA}/mesa-${tema}.png` });
    } finally {
      await m.fechar();
    }
  });
}

/**
 * IDENTIDADE NA MESA, COM DUAS PESSOAS DE VERDADE.
 *
 * O relato foi: "a Raiza escolheu Unicórnio e entrou como Leão". A causa raiz era o servidor
 * implantado não conhecer a etiqueta — mas o caminho do cliente também precisa de guarda, e é o
 * que se mede aqui: o que se escolhe no lobby é o que aparece na mesa dos DOIS aparelhos.
 */
test("o avatar escolhido no lobby é o que aparece na mesa dos dois", async ({ browser }, ti) => {
  test.skip(ti.project.name !== "667x375", "comportamento, não geometria");
  test.setTimeout(180_000);
  const vp = ti.project.use.viewport!;
  // O UNICÓRNIO É O CASO DO RELATO, letra por letra: "a Raiza escolheu Unicórnio e apareceu
  // como Leão". Ele foi o último a entrar no catálogo, então é ele que um servidor velho não
  // conhece e troca pelo padrão em silêncio — o canário desta família de defeito.
  const m = await mesaEmPartida(browser, vp, {
    avatares: { anfitriao: "Sapo", convidado: "Unicórnio" },
  });

  try {
    for (const p of [m.anfitriao, m.convidado]) {
      const rotulos = await p.locator(".mesa .av[aria-label]").evaluateAll(
        (ns) => ns.map((n) => n.getAttribute("aria-label")),
      );
      expect(rotulos, "o Sapo do anfitrião sumiu no caminho").toContain("Sapo");
      // Se o Unicórnio tivesse virado Leão — o defeito relatado — esta linha cairia. Ela é a
      // asserção do caso, e não se acrescenta um "não contém Leão" ao lado: o Leão é um avatar
      // legítimo, que um bot pode receber, e um teste que proibisse o bicho em vez de exigir o
      // certo quebraria por motivo errado no dia em que a distribuição dos bots mudasse.
      expect(rotulos, "o Unicórnio da convidada virou outra coisa").toContain("Unicórnio");
      // e nenhum assento humano virou o padrão por falta de identidade
      expect(new Set(rotulos).size, "dois assentos com o mesmo desenho").toBe(rotulos.length);
    }
    if (PASTA) {
      await m.anfitriao.screenshot({ path: `${PASTA}/mesa-avatares-anfitriao.png` });
      await m.convidado.screenshot({ path: `${PASTA}/mesa-avatares-convidada.png` });
    }
  } finally {
    await m.fechar();
  }
});

/**
 * O SELETOR DO LOBBY COM UM BICHO JÁ OCUPADO.
 *
 * Duas pessoas na sala, e o bicho de uma aparece indisponível para a outra — visível, apagado,
 * sem ser clicável. Continuar visível é requisito: sumir com ele reposicionaria os demais no
 * instante em que um dedo já está a caminho de um deles.
 */
test("no lobby, o avatar de outro humano aparece como Em uso", async ({ browser }, ti) => {
  test.skip(ti.project.name !== "667x375", "comportamento, não geometria");
  test.setTimeout(120_000);
  const vp = ti.project.use.viewport!;
  const ctxA = await browser.newContext({ viewport: vp });
  const ctxB = await browser.newContext({ viewport: vp });

  try {
    const anfitriao = await ctxA.newPage();
    const convidado = await ctxB.newPage();
    const { criarSala, entrarNaSala } = await import("./helpers/multiplayer.js");
    const codigo = await criarSala(anfitriao, "Tito", "Sapo");
    await entrarNaSala(convidado, codigo, "Raiza", "Panda");

    // O SELETOR NÃO OCUPA ALTURA ENQUANTO FECHADO — foi a primeira tentativa, e ela derrubou o
    // quarto lugar para fora da tela. O caminho é o próprio círculo do assento.
    await expect(convidado.locator(".sl-avop")).toHaveCount(0, { timeout: 20_000 });
    await convidado.locator(".sl-lugar.voce .sl-av-troca").click();
    await expect(convidado.locator(".sl-avop")).toHaveCount(8, { timeout: 20_000 });

    // O Sapo é do Tito: para a Raiza ele é "em uso".
    const sapo = convidado.locator('.sl-avop[aria-label*="Sapo"]');
    await expect(sapo, "o Sapo do outro não apareceu como em uso").toHaveClass(/emuso/, { timeout: 20_000 });
    await expect(sapo).toBeDisabled();
    await expect(sapo).toContainText("Em uso");

    // O Panda é dela: continua escolhível e marcado.
    const panda = convidado.locator('.sl-avop[aria-label*="Panda"]');
    await expect(panda).toHaveClass(/on/);
    await expect(panda).toBeEnabled();

    if (PASTA) await convidado.screenshot({ path: `${PASTA}/lobby-avatar-em-uso.png` });

    // E TROCAR PARA UM LIVRE VALE, nos dois aparelhos — a sala é estado compartilhado.
    await convidado.locator('.sl-avop[aria-label="Coruja"]').click();
    // escolher fecha o seletor: ele cumpriu a função
    await expect(convidado.locator(".sl-avop")).toHaveCount(0, { timeout: 15_000 });
    await expect(convidado.locator(".sl-lugar.voce .sl-av"),
      "o círculo do assento não passou a mostrar a Coruja").toHaveText("🦉", { timeout: 15_000 });

    await anfitriao.locator(".sl-lugar.voce .sl-av-troca").click();
    await expect(anfitriao.locator('.sl-avop[aria-label*="Coruja"]'),
      "a troca não chegou ao outro aparelho").toHaveClass(/emuso/, { timeout: 15_000 });
    // e o Panda voltou a ficar livre para os dois
    await expect(anfitriao.locator('.sl-avop[aria-label="Panda"]')).not.toHaveClass(/emuso/);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

/**
 * O PLACAR FINAL DEPOIS DA PODA — na tela, não no unitário.
 *
 * O que saiu da tela final foi: o bloco "Última mão" e os selos "Amplitude", "Negativas ilesas" e
 * "Soma dos saldos = 0 ✓". Os três selos eram verdadeiros e nenhum era para o jogador; o bloco
 * repetia, com menos detalhe, o que o placar entre-mãos já tinha mostrado um minuto antes.
 *
 * O unitário cobre o cálculo (que continua existindo) e o arquivo (que não os renderiza mais).
 * Este cobre o que nenhum dos dois alcança: a tela montada, com a encenação inteira concluída —
 * porque os selos só existem na ETAPA FINAL da animação, depois dos temporizadores, e
 * `renderToStaticMarkup` nunca chega lá.
 */
/**
 * TRÊS VIEWPORTS, e não um.
 *
 * O conteúdo desta tela é o mesmo em qualquer tamanho, mas a checagem de que ele CABE não é —
 * e foi ela que encontrou o defeito: a 667x375 o selo que sobrou depois da poda ficava fora da
 * tela, cortado pelo `overflow:hidden` do fundo, porque a regra de coluna única olhava só a
 * largura e um celular deitado é estreito E baixo. Os três cobrem os casos que divergem: o
 * deitado apertado, o mais baixo que o projeto promete atender, e o desktop folgado.
 */
const VIEWPORTS_DO_FIM = ["667x375", "852x300", "1600x900"];

test("o placar final chega inteiro e sem os quatro elementos removidos", async ({ page }, ti) => {
  test.skip(!VIEWPORTS_DO_FIM.includes(ti.project.name), "amostra de viewports, não todos");
  test.setTimeout(180_000);
  const vp = page.viewportSize()!;

  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  // A mão 10 é a última: jogá-la até o fim é o caminho mais curto até a tela de encerramento.
  await page.goto("/?seed=42&mao=10");
  await page.locator(SEL.startBtn).click();
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });

  // O anúncio da última mão entra primeiro e sai sozinho; um toque encurta.
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

  // A encenação termina sozinha; um toque pula. Os selos só existem na etapa final.
  await page.locator(".fim").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await expect(page.locator(".fimchips")).toBeVisible({ timeout: 20_000 });
  // As linhas do ranking se reposicionam por `transform` com transição. Ler ou fotografar no meio
  // dela mostra as quatro linhas empilhadas umas sobre as outras — que não é a tela, é um quadro
  // dela. Espera as caixas pararem de se mexer antes de medir.
  await expect(async () => {
    const a1 = await page.locator(".fimlinha").first().boundingBox();
    await page.waitForTimeout(120);
    const a2 = await page.locator(".fimlinha").first().boundingBox();
    expect(a2?.y).toBe(a1?.y);
  }).toPass({ timeout: 10_000 });

  // ── 1 · O QUE PRECISA CONTINUAR ──
  await expect(page.locator(".fimlinha")).toHaveCount(4);
  await expect(page.locator(".fimtitulo")).toBeVisible();
  await expect(page.locator(".fimdest")).toBeVisible();
  // classificação e pontuação de cada um continuam desenhadas
  expect(await page.locator(".fimlinha .sc").count()).toBe(4);

  // ── 2 · OS QUATRO QUE SAÍRAM ──
  await expect(page.locator(".fimultima"), "o bloco 'Última mão' voltou").toHaveCount(0);
  const selos = await page.locator(".fimchips .pl-tag").allTextContents();
  expect(selos, "sobrou mais de um selo na tela final").toHaveLength(1);
  expect(selos[0]).toMatch(/Melhor mão da partida/);
  const tudo = (await page.locator(".fim").textContent()) ?? "";
  for (const proibido of ["Amplitude", "Negativas ilesas", "Soma dos saldos"]) {
    expect(tudo, `"${proibido}" voltou à tela final`).not.toContain(proibido);
  }

  // ── 3 · E OS BICHOS, TAMBÉM AQUI ──
  const insignias = await page.locator(".fimlinha .av").allTextContents();
  expect(insignias).toHaveLength(4);
  for (const i of insignias) {
    expect(i.trim(), "o placar final voltou a desenhar inicial").not.toMatch(/^[A-Za-zÀ-ÿ]$/);
  }

  // ── 4 · E O QUE SOBROU CABE NA TELA ──
  // Despoluir só vale se o que ficou for legível. O selo restante e o destaque narrativo têm de
  // estar dentro do viewport, não abaixo dele.
  for (const sel of [".fimchips", ".fimdest", ".fimrank"]) {
    const caixa = await boxOf(page.locator(sel), sel);
    expect(insideViewport(caixa as Box, vp, SUBPIXEL), `${sel} não cabe na tela final`).toBe(true);
  }

  if (PASTA) await page.screenshot({ path: `${PASTA}/placar-final-simplificado.png` });
});
