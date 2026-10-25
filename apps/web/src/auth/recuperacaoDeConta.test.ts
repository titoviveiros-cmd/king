// "JÁ TENHO UMA CONTA" (Fase 9) — a política, com dublês determinísticas do cliente principal, do
// cliente isolado e do plugin nativo. Nenhuma rede, nenhum Google, nenhuma Apple.
//
// O que se prova, para Google E Apple: a tentativa nunca toca a sessão do aparelho antes da hora;
// identidade sem conta não vira conta (recusa do servidor ou conta recém-nascida desfeita); o
// progresso do convidado não é trocado sem confirmação; cancelar e falhar não apagam ninguém; e o
// toque duplo não abre duas tentativas.
import { describe, expect, it } from "vitest";
import type { PortaDeAutenticacao, PortaIsolada, UsuarioSupabase } from "./clienteSupabase.js";
import type { FonteDeCredencialNativa, ResultadoDaCredencial } from "./credencialNativa.js";
import { criarRecuperacao, nasceuComEstaIdentidade, type ProgressoEmJogo } from "./recuperacaoDeConta.js";

const CONVIDADO = "11111111-1111-1111-1111-111111111111";
const ANTIGA = "22222222-2222-2222-2222-222222222222";
const ESTRANHA = "33333333-3333-3333-3333-333333333333";
const PROVEDORES = ["google", "apple"] as const;

const idToken = (nonce: string) => `h.${Buffer.from(JSON.stringify({ nonce })).toString("base64url")}.s`;

/** A conta antiga: era convidado em março e vinculou o provedor em abril. */
const contaAntiga = (provedor: string): UsuarioSupabase => ({
  id: ANTIGA,
  created_at: "2026-03-01T10:00:00Z",
  identities: [{ provider: provedor, user_id: ANTIGA, created_at: "2026-04-02T18:30:00Z" }],
});
/** A conta que o Supabase CRIARIA sem o gancho: usuário e identidade na mesma transação. */
const contaRecemNascida = (provedor: string): UsuarioSupabase => ({
  id: ESTRANHA,
  created_at: "2026-10-25T12:00:00.100Z",
  identities: [{ provider: provedor, user_id: ESTRANHA, created_at: "2026-10-25T12:00:00.104Z" }],
});

interface Opcoes {
  semConvidado?: boolean;
  renovacaoFalhando?: boolean;
  convidadoVinculado?: boolean;
  progresso?: ProgressoEmJogo | null | "erro";
  resposta?: "existe" | "recusa-do-gancho" | "recem-nascida" | "rede" | "outro-erro" | "mesma";
  credencial?: ResultadoDaCredencial | "segura";
  setSessionFalha?: boolean;
  /** O SDK diz que trocou, mas a sessão guardada continua a do convidado. */
  setSessionNaoMuda?: boolean;
}

function montar(provedor: "google" | "apple", o: Opcoes = {}) {
  const log: string[] = [];
  let sessaoAtualId: string | null = o.semConvidado ? null : CONVIDADO;
  const principal = {
    async getSession() {
      log.push("principal.getSession");
      if (o.renovacaoFalhando) return { data: { session: null }, error: { message: "Failed to fetch" } };
      return { data: { session: sessaoAtualId ? { access_token: `jwt-${sessaoAtualId}`, refresh_token: "rt", user: { id: sessaoAtualId } } : null }, error: null };
    },
    async getUserIdentities() {
      return { data: { identities: o.convidadoVinculado ? [{ provider: "google", user_id: CONVIDADO }] : [] }, error: null };
    },
    async setSession(s: { access_token: string; refresh_token: string }) {
      log.push(`principal.setSession:${s.access_token}:${s.refresh_token}`);
      if (o.setSessionFalha) return { data: null, error: { message: "Failed to fetch", status: 0 } };
      if (!o.setSessionNaoMuda) sessaoAtualId = s.access_token === "jwt-antiga" ? ANTIGA : sessaoAtualId;
      return { data: { session: { access_token: s.access_token } }, error: null };
    },
    async signInAnonymously() { log.push("principal.signInAnonymously"); return { data: { session: null } }; },
    async signOut() { log.push("principal.signOut"); return { error: null }; },
  } as unknown as PortaDeAutenticacao;

  let isoladas = 0;
  const isolada = (): PortaIsolada => ({
    async signInWithIdToken(c) {
      log.push(`isolada.signInWithIdToken:${c.provider}:${c.nonce ? "com-nonce" : "sem-nonce"}`);
      switch (o.resposta ?? "existe") {
        case "recusa-do-gancho": return { data: null, error: { message: "KING: nenhuma conta com este login.", status: 403 } };
        case "rede": return { data: null, error: { message: "Failed to fetch", status: 0, name: "AuthRetryableFetchError" } };
        case "outro-erro": return { data: null, error: { message: "Unacceptable audience", status: 400 } };
        case "recem-nascida": return { data: { session: { access_token: "jwt-estranha", refresh_token: "rt-e" }, user: contaRecemNascida(provedor) }, error: null };
        case "mesma": return { data: { session: { access_token: `jwt-${CONVIDADO}`, refresh_token: "rt-m" }, user: { id: CONVIDADO, created_at: "2026-01-01T00:00:00Z", identities: [] } }, error: null };
        default: return { data: { session: { access_token: "jwt-antiga", refresh_token: "rt-antiga" }, user: contaAntiga(provedor) }, error: null };
      }
    },
    async signOut(s) { log.push(`isolada.signOut:${s.scope}`); return { error: null }; },
  });

  let pedidos = 0;
  let segurar: ((r: ResultadoDaCredencial) => void) | null = null;
  const fonte: FonteDeCredencialNativa = {
    provedores: provedor === "apple" ? ["apple", "google"] : ["google"],
    obter(_p, hash) {
      pedidos++;
      log.push(`fonte.obter:${_p}`);
      if (o.credencial === "segura") return new Promise((r) => { segurar = r; });
      return Promise.resolve(o.credencial ?? { tipo: "credencial", credencial: { idToken: idToken(hash) } });
    },
    async esquecer() { log.push("fonte.esquecer"); },
  };

  const desfeitas: string[] = [];
  let esquecidos = 0;
  const rec = criarRecuperacao({
    principal: async () => principal,
    isolada: async () => { isoladas++; return isolada(); },
    fonte: () => fonte,
    novoNonce: async () => ({ bruto: "bruto", hash: "hash-do-nonce" }),
    progressoAtual: async () => {
      if (o.progresso === "erro") throw new Error("rede");
      return o.progresso === undefined ? { nivel: 4, xpTotal: 900 } : o.progresso;
    },
    desfazerContaRecemCriada: async (t) => { desfeitas.push(t); return true; },
    esquecerJogadorAnterior: () => { esquecidos++; },
  });
  return {
    rec, log, desfeitas,
    pedidos: () => pedidos,
    isoladas: () => isoladas,
    esquecidos: () => esquecidos,
    soltar: (r: ResultadoDaCredencial) => segurar?.(r),
    sessaoAtual: () => sessaoAtualId,
  };
}

const naoTocouNaSessao = (log: string[]) =>
  expect(log.some((l) => l.startsWith("principal.setSession") || l.startsWith("principal.signOut") || l.startsWith("principal.signInAnonymously"))).toBe(false);

for (const provedor of PROVEDORES) {
  describe(`"Já tenho uma conta" com ${provedor}`, () => {
    it("conta existe + convidado COM progresso → pede confirmação ANTES; confirmar troca e confere", async () => {
      const m = montar(provedor);
      const r = await m.rec.recuperar(provedor);
      expect(r.tipo).toBe("confirmar");
      if (r.tipo !== "confirmar") return;
      expect(r.progresso).toEqual({ nivel: 4, xpTotal: 900 });
      expect(r.atualVinculada).toBe(false);
      naoTocouNaSessao(m.log);
      expect(await r.confirmar()).toEqual({ tipo: "recuperada", userId: ANTIGA });
      expect(m.log).toContain("principal.setSession:jwt-antiga:rt-antiga");
      expect(m.sessaoAtual()).toBe(ANTIGA);
      expect(m.esquecidos()).toBe(1);
      expect(m.log).toContain(`isolada.signInWithIdToken:${provedor}:com-nonce`);
    });

    it("cancelar na confirmação: a sessão nova é revogada e o convidado fica INTACTO", async () => {
      const m = montar(provedor);
      const r = await m.rec.recuperar(provedor);
      if (r.tipo !== "confirmar") throw new Error(r.tipo);
      await r.cancelar();
      expect(m.log).toContain("isolada.signOut:local");
      naoTocouNaSessao(m.log);
      expect(m.sessaoAtual()).toBe(CONVIDADO);
      expect(await r.confirmar()).toEqual({ tipo: "falhou", motivo: "em-andamento" }); // decisão já tomada
      naoTocouNaSessao(m.log);
    });

    it("identidade sem conta KING (o gancho do servidor recusa): \"não encontrada\", nada criado nem trocado", async () => {
      const m = montar(provedor, { resposta: "recusa-do-gancho" });
      expect(await m.rec.recuperar(provedor)).toEqual({ tipo: "falhou", motivo: "conta-nao-encontrada" });
      naoTocouNaSessao(m.log);
      expect(m.desfeitas).toEqual([]);
    });

    it("SEM o gancho, a conta que nasceu agora com a identidade é DESFEITA e nunca adotada", async () => {
      const m = montar(provedor, { resposta: "recem-nascida" });
      expect(await m.rec.recuperar(provedor)).toEqual({ tipo: "falhou", motivo: "conta-nao-encontrada" });
      expect(m.desfeitas).toEqual(["jwt-estranha"]);
      naoTocouNaSessao(m.log);
      expect(m.sessaoAtual()).toBe(CONVIDADO);
    });

    it("a conta que voltou é a deste aparelho: nada é trocado, e a sessão extra é revogada", async () => {
      const m = montar(provedor, { resposta: "mesma" });
      expect(await m.rec.recuperar(provedor)).toEqual({ tipo: "ja-e-esta" });
      expect(m.log).toContain("isolada.signOut:local");
      naoTocouNaSessao(m.log);
    });

    it("cancelar na tela do provedor: nada acontece (nem cliente isolado nasce)", async () => {
      const m = montar(provedor, { credencial: { tipo: "cancelado" } });
      expect(await m.rec.recuperar(provedor)).toEqual({ tipo: "falhou", motivo: "cancelado" });
      expect(m.isoladas()).toBe(0);
      naoTocouNaSessao(m.log);
    });

    it("rede caída na tentativa, ou erro do provedor: o convidado fica", async () => {
      for (const resposta of ["rede", "outro-erro"] as const) {
        const m = montar(provedor, { resposta });
        const r = await m.rec.recuperar(provedor);
        expect(r).toEqual({ tipo: "falhou", motivo: resposta === "rede" ? "erro-de-rede" : "provedor-recusou" });
        naoTocouNaSessao(m.log);
      }
    });

    it("renovação da sessão atual falhando: nem abre a tela do provedor (\"agora não\", não \"sem jogador\")", async () => {
      const m = montar(provedor, { renovacaoFalhando: true });
      expect(await m.rec.recuperar(provedor)).toEqual({ tipo: "falhou", motivo: "erro-de-rede" });
      expect(m.pedidos()).toBe(0);
      naoTocouNaSessao(m.log);
    });

    it("troca que falha: a sessão nova é revogada e o convidado continua o mesmo", async () => {
      const m = montar(provedor, { setSessionFalha: true });
      const r = await m.rec.recuperar(provedor);
      if (r.tipo !== "confirmar") throw new Error(r.tipo);
      expect(await r.confirmar()).toEqual({ tipo: "falhou", motivo: "erro-de-rede" });
      expect(m.log).toContain("isolada.signOut:local");
      expect(m.sessaoAtual()).toBe(CONVIDADO);
      expect(m.esquecidos()).toBe(0);
    });

    it("troca que o SDK diz feita mas não aparece na sessão: NÃO é sucesso (a prova é a sessão)", async () => {
      const m = montar(provedor, { setSessionNaoMuda: true });
      const r = await m.rec.recuperar(provedor);
      if (r.tipo !== "confirmar") throw new Error(r.tipo);
      expect(await r.confirmar()).toEqual({ tipo: "falhou", motivo: "provedor-recusou" });
      expect(m.esquecidos()).toBe(0);
    });

    it("toque duplo: a segunda tentativa não abre outra tela", async () => {
      const m = montar(provedor, { credencial: "segura" });
      const primeira = m.rec.recuperar(provedor);
      expect(await m.rec.recuperar(provedor)).toEqual({ tipo: "falhou", motivo: "em-andamento" });
      await new Promise((r) => setTimeout(r, 0));
      m.soltar({ tipo: "cancelado" });
      expect((await primeira).tipo).toBe("falhou");
      expect(m.pedidos()).toBe(1);
    });
  });
}

describe("quando a confirmação é pulada (e quando não é)", () => {
  it("aparelho sem convidado nenhum: entra direto, não há o que perder", async () => {
    const m = montar("google", { semConvidado: true });
    expect(await m.rec.recuperar("google")).toEqual({ tipo: "recuperada", userId: ANTIGA });
  });

  it("convidado SEM progresso e sem vínculo: entra direto", async () => {
    const m = montar("google", { progresso: { nivel: 1, xpTotal: 0 } });
    expect((await m.rec.recuperar("google")).tipo).toBe("recuperada");
  });

  it("progresso que não deu para ler: PERGUNTA do mesmo jeito (sem saber, não se troca calado)", async () => {
    for (const progresso of [null, "erro"] as const) {
      const m = montar("google", { progresso });
      const r = await m.rec.recuperar("google");
      expect(r.tipo).toBe("confirmar");
      if (r.tipo === "confirmar") expect(r.progresso).toBeNull();
      naoTocouNaSessao(m.log);
    }
  });

  it("conta atual já vinculada (mesmo sem XP): pergunta, avisando que ela volta pelo login", async () => {
    const m = montar("apple", { progresso: { nivel: 1, xpTotal: 0 }, convidadoVinculado: true });
    const r = await m.rec.recuperar("apple");
    expect(r.tipo).toBe("confirmar");
    if (r.tipo === "confirmar") expect(r.atualVinculada).toBe(true);
  });

  it("provedor que este app não oferece: indisponível, sem abrir nada", async () => {
    const m = montar("google");
    expect(await m.rec.recuperar("apple")).toEqual({ tipo: "falhou", motivo: "indisponivel" });
    expect(m.pedidos()).toBe(0);
  });

  it("token com o nonce de OUTRO pedido: esquece e pede de novo, uma vez", async () => {
    let chamadas = 0;
    const m = montar("google", {
      credencial: undefined,
    });
    const rec = criarRecuperacao({
      principal: async () => ({
        async getSession() { return { data: { session: { access_token: "a", user: { id: CONVIDADO } } }, error: null }; },
        async getUserIdentities() { return { data: { identities: [] }, error: null }; },
        async setSession() { return { data: null, error: null }; },
      }) as unknown as PortaDeAutenticacao,
      isolada: async () => null,
      fonte: () => ({
        provedores: ["google"],
        async obter(_p, hash) { chamadas++; return { tipo: "credencial", credencial: { idToken: idToken(chamadas === 1 ? "nonce-velho" : hash) } }; },
        async esquecer() { m.log.push("esqueceu"); },
      }),
      novoNonce: async () => ({ bruto: "b", hash: "h" }),
      progressoAtual: async () => null,
      desfazerContaRecemCriada: async () => true,
    });
    expect(await rec.recuperar("google")).toEqual({ tipo: "falhou", motivo: "indisponivel" }); // isolada nula no fim
    expect(chamadas).toBe(2);
    expect(m.log).toContain("esqueceu");
  });
});

describe("a conta \"nasceu com esta identidade\"?", () => {
  it("usuário e identidade na mesma transação: sim; convidado que vinculou depois: não", () => {
    expect(nasceuComEstaIdentidade(contaRecemNascida("google"), "google")).toBe(true);
    expect(nasceuComEstaIdentidade(contaAntiga("google"), "google")).toBe(false);
    expect(nasceuComEstaIdentidade({ id: "x", created_at: "2026-10-25T12:00:00Z", identities: [{ provider: "google", created_at: "2026-10-25T12:00:01.600Z" }] }, "google")).toBe(false);
  });

  it("sem datas, ou sem a identidade, não se conclui nada (não desfaz conta nenhuma)", () => {
    expect(nasceuComEstaIdentidade(null, "apple")).toBe(false);
    expect(nasceuComEstaIdentidade({ id: "x", identities: [{ provider: "apple" }] }, "apple")).toBe(false);
    expect(nasceuComEstaIdentidade({ id: "x", created_at: "2026-10-25T12:00:00Z", identities: [] }, "apple")).toBe(false);
  });
});
