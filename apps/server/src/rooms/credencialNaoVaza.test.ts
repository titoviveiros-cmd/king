// T3 — A CREDENCIAL NUNCA SAI DE ONDE ENTROU.
//
// ══ O QUE ESTE ARQUIVO PROVA ══
//
// O `accessToken` chega ao servidor nas opções de entrada e é usado UMA vez, no `onAuth`, para
// conferir a assinatura. Depois disso ele não tem motivo nenhum para existir em outro lugar — e
// cada lugar em que aparecesse seria um vazamento:
//
//   · no ESTADO SINCRONIZADO, ele iria para os quatro aparelhos da mesa;
//   · numa MENSAGEM, para quem a recebesse;
//   · no LOG, para um arquivo que muita gente lê;
//   · no ERRO DE RECUSA, para quem está tentando forjar credencial.
//
// O teste J de `KingRoom.test.ts` já fecha a LISTA de campos do estado, mas ninguém procurava o
// VALOR do token. Aqui ele é procurado, inteiro e pela assinatura sozinha (que também o identifica),
// em tudo o que sai: estado visto pelos clientes e pelo servidor, todas as mensagens recebidas por
// dois clientes, `console`, `stdout`, `stderr`, o erro devolvido na recusa e a reconexão.
//
// Nos dois modos: no MODO B o token é usado e descartado; no MODO A ele é ignorado — e ignorar
// também não pode significar guardar.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { configurarVerificador, restaurarVerificador, VerificadorDeIdentidade } from "../auth/identidade.js";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import { CODIGO, PROTOCOL_VERSION, type BoasVindas } from "../protocol/index.js";
import type { KingRoom } from "./KingRoom.js";

type Chave = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

const PLATEIA = "authenticated";
let privada: Chave;
let privadaIntrusa: Chave;
let publica: JWK;
let jwksServer: Server;
let issuer: string;
let verificadorB: VerificadorDeIdentidade;
let colyseus: ColyseusTestServer;

async function tokenDe(sub: string, chave?: Chave) {
  return await new SignJWT({ sub, is_anonymous: true, role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: publica.kid })
    .setIssuedAt().setIssuer(issuer).setAudience(PLATEIA).setExpirationTime("10m")
    .sign(chave ?? privada);
}

beforeAll(async () => {
  const par = await generateKeyPair("ES256");
  privada = par.privateKey as Chave;
  publica = { ...(await exportJWK(par.publicKey)), kid: "k-vaza", alg: "ES256", use: "sig" };
  privadaIntrusa = (await generateKeyPair("ES256")).privateKey as Chave;
  const corpo = JSON.stringify({ keys: [publica] });
  jwksServer = createServer((_q, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(corpo);
  });
  await new Promise<void>((r) => jwksServer.listen(0, "127.0.0.1", r));
  issuer = `http://127.0.0.1:${(jwksServer.address() as { port: number }).port}/auth/v1`;
  verificadorB = new VerificadorDeIdentidade({
    issuer, jwks: new URL(`${issuer}/.well-known/jwks.json`), audience: PLATEIA,
  });
  colyseus = await boot(servidor);
});

afterAll(async () => {
  restaurarVerificador();
  await colyseus.shutdown();
  await new Promise<void>((r) => jwksServer.close(() => r()));
});

// ── TUDO O QUE O PROCESSO ESCREVE ──────────────────────────────────────────────────────────────
const registros: string[] = [];
const texto = (a: unknown[]) => a.map((x) => {
  if (typeof x === "string") return x;
  if (x instanceof Error) return `${x.name}: ${x.message}\n${x.stack ?? ""}`;
  try { return JSON.stringify(x); } catch { return String(x); }
}).join(" ");

beforeEach(() => {
  registros.length = 0;
  for (const nivel of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => { registros.push(texto(a)); });
  }
  for (const fluxo of [process.stdout, process.stderr]) {
    const original = fluxo.write.bind(fluxo);
    vi.spyOn(fluxo, "write").mockImplementation(((pedaco: unknown, ...resto: unknown[]) => {
      registros.push(typeof pedaco === "string" ? pedaco : Buffer.from(pedaco as Uint8Array).toString("utf8"));
      return (original as (...x: unknown[]) => boolean)(pedaco, ...resto);
    }) as typeof fluxo.write);
  }
});

interface SdkRoom {
  roomId: string;
  state: { toJSON(): unknown; seats?: { playerId: string }[] };
  onMessage(t: string, cb: (...a: unknown[]) => void): void;
  leave(consented?: boolean): Promise<number>;
}
interface Observado { sdk: SdkRoom; mensagens: unknown[]; boasVindas?: BoasVindas }

const abertos: Observado[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(abertos.splice(0).map((o) => Promise.race([
    o.sdk.leave(true).catch(() => 0),
    new Promise((r) => setTimeout(r, 300)),
  ])));
});

const opcoes = (token?: string, nick = "Jogador") => ({
  protocolVersion: PROTOCOL_VERSION, nick, avatar: AVATARES[0],
  ...(token ? { accessToken: token } : {}),
});

function observar(sdk: SdkRoom): Observado {
  const o: Observado = { sdk, mensagens: [] };
  sdk.onMessage("*", (tipo, payload) => {
    o.mensagens.push({ tipo, payload });
    if (tipo === "SERVER_WELCOME") o.boasVindas = payload as BoasVindas;
  });
  abertos.push(o);
  return o;
}

async function ate(cond: () => boolean, rotulo: string, ms = 5_000) {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** O token inteiro e a assinatura sozinha: qualquer um dos dois identifica a credencial. */
function pedacosDe(token: string): string[] {
  return [token, token.split(".")[2]];
}

/** Afirma que nenhum pedaço de nenhum token aparece em nenhum dos textos observados. */
function exigirAusencia(tokens: string[], onde: Record<string, string>): void {
  for (const token of tokens) {
    for (const pedaco of pedacosDe(token)) {
      for (const [lugar, conteudo] of Object.entries(onde)) {
        expect(conteudo.includes(pedaco), `a credencial apareceu em: ${lugar}`).toBe(false);
      }
    }
  }
}

const estadoNoServidor = (roomId: string) =>
  JSON.stringify((colyseus.getRoomById<KingRoom>(roomId) as KingRoom).state.toJSON());

describe("MODO B — o token é conferido e descartado", () => {
  beforeEach(() => configurarVerificador(verificadorB));

  it("dois jogadores com credencial: o token não está no estado, nas mensagens nem no log", async () => {
    const tokenA = await tokenDe("aaaaaaaa-0000-4000-8000-00000000000a");
    const tokenB = await tokenDe("bbbbbbbb-0000-4000-8000-00000000000b");

    const a = observar((await colyseus.sdk.create(SALA_KING, opcoes(tokenA, "A"))) as unknown as SdkRoom);
    await ate(() => !!a.boasVindas, "SERVER_WELCOME de A");
    const b = observar((await colyseus.sdk.joinById(a.sdk.roomId, opcoes(tokenB, "B"))) as unknown as SdkRoom);
    await ate(() => !!b.boasVindas, "SERVER_WELCOME de B");
    await ate(() => (a.sdk.state.seats ?? []).filter((s) => s.playerId).length >= 2, "A ver B sentado");

    // A identidade CHEGOU — sem isto, "não vazou" poderia ser só "não entrou".
    expect(a.boasVindas!.you.playerId).toBe("aaaaaaaa-0000-4000-8000-00000000000a");
    expect(b.boasVindas!.you.identidadePermanente).toBe(true);

    exigirAusencia([tokenA, tokenB], {
      "estado visto por A": JSON.stringify(a.sdk.state.toJSON()),
      "estado visto por B": JSON.stringify(b.sdk.state.toJSON()),
      "estado no servidor": estadoNoServidor(a.sdk.roomId),
      "mensagens recebidas por A": JSON.stringify(a.mensagens),
      "mensagens recebidas por B": JSON.stringify(b.mensagens),
      "log do processo": registros.join("\n"),
    });
  });

  it("a recusa não devolve nem registra a credencial recusada", async () => {
    const intruso = await tokenDe("cccccccc-0000-4000-8000-00000000000c", privadaIntrusa);
    const erroInvalido = await colyseus.sdk.create(SALA_KING, opcoes(intruso)).then(() => null, (e: unknown) => e);
    const erroAusente = await colyseus.sdk.create(SALA_KING, opcoes()).then(() => null, (e: unknown) => e);

    // Recusou — e pelo motivo certo, senão a ausência de vazamento não diria nada.
    expect((erroInvalido as { code?: number })?.code).toBe(CODIGO.IDENTIDADE_RECUSADA);
    expect((erroAusente as { code?: number })?.code).toBe(CODIGO.CREDENCIAL_AUSENTE);

    exigirAusencia([intruso], {
      "erro devolvido ao cliente": texto([erroInvalido]),
      "log do processo": registros.join("\n"),
    });
  });

  it("a reconexão não traz a credencial de volta", async () => {
    const token = await tokenDe("dddddddd-0000-4000-8000-00000000000d");
    const c = observar((await colyseus.sdk.create(SALA_KING, opcoes(token, "D"))) as unknown as SdkRoom);
    await ate(() => !!c.boasVindas, "SERVER_WELCOME");
    const recovery = c.boasVindas!.you.recoveryToken;

    await c.sdk.leave(false);
    const volta = observar((await colyseus.sdk.reconnect(recovery)) as unknown as SdkRoom);
    await ate(() => !!volta.boasVindas, "SERVER_WELCOME da volta");
    expect(volta.boasVindas!.you.playerId).toBe("dddddddd-0000-4000-8000-00000000000d");

    exigirAusencia([token], {
      "estado depois da volta": JSON.stringify(volta.sdk.state.toJSON()),
      "estado no servidor": estadoNoServidor(volta.sdk.roomId),
      "mensagens antes da queda": JSON.stringify(c.mensagens),
      "mensagens depois da volta": JSON.stringify(volta.mensagens),
      "log do processo": registros.join("\n"),
    });
  });
});

describe("MODO A — o token é ignorado, e ignorar não é guardar", () => {
  beforeEach(() => configurarVerificador(null));

  it("com credencial num servidor sem provedor: entra, não usa e não guarda", async () => {
    const sub = "eeeeeeee-0000-4000-8000-00000000000e";
    const token = await tokenDe(sub);
    const c = observar((await colyseus.sdk.create(SALA_KING, opcoes(token, "E"))) as unknown as SdkRoom);
    await ate(() => !!c.boasVindas, "SERVER_WELCOME");

    // MODO A de verdade: o playerId é sorteado, não vem do token.
    expect(c.boasVindas!.you.playerId).not.toBe(sub);
    expect(c.boasVindas!.you.identidadePermanente).toBe(false);

    exigirAusencia([token], {
      "estado visto pelo cliente": JSON.stringify(c.sdk.state.toJSON()),
      "estado no servidor": estadoNoServidor(c.sdk.roomId),
      "mensagens recebidas": JSON.stringify(c.mensagens),
      "log do processo": registros.join("\n"),
    });
  });
});
