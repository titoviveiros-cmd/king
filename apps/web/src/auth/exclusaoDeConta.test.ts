// EXCLUIR A CONTA, DO LADO DO APP (Fase 9) — dublês da porta, da rede e da tela da Apple.
//
// O que se prova: o pedido leva só o token da sessão e a confirmação (e o código novo da Apple,
// quando há); o aparelho só é limpo DEPOIS de o servidor confirmar; falha deixa a conta inteira;
// cancelar a tela da Apple cancela a exclusão; convidado também exclui; toque duplo é um pedido só.
import { describe, expect, it } from "vitest";
import type { PortaDeAutenticacao } from "./clienteSupabase.js";
import type { FonteDeCredencialNativa, ResultadoDaCredencial } from "./credencialNativa.js";
import { CONFIRMACAO_DA_EXCLUSAO, criarExclusaoDeConta } from "./exclusaoDeConta.js";

const ENDERECO = "https://abcdefgh.supabase.co/functions/v1/excluir-conta";

interface Opcoes {
  semSessao?: boolean;
  renovacaoFalhando?: boolean;
  identidades?: string[];
  resposta?: { status: number; corpo?: unknown } | "rede";
  apple?: ResultadoDaCredencial | null;
  segurar?: boolean;
}

function montar(o: Opcoes = {}) {
  const ordem: string[] = [];
  const pedidos: { url: string; init: RequestInit }[] = [];
  const porta = {
    async getSession() {
      if (o.renovacaoFalhando) return { data: { session: null }, error: { message: "Failed to fetch" } };
      return { data: { session: o.semSessao ? null : { access_token: "jwt-da-sessao", user: { id: "u" } } }, error: null };
    },
    async getUserIdentities() {
      return { data: { identities: (o.identidades ?? []).map((provider) => ({ provider, user_id: "u" })) }, error: null };
    },
  } as unknown as PortaDeAutenticacao;
  let soltar: (() => void) | null = null;
  const rede = (async (url: string | URL, init?: RequestInit) => {
    ordem.push("POST");
    pedidos.push({ url: String(url), init: init! });
    if (o.segurar) await new Promise<void>((r) => { soltar = r; });
    if (o.resposta === "rede") throw new TypeError("Failed to fetch");
    const r = o.resposta ?? { status: 200, corpo: { estado: "excluida", apple: "nao-se-aplica" } };
    return new Response(r.corpo === undefined ? null : JSON.stringify(r.corpo), { status: r.status });
  }) as typeof fetch;
  const obtidos: string[] = [];
  const fonte: FonteDeCredencialNativa | null = o.apple === null
    ? null
    : {
        provedores: ["apple"],
        async obter(p, hash) { obtidos.push(`${p}:${hash}`); return o.apple ?? { tipo: "credencial", credencial: { idToken: "id", codigoDeAutorizacao: "codigo-novo" } }; },
      };
  const exclusao = criarExclusaoDeConta({
    principal: async () => porta,
    endereco: ENDERECO,
    chavePublica: "chave-publica",
    rede,
    fonte: () => fonte,
    novoNonce: async () => ({ bruto: "b", hash: "h" }),
    limparAparelho: async () => { ordem.push("limpar"); },
  });
  return { exclusao, ordem, pedidos, obtidos, soltar: () => soltar?.() };
}

const corpoDo = (p: { init: RequestInit }) => JSON.parse(String(p.init.body)) as Record<string, unknown>;

describe("excluir a conta", () => {
  it("convidado: o pedido leva só o token da sessão e a confirmação; o aparelho é limpo DEPOIS", async () => {
    const m = montar();
    expect(await m.exclusao.excluir()).toEqual({ tipo: "excluida", apple: "nao-se-aplica" });
    expect(m.ordem).toEqual(["POST", "limpar"]);
    const [p] = m.pedidos;
    expect(p.url).toBe(ENDERECO);
    expect(p.init.method).toBe("POST");
    expect((p.init.headers as Record<string, string>).authorization).toBe("Bearer jwt-da-sessao");
    expect(corpoDo(p)).toEqual({ confirmacao: CONFIRMACAO_DA_EXCLUSAO });
  });

  it("\"ja-excluida\" (repetição) também limpa o aparelho e conta como excluída", async () => {
    const m = montar({ resposta: { status: 200, corpo: { estado: "ja-excluida", apple: "nao-se-aplica" } } });
    expect((await m.exclusao.excluir()).tipo).toBe("excluida");
    expect(m.ordem).toEqual(["POST", "limpar"]);
  });

  it("servidor fora, rede caída, sessão inválida, resposta estranha: NADA é limpo — a conta segue inteira", async () => {
    for (const [resposta, motivo] of [
      [{ status: 502, corpo: { erro: "falha-ao-excluir" } }, "rede"],
      ["rede", "rede"],
      [{ status: 401, corpo: { erro: "credencial-invalida" } }, "sessao-invalida"],
      [{ status: 400, corpo: { erro: "sem-confirmacao" } }, "servidor"],
      [{ status: 200, corpo: { estado: "talvez" } }, "servidor"],
    ] as const) {
      const m = montar({ resposta });
      expect(await m.exclusao.excluir(), JSON.stringify(resposta)).toEqual({ tipo: "falhou", motivo });
      expect(m.ordem).not.toContain("limpar");
    }
  });

  it("sem sessão neste aparelho: nada vai ao servidor (e as sobras locais saem)", async () => {
    const m = montar({ semSessao: true });
    expect(await m.exclusao.excluir()).toEqual({ tipo: "sem-conta" });
    expect(m.pedidos).toEqual([]);
    expect(m.ordem).toEqual(["limpar"]);
  });

  it("renovação da sessão falhando: \"rede\", sem pedido e sem limpar (não é \"sem conta\")", async () => {
    const m = montar({ renovacaoFalhando: true });
    expect(await m.exclusao.excluir()).toEqual({ tipo: "falhou", motivo: "rede" });
    expect(m.ordem).toEqual([]);
  });

  it("toque duplo: um pedido só", async () => {
    const m = montar({ segurar: true });
    const primeiro = m.exclusao.excluir();
    expect(await m.exclusao.excluir()).toEqual({ tipo: "falhou", motivo: "em-andamento" });
    await new Promise((r) => setTimeout(r, 0));
    m.soltar();
    expect((await primeiro).tipo).toBe("excluida");
    expect(m.pedidos).toHaveLength(1);
  });
});

describe("a Apple na exclusão", () => {
  it("conta com Apple no iPhone: passa pela tela da Apple e manda o código NOVO para revogar", async () => {
    const m = montar({ identidades: ["apple"], resposta: { status: 200, corpo: { estado: "excluida", apple: "revogada" } } });
    expect(await m.exclusao.excluir()).toEqual({ tipo: "excluida", apple: "revogada" });
    expect(m.obtidos).toEqual(["apple:h"]);
    expect(corpoDo(m.pedidos[0])).toEqual({ confirmacao: CONFIRMACAO_DA_EXCLUSAO, apple: { codigo: "codigo-novo" } });
  });

  it("fechar a tela da Apple CANCELA a exclusão: nenhum pedido, nada limpo", async () => {
    const m = montar({ identidades: ["apple"], apple: { tipo: "cancelado" } });
    expect(await m.exclusao.excluir()).toEqual({ tipo: "cancelada" });
    expect(m.ordem).toEqual([]);
  });

  it("Apple com erro, ou conta com Apple fora do iPhone: exclui sem código (o servidor avisa \"sem-codigo\")", async () => {
    const comErro = montar({ identidades: ["apple"], apple: { tipo: "erro" }, resposta: { status: 200, corpo: { estado: "excluida", apple: "sem-codigo" } } });
    expect(await comErro.exclusao.excluir()).toEqual({ tipo: "excluida", apple: "sem-codigo" });
    expect(corpoDo(comErro.pedidos[0])).toEqual({ confirmacao: CONFIRMACAO_DA_EXCLUSAO });
    const semFonte = montar({ identidades: ["apple"], apple: null });
    await semFonte.exclusao.excluir();
    expect(corpoDo(semFonte.pedidos[0])).toEqual({ confirmacao: CONFIRMACAO_DA_EXCLUSAO });
  });

  it("conta só com Google: a tela da Apple não abre", async () => {
    const m = montar({ identidades: ["google"] });
    await m.exclusao.excluir();
    expect(m.obtidos).toEqual([]);
  });
});
