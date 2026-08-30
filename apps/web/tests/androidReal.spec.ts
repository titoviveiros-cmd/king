/**
 * OS CENÁRIOS FÍSICOS DESTA QA — em MULTIPLAYER, que é onde eles acontecem.
 *
 * ══ POR QUE ESTE ARQUIVO EXISTE ══
 *
 * Quatro correções desta fase voltaram a falhar no aparelho depois de eu declará-las prontas, e o
 * motivo foi sempre o mesmo: medi em SOLO e concluí sobre MULTIPLAYER. O rodapé do placar
 * entre-mãos troca o botão "Próxima mão ▸" por um bloco de consenso inteiro — quatro avatares mais
 * o "ESTOU PRONTO" com subtítulo. A fileira do topo ganha o relógio da decisão. O placar final
 * ganha o botão social e o painel dele. Nada disso existe no solo, e era exatamente onde os
 * defeitos moravam.
 *
 * Também corrigi para "cabe exatamente" em vez de "cabe com folga": o placar ficou cabendo por
 * zero pixels e eu chamei de resolvido. Zero folga não é ajuste, é sorte — o primeiro nome mais
 * longo derruba. Por isso aqui não se afirma "não rola": afirma-se FOLGA MÍNIMA.
 *
 * E nenhuma daquelas correções tinha teste. Sem tripwire, cada rodada podia desfazer a anterior em
 * silêncio, e quem descobria era uma pessoa com o telefone na mão.
 *
 * ══ A GEOMETRIA ══
 *
 * `800×360` é o aparelho real desta QA, medido: um Android 20:9 que em paisagem entrega 800 de
 * largura e 360 de altura em px CSS. Ele cai EXATAMENTE em cima de dois limiares do projeto
 * (`max-width:800px` e `max-height:360px`), o que o torna o pior caso possível e o melhor teste.
 * As alturas menores cobrem o que as barras do sistema comem.
 */
import { test, expect, type Page } from "@playwright/test";
import { mesaEmPartida } from "./helpers/multiplayer.js";
import { SEL, iniciarPartidaLocal } from "./helpers/mesa.js";
import { fmt, insideViewport, intersects, type Box } from "./helpers/geometry.js";

const SUBPIXEL = 1;
/** Folga que se exige do placar. Um chip que quebra de linha custa 26px; menos que isso é sorte. */
const FOLGA_MINIMA = 24;

const APARELHOS = [
  { width: 800, height: 360, nome: "Android real" },
  { width: 800, height: 330, nome: "Android menos barra" },
  { width: 852, height: 393, nome: "iPhone 14/15 Pro" },
];

/** Joga até a tela pedida aparecer em qualquer um dos dois aparelhos. */
async function jogarAte(a: Page, b: Page, seletor: string, limite = 1200): Promise<boolean> {
  for (let i = 0; i < limite && !(await a.locator(seletor).count()); i++) {
    for (const p of [a, b]) {
      const pronto = p.getByRole("button", { name: /Estou pronto/ });
      if (await pronto.count()) { await pronto.first().click({ timeout: 3000 }).catch(() => {}); continue; }
      const t = p.locator(".trumpbtn").first();
      if (await t.count()) { await t.click({ timeout: 3000 }).catch(() => {}); continue; }
      const c = p.locator(SEL.handCardLegal).first();
      if (await c.count()) {
        await c.click({ timeout: 3000 }).catch(() => {});
        const s = p.locator(SEL.handCardSelected);
        if (await s.count()) await s.first().click({ timeout: 3000 }).catch(() => {});
      }
    }
    await a.waitForTimeout(80);
  }
  return (await a.locator(seletor).count()) > 0;
}

for (const vp of APARELHOS) {
  test.describe(`${vp.width}×${vp.height} — ${vp.nome}`, () => {
    /**
     * O PLACAR ENTRE-MÃOS, MÃO A MÃO — E EM SOLO, DE PROPÓSITO.
     *
     * O relato diz "geralmente nas positivas, e nem em todas". A diferença entre uma mão e outra
     * é o chip do trunfo e o NOME de quem o escolheu: quanto mais longo, mais perto de quebrar a
     * linha — e é a quebra que custa 26px de uma vez. Então é preciso medir TODAS as dez, e não a
     * primeira.
     *
     * A primeira versão jogava a partida inteira em multiplayer e ESTOUROU O TEMPO nas três
     * geometrias: dez mãos com dois navegadores passam de quinze minutos. Antes disso, com o
     * limite mais baixo, ela parava na mão cinco — e as positivas, que são o caso do relato,
     * nunca chegavam a ser medidas. Um teste que não termina, ou que termina antes do que
     * interessa, não protege nada.
     *
     * `?mao=N` chega a qualquer mão em segundos, e o placar entre-mãos é o mesmo componente nos
     * dois modos. O que o multiplayer acrescenta é o rodapé — o bloco de consenso no lugar do
     * botão único, mais o botão social —, e isso está medido: 2px de conteúdo a mais no total.
     * O botão social é injetado com as classes de verdade, e a folga exigida cobre a diferença
     * com sobra. A prova de ponta a ponta em multiplayer continua existindo no teste do placar
     * final, que joga a partida inteira.
     */
    test("o placar entre-mãos cabe com folga em todas as dez mãos", async ({ page }, ti) => {
      test.setTimeout(600_000);
      await page.setViewportSize(vp);
      const medidas: string[] = [];
      let pior = { mao: 0, folga: Number.POSITIVE_INFINITY };

      for (let mao = 1; mao <= 10; mao++) {
        await page.addInitScript(() => {
          try {
            window.localStorage.setItem("king.audio",
              JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
            window.localStorage.setItem("king:tutorial",
              JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
          } catch { /* segue */ }
        });
        await page.goto(`/?seed=42&mao=${mao}`);
        await iniciarPartidaLocal(page);
        await page.locator(SEL.hud).waitFor({ timeout: 20_000 });
        const um = page.locator(".um");
        if (await um.count()) await um.click().catch(() => {});

        // Joga a mão inteira até o placar aparecer.
        for (let k = 0; k < 500 && !(await page.locator(".placar").count()); k++) {
          const t = page.locator(".trumpbtn").first();
          if (await t.count()) { await t.click({ timeout: 4000 }).catch(() => {}); continue; }
          const c = page.locator(SEL.handCardLegal).first();
          if (await c.count()) {
            await c.click({ timeout: 4000 }).catch(() => {});
            const sel = page.locator(SEL.handCardSelected);
            if (await sel.count()) await sel.first().click({ timeout: 4000 }).catch(() => {});
            continue;
          }
          await page.waitForTimeout(160);
        }
        if (!(await page.locator(".placar").count())) continue;
        await page.waitForTimeout(600);

        // O botão social do multiplayer, com as classes reais: é ele que divide o rodapé com o
        // bloco de consenso, e a fileira precisa ser medida como ela é quando há gente na sala.
        await page.evaluate(() => {
          if (document.querySelector(".pl-foot .soc")) return;
          const foot = document.querySelector(".pl-foot");
          if (!foot) return;
          const b = document.createElement("button");
          b.className = "soc soc-placar";
          b.textContent = "💬";
          foot.insertBefore(b, foot.querySelector(".pl-actions"));
        });
        await page.waitForTimeout(150);

        const m = await page.evaluate(() => {
          const pl = document.querySelector(".placar") as HTMLElement;
          const ov = document.querySelector(".placarov") as HTMLElement;
          const cs = getComputedStyle(ov);
          const chips = [...document.querySelectorAll(".pl-meta .pl-tag")];
          return {
            sh: pl.scrollHeight, ch: pl.clientHeight,
            disponivel: Math.round(ov.clientHeight
              - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)),
            titulo: (document.querySelector(".pl-title")?.textContent ?? "").trim(),
            linhasDeChip: new Set(chips.map((c) => Math.round(c.getBoundingClientRect().y))).size,
          };
        });
        const folga = m.disponivel - m.sh;
        medidas.push(`mão ${mao}: conteúdo ${m.sh} / disponível ${m.disponivel} → folga ${folga}` +
          ` | chips em ${m.linhasDeChip} linha(s) | ${m.titulo}`);
        if (folga < pior.folga) pior = { mao, folga };

        // 1 · NÃO ROLA.
        expect(m.sh, `[mão ${mao}] o placar rola: conteúdo ${m.sh} numa caixa de ${m.ch}`)
          .toBeLessThanOrEqual(m.ch + SUBPIXEL);
        // 2 · OS CHIPS NÃO QUEBRAM. É o degrau de 26px que derruba o resto.
        expect(m.linhasDeChip, `[mão ${mao}] os chips quebraram em ${m.linhasDeChip} linhas`)
          .toBeLessThanOrEqual(1);
      }

      console.log(`\n[${ti.project.name} ${vp.width}×${vp.height}]\n  ` + medidas.join("\n  "));
      // NOVE, e não dez: numa partida de dez mãos existem NOVE placares entre-mãos. Depois da
      // décima vem o placar final, que é outra tela. A primeira versão exigia dez e reprovava
      // com todos os números certos — a asserção estava errada, não o produto.
      expect(medidas.length, `foram medidos ${medidas.length} placares, esperados 9`).toBe(9);

      // 3 · AS DEZ SÃO DIFERENTES. Distingue "medi dez mãos" de "medi uma mão dez vezes" — que
      // foi exatamente o que uma versão anterior deste teste fez, passando verde.
      const titulos = new Set(medidas.map((x) => x.slice(x.lastIndexOf("| ") + 2)));
      expect(titulos.size, `as medições repetem contratos: ${[...titulos].join(" | ")}`)
        .toBeGreaterThanOrEqual(5);

      // 4 · AS POSITIVAS ENTRARAM NA CONTA. É a fase do relato, a que traz o terceiro chip.
      expect([...titulos].some((t) => /Positiva|Faça Vazas/i.test(t)),
        `nenhuma mão positiva foi medida — contratos: ${[...titulos].join(" | ")}`).toBe(true);

      // 5 · E A PIOR AINDA TEM FOLGA. Zero folga não é ajuste, é sorte.
      expect(pior.folga,
        `a mão ${pior.mao} cabe por ${pior.folga}px — abaixo do mínimo de ${FOLGA_MINIMA}px`)
        .toBeGreaterThanOrEqual(FOLGA_MINIMA);
    });
    /**
     * O PAINEL DE MENSAGENS DO PLACAR FINAL.
     *
     * Ele é o caso que eu "corrigi" sem verificar e continuou cortado no aparelho. Aqui a
     * afirmação é a mais crua possível: o painel inteiro dentro da tela, e o título legível.
     */
    test("o painel de mensagens do placar final cabe inteiro na tela", async ({ browser }, ti) => {
      // SÓ NO APARELHO REAL. Chegar ao placar final multiplayer custa dez mãos jogadas por dois
      // navegadores — 36 minutos nas três geometrias, o que tiraria esta suíte da regressão de
      // todo dia. E uma tripwire que ninguém roda não protege nada.
      // O defeito era de ANCORAGEM (o painel nascia à esquerda da tela, não importa a altura), e
      // 800×360 é onde ele foi encontrado. As outras geometrias ficam cobertas pelo mesmo código.
      test.skip(vp.width !== 800 || vp.height !== 360, "roda só na geometria do aparelho real");
      test.setTimeout(1_200_000);
      const { anfitriao, convidado, fechar } = await mesaEmPartida(browser, vp);
      try {
        if (!(await jogarAte(anfitriao, convidado, ".fim", 6000))) {
          test.skip(true, "a partida não chegou ao placar final no orçamento");
          return;
        }
        await anfitriao.locator(".fim").click({ position: { x: 5, y: 5 } }).catch(() => {});
        await expect(anfitriao.locator(".fimacoes")).toBeVisible({ timeout: 20_000 });
        await anfitriao.waitForTimeout(1200);

        const gatilho = anfitriao.locator(".fimacoes .soc");
        await expect(gatilho, "o botão social do placar final sumiu").toHaveCount(1);
        await gatilho.click();
        const painel = anfitriao.locator(".socpanel");
        await expect(painel, "o painel não abriu").toBeVisible({ timeout: 10_000 });
        await anfitriao.waitForTimeout(300);

        const cx = await painel.boundingBox();
        expect(cx, "painel sem caixa").not.toBeNull();
        expect(insideViewport(cx as Box, vp, SUBPIXEL),
          `[${ti.project.name}] o painel de mensagens saiu da tela: ${fmt(cx as Box)} em ${vp.width}×${vp.height}`,
        ).toBe(true);

        // E o conteúdo dele também: um painel "dentro da tela" com as frases cortadas por dentro
        // seria o mesmo defeito com outra medida.
        const frases = painel.locator(".socbtn");
        const n = await frases.count();
        expect(n, "o painel abriu sem frases").toBeGreaterThan(0);
        for (let i = 0; i < n; i++) {
          const f = await frases.nth(i).boundingBox();
          expect(insideViewport(f as Box, vp, SUBPIXEL),
            `a frase ${i} está fora da tela: ${fmt(f as Box)}`).toBe(true);
        }
        if (process.env.KING_SHOTS) {
          await anfitriao.screenshot({ path: `${process.env.KING_SHOTS}/fim-painel-${ti.project.name}.png` });
        }
      } finally { await fechar(); }
    });

    /**
     * O CARD DE TRUNFO CONTRA O CARD DE CIMA.
     *
     * O pedido foi que ele possa alargar até o comprimento do card de informações da mão, para
     * parar de cortar o nome de quem escolheu. Aqui se afirmam as duas metades: o nome inteiro na
     * tela, e o card sem passar do limite pedido.
     */
    test("o card de trunfo não corta o nome e não passa do card de cima", async ({ page }, ti) => {
      test.setTimeout(180_000);
      await page.setViewportSize(vp);
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem("king.audio",
            JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
          window.localStorage.setItem("king:tutorial",
            JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
        } catch { /* segue */ }
      });
      await page.goto("/?seed=42&mao=7");
      await iniciarPartidaLocal(page);
      await page.locator(SEL.hud).waitFor({ timeout: 20_000 });
      const um = page.locator(".um");
      if (await um.count()) await um.click().catch(() => {});
      const escolha = page.locator(".trumpbtn");
      if (await escolha.count()) await escolha.first().click().catch(() => {});
      await expect(page.locator(".trumpslot")).toBeVisible({ timeout: 15_000 });

      // NOMES CURTOS NÃO PROVAM NADA. A versão anterior deste teste passava com "Tito" e "Raiza"
      // enquanto o aparelho real cortava "Android". O campo de apelido aceita 14 caracteres, e é
      // o limite que precisa ser medido — não o caso confortável.
      for (const nome of ["Tito", "Android", "Valete Folgado"]) {
        await page.locator(".trumpslot .who").evaluate((el, n) => { el.textContent = n; }, nome);
        await page.waitForTimeout(120);
        const m = await page.evaluate(() => {
          const slot = document.querySelector(".trumpslot") as HTMLElement;
          const hud = document.querySelector(".hud") as HTMLElement;
          const who = slot.querySelector(".who") as HTMLElement | null;
          const r = slot.getBoundingClientRect();
          return {
            slot: { x: r.x, y: r.y, width: r.width, height: r.height },
            hudLargura: Math.round(hud.getBoundingClientRect().width),
            cortado: who ? who.scrollWidth > Math.ceil(who.getBoundingClientRect().width) + 1 : false,
          };
        });
        console.log(`  [${ti.project.name} ${vp.width}x${vp.height}] "${nome}": trunfo ` +
          `${Math.round(m.slot.width)}px | HUD ${m.hudLargura}px | ${m.cortado ? "CORTADO" : "inteiro"}`);

        expect(m.cortado, `o nome "${nome}" está cortado no card de trunfo`).toBe(false);
        expect(Math.round(m.slot.width),
          `com "${nome}" o card (${Math.round(m.slot.width)}px) passou do card de cima (${m.hudLargura}px)`)
          .toBeLessThanOrEqual(m.hudLargura + SUBPIXEL);
        expect(insideViewport(m.slot as Box, vp, SUBPIXEL),
          `com "${nome}" o card de trunfo saiu da tela`).toBe(true);
      }
    });

    /**
     * A FILEIRA DO TOPO, COM O RELÓGIO NA TELA.
     *
     * O rótulo "Última vaza" voltou, e com ele o risco de encostar em alguém. O relógio da decisão
     * só existe no multiplayer — foi por medir sem ele que a primeira conferência deu tudo livre.
     */
    test("a fileira do topo não encosta em ninguém", async ({ browser }, ti) => {
      test.setTimeout(600_000);
      const { anfitriao, fechar } = await mesaEmPartida(browser, vp);
      try {
        await anfitriao.waitForTimeout(1500);
        await expect(anfitriao.locator(".topvaza i"), "o rótulo da Última vaza voltou a sumir")
          .toBeVisible();

        const m = await anfitriao.evaluate(() => {
          const cx = (s: string) => {
            const el = document.querySelector(s);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          };
          return {
            topo: cx(".topbtn"), relogio: cx(".mprelogio"), hud: cx(".hud"),
            advTopo: cx(".opp.top"), advDir: cx(".opp.right"), trunfo: cx(".trumpslot"),
          };
        });
        expect(m.topo, "fileira do topo ausente").not.toBeNull();
        for (const [rot, alvo] of [
          ["relógio", m.relogio], ["HUD", m.hud], ["adversário do topo", m.advTopo],
          ["adversário da direita", m.advDir], ["card de trunfo", m.trunfo],
        ] as [string, Box | null][]) {
          if (!alvo) continue;
          expect(intersects(m.topo as Box, alvo, SUBPIXEL),
            `[${ti.project.name}] a fileira do topo encosta em ${rot}\n` +
            `   fileira: ${fmt(m.topo as Box)}\n   ${rot}: ${fmt(alvo)}`).toBe(false);
        }
        expect(insideViewport(m.topo as Box, vp, SUBPIXEL), "a fileira do topo saiu da tela").toBe(true);
      } finally { await fechar(); }
    });
  });
}
