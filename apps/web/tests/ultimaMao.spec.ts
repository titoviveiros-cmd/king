/**
 * "ÚLTIMA MÃO DO JOGO!" no navegador de verdade.
 *
 * O risco de um anúncio no meio da partida não é ele ser feio: é BLOQUEAR. Estes testes medem
 * exatamente isso — que ele sai sozinho, que o toque encurta, que depois de sair não sobra nada
 * interceptando a Mesa, e que ele nunca aparece na mão errada.
 */
import { test, expect, type Page } from "@playwright/test";
import { insideViewport, type Box } from "./helpers/geometry.js";
import { boxOf, SEL } from "./helpers/mesa.js";

const SUBPIXEL = 1;

/**
 * Abre a Mesa local JÁ na mão pedida.
 *
 * Jogar nove mãos de 13 vazas pela interface leva mais de cinco minutos, no ritmo dos bots e das
 * pausas de leitura. O `?mao=` é a mesma afordância de QA que o `?seed=` já era, e monta a mão
 * pelo motor: contrato, distribuição, dealer e rotação do trunfo continuam sendo dele.
 */
async function mesaNaMao(page: Page, mao: number): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  await page.goto(`/?seed=42&mao=${mao}`);
  await page.locator(SEL.startBtn).click();
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`${SEL.hud} .ph`)).toContainText(`Mão ${mao}`);
}

test("aparece na mão 10, some sozinho e não deixa nada interceptando", async ({ page }, ti) => {
  const vp = page.viewportSize()!;
  // Na mão 9 ainda não existe.
  await mesaNaMao(page, 9);
  await page.waitForTimeout(500);
  await expect(page.locator(".um"), "apareceu antes da hora").toHaveCount(0);

  await mesaNaMao(page, 10);

  const selo = page.locator(".um-selo");
  await expect(selo).toBeVisible({ timeout: 15_000 });
  await expect(selo).toContainText("ÚLTIMA MÃO");
  await expect(selo).toContainText("Tudo pode mudar");

  // Cabe na tela em qualquer viewport.
  const caixa = await boxOf(selo, "um-selo");
  expect(
    insideViewport(caixa as Box, vp, SUBPIXEL),
    `[${ti.project.name} · ${vp.width}×${vp.height}] o anúncio saiu da tela`,
  ).toBe(true);

  // FICA TEMPO DE LER. Foram de 1,9s para 2,6s e, depois do segundo teste em aparelho, para
  // 3,3s de permanência + 0,42s de saída — cerca de 3,7s de presença. O teste cobra o piso novo:
  // ainda na tela depois de 3s. É proposital que ele meça o PISO e não o valor exato: o número
  // pode ser afinado de novo, o que não pode é encolher para menos do que se lê.
  await page.waitForTimeout(3000);
  await expect(page.locator(".um-selo"), "sumiu antes de dar para ler").toBeVisible();

  // E SAI SOZINHO. Nada de exigir toque.
  await expect(page.locator(".um")).toHaveCount(0, { timeout: 8000 });

  // E não sobra camada nenhuma sobre a Mesa: o leque volta a receber toque.
  const nada = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.86);
    return el?.closest(".um") !== null;
  });
  expect(nada, "o anúncio continua interceptando o toque depois de sair").toBe(false);

  // A mão 10 é a do motor, intocada.
  await expect(page.locator(`${SEL.hud} .ph`)).toContainText("Mão 10");
  await expect(page.locator(`${SEL.hud} .ph`)).toContainText("positiva");
});

test("não aparece duas vezes na mesma mão", async ({ page }, ti) => {
  test.skip(ti.project.name !== "667x375", "comportamento, não geometria");
  await mesaNaMao(page, 10);

  await expect(page.locator(".um")).toHaveCount(0, { timeout: 15_000 });

  // A Mesa redesenha muitas vezes por mão (bots, relógio, cartas). Nenhum desses redesenhos pode
  // reabrir o anúncio: a visibilidade é derivada de "mão 10 e ainda não dispensada".
  for (let i = 0; i < 6; i++) {
    const carta = page.locator(SEL.handCardLegal).first();
    if (await carta.count()) {
      await carta.click({ timeout: 4000 }).catch(() => {});
      if (await page.locator(SEL.handCardSelected).count()) {
        await carta.click({ timeout: 4000 }).catch(() => {});
      }
    }
    await page.waitForTimeout(400);
    expect(await page.locator(".um").count(), `reabriu no ciclo ${i}`).toBe(0);
  }
});

test("com MOVIMENTO REDUZIDO a informação continua inteira", async ({ page }, ti) => {
  test.skip(ti.project.name !== "667x375", "comportamento, não geometria");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mesaNaMao(page, 10);

  const selo = page.locator(".um-selo");
  await expect(selo).toBeVisible({ timeout: 15_000 });
  await expect(selo).toContainText("ÚLTIMA MÃO");
  // sem giro: a classe `calmo` troca a animação por fade + escala
  await expect(page.locator(".um.calmo")).toHaveCount(1);
  await expect(page.locator(".um")).toHaveCount(0, { timeout: 8000 });
});

/**
 * AUDITORIA DE SOBREPOSIÇÃO — o que o anúncio cobre, e o que isso custa.
 *
 * A pergunta foi feita assim: "existe sobreposição com placar, cartas, chat, timer, botões,
 * painel da mão, cards dos jogadores e card de trunfo?". A resposta honesta tem duas partes, e
 * este teste mede as duas em vez de responder "parece bom".
 *
 *   1. SIM, POR PROJETO. `.um` é `position:fixed; inset:0`: durante ~3,7s ele está por cima da
 *      Mesa inteira. É um anúncio, não um card — cobrir é o que ele faz.
 *   2. E ISSO NÃO CUSTA NADA, que é a parte que precisa ser provada: ele entra no INÍCIO da mão
 *      10, quando nenhuma decisão está pendente; não desloca nem redimensiona um único elemento
 *      da Mesa (o que ficaria depois dele); e sai sozinho sem deixar camada interceptando.
 *
 * O que seria defeito de verdade: o anúncio EMPURRAR a Mesa, deixando a tela diferente depois; ou
 * ficar preso por cima de algo que precisa de toque. As duas coisas são medidas aqui.
 */
const ELEMENTOS_DA_MESA = [
  [".hud", "painel da mão"],
  [".trumpslot", "card de trunfo"],
  [".youtag", "card do jogador local"],
  [".opp", "cards dos adversários"],
  [".hand .card", "cartas do leque"],
  [".topbtn", "botões do topo"],
] as const;

test("o anúncio cobre a Mesa por projeto, e não move nada", async ({ page }, ti) => {
  const vp = page.viewportSize()!;
  await mesaNaMao(page, 10);
  await expect(page.locator(".um-selo")).toBeVisible({ timeout: 15_000 });

  // ── DURANTE ──
  const selo = await boxOf(page.locator(".um-selo"), "um-selo");
  expect(insideViewport(selo as Box, vp, SUBPIXEL),
    `[${ti.project.name}] o selo do anúncio saiu da tela`).toBe(true);

  // NO PONTO DO SELO, QUEM RESPONDE É O ANÚNCIO — não a Mesa por baixo dele. A pergunta não é
  // "o elemento `.um-selo` é o topo": as faíscas são uma camada irmã e passam por cima do centro
  // enquanto duram, e isso é o efeito funcionando. A pergunta que importa é se o que está no topo
  // pertence ao anúncio; se pertencesse à Mesa, o anúncio estaria nascendo ATRÁS dela — que foi
  // exatamente o defeito do balão social, e é a família de erro que se quer travar aqui.
  const topo = await page.locator(".um-selo").evaluate((el) => {
    const b = el.getBoundingClientRect();
    const alvo = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return alvo?.closest(".um") ? "anuncio" : (alvo?.className ?? "nada");
  });
  expect(topo, "o anúncio está na tela mas coberto por uma camada da Mesa").toBe("anuncio");

  // E NENHUMA CAMADA DE DECISÃO ESTÁ ABERTA JUNTO COM ELE.
  // Esta é a sobreposição que a auditoria encontrou: a mão 10 nasce pedindo trunfo, e a faixa da
  // escolha (`z-index` 52, contra 28 do anúncio) passava por cima do selo. A ordem passou a ser a
  // outra — decisão primeiro, anúncio depois —, e é isso que se trava aqui.
  await expect(page.locator(".trumpov"), "o anúncio dividiu a tela com a escolha do trunfo")
    .toHaveCount(0);
  await expect(page.locator(".pickmsg"), "o anúncio dividiu a tela com o aviso do trunfo")
    .toHaveCount(0);

  const antes: Record<string, string> = {};
  for (const [sel, rotulo] of ELEMENTOS_DA_MESA) {
    const n = await page.locator(sel).count();
    if (n === 0) continue; // trunfo e relógio não existem em toda mão; medir o que existe
    antes[rotulo] = JSON.stringify(await page.locator(sel).first().boundingBox());
  }
  expect(Object.keys(antes).length, "nada da Mesa foi medido").toBeGreaterThan(2);

  const captura = process.env.KING_SHOTS;
  if (captura) {
    await page.screenshot({ path: `${captura}/ultima-mao-${ti.project.name}.png` });
  }

  // ── DEPOIS ──
  await expect(page.locator(".um")).toHaveCount(0, { timeout: 9000 });
  for (const [sel, rotulo] of ELEMENTOS_DA_MESA) {
    if (!(rotulo in antes)) continue;
    const depois = JSON.stringify(await page.locator(sel).first().boundingBox());
    expect(depois, `o anúncio deslocou "${rotulo}"`).toBe(antes[rotulo]);
  }

  // e nenhum ponto da Mesa continua respondendo por `.um`
  const presos = await page.evaluate(() => {
    const pontos: [number, number][] = [
      [window.innerWidth * 0.5, window.innerHeight * 0.86],
      [window.innerWidth * 0.12, window.innerHeight * 0.2],
      [window.innerWidth * 0.88, window.innerHeight * 0.5],
    ];
    return pontos.filter(([x, y]) => document.elementFromPoint(x, y)?.closest(".um")).length;
  });
  expect(presos, "sobrou camada do anúncio interceptando a Mesa").toBe(0);
});
