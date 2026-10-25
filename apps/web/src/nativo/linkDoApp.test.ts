// O CONVITE QUE ABRE O APP (Fase 9) — App Links / Universal Links, com o `@capacitor/app` trocado por
// uma dublê. O que se prova: só o domínio oficial vira convite; o resultado é só um código (nunca
// uma entrada na sala); o link da abertura chega uma vez, em qualquer ordem; e nada quebra sem plugin.
import { afterEach, describe, expect, it } from "vitest";
import { aoConviteDoApp, conviteDoArranqueDoApp, esquecerLinksDoApp, ouvirLinksDoApp, type PortaDoApp } from "./linkDoApp.js";

function appFalso(o: { abertura?: string | null; quebraAbertura?: boolean; semOuvinte?: boolean } = {}) {
  let ouvinte: ((e: { url?: string }) => void) | null = null;
  const app: PortaDoApp = {
    async getLaunchUrl() {
      if (o.quebraAbertura) throw new Error("plugin");
      return o.abertura ? { url: o.abertura } : undefined;
    },
    async addListener(_evento, fn) {
      if (o.semOuvinte) throw new Error("sem plugin");
      ouvinte = fn;
      return { remove: async () => { ouvinte = null; } };
    },
  };
  return { app, abrir: (url: string) => ouvinte?.({ url }) };
}

afterEach(() => esquecerLinksDoApp());

describe("o link que ABRE o app", () => {
  it("convite oficial vira um código para a Home — uma vez só", async () => {
    await ouvirLinksDoApp(appFalso({ abertura: "https://playkingcards.com.br/?sala=0315" }).app);
    expect(conviteDoArranqueDoApp()).toEqual({ codigo: "0315" });
    expect(conviteDoArranqueDoApp(), "consumido").toBeNull();
  });

  it("endereço que não é o oficial não vira nada", async () => {
    for (const url of [
      "http://playkingcards.com.br/?sala=0315",
      "https://playkingcards.com.br.evil.com/?sala=0315",
      "https://evil.com/?sala=0315&x=playkingcards.com.br",
      "https://user:senha@playkingcards.com.br/?sala=0315",
      "https://playkingcards.com.br:8443/?sala=0315",
      "king://sala/0315",
      "javascript:alert(1)",
    ]) {
      esquecerLinksDoApp();
      await ouvirLinksDoApp(appFalso({ abertura: url }).app);
      expect(conviteDoArranqueDoApp(), url).toBeNull();
    }
  });

  it("código inválido vira o AVISO de link inválido (como na web), nunca um código", async () => {
    await ouvirLinksDoApp(appFalso({ abertura: "https://playkingcards.com.br/?sala=12a4" }).app);
    expect(conviteDoArranqueDoApp()).toEqual({ invalido: true });
  });

  it("se a tela já leu antes de o link chegar, quem se inscreve recebe — nada se perde", async () => {
    const recebidos: unknown[] = [];
    expect(conviteDoArranqueDoApp()).toBeNull(); // a tela leu cedo demais
    aoConviteDoApp((c) => recebidos.push(c));
    await ouvirLinksDoApp(appFalso({ abertura: "https://playkingcards.com.br/?sala=4321" }).app);
    expect(recebidos).toEqual([{ codigo: "4321" }]);
  });

  it("e se o link chegou ANTES de alguém se inscrever, a inscrição o entrega", async () => {
    await ouvirLinksDoApp(appFalso({ abertura: "https://playkingcards.com.br/?sala=4321" }).app);
    const recebidos: unknown[] = [];
    aoConviteDoApp((c) => recebidos.push(c));
    expect(recebidos).toEqual([{ codigo: "4321" }]);
    expect(conviteDoArranqueDoApp()).toBeNull();
  });
});

describe("o link com o app já aberto", () => {
  it("chega a quem está inscrito; o evento RETIDO da própria abertura não duplica", async () => {
    const f = appFalso({ abertura: "https://playkingcards.com.br/?sala=0315" });
    await ouvirLinksDoApp(f.app);
    expect(conviteDoArranqueDoApp()).toEqual({ codigo: "0315" });
    const recebidos: unknown[] = [];
    aoConviteDoApp((c) => recebidos.push(c));
    f.abrir("https://playkingcards.com.br/?sala=0315"); // o mesmo da abertura (Android retém o evento)
    expect(recebidos).toEqual([]);
    f.abrir("https://playkingcards.com.br/?sala=9999");
    f.abrir("https://evil.com/?sala=1111");
    expect(recebidos).toEqual([{ codigo: "9999" }]);
  });

  it("cancelar a inscrição para de receber", async () => {
    const f = appFalso();
    await ouvirLinksDoApp(f.app);
    const recebidos: unknown[] = [];
    const parar = aoConviteDoApp((c) => recebidos.push(c));
    parar();
    f.abrir("https://playkingcards.com.br/?sala=0315");
    expect(recebidos).toEqual([]);
  });

  it("sem o plugin, ou com a abertura quebrando: nada lança, e o app abre normalmente", async () => {
    await expect(ouvirLinksDoApp(appFalso({ quebraAbertura: true, semOuvinte: true }).app)).resolves.toBeUndefined();
    expect(conviteDoArranqueDoApp()).toBeNull();
  });
});
