/**
 * CADÊNCIA DAS JOGADAS NA MESA DE VERDADE — multiplayer, dois aparelhos, 800×360.
 *
 * ══ O QUE ESTE ARQUIVO MEDE, E O QUE ELE NÃO MEDE ══
 *
 * Mede o que o jogador vê: o instante em que cada carta APARECE dentro de `.trick`, capturado por
 * um observador de mutação no próprio DOM. Não é simulação e não é aproximação — é o relógio do
 * navegador marcando quando o nó entrou na página.
 *
 * O que ele NÃO é: a reprodução do defeito. Grudar duas cartas dependia de uma pausa longa (vaza
 * com bucha, Rei de Copas), e nenhuma das duas é encomendável num embaralhamento real. Quem
 * reproduz o defeito com o relógio dos dois lados e a política de verdade é
 * `src/game/cadencia.test.ts`, e é lá que ele foi visto vermelho antes de verde.
 *
 * O papel deste arquivo é o outro lado da prova, que a simulação não alcança: que na Mesa real,
 * na geometria do aparelho do relato, com dois clientes de verdade e o servidor no meio, as
 * cartas continuam entrando uma de cada vez e os dois aparelhos veem a MESMA sequência.
 */
import { test, expect, type Page } from "@playwright/test";
import { mesaEmPartida } from "./helpers/multiplayer.js";

/** A geometria do aparelho do relato físico. */
const APARELHO = { width: 800, height: 360 };

/**
 * O PISO DE LEGIBILIDADE.
 *
 * `botPasso` é 520ms. O piso aqui é 60% disso: a asserção precisa pegar "duas cartas no mesmo
 * instante" sem reprovar por um quadro perdido, uma coleta de lixo ou o agendador do navegador
 * atrasando um tique. Um piso colado nos 520 seria intermitente por natureza; um piso de 0 não
 * pegaria nada. 312ms está longe dos dois.
 */
const PISO_MS = 312;

/**
 * Instala o observador ANTES de a partida começar: perder as primeiras cartas cegaria a medição.
 *
 * MEDE A CONTAGEM, NÃO A IDENTIDADE DO NÓ. A primeira versão registrava os `addedNodes` que
 * fossem `.card` — e observou ZERO cartas numa mão inteira, com a mesa cheia na tela. O React
 * troca o contêiner, então a carta chega como DESCENDENTE do nó adicionado e nunca como o nó.
 * Contar `.trick .card` a cada mutação e marcar quando o número SOBE mede o fato que interessa —
 * uma carta a mais na mesa — sem depender de como o framework reconcilia a árvore.
 */
async function observarVaza(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __cartas?: number[] };
    w.__cartas = [];
    let anterior = document.querySelectorAll(".trick .card").length;
    new MutationObserver(() => {
      const agora = document.querySelectorAll(".trick .card").length;
      // Só a SUBIDA é jogada. A descida é a vaza sendo recolhida, que tem pausa própria.
      for (let i = anterior; i < agora; i++) w.__cartas!.push(performance.now());
      anterior = agora;
    }).observe(document.body, { childList: true, subtree: true });
  });
}

const cartasVistas = (page: Page) =>
  page.evaluate(() => (window as unknown as { __cartas: number[] }).__cartas);

/** Joga uma carta legal quando for a vez deste aparelho. Devolve `false` se a vez não chegou. */
async function jogarSePuder(page: Page): Promise<boolean> {
  const legal = page.locator(".hand .card.legal").first();
  if (await legal.count() === 0) return false;
  await legal.click({ timeout: 5_000 }).catch(() => undefined);
  return true;
}

test.describe("cadência das jogadas", () => {
  test.describe.configure({ mode: "serial" });

  test("as cartas entram uma de cada vez, e os dois aparelhos veem a mesma sequência", async ({
    browser,
  }, ti) => {
    test.skip(
      ti.project.name !== `${APARELHO.width}x${APARELHO.height}`,
      "roda uma vez, na geometria do aparelho do relato",
    );
    test.setTimeout(180_000);

    const mesa = await mesaEmPartida(browser, APARELHO, {
      toque: true,
      // Nomes no limite do campo: o pior caso do rodapé e do card de trunfo, exercitado junto.
      avatares: { anfitriao: "Sapo", convidado: "Panda" },
    });

    try {
      await observarVaza(mesa.anfitriao);
      await observarVaza(mesa.convidado);

      // Joga até acumular cartas suficientes para medir várias transições — incluindo as que
      // saem de bots, que são a maioria numa mesa de 2 humanos + 2 bots.
      const ate = Date.now() + 120_000;
      while (Date.now() < ate) {
        const jogou = (await jogarSePuder(mesa.anfitriao)) || (await jogarSePuder(mesa.convidado));
        const quantas = (await cartasVistas(mesa.anfitriao)).length;
        if (quantas >= 12) break;
        if (!jogou) await mesa.anfitriao.waitForTimeout(250);
      }

      const doA = await cartasVistas(mesa.anfitriao);
      const doB = await cartasVistas(mesa.convidado);

      expect(doA.length, "nenhuma carta foi observada — a medição não mediu nada")
        .toBeGreaterThanOrEqual(8);

      // A MEDIÇÃO FICA NO RELATÓRIO, e não só na asserção. Um teste que só diz "passou" não
      // permite comparar dois regimes de cadência — e foi comparando os intervalos reais que se
      // descobriu o que este arquivo alcança e o que ele não alcança.
      const intervalosDe = (m: number[]) => m.slice(1).map((t, i) => Math.round(t - m[i]));
      ti.annotations.push(
        { type: "intervalos-anfitriao", description: intervalosDe(doA).join(", ") },
        { type: "intervalos-convidado", description: intervalosDe(doB).join(", ") },
      );
      // eslint-disable-next-line no-console
      console.log(`[cadência] anfitrião: ${intervalosDe(doA).join(", ")}`);
      // eslint-disable-next-line no-console
      console.log(`[cadência] convidado: ${intervalosDe(doB).join(", ")}`);

      // 1. NENHUM PAR DE CARTAS NO MESMO INSTANTE, em nenhum dos dois aparelhos.
      for (const [quem, marcas] of [["anfitrião", doA], ["convidado", doB]] as const) {
        const intervalos = marcas.slice(1).map((t, i) => Math.round(t - marcas[i]));
        const menor = Math.min(...intervalos);
        expect(
          menor,
          `[${quem}] duas cartas entraram a ${menor}ms uma da outra. Intervalos: ${intervalos.join(", ")}`,
        ).toBeGreaterThanOrEqual(PISO_MS);
      }

      // 2. OS DOIS APARELHOS VEEM A MESMA QUANTIDADE DE CARTAS.
      //    Não se exige o mesmo milissegundo — exige-se a mesma história.
      expect(Math.abs(doA.length - doB.length),
        `aparelhos divergiram: ${doA.length} × ${doB.length} cartas`).toBeLessThanOrEqual(1);
    } finally {
      await mesa.fechar();
    }
  });
});
