/**
 * A SEQUÊNCIA NUMA PARTIDA ONLINE DE VERDADE — fecha a lacuna da 6A, em que o Placar online só
 * tinha sido medido injetando o bloco numa partida local.
 *
 * Duas pessoas, dois navegadores, dois bots, o servidor do jogo compilado e o Postgres com as
 * migrações reais (stack em `stack.ts`). Nada é injetado na tela: o XP e a sequência que aparecem
 * vêm do crédito que o servidor gravou e da leitura que a web faz.
 *
 *   PARTIDA 1 — inteira, com uma RECONEXÃO no meio (reload de B depois da 2ª mão):
 *     · o crédito é UM por jogador (a reconexão não duplica);
 *     · o Placar real mostra "+N XP" (o mesmo N do banco) e "🔥 Sequência: 1 dia" — 1ª qualificação;
 *     · REFRESH no Placar: volta à sala, o mesmo "1 dia", e o banco não muda;
 *     · Home: "🔥 Sequência 1 dia", em ouro (o dia de hoje já conta).
 *   PARTIDA 2 — no MESMO dia, sala nova, as mesmas duas identidades:
 *     · XP de novo, mas NENHUMA linha de sequência no Placar (o dia já tinha sido qualificado);
 *     · o banco continua 1/1, com a partida 1 como a que qualificou o dia.
 *
 * Capturas e geometria do Placar e da Home em 667×375, 740×360, 852×393 e 1600×900.
 */
import { test, expect, type Page } from "@playwright/test";
import type pg from "pg";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { insideViewport, type Box } from "../tests/helpers/geometry.js";
import { banco, comecarPartida, contexto, idDaSessao, jogarAteOFim, placarCompleto } from "./ajudantes.js";

const VIEWPORTS = [
  { width: 667, height: 375 },
  { width: 740, height: 360 },
  { width: 852, height: 393 },
  { width: 1600, height: 900 },
] as const;

/** O que o banco diz, em texto simples (datas como AAAA-MM-DD). */
async function retrato(c: pg.Client) {
  const partidas = (await c.query("select id from king_private.partidas order by registrada_em")).rows.map((r) => r.id as string);
  const eventos = (await c.query("select player_id, partida_id, xp_delta from public.xp_eventos order by id")).rows as
    { player_id: string; partida_id: string; xp_delta: number }[];
  const progresso = (await c.query("select player_id, xp_total, sequencia_atual as atual, sequencia_recorde as recorde, " +
    "sequencia_ultimo_dia::text as dia, sequencia_partida as partida from public.progresso order by player_id")).rows as
    { player_id: string; xp_total: number; atual: number; recorde: number; dia: string | null; partida: string | null }[];
  const hojeSP = (await c.query("select public.dia_de_sao_paulo(now())::text as d")).rows[0].d as string;
  return { partidas, eventos, progresso, hojeSP };
}

async function semAnimacao(page: Page, sel: string): Promise<void> {
  await expect(async () => {
    const correndo = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 0;
      return el.getAnimations({ subtree: true }).filter((a) => a.playState === "running"
        && a.effect?.getComputedTiming().iterations !== Infinity).length;
    }, sel);
    expect(correndo).toBe(0);
  }).toPass({ timeout: 15_000 });
}

async function caixa(page: Page, sel: string): Promise<Box> {
  const b = await page.locator(sel).first().boundingBox();
  if (!b) throw new Error(`sem caixa: ${sel}`);
  return b;
}

/** Geometria + captura do Placar real num viewport. */
async function medirPlacar(page: Page, vp: { width: number; height: number }, rotulo: string, comSequencia: boolean, pasta: string) {
  await page.setViewportSize(vp);
  await page.waitForTimeout(400);
  await semAnimacao(page, ".fim");
  const sels = [".fimxp", ".fimxp-ganho", ".fimacoes", ...(comSequencia ? [".fimxp-seq"] : [])];
  for (const sel of sels) {
    expect(insideViewport(await caixa(page, sel), vp, 1), `${rotulo}: ${sel} fora da tela em ${vp.width}×${vp.height}`).toBe(true);
  }
  if (comSequencia) {
    const dados = await caixa(page, ".fimdados");
    const seq = await caixa(page, ".fimxp-seq");
    expect(seq.x + seq.width, `${rotulo}: a sequência sai pela direita da coluna`).toBeLessThanOrEqual(dados.x + dados.width + 1);
  }
  const transbordo = await page.locator(".fimdados").evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(transbordo, `${rotulo}: a coluna de resultado transborda ${transbordo}px`).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${rotulo}: rolagem lateral`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: join(pasta, `${rotulo}-${vp.width}x${vp.height}.png`) });
}

/** Geometria + captura da Home real num viewport, com o card do jogador. */
async function medirHome(page: Page, vp: { width: number; height: number }, rotulo: string, pasta: string) {
  await page.setViewportSize(vp);
  await page.waitForTimeout(400);
  await semAnimacao(page, ".home");
  const card = await caixa(page, ".hm-progresso");
  expect(insideViewport(card, vp, 1), `${rotulo}: card fora da tela em ${vp.width}×${vp.height}`).toBe(true);
  for (const sel of [".pg-seq"]) {
    const b = await caixa(page, sel);
    expect(b.x + b.width, `${rotulo}: ${sel} sai do card`).toBeLessThanOrEqual(card.x + card.width + 1);
  }
  expect(await page.locator(".hm-progresso").evaluate((el) => el.scrollWidth - el.clientWidth), `${rotulo}: conteúdo vaza do card`).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${rotulo}: rolagem lateral`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: join(pasta, `${rotulo}-${vp.width}x${vp.height}.png`) });
}

test("online de verdade: XP e sequência no Placar e na Home; reconexão e refresh não duplicam; 2ª partida do dia não finge avanço", async ({ browser }, ti) => {
  const pasta = process.env.KING_SHOTS ?? ti.outputPath("capturas");
  mkdirSync(pasta, { recursive: true });
  const db = await banco();
  const ctxA = await contexto(browser);
  const ctxB = await contexto(browser);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  try {
    // ═════════ PARTIDA 1 — com reconexão de B depois da 2ª mão ═════════
    await comecarPartida(a, b, ["Tito", "Raiza"]);
    const idA = await idDaSessao(a);
    const idB = await idDaSessao(b);
    expect(idA && idB && idA !== idB, "cada navegador deveria ter o próprio convidado anônimo").toBeTruthy();

    let reconectou = false;
    await jogarAteOFim([{ nome: "A", page: a }, { nome: "B", page: b }], async (nome, mao) => {
      if (nome !== "B" || mao !== 2 || reconectou) return;
      reconectou = true;
      await b.reload();
      await b.getByRole("button", { name: "Jogar com amigos" }).click();
      await b.getByRole("button", { name: /voltar para a minha sala/i }).click();
      await expect(b.locator(".mesa")).toBeVisible({ timeout: 30_000 });
    });
    expect(reconectou, "a reconexão no meio da partida não aconteceu").toBe(true);

    await placarCompleto(a);
    await placarCompleto(b);
    await expect(a.locator(".fimxp")).toBeVisible({ timeout: 30_000 });
    await expect(b.locator(".fimxp")).toBeVisible({ timeout: 30_000 });

    const r1 = await retrato(db);
    expect(r1.partidas, "uma partida creditada").toHaveLength(1);
    const p1 = r1.partidas[0];
    const ev1 = r1.eventos.filter((e) => e.partida_id === p1);
    expect(ev1.map((e) => e.player_id).sort(), "UM lançamento por humano — a reconexão não duplicou").toEqual([idA, idB].sort());
    for (const e of ev1) expect(e.xp_delta, "XP positivo para quem jogou a partida inteira").toBeGreaterThan(0);
    for (const id of [idA, idB]) {
      const g = r1.progresso.find((p) => p.player_id === id)!;
      expect({ atual: g.atual, recorde: g.recorde, dia: g.dia, partida: g.partida }, `sequência de ${id === idA ? "A" : "B"} depois da 1ª partida`)
        .toEqual({ atual: 1, recorde: 1, dia: r1.hojeSP, partida: p1 });
    }
    // o Placar mostra o MESMO XP do banco, e a 1ª qualificação do dia
    for (const [page, id] of [[a, idA], [b, idB]] as const) {
      const xp = ev1.find((e) => e.player_id === id)!.xp_delta;
      await expect(page.locator(".fimxp-ganho")).toHaveText(`+${xp} XP`);
      await expect(page.locator(".fimxp-seq")).toHaveText("🔥 Sequência: 1 dia");
    }
    for (const vp of VIEWPORTS) await medirPlacar(a, vp, "placar-online-partida1", true, pasta);
    await a.setViewportSize({ width: 852, height: 393 });

    // ═════════ REFRESH no Placar Final (A): volta à sala, mesmo número, banco igual ═════════
    await a.reload();
    await expect(a.locator(".hm-progresso .pg-seq")).toHaveText("🔥 Sequência 1 dia", { timeout: 20_000 });
    await a.getByRole("button", { name: "Jogar com amigos" }).click();
    await a.getByRole("button", { name: /voltar para a minha sala/i }).click();
    await placarCompleto(a);
    await expect(a.locator(".fimxp-seq")).toHaveText("🔥 Sequência: 1 dia", { timeout: 30_000 });
    const r1b = await retrato(db);
    expect(r1b.eventos, "o refresh no Placar mexeu no ledger").toEqual(r1.eventos);
    expect(r1b.progresso, "o refresh no Placar mexeu na sequência").toEqual(r1.progresso);

    // ═════════ HOME: a sequência no card, em ouro ═════════
    await a.locator(".fimacoes").getByRole("button", { name: "Home" }).click();
    await b.locator(".fimacoes").getByRole("button", { name: "Home" }).click();
    for (const page of [a, b]) {
      await expect(page.locator(".hm-progresso .pg-seq")).toHaveText("🔥 Sequência 1 dia", { timeout: 20_000 });
      await expect(page.locator(".hm-progresso .pg-seq")).toHaveClass(/\bhoje\b/);
      await expect(page.locator(".hm-progresso .pg-recorde")).toHaveCount(0);
    }
    for (const vp of VIEWPORTS) await medirHome(a, vp, "home-online-depois-da-partida1", pasta);
    await a.setViewportSize({ width: 852, height: 393 });

    // ═════════ PARTIDA 2 — MESMO dia, sala nova, mesmas identidades ═════════
    await comecarPartida(a, b, ["Tito", "Raiza"]);
    expect(await idDaSessao(a)).toBe(idA);
    expect(await idDaSessao(b)).toBe(idB);
    await jogarAteOFim([{ nome: "A", page: a }, { nome: "B", page: b }]);
    await placarCompleto(a);
    await placarCompleto(b);
    await expect(a.locator(".fimxp")).toBeVisible({ timeout: 30_000 });
    await expect(b.locator(".fimxp")).toBeVisible({ timeout: 30_000 });
    const r2 = await retrato(db);
    expect(r2.partidas, "duas partidas creditadas").toHaveLength(2);
    const p2 = r2.partidas[1];
    const ev2 = r2.eventos.filter((e) => e.partida_id === p2);
    expect(ev2.map((e) => e.player_id).sort()).toEqual([idA, idB].sort());
    for (const [page, id] of [[a, idA], [b, idB]] as const) {
      const xp = ev2.find((e) => e.player_id === id)!.xp_delta;
      expect(xp, "a 2ª partida do dia rende XP normalmente").toBeGreaterThan(0);
      await expect(page.locator(".fimxp-ganho")).toHaveText(`+${xp} XP`);
      await expect(page.locator(".fimxp-seq"), "a 2ª partida do dia NÃO pode fingir avanço").toHaveCount(0);
      const g = r2.progresso.find((p) => p.player_id === id)!;
      expect({ atual: g.atual, recorde: g.recorde, partida: g.partida }, "o dia continua qualificado pela 1ª partida")
        .toEqual({ atual: 1, recorde: 1, partida: p1 });
      expect(g.xp_total, "XP total = soma do ledger").toBe(r2.eventos.filter((e) => e.player_id === id).reduce((s, e) => s + e.xp_delta, 0));
    }
    for (const vp of VIEWPORTS) await medirPlacar(a, vp, "placar-online-partida2-mesmo-dia", false, pasta);
    await a.setViewportSize({ width: 852, height: 393 });
    await a.locator(".fimacoes").getByRole("button", { name: "Home" }).click();
    await expect(a.locator(".hm-progresso .pg-seq")).toHaveText("🔥 Sequência 1 dia", { timeout: 20_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
    await db.end();
  }
});
