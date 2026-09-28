// AQUISIÇÃO — a URL de entrada é do visitante; só sai dela o que vira categoria limpa.
import { describe, expect, it } from "vitest";
import { contextoDoPrimeiroToque, hostDoReferrer, lerToque, normalizarOrigem } from "./aquisicao.js";

const KING = "playkingcards.com.br";

describe("normalizarOrigem", () => {
  it("minúsculo, sem acento, espaço vira _", () => {
    expect(normalizarOrigem("Instagram")).toBe("instagram");
    expect(normalizarOrigem("  Promoção de Verão ")).toBe("promocao_de_verao");
    expect(normalizarOrigem("cpc+google")).toBe("cpc_google");
  });

  it("DESCARTA em vez de cortar: longo demais, caractere estranho, cara de id", () => {
    expect(normalizarOrigem("x".repeat(65))).toBeUndefined();
    expect(normalizarOrigem("<script>")).toBeUndefined();
    expect(normalizarOrigem("https://evil.com/a")).toBeUndefined();
    expect(normalizarOrigem("tito@example.com")).toBeUndefined();
    expect(normalizarOrigem("0315")).toBeUndefined();
    expect(normalizarOrigem("ca1380b2-1111-4111")).toBeUndefined();
    expect(normalizarOrigem("")).toBeUndefined();
    expect(normalizarOrigem(null)).toBeUndefined();
  });
});

describe("hostDoReferrer", () => {
  it("só o domínio, sem caminho nem query", () => {
    expect(hostDoReferrer("https://l.instagram.com/?u=https%3A%2F%2Fplaykingcards.com.br&e=abc", KING)).toBe("l.instagram.com");
    expect(hostDoReferrer("https://www.google.com/search?q=king+cartas", KING)).toBe("google.com");
  });

  it("app Android informa o pacote — também é origem", () => {
    expect(hostDoReferrer("android-app://com.google.android.gm/", KING)).toBe("com.google.android.gm");
  });

  it("navegação interna, vazio e não-web não são aquisição", () => {
    expect(hostDoReferrer("https://playkingcards.com.br/", KING)).toBeUndefined();
    expect(hostDoReferrer("https://www.playkingcards.com.br/x", KING)).toBeUndefined();
    expect(hostDoReferrer("", KING)).toBeUndefined();
    expect(hostDoReferrer("javascript:alert(1)", KING)).toBeUndefined();
    expect(hostDoReferrer("não é url", KING)).toBeUndefined();
  });
});

describe("lerToque", () => {
  it("lê as quatro utm e o referrer — e NADA mais da URL", () => {
    const t = lerToque(
      "?utm_source=Instagram&utm_medium=social&utm_campaign=Lançamento&utm_content=story_1&utm_term=cartas+king&nick=Tito&fbclid=IwAR123&codigo=0315",
      "https://l.instagram.com/",
      KING,
    );
    expect(t).toEqual({
      utm_source: "instagram", utm_medium: "social", utm_campaign: "lancamento", utm_content: "story_1",
      referrer_host: "l.instagram.com",
    });
    expect(JSON.stringify(t)).not.toMatch(/Tito|0315|IwAR|cartas/);
  });

  it("visita direta é um toque vazio", () => {
    expect(lerToque("", "", KING)).toEqual({});
  });
});

describe("contextoDoPrimeiroToque", () => {
  it("vira first_* — e utm_content fica só no app_open", () => {
    expect(contextoDoPrimeiroToque({ utm_source: "instagram", utm_campaign: "lancamento", utm_content: "story_1", referrer_host: "l.instagram.com" }))
      .toEqual({ first_utm_source: "instagram", first_utm_campaign: "lancamento", first_referrer_host: "l.instagram.com" });
    expect(contextoDoPrimeiroToque(undefined)).toEqual({});
  });
});
