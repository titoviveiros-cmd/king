// A IMAGEM DA PRÉVIA DO LINK (WhatsApp, Facebook, Telegram, X), feita a partir da arte final.
//
// Entrada: docs/arte/king-compartilhamento-arte-final.png — a arte como veio ("Rei das Cartas em
//          Festa", 1731×909): o rei segura o K de copas, que aparece UMA vez; as outras cartas
//          (A♠, Q♦, J♣, 10♠) também são únicas. A proporção dela (1,904) já é a do Open Graph
//          (1200×630 = 1,905): redimensiona inteira, sem corte (diferença de 0,03% na altura).
// Saída:   apps/web/public/king-social-v2-1200x630.jpg — JPEG baseline 1200×630, qualidade 85
//          (~180 kB). O WhatsApp descarta na prática og:image acima de ~300 kB; o script recusa
//          passar de 250 kB, para sobrar folga.
//
// REPRODUTÍVEL: quem redimensiona e codifica é o Chromium do Playwright fixado no package-lock, em
// modo software (--disable-gpu). Na MESMA plataforma, a mesma arte com o mesmo Playwright dá o mesmo
// arquivo, byte a byte (provado em Windows x64, Chromium 151.0.7922.34) — `--conferir` refaz a
// imagem em memória e compara com a versionada. Em outra plataforma o codificador pode variar sem
// defeito: a referência é a imagem versionada, com o sha256 travado em
// apps/web/src/ui/previaDoLink.test.ts.
//
// ARTE NOVA = ARQUIVO NOVO: trocar a entrada, subir a versão no nome da saída (v2 → v3: os apps
// guardam a prévia pelo endereço), rodar `node scripts/gerar-imagem-social.mjs`, atualizar
// og:image e twitter:image em apps/web/index.html e registrar o sha novo no teste.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raiz = (rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url));
const ENTRADA = "docs/arte/king-compartilhamento-arte-final.png";
const SAIDA = "apps/web/public/king-social-v2-1200x630.jpg";
const LARGURA = 1200;
const ALTURA = 630;
const QUALIDADE = 0.85;
const TETO = 250 * 1024;
const conferir = process.argv.includes("--conferir");

const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Largura e altura do quadro do JPEG (SOF), e se ele é baseline (SOF0). */
function quadroDoJpeg(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error("a saída não é JPEG");
  for (let i = 2; i + 9 <= b.length; ) {
    if (b[i] !== 0xff) throw new Error(`JPEG malformado no byte ${i}`);
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { baseline: m === 0xc0, altura: b.readUInt16BE(i + 5), largura: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error("JPEG sem quadro (SOF)");
}

const original = readFileSync(raiz(ENTRADA));
if (original.readUInt32BE(12) !== 0x49484452) throw new Error(`${ENTRADA} não é PNG`);
const [w, h] = [original.readUInt32BE(16), original.readUInt32BE(20)];
if (Math.abs(w / h / (LARGURA / ALTURA) - 1) > 0.01) {
  throw new Error(`a arte tem ${w}×${h}: a proporção foge mais de 1% da de ${LARGURA}×${ALTURA} — recortar antes`);
}

const { chromium } = createRequire(raiz("apps/web/package.json"))("playwright");
const navegador = await chromium.launch({ args: ["--disable-gpu"] });
const versao = navegador.version();
let jpeg;
try {
  const pagina = await navegador.newPage();
  const base64 = await pagina.evaluate(async ({ png, largura, altura, qualidade }) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const arte = await createImageBitmap(new Blob([bytes], { type: "image/png" }), {
      resizeWidth: largura, resizeHeight: altura, resizeQuality: "high",
    });
    const tela = new OffscreenCanvas(largura, altura);
    tela.getContext("2d").drawImage(arte, 0, 0);
    const saida = new Uint8Array(await (await tela.convertToBlob({ type: "image/jpeg", quality: qualidade })).arrayBuffer());
    let s = "";
    for (let i = 0; i < saida.length; i += 0x8000) s += String.fromCharCode(...saida.subarray(i, i + 0x8000));
    return btoa(s);
  }, { png: original.toString("base64"), largura: LARGURA, altura: ALTURA, qualidade: QUALIDADE });
  jpeg = Buffer.from(base64, "base64");
} finally {
  await navegador.close();
}

const quadro = quadroDoJpeg(jpeg);
if (quadro.largura !== LARGURA || quadro.altura !== ALTURA || !quadro.baseline) {
  throw new Error(`saída inesperada: ${quadro.largura}×${quadro.altura}, baseline=${quadro.baseline}`);
}
if (jpeg.length > TETO) throw new Error(`saída com ${jpeg.length} bytes: acima do teto de ${TETO}`);
console.log(`chromium ${versao}`);
console.log(`arte    ${ENTRADA}  ${w}×${h}  sha256 ${sha(original)}`);
if (conferir) {
  const versionada = readFileSync(raiz(SAIDA));
  const igual = versionada.equals(jpeg);
  console.log(`conferir ${SAIDA}: ${igual ? "IGUAL byte a byte" : `DIFERENTE (versionada ${sha(versionada).slice(0, 16)}…, refeita ${sha(jpeg).slice(0, 16)}…)`}`);
  if (!igual) process.exitCode = 1;
} else {
  writeFileSync(raiz(SAIDA), jpeg);
  console.log(`prévia  ${SAIDA}  ${LARGURA}×${ALTURA}  ${jpeg.length} B  sha256 ${sha(jpeg)}`);
}
