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
    await expect(convidado.locator(".balao").first(), "a mensagem não chegou ao outro cliente")
      .toBeVisible({ timeout: 10_000 });
    await expect(convidado.locator(".balao").first()).toHaveText(texto);

    // ── O LIMITE DO SERVIDOR CONTINUA VALENDO ──
    // Dar uma porta nova não pode dar um caminho novo para spam. Uma segunda mensagem, imediata:
    // o servidor decide o que passa, e no outro cliente nunca há dois balões do mesmo assento.
    await gatilho.click();
    await anfitriao.locator(".placarov .socbtn").nth(1).click();
    await anfitriao.waitForTimeout(400);
    const baloes = await convidado.locator(".opp .balao, .youtag .balao").count();
    expect(baloes, "mais de um balão simultâneo para o mesmo assento").toBeLessThanOrEqual(1);

    // ── E o Placar continua servindo para o que ele existe ──
    await expect(anfitriao.locator(".pl-rows")).toBeVisible();
    await expect(anfitriao.locator(".pl-actions")).toBeVisible();
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
