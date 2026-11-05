// OS ÍCONES DO SITE — tela de início do iPhone/iPad, favicon e atalho do Android.
//
// Sem `<link rel="apple-touch-icon">` o iPhone pede /apple-touch-icon.png à raiz; a Vercel reescreve
// caminho desconhecido para o index.html com 200, o iOS recebe HTML e usa uma foto da página. O
// mesmo vale para /favicon.ico e /manifest.webmanifest. Estes testes amarram cada link do <head> a
// um arquivo que EXISTE em public/, é imagem de verdade (lida dos bytes, não do nome), tem o tamanho
// declarado e foi gerado da arte APROVADA — a mesma do ícone do app Android.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const WEB = fileURLToPath(new URL("../../", import.meta.url));
const RAIZ = join(WEB, "../../");
const PUBLICO = join(WEB, "public");
const HTML = readFileSync(join(WEB, "index.html"), "utf8");
/** O <head> como o navegador o enxerga: sem comentários (link comentado não vale). */
const HEAD = HTML.replace(/<!--[\s\S]*?-->/g, "").split(/<\/head>/i)[0];
const atributos = (tag: string): Record<string, string> =>
  Object.fromEntries([...tag.matchAll(/([a-zA-Z:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
const LINKS = [...HEAD.matchAll(/<link\b[^>]*>/gi)].map((m) => atributos(m[0]));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/**
 * O conteúdo de cada arquivo gerado por scripts/gerar-icones-web.mjs. NUNCA trocar um hash sem
 * gerar de novo a partir da arte aprovada (`node scripts/gerar-icones-web.mjs --conferir` diz se o
 * arquivo versionado é o que o script faz).
 */
const ICONES: Record<string, string> = {
  "apple-touch-icon.png": "8a5d2d0a8584f881a9a2f4a99d5a1620f3ae42d7af056512ac3e928c62d87dd1",
  "icon-192.png": "2c20cb241ee5fe9ea8b9c64c3f2ab350e64e9f028799b9fc552a5e35793c5493",
  "icon-512.png": "01aa927f556db3ff78160ef1bd385221b27e2f6b22a386f02e6c15afc7beee8d",
  "icon-maskable-512.png": "9ff1846a062782ea6b8d2fe90dcab5ba6d6401b1d76a2d6615b5bd0486f0da09",
  "favicon.ico": "03ab52ee463bb6198dfd653d144f44a153e08a0c9cf5297277e58793c73eaaea",
};

/** O link do <head> com este rel — e a garantia de que ele aparece UMA vez. */
function link(rel: string, extra: (l: Record<string, string>) => boolean = () => true): Record<string, string> {
  const achados = LINKS.filter((l) => l.rel === rel && extra(l));
  expect(achados, `<link rel="${rel}"> aparece uma vez`).toHaveLength(1);
  return achados[0];
}

/** O arquivo de public/ que um endereço do próprio site serve — e que ele existe. */
function arquivo(href: string): Buffer {
  expect(href, "endereço da raiz do site, sem domínio nem parâmetro").toMatch(/^\/[a-z0-9.-]+$/);
  const caminho = join(PUBLICO, href.slice(1));
  expect(existsSync(caminho), `${href} existe em public/ (senão a Vercel serve o index.html com 200)`).toBe(true);
  return readFileSync(caminho);
}

type Png = { largura: number; altura: number; tipoDeCor: number; profundidade: number; pixel: (x: number, y: number) => number[] };

/** Lê o PNG dos bytes: assinatura, IHDR e, para 8 bits RGB/RGBA sem entrelaçamento, os pixels. */
function lerPng(b: Buffer): Png {
  expect(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "assinatura PNG").toBe(true);
  expect(b.toString("ascii", 12, 16)).toBe("IHDR");
  const largura = b.readUInt32BE(16), altura = b.readUInt32BE(20), profundidade = b[24], tipoDeCor = b[25];
  const idat: Buffer[] = [];
  for (let i = 8; i < b.length; ) {
    const tam = b.readUInt32BE(i), tipo = b.toString("ascii", i + 4, i + 8);
    if (tipo === "IDAT") idat.push(b.subarray(i + 8, i + 8 + tam));
    i += 12 + tam;
  }
  expect(profundidade, "8 bits por canal").toBe(8);
  expect([2, 6], "RGB ou RGBA").toContain(tipoDeCor);
  expect(b[28], "sem entrelaçamento").toBe(0);
  const canais = tipoDeCor === 6 ? 4 : 3, passo = largura * canais;
  const cru = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(passo * altura);
  for (let y = 0; y < altura; y++) {
    const f = cru[y * (passo + 1)];
    for (let i = 0; i < passo; i++) {
      const v = cru[y * (passo + 1) + 1 + i];
      const a = i >= canais ? px[y * passo + i - canais] : 0;
      const c0 = y ? px[(y - 1) * passo + i] : 0;
      const c = y && i >= canais ? px[(y - 1) * passo + i - canais] : 0;
      const p = a + c0 - c, pa = Math.abs(p - a), pb = Math.abs(p - c0), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? c0 : f === 3 ? (a + c0) >> 1
        : pa <= pb && pa <= pc ? a : pb <= pc ? c0 : c;
      px[y * passo + i] = (v + pred) & 0xff;
    }
  }
  const pixel = (x: number, y: number) => [...px.subarray(y * passo + x * canais, y * passo + x * canais + canais)];
  return { largura, altura, tipoDeCor, profundidade, pixel };
}

/** O feltro escuro do emblema: o fundo do ícone adaptativo do Android (gerado da mesma arte). */
const FELTRO = readFileSync(join(WEB, "recursos-nativos/res-android/values/ic_launcher_background.xml"), "utf8")
  .match(/#([0-9A-F]{6})/)![1].match(/../g)!.map((h) => parseInt(h, 16));

describe("a fonte é a arte aprovada, a mesma do Android", () => {
  it("o gerador da web e o do Android fixam o mesmo hash, e a arte no repositório é ela", () => {
    const hash = (f: string) => readFileSync(join(RAIZ, f), "utf8").match(/SHA256_APROVADO = "([0-9a-f]{64})"/)![1];
    const web = hash("scripts/lib/identidade-web.mjs");
    expect(web).toBe(hash("scripts/gerar-recursos-android.mjs"));
    expect(sha(readFileSync(join(WEB, "recursos-nativos/arte/king-icone-aprovado-512.png")))).toBe(web);
  });

  it("cada ícone em public/ é o que o gerador faz (hash registrado), e não sobra ícone sem registro", () => {
    for (const [nome, h] of Object.entries(ICONES)) expect(sha(arquivo(`/${nome}`)), nome).toBe(h);
    const soltos = readdirSync(PUBLICO).filter((f) => /\.(png|ico|svg|webp)$/i.test(f) && !(f in ICONES));
    expect(soltos, "ícone em public/ fora do gerador").toEqual([]);
  });
});

describe("iPhone e iPad: apple-touch-icon", () => {
  it("declarado uma vez, 180×180", () => {
    expect(link("apple-touch-icon").sizes).toBe("180x180");
    expect(link("apple-touch-icon").href).toBe("/apple-touch-icon.png");
    expect(LINKS.filter((l) => l.rel === "apple-touch-icon-precomposed")).toEqual([]);
  });

  it("PNG 180×180 RGB SEM canal alfa (o iOS pinta de preto o que for transparente)", () => {
    const png = lerPng(arquivo(link("apple-touch-icon").href));
    expect([png.largura, png.altura]).toEqual([180, 180]);
    expect(png.tipoDeCor, "RGB, sem alfa").toBe(2);
  });

  it("os cantos são o feltro do emblema, não o preto da arte (o iOS arredonda por cima)", () => {
    const png = lerPng(arquivo(link("apple-touch-icon").href));
    for (const [x, y] of [[0, 0], [179, 0], [0, 179], [179, 179]]) {
      const [r, g, b] = png.pixel(x, y);
      expect(Math.abs(r - FELTRO[0]) + Math.abs(g - FELTRO[1]) + Math.abs(b - FELTRO[2]), `canto (${x},${y}) = ${[r, g, b]}`).toBeLessThanOrEqual(6);
    }
  });
});

describe("favicon do navegador", () => {
  it("favicon.ico declarado uma vez, com 16, 32 e 48 px (PNG dentro do ICO)", () => {
    const l = link("icon", (x) => x.href === "/favicon.ico");
    expect(l.sizes).toBe("16x16 32x32 48x48");
    const ico = arquivo(l.href);
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)], "cabeçalho ICO").toEqual([0, 1]);
    const n = ico.readUInt16LE(4);
    const lados = [];
    for (let i = 0; i < n; i++) {
      const e = 6 + 16 * i;
      const lado = ico[e] || 256;
      const png = lerPng(ico.subarray(ico.readUInt32LE(e + 12), ico.readUInt32LE(e + 12) + ico.readUInt32LE(e + 8)));
      expect([png.largura, png.altura], `entrada ${i}`).toEqual([lado, lado]);
      lados.push(lado);
    }
    expect(lados).toEqual([16, 32, 48]);
  });

  it("ícone PNG 192 declarado com o tamanho real", () => {
    const l = link("icon", (x) => x.href === "/icon-192.png");
    expect(l.type).toBe("image/png");
    const png = lerPng(arquivo(l.href));
    expect(`${png.largura}x${png.altura}`).toBe(l.sizes);
  });
});

describe("atalho do Android: manifest.webmanifest", () => {
  const href = () => link("manifest").href;
  const manifest = () => JSON.parse(arquivo(href()).toString("utf8"));

  it("nome KING, abre a raiz, em tela cheia (standalone), com as cores do app", () => {
    expect(href()).toBe("/manifest.webmanifest");
    const m = manifest();
    expect(m.name).toBe("KING");
    expect(m.short_name).toBe("KING");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.id).toBe("/");
    expect(m.display).toBe("standalone");
    expect(m.lang).toBe("pt-BR");
    const tema = HEAD.match(/<meta name="theme-color" content="(#[0-9a-f]{6})"/i)![1].toLowerCase();
    expect(m.theme_color).toBe(tema);
    expect(m.background_color).toBe(tema);
  });

  it("não fixa orientação: o RotateGate do app continua decidindo (paisagem)", () => {
    expect(manifest()).not.toHaveProperty("orientation");
  });

  it("cada ícone existe, é PNG do tamanho declarado; o maskable é opaco e o 'any' tem cantos transparentes", () => {
    const icones = manifest().icons as { src: string; sizes: string; type: string; purpose: string }[];
    expect(icones.map((i) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const i of icones) {
      expect(i.type).toBe("image/png");
      const png = lerPng(arquivo(i.src));
      expect(`${png.largura}x${png.altura}`, i.src).toBe(i.sizes);
      if (i.purpose === "maskable") {
        expect(png.tipoDeCor, `${i.src} opaco`).toBe(2);
      } else {
        expect(png.tipoDeCor, `${i.src} com alfa`).toBe(6);
        expect(png.pixel(0, 0)[3], `${i.src}: canto transparente`).toBe(0);
        expect(png.pixel(png.largura >> 1, png.altura >> 1)[3], `${i.src}: centro opaco`).toBe(255);
      }
    }
  });

  it("maskable: o emblema cabe no círculo de 80% (zona segura de qualquer máscara)", () => {
    const icone = (manifest().icons as { src: string; purpose: string }[]).find((i) => i.purpose === "maskable")!;
    const png = lerPng(arquivo(icone.src));
    const L = png.largura;
    // Fora do círculo de raio 40% só pode haver feltro: nada da coroa, dos naipes ou do "KING".
    for (let a = 0; a < 360; a += 5) {
      const t = (a * Math.PI) / 180;
      for (const r of [0.41, 0.45, 0.49]) {
        const x = Math.round(L / 2 + Math.cos(t) * r * L), y = Math.round(L / 2 + Math.sin(t) * r * L);
        const [cr, cg, cb] = png.pixel(Math.min(L - 1, x), Math.min(L - 1, y));
        expect(Math.abs(cr - FELTRO[0]) + Math.abs(cg - FELTRO[1]) + Math.abs(cb - FELTRO[2]), `(${x},${y})`).toBeLessThanOrEqual(6);
      }
    }
  });

  it("sem Service Worker nem cache offline", () => {
    expect(manifest()).not.toHaveProperty("serviceworker");
    expect(readdirSync(PUBLICO).filter((f) => /^(sw|service-worker|workbox)/i.test(f))).toEqual([]);
    const fontes = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? fontes(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);
    for (const f of fontes(join(WEB, "src"))) expect(readFileSync(f, "utf8"), f).not.toMatch(/serviceWorker\s*\.\s*register/);
    expect(readFileSync(join(WEB, "vite.config.ts"), "utf8")).not.toMatch(/vite-plugin-pwa|VitePWA/);
  });
});
