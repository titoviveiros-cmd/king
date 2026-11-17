// OS COSMÉTICOS NA SALA (Entrega B) — quem decide é o banco, quem mostra é a sala.
//
// Sala REAL, clientes por WebSocket real e identidade VERIFICADA (JWT assinado, JWKS local, como em
// `identidadePermanente.test.ts`). A fonte de cosméticos é trocada por uma falsa — o banco tem suíte
// própria em `scripts/testar-cosmeticos-sql.mjs`. Aqui se prova o que a SALA faz com a resposta:
// os quatro veem a mesma moldura; convidado sem conta não pergunta nada; banco fora não trava a
// entrada; reconexão preserva; e a Reação da Coroa só passa de quem foi liberado, uma por mão, sem
// segundo canal e sem dar para falar em nome de outro assento.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { configurarVerificador, restaurarVerificador, VerificadorDeIdentidade } from "../auth/identidade.js";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import {
  PROTOCOL_VERSION, type AcaoRecusada, type BoasVindas, type MensagemSocialDifundida,
} from "../protocol/index.js";
import {
  COSMETICOS_DESLIGADOS, SEM_COSMETICOS, configurarCosmeticos, fonteDeCosmeticosPg, restaurarCosmeticos,
  type CosmeticosDoAssento, type FonteDeCosmeticos,
} from "../progresso/cosmeticos.js";
import { COOLDOWN_MS, REACAO_DA_COROA } from "./social.js";

type Chave = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const REAL = ID(1);      // nível 6: moldura e coroa
const MOLDURA = ID(2);   // nível 2: só moldura
const NADA = ID(3);      // nível 1
const OUTRO = ID(4);

// ═══════════════════ A FONTE, sozinha ═══════════════════

describe("a fonte de cosméticos nunca atrapalha", () => {
  it("fora de `closed` o banco NÃO é tocado", async () => {
    const consultar = vi.fn(async () => [{ player_id: REAL, moldura_real: true, reacao_coroa: true }]);
    const f = fonteDeCosmeticosPg({ consultar, pronto: () => false, log: () => {} });
    expect(await f.doJogador(REAL)).toEqual(SEM_COSMETICOS);
    expect(consultar).not.toHaveBeenCalled();
  });

  it("id que não é UUID (bot, sorteado) não vira consulta", async () => {
    const consultar = vi.fn(async () => []);
    const f = fonteDeCosmeticosPg({ consultar, pronto: () => true, log: () => {} });
    for (const lixo of ["bot:2", "abc", "", "1' or 1=1 --"]) expect(await f.doJogador(lixo)).toEqual(SEM_COSMETICOS);
    expect(consultar).not.toHaveBeenCalled();
  });

  it("devolve o EFEITO do banco, e só do jogador pedido", async () => {
    const f = fonteDeCosmeticosPg({
      consultar: async (ids) => {
        expect(ids).toEqual([REAL]);
        return [{ player_id: OUTRO, moldura_real: true, reacao_coroa: true }, { player_id: REAL, moldura_real: true, reacao_coroa: false }];
      },
      pronto: () => true, log: () => {},
    });
    expect(await f.doJogador(REAL)).toEqual({ moldura: true, coroa: false });
  });

  it("erro, resposta estranha e PRAZO estourado viram 'sem cosméticos' — e o log não leva o id inteiro nem o host", async () => {
    const logs: string[] = [];
    const log = (m: string) => logs.push(m);
    const erro = Object.assign(new Error("getaddrinfo ENOTFOUND db.segredo.supabase.co"), { code: "ENOTFOUND" });
    const casos: FonteDeCosmeticos[] = [
      fonteDeCosmeticosPg({ consultar: async () => { throw erro; }, pronto: () => true, log }),
      fonteDeCosmeticosPg({ consultar: async () => "lixo" as never, pronto: () => true, log }),
      fonteDeCosmeticosPg({ consultar: () => new Promise(() => {}), pronto: () => true, log, prazoMs: 30 }),
    ];
    for (const f of casos) expect(await f.doJogador(REAL)).toEqual(SEM_COSMETICOS);
    expect(logs.join("\n")).not.toContain(REAL);
    expect(logs.join("\n")).not.toContain("segredo");
    expect(logs.some((l) => l.includes("prazo"))).toBe(true);
  });
});

// ═══════════════════ A SALA ═══════════════════

let privada: Chave;
let publica: JWK;
let jwksServer: Server;
let issuer: string;
let colyseus: ColyseusTestServer;
let verificador: VerificadorDeIdentidade;

/** O "banco": o efeito por jogador. Trocável por teste. */
let banco: Record<string, CosmeticosDoAssento> = {};
let perguntas: string[] = [];
const fonteFalsa: FonteDeCosmeticos = {
  async doJogador(id) { perguntas.push(id); return banco[id] ?? SEM_COSMETICOS; },
};

async function tokenDe(sub: string) {
  return await new SignJWT({ sub, is_anonymous: true })
    .setProtectedHeader({ alg: "ES256", kid: publica.kid })
    .setIssuedAt().setIssuer(issuer).setAudience("authenticated").setExpirationTime("10m")
    .sign(privada);
}

beforeAll(async () => {
  const par = await generateKeyPair("ES256");
  privada = par.privateKey as Chave;
  publica = { ...(await exportJWK(par.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  const corpo = JSON.stringify({ keys: [publica] });
  jwksServer = createServer((_q, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(corpo); });
  await new Promise<void>((r) => jwksServer.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${(jwksServer.address() as { port: number }).port}/auth/v1`;
  verificador = new VerificadorDeIdentidade({ issuer, jwks: new URL(`${issuer}/.well-known/jwks.json`), audience: "authenticated" });
  colyseus = await boot(servidor);
});
afterAll(async () => {
  restaurarVerificador();
  restaurarCosmeticos();
  await colyseus.shutdown();
  await new Promise<void>((r) => jwksServer.close(() => r()));
});
beforeEach(async () => {
  await colyseus.cleanup();
  configurarVerificador(verificador);
  banco = {
    [REAL]: { moldura: true, coroa: true },
    [MOLDURA]: { moldura: true, coroa: false },
  };
  perguntas = [];
  configurarCosmeticos(fonteFalsa);
});
afterEach(() => { restaurarCosmeticos(); });

interface AssentoView { seat: number; playerId: string; bot: boolean; moldura: boolean; coroa: boolean }
interface SdkRoom {
  state: { status: string; seats: Iterable<AssentoView> };
  send(t: string, m?: unknown): void;
  onMessage(t: string, cb: (m: never) => void): void;
  leave(consentido?: boolean): Promise<unknown>;
}
interface Cliente {
  sdk: SdkRoom; boasVindas: BoasVindas | null; rejeicoes: AcaoRecusada[]; sociais: MensagemSocialDifundida[];
  temVisao: boolean;
}

async function ate(cond: () => boolean, ms = 8000, rotulo = "?"): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando: " + rotulo);
    await new Promise((r) => setTimeout(r, 5));
  }
}

function escutar(sdk: SdkRoom, c?: Cliente): Cliente {
  const x: Cliente = c ?? { sdk, boasVindas: null, rejeicoes: [], sociais: [], temVisao: false };
  x.sdk = sdk;
  sdk.onMessage("SERVER_WELCOME", (m: BoasVindas) => { x.boasVindas = m; });
  sdk.onMessage("ACTION_REJECTED", (m: AcaoRecusada) => { x.rejeicoes.push(m); });
  sdk.onMessage("SOCIAL_MESSAGE", (m: MensagemSocialDifundida) => { x.sociais.push(m); });
  sdk.onMessage("STATE_UPDATE", () => { x.temVisao = true; });
  for (const t of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "READY_STATE", "TURN_CLOCK", "AUTO_ACTION", "SERVER_ERROR"]) {
    sdk.onMessage(t, () => {});
  }
  return x;
}

const opcoes = (token: string | null, nick: string, avatar: string) => ({
  protocolVersion: PROTOCOL_VERSION, nick, avatar, ...(token ? { accessToken: token } : {}),
});

async function sentar(codigo: string | null, sub: string | null, nick: string, i: number): Promise<Cliente> {
  const o = opcoes(sub ? await tokenDe(sub) : null, nick, AVATARES[i]);
  const sdk = (codigo ? await colyseus.sdk.joinById(codigo, o) : await colyseus.sdk.create(SALA_KING, o)) as unknown as SdkRoom;
  const c = escutar(sdk);
  await ate(() => c.boasVindas !== null, 8000, `welcome ${nick}`);
  return c;
}

const assentos = (c: Cliente) => [...c.sdk.state.seats];

/** Mesa de QUATRO humanos com identidade verificada, já em partida. */
async function mesaDeQuatro(subs = [REAL, MOLDURA, NADA, OUTRO]): Promise<Cliente[]> {
  const dono = await sentar(null, subs[0], "P0", 0);
  const codigo = dono.boasVindas!.roomCode;
  const todos = [dono];
  for (let i = 1; i < 4; i++) todos.push(await sentar(codigo, subs[i], `P${i}`, i));
  return todos;
}
async function comecar(todos: Cliente[]): Promise<void> {
  for (const c of todos) c.sdk.send("CLIENT_SET_READY", { ready: true });
  await ate(() => todos.every((c) => c.temVisao), 10_000, "partida começar");
}

describe("a MOLDURA chega igual aos quatro aparelhos", () => {
  it("quem tem moldura aparece com ela nos 4 — e quem não tem, sem; o banco é perguntado UMA vez por pessoa", async () => {
    const todos = await mesaDeQuatro();
    await ate(() => todos.every((c) => assentos(c)[0].moldura && assentos(c)[1].moldura), 8000, "molduras chegarem");
    for (const c of todos) {
      expect(assentos(c).map((a) => a.moldura)).toEqual([true, true, false, false]);
      expect(assentos(c).map((a) => a.coroa)).toEqual([true, false, false, false]);
    }
    expect([...perguntas].sort()).toEqual([REAL, MOLDURA, NADA, OUTRO].sort());
  }, 30_000);

  it("convidado SEM conta (identidade sorteada) não pergunta nada ao banco e não tem moldura", async () => {
    restaurarVerificador(); // MODO A: entra sem credencial, id sorteado
    const dono = await sentar(null, null, "Sem conta", 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(perguntas).toEqual([]);
    expect(assentos(dono)[0].moldura).toBe(false);
    expect(assentos(dono)[0].coroa).toBe(false);
  }, 20_000);

  it("BANCO FORA (fonte lenta e com erro): a entrada não espera, e a mesa segue sem cosmético", async () => {
    configurarCosmeticos(fonteDeCosmeticosPg({ consultar: () => new Promise(() => {}), pronto: () => true, log: () => {}, prazoMs: 200 }));
    const t0 = Date.now();
    const todos = await mesaDeQuatro();
    expect(Date.now() - t0).toBeLessThan(5_000);
    await comecar(todos);
    await new Promise((r) => setTimeout(r, 300));
    for (const c of todos) expect(assentos(c).every((a) => !a.moldura && !a.coroa)).toBe(true);
    configurarCosmeticos(COSMETICOS_DESLIGADOS);
  }, 30_000);

  it("a RECONEXÃO preserva a moldura; sair de vez a apaga — e quem senta no lugar não a herda", async () => {
    const todos = await mesaDeQuatro();
    await ate(() => assentos(todos[3])[0].moldura, 8000, "moldura do P0");
    const credencial = todos[0].boasVindas!.you.recoveryToken;
    await todos[0].sdk.leave(false);
    await ate(() => assentos(todos[3]).length === 4, 8000, "estado");
    todos[0].boasVindas = null;
    const novo = (await colyseus.sdk.reconnect(credencial)) as unknown as SdkRoom;
    escutar(novo, todos[0]);
    await ate(() => todos[0].boasVindas !== null, 8000, "voltou");
    expect(assentos(todos[0])[0].moldura).toBe(true);
    expect(assentos(todos[3])[0].moldura).toBe(true);
    expect(perguntas.filter((p) => p === REAL)).toHaveLength(1); // voltar não pergunta de novo

    await todos[0].sdk.leave(true);
    await ate(() => assentos(todos[3])[0].playerId === "", 8000, "assento liberado");
    expect(assentos(todos[3])[0].moldura).toBe(false);
    expect(assentos(todos[3])[0].coroa).toBe(false);
  }, 30_000);

  it("resposta ATRASADA de quem já saiu não pinta o assento de quem sentou depois", async () => {
    let liberar: (v: CosmeticosDoAssento) => void = () => {};
    configurarCosmeticos({
      doJogador: (id) => id === REAL ? new Promise<CosmeticosDoAssento>((r) => { liberar = r; }) : Promise.resolve(SEM_COSMETICOS),
    });
    const dono = await sentar(null, OUTRO, "Dono", 0);
    const codigo = dono.boasVindas!.roomCode;
    const lento = await sentar(codigo, REAL, "Lento", 1);
    await lento.sdk.leave(true);
    await ate(() => assentos(dono)[1].playerId === "", 8000, "saiu");
    await sentar(codigo, NADA, "Novo", 1);
    await ate(() => assentos(dono)[1].playerId === NADA, 8000, "novo sentou");
    liberar({ moldura: true, coroa: true });
    await new Promise((r) => setTimeout(r, 100));
    expect(assentos(dono)[1].moldura).toBe(false);
    expect(assentos(dono)[1].coroa).toBe(false);
  }, 30_000);
});

describe("a REAÇÃO DA COROA: mesmo canal, só de quem foi liberado, uma por mão", () => {
  it("liberada: chega aos QUATRO, com o assento de quem mandou — pelo mesmo SOCIAL_MESSAGE", async () => {
    const todos = await mesaDeQuatro();
    await ate(() => assentos(todos[0])[0].coroa, 8000, "coroa liberada");
    await comecar(todos);
    todos[0].sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: REACAO_DA_COROA });
    await ate(() => todos.every((c) => c.sociais.length > 0), 8000, "a coroa chegar");
    for (const c of todos) expect(c.sociais[0]).toMatchObject({ seat: 0, messageId: REACAO_DA_COROA });
  }, 30_000);

  it("SEM liberação é recusada e não chega a ninguém — e a recusa não gasta o fôlego das frases comuns", async () => {
    const todos = await mesaDeQuatro();
    await comecar(todos);
    todos[2].sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: REACAO_DA_COROA }); // NADA (nível 1)
    todos[1].sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: REACAO_DA_COROA }); // MOLDURA (sem coroa)
    await ate(() => todos[2].rejeicoes.length > 0 && todos[1].rejeicoes.length > 0, 8000, "recusas");
    expect(todos[2].rejeicoes[0].code).toBe("INVALID_PAYLOAD");
    expect(todos[1].rejeicoes[0].code).toBe("INVALID_PAYLOAD");
    todos[2].sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: "boa" }); // logo em seguida: passa
    await ate(() => todos[0].sociais.length > 0, 8000, "a frase comum passar");
    expect(todos[0].sociais.map((s) => s.messageId)).toEqual(["boa"]);
  }, 30_000);

  it("UMA por mão: a segunda é recusada mesmo depois do cooldown; frases comuns seguem no ritmo de sempre", async () => {
    const todos = await mesaDeQuatro();
    await ate(() => assentos(todos[0])[0].coroa, 8000, "coroa liberada");
    await comecar(todos);
    todos[0].sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: REACAO_DA_COROA });
    await ate(() => todos[1].sociais.length === 1, 8000, "1ª coroa");
    await new Promise((r) => setTimeout(r, COOLDOWN_MS + 50));
    todos[0].sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: REACAO_DA_COROA });
    await ate(() => todos[0].rejeicoes.length > 0, 8000, "2ª recusada");
    expect(todos[0].rejeicoes[0]).toMatchObject({ code: "RATE_LIMITED" });
    todos[0].sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: "boa" });
    await ate(() => todos[1].sociais.length === 2, 8000, "a frase comum passar");
    expect(todos[1].sociais.map((s) => s.messageId)).toEqual([REACAO_DA_COROA, "boa"]);
  }, 30_000);

  it("não dá para falar em nome de outro assento: o assento é o da CONEXÃO, nunca o do pedido", async () => {
    const todos = await mesaDeQuatro();
    await ate(() => assentos(todos[0])[0].coroa, 8000, "coroa liberada");
    await comecar(todos);
    // o NADA (assento 2) tenta se passar pelo assento 0, que tem a coroa
    todos[2].sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: REACAO_DA_COROA, seat: 0, playerId: REAL });
    await ate(() => todos[2].rejeicoes.length > 0, 8000, "recusa");
    expect(todos[2].rejeicoes[0].code).toBe("INVALID_PAYLOAD");
    expect(todos[1].sociais).toHaveLength(0);
    // e o cliente não tem mensagem para escrever cosmético no próprio assento
    for (const tipo of ["CLIENT_SET_COSMETIC", "CLIENT_SET_FRAME"]) todos[2].sdk.send(tipo, { moldura: true, coroa: true });
    await new Promise((r) => setTimeout(r, 150));
    expect(assentos(todos[0])[2].moldura).toBe(false);
    expect(assentos(todos[0])[2].coroa).toBe(false);
  }, 30_000);

  it("no lobby, nem a coroa: mesma regra de fase das frases", async () => {
    const todos = await mesaDeQuatro();
    await ate(() => assentos(todos[0])[0].coroa, 8000, "coroa liberada");
    todos[0].sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: REACAO_DA_COROA });
    await ate(() => todos[0].rejeicoes.length > 0, 8000, "recusa");
    expect(todos[0].rejeicoes[0].code).toBe("WRONG_PHASE");
  }, 30_000);
});
