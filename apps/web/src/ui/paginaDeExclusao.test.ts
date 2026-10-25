// A PÁGINA PÚBLICA DE EXCLUSÃO (Fase 9) — o recurso na web que a Google Play exige, e o que ela
// promete sobre o app.
//
// Ela é texto com consequência: cita rótulos da tela ("Conta", "Excluir conta", EXCLUIR, "Excluir
// minha conta") e diz o que some e o que fica. Estes testes amarram a página ao CÓDIGO — o rótulo
// muda na tela, a página tem de mudar junto — e proíbem a página de carregar qualquer coisa de fora.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PALAVRA_DA_EXCLUSAO } from "./PainelConta.js";
import { CONFIRMACAO_DA_EXCLUSAO } from "../auth/exclusaoDeConta.js";

const ler = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const HTML = ler("../../public/excluir-conta.html");
const PRIVACIDADE = ler("../../public/privacidade.html");
const PAINEL = ler("./PainelConta.tsx");
const HOME = ler("./Home.tsx");
const VERCEL = JSON.parse(ler("../../../../vercel.json")) as { rewrites: { source: string; destination: string }[] };
const TEXTO = HTML.replace(/<!--[\s\S]*?-->/g, "").replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

describe("o que a Google Play pede da página", () => {
  it("nomeia o app e quem o desenvolve, como na loja", () => {
    expect(TEXTO).toMatch(/Excluir a sua conta do KING/);
    expect(TEXTO).toContain("desenvolvido por Tito Viveiros");
    expect(HTML).toContain('<link rel="canonical" href="https://playkingcards.com.br/excluir-conta" />');
  });

  it("dá o caminho no app e um caminho SEM o app (pedido por e-mail)", () => {
    expect(TEXTO).toMatch(/No app/);
    expect(TEXTO).toMatch(/Sem o app/);
    expect(HTML).toContain('href="mailto:titoviveiros@gmail.com?subject=Excluir%20conta%20KING"');
  });

  it("diz o que é excluído e o que fica", () => {
    for (const t of ["inclusive a de convidado", "Apelido, avatar, XP, nível, sequência", "vínculo com Google ou Apple"]) {
      expect(TEXTO, t).toContain(t);
    }
    expect(TEXTO).toMatch(/O que fica/);
    expect(TEXTO).toMatch(/sem nada que identifique você/);
  });

  it("não carrega NADA de fora: sem script, sem fonte, sem imagem de terceiro", () => {
    expect(HTML).not.toMatch(/<script/i);
    expect(HTML).not.toMatch(/<link[^>]+rel="(stylesheet|preconnect|preload|icon)"/i);
    expect(HTML).not.toMatch(/@import|url\(\s*["']?https?:/i);
    expect(HTML).not.toMatch(/<(img|iframe|video|audio|source)[^>]+src="https?:/i);
    expect(HTML).not.toMatch(/<form/i);
  });
});

describe("a página fala da MESMA tela que o app desenha", () => {
  it("a palavra de confirmação é a da tela e a do servidor", () => {
    expect(PALAVRA_DA_EXCLUSAO).toBe(CONFIRMACAO_DA_EXCLUSAO);
    expect(TEXTO).toContain(`Digite ${PALAVRA_DA_EXCLUSAO}`);
  });

  it("os rótulos citados existem na tela", () => {
    expect(HOME).toContain('aria-label="Conta"');
    expect(PAINEL).toContain("Excluir conta");
    expect(PAINEL).toContain('"Excluir minha conta"');
    expect(TEXTO).toContain("toque em Conta");
    expect(TEXTO).toContain("Toque em Excluir conta");
    expect(TEXTO).toContain("toque em Excluir minha conta");
  });
});

describe("o endereço público", () => {
  it("/excluir-conta é servida ANTES do catch-all do app", () => {
    const i = VERCEL.rewrites.findIndex((r) => r.source === "/excluir-conta");
    const tudo = VERCEL.rewrites.findIndex((r) => r.source === "/(.*)");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(VERCEL.rewrites[i].destination).toBe("/excluir-conta.html");
    expect(i).toBeLessThan(tudo);
  });

  it("a política de privacidade explica a exclusão e aponta para a página", () => {
    expect(PRIVACIDADE).toContain('<a href="/excluir-conta">');
    expect(PRIVACIDADE).toMatch(/Excluir a sua conta/);
    expect(PRIVACIDADE).toMatch(/Nenhum token do Google ou da Apple fica guardado/);
  });
});
