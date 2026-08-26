/**
 * O QUE O TESTE MANUAL ENCONTROU — a suíte que impede a volta.
 *
 * Cada bloco aqui corresponde a um defeito visto por uma pessoa jogando, e não a uma hipótese: a
 * barra rosa que atravessava a mesa, os quatro cards abrindo o mesmo avatar, os bots com nomes de
 * uma fase antiga do projeto, e os dois textos do tutorial.
 */
import { test, expect, type Page } from "@playwright/test";
import { SEL, openMesaStress } from "./helpers/mesa.js";

/** Os quatro da mesa local. Espelha `MESA_LOCAL` de `src/game/adversarios.ts`. */
const MESA = ["Você", "Dama de Ferro", "Sr. Trunfo", "Fura-Vaza"];
/** Nomes de uma fase anterior do projeto: nenhum deles pode voltar à tela. */
const ANTIGOS = ["Bia", "Léo", "Nara"];
/** Os extremos de penalidade do KING, do menor ao maior em largura. */
const VALORES = ["−20", "−70", "−160", "−240"];

async function tutorial(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
    } catch { /* headless sem storage: segue */ }
  });
  await page.goto("/");
  await page.locator(".tut").waitFor({ timeout: 20_000 });
}

/**
 * Injeta cada valor extremo na linha de situação dos quatro cards e devolve os que vazam.
 *
 * A causa do defeito foi uma COLISÃO DE NOME DE CLASSE: o chip do delta chamava-se `dm`, a mesma
 * classe do painel "As 10 mãos", que declara `width:min(94vw,720px)`. O chip herdava a largura do
 * modal e virava uma barra rosa de 627px atravessando a mesa. Medir a caixa é o que pega isso.
 */
async function vazamentos(page: Page): Promise<unknown[]> {
  return page.evaluate((valores: string[]) => {
    const out: { valor: string; sel: string; chipW: number; cardW: number }[] = [];
    for (const valor of valores) {
      for (const sel of [".youtag", ".opp.left", ".opp.top", ".opp.right"]) {
        const card = document.querySelector(sel);
        const m = card?.querySelector(".m");
        if (!card || !m) continue;
        m.innerHTML = `<span class="ps">1º</span><span class="pt">${valor}</span>`
          + `<span class="mdelta neg">${valor}</span><span class="cc">🂠 12</span>`;
        const cb = card.getBoundingClientRect();
        const chip = card.querySelector(".mdelta")!.getBoundingClientRect();
        const mb = m.getBoundingClientRect();
        const limite = cb.x + cb.width + 1;
        if (chip.x + chip.width > limite || mb.x + mb.width > limite) {
          out.push({ valor, sel, chipW: Math.round(chip.width), cardW: Math.round(cb.width) });
        }
      }
    }
    return out;
  }, VALORES);
}

// ═══════════════ 1. A PONTUAÇÃO NEGATIVA NÃO ESCAPA DO CARD ═══════════════

test("partida individual: nenhuma pontuação negativa escapa do card", async ({ page }, ti) => {
  await openMesaStress(page);
  const ruins = await vazamentos(page);
  expect(ruins, `[${ti.project.name}] vazamentos: ${JSON.stringify(ruins)}`).toEqual([]);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflow, "a mesa ganhou rolagem horizontal").toBe(false);
});

test("tutorial: nenhuma pontuação negativa escapa do card", async ({ page }, ti) => {
  await tutorial(page);
  const ruins = await vazamentos(page);
  expect(ruins, `[${ti.project.name}] vazamentos no tutorial: ${JSON.stringify(ruins)}`).toEqual([]);
});

// ═══════════════ 2. OS BOTS SÃO OS ATUAIS ═══════════════

test("a partida individual usa os bots atuais, com avatar próprio", async ({ page }) => {
  await openMesaStress(page);

  const nomes = await page.locator(".opp .n").allTextContents();
  for (const antigo of ANTIGOS) {
    expect(nomes.join(" | "), `nome de fase antiga na mesa: ${antigo}`).not.toContain(antigo);
  }
  for (const n of nomes) expect(MESA).toContain(n.replace(/·.*/, "").trim());

  // Cada card tem um AVATAR, não a inicial do nome — e os quatro são diferentes.
  const glifos = (await page.locator(".youtag .av, .opp .av").allTextContents()).map((g) => g.trim());
  expect(glifos).toHaveLength(4);
  for (const g of glifos) expect(g, `inicial no lugar do avatar: ${g}`).not.toMatch(/^[A-Za-zÀ-ÿ]$/);
  expect(new Set(glifos).size, "dois assentos com o mesmo bicho").toBe(4);
});

test("o tutorial usa os mesmos bots da partida individual", async ({ page }) => {
  await tutorial(page);
  const nomes = await page.locator(".opp .n").allTextContents();
  for (const antigo of ANTIGOS) {
    expect(nomes.join(" | "), `nome de fase antiga no tutorial: ${antigo}`).not.toContain(antigo);
  }
  const glifos = (await page.locator(".youtag .av, .opp .av").allTextContents()).map((g) => g.trim());
  expect(new Set(glifos).size).toBe(4);
});

// ═══════════════ 3. CADA CARD ABRE O SEU DONO ═══════════════

test("os quatro cards abrem quatro perfis diferentes, e nenhum é o Leão por omissão", async ({ page }) => {
  await openMesaStress(page);

  const vistos: { nome: string; glifo: string }[] = [];
  for (const sel of [SEL.youtag, ".opp.left", ".opp.top", ".opp.right"]) {
    await page.locator(sel).click();
    await expect(page.locator(".pf")).toBeVisible();
    vistos.push({
      nome: (await page.locator(".pf-id b").textContent())?.replace(/você/i, "").trim() ?? "",
      glifo: (await page.locator(".pf-av").textContent())?.trim() ?? "",
    });
    await page.locator(".pf-x").click();
    await expect(page.locator(".pf")).toHaveCount(0);
  }

  expect(vistos).toHaveLength(4);
  expect(new Set(vistos.map((v) => v.nome)).size, `nomes repetidos: ${JSON.stringify(vistos)}`).toBe(4);
  expect(new Set(vistos.map((v) => v.glifo)).size, `avatares repetidos: ${JSON.stringify(vistos)}`).toBe(4);

  // O sintoma exato do bug era este: quatro perfis, quatro leões.
  const leoes = vistos.filter((v) => v.glifo === "🦁").length;
  expect(leoes, "mais de um Leão: o fallback generalizado voltou").toBeLessThanOrEqual(1);
});

// ═══════════════ 4. OS TEXTOS PEDIDOS ═══════════════

test("tutorial 5/16 e 10/16 dizem exatamente o texto aprovado", async ({ page }) => {
  await tutorial(page);

  const ateOPasso = async (alvo: string): Promise<string> => {
    for (let i = 0; i < 40; i++) {
      if ((await page.locator(".tut-passo").textContent())?.trim() === alvo) {
        return (await page.locator(".rei-fala").textContent())?.trim() ?? "";
      }
      const ok = page.locator(".tut-ok");
      const carta = page.locator(SEL.handCardLegal).first();
      if (await ok.count()) await ok.click();
      else if (await carta.count()) await carta.click();
      else break;
      await page.waitForTimeout(110);
    }
    throw new Error(`não chegou ao passo ${alvo}`);
  };

  expect(await ateOPasso("5/16")).toBe("Vence a maior carta do naipe que abriu a vaza.");
  expect(await page.locator(".rei-fala").textContent()).not.toContain("Sem trunfo,");

  expect(await ateOPasso("10/16")).toContain("Fuja do K de Copas");

  // A CARTA BAIXA, que é o que o passo ensina. A primeira do leque é a mais alta do naipe e
  // levaria a vaza com o Rei dentro — o Rei responderia com a fala de erro, que é outra frase.
  // Escolher pela menor carta é o que uma pessoa faria depois de ler a instrução.
  const ORDEM = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const legais = page.locator(SEL.handCardLegal);
  const rotulos = await legais.evaluateAll((es) => es.map((e) => e.getAttribute("aria-label") ?? ""));
  const menor = rotulos
    .map((r, i) => ({ i, v: ORDEM.indexOf(r.split(" de ")[0]) }))
    .sort((a, b) => a.v - b.v)[0];
  await legais.nth(menor.i).click();
  await page.waitForTimeout(220);

  expect((await page.locator(".rei-fala").textContent())?.trim())
    .toBe("Perfeito. Carta baixa, a vaza fica com outro, e o Rei de Copas é problema dele.");
});
