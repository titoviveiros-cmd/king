// O XP DO FIM DA PARTIDA — tentativas curtas e limitadas, nenhuma mentira de "0 XP", e nada
// depois de a tela sair. Relógio falso: nenhum teste espera segundos de verdade.
import { describe, expect, it } from "vitest";
import type { CreditoDaPartida, ProgressoDoJogador } from "../auth/progresso.js";
import { buscarXpDaPartida, ESPERAS_DO_CREDITO_MS, xpParaExibir } from "./xpDaPartida.js";

const PARTIDA = "33333333-3333-4333-8333-333333333333";
const CREDITO: CreditoDaPartida = { xpDelta: 115, posicao: 3 };
const PROGRESSO: ProgressoDoJogador = { xpTotal: 115, nivel: 2, xpNoNivel: 15, xpDoNivel: 150 };

/** Leitor falso: o crédito aparece na tentativa `chegaNa` (1 = primeira); `null` = nunca. */
function leitorFalso({ chegaNa = 1 as number | null, progresso = PROGRESSO as ProgressoDoJogador | null, lanca = false } = {}) {
  const chamadas: string[] = [];
  let tentativa = 0;
  return {
    chamadas,
    async creditoDaPartida(id: string) {
      chamadas.push(`credito:${id.slice(0, 8)}`);
      tentativa++;
      if (lanca) throw new Error("supabase fora do ar");
      return chegaNa !== null && tentativa >= chegaNa ? CREDITO : null;
    },
    async meuProgresso() { chamadas.push("progresso"); return progresso; },
  };
}
function relogioFalso() {
  const esperas: number[] = [];
  return { esperas, esperar: async (ms: number) => { esperas.push(ms); } };
}

describe("buscarXpDaPartida", () => {
  it("crédito na 1ª tentativa: sem espera nenhuma, e o progresso é RELIDO depois dele", async () => {
    const l = leitorFalso();
    const r = relogioFalso();
    expect(await buscarXpDaPartida(l, PARTIDA, { cancelado: () => false, esperar: r.esperar })).toEqual({ credito: CREDITO, progresso: PROGRESSO });
    expect(l.chamadas).toEqual(["credito:33333333", "progresso"]);
    expect(r.esperas).toEqual([]);
  });

  it("crédito que chega na 3ª tentativa: esperou 1 s e 2 s antes, e parou ali", async () => {
    const l = leitorFalso({ chegaNa: 3 });
    const r = relogioFalso();
    expect(await buscarXpDaPartida(l, PARTIDA, { cancelado: () => false, esperar: r.esperar })).toEqual({ credito: CREDITO, progresso: PROGRESSO });
    expect(r.esperas).toEqual([1_000, 2_000]);
    expect(l.chamadas.filter((c) => c.startsWith("credito"))).toHaveLength(3);
  });

  it("crédito que NUNCA chega: 5 tentativas em ~15 s e null — nunca um zero inventado", async () => {
    const l = leitorFalso({ chegaNa: null });
    const r = relogioFalso();
    expect(await buscarXpDaPartida(l, PARTIDA, { cancelado: () => false, esperar: r.esperar })).toBeNull();
    expect(l.chamadas).toHaveLength(ESPERAS_DO_CREDITO_MS.length);
    expect(l.chamadas).not.toContain("progresso");
    expect(r.esperas.reduce((a, b) => a + b, 0)).toBe(15_000);
  });

  it("Supabase fora do ar (a leitura lança): cada tentativa vira null, sem exceção, e acaba", async () => {
    const l = leitorFalso({ lanca: true });
    await expect(buscarXpDaPartida(l, PARTIDA, { cancelado: () => false, esperar: relogioFalso().esperar })).resolves.toBeNull();
    expect(l.chamadas).toHaveLength(ESPERAS_DO_CREDITO_MS.length);
  });

  it("crédito real mas a releitura do progresso falha: mostra o crédito, sem inventar nível", async () => {
    const l = leitorFalso({ progresso: null });
    expect(await buscarXpDaPartida(l, PARTIDA, { cancelado: () => false, esperar: relogioFalso().esperar })).toEqual({ credito: CREDITO, progresso: null });
  });

  it("matchId que não é id de partida: nenhuma tentativa, nenhuma espera", async () => {
    const l = leitorFalso();
    const r = relogioFalso();
    for (const id of ["", "abc", "' or 1=1 --"]) expect(await buscarXpDaPartida(l, id, { cancelado: () => false, esperar: r.esperar })).toBeNull();
    expect(l.chamadas).toEqual([]);
    expect(r.esperas).toEqual([]);
  });

  it("DESMONTADA durante a espera: não consulta mais nada e devolve null", async () => {
    const l = leitorFalso({ chegaNa: 3 });
    let cancelado = false;
    const esperar = async (ms: number) => { if (ms === 1_000) cancelado = true; };
    expect(await buscarXpDaPartida(l, PARTIDA, { cancelado: () => cancelado, esperar })).toBeNull();
    expect(l.chamadas).toEqual(["credito:33333333"]); // a 1ª, antes de desmontar — e só ela
  });

  it("desmontada com a resposta em trânsito: o crédito é descartado e NADA mais é consultado", async () => {
    let cancelado = false;
    const base = leitorFalso();
    const l = { ...base, async creditoDaPartida() { cancelado = true; return CREDITO; } };
    expect(await buscarXpDaPartida(l, PARTIDA, { cancelado: () => cancelado, esperar: relogioFalso().esperar })).toBeNull();
    expect(base.chamadas).not.toContain("progresso"); // nenhuma requisição depois de a tela sair
  });

  it("StrictMode monta duas vezes: a 1ª busca, cancelada, não entrega nada; a 2ª entrega uma vez", async () => {
    const l = leitorFalso({ chegaNa: 2 });
    let primeiraCancelada = false;
    const primeira = buscarXpDaPartida(l, PARTIDA, { cancelado: () => primeiraCancelada, esperar: relogioFalso().esperar });
    primeiraCancelada = true; // a limpeza do efeito roda logo depois da 1ª montagem
    const segunda = buscarXpDaPartida(l, PARTIDA, { cancelado: () => false, esperar: relogioFalso().esperar });
    expect(await primeira).toBeNull();
    expect(await segunda).toEqual({ credito: CREDITO, progresso: PROGRESSO });
    expect(l.chamadas.filter((c) => c === "progresso")).toHaveLength(1);
  });
});

describe("xpParaExibir — o que a tela do fim mostra", () => {
  it("crédito positivo aparece; crédito real de ZERO não vira '+0 XP'; null não vira nada", () => {
    expect(xpParaExibir({ credito: CREDITO, progresso: PROGRESSO })?.credito.xpDelta).toBe(115);
    expect(xpParaExibir({ credito: { xpDelta: 0, posicao: 4 }, progresso: PROGRESSO })).toBeNull();
    expect(xpParaExibir(null)).toBeNull();
  });

  it("partida da 7ª em diante (XP reduzido pelo servidor) aparece com o valor REAL, sem recálculo", () => {
    expect(xpParaExibir({ credito: { xpDelta: 37, posicao: 1 }, progresso: PROGRESSO })?.credito.xpDelta).toBe(37);
  });
});
