// A PRÉVIA DO LINK — o cartão que o WhatsApp (e Facebook, Telegram, X) monta quando alguém cola
// https://playkingcards.com.br numa conversa.
//
// Os robôs de prévia leem o HTML cru e NÃO rodam JavaScript: tudo precisa estar no `index.html`
// fixo, com endereço absoluto do domínio público. E a Vercel reescreve caminho desconhecido para o
// próprio index.html com 200 — um og:image apontando para arquivo que não existe não dá 404, dá
// HTML, e a prévia sai sem imagem sem ninguém ver. Estes testes amarram as metatags ao arquivo que
// existe de verdade, e ao que o WhatsApp aceita: JPEG 1200×630, bem abaixo dos ~300 kB.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SITE = "https://playkingcards.com.br/";
const WEB = fileURLToPath(new URL("../../", import.meta.url));
const HTML = readFileSync(join(WEB, "index.html"), "utf8");
/** O <head> como os robôs o enxergam: sem comentários (metatag comentada não vale). */
const HEAD = HTML.replace(/<!--[\s\S]*?-->/g, "").split(/<\/head>/i)[0];

const atributos = (tag: string): Record<string, string> =>
  Object.fromEntries([...tag.matchAll(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
const METAS = [...HEAD.matchAll(/<meta\b[^>]*>/gi)].map((m) => atributos(m[0]));

/** O conteúdo da metatag — e a garantia de que ela aparece UMA vez (duplicada, cada app escolhe uma). */
function meta(chave: string): string {
  const achadas = METAS.filter((m) => m.property === chave || m.name === chave);
  expect(achadas, `${chave} aparece uma vez`).toHaveLength(1);
  const conteudo = achadas[0].content ?? "";
  expect(conteudo.trim(), `${chave} preenchida`).not.toBe("");
  return conteudo;
}

/**
 * Cada versão da imagem e o seu conteúdo (sha256). NUNCA editar uma linha que já existe: os apps
 * guardam a prévia pelo endereço, então imagem nova = nome novo (v4) = linha nova aqui.
 */
const VERSOES_DA_IMAGEM: Record<string, string> = {
  // nunca publicada: o 10♠ da arte tinha 7 espadas
  "king-social-v2-1200x630.jpg": "4ad602096f69bee815aa021b7d4719bfa0c83ab5432df39be02b3af37575df2b",
  // a primeira publicada: K♥ uma vez só, na mão do rei; A♠, Q♦, J♣ e 10♠ únicos; 10♠ com 10 espadas
  "king-social-v3-1200x630.jpg": "8e897e7808b134519a277207c47190eaa167fbdf03c7772b6ddbbf73362abb26",
};
const RAIZ = join(WEB, "../../");

/** O arquivo de `public/` que a URL absoluta da imagem serve. */
const arquivoDaImagem = () => join(WEB, "public", meta("og:image").slice(SITE.length));

/** Marcador, largura e altura do quadro do JPEG (SOF) — lidos do arquivo, não do nome. */
function quadroDoJpeg(b: Buffer): { marcador: number; largura: number; altura: number } {
  expect(b[0] === 0xff && b[1] === 0xd8, "começa como JPEG (SOI)").toBe(true);
  for (let i = 2; i + 9 <= b.length; ) {
    expect(b[i], `marcador no byte ${i}`).toBe(0xff);
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { marcador: m, altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error("JPEG sem quadro (SOF)");
}

describe("as metatags estão no HTML fixo, uma vez cada", () => {
  it("título, descrição e canônico", () => {
    expect(HEAD.match(/<title>/gi)).toHaveLength(1);
    const canonicos = [...HEAD.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/gi)];
    expect(canonicos).toHaveLength(1);
    expect(atributos(canonicos[0][0]).href).toBe(SITE);
    meta("description");
  });

  it("Open Graph e cartão do X completos", () => {
    for (const chave of [
      "og:type", "og:locale", "og:title", "og:description", "og:url", "og:image", "og:image:type",
      "og:image:width", "og:image:height", "og:image:alt",
      "twitter:card", "twitter:title", "twitter:description", "twitter:image", "twitter:image:alt",
    ]) meta(chave);
  });

  it("o nome curto do app continua KING (o <title> longo é só da aba e da prévia)", () => {
    expect(meta("application-name")).toBe("KING");
    expect(meta("apple-mobile-web-app-title")).toBe("KING");
    // Sem manifest hoje. Se um chegar, name/short_name precisam dizer KING — e este teste, conferir.
    expect(HEAD, "manifest novo: conferir name/short_name = KING aqui").not.toMatch(/rel="manifest"/);
  });

  it("o charset vem antes de qualquer texto com acento", () => {
    expect(HEAD.indexOf('<meta charset="UTF-8" />')).toBeGreaterThan(-1);
    expect(HEAD.indexOf('<meta charset="UTF-8" />')).toBeLessThan(HEAD.indexOf("<title>"));
  });
});

describe("o que o cartão mostra", () => {
  it("o mesmo título e a mesma descrição no <title>, no og: e no twitter:", () => {
    const titulo = HEAD.match(/<title>([^<]*)<\/title>/i)![1];
    expect(titulo).toBe("KING: Jogue cartas com amigos");
    expect(meta("og:title")).toBe(titulo);
    expect(meta("twitter:title")).toBe(titulo);
    expect(meta("og:description")).toBe(meta("description"));
    expect(meta("twitter:description")).toBe(meta("description"));
    expect(meta("description")).toMatch(/cartas.*4 jogadores.*sala.*amigos/i);
  });

  it("nenhum travessão no que chega ao grupo (a mesma regra do texto do compartilhar)", () => {
    const publicos = [HEAD.match(/<title>([^<]*)<\/title>/i)![1], ...["description", "og:title", "og:description",
      "og:image:alt", "twitter:title", "twitter:description", "twitter:image:alt"].map(meta)];
    for (const t of publicos) expect(t, t).not.toMatch(/[—–]/);
  });

  it("cartão grande, site em português", () => {
    expect(meta("twitter:card")).toBe("summary_large_image");
    expect(meta("og:type")).toBe("website");
    expect(meta("og:locale")).toBe("pt_BR");
  });

  it("o texto alternativo descreve a arte certa: o rei com o K de copas", () => {
    expect(meta("og:image:alt")).toMatch(/K de copas/);
    expect(meta("twitter:image:alt")).toBe(meta("og:image:alt"));
  });
});

describe("endereços absolutos do domínio público", () => {
  it("og:url e canônico apontam para a home, em https", () => {
    expect(meta("og:url")).toBe(SITE);
  });

  it("og:image e twitter:image: a mesma URL absoluta, versionada, sem parâmetro", () => {
    expect(meta("og:image")).toMatch(/^https:\/\/playkingcards\.com\.br\/king-social-v\d+-1200x630\.jpg$/);
    expect(meta("twitter:image")).toBe(meta("og:image"));
  });
});

describe("a imagem existe e é o que as metatags dizem", () => {
  it("está em public/ — senão a Vercel serve o index.html com 200 no lugar dela", () => {
    expect(existsSync(arquivoDaImagem()), arquivoDaImagem()).toBe(true);
  });

  it("JPEG baseline do tamanho declarado: 1200×630", () => {
    const q = quadroDoJpeg(readFileSync(arquivoDaImagem()));
    expect(meta("og:image:type")).toBe("image/jpeg");
    expect(q.marcador, "baseline (SOF0), o JPEG que todo app lê").toBe(0xc0);
    expect([q.largura, q.altura]).toEqual([Number(meta("og:image:width")), Number(meta("og:image:height"))]);
    expect([q.largura, q.altura]).toEqual([1200, 630]);
  });

  it("peso com folga: até 250 kB (o WhatsApp descarta, na prática, imagem acima de ~300 kB)", () => {
    expect(statSync(arquivoDaImagem()).size).toBeLessThanOrEqual(250 * 1024);
  });

  it("o conteúdo é o da versão que o nome diz (imagem nova sem nome novo ficaria presa no cache)", () => {
    const nome = meta("og:image").slice(SITE.length);
    expect(VERSOES_DA_IMAGEM[nome], `${nome} registrada em VERSOES_DA_IMAGEM`).toBeDefined();
    expect(createHash("sha256").update(readFileSync(arquivoDaImagem())).digest("hex")).toBe(VERSOES_DA_IMAGEM[nome]);
  });

  it("uma imagem social só, a apontada — e nenhuma versão antiga citada no HTML, no script ou na documentação", () => {
    const nome = meta("og:image").slice(SITE.length);
    expect(readdirSync(join(WEB, "public")).filter((f) => f.startsWith("king-social-"))).toEqual([nome]);
    for (const f of ["apps/web/index.html", "docs/KING-PUBLICACAO.md", "scripts/gerar-imagem-social.mjs"]) {
      const citadas = [...readFileSync(join(RAIZ, f), "utf8").matchAll(/king-social-v\d+-1200x630\.jpg/g)].map((m) => m[0]);
      expect(citadas.filter((c) => c !== nome), f).toEqual([]);
    }
  });
});

describe("a prévia não depende de JavaScript", () => {
  it("nenhum código do app troca o título nem mexe nas metatags (sem duplicata, sem prévia que só existe no navegador)", () => {
    const fontes = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? fontes(join(dir, e.name))
        : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
    const lista = fontes(join(WEB, "src"));
    expect(lista.length).toBeGreaterThan(20);
    for (const f of lista) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/document\.title|document\.head|createElement\(\s*["']meta|react-helmet/);
    }
  });
});
