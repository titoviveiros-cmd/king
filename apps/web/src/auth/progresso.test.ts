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

import { chaveDaSessao, criarLeitorDeProgresso, matchIdValido, type PortaDeProgresso } from "./progresso.js";
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

describe("a sequência — lida do banco, nunca calculada aqui", () => {
  const BASE = { xp_total: 150, nivel: 2, xp_no_nivel: 50, xp_do_nivel: 150 };
  const SEQ = { sequencia_atual: 3, sequencia_recorde: 7, sequencia_hoje: true, sequencia_partida: PARTIDA };
  const ler = (linha: Record<string, unknown>) =>
    criarLeitorDeProgresso(async () => portaFalsa({ meuProgresso: async () => ({ data: linha as never, error: null }) })).meuProgresso();

  it("com as colunas da migração: a sequência chega pronta, ao lado do XP", async () => {
    expect(await ler({ ...BASE, ...SEQ, sequencia_ultimo_dia: "2026-10-01", player_id: "x" })).toEqual({
      xpTotal: 150, nivel: 2, xpNoNivel: 50, xpDoNivel: 150, sequencia: { atual: 3, recorde: 7, hoje: true, partida: PARTIDA },
    });
  });

  it("banco SEM a migração (Production hoje): o XP de sempre e NENHUMA sequência — nem zero inventado", async () => {
    const p = await ler(BASE);
    expect(p).toEqual({ xpTotal: 150, nivel: 2, xpNoNivel: 50, xpDoNivel: 150 });
    expect(p && "sequencia" in p).toBe(false);
  });

  it("nunca qualificou: zeros e partida nula são um estado válido", async () => {
    expect((await ler({ ...BASE, sequencia_atual: 0, sequencia_recorde: 0, sequencia_hoje: false, sequencia_partida: null }))?.sequencia)
      .toEqual({ atual: 0, recorde: 0, hoje: false, partida: null });
  });

  it("dado estranho na sequência derruba SÓ a sequência; o XP continua aparecendo", async () => {
    for (const ruim of [
      { sequencia_atual: -1 }, { sequencia_atual: 2.5 }, { sequencia_atual: "3" }, { sequencia_recorde: 2 }, // recorde < atual
      { sequencia_hoje: "true" }, { sequencia_partida: "não-é-uuid" }, { sequencia_partida: undefined },
    ]) {
      const p = await ler({ ...BASE, ...SEQ, ...ruim });
      expect(p?.xpTotal, JSON.stringify(ruim)).toBe(150);
      expect(p?.sequencia, JSON.stringify(ruim)).toBeUndefined();
    }
  });

  it("o id da partida vem normalizado em minúsculas, como o matchId do servidor", async () => {
    expect((await ler({ ...BASE, ...SEQ, sequencia_partida: PARTIDA.toUpperCase() }))?.sequencia?.partida).toBe(PARTIDA);
  });

  it("RELÓGIO DO APARELHO ADULTERADO não muda nada: o cliente não olha a hora", async () => {
    const certo = await ler({ ...BASE, ...SEQ });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (const t of ["2030-01-01T00:00:00Z", "1999-12-31T23:59:59Z", "2026-10-03T03:00:00Z"]) {
        vi.setSystemTime(new Date(t));
        expect(await ler({ ...BASE, ...SEQ }), t).toEqual(certo);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("a leitura real pede `*`: banco sem a migração não derruba o card de XP (ordem do rollout livre)", async () => {
    const { readFileSync } = await import("node:fs");
    const codigo = readFileSync(new URL("./progresso.ts", import.meta.url), "utf8");
    expect(codigo).toContain('c.from("meu_progresso").select("*")');
    expect(codigo).not.toMatch(/select\("[^"]*sequencia_/);
  });
});

describe("sem sessão guardada, nem o SDK é tocado — e nenhum convidado nasce para mostrar XP", () => {
  it("meuProgresso e creditoDaPartida devolvem null SEM abrir a porta", async () => {
    let abriu = 0;
    const l = criarLeitorDeProgresso(async () => { abriu++; return portaFalsa(); }, () => false);
    expect(await l.meuProgresso()).toBeNull();
    expect(await l.creditoDaPartida(PARTIDA)).toBeNull();
    expect(abriu).toBe(0);
  });

  it("com sessão guardada, a leitura segue normalmente", async () => {
    const l = criarLeitorDeProgresso(async () => portaFalsa(), () => true);
    expect(await l.meuProgresso()).toEqual({ xpTotal: 150, nivel: 2, xpNoNivel: 50, xpDoNivel: 150 });
  });

  it("a sessão é procurada na chave padrão do SDK, pelo ref do projeto", () => {
    expect(chaveDaSessao("https://dwkpkpmfsqvyarjtcmjd.supabase.co")).toBe("sb-dwkpkpmfsqvyarjtcmjd-auth-token");
    expect(chaveDaSessao("não é url")).toBeNull();
  });

  it("matchIdValido aceita só a forma de um UUID", () => {
    expect(matchIdValido(PARTIDA)).toBe(true);
    for (const x of ["", "abc", "' or 1=1 --", null, undefined, 42, `${PARTIDA}x`]) expect(matchIdValido(x)).toBe(false);
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
