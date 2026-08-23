/**
 * ENDEREÇO DO SERVIDOR — a regra de configuração da Fase 8.
 *
 * O que precisa ficar travado por teste: **produção/preview NUNCA inventa endereço**. Se a
 * variável não estiver publicada, o multiplayer fica indisponível com uma explicação, e o modo
 * local/bots continua funcionando. Nenhum endereço de produção existe em código.
 */
import { describe, it, expect } from "vitest";
import { paraWebSocket, resolverServidor } from "./servidor.js";

const PROD = { dev: false, host: "king.example", protocolo: "https:" };
const DEV = { dev: true, host: "localhost", protocolo: "http:" };

describe("resolverServidor", () => {
  it("a variável manda, sempre", () => {
    const r = resolverServidor({ ...PROD, variavel: "wss://king-abc.colyseus.cloud" });
    expect(r).toEqual({ ok: true, url: "wss://king-abc.colyseus.cloud", origem: "variavel" });
  });

  it("em produção SEM variável não inventa endereço nenhum", () => {
    const r = resolverServidor(PROD);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toContain("VITE_KING_SERVER_URL");
      // e diz explicitamente que dá para continuar jogando
      expect(r.motivo).toContain("bots");
    }
  });

  it("em desenvolvimento sem variável cai no servidor local, no MESMO host da página", () => {
    expect(resolverServidor(DEV)).toEqual({ ok: true, url: "ws://localhost:2567", origem: "desenvolvimento" });
    // celular no mesmo Wi-Fi: o Vite serve por IP, e o servidor tem de acompanhar
    expect(resolverServidor({ ...DEV, host: "192.168.0.14" }))
      .toEqual({ ok: true, url: "ws://192.168.0.14:2567", origem: "desenvolvimento" });
  });

  it("página em https usa wss também no fallback local", () => {
    expect(resolverServidor({ ...DEV, protocolo: "https:" }))
      .toMatchObject({ ok: true, url: "wss://localhost:2567" });
  });

  it("variável vazia ou só espaços conta como ausente", () => {
    expect(resolverServidor({ ...PROD, variavel: "   " }).ok).toBe(false);
    expect(resolverServidor({ ...PROD, variavel: "" }).ok).toBe(false);
  });
});

describe("paraWebSocket", () => {
  it("converte http/https e preserva ws/wss", () => {
    expect(paraWebSocket("https://a.b")).toBe("wss://a.b");
    expect(paraWebSocket("http://a.b")).toBe("ws://a.b");
    expect(paraWebSocket("wss://a.b")).toBe("wss://a.b");
    expect(paraWebSocket("ws://a.b")).toBe("ws://a.b");
  });

  it("sem esquema assume TLS — que é o que o Colyseus Cloud entrega", () => {
    expect(paraWebSocket("king-abc.colyseus.cloud")).toBe("wss://king-abc.colyseus.cloud");
  });

  it("tira barra final e espaços", () => {
    expect(paraWebSocket("  https://a.b//  ")).toBe("wss://a.b");
  });
});
