/**
 * AVATAR OCUPADO — A PESSOA ESCOLHE, O SISTEMA NÃO ESCOLHE POR ELA.
 *
 * ══ O QUE MUDOU E POR QUÊ ══
 *
 * Antes, entrar pedindo um bicho que outra pessoa já usava fazia o servidor atribuir "o próximo
 * livre". Parecia gentil e não era: quem tinha o Sapo salvo no aparelho entrava como Coruja sem
 * ter pedido nada, e a única forma de perceber era reparar no próprio card. Avatar é identidade,
 * e identidade não se atribui em silêncio.
 *
 * Agora, ocupado significa PENDENTE. A pessoa senta, vê a sala, conversa — e não fica pronta nem
 * deixa a partida começar até escolher conscientemente. O servidor é quem arbitra: o `disabled`
 * do seletor e o botão apagado são apresentação; quem recusa é `AVATAR_TAKEN` / `AVATAR_PENDING`.
 *
 * Este arquivo usa DOIS navegadores de verdade, porque o defeito só existe entre duas pessoas.
 */
import { test, expect, type Browser, type Page } from "@playwright/test";
import { criarSala, entrarNaSala } from "./helpers/multiplayer.js";

const PASTA = process.env.KING_SHOTS;

/** Duas pessoas na mesma sala, a segunda pedindo o bicho que a primeira já tem. */
async function duasPessoas(
  browser: Browser, vp: { width: number; height: number }, bicho: string,
): Promise<{ a: Page; b: Page; fechar: () => Promise<void> }> {
  const ctxA = await browser.newContext({ viewport: vp });
  const ctxB = await browser.newContext({ viewport: vp });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const codigo = await criarSala(a, "Tito", bicho);
  await entrarNaSala(b, codigo, "Raiza", bicho);
  return { a, b, fechar: async () => { await ctxA.close(); await ctxB.close(); } };
}

/** O que o círculo daquele assento está desenhando, na visão daquela página. */
const circuloDe = (page: Page, seat: number) =>
  page.locator(`.sl-lugar.s${seat} .sl-av`).first();

for (const [ocupado, escolhido, glifoEscolhido] of [
  ["Unicórnio", "Raposa", "🦊"],
  ["Sapo", "Panda", "🐼"],
] as const) {
  test(`quem pede o ${ocupado} ocupado fica pendente e escolhe o ${escolhido}`, async ({ browser }, ti) => {
    test.skip(ti.project.name !== "667x375", "comportamento, não geometria");
    test.setTimeout(180_000);
    const vp = ti.project.use.viewport!;
    const { a, b, fechar } = await duasPessoas(browser, vp, ocupado);

    try {
      // ── 1 · QUEM CHEGOU PRIMEIRO NÃO PERDE NADA ──
      await expect(circuloDe(a, 0), "o primeiro perdeu o avatar que escolheu")
        .toHaveAttribute("aria-label", ocupado, { timeout: 20_000 });

      // ── 2 · E QUEM CHEGOU DEPOIS NÃO GANHA UM SUBSTITUTO ──
      // O círculo neutro é a prova de que ninguém escolheu por ela: um animal aqui pareceria uma
      // seleção válida, que é exatamente a mentira que a regra existe para eliminar.
      const dela = circuloDe(b, 1);
      await expect(dela, "o servidor escolheu um bicho pela pessoa")
        .toHaveAttribute("aria-label", /não escolhido/, { timeout: 20_000 });
      await expect(dela).toHaveText("?");
      await expect(b.locator(".sl-lugar.s1")).toHaveClass(/pendente/);

      // ── 3 · ELA É AVISADA, COM O MOTIVO E O CAMINHO ──
      const aviso = b.locator(".sl-pendente");
      await expect(aviso, "ninguém disse a ela o que aconteceu").toBeVisible();
      await expect(aviso).toContainText("já está em uso");
      if (PASTA) await b.screenshot({ path: `${PASTA}/avatar-aviso-${ocupado}.png` });

      // ── 4 · E FICA IMPEDIDA DE AVANÇAR ──
      const pronto = b.getByRole("button", { name: /Escolha um avatar|Estou pronto/ });
      await expect(pronto, "quem não escolheu conseguiu ficar pronto").toBeDisabled();
      await expect(pronto).toHaveText(/Escolha um avatar/);
      if (PASTA) await b.screenshot({ path: `${PASTA}/avatar-bloqueado-${ocupado}.png` });

      // ── 5 · O SELETOR JÁ ESTÁ ABERTO, com o ocupado marcado e inclicável ──
      await expect(b.locator(".sl-avop"), "o seletor não abriu sozinho").toHaveCount(8);
      const oOcupado = b.locator(`.sl-avop[aria-label*="${ocupado}"]`);
      await expect(oOcupado).toHaveClass(/emuso/);
      await expect(oOcupado).toBeDisabled();
      await expect(oOcupado).toContainText("Em uso");
      if (PASTA) await b.screenshot({ path: `${PASTA}/avatar-seletor-${ocupado}.png` });

      // ── 6 · ELA ESCOLHE CONSCIENTEMENTE, e o servidor aceita ──
      await b.locator(`.sl-avop[aria-label="${escolhido}"]`).click();
      await expect(dela, "a escolha consciente não foi aplicada")
        .toHaveText(glifoEscolhido, { timeout: 15_000 });
      await expect(b.locator(".sl-pendente"), "o aviso ficou depois de resolvido").toHaveCount(0);
      await expect(b.locator(".sl-avop"), "o seletor não fechou após a escolha").toHaveCount(0);

      // ── 7 · OS DOIS APARELHOS CONCORDAM ──
      await expect(circuloDe(a, 1), "a escolha dela não chegou ao outro aparelho")
        .toHaveText(glifoEscolhido, { timeout: 15_000 });
      await expect(circuloDe(a, 0)).toHaveAttribute("aria-label", ocupado);

      // ── 8 · E AGORA ELA PODE SEGUIR ──
      await expect(b.getByRole("button", { name: /Estou pronto/ })).toBeEnabled();
      if (PASTA) await b.screenshot({ path: `${PASTA}/avatar-resolvido-${escolhido}.png` });
    } finally {
      await fechar();
    }
  });
}

/**
 * A CORRIDA, no navegador.
 *
 * O desempate é do servidor e tem teste próprio lá (`mesaMista.test.ts`), onde dá para disparar
 * as duas mensagens sem nada no meio. Aqui o que se mede é o outro lado: o que as duas PESSOAS
 * veem quando disputam o mesmo bicho — que exatamente uma fica com ele, que a outra não recebe
 * substituto, e que as duas telas contam a mesma história.
 */
test("dois pedindo o mesmo bicho: um leva, o outro escolhe de novo", async ({ browser }, ti) => {
  test.skip(ti.project.name !== "667x375", "comportamento, não geometria");
  test.setTimeout(180_000);
  const vp = ti.project.use.viewport!;
  const ctxA = await browser.newContext({ viewport: vp });
  const ctxB = await browser.newContext({ viewport: vp });

  try {
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    // Entram com bichos diferentes: ninguém nasce pendente, e a disputa é por um TERCEIRO.
    const codigo = await criarSala(a, "Tito", "Sapo");
    await entrarNaSala(b, codigo, "Raiza", "Panda");
    await expect(b.locator(".sl-lugares")).toBeVisible({ timeout: 20_000 });

    // Abrem os dois seletores e pedem o mesmo, sem espera entre os cliques: é o mais perto de
    // "ao mesmo tempo" que se monta com dois navegadores.
    await a.locator(".sl-lugar.voce .sl-av-troca").click();
    await b.locator(".sl-lugar.voce .sl-av-troca").click();
    await Promise.all([
      a.locator('.sl-avop[aria-label="Coruja"]').click(),
      b.locator('.sl-avop[aria-label="Coruja"]').click(),
    ]);

    // Exatamente UM fica com a Coruja, e os dois aparelhos veem a mesma coisa.
    await expect(async () => {
      const rotulos = await a.locator(".sl-lugar .sl-av").evaluateAll(
        (ns) => ns.map((n) => n.getAttribute("aria-label")),
      );
      expect(rotulos.filter((r) => r === "Coruja").length,
        `mais de um ficou com a Coruja: ${rotulos.join(", ")}`).toBe(1);
    }).toPass({ timeout: 15_000 });

    const naVisaoDeA = await a.locator(".sl-lugar .sl-av").evaluateAll(
      (ns) => ns.map((n) => n.getAttribute("aria-label")),
    );
    const naVisaoDeB = await b.locator(".sl-lugar .sl-av").evaluateAll(
      (ns) => ns.map((n) => n.getAttribute("aria-label")),
    );
    expect(naVisaoDeB, "os dois aparelhos divergem sobre quem é quem").toEqual(naVisaoDeA);

    // E o PERDEDOR não recebeu substituto: ficou com o bicho que já tinha.
    const humanos = naVisaoDeA.slice(0, 2);
    expect(humanos.filter((r) => r === "Sapo" || r === "Panda").length,
      `o perdedor recebeu um substituto: ${humanos.join(", ")}`).toBe(1);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});
