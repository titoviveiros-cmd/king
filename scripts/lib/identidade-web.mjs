// IDENTIDADE VISUAL DA WEB — o que os geradores dos ícones e da prévia do link têm em comum.
//
// A FONTE é uma só, a mesma do Android: o ícone que o titular APROVOU
// (`apps/web/recursos-nativos/arte/king-icone-aprovado-512.png`, KING branco sobre feltro verde).
// O hash é o MESMO fixado em `scripts/gerar-recursos-android.mjs`; trocar a arte exige aprovação e a
// troca dos dois (o teste `src/ui/identidadeWeb.test.ts` confere que eles batem).
//
// ÚNICA intervenção na arte, igual à do Android: os cantos FORA do arredondado do emblema vinham
// pretos e opacos e são recortados pela própria curva do emblema. Os pixels de dentro não mudam.
//
// Quem desenha é o Chromium do Playwright fixado no package-lock, em modo software (--disable-gpu).
// Os PNG são codificados AQUI (zlib do Node, sem metadados): o mesmo pixel dá o mesmo arquivo.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

export const raiz = (rel) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));

export const ARTE = "apps/web/recursos-nativos/arte/king-icone-aprovado-512.png";
export const SHA256_APROVADO = "66854c2564df33ed49b3fa85227dbb051ed3fd4a7679716db9629b2e70e51ac9";

export const sha = (b) => createHash("sha256").update(b).digest("hex");

/** A arte aprovada, recusando qualquer outra. */
export function arteAprovada() {
  const bruto = readFileSync(raiz(ARTE));
  const h = sha(bruto);
  if (h !== SHA256_APROVADO) {
    throw new Error(`RECUSADO: ${ARTE} não é a arte aprovada (sha256 ${h}). Trocar a arte exige aprovação do titular.`);
  }
  return bruto;
}

/** O Chromium do Playwright do repositório, em modo software. */
export async function abrirNavegador() {
  const { chromium } = createRequire(raiz("apps/web/package.json"))("playwright");
  return chromium.launch({ args: ["--disable-gpu"] });
}

/**
 * Código que roda DENTRO da página: monta `window.__emblema` (o emblema de cantos transparentes,
 * recortado pela curva medida, igual ao do Android), a cor do feltro escuro da borda e um
 * redutor em etapas de metade (o que evita serrilhado nos tamanhos pequenos).
 */
export const PREPARAR_EMBLEMA = async (b64) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const N = img.width;
  const base = new OffscreenCanvas(N, N);
  const gb = base.getContext("2d");
  gb.drawImage(img, 0, 0);
  const px = gb.getImageData(0, 0, N, N).data;
  const cor = (x, y) => { const i = (y * N + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };
  const preto = ([r, g, b]) => r + g + b < 40;
  const cantos = [[0, 0, 1, 1], [N - 1, 0, -1, 1], [0, N - 1, 1, -1], [N - 1, N - 1, -1, -1]].map(([x0, y0, dx, dy]) => {
    let i = 0;
    while (i < N / 2 && preto(cor(x0 + dx * i, y0 + dy * i))) i++;
    return i;
  });
  const raio = Math.max(...cantos) / (1 - Math.SQRT1_2);
  const emblema = new OffscreenCanvas(N, N);
  const ge = emblema.getContext("2d");
  ge.beginPath();
  ge.roundRect(0, 0, N, N, raio);
  ge.clip();
  ge.drawImage(img, 0, 0);
  // A cor do feltro escuro: a mediana da borda de dentro do emblema (a MESMA conta do Android, que
  // dá o fundo do ícone adaptativo).
  const amostra = [];
  for (let t = Math.round(N / 3); t < Math.round((2 * N) / 3); t++) {
    for (let p = 4; p <= 10; p++) amostra.push(cor(p, t), cor(N - 1 - p, t), cor(t, p), cor(t, N - 1 - p));
  }
  const mediana = (k) => amostra.map((c) => c[k]).sort((a, b) => a - b)[Math.floor(amostra.length / 2)];
  const hex = (v) => v.toString(16).padStart(2, "0").toUpperCase();
  const feltro = `#${hex(mediana(0))}${hex(mediana(1))}${hex(mediana(2))}`;
  function reduzir(fonte, lado) {
    let c = fonte;
    while (c.width / 2 >= lado) {
      const n = new OffscreenCanvas(Math.round(c.width / 2), Math.round(c.height / 2));
      const g = n.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(c, 0, 0, n.width, n.height);
      c = n;
    }
    const f = new OffscreenCanvas(lado, lado);
    const g = f.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(c, 0, 0, lado, lado);
    return f;
  }
  window.__emblema = { emblema, raio, cantos, feltro, reduzir, N };
  return { raio, cantos, feltro };
};

// ── PNG (codificado aqui) ────────────────────────────────────────────────────────────────────────

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, "ascii");
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([tam, t, dados, crc]);
}

/**
 * PNG de 8 bits a partir do RGBA da página. `opaco` grava RGB (tipo de cor 2, SEM canal alfa): é o
 * que o iOS espera do apple-touch-icon, e recusa se algum pixel não for opaco.
 */
export function codificarPng(rgba, largura, altura, { opaco = false } = {}) {
  const canais = opaco ? 3 : 4;
  const passo = largura * canais;
  const cruas = [];
  for (let y = 0; y < altura; y++) {
    const l = Buffer.alloc(passo);
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 4;
      if (opaco && rgba[i + 3] !== 255) throw new Error(`pixel (${x},${y}) não é opaco`);
      for (let k = 0; k < canais; k++) l[x * canais + k] = rgba[i + k];
    }
    cruas.push(l);
  }
  // Filtro por linha (o padrão do PNG): testa os 5 e fica com o de menor soma — determinístico.
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const vazia = Buffer.alloc(passo);
  const linhas = Buffer.concat(cruas.map((l, y) => {
    const cima = y ? cruas[y - 1] : vazia;
    let melhor = null, menor = Infinity;
    for (let f = 0; f < 5; f++) {
      const s = Buffer.alloc(passo + 1);
      s[0] = f;
      let soma = 0;
      for (let i = 0; i < passo; i++) {
        const a = i >= canais ? l[i - canais] : 0, b = cima[i], c = i >= canais ? cima[i - canais] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (l[i] - pred) & 0xff;
        s[i + 1] = v;
        soma += v < 128 ? v : 256 - v;
      }
      if (soma < menor) { menor = soma; melhor = s; }
    }
    return melhor;
  }));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = opaco ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr),
    bloco("IDAT", deflateSync(linhas, { level: 9 })),
    bloco("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO com PNGs dentro (aceito por todo navegador atual). */
export function codificarIco(pngs) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0);
  cabecalho.writeUInt16LE(1, 2);
  cabecalho.writeUInt16LE(pngs.length, 4);
  let deslocamento = 6 + 16 * pngs.length;
  const entradas = pngs.map(({ lado, png }) => {
    const e = Buffer.alloc(16);
    e[0] = lado >= 256 ? 0 : lado;
    e[1] = lado >= 256 ? 0 : lado;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(deslocamento, 12);
    deslocamento += png.length;
    return e;
  });
  return Buffer.concat([cabecalho, ...entradas, ...pngs.map((p) => p.png)]);
}
