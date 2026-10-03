/**
 * A WEB NOVA CONTRA O BANCO DE HOJE — sem a migração da sequência, como a Production está agora.
 *
 * É a ordem "web antes da migração" do rollout. O stack sobe só com as migrações de identidade e
 * progresso (`KING_E2E_SEM_SEQUENCIA`, ver `playwright.sequencia-compat.config.ts`). Uma partida
 * online INTEIRA, de verdade:
 *   · a web pede `meu_progresso` com `select=*` e recebe 200 com as 5 colunas antigas;
 *   · o Placar real mostra "+N XP" (o N do banco) e NENHUMA linha de sequência;
 *   · a Home mostra o card de XP exatamente como antes: sem pilha lateral, sem convite, sem zero.
 */
import { test, expect } from "@playwright/test";
import { banco, comecarPartida, contexto, idDaSessao, jogarAteOFim, placarCompleto } from "./ajudantes.js";

test("web nova + banco SEM a migração: XP no Placar e na Home como antes, nenhuma sequência, nenhum erro", async ({ browser }) => {
  const db = await banco();
  const respostas: string[] = [];
  const ctxA = await contexto(browser, respostas);
  const ctxB = await contexto(browser, respostas);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errosA: string[] = [];
  a.on("pageerror", (e) => errosA.push(String(e)));
  try {
    const colunas = (await db.query("select column_name from information_schema.columns where table_schema = 'public' " +
      "and table_name = 'meu_progresso' order by ordinal_position")).rows.map((r) => r.column_name).join(",");
    expect(colunas, "o banco desta prova é o de hoje, sem a sequência").toBe("player_id,xp_total,nivel,xp_no_nivel,xp_do_nivel");

    await comecarPartida(a, b, ["Tito", "Raiza"]);
    const idA = await idDaSessao(a);
    await jogarAteOFim([{ nome: "A", page: a }, { nome: "B", page: b }]);
    await placarCompleto(a);
    await expect(a.locator(".fimxp")).toBeVisible({ timeout: 30_000 });
    const xp = (await db.query("select xp_delta from public.xp_eventos where player_id = $1", [idA])).rows[0].xp_delta as number;
    expect(xp).toBeGreaterThan(0);
    await expect(a.locator(".fimxp-ganho")).toHaveText(`+${xp} XP`);
    await expect(a.locator(".fimxp-seq"), "sem a migração, nenhuma linha de sequência no Placar").toHaveCount(0);

    await a.locator(".fimacoes").getByRole("button", { name: "Home" }).click();
    await expect(a.locator(".hm-progresso")).toBeVisible({ timeout: 20_000 });
    await expect(a.locator(".hm-progresso .pg-total")).toHaveText(`${xp} XP total`);
    await expect(a.locator(".hm-progresso .pg-lado, .hm-progresso .pg-seq, .hm-progresso .pg-recorde"),
      "sem a migração, o card é o de antes").toHaveCount(0);

    const leituras = respostas.filter((r) => r.startsWith("GET /rest/v1/meu_progresso"));
    expect(leituras.length, "a Home leu o progresso").toBeGreaterThan(0);
    for (const r of leituras) expect(r, "a leitura pede select=* e o banco antigo responde 200").toMatch(/select=\*.* → 200$/);
    expect(errosA, "nenhum erro de página").toEqual([]);
  } finally {
    await ctxA.close();
    await ctxB.close();
    await db.end();
  }
});
