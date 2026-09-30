// A PÁGINA DE PRIVACIDADE — o que ela PRECISA dizer, e o que ela NÃO pode fazer.
//
// É texto, mas é texto com consequência: ela descreve o que o código faz. Estes testes amarram a
// página aos fatos (fornecedor, região, o que é enviado, o que nunca é) e proíbem as duas formas
// de ela mentir sem ninguém ver: carregar recurso de terceiro (uma página de privacidade que mede
// quem a lê) e prometer um prazo de retenção que ainda não foi definido.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const HTML = readFileSync(new URL("../../public/privacidade.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");
/** O texto visível, sem marcação, com espaços normalizados. */
const TEXTO = HTML.replace(/<!--[\s\S]*?-->/g, "").replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

describe("o que a página precisa dizer", () => {
  it("responsável e contato", () => {
    expect(TEXTO).toContain("Tito Viveiros");
    expect(TEXTO).toMatch(/pessoa física/);
    expect(HTML).toContain('href="mailto:titoviveiros@gmail.com"');
  });

  it("finalidade, fornecedor e região", () => {
    expect(TEXTO).toMatch(/melhor/);
    expect(TEXTO).toContain("PostHog");
    expect(TEXTO).toMatch(/região US/);
  });

  it("identificador anônimo guardado no aparelho, sem ligação com a conta", () => {
    expect(TEXTO).toMatch(/Identificador anônimo/);
    expect(TEXTO).toMatch(/guarda no próprio aparelho/);
    expect(TEXTO).toMatch(/não tem ligação com a sua conta de jogo/);
  });

  it("eventos de uso, plataforma, ambiente e origem reduzida", () => {
    for (const t of ["Eventos de uso", "Plataforma", "Ambiente", "utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer_host"]) {
      expect(TEXTO, t).toContain(t);
    }
    expect(TEXTO).toMatch(/nunca o endereço completo/);
  });

  it("a configuração do PostHog: IP descartado e toda coleta automática desligada", () => {
    expect(TEXTO).toContain("Discard client IP data");
    for (const t of ["autocapture", "session replay", "heatmaps", "web vitals", "pageview/pageleave", "Captura automática de erros"]) {
      expect(TEXTO, t).toContain(t);
    }
    expect(TEXTO).toMatch(/não cria perfil pessoal identificado/);
  });

  it("a lista do que NUNCA é enviado está completa", () => {
    const nunca = HTML.slice(HTML.indexOf("NUNCA é enviado"), HTML.indexOf("</ul>", HTML.indexOf("NUNCA é enviado")));
    for (const t of ["apelido", "código da sala", "identificador da sala", "identificador de jogador", "conta (Supabase)",
      "e-mail", "tokens de acesso", "retorno à sala", "URL", "texto livre", "identificador da partida", "registro de XP"]) {
      expect(nunca, t).toContain(t);
    }
  });

  it("declara o GeoIP DESLIGADO e nega cada dado de localização (decisão de 30/09/2026)", () => {
    expect(TEXTO).toMatch(/Localização pelo IP \(\s*GeoIP\s*\):\s*desligada/);
    for (const t of ["nenhuma cidade", "nenhum estado", "nenhum código postal", "nenhuma coordenada"]) expect(TEXTO, t).toContain(t);
  });

  it("não volta a afirmar coleta de localização", () => {
    expect(TEXTO).not.toMatch(/localização aproximada|estimar uma localização|guarda essa estimativa|coordenadas aproximadas/i);
  });
});

describe("o que a página não pode fazer", () => {
  it("não carrega NADA de fora: sem script, sem fonte, sem estilo, sem imagem de terceiro", () => {
    expect(HTML).not.toMatch(/<script/i);
    expect(HTML).not.toMatch(/<link[^>]+rel="(stylesheet|preconnect|preload|icon)"/i);
    expect(HTML).not.toMatch(/@import|url\(\s*["']?https?:/i);
    expect(HTML).not.toMatch(/<(img|iframe|video|audio|source)[^>]+src="https?:/i);
    const externos = [...HTML.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
    expect(externos, "só o endereço canônico da própria página").toEqual(["https://playkingcards.com.br/privacidade"]);
  });

  // RETENÇÃO (decisão do Tito, 30/09/2026 — opção 2): texto FACTUAL, sem teto de exclusão. O
  // PostHog não oferece mecanismo que garanta apagar em 12 meses ("retention is not a deletion
  // tool"; o prazo não pode ser encurtado). O que é verdade — e só isso pode ser dito — é que o
  // plano atual CONSULTA até 12 meses, e que o fornecedor pode GUARDAR por mais tempo. Se um dia
  // houver garantia contratual/técnica de exclusão, estes testes mudam junto com a página.
  const JANELA = "janela de consulta dos eventos é de até 12 meses";

  it("retenção: diz que 12 meses é a JANELA DE CONSULTA do plano atual", () => {
    expect(TEXTO).toContain(`plano do PostHog cuja ${JANELA}`);
  });

  it("retenção: diz que NÃO é prazo de exclusão, que o fornecedor pode guardar por mais tempo e que o KING não controla isso", () => {
    expect(TEXTO).toMatch(/Isso não é um prazo de exclusão/);
    expect(TEXTO).toMatch(/pode manter esses dados armazenados por período superior/);
    expect(TEXTO).toMatch(/o KING não controla esse prazo técnico de exclusão/);
  });

  it("retenção: todo prazo citado na página é a janela de consulta — nenhum outro", () => {
    const frases = TEXTO.split(/(?<=[.!?])\s+/).filter((f) => /\b\d+\s*(dias?|mes(es)?|anos?|semanas?)\b/i.test(f));
    expect(frases.length).toBeGreaterThan(0);
    for (const f of frases) expect(f, "prazo fora da janela de consulta").toMatch(/janela de consulta|eventos dos últimos 12 meses/);
  });

  it("retenção: NENHUMA promessa de teto ou de exclusão em 12 meses", () => {
    for (const proibido of [
      /(apag|exclu|delet|remov|expurg)\w*\s+(automaticamente\s+)?(em|após|depois de|ao fim de)\s+\d+\s*(dias?|mes(es)?|anos?)/i,
      /(no\s+)?máximo\s+(de\s+)?\d+\s*(dias?|mes(es)?|anos?)/i,
      /retenção\s+máxima/i,
      /(retid|mantid|guardad|armazenad)\w*\s+por\s+(até|no máximo)\s+\d+/i,
      /retemos|guardamos por|garantimos/i,
    ]) {
      expect(TEXTO, String(proibido)).not.toMatch(proibido);
    }
  });

  it("não se apresenta como parecer jurídico nem usa promessa absoluta de segurança", () => {
    expect(TEXTO).not.toMatch(/100% segur|totalmente segur|garantimos/i);
  });

  it("tem caminho de volta para o jogo e data de atualização", () => {
    expect(HTML).toContain('href="/"');
    expect(TEXTO).toMatch(/Atualizado em \d{1,2} de [a-zç]+ de \d{4}/);
  });
});

describe("como se chega nela", () => {
  it("a Home tem o link, no rodapé, para o arquivo que existe na web e no app", async () => {
    const { Home } = await import("./Home.js");
    const props = { onStart: () => {}, onOpenAudio: () => {} } as unknown as Parameters<typeof Home>[0];
    const html = renderToStaticMarkup(createElement(Home, props));
    expect(html).toMatch(/<div class="foot">[^]*<a class="hm-privacidade" href="\/privacidade\.html">Privacidade<\/a><\/div>/);
  });

  it("a Vercel serve a URL limpa /privacidade ANTES da reescrita do jogo", () => {
    const v = JSON.parse(readFileSync(new URL("../../../../vercel.json", import.meta.url), "utf8")) as { rewrites: { source: string; destination: string }[] };
    expect(v.rewrites[0]).toEqual({ source: "/privacidade", destination: "/privacidade.html" });
    expect(v.rewrites.findIndex((r) => r.source === "/(.*)")).toBeGreaterThan(0);
  });
});
