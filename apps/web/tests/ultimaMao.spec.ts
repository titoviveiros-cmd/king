/**
 * "ÚLTIMA MÃO DO JOGO!" no navegador de verdade.
 *
 * O risco de um anúncio no meio da partida não é ele ser feio: é BLOQUEAR. Estes testes medem
 * exatamente isso — que ele sai sozinho, que o toque encurta, que depois de sair não sobra nada
 * interceptando a Mesa, e que ele nunca aparece na mão errada.
 */
import { test, expect, type Page } from "@playwright/test";
import { insideViewport, type Box } from "./helpers/geometry.js";
import { boxOf, SEL, iniciarPartidaLocal } from "./helpers/mesa.js";

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
  await iniciarPartidaLocal(page);
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
  // O RELÓGIO COMEÇA AQUI, no instante em que ele fica visível — e não no fim das medições.
  // Medir a permanência a partir de um instante indefinido transformaria a asserção numa corrida
  // contra o tempo das próprias medições.
  const desdeQueApareceu = Date.now();
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
  await page.waitForTimeout(Math.max(0, 3000 - (Date.now() - desdeQueApareceu)));
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

  // ESPERAR ELE APARECER PRIMEIRO, e não só "não estar na tela": checar `count() === 0` logo de
  // cara passaria de graça, e o laço abaixo pegaria a PRIMEIRA aparição achando que era a segunda.
  await expect(page.locator(".um"), "o anúncio não chegou a aparecer").toBeVisible({ timeout: 15_000 });
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
  // escolha (`z-index` 52, contra 28 do anúncio) passava por cima do selo. A primeira tentativa
  // foi adiar o anúncio até a escolha sair da frente, e o preço foi a mão inteira correndo atrás
  // dele. Hoje a ordem é a inversa — ANÚNCIO primeiro, decisão depois — e as duas telas deixaram
  // de disputar porque deixaram de ser simultâneas.
  await expect(page.locator(".trumpov"), "o anúncio dividiu a tela com a escolha do trunfo")
    .toHaveCount(0);
  await expect(page.locator(".pickmsg"), "o anúncio dividiu a tela com o aviso do trunfo")
    .toHaveCount(0);

  /**
   * A MESA NÃO SE MEXE ENQUANTO O ANÚNCIO ESTÁ NELA — e a medição é DENTRO da janela dele.
   *
   * Antes esta comparação era "durante" contra "depois", e fazia sentido na ordem antiga: o
   * trunfo já estava escolhido quando o anúncio entrava, então a Mesa era a mesma dos dois lados.
   *
   * Na ordem nova a decisão do trunfo cai ENTRE as duas medições, e ela move a coluna esquerda —
   * o card de trunfo aparece e os adversários ganham um andar (`comtrunfo`). Medido a 852×300, o
   * card do adversário desce de y=134,8 para y=159,1. Não é o anúncio deslocando a Mesa: é a mão
   * começando, que é exatamente o que ele estava segurando. Esse deslocamento existe em toda mão
   * positiva, no instante em que o trunfo é escolhido, e sempre existiu.
   *
   * Comparar através dele mediria duas transições e culparia a errada. Então as duas leituras
   * ficam dentro da janela do anúncio: se ele empurrar alguma coisa ao entrar ou enquanto anima,
   * a diferença aparece aqui.
   */
  const medir = async (): Promise<Record<string, string>> => {
    const m: Record<string, string> = {};
    for (const [sel, rotulo] of ELEMENTOS_DA_MESA) {
      if ((await page.locator(sel).count()) === 0) continue;
      m[rotulo] = JSON.stringify(await page.locator(sel).first().boundingBox());
    }
    return m;
  };

  const antes = await medir();
  expect(Object.keys(antes).length, "nada da Mesa foi medido").toBeGreaterThan(2);

  const captura = process.env.KING_SHOTS;
  if (captura) {
    await page.screenshot({ path: `${captura}/ultima-mao-${ti.project.name}.png` });
  }

  // Ainda DURANTE, com a animação já adiantada.
  await page.waitForTimeout(1200);
  await expect(page.locator(".um"), "o anúncio saiu antes da segunda medição").toHaveCount(1);
  const durante = await medir();
  for (const rotulo of Object.keys(antes)) {
    expect(durante[rotulo], `o anúncio deslocou "${rotulo}" enquanto estava na tela`)
      .toBe(antes[rotulo]);
  }

  // ── DEPOIS ──
  await expect(page.locator(".um")).toHaveCount(0, { timeout: 9000 });
  // O que NÃO depende da mão que começa continua onde estava. O painel da mão e os botões do topo
  // são moldura: nenhuma decisão da mão 10 os move, então eles respondem pelo anúncio sozinho.
  for (const rotulo of ["painel da mão", "botões do topo"]) {
    if (!(rotulo in antes)) continue;
    const sel = ELEMENTOS_DA_MESA.find(([, r]) => r === rotulo)![0];
    const depois = JSON.stringify(await page.locator(sel).first().boundingBox());
    expect(depois, `o anúncio deslocou "${rotulo}" ao sair`).toBe(antes[rotulo]);
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

/**
 * O SEQUENCIAMENTO, MEDIDO NO TEMPO — que é a única forma de medi-lo.
 *
 * ══ O DEFEITO ══
 *
 * O anúncio esperava a escolha do trunfo sair da frente e entrava DEPOIS dela, com a mão já em
 * curso atrás do véu. Medido a 852×393: aos 1000ms havia uma carta na vaza, aos 1500ms havia duas
 * e a vez do humano já estava aberta — tudo por baixo da animação. Quem parou para assistir saía
 * do anúncio com a vaza em andamento, e a celebração cobria justamente o começo que ela anunciava.
 *
 * ══ POR QUE UM TESTE DE INSTANTE NÃO SERVIRIA ══
 *
 * "Não há carta na vaza quando o anúncio está na tela" passa de graça se for perguntado no
 * primeiro quadro: a mão leva quase um segundo para começar a andar. O defeito vive no INTERVALO,
 * então o que se mede é o intervalo inteiro: amostra a Mesa de 200 em 200ms enquanto o anúncio
 * estiver visível, e UMA amostra suja reprova.
 *
 * As duas metades do pedido, na ordem:
 *   anúncio visível  → nenhuma carta, nenhum controle, nenhuma jogada;
 *   anúncio encerrado → as cartas entram e o gameplay é liberado.
 */
test("enquanto o anúncio está na tela, a mão 10 não começa", async ({ page }, ti) => {
  test.setTimeout(120_000);
  await mesaNaMao(page, 10);
  await expect(page.locator(".um"), "o anúncio não apareceu").toBeVisible({ timeout: 15_000 });

  /** O que existe na Mesa AGORA, do que pertence à mão 10. */
  const retrato = () => page.evaluate(() => ({
    anuncio: !!document.querySelector(".um"),
    vaza: document.querySelectorAll(".trick .card").length,
    leque: document.querySelectorAll(".hand .card").length,
    jogaveis: document.querySelectorAll(".hand .card.legal").length,
    trunfoBtn: document.querySelectorAll(".trumpbtn").length,
    painelTrunfo: document.querySelectorAll(".trumpov").length,
    avisoTrunfo: document.querySelectorAll(".pickmsg").length,
    slotTrunfo: document.querySelectorAll(".trumpslot").length,
    relogio: document.querySelectorAll(".mprelogio").length,
    suaVez: document.querySelectorAll(".suavez").length,
  }));

  const sujas: string[] = [];
  let amostras = 0;
  for (let i = 0; i < 40; i++) {
    const r = await retrato();
    if (!r.anuncio) break;
    amostras++;
    const problemas = Object.entries(r)
      .filter(([k, v]) => k !== "anuncio" && v !== 0 && v !== false)
      .map(([k, v]) => `${k}=${v}`);
    if (problemas.length) sujas.push(`${i * 200}ms: ${problemas.join(" ")}`);
    await page.waitForTimeout(200);
  }

  expect(amostras, "o anúncio saiu rápido demais para medir o intervalo").toBeGreaterThan(5);
  expect(sujas,
    `a mão 10 começou por baixo do anúncio — ${sujas.length} de ${amostras} amostras sujas`)
    .toEqual([]);

  if (process.env.KING_SHOTS) {
    await page.screenshot({ path: `${process.env.KING_SHOTS}/um-sequencia-durante-${ti.project.name}.png` });
  }
});

/**
 * A ORDEM DOS ACONTECIMENTOS — anúncio, depois cartas, depois jogo.
 *
 * ══ POR QUE ORDEM, E NÃO ESTADO ══
 *
 * A tentação é olhar a tela logo depois que o anúncio sai e exigir que o trunfo ainda esteja
 * pendente. Não funciona, e a razão é do jogo: `trumpChooserFor(10)` é o assento 3, que no solo é
 * um bot. Assim que a suspensão levanta, ele escolhe no ciclo seguinte — o aviso "está escolhendo
 * o trunfo" existe por menos de um intervalo de sondagem, e a asserção vira uma corrida.
 *
 * Já a ORDEM em que as coisas aparecem pela primeira vez não tem corrida nenhuma. E é ela que
 * distingue as duas sequências possíveis, que é o que esta rodada mudou:
 *
 *   antiga:  trunfo pedido → trunfo escolhido → ANÚNCIO (com a mão andando atrás dele)
 *   nova:    ANÚNCIO → trunfo pedido → trunfo escolhido → jogo
 *
 * Amostrar do carregamento até depois do anúncio e comparar os índices de primeira aparição
 * responde as duas metades do pedido de uma vez, sem depender de pegar nenhum instante.
 */
test("quando o anúncio sai, as cartas entram e a jogada é liberada", async ({ page }, ti) => {
  test.setTimeout(120_000);
  await mesaNaMao(page, 10);

  interface Quadro { um: boolean; trunfoNaTela: boolean; leque: number; jogaveis: number }
  const quadros: Quadro[] = [];
  for (let i = 0; i < 90; i++) {
    quadros.push(await page.evaluate(() => ({
      um: !!document.querySelector(".um"),
      // Qualquer sinal de que a mão 10 chegou à decisão do trunfo: o painel de quem escolhe, o
      // aviso de quem espera, ou o card do trunfo já resolvido.
      trunfoNaTela: !!document.querySelector(".trumpov, .pickmsg, .trumpslot"),
      leque: document.querySelectorAll(".hand .card").length,
      jogaveis: document.querySelectorAll(".hand .card.legal").length,
    })));
    // Para de amostrar um pouco depois do anúncio ter saído e o jogo ter começado.
    const q = quadros[quadros.length - 1];
    if (quadros.some((x) => x.um) && !q.um && q.leque > 0 && q.trunfoNaTela) break;
    await page.waitForTimeout(100);
  }

  const primeiro = (f: (q: Quadro) => boolean) => quadros.findIndex(f);
  const ultimo = (f: (q: Quadro) => boolean) => quadros.map(f).lastIndexOf(true);

  const iAnuncio = primeiro((q) => q.um);
  const iFimDoAnuncio = ultimo((q) => q.um);
  const iTrunfo = primeiro((q) => q.trunfoNaTela);
  const iLeque = primeiro((q) => q.leque > 0);

  const linhaDoTempo = `anúncio ${iAnuncio}..${iFimDoAnuncio}, trunfo ${iTrunfo}, leque ${iLeque}`;
  expect(iAnuncio, `o anúncio não apareceu (${linhaDoTempo})`).toBeGreaterThanOrEqual(0);

  // 1 · O ANÚNCIO VEM PRIMEIRO. Nada do trunfo antes dele.
  expect(iTrunfo,
    `a mão 10 pediu o trunfo antes do anúncio — ordem antiga (${linhaDoTempo})`)
    .toBeGreaterThan(iFimDoAnuncio);

  // 2 · AS CARTAS ENTRAM DEPOIS. Nenhum leque durante, treze depois.
  expect(iLeque, `as cartas foram distribuídas durante o anúncio (${linhaDoTempo})`)
    .toBeGreaterThan(iFimDoAnuncio);
  await expect(page.locator(".hand .card"), "as cartas não foram distribuídas depois do anúncio")
    .toHaveCount(13, { timeout: 10_000 });

  // 3 · E O JOGO É LIBERADO — a mão 10 chega à vez de alguém.
  await expect(async () => {
    const vivo = await page.locator(".trick .card, .hand .card.legal, .trumpov, .pickmsg").count();
    expect(vivo, "a mão 10 não começou depois que o anúncio saiu").toBeGreaterThan(0);
  }).toPass({ timeout: 15_000 });

  if (process.env.KING_SHOTS) {
    await page.screenshot({ path: `${process.env.KING_SHOTS}/um-sequencia-depois-${ti.project.name}.png` });
  }
});
