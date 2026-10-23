// O CONVITE POR LINK — o que entra, o que sai da barra de endereço, e em que ordem.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CHAMADA_DO_CONVITE, ORIGEM_DO_CONVITE, capturarConvite, conviteDoLinkDoApp, enderecoSemConvite, enviarConvite,
  lerConvite, linkDoConvite, textoDoConvite, type JanelaDoConvite,
} from "./convite.js";

describe("o link que ABRE O APP (App Link / Universal Link)", () => {
  it("o link oficial vira o código — e só o código (nunca uma entrada na sala)", () => {
    expect(conviteDoLinkDoApp("https://playkingcards.com.br/?sala=4821")).toEqual({ codigo: "4821" });
    expect(conviteDoLinkDoApp("https://PLAYKINGCARDS.com.br:443/qualquer?sala=0315#x")).toEqual({ codigo: "0315" });
    expect(conviteDoLinkDoApp(linkDoConvite("7342")!)).toEqual({ codigo: "7342" });
  });

  it("código que não é código continua inválido (o painel avisa), e sem parâmetro não há convite", () => {
    expect(conviteDoLinkDoApp("https://playkingcards.com.br/?sala=12ab")).toEqual({ invalido: true });
    expect(conviteDoLinkDoApp("https://playkingcards.com.br/?sala=1234&sala=5678")).toEqual({ invalido: true });
    expect(conviteDoLinkDoApp("https://playkingcards.com.br/")).toBeNull();
  });

  it("qualquer outra origem é ignorada: outro domínio, domínio parecido, http, esquema próprio, usuário embutido", () => {
    for (const url of [
      "https://evil.com/?sala=4821",
      "https://playkingcards.com.br.evil.com/?sala=4821",
      "https://evil-playkingcards.com.br/?sala=4821",
      "https://www.playkingcards.com.br/?sala=4821",
      "https://playkingcards.com.br@evil.com/?sala=4821",
      "https://tito@playkingcards.com.br/?sala=4821",
      "http://playkingcards.com.br/?sala=4821",
      "https://playkingcards.com.br:8443/?sala=4821",
      "king://sala/4821",
      "capacitor://localhost/?sala=4821",
      "https://localhost/?sala=4821",
      "javascript:alert(1)//?sala=4821",
      "não é url",
      "",
    ]) {
      expect(conviteDoLinkDoApp(url), url).toBeNull();
    }
  });
});

/** Uma janela de mentira: registra cada `replaceState` e anda a barra como o navegador andaria. */
function janela(href: string): JanelaDoConvite & { trocas: string[] } {
  const trocas: string[] = [];
  const j = {
    trocas,
    location: { href, search: new URL(href).search },
    history: {
      state: { king: "x" } as unknown,
      replaceState(_d: unknown, _u: string, url?: string | null) {
        trocas.push(String(url));
        const novo = new URL(String(url), j.location.href);
        j.location = { href: novo.href, search: novo.search };
      },
    },
  };
  return j;
}

describe("o que conta como convite", () => {
  it("quatro dígitos, e só isso", () => {
    expect(lerConvite("?sala=0315")).toEqual({ codigo: "0315" });
    expect(lerConvite("?sala=%200315%20")).toEqual({ codigo: "0315" });
    expect(lerConvite("?utm_source=whatsapp&sala=9999")).toEqual({ codigo: "9999" });
    expect(lerConvite("?sala=1234%0A"), "quebra de linha colada junto: só espaço em volta").toEqual({ codigo: "1234" });
  });

  it("sem o parâmetro, não há convite", () => {
    for (const s of ["", "?", "?v=3", "?utm_source=x", "?salas=1234", "?SALA=1234"]) expect(lerConvite(s), s).toBeNull();
  });

  it("qualquer outra coisa é convite INVÁLIDO — nunca vira URL, redirecionamento nem texto", () => {
    for (const s of [
      "?sala=", "?sala=123", "?sala=12345", "?sala=12a4", "?sala=0x12", "?sala=１２３４", "?sala=-123",
      "?sala=1234&sala=5678", "?sala=https%3A%2F%2Fexemplo.com", "?sala=%2F%2Fexemplo.com",
      `?sala=${"9".repeat(5000)}`, "?sala=%3Cscript%3E",
    ]) expect(lerConvite(s), s).toEqual({ invalido: true });
  });
});

describe("a limpeza da barra", () => {
  it("tira só o parâmetro do convite; os outros e o fragmento ficam", () => {
    expect(enderecoSemConvite("https://playkingcards.com.br/?sala=1234")).toBe("/");
    expect(enderecoSemConvite("https://playkingcards.com.br/?utm_source=wa&sala=1234&v=3#x")).toBe("/?utm_source=wa&v=3#x");
  });

  it("captura e APAGA na mesma chamada, com replaceState (sem recarregar, sem entrada nova no histórico)", () => {
    const j = janela("https://playkingcards.com.br/?sala=0315");
    expect(capturarConvite(j)).toEqual({ codigo: "0315" });
    expect(j.trocas).toEqual(["/"]);
    expect(j.location.href).toBe("https://playkingcards.com.br/");
    expect(j.location.href).not.toContain("0315");
  });

  it("link inválido também sai da barra", () => {
    const j = janela("https://playkingcards.com.br/?sala=abcd&utm_source=wa");
    expect(capturarConvite(j)).toEqual({ invalido: true });
    expect(j.location.href).toBe("https://playkingcards.com.br/?utm_source=wa");
  });

  it("sem convite, a barra não é tocada", () => {
    const j = janela("https://playkingcards.com.br/?utm_source=wa");
    expect(capturarConvite(j)).toBeNull();
    expect(j.trocas).toEqual([]);
  });

  it("histórico que recusa a troca não derruba nada", () => {
    const j = janela("https://playkingcards.com.br/?sala=0315");
    j.history.replaceState = () => { throw new Error("SecurityError"); };
    expect(capturarConvite(j)).toEqual({ codigo: "0315" });
    expect(capturarConvite(undefined)).toBeNull();
  });
});

describe("o link e o texto que o anfitrião manda", () => {
  it("o endereço canônico, no domínio público", () => {
    expect(ORIGEM_DO_CONVITE).toBe("https://playkingcards.com.br");
    expect(linkDoConvite("0315")).toBe("https://playkingcards.com.br/?sala=0315");
    for (const c of ["", "315", "03150", "abcd"]) expect(linkDoConvite(c), c).toBeNull();
  });

  it("o texto: convite curto, o link no fim, sem travessão", () => {
    const texto = textoDoConvite("https://playkingcards.com.br/?sala=0315");
    expect(texto).toBe("Vem jogar KING comigo 👑\nEntre na minha sala:\nhttps://playkingcards.com.br/?sala=0315");
    expect(`${texto}${CHAMADA_DO_CONVITE}`).not.toMatch(/[—–]/);
  });
});

describe("mandar o convite: folha de compartilhar, cópia, e quando nada funciona", () => {
  const LINK = "https://playkingcards.com.br/?sala=0315";
  const desistencia = () => Object.assign(new Error("cancelou"), { name: "AbortError" });

  it("com folha: o link vai no campo url, e o texto SEM o link (o WhatsApp repetiria)", async () => {
    const enviados: unknown[] = [];
    const copias: string[] = [];
    const r = await enviarConvite(LINK, {
      compartilhar: async (d) => { enviados.push(d); },
      copiar: async (t) => { copias.push(t); },
    });
    expect(r).toEqual({ ok: true, via: "folha", texto: "Enviado ✓" });
    expect(enviados).toEqual([{ title: "KING", text: CHAMADA_DO_CONVITE, url: LINK }]);
    expect(CHAMADA_DO_CONVITE).not.toContain("http");
    expect(copias, "compartilhou: não copia por cima").toEqual([]);
  });

  it("desistir da folha não é erro, e não vira cópia escondida", async () => {
    const copias: string[] = [];
    const r = await enviarConvite(LINK, { compartilhar: async () => { throw desistencia(); }, copiar: async (t) => { copias.push(t); } });
    expect(r).toBeNull();
    expect(copias).toEqual([]);
  });

  it("folha que recusa por outro motivo, ou que não existe: copia o texto inteiro", async () => {
    for (const compartilhar of [async () => { throw new Error("NotAllowedError"); }, undefined]) {
      const copias: string[] = [];
      const r = await enviarConvite(LINK, { compartilhar, copiar: async (t) => { copias.push(t); } });
      expect(r).toEqual({ ok: true, via: "copia", texto: "Copiado ✓" });
      expect(copias).toEqual([textoDoConvite(LINK)]);
    }
  });

  it("sem área de transferência (ou ela recusa): pede para ditar o código, sem lançar", async () => {
    expect(await enviarConvite(LINK, {})).toEqual({ ok: false, texto: "Dite o código" });
    expect(await enviarConvite(LINK, { copiar: async () => { throw new Error("NotAllowedError"); } }))
      .toEqual({ ok: false, texto: "Dite o código" });
  });
});

describe("a ORDEM: o convite sai da URL antes de o analytics ler a URL", () => {
  it("main.tsx captura o convite ANTES de iniciar o analytics e antes de desenhar o app", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const captura = main.indexOf("capturarConvite(");
    expect(captura, "main.tsx não captura o convite").toBeGreaterThan(-1);
    expect(captura).toBeLessThan(main.indexOf("iniciarAnalytics("));
    expect(captura).toBeLessThan(main.indexOf(".render("));
  });
});

describe("a volta de uma entrada que falhou não mexe na sala de verdade", () => {
  it("ModoOnline volta para a Home SEM sairDaSala: a recuperação (todas as abas) fica intacta", () => {
    const fonte = readFileSync(new URL("../ModoOnline.tsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const efeito = /if \(!falhou[\s\S]*?\}, \[[^\]]*\]\);/.exec(fonte)?.[0];
    expect(efeito, "o efeito da volta automática sumiu").toBeTruthy();
    expect(efeito).toContain("onSair({ codigo: entrada.codigo");
    expect(efeito).not.toMatch(/sairDaSala|esquecerRecuperacao/);
  });
});
