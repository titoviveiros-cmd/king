/**
 * "O REI FOI CAPTURADO!" no navegador de verdade (mão 5, semente 42: o motor faz alguém levar a
 * vaza com o K♥ — nada é injetado no DOM).
 *
 * O risco de uma cena no meio da partida não é ela ser feia: é ATRAPALHAR. Estes testes medem que
 * ela cabe na tela, diz quem pegou e quanto custou, fica tempo de ver (~5s), sai sozinha, que o
 * toque encurta sem avançar a partida, que a mesa assume depois (selo + aura) dentro da pausa do
 * King, e que ela não volta.
 *
 * ══ POR QUE OS TEMPOS SÃO MEDIDOS DENTRO DA PÁGINA ══
 *
 * O laço que joga até a captura passa a maior parte do tempo esperando cliques (até 4s cada). A
 * cena pode abrir no meio de uma dessas esperas, e o teste só a "vê" depois. Medir pelo relógio do
 * teste confundiria esse atraso com a duração da cena. Um `MutationObserver` instalado antes do
 * app anota, no relógio da própria página, quando cada coisa entrou e saiu — e é isso que se mede.
 */
import { test, expect, type Page } from "@playwright/test";
import { insideViewport } from "./helpers/geometry.js";
import { boxOf, SEL, iniciarPartidaLocal } from "./helpers/mesa.js";

interface Marcas {
  rcEm?: number; rcFim?: number; seloEm?: number; placarEm?: number;
  /** "Próxima mão" do Placar ficou habilitado. */ liberadoEm?: number;
  /** O Placar saiu da tela. */ placarFim?: number;
}

async function mesaNaMao5(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
    // O cronômetro da cena, no relógio da página (ver o cabeçalho).
    const marcas: Record<string, number> = {};
    (window as unknown as { __marcasRei: Record<string, number> }).__marcasRei = marcas;
    const marcar = () => {
      const t = performance.now();
      const rc = !!document.querySelector(".rc");
      if (rc && marcas.rcEm === undefined) marcas.rcEm = t;
      if (!rc && marcas.rcEm !== undefined && marcas.rcFim === undefined) marcas.rcFim = t;
      if (marcas.seloEm === undefined && document.querySelector(".castigo.king")) marcas.seloEm = t;
      const placar = !!document.querySelector(".placar");
      if (marcas.placarEm === undefined && placar) marcas.placarEm = t;
      if (!placar && marcas.placarEm !== undefined && marcas.placarFim === undefined) marcas.placarFim = t;
      const proxima = document.querySelector<HTMLButtonElement>(".pl-actions .btn.gold");
      if (placar && proxima && !proxima.disabled && marcas.liberadoEm === undefined) marcas.liberadoEm = t;
    };
    // `attributes` também: o botão do Placar libera trocando `disabled`, sem mexer na árvore.
    new MutationObserver(marcar).observe(document, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"],
    });
  });
  await page.goto("/?seed=42&mao=5");
  await iniciarPartidaLocal(page);
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
}

const marcas = (page: Page): Promise<Marcas> =>
  page.evaluate(() => ({ ...(window as unknown as { __marcasRei: Marcas }).__marcasRei }));

/**
 * Joga (a 1ª carta legal) até a cena abrir. `false` se a captura não aconteceu no orçamento.
 * O orçamento é de TEMPO, não de voltas: na semente 42 o K♥ cai na 7ª vaza, ~25s de bots e pausas.
 */
async function ateACena(page: Page): Promise<boolean> {
  const prazo = Date.now() + 75_000;
  while (Date.now() < prazo) {
    if (await page.locator(".rc").count()) return true;
    const carta = page.locator(SEL.handCardLegal).first();
    if (await carta.count()) {
      await carta.click({ timeout: 4000 }).catch(() => {});
      if (await page.locator(SEL.handCardSelected).count()) {
        await page.locator(SEL.handCardSelected).first().click({ timeout: 4000 }).catch(() => {});
      }
      continue;
    }
    await page.waitForTimeout(60);
  }
  return await page.locator(".rc").count() > 0;
}

test("a captura do K♥ abre a cena: inteira na tela, quem pegou e −160, ~5s, e depois a mesa assume", async ({ page }) => {
  test.setTimeout(120_000);
  await mesaNaMao5(page);
  test.skip(!(await ateACena(page)), "o K♥ não foi capturado dentro do orçamento");
  const vp = page.viewportSize()!;

  // A cena, num retrato só: nada da mesa anima junto com ela
  const retrato = await page.evaluate(() => ({
    titulo: document.querySelector(".rc-titulo")?.textContent,
    nome: document.querySelector(".rc-nome")?.textContent ?? "",
    pontos: document.querySelector(".rc-pontos")?.textContent,
    selo: document.querySelectorAll(".castigo").length,
    aura: document.querySelectorAll(".kcaptura").length,
  }));
  expect(retrato.titulo).toBe("O REI FOI CAPTURADO!");
  expect(retrato.nome).toMatch(/pegou o K♥$/);
  expect(retrato.pontos).toMatch(/^[-−]160$/);
  expect(retrato.selo, "o selo entrou junto com a cena").toBe(0);
  expect(retrato.aura, "a aura da mesa animou junto com a cena").toBe(0);
  const cena = await boxOf(page.locator(".rc-cena"), "cena do Rei");
  expect(insideViewport(cena, vp, 1), "a cena saiu da tela").toBe(true);
  // O VÉU COBRE A MESA INTEIRA e fica por cima dela: sem `position:fixed` a cena virava uma faixa
  // de 218px por baixo da vaza (defeito real, pego aqui — ver `cinematica.test.ts`).
  const veu = await page.evaluate(() => {
    const el = document.querySelector(".rc")!;
    const r = el.getBoundingClientRect();
    const centro = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return { pos: getComputedStyle(el).position, altura: r.height, largura: r.width, centroNaCena: !!centro?.closest(".rc") };
  });
  expect(veu.pos).toBe("fixed");
  expect(veu.altura).toBeGreaterThanOrEqual(vp.height - 1);
  expect(veu.largura).toBeGreaterThanOrEqual(vp.width - 1);
  expect(veu.centroNaCena, "o centro da tela não é da cena: algo da Mesa está por cima dela").toBe(true);

  // Sai sozinha, e a mesa assume com o selo e o MESMO jogador
  await expect(page.locator(".rc")).toHaveCount(0, { timeout: 8_000 });
  await expect(page.locator(".castigo.king")).toBeVisible();
  const quem = retrato.nome.replace(/ pegou o K♥$/, "");
  await expect(page.locator(".castigo")).toContainText(quem === "Você" ? "Você pegou" : `${quem} pegou`);
  await expect(page.locator(".trick .card.kcaptura")).toHaveCount(1);

  // O Placar só entra depois da pausa inteira do King
  await expect(page.locator(".placar")).toBeVisible({ timeout: 8_000 });
  const m = await marcas(page);
  expect(m.rcEm, "o cronômetro não viu a cena entrar").toBeDefined();
  const cenaMs = m.rcFim! - m.rcEm!;
  const ateOSelo = m.seloEm! - m.rcEm!;
  const ateOPlacar = m.placarEm! - m.rcEm!;
  const linha = `cena ${Math.round(cenaMs)}ms · selo em ${Math.round(ateOSelo)}ms · Placar em ${Math.round(ateOPlacar)}ms`;
  // FICA TEMPO DE VER: a cena passou de 2s para 5s. Mede-se o PISO (4,5s) e um teto com folga
  // para a máquina de CI, não o valor exato.
  expect(cenaMs, `a cena saiu cedo demais (${linha})`).toBeGreaterThanOrEqual(4_500);
  expect(cenaMs, `a cena demorou demais (${linha})`).toBeLessThanOrEqual(6_000);
  // EM SEQUÊNCIA: o selo só depois da cena; e o destaque (1,35s) cabe antes do Placar
  expect(ateOSelo, `o selo entrou por baixo da cena (${linha})`).toBeGreaterThanOrEqual(cenaMs - 50);
  expect(ateOPlacar - ateOSelo, `o destaque foi cortado pelo Placar (${linha})`).toBeGreaterThanOrEqual(1_300);
  // A PAUSA DO KING é ~6,5s: nem encurtada, nem virou espera
  expect(ateOPlacar, `o Placar entrou cedo (${linha})`).toBeGreaterThanOrEqual(6_300);
  expect(ateOPlacar, `o Placar demorou (${linha})`).toBeLessThanOrEqual(8_000);

  // E a cena não volta
  await expect(page.locator(".rc")).toHaveCount(0);
});

test("um toque encerra a cena sem avançar a partida, e nada fica interceptando a mesa", async ({ page }) => {
  test.setTimeout(120_000);
  await mesaNaMao5(page);
  test.skip(!(await ateACena(page)), "o K♥ não foi capturado dentro do orçamento");
  const vp = page.viewportSize()!;
  const vaza = await page.locator(".hud .vz").textContent();
  const naVaza = await page.locator(".trick .card").count();

  // O toque cai no CENTRO da tela — onde, por baixo da cena, está a vaza. Ele fecha a cena e
  // para nela: não seleciona, não joga, não abre nada da Mesa.
  await page.mouse.click(Math.round(vp.width / 2), Math.round(vp.height / 2));
  await expect(page.locator(".rc")).toHaveCount(0, { timeout: 1_500 });
  // a partida está onde estava: mesma vaza, as mesmas cartas nela, a pausa de leitura segue com
  // o selo, e o Placar não foi antecipado pelo toque
  await expect(page.locator(".hud .vz")).toHaveText(vaza ?? "");
  expect(await page.locator(".trick .card").count()).toBe(naVaza);
  await expect(page.locator(".castigo.king")).toBeVisible();
  expect(await page.locator(".placar").count(), "o toque antecipou o Placar").toBe(0);
  expect(await page.locator(".dm-scrim, .uv-scrim, .pf-scrim").count(), "o toque abriu algo da Mesa").toBe(0);
  const livre = await page.evaluate(() => !document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest(".rc"));
  expect(livre, "a cena saiu mas continua interceptando").toBe(true);
});

test("com MOVIMENTO REDUZIDO a cena diz tudo sem faíscas nem luz", async ({ page }) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mesaNaMao5(page);
  test.skip(!(await ateACena(page)), "o K♥ não foi capturado dentro do orçamento");
  await expect(page.locator(".rc.calmo")).toHaveCount(1);
  await expect(page.locator(".rc-faiscas")).toHaveCount(0);
  await expect(page.locator(".rc-luz")).toHaveCount(0);
  await expect(page.locator(".rc-titulo")).toHaveText("O REI FOI CAPTURADO!");
  await expect(page.locator(".rc-pontos")).toHaveText(/^[-−]160$/);
  await expect(page.locator(".rc")).toHaveCount(0, { timeout: 8_000 });
});

/**
 * O PLACAR DA MÃO DO REI FICA PARA SER LIDO (solo: quem segura é o cliente).
 *
 * Antes, "Próxima mão" respondia no instante em que o Placar entrava — e online o piso geral de 8s,
 * contado do fim da mão, deixava ~1,5s de Placar depois de 6,5s de cena. A meta é 4,6s REAIS de
 * Placar depois da cena. Aqui se tenta pular (clique forçado no botão e Enter) e se mede, no
 * relógio da página, quanto o Placar ficou.
 */
test("o Placar da mão do Rei fica ao menos 4,6s: confirmar cedo não avança, e depois avança normal", async ({ page }) => {
  test.setTimeout(150_000);
  await mesaNaMao5(page);
  test.skip(!(await ateACena(page)), "o K♥ não foi capturado dentro do orçamento");
  const vp = page.viewportSize()!;

  await expect(page.locator(".placar")).toBeVisible({ timeout: 10_000 });
  const proxima = page.locator(".pl-actions .btn.gold");
  await expect(proxima).toHaveText(/Próxima mão/);
  await expect(proxima, "o botão nasceu liberado na mão do Rei").toBeDisabled();

  // Tentativas de pular a leitura: nenhuma pode virar a mão.
  await proxima.click({ force: true });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  expect(await page.locator(".placar").count(), "uma confirmação cedo tirou o Placar da tela").toBe(1);
  await expect(proxima).toBeDisabled();

  // Libera sozinho, e o Placar estava lá o tempo todo.
  await expect(proxima).toBeEnabled({ timeout: 10_000 });
  const m = await marcas(page);
  expect(m.placarFim, "o Placar saiu antes de liberar").toBeUndefined();
  const leitura = m.liberadoEm! - m.placarEm!;
  const desdeACena = m.liberadoEm! - m.rcEm!;
  const linha = `Placar segurado ${Math.round(leitura)}ms · ${Math.round(desdeACena)}ms desde a cena`;
  expect(leitura, `leitura curta demais (${linha})`).toBeGreaterThanOrEqual(4_600);
  // e não virou espera
  expect(leitura, `leitura longa demais (${linha})`).toBeLessThanOrEqual(6_500);
  console.log(`[placar do Rei ${vp.width}x${vp.height}] ${linha}`);

  // Depois da leitura, tudo como sempre: o botão tem foco (Enter funciona) e a mão 6 começa.
  await expect(proxima).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".placar")).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator(".rc"), "a cena do Rei voltou na mão seguinte").toHaveCount(0);
  await expect(page.locator(SEL.hud)).toBeVisible();
});
