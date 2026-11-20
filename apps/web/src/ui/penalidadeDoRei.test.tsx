// PENALIDADE DO REI (Entrega C) — o que o Placar Final ONLINE mostra do XP, e de onde vem.
//
// Só o que o BANCO confirmou: o "+N XP" é o crédito do ledger; a conta (bruto, Rei de Copas, redução
// diária) é a composição gravada na mesma instrução, e só aparece se bater com o crédito. Sem ela —
// regra 1, banco sem a migração, leitura falhou — a tela é exatamente a de antes. Solo: nada de XP.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({ auth: {}, from: vi.fn() })) }));

import { criarLeitorDeProgresso, lerComposicao, type ComposicaoDoXp, type PortaDeProgresso } from "../auth/progresso.js";
import { XpNoFim, contaDoXp } from "./Progresso.js";

const PARTIDA = "33333333-3333-4333-8333-333333333333";
const P = { xpTotal: 370, nivel: 3, xpNoNivel: 120, xpDoNivel: 200 };
const COM_REI = { xp_bruto: 150, penalidade_rei: 60, reducao_diaria: 0, xp_liquido: 90, versao_regra: 2, partida_id: PARTIDA, player_id: "x", motivo: "partida_concluida" };

function porta(credito: { xp_delta: number; posicao: number } | null, composicao?: () => ReturnType<NonNullable<PortaDeProgresso["composicaoDaPartida"]>>) {
  const consultas: string[] = [];
  const p: PortaDeProgresso = {
    async meuProgresso() { return { data: null, error: null }; },
    async creditoDaPartida() { consultas.push("credito"); return { data: credito, error: null }; },
    ...(composicao ? { composicaoDaPartida: (id: string) => { consultas.push(`composicao:${id.slice(0, 8)}`); return composicao(); } } : {}),
  };
  return { p, consultas };
}

describe("a leitura: a composição só passa INTEIRA e coerente com o crédito", () => {
  it("regra 2 com captura: crédito 90 e a conta do banco", async () => {
    const { p, consultas } = porta({ xp_delta: 90, posicao: 1 }, async () => ({ data: COM_REI, error: null }));
    const l = criarLeitorDeProgresso(async () => p);
    expect(await l.creditoDaPartida(PARTIDA)).toEqual({ xpDelta: 90, posicao: 1, composicao: { bruto: 150, penalidadeRei: 60, reducaoDiaria: 0, liquido: 90 } });
    expect(consultas).toEqual(["credito", "composicao:33333333"]);
  });

  it("BANCO SEM A MIGRAÇÃO (tabela inexistente), erro ou exceção: o crédito confirmado segue, sem conta", async () => {
    for (const composicao of [
      async () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } }),
      async () => ({ data: null, error: null }), // partida da regra 1: não há linha
      async () => { throw new Error("rede"); },
    ]) {
      const { p } = porta({ xp_delta: 150, posicao: 1 }, composicao);
      expect(await criarLeitorDeProgresso(async () => p).creditoDaPartida(PARTIDA)).toEqual({ xpDelta: 150, posicao: 1 });
    }
    // a porta antiga (sem o método): idem
    const { p } = porta({ xp_delta: 150, posicao: 1 });
    expect(await criarLeitorDeProgresso(async () => p).creditoDaPartida(PARTIDA)).toEqual({ xpDelta: 150, posicao: 1 });
  });

  it("sem crédito confirmado não se lê composição nenhuma", async () => {
    const { p, consultas } = porta(null, async () => ({ data: COM_REI, error: null }));
    expect(await criarLeitorDeProgresso(async () => p).creditoDaPartida(PARTIDA)).toBeNull();
    expect(consultas).toEqual(["credito"]);
  });

  it.each([
    ["líquido diferente do crédito", { ...COM_REI, xp_liquido: 91 }, 90],
    ["soma que não fecha", { ...COM_REI, reducao_diaria: 5 }, 90],
    ["penalidade fora da regra", { ...COM_REI, penalidade_rei: 30, xp_liquido: 120 }, 120],
    ["negativo", { ...COM_REI, xp_bruto: -150 }, 90],
    ["texto", { ...COM_REI, xp_bruto: "150" }, 90],
    ["fração", { ...COM_REI, reducao_diaria: 0.5 }, 90],
  ])("dado estranho (%s) não vira conta", (_n, linha, delta) => {
    expect(lerComposicao(linha as never, delta)).toBeNull();
  });
});

const xpCom = (xpDelta: number, composicao?: ComposicaoDoXp) => ({ credito: { xpDelta, posicao: 1, ...(composicao ? { composicao } : {}) }, progresso: P });

describe("o Placar Final online: a conta aparece só quando há o que explicar", () => {
  it("1º com o Rei: '+90 XP', o bruto riscado e '−60 Rei de Copas' — sem redução, sem a palavra", () => {
    const r = parse(renderToStaticMarkup(<XpNoFim xp={xpCom(90, { bruto: 150, penalidadeRei: 60, reducaoDiaria: 0, liquido: 90 })} matchId={PARTIDA} />));
    expect(r.querySelector(".fimxp-ganho")!.text).toBe("+90 XP");
    expect(r.querySelector(".fimxp-bruto")!.text).toBe("150");
    expect(r.querySelector(".fimxp-rei")!.text).toBe("−60 Rei de Copas");
    expect(r.querySelector(".fimxp-diaria")).toBeNull();
    expect(r.querySelector(".fimxp")!.getAttribute("aria-label")).toBe("Você ganhou 90 XP nesta partida (150 XP da partida, menos 60 pelo Rei de Copas)");
  });

  it("7ª do dia com o Rei: penalidade E redução, na ordem da regra (22 = (150 − 60) ÷ 4)", () => {
    const r = parse(renderToStaticMarkup(<XpNoFim xp={xpCom(22, { bruto: 150, penalidadeRei: 60, reducaoDiaria: 68, liquido: 22 })} />));
    expect(r.querySelector(".fimxp-ganho")!.text).toBe("+22 XP");
    expect(r.querySelector(".fimxp-conta")!.text).toBe("150−60 Rei de Copas−68 redução diária");
    expect(r.querySelector(".fimxp")!.getAttribute("aria-label")).toContain("menos 60 pelo Rei de Copas, menos 68 de redução diária");
  });

  it("só redução diária (sem o Rei): a conta mostra a redução e nada do Rei", () => {
    const r = parse(renderToStaticMarkup(<XpNoFim xp={xpCom(37, { bruto: 150, penalidadeRei: 0, reducaoDiaria: 113, liquido: 37 })} />));
    expect(r.querySelector(".fimxp-rei")).toBeNull();
    expect(r.querySelector(".fimxp-diaria")!.text).toBe("−113 redução diária");
  });

  it("sem penalidade nem redução, ou SEM composição (regra 1 / banco antigo): exatamente o bloco de antes", () => {
    const antes = renderToStaticMarkup(<XpNoFim xp={xpCom(150)} matchId={PARTIDA} />);
    expect(renderToStaticMarkup(<XpNoFim xp={xpCom(150, { bruto: 150, penalidadeRei: 0, reducaoDiaria: 0, liquido: 150 })} matchId={PARTIDA} />)).toBe(antes);
    expect(parse(antes).querySelector(".fimxp-conta")).toBeNull();
    expect(contaDoXp(undefined)).toBeNull();
  });

  it("tom de informação, não de castigo: nada de 'perdeu', 'castigo', 'punição' ou vermelho", () => {
    const html = renderToStaticMarkup(<XpNoFim xp={xpCom(22, { bruto: 150, penalidadeRei: 60, reducaoDiaria: 68, liquido: 22 })} />);
    expect(html).not.toMatch(/perdeu|castigo|puni|vergonha|multa/i);
    // as regras da conta usam só a cor discreta do tema: nada de cor de alerta
    const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
    const regras = css.match(/.fimxp-(conta|bruto|rei|diaria)[^{]*{[^}]*}/g) ?? [];
    expect(regras.length).toBeGreaterThanOrEqual(3);
    for (const r of regras) {
      for (const cor of r.match(/color:[^;]+/g) ?? []) expect(cor).toBe("color:var(--muted)");
    }
  });
});
