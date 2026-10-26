/**
 * O BOTÃO DE PRONTO ENTRE AS MÃOS, LEGÍVEL INTEIRO — em todos os viewports.
 *
 * ══ POR QUE ESTE ARQUIVO EXISTE ══
 *
 * Achados da partida real de 26/10/2026 (2 humanos, 2 bots, um humano desconectado): o
 * "ESTOU PRONTO" do placar entre mãos aparecia espremido, e a linha de baixo — "aguardando Raiza ·
 * toque para desfazer" — saía cortada em "AGUARDANDO RAIZA · TOQUE…". A causa era de desenho: uma
 * caixa de largura e altura fixas, sem respiro vertical, com as duas linhas presas numa só
 * (`nowrap` + reticências) e em maiúsculas (herdadas do `.btn`), o que alarga cada caractere.
 *
 * O que NÃO pode voltar é o defeito que essa caixa fixa resolvia: tocar em "Estou pronto" e o
 * rodapé mudar de tamanho embaixo do dedo (ver socialPlacar.spec.ts). Por isso aqui se exige as
 * duas coisas ao mesmo tempo: o texto INTEIRO, em qualquer estado e com qualquer apelido do
 * tamanho máximo, E a mesma caixa em todos esses estados.
 *
 * ══ COMO ══
 *
 * O consenso só existe em multiplayer, e chegar ao placar entre mãos com dois navegadores custa
 * uma mão inteira jogada (é o que socialPlacar.spec.ts faz, num viewport). Aqui o placar entre
 * mãos é o REAL, alcançado no solo por semente fixa, e o rodapé recebe o MESMO DOM que o
 * multiplayer põe nele — o botão social e o bloco de consenso, com as classes e os textos que
 * `ConsensoDaProximaMao` gera. A guarda abaixo reprova se o componente deixar de gerar essa
 * estrutura: aí este teste mediria um desenho que não existe mais.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SEL, iniciarPartidaLocal } from "./helpers/mesa.js";
import { fmt, insideViewport, intersects, type Box } from "./helpers/geometry.js";

const SUBPIXEL = 1;
/**
 * A FOLGA DO PLACAR NOS APARELHOS, a mesma régua de androidReal.spec.ts (24 px: um chip que quebra de
 * linha custa 26). Lá ela é medida no solo; aqui, com o rodapé de verdade do multiplayer — o
 * consenso e o botão social —, que é o maior. Vale nas geometrias de aparelho que são projeto.
 */
const FOLGA_MINIMA = 24;
const APARELHOS = new Set(["800x360", "852x393"]);
/** Respiro mínimo entre o texto e a borda do botão: menos que isso é "espremido". */
const RESPIRO_VERTICAL = 4;
const RESPIRO_HORIZONTAL = 6;

/** Lê o código executável (sem comentários) de um componente. */
function codigoDe(arquivo: string): string {
  return readFileSync(new URL(`../src/ui/${arquivo}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

/** O espaço não separável, e o escape ` ` como ele aparece no código-fonte do componente. */
const NBSP = String.fromCharCode(160);
const ESC = String.fromCharCode(92) + "u00a0";

function exigirMesmoDesenhoDoConsenso(): void {
  const consenso = codigoDe("MesaOnline.tsx");
  // A ESTRUTURA, e não só os textos: o botão tem exatamente o título e a legenda, e fecha o bloco.
  // Um invólucro em volta deles, um terceiro filho ou o consenso fora do lugar reprovam aqui.
  const compacto = consenso.replace(/\s+/g, " ");
  expect(compacto.includes('<b>{pronto ? "✓ Pronto" : "Estou pronto"}</b> <i>{legenda}</i> </button> </div> );'),
    "o botão do consenso não é mais exatamente <b>título</b><i>legenda</i> dentro de .pl-consenso").toBe(true);
  for (const trecho of [
    'className="pl-consenso"',
    'className="pl-prontos"',
    "className={`pl-pronto s${i}${ok ? \" ok\" : \"\"}${ausente ? \" ausente\" : \"\"}`}",
    'classe="pl-pronto-av"',
    "className={`btn ${pronto ? \"ghost\" : \"gold\"} pl-toggle${pronto ? \" on\" : \"\"}`}",
    "disabled={pronto && (!onCancelar || travado)}",
    "className={`soc soc-${variante}",
    '"quando quiser seguir"',
    '"começando…"',
    "`aguardando ${faltam[0].nome}" + ESC + "· toque" + ESC + "para" + ESC + "desfazer`",
    "`aguardando ${faltam.length} jogadores" + ESC + "· toque" + ESC + "para" + ESC + "desfazer`",
  ]) {
    expect(consenso.includes(trecho), `ConsensoDaProximaMao não gera mais \`${trecho}\` — o DOM injetado ficou desatualizado`).toBe(true);
  }
  const placar = codigoDe("Placar.tsx");
  const social = placar.indexOf('<BotaoSocial status="placar" variante="placar"');
  const acoes = placar.indexOf('<div className="pl-actions">');
  const bloco = placar.indexOf("<ConsensoDaProximaMao", acoes);
  expect(social > 0 && acoes > social && bloco > acoes,
    "o rodapé do placar não é mais: botão social, depois pl-actions com o consenso dentro").toBe(true);
}

/** O placar entre mãos de verdade, no fim da mão 6: o próximo contrato é o mais longo (positiva com trunfo). */
async function placarEntreMaos(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }));
      window.localStorage.setItem("king:tutorial", JSON.stringify({ iniciado: true, concluido: true, passo: 0 }));
    } catch { /* segue */ }
  });
  await page.goto("/?seed=42&mao=6");
  await iniciarPartidaLocal(page);
  await page.locator(SEL.hud).waitFor({ timeout: 20_000 });
  const um = page.locator(".um");
  if (await um.count()) await um.click().catch(() => {});
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
  await expect(page.locator(".pl-foot"), "a mão 6 com semente fixa não chegou ao placar entre mãos").toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(600);
}

/**
 * `estresse`: o apelido no limite de 14 caracteres feito só da letra mais larga. Ele precisa caber
 * INTEIRO, sem invadir nada e sem fazer o placar rolar — mas pode pedir uma terceira linha, e aí a
 * caixa cresce em vez de cortar. A mesma caixa em todos os estados é exigida dos outros: os estados
 * que o componente produz com os apelidos reais — curto, no limite com espaço e no limite SEM espaço,
 * que é o que não deixa a legenda quebrar onde quer.
 */
interface Variante { id: string; pronto: boolean; prontos: number[]; legenda: string; travado?: boolean; estresse?: boolean }
// Como o componente escreve: o "·" preso à palavra de antes e "toque para desfazer" inteiro. Quando a
// legenda quebra, a linha de baixo é "toque para desfazer" — sem ponto solto nem palavra órfã, com ou
// sem `text-wrap: balance` no navegador.
const aguardando = (quem: string) => `aguardando ${quem}${NBSP}· toque${NBSP}para${NBSP}desfazer`;
const VARIANTES: Variante[] = [
  { id: "não pronto", pronto: false, prontos: [2, 3], legenda: "quando quiser seguir" },
  { id: "aguardando apelido curto", pronto: true, prontos: [0, 2, 3], legenda: aguardando("Raiza") },
  { id: "aguardando apelido de 14 com espaço", pronto: true, prontos: [0, 2, 3], legenda: aguardando("Valete Folgado") },
  { id: "aguardando apelido de 14 sem espaço", pronto: true, prontos: [0, 2, 3], legenda: aguardando("DouglasAndrade") },
  { id: "aguardando apelido de 14 maiúsculo", pronto: true, prontos: [0, 2, 3], legenda: aguardando("CAMARGOMONTANA") },
  { id: "aguardando 3 jogadores", pronto: true, prontos: [0], legenda: aguardando("3 jogadores") },
  { id: "começando", pronto: true, prontos: [0, 1, 2, 3], legenda: "começando…", travado: true },
  { id: "aguardando 14 letras largas", pronto: true, prontos: [0, 2, 3], legenda: aguardando("WWWWWWWWWWWWWW"), estresse: true },
];

/** Contraste WCAG entre duas cores sRGB (0–255). */
function contraste(a: number[], b: number[]): number {
  const lum = (c: number[]) => {
    const [r, g, bl] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** O fim do degradê do botão dourado (`--gold2`): o fundo mais escuro sob a legenda, o pior caso. */
const OURO_ESCURO = [0xc9, 0x97, 0x1f];

/** Põe no rodapé o que o multiplayer põe: botão social antes de pl-actions, e o consenso dentro. */
async function injetarConsenso(page: Page, v: Variante): Promise<void> {
  await page.evaluate((v) => {
    const foot = document.querySelector(".pl-foot") as HTMLElement;
    const acoes = foot.querySelector(".pl-actions") as HTMLElement;
    if (!foot.querySelector(".soc")) {
      const soc = document.createElement("button");
      soc.className = "soc soc-placar";
      soc.textContent = "💬";
      foot.insertBefore(soc, acoes);
    }
    const bichos = ["🦁", "🦊", "🐸", "🐼"];
    const prontos = document.createElement("div");
    prontos.className = "pl-prontos";
    bichos.forEach((b, i) => {
      const s = document.createElement("span");
      s.className = `pl-pronto s${i}${v.prontos.includes(i) ? " ok" : ""}${i === 1 ? " ausente" : ""}`;
      const av = document.createElement("span");
      av.className = `pl-pronto-av s${i}`;
      av.textContent = b;
      s.appendChild(av);
      prontos.appendChild(s);
    });
    const botao = document.createElement("button");
    botao.className = `btn ${v.pronto ? "ghost" : "gold"} pl-toggle${v.pronto ? " on" : ""}`;
    botao.disabled = !!v.travado; // como o componente: "começando…" já não se desfaz
    const b = document.createElement("b");
    b.textContent = v.pronto ? "✓ Pronto" : "Estou pronto";
    const i = document.createElement("i");
    i.textContent = v.legenda;
    botao.append(b, i);
    const consenso = document.createElement("div");
    consenso.className = "pl-consenso";
    consenso.append(prontos, botao);
    acoes.replaceChildren(consenso);
  }, v);
  await page.waitForTimeout(120);
}

async function medir(page: Page) {
  return page.evaluate(() => {
    const caixa = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const botao = document.querySelector(".pl-toggle") as HTMLElement;
    const cs = getComputedStyle(botao);
    const linhas = [...botao.children].map((el) => {
      const e = el as HTMLElement;
      const ce = getComputedStyle(e);
      // A caixa do TEXTO (Range), e não a do elemento: um `overflow:hidden` com entrelinha curta corta
      // o alto das letras sem mudar scrollHeight — foi metade do defeito original.
      const r = document.createRange();
      r.selectNodeContents(e);
      const t = r.getBoundingClientRect();
      return { tag: e.tagName, texto: e.textContent ?? "", cortadoX: e.scrollWidth > e.clientWidth + 1,
        cortadoY: e.scrollHeight > e.clientHeight + 1, recorta: `${ce.overflowX}/${ce.overflowY}`,
        caixa: { x: t.x, y: t.y, width: t.width, height: t.height } };
    });
    const placar = document.querySelector(".placar") as HTMLElement;
    const ov = document.querySelector(".placarov") as HTMLElement;
    const cso = getComputedStyle(ov);
    return {
      corDaLegenda: getComputedStyle(botao.querySelector("i") as HTMLElement).color,
      folga: Math.round(ov.clientHeight - parseFloat(cso.paddingTop) - parseFloat(cso.paddingBottom) - placar.scrollHeight),
      botao: caixa(botao)!,
      borda: parseFloat(cs.borderTopWidth),
      linhas,
      rodape: caixa(document.querySelector(".pl-foot"))!,
      vizinhos: { social: caixa(document.querySelector(".pl-foot .soc")), proxima: caixa(document.querySelector(".pl-next")),
        prontos: caixa(document.querySelector(".pl-prontos")) },
      placarRola: { y: placar.scrollHeight - placar.clientHeight, x: placar.scrollWidth - placar.clientWidth },
    };
  });
}

test("o pronto entre mãos mostra o texto inteiro, com respiro, na mesma caixa em todos os estados", async ({ page }, ti) => {
  test.setTimeout(180_000);
  exigirMesmoDesenhoDoConsenso();
  await placarEntreMaos(page);
  const vp = page.viewportSize()!;
  const geometria = new Map<string, string>();

  for (const v of VARIANTES) {
    await injetarConsenso(page, v);
    const m = await medir(page);
    const onde = `[${ti.project.name} · ${v.id}]`;
    if (process.env.KING_SHOTS) {
      await page.locator(".pl-foot").screenshot({ path: `${process.env.KING_SHOTS}/pronto-${ti.project.name}-${v.id.replace(/\W+/g, "-")}.png` });
    }

    // 1 · NADA CORTADO, NADA RETICENCIADO: cada linha cabe inteira na própria caixa.
    for (const l of m.linhas) {
      expect(l.cortadoX || l.cortadoY, `${onde} "${l.texto}" está cortado (${l.tag})`).toBe(false);
      expect(l.recorta, `${onde} "${l.texto}" está dentro de uma caixa que recorta (${l.tag}: overflow ${l.recorta})`).toBe("visible/visible");
    }
    expect(m.linhas.map((l) => l.texto).join(" | "), `${onde} o texto mudou`)
      .toBe(`${v.pronto ? "✓ Pronto" : "Estou pronto"} | ${v.legenda}`);

    // 2 · COM RESPIRO: o texto fica dentro do botão, longe da borda, e centrado nele.
    const topo = Math.min(...m.linhas.map((l) => l.caixa.y));
    const base = Math.max(...m.linhas.map((l) => l.caixa.y + l.caixa.height));
    const esq = Math.min(...m.linhas.map((l) => l.caixa.x));
    const dir = Math.max(...m.linhas.map((l) => l.caixa.x + l.caixa.width));
    const folgas = { cima: topo - m.botao.y - m.borda, baixo: m.botao.y + m.botao.height - m.borda - base,
      esq: esq - m.botao.x - m.borda, dir: m.botao.x + m.botao.width - m.borda - dir };
    expect(Math.min(folgas.cima, folgas.baixo), `${onde} texto espremido na vertical: ${JSON.stringify(folgas)}`)
      .toBeGreaterThanOrEqual(RESPIRO_VERTICAL);
    expect(Math.min(folgas.esq, folgas.dir), `${onde} texto encostado na lateral: ${JSON.stringify(folgas)}`)
      .toBeGreaterThanOrEqual(RESPIRO_HORIZONTAL);
    expect(Math.abs(folgas.cima - folgas.baixo), `${onde} texto fora do centro vertical: ${JSON.stringify(folgas)}`)
      .toBeLessThanOrEqual(2);
    expect(m.botao.height, `${onde} alvo de toque baixo: ${fmt(m.botao)}`).toBeGreaterThanOrEqual(44);
    // LEGÍVEL: no dourado, a legenda pequena precisa de contraste de texto (4,5:1) até no fundo mais
    // escuro do degradê, que é onde ela fica.
    if (!v.pronto) {
      const [r, g, b, a = 1] = (m.corDaLegenda.match(/[\d.]+/g) ?? []).map(Number);
      const efetiva = [r, g, b].map((c, k) => c * a + OURO_ESCURO[k] * (1 - a));
      expect(contraste(efetiva, OURO_ESCURO), `${onde} legenda ilegível no dourado: ${m.corDaLegenda}`).toBeGreaterThanOrEqual(4.5);
    }

    // 3 · DENTRO DA TELA, SEM INVADIR OS VIZINHOS, E O PLACAR NÃO ROLA.
    expect(insideViewport(m.botao as Box, vp, SUBPIXEL), `${onde} o botão saiu da tela: ${fmt(m.botao)}`).toBe(true);
    for (const [nome, viz] of Object.entries(m.vizinhos)) {
      if (!viz) continue;
      expect(intersects(m.botao as Box, viz as Box, SUBPIXEL), `${onde} o botão invade ${nome}: ${fmt(m.botao)} × ${fmt(viz as Box)}`).toBe(false);
    }
    expect(m.placarRola.y, `${onde} o placar entre mãos passou a rolar na vertical`).toBeLessThanOrEqual(SUBPIXEL);
    expect(m.placarRola.x, `${onde} o placar entre mãos passou a rolar na horizontal`).toBeLessThanOrEqual(SUBPIXEL);
    if (APARELHOS.has(ti.project.name) && !v.estresse) {
      expect(m.folga, `${onde} o placar entre mãos cabe por ${m.folga}px — abaixo do mínimo de ${FOLGA_MINIMA}px`)
        .toBeGreaterThanOrEqual(FOLGA_MINIMA);
    }

    const g = `botão ${Math.round(m.botao.width)}x${Math.round(m.botao.height)} · rodapé ${Math.round(m.rodape.height)}`;
    console.log(`  [${ti.project.name}] ${v.id}: ${g} · folga do placar ${m.folga}px`);
    if (!v.estresse) geometria.set(v.id, g);
  }

  // 4 · A MESMA CAIXA EM TODOS OS ESTADOS — é o que impede o rodapé de pular quando alguém toca.
  expect(new Set(geometria.values()).size, `[${ti.project.name}] a caixa muda com o estado: ${[...geometria].join(" | ")}`).toBe(1);
});
