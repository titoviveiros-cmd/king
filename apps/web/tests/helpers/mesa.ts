/**
 * Abre a Mesa no cenário mais exigente e expõe leitores de caixa do DOM real.
 *
 * NÃO replica regra do jogo: dirige a aplicação de verdade (motor real via `?seed=N`) e apenas
 * espera o estado. Como `startDealer = 0` no motor, a mão 1 é sempre aberta pelo assento 1, então
 * a ordem de jogada é 1→2→3→0 e o **humano (assento 0) joga por último na 1ª vaza**. No momento
 * em que é a vez dele temos, de forma determinística e independente da semente:
 *   • 13 cartas no leque (o humano ainda não jogou);
 *   • 3 cartas na vaza (os 3 bots já jogaram) — vaza cheia o suficiente para testar a geometria;
 *   • HUD, 3 adversários, card do jogador local e controles do topo visíveis.
 */
import { expect, type Page, type Locator } from "@playwright/test";
import type { Box } from "./geometry.js";

/** Semente fixa: partida reproduzível (o motor é determinístico). */
export const SEED = 42;

/** Seletores estáveis da Mesa (classes congeladas do Design System). */
export const SEL = {
  mesa: ".mesa",
  hud: ".hud",
  topbtn: ".topbtn",
  trumpslot: ".trumpslot",
  oppTop: ".opp.top",
  oppLeft: ".opp.left",
  oppRight: ".opp.right",
  youtag: ".youtag",
  youtagActive: ".youtag.active",
  trickCard: ".trick .card",
  handCard: ".hand .card",
  handCardLegal: '.hand .card[role="button"]',
  handCardSelected: ".hand .card.sel",
  cardIdx: ".idx",
  keyhint: ".keyhint",
  startBtn: ".home .btn.gold",
} as const;

/**
 * Vai para a Home, começa a partida com a semente fixa e espera o cenário de máxima pressão
 * (13 no leque + 3 na vaza + é a vez do humano). Retorna quando o DOM está estável para medir.
 */
export async function openMesaStress(page: Page, seed: number = SEED): Promise<void> {
  await page.addInitScript(() => {
    try {
      // Silencia o áudio (evita nós de Web Audio no headless). Não muda geometria.
      window.localStorage.setItem(
        "king.audio",
        JSON.stringify({ music: false, sfx: false, haptics: false, musicVol: 0, sfxVol: 0 }),
      );
      // E declara o tutorial como JÁ VISTO.
      //
      // Sem isto, o APRENDA KING abre sozinho na primeira visita — que é o comportamento certo
      // do produto e foi o que reprovou esta suíte inteira quando ele entrou: não havia mais
      // Home nem botão "Jogar agora" para clicar. Aqui se mede a geometria da MESA do jogo;
      // a do tutorial tem suíte própria em tutorial.spec.ts.
      window.localStorage.setItem(
        "king:tutorial",
        JSON.stringify({ iniciado: true, concluido: true, passo: 0 }),
      );
    } catch { /* headless sem storage: segue */ }
  });

  await page.goto(`/?seed=${seed}`);
  await page.locator(SEL.startBtn).click();

  // Espera a vez do humano na 1ª vaza: leque com 13 e vaza com 3 (estado determinístico).
  await expect(page.locator(SEL.youtagActive)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(SEL.handCard)).toHaveCount(13, { timeout: 20_000 });
  await expect(page.locator(SEL.trickCard)).toHaveCount(3, { timeout: 20_000 });
}

/** Caixa de um único elemento (falha explicitamente se ausente/invisível). */
export async function boxOf(loc: Locator, name: string): Promise<Box> {
  const b = await loc.boundingBox();
  if (!b) throw new Error(`Elemento ausente ou sem caixa: ${name}`);
  return b;
}

/** Caixas de todos os elementos que casam com o locator, na ordem do DOM. */
export async function boxesOf(page: Page, selector: string): Promise<Box[]> {
  const loc = page.locator(selector);
  const n = await loc.count();
  const out: Box[] = [];
  for (let i = 0; i < n; i++) {
    const b = await loc.nth(i).boundingBox();
    if (b) out.push(b);
  }
  return out;
}

export interface ReachResult {
  reachable: boolean;
  hit: string; // tag/classe do elemento efetivamente no ponto (diagnóstico)
  point: { x: number; y: number };
}

/**
 * Uma carta do leque é "alcançável" se, em algum ponto dentro dela, o elemento de topo
 * (`elementFromPoint`) é a própria carta ou um descendente. Varre alguns pontos porque o leque
 * usa **sobreposição intencional**: a faixa exposta de cada carta (índice/canto) é o que precisa
 * estar clicável — não o centro. Uma carta soterrada por um OVERLAY falha em todos os pontos.
 */
export async function cardReachable(page: Page, index: number): Promise<ReachResult> {
  return page.evaluate(({ sel, idx }) => {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(sel));
    const el = cards[idx];
    if (!el) return { reachable: false, hit: "carta inexistente", point: { x: 0, y: 0 } };
    const r = el.getBoundingClientRect();
    // pontos candidatos: faixa esquerda (índice exposto) + centro + canto superior
    const fracs: Array<[number, number]> = [
      [0.16, 0.18], [0.12, 0.5], [0.5, 0.5], [0.85, 0.5], [0.16, 0.82],
    ];
    let last = { tag: "nada", x: 0, y: 0 };
    for (const [fx, fy] of fracs) {
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      const top = document.elementFromPoint(x, y);
      last = { tag: top ? top.tagName + "." + (top.className || "") : "nada", x, y };
      if (top && (top === el || el.contains(top))) {
        return { reachable: true, hit: last.tag, point: { x, y } };
      }
    }
    return { reachable: false, hit: last.tag, point: { x: last.x, y: last.y } };
  }, { sel: SEL.handCard, idx: index });
}

/** Overflow horizontal da aplicação inteira (barra de rolagem lateral = bug de layout). */
export async function horizontalOverflow(page: Page): Promise<{ overflow: boolean; scrollW: number; clientW: number }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return { overflow: doc.scrollWidth > doc.clientWidth + 1, scrollW: doc.scrollWidth, clientW: doc.clientWidth };
  });
}

/** Caixa do sub-elemento `.idx` (o canto identificador) de uma carta do leque. */
export async function idxBoxes(page: Page): Promise<Box[]> {
  return boxesOf(page, `${SEL.handCard} ${SEL.cardIdx}`);
}
