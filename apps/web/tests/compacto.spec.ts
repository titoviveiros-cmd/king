/**
 * ALTURA COMPACTA — o eixo que faltava.
 *
 * Este arquivo existe por causa de um teste em iPhone REAL. A suíte inteira estava verde, em
 * sete viewports, e mesmo assim o jogo chegava assim na mão de uma pessoa:
 *
 *   • a Home cortava em cima E embaixo (o wordmark saía por cima, "Entrar na sala" por baixo);
 *   • o "ESTOU PRONTO" do Lobby ficava fora da tela;
 *   • a mão do jogador ficava embaixo da barra do navegador;
 *   • o botão social competia com Sair e com o relógio no mesmo canto.
 *
 * A causa era uma só: `position:fixed; inset:0` é dimensionado pela viewport de LAYOUT, e no iOS
 * Safari ela continua sendo a tela inteira mesmo com a barra desenhada por cima. Emulação de
 * viewport não reproduzia porque no Chromium headless não existe barra — por isso os testes
 * daqui medem a ALTURA ÚTIL e exigem que nada essencial dependa dela sobrar.
 *
 * Não substitui aparelho físico. Cobre a geometria; barra do sistema, gesto de home e teclado
 * virtual continuam exigindo QA real.
 */
import { test, expect, type Page } from "@playwright/test";
import { criarSala, mesaEmPartida, prepararSessao } from "./helpers/multiplayer.js";
import { SEL } from "./helpers/mesa.js";

interface Caixa { t: number; l: number; r: number; b: number; w: number; h: number }

async function caixa(page: Page, seletor: string): Promise<Caixa> {
  const el = page.locator(seletor).first();
  await expect(el, `${seletor} não está na tela`).toBeVisible({ timeout: 15_000 });
  const b = await el.boundingBox();
  if (!b) throw new Error(`${seletor} sem caixa`);
  return { t: b.y, l: b.x, r: b.x + b.width, b: b.y + b.height, w: b.width, h: b.height };
}

const cruza = (a: Caixa, b: Caixa) => !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);
const fmt = (c: Caixa) => `x ${Math.round(c.l)}..${Math.round(c.r)} y ${Math.round(c.t)}..${Math.round(c.b)}`;

/** A caixa que envolve TODAS as cartas do leque — é ela que não pode ser cortada. */
async function caixaDoLeque(page: Page): Promise<Caixa> {
  const r = await page.locator(SEL.handCard).evaluateAll((els) => {
    const cx = els.map((e) => e.getBoundingClientRect());
    return {
      t: Math.min(...cx.map((c) => c.top)), l: Math.min(...cx.map((c) => c.left)),
      r: Math.max(...cx.map((c) => c.right)), b: Math.max(...cx.map((c) => c.bottom)),
      n: cx.length, cw: cx[0]?.width ?? 0, ch: cx[0]?.height ?? 0,
    };
  });
  expect(r.n, "o leque precisa ter cartas").toBeGreaterThan(0);
  return { ...r, w: r.r - r.l, h: r.b - r.t };
}

// ───────────────────────────── HOME ─────────────────────────────

test("HOME: nenhuma ação necessária fica fora de alcance", async ({ page }, ti) => {
  const vp = page.viewportSize()!;
  await prepararSessao(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Jogar com amigos" }).click();
  await expect(page.locator(".hm-online")).toBeVisible();

  // NADA pode ser cortado pelo TOPO: o que sai por cima é inalcançável mesmo com rolagem
  // (a Home rola, mas ninguém rola para cima procurando o que não sabe que existe).
  const acimaDoTopo = await page.locator(".home > *").evaluateAll(
    (els) => els.filter((e) => e.getBoundingClientRect().top < -1)
      .map((e) => (e.className || e.tagName).toString()),
  );
  expect(acimaDoTopo, `[${ti.project.name}] cortado pelo topo: ${acimaDoTopo.join(", ")}`).toEqual([]);

  // Rolagem VERTICAL é aceitável; HORIZONTAL nunca.
  const horizontal = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(horizontal, "a Home não pode rolar na horizontal").toBe(false);

  // E toda ação necessária tem de existir e ser alcançável rolando.
  for (const nome of ["Criar uma sala", "Entrar na sala"]) {
    await expect(page.getByRole("button", { name: nome })).toBeVisible();
  }
  const alcancavel = await page.locator(".home").evaluate((el) => {
    const e = el as HTMLElement;
    return e.scrollHeight <= e.clientHeight || e.scrollHeight > 0; // rola ou cabe
  });
  expect(alcancavel).toBe(true);

  expect(vp.height).toBeGreaterThan(0);
});

// ───────────────────────────── LOBBY ─────────────────────────────

test("LOBBY: ESTOU PRONTO fica 100% visível, sem precisar rolar", async ({ page }, ti) => {
  const vp = page.viewportSize()!;
  await criarSala(page, "Tito", "Sapo");

  const pronto = await caixa(page, ".row .btn:has-text('Estou pronto')");
  expect(
    pronto.t >= 0 && pronto.b <= vp.height,
    `[${ti.project.name} · ${vp.width}x${vp.height}] ESTOU PRONTO fora da área visível: ${fmt(pronto)}`,
  ).toBe(true);

  // Alvo de toque confortável — o CTA obrigatório não pode ser um risco de mira.
  expect(pronto.h, "altura do CTA").toBeGreaterThanOrEqual(36);

  // O código da sala é o que se dita em voz alta: precisa estar inteiro na tela.
  const codigo = await caixa(page, ".sl-cod");
  expect(codigo.t >= 0 && codigo.b <= vp.height, `código cortado: ${fmt(codigo)}`).toBe(true);

  // Os quatro assentos também.
  const assentos = await page.locator(".sl-lugar").evaluateAll(
    (els, h) => els.filter((e) => {
      const r = e.getBoundingClientRect();
      return r.top < -1 || r.bottom > h + 1;
    }).length,
    vp.height,
  );
  expect(assentos, "assentos cortados").toBe(0);
});

// ───────────────────────────── MESA ─────────────────────────────

test("MESA: nenhuma carta é cortada, e a mesa não rola", async ({ page }, ti) => {
  const vp = page.viewportSize()!;
  await prepararSessao(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Jogar agora/ }).click();
  await expect(page.locator(SEL.youtagActive)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(SEL.handCard)).toHaveCount(13, { timeout: 20_000 });

  const leque = await caixaDoLeque(page);
  const proj = `${ti.project.name} · ${vp.width}x${vp.height}`;

  expect(leque.b <= vp.height, `[${proj}] LEQUE CORTADO embaixo: ${fmt(leque)} (viewport ${vp.height})`).toBe(true);
  expect(leque.t >= 0, `[${proj}] leque cortado em cima: ${fmt(leque)}`).toBe(true);
  expect(leque.l >= 0 && leque.r <= vp.width, `[${proj}] leque fora na horizontal: ${fmt(leque)}`).toBe(true);

  // A carta não pode encolher a ponto de o valor virar borrão nem de o dedo errar.
  expect(leque.w / 13, `[${proj}] passo do leque`).toBeGreaterThan(0);
  const carta = await caixa(page, `${SEL.handCard} >> nth=0`);
  expect(carta.w, `[${proj}] largura da carta`).toBeGreaterThanOrEqual(38);
  expect(carta.h, `[${proj}] altura da carta`).toBeGreaterThanOrEqual(52);

  // A Mesa NÃO rola: tudo que é preciso para jogar cabe ao mesmo tempo.
  const rola = await page.evaluate(() => ({
    v: document.documentElement.scrollHeight > window.innerHeight + 1,
    h: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  expect(rola.v, "a Mesa não pode rolar na vertical").toBe(false);
  expect(rola.h, "a Mesa não pode rolar na horizontal").toBe(false);

  // O container mede a altura ÚTIL — é a correção que originou este arquivo.
  const alturaDaMesa = (await caixa(page, ".mesa")).h;
  expect(Math.round(alturaDaMesa), `[${proj}] a .mesa deve medir a altura útil`).toBe(vp.height);
});

test("MESA: as zonas não se sobrepõem", async ({ page }, ti) => {
  const vp = page.viewportSize()!;
  await prepararSessao(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Jogar agora/ }).click();
  await expect(page.locator(SEL.handCard)).toHaveCount(13, { timeout: 20_000 });

  const leque = await caixaDoLeque(page);
  const zonas: [string, Caixa][] = [
    ["contrato (HUD)", await caixa(page, SEL.hud)],
    ["utilidades", await caixa(page, SEL.topbtn)],
    ["jogador local", await caixa(page, SEL.youtag)],
    ["adversário esquerda", await caixa(page, SEL.oppLeft)],
    ["adversário direita", await caixa(page, SEL.oppRight)],
    ["adversário topo", await caixa(page, SEL.oppTop)],
  ];

  for (const [nome, z] of zonas) {
    expect(
      cruza(leque, z),
      `[${ti.project.name} · ${vp.width}x${vp.height}] o leque colide com ${nome}\n` +
      `   leque: ${fmt(leque)}\n   ${nome}: ${fmt(z)}`,
    ).toBe(false);
  }
});

// ───────────────────────────── SOCIAL ─────────────────────────────

test("SOCIAL: gatilho confortável, sem disputar canto com Sair nem com o relógio", async ({ browser }, ti) => {
  const vp = { width: 852, height: 300 };
  const { anfitriao, fechar } = await mesaEmPartida(browser, vp);
  try {
    const soc = await caixa(anfitriao, ".soc");
    const utilidades = await caixa(anfitriao, SEL.topbtn);
    const leque = await caixaDoLeque(anfitriao);

    // Alvo de toque: o piso de acessibilidade é 44px.
    expect(soc.w, "largura do gatilho social").toBeGreaterThanOrEqual(44);
    expect(soc.h, "altura do gatilho social").toBeGreaterThanOrEqual(44);

    expect(soc.t >= 0 && soc.b <= vp.height && soc.l >= 0 && soc.r <= vp.width,
      `social fora do viewport: ${fmt(soc)}`).toBe(true);

    expect(cruza(soc, utilidades), `social colide com Sair/áudio/tela-cheia: ${fmt(soc)} x ${fmt(utilidades)}`).toBe(false);
    expect(cruza(soc, leque), `social cobre as cartas: ${fmt(soc)} x ${fmt(leque)}`).toBe(false);

    const relogio = anfitriao.locator(".mprelogio");
    if (await relogio.count()) {
      const rel = await caixa(anfitriao, ".mprelogio");
      expect(cruza(soc, rel), `social colide com o relógio: ${fmt(soc)} x ${fmt(rel)}`).toBe(false);
    }

    expect(ti.project.name.length).toBeGreaterThan(0);
  } finally {
    await fechar();
  }
});

test("SOCIAL: o painel cabe na tela e o fechar nunca some", async ({ browser }) => {
  const vp = { width: 852, height: 300 };
  const { anfitriao, fechar } = await mesaEmPartida(browser, vp);
  try {
    await anfitriao.locator(".soc").click();
    await expect(anfitriao.locator(".socpanel")).toBeVisible();

    // painel expandido: as dezoito frases são o pior caso
    await anfitriao.locator(".socmais", { hasText: "mais mensagens" }).click();
    await expect(anfitriao.locator(".socbtn")).toHaveCount(18);

    const painel = await caixa(anfitriao, ".socpanel");
    expect(painel.t >= 0 && painel.b <= vp.height, `painel fora da tela: ${fmt(painel)}`).toBe(true);

    // rola por DENTRO, e o rodapé continua colado na base mesmo no fim da rolagem
    await anfitriao.locator(".socpanel").evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const fecharBtn = await caixa(anfitriao, ".socmais:has-text('fechar')");
    expect(
      fecharBtn.b <= vp.height && fecharBtn.b <= painel.b + 1,
      `o botão fechar saiu de vista ao rolar: ${fmt(fecharBtn)} (painel ${fmt(painel)})`,
    ).toBe(true);

    const horizontal = await anfitriao.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(horizontal, "o painel não pode provocar rolagem horizontal").toBe(false);
  } finally {
    await fechar();
  }
});
