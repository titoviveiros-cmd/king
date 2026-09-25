// A LEITURA DO PROGRESSO — um cliente só, nenhuma escrita, e lixo não vira consulta.
import { afterEach, describe, expect, it, vi } from "vitest";

const criados: unknown[] = [];
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => {
    const cliente = { auth: { getSession: async () => ({ data: { session: null } }) }, from: vi.fn() };
    criados.push(cliente);
    return cliente;
  }),
}));

import { criarLeitorDeProgresso, type PortaDeProgresso } from "./progresso.js";
import { clienteCompartilhado, esquecerPortaDeAutenticacao, portaDeAutenticacao } from "./clienteSupabase.js";

const PARTIDA = "33333333-3333-4333-8333-333333333333";
const CFG = { url: "https://exemplo.supabase.co", anonKey: "chave-publicavel-de-teste" };

afterEach(() => { esquecerPortaDeAutenticacao(); criados.length = 0; });

function portaFalsa(extra: Partial<PortaDeProgresso> = {}): PortaDeProgresso & { consultas: string[] } {
  const consultas: string[] = [];
  return {
    consultas,
    async meuProgresso() { consultas.push("meu"); return { data: { xp_total: 150, nivel: 2, xp_no_nivel: 50, xp_do_nivel: 150 }, error: null }; },
    async creditoDaPartida(id) { consultas.push(id); return { data: { xp_delta: 130, posicao: 2 }, error: null }; },
    ...extra,
  };
}

describe("leitura do progresso", () => {
  it("devolve o progresso já no formato da tela", async () => {
    const l = criarLeitorDeProgresso(async () => portaFalsa());
    expect(await l.meuProgresso()).toEqual({ xpTotal: 150, nivel: 2, xpNoNivel: 50, xpDoNivel: 150 });
  });

  it("o crédito da partida é lido pelo matchId que o servidor entregou", async () => {
    const porta = portaFalsa();
    const l = criarLeitorDeProgresso(async () => porta);
    expect(await l.creditoDaPartida(PARTIDA)).toEqual({ xpDelta: 130, posicao: 2 });
    expect(porta.consultas).toEqual([PARTIDA]);
  });

  it("matchId que não é UUID não vira consulta", async () => {
    const porta = portaFalsa();
    const l = criarLeitorDeProgresso(async () => porta);
    expect(await l.creditoDaPartida("abc123xyz")).toBeNull();
    expect(await l.creditoDaPartida("' or 1=1 --")).toBeNull();
    expect(porta.consultas).toEqual([]);
  });

  it("crédito ainda não gravado, erro do provedor ou dado estranho → null, nunca exceção", async () => {
    const vazio = criarLeitorDeProgresso(async () => portaFalsa({ creditoDaPartida: async () => ({ data: null, error: null }) }));
    expect(await vazio.creditoDaPartida(PARTIDA)).toBeNull();
    const comErro = criarLeitorDeProgresso(async () => portaFalsa({ meuProgresso: async () => ({ data: null, error: { message: "x" } }) }));
    expect(await comErro.meuProgresso()).toBeNull();
    const estranho = criarLeitorDeProgresso(async () => portaFalsa({
      meuProgresso: async () => ({ data: { xp_total: -5, nivel: 0, xp_no_nivel: 0, xp_do_nivel: 100 }, error: null }),
    }));
    expect(await estranho.meuProgresso()).toBeNull();
    const quebrado = criarLeitorDeProgresso(async () => { throw new Error("rede"); });
    expect(await quebrado.meuProgresso()).toBeNull();
  });

  it("sem provedor configurado não há progresso para ler", async () => {
    expect(await criarLeitorDeProgresso(async () => null).meuProgresso()).toBeNull();
  });

  it("a porta de progresso não tem caminho de escrita", () => {
    expect(Object.keys(portaFalsa()).filter((k) => k !== "consultas").sort()).toEqual(["creditoDaPartida", "meuProgresso"]);
  });
});

describe("UM cliente Supabase para identidade e progresso", () => {
  it("autenticação e dados vêm da MESMA instância, criada uma vez", async () => {
    const auth = await portaDeAutenticacao(CFG);
    const dados = await clienteCompartilhado(CFG);
    await portaDeAutenticacao(CFG);
    expect(criados).toHaveLength(1);
    expect(dados).toBe(criados[0]);
    expect(auth).toBe((criados[0] as { auth: unknown }).auth);
  });
});
