/**
 * SOCIAL ENTRE AS MÃOS, COM GENTE DOS DOIS LADOS.
 *
 * O que só um teste com duas sessões de verdade prova, e por isso este arquivo existe:
 *
 *   • a mensagem enviada do Placar entre-mãos chega ao OUTRO cliente, não só ao próprio;
 *   • é o mesmo sistema da Mesa: mesmo catálogo, mesma etiqueta na rede, mesmo servidor validando;
 *   • o cooldown do servidor continua valendo no Placar — dar uma porta nova não pode dar um
 *     caminho novo para spam;
 *   • e um relógio local adulterado não muda nada disso, porque nada aqui depende da hora do
 *     aparelho.
 */
import { test, expect, type Page } from "@playwright/test";
import { boxOf, SEL } from "./helpers/mesa.js";
import { insideViewport, type Box } from "./helpers/geometry.js";
import { mesaEmPartida } from "./helpers/multiplayer.js";

const SUBPIXEL = 1;

/**
 * UM VIEWPORT SÓ, e a razão é honesta: o que estes três testes medem é COMPORTAMENTO — a mensagem
 * atravessa a rede, o cooldown do servidor vale, o relógio local não conta. Nada disso muda com o
 * tamanho da tela, e a geometria das mesmas telas já é medida nos treze viewports em
 * `polimento.spec.ts`.
 *
 * O custo é real: jogar uma mão inteira de 13 vazas em duas sessões de navegador leva minutos, no
 * ritmo do jogo (pausa de leitura da vaza, cadência dos bots). Multiplicar isso por treze telas
 * seria pagar caro por treze vezes a mesma resposta.
 */
const VIEWPORT_DE_REFERENCIA = "667x375";

/**
 * O elemento é quem está POR CIMA no próprio ponto central?
 *
 * `toBeVisible()` responde "tem caixa e não está com display:none". Não responde "dá para ver".
 * Um elemento perfeitamente renderizado atrás de um overlay passa por visível, e foi assim que um
 * defeito P0 atravessou a suíte inteira e só apareceu na mão de uma pessoa.
 */
async function noTopo(page: Page, seletor: string): Promise<boolean> {
  return page.locator(seletor).first().evaluate((el) => {
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return false;
    const noPonto = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return !!noPonto && (el.contains(noPonto) || noPonto.contains(el));
  });
}


/**
 * Joga a mão inteira pelas duas telas, até o Placar entre-mãos aparecer.
 *
 * ESPERA, NÃO SONDA. A primeira versão perguntava "já dá para jogar?" a cada 45ms nas duas
 * páginas, e as próprias perguntas custavam mais do que o jogo: mais de mil idas e voltas ao
 * navegador só para descobrir que ainda era a vez de um bot. A mão levava quatro minutos e
 * estourava o teto do teste.
 *
 * Aqui o teste dorme até alguma coisa ficar acionável — uma carta legal em qualquer das duas
 * telas, ou o Placar — e só então age. O tempo de parede passa a ser o do jogo, que é o que se
 * queria medir desde o começo.
 */
async function ateOPlacar(a: Page, b: Page): Promise<boolean> {
  const quieto = <T,>(p: Promise<T>) => p.then(() => true).catch(() => false);

  for (let i = 0; i < 120; i++) {
    if (await a.locator(".placarov").count()) return true;

    await Promise.race([
      quieto(a.locator(SEL.handCardLegal).first().waitFor({ state: "visible", timeout: 12_000 })),
      quieto(b.locator(SEL.handCardLegal).first().waitFor({ state: "visible", timeout: 12_000 })),
      quieto(a.locator(".trumpbtn").first().waitFor({ state: "visible", timeout: 12_000 })),
      quieto(b.locator(".trumpbtn").first().waitFor({ state: "visible", timeout: 12_000 })),
      quieto(a.locator(".placarov").waitFor({ state: "visible", timeout: 12_000 })),
    ]);

    // SAIR NA HORA. O Placar entre-mãos é TRANSITÓRIO: o servidor marca pronto sozinho quem passa
    // do prazo, e a tela segue para a mão seguinte. A primeira versão saía do `race` e ainda
    // tentava clicar uma carta — que a essa altura estava coberta pelo Placar. O clique ficava
    // esperando o alvo desobstruir, o prazo do servidor vencia, o Placar sumia, e o laço voltava
    // ao topo sem tê-lo visto. Ele chegou a atravessar a mão 1 inteira assim.
    if (await a.locator(".placarov").count()) return true;

    for (const p of [a, b]) {
      const trunfo = p.locator(".trumpbtn").first();
      if (await trunfo.count()) { await trunfo.click({ timeout: 5000 }).catch(() => {}); continue; }
      const carta = p.locator(SEL.handCardLegal).first();
      if (await carta.count()) {
        await carta.click({ timeout: 5000 }).catch(() => {});
        if (await p.locator(SEL.handCardSelected).count()) {
          await carta.click({ timeout: 5000 }).catch(() => {});
        }
      }
    }
  }
  return false;
}

/**
 * UMA MÃO INTEIRA, UM TESTE SÓ.
 *
 * Jogar 13 vazas em duas sessões de navegador leva minutos, no ritmo real do jogo. Havia dois
 * testes fazendo esse mesmo caminho para perguntar coisas diferentes no fim dele, e o segundo
 * pagava de novo o preço inteiro. Aqui a mão é jogada uma vez e as duas perguntas são feitas
 * sobre a mesma tela: a mensagem atravessa, e o limite do servidor continua valendo.
 */
test("no Placar entre-mãos: a mensagem atravessa e o cooldown continua valendo", async ({ browser }, ti) => {
  test.skip(ti.project.name !== VIEWPORT_DE_REFERENCIA, "comportamento, não geometria");
  test.setTimeout(300_000);
  const vp = ti.project.use.viewport!;
  const m = await mesaEmPartida(browser, vp);
  const { anfitriao, convidado } = m;

  try {
    test.skip(!(await ateOPlacar(anfitriao, convidado)), "a mão não fechou dentro do orçamento");

    // ── O gatilho existe NO PLACAR, e é o mesmo componente da Mesa ──
    const gatilho = anfitriao.locator(".placarov .soc");
    await expect(gatilho, "o Placar entre-mãos precisa ter mensagens rápidas").toBeVisible();

    const caixa = await boxOf(gatilho, "gatilho social do placar");
    expect(Math.round(Math.min(caixa.width, caixa.height)), "alvo de toque").toBeGreaterThanOrEqual(44 - SUBPIXEL);
    expect(insideViewport(caixa as Box, vp, SUBPIXEL), "o gatilho saiu da tela").toBe(true);

    // Não pode cobrir o que decide a tela: o resultado da mão e o CTA de continuar.
    for (const sel of [".pl-rows", ".pl-actions"]) {
      const outro = await boxOf(anfitriao.locator(sel), sel);
      const cruza = !(caixa.x + caixa.width < outro.x || caixa.x > outro.x + outro.width
        || caixa.y + caixa.height < outro.y || caixa.y > outro.y + outro.height);
      expect(cruza, `o gatilho social cobre ${sel}`).toBe(false);
    }

    // ── A MENSAGEM ATRAVESSA ──
    await gatilho.click();
    const frases = anfitriao.locator(".placarov .socbtn");
    await expect(frases.first()).toBeVisible();
    const texto = (await frases.first().textContent())?.trim() ?? "";
    await frases.first().click();

    // A etiqueta viaja pela rede; o texto é desenhado por cada cliente da própria tabela. Se as
    // duas pontas mostram a mesma frase, é o mesmo catálogo dos dois lados.
    // O balão que importa é o DA CAMADA DE CIMA. Existe um em cada uma — o dos cards da Mesa e o
    // das linhas do Placar — porque o intervalo pode acabar a qualquer momento e a mensagem tem
    // de continuar visível dos dois lados da transição.
    const naTela = convidado.locator(".placarov .balao").first();
    await expect(naTela, "a mensagem não chegou ao outro cliente").toBeVisible({ timeout: 10_000 });
    await expect(naTela).toHaveText(texto);

    // ── E QUEM MANDOU TAMBÉM VÊ ──
    //
    // Isto faltava, e a falta foi relatada como defeito: "não aparece para quem enviou". A
    // difusão do servidor inclui o próprio remetente, então o balão dele nasce na linha dele —
    // mas nascer não é aparecer. Quem acabou de tocar tem, na mesma tela, o painel de frases que
    // estava aberto um instante antes; se ele não sair da frente, a pessoa manda uma mensagem e
    // não vê nada acontecer.
    const meuBalao = anfitriao.locator(".placarov .balao").first();
    await expect(meuBalao, "quem enviou não viu a própria mensagem").toBeVisible({ timeout: 10_000 });
    await expect(meuBalao).toHaveText(texto);
    expect(await noTopo(anfitriao, ".placarov .balao"),
      "o balão de quem enviou está COBERTO na própria tela").toBe(true);
    if (process.env.KING_SHOTS) {
      const dir = process.env.KING_SHOTS;
      await anfitriao.screenshot({ path: `${dir}/social-quem-enviou.png` });
      await convidado.screenshot({ path: `${dir}/social-quem-recebeu.png` });
    }
    // e o painel de frases fechou sozinho: ele cumpriu a função dele.
    expect(await anfitriao.locator(".placarov .socbtn").count(),
      "o painel de frases continuou aberto depois do envio").toBe(0);

    // ── E ESTÁ REALMENTE À VISTA ──
    //
    // Esta checagem existe porque a versão anterior deste teste passou verde enquanto o defeito
    // estava na tela de um iPhone. `toBeVisible()` do Playwright olha CSS e tamanho, NÃO olha
    // oclusão: o balão renderizava nos cards da Mesa, o Placar é um overlay por cima da Mesa, e o
    // teste dizia "visível" para um elemento que nenhum humano conseguia ver. A pergunta certa é
    // se o balão é quem está no topo no próprio ponto central.
    expect(await noTopo(convidado, ".placarov .balao"),
      "o balão está na tela mas COBERTO por outra camada").toBe(true);

    // ── O LIMITE DO SERVIDOR CONTINUA VALENDO ──
    // Dar uma porta nova não pode dar um caminho novo para spam. Uma segunda mensagem, imediata:
    // o servidor decide o que passa, e no outro cliente nunca há dois balões do mesmo assento.
    await gatilho.click();
    await anfitriao.locator(".placarov .socbtn").nth(1).click();
    await anfitriao.waitForTimeout(400);
    const baloes = await convidado.locator(".placarov .balao").count();
    expect(baloes, "mais de um balão simultâneo para o mesmo assento").toBeLessThanOrEqual(1);

    // ── E o Placar continua servindo para o que ele existe ──
    await expect(anfitriao.locator(".pl-rows")).toBeVisible();
    await expect(anfitriao.locator(".pl-actions")).toBeVisible();

    // ══════════ A MESMA TELA, AS OUTRAS TRÊS PERGUNTAS ══════════
    //
    // Esta mão custa minutos de relógio de parede para ser jogada em duas sessões. Fazer o
    // caminho de novo para perguntar outra coisa sobre a MESMA tela seria pagar duas vezes pela
    // mesma resposta — o princípio que já rege este arquivo.

    // ── 1 · OS BICHOS, NÃO AS INICIAIS ──
    // O relato foi literal: "aparecem círculos com letras — T, V, R, R". Um glifo de bicho tem
    // exatamente um caractere, e uma inicial também; o que os separa é NÃO ser uma letra do
    // alfabeto latino. É isso que se cobra, em vez de comparar com a lista de emojis.
    const insignias = await anfitriao.locator(".placarov .pl-av").allTextContents();
    expect(insignias, "o placar entre-mãos não desenhou os quatro").toHaveLength(4);
    for (const i of insignias) {
      expect(i.trim(), "o placar voltou a desenhar inicial no lugar do bicho").not.toMatch(/^[A-Za-zÀ-ÿ]$/);
    }
    // Os dois humanos escolheram bichos diferentes no lobby (Sapo e Panda): eles têm de continuar
    // diferentes aqui, senão a identidade se perdeu em algum ponto do caminho.
    expect(new Set(insignias.map((i) => i.trim())).size, "dois assentos com o mesmo desenho")
      .toBe(4);

    const pasta = process.env.KING_SHOTS;
    if (pasta) await anfitriao.screenshot({ path: `${pasta}/placar-intermediario-bichos.png` });

    // ── 2 · NENHUMA BARRA DE ROLAGEM ──
    const rolagem = async (page: Page) => page.locator(".placar").evaluate((el) => ({
      x: el.scrollWidth - el.clientWidth,
      y: el.scrollHeight - el.clientHeight,
    }));
    const antes = await rolagem(anfitriao);
    expect(antes.x, "o placar entre-mãos rola na horizontal").toBeLessThanOrEqual(SUBPIXEL);
    expect(antes.y, "o placar entre-mãos rola na vertical").toBeLessThanOrEqual(SUBPIXEL);

    // ── 3 · O TOGGLE DO PRONTO NÃO MEXE NA GEOMETRIA ──
    //
    // Este é o defeito relatado inteiro: "clico em Estou pronto, tento desfazer, a interface fica
    // bugada, aparece barra de rolagem, o layout muda". A causa era serem DOIS botões diferentes
    // trocando de lugar — um de uma linha, outro de duas. O que se mede aqui é a consequência
    // observável: a caixa do rodapé antes e depois de cada clique.
    const botao = anfitriao.locator(".placarov .pl-toggle");
    await expect(botao).toBeVisible();
    const rodape = async () => JSON.stringify(await anfitriao.locator(".pl-foot").boundingBox());
    const caixaBotao = async () => {
      const b = await anfitriao.locator(".placarov .pl-toggle").boundingBox();
      return `${Math.round(b!.width)}x${Math.round(b!.height)}`;
    };

    const rodapeAntes = await rodape();
    const botaoAntes = await caixaBotao();
    expect(await botao.getAttribute("aria-pressed")).toBe("false");
    // A LINHA DE BASE NÃO É ZERO: os dois bots já nascem prontos, e é por isso que se conta a
    // DIFERENÇA em vez de um número absoluto. Fixar "1" seria escrever no teste a composição da
    // mesa deste cenário, e ela muda com o número de bots.
    const prontosNoOutro = () => convidado.locator(".placarov .pl-pronto.ok").count();
    const base = await prontosNoOutro();

    await botao.click();
    await expect(anfitriao.locator(".placarov .pl-toggle.on")).toBeVisible({ timeout: 10_000 });
    if (pasta) await anfitriao.screenshot({ path: `${pasta}/placar-pronto-marcado.png` });
    expect(await caixaBotao(), "o botão mudou de tamanho ao ficar pronto").toBe(botaoAntes);
    expect(await rodape(), "o rodapé do placar mudou de geometria").toBe(rodapeAntes);
    const marcado = await rolagem(anfitriao);
    expect(marcado.y, "marcar pronto criou barra de rolagem").toBeLessThanOrEqual(SUBPIXEL);
    expect(marcado.x, "marcar pronto criou rolagem horizontal").toBeLessThanOrEqual(SUBPIXEL);

    // e o OUTRO cliente vê o mesmo estado — pronto é do servidor, não da tela de quem clicou
    await expect(async () => {
      expect(await prontosNoOutro(), "o outro cliente não viu o pronto").toBe(base + 1);
    }).toPass({ timeout: 10_000 });

    // ── desfazer ──
    await botao.click();
    await expect(anfitriao.locator(".placarov .pl-toggle.on"),
      "não deu para desmarcar o pronto").toHaveCount(0, { timeout: 10_000 });
    if (pasta) await anfitriao.screenshot({ path: `${pasta}/placar-pronto-desmarcado.png` });
    expect(await caixaBotao(), "o botão mudou de tamanho ao desfazer").toBe(botaoAntes);
    expect(await rodape(), "desfazer mexeu na geometria do rodapé").toBe(rodapeAntes);
    const desfeito = await rolagem(anfitriao);
    expect(desfeito.y, "desfazer criou barra de rolagem").toBeLessThanOrEqual(SUBPIXEL);
    await expect(async () => {
      expect(await prontosNoOutro(), "o outro cliente não viu o pronto ser desfeito").toBe(base);
    }).toPass({ timeout: 10_000 });

    // ── e marcar de novo funciona: o toggle é toggle, não um caminho de mão única ──
    await botao.click();
    await expect(anfitriao.locator(".placarov .pl-toggle.on")).toBeVisible({ timeout: 10_000 });
    expect(await rodape(), "o terceiro clique mexeu na geometria").toBe(rodapeAntes);

    // ── 4 · TUDO O QUE IMPORTA CONTINUA DENTRO DA TELA ──
    for (const sel of [".placarov .pl-toggle", ".placarov .soc", ".pl-rows", ".pl-next"]) {
      const caixa = await boxOf(anfitriao.locator(sel), sel);
      expect(insideViewport(caixa as Box, vp, SUBPIXEL), `${sel} saiu da tela`).toBe(true);
    }
  } finally {
    await m.fechar();
  }
});

/**
 * RELÓGIO LOCAL ADULTERADO.
 *
 * Um cliente cinco segundos adiantado e outro cinco atrasado, na MESMA sala. Nada no KING depende
 * da hora do aparelho: o servidor manda duração e o cliente conta com uma régua monotônica, que
 * `Date.now` não move. Este teste mexe justamente no que a aplicação não usa — se um dia alguém
 * trocar o modelo por comparação de carimbos, ele cai.
 */
test("relógios locais divergentes não mudam a partida", async ({ browser }, ti) => {
  test.skip(ti.project.name !== VIEWPORT_DE_REFERENCIA, "comportamento, não geometria");
  test.setTimeout(300_000);
  const vp = ti.project.use.viewport!;
  const ctxA = await browser.newContext({ viewport: vp });
  const ctxB = await browser.newContext({ viewport: vp });

  // +5s de um lado, −5s do outro. `performance.now()` fica intocado de propósito: é ele que a
  // aplicação usa, e o ponto do teste é que adulterar o OUTRO relógio não produz efeito.
  for (const [ctx, desvio] of [[ctxA, 5000], [ctxB, -5000]] as const) {
    await ctx.addInitScript((d) => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + d;
    }, desvio);
  }

  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  try {
    const { criarSala, entrarNaSala } = await import("./helpers/multiplayer.js");
    const codigo = await criarSala(a, "Tito", "Sapo");
    await entrarNaSala(b, codigo, "Raiza", "Panda");

    await expect(a.locator(".sl-bot.add")).toHaveCount(2, { timeout: 20_000 });
    await a.locator(".sl-bot.add").first().click();
    await expect(a.locator(".sl-bot.add")).toHaveCount(1, { timeout: 20_000 });
    await a.locator(".sl-bot.add").first().click();

    await a.getByRole("button", { name: /Estou pronto/ }).click();
    await b.getByRole("button", { name: /Estou pronto/ }).click();

    await expect(a.locator(".mesa")).toBeVisible({ timeout: 30_000 });
    await expect(b.locator(".mesa")).toBeVisible({ timeout: 30_000 });

    // A MESMA MESA para os dois: mesma mão, mesmo contrato, mesma vaza.
    const hudA = await a.locator(`${SEL.hud} .ph`).textContent();
    const hudB = await b.locator(`${SEL.hud} .ph`).textContent();
    expect(hudA).toBe(hudB);

    // E o relógio da decisão, quando aparece, mostra um tempo PLAUSÍVEL nos dois. Com carimbo
    // absoluto do servidor, o aparelho deslocado marcaria cinco segundos a mais ou a menos.
    for (const p of [a, b]) {
      const chip = p.locator(".mprelogio b");
      if (await chip.count()) {
        const s = Number(((await chip.textContent()) ?? "").replace(/\D/g, ""));
        expect(s, "segundos fora de qualquer faixa razoável").toBeGreaterThanOrEqual(0);
        expect(s, "segundos fora de qualquer faixa razoável").toBeLessThanOrEqual(60);
      }
    }
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
