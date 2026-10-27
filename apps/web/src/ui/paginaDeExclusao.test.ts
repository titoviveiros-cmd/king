// A PÁGINA PÚBLICA DE EXCLUSÃO (Fase 9) — o recurso na web que a Google Play exige, e o que ela
// promete sobre o app.
//
// Ela é texto com consequência: cita rótulos da tela ("Conta", "Excluir conta", EXCLUIR, "Excluir
// minha conta") e diz o que some e o que fica. Estes testes amarram a página ao CÓDIGO — o rótulo
// muda na tela, a página tem de mudar junto — e proíbem a página de carregar qualquer coisa de fora.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PALAVRA_DA_EXCLUSAO, RETENCAO_DA_EXCLUSAO } from "./PainelConta.js";
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

  it("diz o que fica POR TEMPO LIMITADO (E-2): pseudônimo, 30 dias com a exceção da pendência, sem acesso público", () => {
    const item = TEXTO.slice(TEXTO.indexOf("Por um prazo normal de 30 dias"), TEXTO.indexOf("A medição de uso anônima"));
    for (const t of ["identificador técnico da conta excluída", "a data e a hora da exclusão", "partidas dos outros jogadores",
      "prestes a começar", "crédito de XP pendente", "registro técnico", "se participou", "Nada disso fica acessível ao público",
      "só se estende enquanto", "não puder ser confirmado com segurança", "pendência técnica ser resolvida", "são eliminadas"]) {
      expect(item, t).toContain(t);
    }
    expect(item).toContain("é um pseudônimo, e não um dado anônimo");
    expect(item.replace("não um dado anônimo", "")).not.toMatch(/anônim/i);
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

describe("a lápide (E-2): a tela do app e as duas páginas dizem a MESMA coisa", () => {
  const texto = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const i = PRIVACIDADE.indexOf('id="depois-da-exclusao"');
  const NA_POLITICA = texto(PRIVACIDADE.slice(PRIVACIDADE.indexOf(">", i) + 1, PRIVACIDADE.indexOf("</p>", i)));
  const NA_PAGINA = TEXTO.slice(TEXTO.indexOf("Por um prazo normal de 30 dias"), TEXTO.indexOf("A medição de uso anônima"));
  const NO_APP = RETENCAO_DA_EXCLUSAO;

  it("o quê: identificador TÉCNICO (nunca anônimo) e a data e a hora da exclusão", () => {
    for (const [onde, t] of [["app", NO_APP], ["privacidade", NA_POLITICA], ["excluir-conta", NA_PAGINA]]) {
      expect(t, onde).toContain("identificador técnico");
      expect(t.replace("não um dado anônimo", ""), onde).not.toMatch(/anônim/i);
    }
    // a tela diz "a data/hora", depois de "Após excluir a conta" (texto do titular); as páginas, por extenso
    expect(NO_APP).toMatch(/^Após excluir a conta, .*a data\/hora/);
    expect(NA_POLITICA).toContain("a data e a hora da exclusão");
    expect(NA_PAGINA).toContain("a data e a hora da exclusão");
  });

  it("para quê: concluir os créditos de XP — nas páginas, os dos OUTROS jogadores (o de quem excluiu some)", () => {
    expect(NO_APP).toMatch(/para concluir créditos de XP/);
    expect(NA_POLITICA).toMatch(/dos outros jogadores/);
    expect(NA_PAGINA).toMatch(/dos outros jogadores/);
  });

  it("por quanto tempo: 30 dias, e a pendência técnica estende — sem teto prometido", () => {
    for (const [onde, t] of [["app", NO_APP], ["privacidade", NA_POLITICA], ["excluir-conta", NA_PAGINA]]) {
      expect(t, onde).toContain("30 dias");
      expect(t, onde).toMatch(/pendência técnica|pendências técnicas/i);
      expect(t, onde, "o código nunca apaga ANTES de 30 dias: nada de \"até 30 dias\"").not.toMatch(/até 30 dias/);
      expect(t, onde, "com pendência não há teto a prometer").not.toMatch(/no máximo|prazo máximo/i);
    }
    // a tela: mantém por 30 dias, e a pendência estende ATÉ a resolução (texto do titular)
    expect(NO_APP).toMatch(/mantemos por 30 dias/);
    expect(NO_APP).toMatch(/Pendências técnicas podem estender esse prazo até a resolução\.$/);
    // as páginas: depois, elimina; a pendência só adia
    for (const [onde, t] of [["privacidade", NA_POLITICA], ["excluir-conta", NA_PAGINA]]) {
      expect(t, onde).toMatch(/apagad|eliminad/);
      expect(t, onde).toMatch(/apenas até essa pendência técnica ser resolvida/);
    }
  });

  it("no app, curta e sem \"só\" (com crédito pendente fica também o registro dele), sem linguagem de política", () => {
    // ≤ 180: o texto do titular (174) ocupa 3 linhas nas telas baixas; mais que isso perde a folga contra
    // a 4ª, que a tela compacta de 852×300 não comporta (medido; a régua de verdade é o e2e)
    expect(NO_APP.length).toBeLessThanOrEqual(180);
    expect(NO_APP).not.toMatch(/\bsó um\b|\bapenas um\b/);
    expect(NO_APP).not.toMatch(/titular|tratamento|LGPD|controlador|base legal/i);
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
