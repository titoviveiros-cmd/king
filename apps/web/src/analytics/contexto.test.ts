// CONTEXTO — plataforma, ambiente e tráfego. O erro caro aqui é tráfego de teste virar "real" e
// sujar o painel, ou um build feito à mão se passar por produção.
import { describe, expect, it } from "vitest";
import { detectarAmbiente, detectarPlataforma, detectarTrafego, marcaDeTrafegoNaUrl, temGanchosDeTeste } from "./contexto.js";

describe("plataforma", () => {
  it("sem o objeto do Capacitor é web", () => {
    expect(detectarPlataforma({})).toBe("web");
    expect(detectarPlataforma(undefined)).toBe("web");
  });

  it("o runtime nativo informa android/ios", () => {
    expect(detectarPlataforma({ Capacitor: { getPlatform: () => "android" } })).toBe("capacitor_android");
    expect(detectarPlataforma({ Capacitor: { getPlatform: () => "ios" } })).toBe("capacitor_ios");
    expect(detectarPlataforma({ Capacitor: { getPlatform: () => "web" } })).toBe("web");
  });

  it("objeto estranho não derruba", () => {
    expect(detectarPlataforma({ Capacitor: { getPlatform: () => { throw new Error("x"); } } })).toBe("web");
  });
});

describe("ambiente", () => {
  it("o declarado vence; depois o da Vercel; sem nada, development", () => {
    expect(detectarAmbiente("production", "preview")).toBe("production");
    expect(detectarAmbiente(undefined, "preview")).toBe("preview");
    expect(detectarAmbiente(undefined, "production")).toBe("production");
    expect(detectarAmbiente(undefined, "")).toBe("development");
    expect(detectarAmbiente()).toBe("development");
  });

  it("valor desconhecido NÃO vira produção", () => {
    expect(detectarAmbiente("prod", "staging")).toBe("development");
  });
});

describe("tráfego", () => {
  it("real só quando nenhum sinal de teste aparece", () => {
    expect(detectarTrafego({})).toBe("real");
    expect(detectarTrafego({ declarado: "", webdriver: false, marcado: false, ganchosDeTeste: false })).toBe("real");
  });

  it("QUALQUER sinal basta para ser teste", () => {
    expect(detectarTrafego({ declarado: "test" })).toBe("test");
    expect(detectarTrafego({ declarado: "teste" })).toBe("test");
    expect(detectarTrafego({ webdriver: true })).toBe("test");
    expect(detectarTrafego({ marcado: true })).toBe("test");
    expect(detectarTrafego({ ganchosDeTeste: true })).toBe("test");
  });

  it("?trafego=teste marca, ?trafego=real desmarca, o resto não faz nada", () => {
    expect(marcaDeTrafegoNaUrl("?trafego=teste")).toBe("teste");
    expect(marcaDeTrafegoNaUrl("?trafego=TEST")).toBe("teste");
    expect(marcaDeTrafegoNaUrl("?trafego=real")).toBe("real");
    expect(marcaDeTrafegoNaUrl("?trafego=talvez")).toBeNull();
    expect(marcaDeTrafegoNaUrl("")).toBeNull();
  });

  it("os ganchos do modo local (?seed, ?mao) são teste", () => {
    expect(temGanchosDeTeste("?seed=42&mao=10")).toBe(true);
    expect(temGanchosDeTeste("?mao=10")).toBe(true);
    expect(temGanchosDeTeste("?utm_source=instagram")).toBe(false);
  });
});
