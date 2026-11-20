/**
 * O MINI-TORNEIO de ponta a ponta, no app real: Home → formato → participantes → chave → mesas de
 * bots → confronto → a SUA partida (Mesa solo de verdade) → classificação → avanço ou eliminação →
 * título, celebração e tela final; e a retomada depois de recarregar a página.
 *
 * Encurtado só pelo que já existia para QA: `?seed=` fixa a semente (o torneio inteiro se repete) e
 * `?mao=10` faz a SUA partida começar na última mão. As mesas de bots jogam as 10 mãos sempre. O
 * torneio fica marcado como "modo de teste" — e o teste confere o selo.
 *
 * A VITÓRIA É DETERMINÍSTICA SEM SER INVENTADA. O assento humano toca, pela interface, na carta que
 * o Bot Normal jogaria no lugar dele (piloto de teste, só no build de e2e). As sementes vêm de uma
 * busca offline com essa mesma regra e são conferidas pelo Vitest a cada execução
 * (`src/torneio/vitoriaDeterministica.test.ts`; sementes em `fixtures/torneioDeterministico.ts`).
 * Nenhum resultado, ranking ou regra do motor é tocado.
 *
 * Viewports: os quatro de paisagem de celular que a QA usa (incluindo o 800×360 do Android real) e
 * o desktop. O Android simulado (ponte do Capacitor) tem spec própria em `tests-nativo/`.
 */
import { test, expect, type Page } from "@playwright/test";
import { SEL } from "./helpers/mesa.js";
import {
  RELOGIO_DA_CELEBRACAO, celebracoes, conferirEncaminhamento, dentroDaTela, foto, jogarComPiloto, semGrafiaAntiga,
  semRolagemLateral, tocar, vigiarRede,
} from "./helpers/torneio.js";
import { MAO_DO_E2E, ROTULO_DO_AVATAR_DO_E2E, SEMENTES_DO_E2E } from "./fixtures/torneioDeterministico.js";

const VIEWPORTS_DO_FLUXO = new Set(["852x393", "844x390", "667x375", "800x360", "1600x900"]);
const ORIGEM = "http://localhost:4173";

test.beforeEach(async ({ page }, info) => {
  test.skip(!VIEWPORTS_DO_FLUXO.has(info.project.name), "fluxo longo: roda só nos viewports do torneio");
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial", JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  await page.addInitScript(RELOGIO_DA_CELEBRACAO);
});

/** Home → "Jogar mini-torneio" → avatar → escolha do formato. */
async function abrirMiniTorneio(page: Page): Promise<void> {
  await tocar(page, "Jogar mini-torneio");
  const seletor = page.locator(".hm-avdialogo");
  await expect(seletor).toBeVisible();
  await page.locator(`.hm-avdialogo .hm-av[aria-label="${ROTULO_DO_AVATAR_DO_E2E}"]`).click();
  await expect(page.getByRole("heading", { name: "Escolha o seu torneio" })).toBeVisible();
}

/** Escolha do formato → participantes → chave → mesas de bots → o primeiro confronto. */
async function ateOPrimeiroConfronto(page: Page, formato: RegExp, participantes: number): Promise<void> {
  await tocar(page, formato);
  await expect(page.locator(".tn-qa"), "torneio de QA precisa dizer que é teste").toBeVisible();
  await expect(page.locator(".tn-elenco li")).toHaveCount(participantes);
  await tocar(page, "Sortear as mesas");
  await tocar(page, "Jogar as outras mesas");
  await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 60_000 });
}

test("mini-torneio: seleção → partida → classificação → avanço/eliminação → retomada após reload", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/?seed=7&mao=10");

  // ── Home: três modalidades ──
  await expect(page.getByRole("button", { name: "▶ Jogar agora" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Jogar mini-torneio" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continuar mini-torneio/ })).toHaveCount(0);
  await semGrafiaAntiga(page, "Home");
  await abrirMiniTorneio(page);

  // ── formato ──
  await semRolagemLateral(page, "escolha do formato");
  await semGrafiaAntiga(page, "escolha do formato");
  await tocar(page, /Mini-torneio: 16 participantes/);
  await expect(page.locator(".tn-qa"), "torneio de QA precisa dizer que é teste").toBeVisible();

  // ── participantes ──
  await expect(page.locator(".tn-elenco li")).toHaveCount(16);
  await expect(page.locator(".tn-elenco .tn-eu")).toHaveCount(1);
  await semRolagemLateral(page, "apresentação");
  await tocar(page, "Sortear as mesas");

  // ── chave: 4 mesas iniciais, semifinais e final a definir ──
  await expect(page.getByRole("region", { name: "Chave do mini-torneio" })).toBeVisible();
  await expect(page.locator(".tn-mesa:not(.tn-mesa-vaga)")).toHaveCount(4);
  await expect(page.locator(".tn-mesa-vaga")).toHaveCount(3);
  await expect(page.locator(".tn-meu-caminho")).toHaveCount(1);
  await semRolagemLateral(page, "chave");
  await semGrafiaAntiga(page, "chave");
  await tocar(page, "Jogar as outras mesas");

  // ── confronto (as outras 3 mesas foram jogadas em fatias, sem travar) ──
  await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".tn-adversarios li")).toHaveCount(4);
  await semRolagemLateral(page, "confronto");

  // ── reload NO MEIO da partida: ela recomeça do zero, sem resultado nenhum ──
  await tocar(page, "▶ Jogar");
  await expect(page.locator(SEL.hud)).toBeVisible({ timeout: 20_000 });
  await page.reload();
  await tocar(page, /Continuar mini-torneio/);
  await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("status").filter({ hasText: "recomeça do início" })).toBeVisible();

  // ── a partida inteira (a mão 10, pelo QA) ──
  await tocar(page, "▶ Jogar");
  await jogarComPiloto(page);
  await expect(page.locator(".tn-tabela li")).toHaveCount(4);
  await expect(page.locator(".tn-tabela li.tn-passou")).toHaveCount(2);
  await expect(page.locator(".tn-tabela li.tn-eu")).toHaveCount(1);
  await semRolagemLateral(page, "classificação");
  await tocar(page, "Continuar");

  // ── avanço OU eliminação: o caminho depende da partida, as duas telas são verificadas ──
  const avancou = page.locator(".tn-avanco");
  const caiu = page.locator(".tn-eliminado");
  await expect(avancou.or(caiu)).toBeVisible({ timeout: 20_000 });
  await semRolagemLateral(page, "avanço/eliminação");

  if (await avancou.count()) {
    await expect(page.getByRole("list", { name: "O seu caminho" })).toBeVisible();
    await tocar(page, "Continuar");
    await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".tn-fase-rotulo")).toContainText(/Semifinal/);
    // ── retomada: o checkpoint guarda a fase nova e o resultado confirmado ──
    await page.reload();
    await tocar(page, /Continuar mini-torneio/);
    await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".tn-fase-rotulo")).toContainText(/Semifinal/);
    await tocar(page, "Ver a chave");
    await expect(page.locator(".tn-mesa:not(.tn-mesa-vaga)")).toHaveCount(6);
    // a mesa da primeira fase continua com UM resultado só (nada duplicado pelo reload)
    await expect(page.locator(".tn-meu-caminho")).toHaveCount(2);
  } else {
    await expect(page.getByRole("status")).toContainText(/Terminou em [34]º/);
    // retomada no estado de eliminado
    await page.reload();
    await tocar(page, /Continuar mini-torneio/);
    await expect(page.locator(".tn-eliminado")).toBeVisible({ timeout: 20_000 });
    await tocar(page, "Ver quem será o campeão");
    await expect(page.locator(".tn-fim")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /Campeão:/ })).toBeVisible();
    await semRolagemLateral(page, "fim");
    // torneio encerrado não se oferece para continuar
    await tocar(page, "Home");
    await expect(page.getByRole("button", { name: /Continuar mini-torneio/ })).toHaveCount(0);
  }
});

test("VITÓRIA no mini-torneio (16): chave até a final, retomada no meio, celebração de ~8 s, tela final, sem rede", async ({ page }, info) => {
  test.setTimeout(420_000);
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(e.message));
  const rede = vigiarRede(page, ORIGEM);
  await page.goto(`/?seed=${SEMENTES_DO_E2E.mini16.vitoria}&mao=${MAO_DO_E2E}`);
  rede.ligar();
  await abrirMiniTorneio(page);
  await ateOPrimeiroConfronto(page, /Mini-torneio: 16 participantes/, 16);

  const fases = ["Mesas iniciais", "Semifinal", "Final"];
  for (let f = 0; f < fases.length; f++) {
    const final = f === fases.length - 1;
    await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 60_000 });
    if (final) await expect(page.getByRole("heading", { name: "GRANDE FINAL" })).toBeVisible();
    else await expect(page.locator(".tn-fase-rotulo")).toContainText(fases[f]);
    await foto(page, info, `16-confronto-${f}`);

    if (f === 1) {
      // RETOMADA: recarregar entre as fases não perde nem repete nada
      await page.reload();
      await tocar(page, "↩ Continuar mini-torneio");
      await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".tn-fase-rotulo")).toContainText("Semifinal");
    }

    await tocar(page, "▶ Jogar");
    await jogarComPiloto(page);
    await expect(page.locator(".tn-tabela li.tn-eu.tn-passou")).toHaveCount(1);
    await expect(page.getByRole("status").first())
      .toHaveText(final ? "Você venceu a final!" : /Você terminou em [12]º e avança\./);
    await semGrafiaAntiga(page, `classificação ${f}`);
    await foto(page, info, `16-classificacao-${f}`);
    await tocar(page, "Continuar");
    if (!final) {
      await expect(page.locator(".tn-avanco")).toBeVisible({ timeout: 20_000 });
      await tocar(page, "Continuar");
    }
  }

  // ── CELEBRAÇÃO: coroa, bicho, nome, partículas douradas, título e frase — sem tocar em nada ──
  const celebra = page.getByRole("dialog", { name: "Campeão do mini-torneio!" });
  await expect(celebra).toBeVisible({ timeout: 20_000 });
  await expect(celebra.locator(".tn-celebra-titulo")).toHaveText("Campeão do mini-torneio!");
  await expect(celebra.locator(".tn-celebra-frase")).toHaveText("Você venceu o mini-torneio!");
  await expect(celebra.locator(".tn-coroa")).toBeVisible();
  await expect(celebra.locator(".tn-campeao-av")).toHaveText("🐸");
  await expect(celebra.locator(".tn-celebra-nome")).toContainText("Você");
  await expect(celebra.locator(".tn-particulas i")).toHaveCount(36);
  await expect(page.locator(".tn-celebra.tn-quieto")).toHaveCount(0);
  await page.waitForTimeout(1500); // as entradas animadas assentam
  await dentroDaTela(page, celebra.locator(".tn-celebra-centro"), "centro da celebração");
  const titulo = celebra.locator(".tn-celebra-titulo");
  expect(await titulo.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), "título da celebração cortado").toBe(true);
  await semGrafiaAntiga(page, "celebração");
  await foto(page, info, "16-celebracao");

  // sai SOZINHA em ~8 s e fica a tela estática
  await expect(celebra).toHaveCount(0, { timeout: 12_000 });
  const vezes = await celebracoes(page);
  expect(vezes, "a celebração acontece UMA vez").toHaveLength(1);
  const duracao = vezes[0].fim! - vezes[0].inicio;
  expect(duracao, `duração da celebração: ${Math.round(duracao)} ms`).toBeGreaterThanOrEqual(7800);
  expect(duracao).toBeLessThanOrEqual(9000);

  const fim = page.locator(".tn-fim.tn-fim-venci");
  await expect(fim).toBeVisible();
  await expect(fim.getByRole("heading", { level: 1 })).toHaveText("Campeão do mini-torneio!");
  await expect(fim.locator(".tn-vitoria")).toHaveText("Você venceu o mini-torneio!");
  await page.waitForTimeout(1500);
  await expect(fim, "a tela final é estática: continua lá").toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await celebracoes(page), "nenhuma segunda celebração").toHaveLength(1);
  for (const nome of ["Começar outro mini-torneio", "Ver a chave", "Home"]) {
    const b = page.getByRole("button", { name: nome });
    await b.scrollIntoViewIfNeeded();
    await dentroDaTela(page, b, `botão ${nome}`);
  }
  await semRolagemLateral(page, "tela final");
  await semGrafiaAntiga(page, "tela final");
  await foto(page, info, "16-fim");

  // ── a chave final: encaminhamento certo e o título UMA vez ──
  await tocar(page, "Ver a chave");
  await expect(page.getByRole("region", { name: "Chave do mini-torneio" })).toBeVisible();
  await conferirEncaminhamento(page, 3);
  await expect(page.locator(".tn-meu-caminho")).toHaveCount(3);
  await expect(page.locator('.tn-selo[aria-label="campeão"]')).toHaveCount(1);
  await expect(page.locator(".tn-col").last().locator("li.tn-eu.tn-passou")).toHaveCount(1);
  await foto(page, info, "16-chave-final");
  await tocar(page, "Ver o resultado");
  await expect(fim).toBeVisible();

  // ── nada salvo para continuar; nenhuma rede durante o torneio inteiro (sem XP online) ──
  expect(await page.evaluate(() => localStorage.getItem("king:torneio"))).toBeNull();
  rede.desligar();
  expect(rede.externas, "requisição para fora do app durante o mini-torneio").toEqual([]);
  expect(rede.sockets, "WebSocket aberto durante o mini-torneio").toEqual([]);

  // ── de volta à Home, e um mini-torneio novo começa limpo ──
  await tocar(page, "Home");
  await expect(page.getByRole("button", { name: /Continuar mini-torneio/ })).toHaveCount(0);
  await abrirMiniTorneio(page);
  await expect(page.locator(".tn-formato")).toHaveCount(2);
  expect(erros, "erro de página").toEqual([]);
});

test.describe("com movimento reduzido", () => {
  test("VITÓRIA na Copa Completa (32): quatro fases, celebração parada e dispensável, outro mini-torneio", async ({ page }, info) => {
    test.setTimeout(480_000);
    const erros: string[] = [];
    page.on("pageerror", (e) => erros.push(e.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    const rede = vigiarRede(page, ORIGEM);
    await page.goto(`/?seed=${SEMENTES_DO_E2E.copa32.vitoria}&mao=${MAO_DO_E2E}`);
    rede.ligar();
    await abrirMiniTorneio(page);
    await ateOPrimeiroConfronto(page, /Copa Completa: 32 participantes/, 32);

    const fases = ["Mesas iniciais", "Quartas de final", "Semifinal", "Final"];
    for (let f = 0; f < fases.length; f++) {
      const final = f === fases.length - 1;
      await expect(page.locator(".tn-confronto")).toBeVisible({ timeout: 60_000 });
      if (final) await expect(page.getByRole("heading", { name: "GRANDE FINAL" })).toBeVisible();
      else await expect(page.locator(".tn-fase-rotulo")).toContainText(fases[f]);
      await tocar(page, "▶ Jogar");
      await jogarComPiloto(page);
      await expect(page.locator(".tn-tabela li.tn-eu.tn-passou")).toHaveCount(1);
      await tocar(page, "Continuar");
      if (!final) {
        await expect(page.locator(".tn-avanco")).toBeVisible({ timeout: 20_000 });
        await tocar(page, "Continuar");
      }
    }

    // ── celebração com movimento reduzido: a notícia inteira, nada caindo nem girando ──
    const celebra = page.getByRole("dialog", { name: "Campeão da Copa!" });
    await expect(celebra).toBeVisible({ timeout: 20_000 });
    await expect(celebra.locator(".tn-celebra-frase")).toHaveText("Você venceu a Copa Completa!");
    await expect(celebra.locator(".tn-coroa")).toBeVisible();
    await expect(celebra.locator(".tn-campeao-av")).toHaveText("🐸");
    await expect(page.locator(".tn-celebra.tn-quieto")).toHaveCount(1);
    await expect(celebra.locator(".tn-particulas i")).toHaveCount(0);
    expect(await celebra.locator(".tn-coroa").evaluate((e) => getComputedStyle(e).animationName)).toBe("none");
    await dentroDaTela(page, celebra.locator(".tn-celebra-centro"), "centro da celebração");
    await semGrafiaAntiga(page, "celebração da Copa");
    await foto(page, info, "32-celebracao-reduzida");

    // ── DISPENSAR: um toque encerra na hora, e fica a tela estática ──
    await page.waitForTimeout(800);
    await celebra.click();
    await expect(celebra).toHaveCount(0);
    const vezes = await celebracoes(page);
    expect(vezes).toHaveLength(1);
    expect(vezes[0].fim! - vezes[0].inicio, "o toque encerra antes dos 8 s").toBeLessThan(4000);
    const fim = page.locator(".tn-fim.tn-fim-venci");
    await expect(fim.getByRole("heading", { level: 1 })).toHaveText("Campeão da Copa!");
    await page.waitForTimeout(9000); // passou do prazo da celebração: nada volta, nada se repete
    await expect(fim).toBeVisible();
    expect(await celebracoes(page)).toHaveLength(1);
    await foto(page, info, "32-fim");

    await tocar(page, "Ver a chave");
    await expect(page.getByRole("region", { name: "Chave da Copa Completa" })).toBeVisible();
    await conferirEncaminhamento(page, 4);
    await expect(page.locator(".tn-meu-caminho")).toHaveCount(4);
    await expect(page.locator('.tn-selo[aria-label="campeão"]')).toHaveCount(1);
    await semRolagemLateral(page, "chave da Copa");
    await foto(page, info, "32-chave-final");
    await tocar(page, "Ver o resultado");

    rede.desligar();
    expect(rede.externas, "requisição para fora do app durante o mini-torneio").toEqual([]);
    expect(rede.sockets, "WebSocket aberto durante o mini-torneio").toEqual([]);

    // ── "Começar outro mini-torneio": a escolha do formato, sem nada salvo ──
    await tocar(page, "Começar outro mini-torneio");
    await expect(page.getByRole("heading", { name: "Escolha o seu torneio" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("king:torneio"))).toBeNull();
    expect(erros, "erro de página").toEqual([]);
  });
});

test("ELIMINAÇÃO nas mesas iniciais: retomada no estado de eliminado, novo mini-torneio e volta à Home", async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto(`/?seed=${SEMENTES_DO_E2E.mini16.eliminacao}&mao=${MAO_DO_E2E}`);
  await abrirMiniTorneio(page);
  await ateOPrimeiroConfronto(page, /Mini-torneio: 16 participantes/, 16);
  await tocar(page, "▶ Jogar");
  await jogarComPiloto(page);
  await expect(page.locator(".tn-tabela li.tn-eu.tn-caiu")).toHaveCount(1);
  await tocar(page, "Continuar");

  await expect(page.locator(".tn-eliminado")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Você caiu nas Mesas iniciais");
  await semGrafiaAntiga(page, "eliminação");
  await foto(page, info, "16-eliminado");

  await page.reload();
  await tocar(page, "↩ Continuar mini-torneio");
  await expect(page.locator(".tn-eliminado")).toBeVisible({ timeout: 20_000 });

  // ── "Novo mini-torneio": o salvo sai e a escolha volta limpa ──
  await tocar(page, "Novo mini-torneio");
  await expect(page.getByRole("heading", { name: "Escolha o seu torneio" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("king:torneio"))).toBeNull();
  await tocar(page, "← Início");
  await expect(page.getByRole("button", { name: "Jogar mini-torneio" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continuar mini-torneio/ })).toHaveCount(0);
  await abrirMiniTorneio(page);
  await expect(page.locator(".tn-formato")).toHaveCount(2);
});

test.describe("checkpoint inválido: descartado com segurança, e o mini-torneio começa limpo", () => {
  const CASOS: Record<string, string> = {
    "JSON quebrado": "{\"v\":1,\"formato\":",
    "versão desconhecida": JSON.stringify({ v: 99, formato: "mini16", semente: 1, avatar: "leao", qa: false, maoInicial: 1, resultados: {}, emPartida: null }),
    "resultado adulterado": JSON.stringify({ v: 1, formato: "mini16", semente: 1, avatar: "leao", qa: false, maoInicial: 1, resultados: { f0m0: { pontos: [999, 0, 0, 0], negativas: [0, 0, 0, 0], ilesas: [0, 0, 0, 0] } }, emPartida: null }),
    "formato inexistente": JSON.stringify({ v: 1, formato: "copa64", semente: 1, avatar: "leao", qa: false, maoInicial: 1, resultados: {}, emPartida: null }),
  };
  for (const [nome, salvo] of Object.entries(CASOS)) {
    test(nome, async ({ page }) => {
      const erros: string[] = [];
      page.on("pageerror", (e) => erros.push(e.message));
      // Só na PRIMEIRA carga: o save inválido é o que estava no aparelho antes de abrir o app.
      await page.addInitScript((v) => {
        try { if (!sessionStorage.getItem("semeado")) { localStorage.setItem("king:torneio", v); sessionStorage.setItem("semeado", "1"); } } catch { /* */ }
      }, salvo);
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Jogar mini-torneio" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Continuar mini-torneio/ })).toHaveCount(0);
      await abrirMiniTorneio(page);
      await expect(page.locator(".tn-formato")).toHaveCount(2);
      await expect(page.locator(".tn-aviso")).toHaveCount(0);
      // o novo mini-torneio substitui o salvo inválido por um íntegro, que a Home oferece retomar
      await tocar(page, /Mini-torneio: 16 participantes/);
      await expect(page.locator(".tn-elenco li")).toHaveCount(16);
      const salvoAgora = await page.evaluate(() => JSON.parse(localStorage.getItem("king:torneio") ?? "null"));
      expect(salvoAgora).toMatchObject({ v: 1, formato: "mini16" });
      await page.reload();
      await expect(page.getByRole("button", { name: "↩ Continuar mini-torneio" })).toBeVisible();
      expect(erros, "erro de página").toEqual([]);
    });
  }
});
