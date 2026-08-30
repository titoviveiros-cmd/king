// A VERIFICAÇÃO DE IDENTIDADE, EXERCITADA CONTRA TOKENS DE VERDADE.
//
// ══ POR QUE ESTE ARQUIVO NÃO USA MOCK ══
//
// Um teste que finge a verificação prova que o mock funciona. Aqui existe um par de chaves de
// verdade, gerado no `beforeAll`, um JWKS servido por um HTTP local, e tokens assinados de
// verdade — inclusive os inválidos. Quando este arquivo diz "recusou token expirado", ele
// realmente assinou um token com `exp` no passado e viu a biblioteca recusá-lo.
//
// É o que separa "cobre autenticação" de "cobre a chamada da biblioteca". Numa camada cujo
// trabalho inteiro é dizer não para o que parece certo, testar com o caminho feliz não é teste.
//
// ══ O QUE PRECISA CONTINUAR VERDADE ══
//
// Cada teste abaixo corresponde a uma forma de alguém entrar como quem não é. A lista veio dos
// modos de falha reais de JWT, não de imaginação: assinatura trocada, algoritmo confundido,
// emissor forjado, token vencido, token sem dono.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from "jose";
import {
  IdentidadeRecusada, VerificadorDeIdentidade, provedorDe, verificadorDoAmbiente,
} from "./identidade.js";

const EMISSOR = "http://127.0.0.1:PORTA/auth/v1";
const PLATEIA = "authenticated";

let privada: KeyLike;
let publica: JWK;
/** Um segundo par, para forjar tokens que NÃO estão no JWKS. */
let privadaIntrusa: KeyLike;
let servidor: Server;
let issuer: string;
let verificador: VerificadorDeIdentidade;

/** Assina um token com a chave legítima, salvo quando se pede o contrário. */
async function assinar(claims: Record<string, unknown>, opcoes: {
  chave?: KeyLike; iss?: string; aud?: string; exp?: string | number; alg?: string; kid?: string;
} = {}): Promise<string> {
  const j = new SignJWT(claims)
    .setProtectedHeader({ alg: opcoes.alg ?? "ES256", kid: opcoes.kid ?? publica.kid })
    .setIssuedAt()
    .setIssuer(opcoes.iss ?? issuer)
    .setAudience(opcoes.aud ?? PLATEIA);
  return await j.setExpirationTime(opcoes.exp ?? "10m").sign(opcoes.chave ?? privada);
}

beforeAll(async () => {
  const par = await generateKeyPair("ES256");
  privada = par.privateKey as KeyLike;
  publica = { ...(await exportJWK(par.publicKey)), kid: "chave-de-teste", alg: "ES256", use: "sig" };
  privadaIntrusa = (await generateKeyPair("ES256")).privateKey as KeyLike;

  const corpo = JSON.stringify({ keys: [publica] });
  servidor = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(corpo);
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
  const porta = (servidor.address() as { port: number }).port;
  issuer = EMISSOR.replace("PORTA", String(porta));
  verificador = new VerificadorDeIdentidade({
    issuer,
    jwks: new URL(`http://127.0.0.1:${porta}/auth/v1/.well-known/jwks.json`),
    audience: PLATEIA,
  });
});

afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

describe("o que o servidor ACEITA", () => {
  it("um token legítimo vira identidade, e o playerId é o subject", async () => {
    const token = await assinar({ sub: "11111111-1111-4111-8111-111111111111" });
    const id = await verificador.verificar(token);
    expect(id.playerId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("sessão anônima é identidade de CONVIDADO — real, sem conta", async () => {
    const token = await assinar({ sub: "guest-1", is_anonymous: true });
    const id = await verificador.verificar(token);
    expect(id.convidado).toBe(true);
    expect(id.provedor).toBe("guest");
  });

  it("sessão do Google é reconhecida pelo claim, não pelo caminho de código", async () => {
    const token = await assinar({ sub: "g-1", app_metadata: { provider: "google" } });
    const id = await verificador.verificar(token);
    expect(id.provedor).toBe("google");
    expect(id.convidado).toBe(false);
  });

  it("o MESMO subject devolve o MESMO playerId, quantas vezes for", async () => {
    const a = await verificador.verificar(await assinar({ sub: "estavel" }));
    const b = await verificador.verificar(await assinar({ sub: "estavel" }));
    expect(a.playerId).toBe(b.playerId);
  });

  it("subjects diferentes NUNCA colidem", async () => {
    const a = await verificador.verificar(await assinar({ sub: "pessoa-a" }));
    const b = await verificador.verificar(await assinar({ sub: "pessoa-b" }));
    expect(a.playerId).not.toBe(b.playerId);
  });
});

/**
 * O QUE O SERVIDOR RECUSA — e por QUAL motivo.
 *
 * Afirmar o motivo, e não só "deu erro", é o que impede uma implementação que recusa tudo de
 * passar neste bloco. Uma que recusasse o token legítimo também "recusaria" o adulterado.
 */
describe("o que o servidor RECUSA", () => {
  const recusa = async (fn: () => Promise<unknown>, motivo: string) => {
    await expect(fn()).rejects.toThrow(IdentidadeRecusada);
    await fn().catch((e: IdentidadeRecusada) => expect(e.motivo).toBe(motivo));
  };

  it("token nenhum", async () => {
    await recusa(() => verificador.verificar(undefined), "sem-token");
    await recusa(() => verificador.verificar(""), "sem-token");
  });

  it("token assinado por OUTRA chave — a que não está no JWKS", async () => {
    const forjado = await assinar({ sub: "invasor" }, { chave: privadaIntrusa });
    await recusa(() => verificador.verificar(forjado), "assinatura-invalida");
  });

  it("token com o corpo ADULTERADO depois de assinado", async () => {
    const bom = await assinar({ sub: "dono" });
    const [cab, , sig] = bom.split(".");
    const outroCorpo = Buffer.from(JSON.stringify({ sub: "outro", iss: issuer, aud: PLATEIA }))
      .toString("base64url");
    await recusa(() => verificador.verificar(`${cab}.${outroCorpo}.${sig}`), "assinatura-invalida");
  });

  it("token EXPIRADO", async () => {
    const vencido = await assinar({ sub: "atrasado" }, { exp: Math.floor(Date.now() / 1000) - 3600 });
    await recusa(() => verificador.verificar(vencido), "expirado");
  });

  it("token de OUTRO emissor", async () => {
    const outro = await assinar({ sub: "x" }, { iss: "https://emissor-falso.example/auth/v1" });
    await recusa(() => verificador.verificar(outro), "emissor-errado");
  });

  it("token sem SUBJECT — assinado certo, mas não diz de quem é", async () => {
    const anonimo = await assinar({ nome: "sem dono" });
    await recusa(() => verificador.verificar(anonimo), "sem-subject");
  });

  it("token com `alg: none` — o ataque clássico de confusão de algoritmo", async () => {
    const cab = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const corpo = Buffer.from(JSON.stringify({ sub: "invasor", iss: issuer, aud: PLATEIA }))
      .toString("base64url");
    await expect(verificador.verificar(`${cab}.${corpo}.`)).rejects.toThrow(IdentidadeRecusada);
  });

  it("lixo que nem parece token", async () => {
    await expect(verificador.verificar("nao-sou-um-jwt")).rejects.toThrow(IdentidadeRecusada);
  });
});

describe("a leitura do provedor", () => {
  it("anônimo vence qualquer outra marca — quem não tem conta é convidado", () => {
    expect(provedorDe({ is_anonymous: true, app_metadata: { provider: "google" } }).convidado)
      .toBe(true);
  });

  it("provedor que este servidor ainda não conhece não vira convidado por engano", () => {
    const r = provedorDe({ app_metadata: { provider: "facebook" } });
    expect(r.provedor).toBe("desconhecido");
    expect(r.convidado).toBe(false);
  });
});

/**
 * SEM CONFIGURAÇÃO, O KING CONTINUA O DE ANTES.
 *
 * A fase é aditiva de propósito: um servidor sem `SUPABASE_URL` atende exatamente como sempre
 * atendeu, com identidade efêmera por sala. É isso que permite implantar este código antes de
 * existir projeto Supabase, e é isso que impede a fase de virar um interruptor de tudo-ou-nada.
 */
describe("o ambiente decide se a identidade existe", () => {
  it("sem SUPABASE_URL não há verificador, e isso não é falha", () => {
    expect(verificadorDoAmbiente({})).toBeNull();
    expect(verificadorDoAmbiente({ SUPABASE_URL: "   " })).toBeNull();
  });

  it("com SUPABASE_URL o verificador nasce apontando para o JWKS do projeto", () => {
    const v = verificadorDoAmbiente({ SUPABASE_URL: "https://abc.supabase.co/" });
    expect(v).not.toBeNull();
  });
});

/**
 * HS256 É RECUSADO EXPLICITAMENTE — e não por acaso.
 *
 * É o algoritmo do ataque clássico de confusão: o token forjado chega dizendo `alg: HS256` e uma
 * verificação ingênua usa a chave PÚBLICA como se fosse segredo simétrico. A chave pública é,
 * por definição, de quem quiser. `jose` já recusa, e a asserção existe para que ninguém
 * "conserte" um projeto Supabase em configuração legada acrescentando HS256 à lista: o caminho
 * certo nesse caso é rotacionar o projeto para chave assimétrica.
 */
describe("HS256 nunca entra na lista", () => {
  it("token simétrico assinado com a própria chave pública é recusado", async () => {
    const segredo = new TextEncoder().encode(JSON.stringify(publica));
    const forjado = await new SignJWT({ sub: "invasor" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt().setIssuer(issuer).setAudience(PLATEIA).setExpirationTime("10m")
      .sign(segredo);
    await expect(verificador.verificar(forjado)).rejects.toThrow(IdentidadeRecusada);
    await verificador.verificar(forjado).catch((e: IdentidadeRecusada) => {
      expect(e.motivo).toBe("algoritmo-inaceitavel");
    });
  });
});
