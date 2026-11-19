/**
 * RECORDES & XP NO CLIENTE (Entrega D).
 *
 * O Top 3 Solo vive no aparelho e precisa estar CERTO (positivos, negativos, empates, uma partida =
 * um registro, partida de depuração fora); o Online é só leitura do banco e qualquer coisa estranha
 * vira "indisponível"; a tela mostra estados vazios honestos; a celebração diz posição e pontuação.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import {
  CHAVE_DO_SOLO, criarLeitorDeRecordes, dataBr, jaCelebrado, marcarCelebrado, ordemDoTop, registrarSolo, topSolo,
  type PortaDosRecordes,
} from "../auth/recordes.js";
import { MeusRecordes, NovoRecorde, comSinal } from "./Recordes.js";
import { KingGame } from "../game/kingGame.js";
import type { ProgressoDoJogador } from "../auth/progresso.js";

const noop = () => {};
class Armazenamento {
  dados = new Map<string, string>();
  getItem(k: string) { return this.dados.get(k) ?? null; }
  setItem(k: string, v: string) { this.dados.set(k, String(v)); }
  removeItem(k: string) { this.dados.delete(k); }
}
let armazenamento: Armazenamento;
beforeEach(() => { armazenamento = new Armazenamento(); (globalThis as { localStorage?: unknown }).localStorage = armazenamento; });
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

const dia = (n: number) => new Date(Date.UTC(2026, 10, n, 15)).toISOString();

describe("Top 3 SOLO, neste aparelho", () => {
  it("vazio antes do primeiro jogo", () => {
    expect(topSolo()).toEqual([]);
  });

  it("guarda só os 3 maiores, com positivos e NEGATIVOS, e devolve a posição de quem entrou", () => {
    expect(registrarSolo("a", -120, dia(1))).toBe(1);
    expect(registrarSolo("b", 35, dia(2))).toBe(1);
    expect(registrarSolo("c", -400, dia(3))).toBe(3);
    expect(registrarSolo("d", -500, dia(4))).toBeNull(); // não entra
    expect(registrarSolo("e", 0, dia(5))).toBe(2);
    expect(topSolo().map((r) => [r.id, r.pontos])).toEqual([["b", 35], ["e", 0], ["a", -120]]);
  });

  it("EMPATE: a conquista mais antiga fica na frente; a mais nova empatada entra logo atrás", () => {
    registrarSolo("velha", 210, dia(1));
    expect(registrarSolo("nova", 210, dia(9))).toBe(2);
    registrarSolo("meio", 300, dia(5));
    expect(topSolo().map((r) => r.id)).toEqual(["meio", "velha", "nova"]);
    // e a ordem é DETERMINÍSTICA até no mesmo instante: decide o id
    expect([{ id: "z", pontos: 5, em: dia(1) }, { id: "y", pontos: 5, em: dia(1) }].sort(ordemDoTop).map((r) => r.id)).toEqual(["y", "z"]);
  });

  it("UMA partida = UM registro: registrar de novo (Placar Final remontado) não duplica, nem depois de sair do Top 3", () => {
    expect(registrarSolo("p1", 100, dia(1))).toBe(1);
    expect(registrarSolo("p1", 100, dia(1))).toBeNull();
    for (const [id, p] of [["p2", 200], ["p3", 300], ["p4", 400]] as const) registrarSolo(id, p, dia(2));
    expect(topSolo().map((r) => r.id)).toEqual(["p4", "p3", "p2"]);
    expect(registrarSolo("p1", 100, dia(1))).toBeNull(); // já foi visto: não volta
    expect(topSolo()).toHaveLength(3);
  });

  it("armazenamento corrompido, de outra versão ou adulterado não quebra: vira vazio, e lixo de dentro é descartado", () => {
    armazenamento.setItem(CHAVE_DO_SOLO, "{lixo");
    expect(topSolo()).toEqual([]);
    armazenamento.setItem(CHAVE_DO_SOLO, JSON.stringify({ v: 2, top: [{ id: "x", pontos: 1, em: dia(1) }], vistos: [] }));
    expect(topSolo()).toEqual([]);
    armazenamento.setItem(CHAVE_DO_SOLO, JSON.stringify({ v: 1, vistos: [], top: [
      { id: "ok", pontos: 10, em: dia(1) }, { id: "fra", pontos: 1.5, em: dia(1) }, { id: "sem-data", pontos: 9 }, { id: "<b>", pontos: "9", em: dia(1) },
    ] }));
    expect(topSolo().map((r) => r.id)).toEqual(["ok"]);
    expect(registrarSolo("", 10, dia(1))).toBeNull();
    expect(registrarSolo("q", 1.5, dia(1))).toBeNull();
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => registrarSolo("r", 1, dia(1))).not.toThrow();
  });

  it("a partida local SÓ conta para recorde quando a Home pede — nunca a de teste, nem a que começou numa mão fixada", () => {
    expect(new KingGame(["A", "B", "C", "D"], 1).contaParaRecordes).toBe(false);
    expect(new KingGame(["A", "B", "C", "D"], 1, 0, 1, undefined, { recordes: true }).contaParaRecordes).toBe(true);
    expect(new KingGame(["A", "B", "C", "D"], 1, 0, 10, undefined, { recordes: true }).contaParaRecordes).toBe(false);
    const a = new KingGame(["A", "B", "C", "D"], 1), b = new KingGame(["A", "B", "C", "D"], 1);
    expect(a.idDaPartida).not.toBe(b.idDaPartida);
    // e a Home exclui a depuração pela URL (?seed= / ?mao=)
    const hook = readFileSync(new URL("../game/useKingGame.ts", import.meta.url), "utf8");
    expect(hook).toContain("{ recordes: seed === null && mao === null }");
  });
});

describe("a celebração: uma vez por resultado", () => {
  it("marcado, não volta; outro resultado celebra", () => {
    expect(jaCelebrado("x")).toBe(false);
    marcarCelebrado("x");
    expect(jaCelebrado("x")).toBe(true);
    expect(jaCelebrado("y")).toBe(false);
  });
});

describe("ONLINE: só leitura do banco, e qualquer coisa estranha vira indisponível", () => {
  const P = "33333333-3333-4333-8333-333333333333";
  const Q = "44444444-4444-4444-8444-444444444444";
  function porta(over: Partial<PortaDosRecordes> = {}) {
    const chamadas: string[] = [];
    const p: PortaDosRecordes = {
      topOnline: async () => { chamadas.push("top"); return { data: [{ partida_id: P, pontos: 120, terminada_em: dia(3) }, { partida_id: Q, pontos: -30, terminada_em: dia(1) }], error: null }; },
      recentes: async () => { chamadas.push("recentes"); return { data: [{ partida_id: Q, posicao: 4, xp_delta: 100, criado_em: dia(1) }], error: null }; },
      xpDoNivel: async (n) => { chamadas.push(`xp:${n}`); return { data: { xp: 1350 }, error: null }; },
      ...over,
    };
    return { p, chamadas };
  }

  it("sem sessão não pergunta nada", async () => {
    const { p, chamadas } = porta();
    const l = criarLeitorDeRecordes(async () => p, () => false);
    expect(await l.topOnline()).toBeNull();
    expect(await l.recentes()).toBeNull();
    expect(chamadas).toEqual([]);
  });

  it("lê o Top 3, as recentes e o XP do nível — na ordem do banco, sem inventar nada", async () => {
    const l = criarLeitorDeRecordes(async () => porta().p);
    expect(await l.topOnline()).toEqual([{ id: P, pontos: 120, em: dia(3) }, { id: Q, pontos: -30, em: dia(1) }]);
    expect(await l.recentes()).toEqual([{ id: Q, posicao: 4, xp: 100, em: dia(1) }]);
    expect(await l.xpDoNivel(7)).toBe(1350);
    expect(await criarLeitorDeRecordes(async () => porta({ topOnline: async () => ({ data: [], error: null }) }).p).topOnline()).toEqual([]);
  });

  it("tabela ausente, erro, exceção, linha estranha ou nível fora da curva → null (indisponível), nunca lança", async () => {
    const casos: Partial<PortaDosRecordes>[] = [
      { topOnline: async () => ({ data: null, error: { code: "42P01" } }) },
      { topOnline: async () => { throw new Error("rede"); } },
      { topOnline: async () => ({ data: [{ partida_id: "x", pontos: 1, terminada_em: dia(1) }], error: null }) },
      { topOnline: async () => ({ data: [{ partida_id: P, pontos: "9", terminada_em: dia(1) }], error: null }) },
    ];
    for (const c of casos) expect(await criarLeitorDeRecordes(async () => porta(c).p).topOnline()).toBeNull();
    expect(await criarLeitorDeRecordes(async () => porta({ recentes: async () => ({ data: [{ partida_id: Q, posicao: 9, xp_delta: 1, criado_em: dia(1) }], error: null }) }).p).recentes()).toBeNull();
    const { p, chamadas } = porta();
    expect(await criarLeitorDeRecordes(async () => p).xpDoNivel(0)).toBeNull();
    expect(await criarLeitorDeRecordes(async () => p).xpDoNivel(101)).toBeNull();
    expect(chamadas).toEqual([]);
    expect(await criarLeitorDeRecordes(async () => null).topOnline()).toBeNull();
  });

  it("a porta real só LÊ (placares_online, xp_eventos, xp_por_nivel), em ordem determinística — sem RPC, sem escrita", () => {
    const t = readFileSync(new URL("../auth/recordes.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(t).toContain('c.from("placares_online").select("partida_id, pontos, terminada_em")');
    expect(t).toContain('.order("pontos", { ascending: false }).order("terminada_em", { ascending: true }).order("partida_id", { ascending: true })');
    expect(t).toContain('c.from("xp_eventos").select("partida_id, posicao, xp_delta, criado_em")');
    expect(t).toContain('c.from("xp_por_nivel").select("xp").eq("nivel", nivel)');
    expect(t).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
  });
});

describe("a TELA Meus Recordes", () => {
  const progresso: ProgressoDoJogador = { xpTotal: 1500, nivel: 7, xpNoNivel: 150, xpDoNivel: 400,
    sequencia: { atual: 2, recorde: 6, hoje: true, partida: null } };
  const tela = (p: ProgressoDoJogador | null, comLeitor = true) => parse(renderToStaticMarkup(
    <MeusRecordes progresso={p} leitor={comLeitor ? criarLeitorDeRecordes(async () => null) : null} onFechar={noop} />));

  it("MINHA EVOLUÇÃO com os números do banco: nível, XP total, XP do nível, quanto falta, recorde de sequência", () => {
    const r = tela(progresso);
    expect(r.querySelector(".rec-nivel b")!.text).toBe("7");
    expect(r.querySelector(".rec-total")!.text).toBe("1.500 XP no total");
    expect(r.querySelector(".rec-evolucao")!.text).toContain("150 / 400 XP neste nível");
    expect(r.querySelector(".rec-evolucao")!.text).toContain("faltam 250 XP para o nível 8");
    expect(r.querySelector(".rec-evolucao [role=progressbar]")!.getAttribute("aria-valuenow")).toBe("150");
    expect(r.querySelector(".rec-evolucao")!.text).toContain("Recorde de sequência: 6 dias");
  });

  it("PRÓXIMO DESBLOQUEIO: o item seguinte da curva, com a amostra da vitrine; no topo da curva, tudo liberado", () => {
    const r = tela(progresso);
    expect(r.querySelector(".rec-item-txt b")!.text).toBe("Mesa Azul Royal".replace("Mesa ", ""));
    expect(r.querySelector(".rec-item-txt")!.text).toContain("no nível 8");
    expect(r.querySelector(".rec-item .tema-amostra")!.getAttribute("data-tema")).toBe("azul");
    expect(tela({ ...progresso, nivel: 18 }).querySelector(".rec-proximo")!.text).toContain("Todos os itens da Coroa desbloqueados");
  });

  it("TOP 3: vazio honesto antes do 1º jogo; com recordes, ouro/prata/bronze, sinal, data brasileira e modalidade", () => {
    expect(tela(null).querySelector(".rec-recordes .rec-vazio")!.text).toContain("Nenhum recorde solo ainda");
    registrarSolo("a", 320, dia(10));
    registrarSolo("b", -45, dia(12));
    const r = tela(null);
    const linhas = r.querySelectorAll(".rec-top .rec-linha");
    expect(linhas.map((l) => l.classList.contains("ouro") || l.classList.contains("prata") || l.classList.contains("bronze"))).toEqual([true, true, true]);
    expect(linhas.map((l) => l.querySelector(".rec-pontos")?.text ?? "")).toEqual(["+320 pts", "−45 pts", ""]);
    expect(linhas[0].querySelector(".rec-meta")!.text).toBe(`${dataBr(dia(10))} · Solo`);
    expect(dataBr(dia(10))).toBe("10/11/2026");
    expect(r.querySelector(".rec-nota")!.text).toContain("deste aparelho");
    // sem conta: nada de evolução inventada, e o online explica como começar
    expect(r.querySelector(".rec-evolucao .rec-vazio")!.text).toContain("partidas online");
    expect(r.querySelector(".rec-proximo")).toBeNull();
    expect(r.querySelector(".rec-historico")).toBeNull();
  });

  it("as abas Solo/Online são uma lista de abas acessível, e a tela não promete ranking verificado no solo", () => {
    const r = tela(progresso);
    expect(r.querySelectorAll("[role=tab]").map((t) => [t.text, t.getAttribute("aria-selected")])).toEqual([["Solo", "true"], ["Online", "false"]]);
    expect(r.toString()).not.toMatch(/mundial|global|liga|temporada|verificado/i);
  });
});

describe("NOVO RECORDE!", () => {
  it("diz a posição no Top 3, a modalidade e a pontuação com sinal; fecha com um toque", () => {
    const r = parse(renderToStaticMarkup(<NovoRecorde recorde={{ id: "x", posicao: 2, pontos: -35, modo: "online" }} onFechar={noop} />));
    expect(r.querySelector(".nr-titulo")!.text).toBe("NOVO RECORDE!");
    expect(r.querySelector(".nr-posicao")!.text).toBe("2º do seu Top 3 · Online");
    expect(r.querySelector(".nr-pontos")!.text).toBe("−35 pts");
    expect(r.querySelector(".nr-cartao")!.classList.contains("prata")).toBe(true);
    expect(r.querySelector(".nr-toque")!.text).toBe("toque para fechar");
    expect(comSinal(1250)).toBe("+1.250");
    expect(comSinal(0)).toBe("0");
  });

  it("não toca som nem vibra (o Placar Final já tocou o dele) e respeita movimento reduzido", () => {
    const fonte = readFileSync(new URL("./Recordes.tsx", import.meta.url), "utf8");
    expect(fonte).not.toMatch(/sfx(?!Tap)[A-Z]\w*\(|vibrate|haptic/);
    const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\{ \.novorecorde,\.novorecorde\.saindo,\.nr-cartao,\.nr-coroa,\.nr-brilho\{animation:none;\}/);
  });
});
