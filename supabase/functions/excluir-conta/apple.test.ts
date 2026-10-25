// A REVOGAÇÃO DA APPLE — o client_secret e as duas chamadas, conferidos contra o formato oficial.
import { describe, expect, it } from "vitest";
import { exportPKCS8, generateKeyPair, jwtVerify, decodeProtectedHeader } from "jose";
import { revogarApple, segredoDoCliente } from "./apple.ts";

const chaves = await generateKeyPair("ES256", { extractable: true });
const CFG = { teamId: "TEAMID1234", keyId: "KEYID12345", clientId: "br.com.playkingcards.king", chavePrivada: await exportPKCS8(chaves.privateKey) };
const AGORA = Date.UTC(2026, 9, 25, 12, 0, 0);

describe("o client_secret (JWT ES256)", () => {
  it("é assinado com a chave .p8 e traz exatamente o que a Apple exige", async () => {
    const segredo = await segredoDoCliente(CFG, AGORA);
    expect(decodeProtectedHeader(segredo)).toEqual({ alg: "ES256", kid: "KEYID12345" });
    const { payload } = await jwtVerify(segredo, chaves.publicKey, { currentDate: new Date(AGORA + 1000) });
    expect(payload).toEqual({
      iss: "TEAMID1234",
      sub: "br.com.playkingcards.king",
      aud: "https://appleid.apple.com",
      iat: AGORA / 1000,
      exp: AGORA / 1000 + 300,
    });
  });

  it("uma assinatura adulterada não verifica (prova de que a verificação acima é real)", async () => {
    const segredo = await segredoDoCliente(CFG, AGORA);
    const [c, p, a] = segredo.split(".");
    const adulterado = `${c}.${p}.${a.slice(0, -2)}${a.endsWith("A") ? "B" : "A"}A`;
    await expect(jwtVerify(adulterado, chaves.publicKey, { currentDate: new Date(AGORA) })).rejects.toThrow();
  });
});

describe("troca e revogação", () => {
  const idToken = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.s`;
  const rede = (respostas: { token?: Response; revoke?: Response; cai?: boolean }) => {
    const pedidos: { url: string; corpo: URLSearchParams }[] = [];
    const f = (async (url: string | URL, init?: RequestInit) => {
      if (respostas.cai) throw new TypeError("fetch failed");
      pedidos.push({ url: String(url), corpo: new URLSearchParams(String(init?.body)) });
      return String(url).endsWith("/auth/token") ? respostas.token! : respostas.revoke ?? new Response(null, { status: 200 });
    }) as typeof fetch;
    return { f, pedidos };
  };

  it("sem refresh token, revoga o access token com a dica certa", async () => {
    const r = rede({ token: new Response(JSON.stringify({ access_token: "at", id_token: idToken("s1") })) });
    expect(await revogarApple(CFG, "codigo", "s1", r.f, AGORA)).toBe("revogada");
    expect(r.pedidos[1].corpo.get("token")).toBe("at");
    expect(r.pedidos[1].corpo.get("token_type_hint")).toBe("access_token");
    expect(r.pedidos[0].corpo.get("redirect_uri")).toBeNull();
  });

  it("revogação recusada, troca sem token, rede caída: \"falhou\" — nunca lança", async () => {
    expect(await revogarApple(CFG, "c", "s1", rede({ token: new Response(JSON.stringify({ refresh_token: "rt", id_token: idToken("s1") })), revoke: new Response("{}", { status: 400 }) }).f, AGORA)).toBe("falhou");
    expect(await revogarApple(CFG, "c", "s1", rede({ token: new Response(JSON.stringify({ id_token: idToken("s1") })) }).f, AGORA)).toBe("falhou");
    expect(await revogarApple(CFG, "c", "s1", rede({ cai: true }).f, AGORA)).toBe("falhou");
    expect(await revogarApple({ ...CFG, chavePrivada: "lixo" }, "c", "s1", rede({ token: new Response("{}") }).f, AGORA)).toBe("falhou");
  });

  it("sem configuração ou sem código, nem chama a Apple", async () => {
    const r = rede({});
    expect(await revogarApple(null, "c", "s1", r.f, AGORA)).toBe("nao-configurada");
    expect(await revogarApple(CFG, "", "s1", r.f, AGORA)).toBe("sem-codigo");
    expect(r.pedidos).toEqual([]);
  });
});
