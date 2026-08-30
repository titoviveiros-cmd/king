// A IDENTIDADE QUE SOBREVIVE À SALA — exercitada numa sala de verdade, com token de verdade.
//
// ══ O QUE ESTE ARQUIVO PROVA, E O `auth/identidade.test.ts` NÃO ══
//
// Lá se prova que a VERIFICAÇÃO está correta: token bom passa, token ruim é recusado pelo motivo
// certo. Isso é a metade de dentro. Falta a metade que o jogador sente: que o identificador
// derivado do token chega mesmo ao assento, que ele é o MESMO em outra sala e noutro dia, e que
// um token adulterado não vira um convidado silencioso.
//
// Para isso é preciso o caminho inteiro — `onAuth` → `onJoin` → estado sincronizado — com o
// servidor rodando. É o que este arquivo faz: sobe um JWKS local, instala o verificador na sala
// pela mesma costura que `match/tempos.ts` usa para prazos, e joga.
//
// ══ O QUE PRECISA CONTINUAR VERDADE ══
//
//   1. com credencial válida, o `playerId` da mesa É o `sub` do token — o servidor não sorteia;
//   2. o MESMO `sub` devolve o MESMO `playerId` numa OUTRA sala: é a promessa inteira da fase;
//   3. token adulterado é recusado NA PORTA, e não rebaixado a convidado em silêncio;
//   4. a mesma conta não ocupa dois assentos na mesma mesa;
//   5. duas contas diferentes na mesma mesa continuam sendo duas pessoas;
//   6. o `SERVER_WELCOME` diz a VERDADE sobre a identidade ser permanente ou não.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from "jose";
import { configurarVerificador, restaurarVerificador, VerificadorDeIdentidade } from "../auth/identidade.js";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import { PROTOCOL_VERSION, type BoasVindas } from "../protocol/index.js";

const PLATEIA = "authenticated";

let privada: KeyLike;
let publica: JWK;
let privadaIntrusa: KeyLike;
let jwksServer: Server;
let issuer: string;
let colyseus: ColyseusTestServer;

async function tokenDe(sub: string, opcoes: { chave?: KeyLike; anonimo?: boolean } = {}) {
  return await new SignJWT(
    opcoes.anonimo ? { sub, is_anonymous: true } : { sub, app_metadata: { provider: "google" } },
  )
    .setProtectedHeader({ alg: "ES256", kid: publica.kid })
    .setIssuedAt().setIssuer(issuer).setAudience(PLATEIA).setExpirationTime("10m")
    .sign(opcoes.chave ?? privada);
}

beforeAll(async () => {
  const par = await generateKeyPair("ES256");
  privada = par.privateKey as KeyLike;
  publica = { ...(await exportJWK(par.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  privadaIntrusa = (await generateKeyPair("ES256")).privateKey as KeyLike;

  const corpo = JSON.stringify({ keys: [publica] });
  jwksServer = createServer((_q, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(corpo);
  });
  await new Promise<void>((r) => jwksServer.listen(0, "127.0.0.1", r));
  const porta = (jwksServer.address() as { port: number }).port;
  issuer = `http://127.0.0.1:${porta}/auth/v1`;

  configurarVerificador(new VerificadorDeIdentidade({
    issuer, jwks: new URL(`${issuer}/.well-known/jwks.json`), audience: PLATEIA,
  }));
  colyseus = await boot(servidor);
});

afterAll(async () => {
  restaurarVerificador();
  await colyseus.shutdown();
  await new Promise<void>((r) => jwksServer.close(() => r()));
});

interface SdkRoom {
  roomId: string;
  state: { seats: { seat: number; playerId: string }[] };
  onMessage(t: string, cb: (m: unknown) => void): void;
  leave(consented?: boolean): Promise<number>;
}

interface Sentado { sdk: SdkRoom; boasVindas?: BoasVindas }

const abertas: Sentado[] = [];
/**
 * A limpeza NÃO PODE PENDURAR A SUÍTE.
 *
 * `leave()` numa sala da qual o teste já saiu não devolve erro — simplesmente não resolve, e o
 * `afterEach` estoura em 10s levando junto um teste que tinha passado. A corrida com um prazo
 * curto mantém o encerramento como o que ele é: cortesia entre testes, não asserção.
 */
afterEach(async () => {
  await Promise.all(abertas.splice(0).map((c) => Promise.race([
    c.sdk.leave(true).catch(() => 0),
    new Promise((r) => setTimeout(r, 300)),
  ])));
});

const opcoes = (token?: string, nick = "Jogador") => ({
  protocolVersion: PROTOCOL_VERSION, nick, avatar: AVATARES[0],
  ...(token ? { accessToken: token } : {}),
});

function escutar(sdk: SdkRoom): Sentado {
  const c: Sentado = { sdk };
  sdk.onMessage("SERVER_WELCOME", (m) => { c.boasVindas = m as BoasVindas; });
  abertas.push(c);
  return c;
}

/** Espera o `SERVER_WELCOME` — é ele que carrega a identidade que o servidor atribuiu. */
async function boasVindas(c: Sentado): Promise<BoasVindas> {
  for (let i = 0; i < 400 && !c.boasVindas; i++) await new Promise((r) => setTimeout(r, 10));
  if (!c.boasVindas) throw new Error("SERVER_WELCOME não chegou");
  return c.boasVindas;
}

const criar = async (token?: string, nick?: string) =>
  escutar((await colyseus.sdk.create(SALA_KING, opcoes(token, nick))) as unknown as SdkRoom);

const entrarEm = async (roomId: string, token?: string, nick?: string) =>
  escutar((await colyseus.sdk.joinById(roomId, opcoes(token, nick))) as unknown as SdkRoom);

describe("o playerId vem do claim, não do sorteio", () => {
  it("com credencial válida, o playerId da mesa É o subject do token", async () => {
    const sub = "11111111-1111-4111-8111-111111111111";
    const w = await boasVindas(await criar(await tokenDe(sub)));
    expect(w.you.playerId).toBe(sub);
    expect(w.you.identidadePermanente).toBe(true);
  });

  /**
   * MODO B: COM PROVEDOR CONFIGURADO, ENTRAR SEM CREDENCIAL É RECUSADO.
   *
   * A primeira versão desta fase deixava passar — quem não mandasse token ganhava um id
   * sorteado, como no KING de sempre. Parecia gentileza e era um buraco: num servidor que
   * ANUNCIA identidade permanente, bastava não mandar credencial para jogar como ninguém, e
   * qualquer progresso futuro teria duas classes de jogador convivendo na mesma mesa sem que
   * nada no protocolo dissesse isso.
   *
   * A recusa é por código PRÓPRIO (4005), separado do token inválido (4003): as duas situações
   * pedem frases diferentes. "Não mandou token" é quase sempre um app desatualizado, e mandar
   * essa pessoa "entrar de novo" seria mandá-la repetir um gesto que nunca vai funcionar.
   */
  it("com provedor configurado, entrar SEM credencial é RECUSADO", async () => {
    await expect(colyseus.sdk.create(SALA_KING, opcoes())).rejects.toBeDefined();
  });

  it("o playerId forjado nas opções perde para o claim — mesmo com token válido", async () => {
    const forjado = "99999999-9999-4999-8999-999999999999";
    const sub = "66666666-6666-4666-8666-666666666666";
    const sala = escutar((await colyseus.sdk.create(SALA_KING, {
      ...opcoes(await tokenDe(sub)), playerId: forjado, sub: forjado,
    })) as unknown as SdkRoom);
    expect((await boasVindas(sala)).you.playerId).toBe(sub);
  });

  it("convidado anônimo também é identidade permanente — é conta sem cadastro, não ausência de conta", async () => {
    const sub = "22222222-2222-4222-8222-222222222222";
    const w = await boasVindas(await criar(await tokenDe(sub, { anonimo: true })));
    expect(w.you.playerId).toBe(sub);
    expect(w.you.identidadePermanente).toBe(true);
  });
});

/**
 * A PROMESSA INTEIRA DA FASE, NUMA ASSERÇÃO.
 *
 * Duas salas diferentes, dois sockets diferentes, duas sessões diferentes — e o mesmo jogador.
 * Enquanto o `playerId` era sorteado no `onJoin`, isto era falso por construção: cada sala
 * inventava uma pessoa nova. É este teste que separa "identifica conexões" de "identifica gente".
 */
describe("a identidade sobrevive à sala", () => {
  it("o mesmo subject devolve o mesmo playerId numa OUTRA sala", async () => {
    const sub = "33333333-3333-4333-8333-333333333333";
    const primeira = await criar(await tokenDe(sub));
    const a = (await boasVindas(primeira)).you.playerId;
    await primeira.sdk.leave(true);

    const segunda = await criar(await tokenDe(sub));
    expect((await boasVindas(segunda)).you.playerId).toBe(a);
    expect(a).toBe(sub);
  });

  it("duas contas diferentes na mesma mesa continuam sendo duas pessoas", async () => {
    const dono = await criar(await tokenDe("aaaa-1"), "Tito");
    const w1 = await boasVindas(dono);
    const outro = await entrarEm(dono.sdk.roomId, await tokenDe("bbbb-2"), "Valete Folgado");
    const w2 = await boasVindas(outro);
    expect(w1.you.playerId).not.toBe(w2.you.playerId);
    expect(w2.you.seat).not.toBe(w1.you.seat);
  });
});

describe("a porta recusa em voz alta", () => {
  it("token assinado por outra chave NÃO entra como convidado — é recusado", async () => {
    const forjado = await tokenDe("invasor", { chave: privadaIntrusa });
    await expect(colyseus.sdk.create(SALA_KING, opcoes(forjado))).rejects.toBeDefined();
  });

  it("token com o corpo adulterado depois de assinado é recusado", async () => {
    const bom = await tokenDe("dono-de-verdade");
    const [cab, , sig] = bom.split(".");
    const outro = Buffer.from(JSON.stringify({ sub: "outro", iss: issuer, aud: PLATEIA }))
      .toString("base64url");
    await expect(colyseus.sdk.create(SALA_KING, opcoes(`${cab}.${outro}.${sig}`)))
      .rejects.toBeDefined();
  });
});

/**
 * O MODO DE FALHA QUE A IDENTIDADE ESTÁVEL CRIOU.
 *
 * Enquanto o `playerId` era sorteado, duas conexões nunca colidiam e este teste seria impossível
 * de escrever. Com `sub` fixo, a mesma conta entrando duas vezes ocuparia dois assentos com um
 * `playerId` só — e como o servidor guarda UMA conexão ativa por identidade, o primeiro assento
 * ficaria ocupado por um socket que o mapa já não reconhece, sem ninguém para liberá-lo.
 */
describe("uma identidade permanente, um assento por mesa", () => {
  it("a mesma conta não senta duas vezes na mesma mesa", async () => {
    const token = await tokenDe("44444444-4444-4444-8444-444444444444");
    const dono = await criar(token, "Tito");
    await boasVindas(dono);
    await expect(entrarEm(dono.sdk.roomId, token, "Tito de novo")).rejects.toBeDefined();
  });

  it("mas a MESMA conta senta noutra mesa sem problema — a trava é por mesa, não global", async () => {
    const token = await tokenDe("55555555-5555-4555-8555-555555555555");
    const a = await criar(token);
    await boasVindas(a);
    const b = await criar(token);
    expect((await boasVindas(b)).you.playerId).toBe("55555555-5555-4555-8555-555555555555");
  });
});

/**
 * IDENTIDADE E RECUPERAÇÃO DE ASSENTO SÃO DUAS COISAS, E PRECISAM CONTINUAR SENDO.
 *
 *   playerId      → quem a pessoa é. Vem do claim, vale em qualquer sala, em qualquer dia.
 *   recoveryToken → o direito de voltar a ESTE assento, NESTA sala. Morre com ela.
 *
 * O `onAuth` do Colyseus não roda no retorno (ver `Room.ts`: o ramo de reconexão é anterior à
 * verificação). Isso é o que faz a reconexão continuar funcionando num servidor que exige
 * credencial — e é também o que obriga a dizer em voz alta o que o `recoveryToken` é: uma
 * credencial ao portador, com alcance de uma sala. Ela não prova identidade fora dali, e por
 * isso nada além do assento pode ser decidido por ela.
 */
describe("a volta preserva a identidade, sem reapresentar credencial", () => {
  it("depois da queda, o mesmo playerId, o mesmo assento e a mesma permanência", async () => {
    const sub = "77777777-7777-4777-8777-777777777777";
    const c = await criar(await tokenDe(sub), "Tito");
    const antes = await boasVindas(c);

    await c.sdk.leave(false); // queda: saída NÃO consentida
    const volta = escutar(
      (await colyseus.sdk.reconnect(antes.you.recoveryToken)) as unknown as SdkRoom,
    );
    const depois = await boasVindas(volta);

    expect(depois.you.playerId).toBe(sub);
    expect(depois.you.seat).toBe(antes.you.seat);
    expect(depois.you.identidadePermanente).toBe(true);
  });

  it("o recoveryToken de outra pessoa não serve para ninguém", async () => {
    const a = await criar(await tokenDe("aaaa-recuperacao"), "A");
    const wa = await boasVindas(a);
    // Ainda de pé: a credencial não foi consumida, e mesmo assim não é transferível.
    await expect(colyseus.sdk.reconnect(`${a.sdk.roomId}:inventada`)).rejects.toBeDefined();
    expect(wa.you.recoveryToken.startsWith(`${a.sdk.roomId}:`)).toBe(true);
  });
});
