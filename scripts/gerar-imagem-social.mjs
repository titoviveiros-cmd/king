// A IMAGEM DA PRÉVIA DO LINK (WhatsApp, Facebook, Telegram, X, iMessage), feita a partir da arte
// APROVADA — a mesma do ícone do app Android e da ficha da Google Play.
//
//   node scripts/gerar-imagem-social.mjs              gera a imagem em apps/web/public/
//   node scripts/gerar-imagem-social.mjs --conferir   refaz em memória e compara byte a byte
//
// Entrada: apps/web/recursos-nativos/arte/king-icone-aprovado-512.png (hash conferido em
//          scripts/lib/identidade-web.mjs). Nada de personagem nem logotipo novo: o emblema
//          aprovado, inteiro e sem retoque, sobre as cores do próprio app (a noite do theme.css).
// Saída:   apps/web/public/king-social-v4-1200x630.jpg — JPEG baseline 1200×630, qualidade 85.
//
// SEM TEXTO NA IMAGEM: o convite fica no título e na descrição das metatags, que o app mostra
// embaixo da imagem. Assim nenhuma letra é cortada quando o app recorta a prévia.
// O emblema fica no CENTRO e cabe, com folga, no QUADRADO central de 630×630 (o recorte que o
// WhatsApp faz na prévia pequena): de 1200 de largura sobra o miolo de x = 285 a 915, e o emblema
// ocupa x = 360 a 840 (75 px de folga de cada lado). O fundo é da própria imagem, então ela é a
// mesma nos temas claro e escuro dos apps.
//
// O WhatsApp descarta na prática og:image acima de ~300 kB; o script recusa passar de 250 kB.
//
// REPRODUTÍVEL: quem desenha e codifica é o Chromium do Playwright fixado no package-lock, em
// modo software (--disable-gpu). Na MESMA plataforma sai o mesmo arquivo, byte a byte (provado em
// Windows x64, Chromium 151.0.7922.34). Em outra plataforma o codificador pode variar sem defeito:
// a referência é a imagem versionada, com o sha256 travado em apps/web/src/ui/previaDoLink.test.ts.
//
// ARTE NOVA = ARQUIVO NOVO: subir a versão no nome da saída (v4 → v5: os apps guardam a prévia
// pelo endereço), rodar o script, registrar a anterior como HISTÓRICA no teste (ela fica em
// public/ para as prévias já compartilhadas), atualizar og:image e twitter:image em
// apps/web/index.html e registrar o sha novo no teste.
import { readFileSync, writeFileSync } from "node:fs";
import { PREPARAR_EMBLEMA, abrirNavegador, arteAprovada, raiz, sha } from "./lib/identidade-web.mjs";

const SAIDA = "apps/web/public/king-social-v4-1200x630.jpg";
const LARGURA = 1200;
const ALTURA = 630;
/** Lado do emblema: cabe no quadrado central de 630 com 75 px de folga em cada lado. */
const LADO = 480;
const QUALIDADE = 0.85;
const TETO = 250 * 1024;
const conferir = process.argv.includes("--conferir");

if (LADO > ALTURA - 2 * 60) throw new Error(`emblema de ${LADO} px não deixa folga no quadrado central de ${ALTURA}`);

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

const bruto = arteAprovada();
const navegador = await abrirNavegador();
const versao = navegador.version();
let jpeg;
try {
  const pagina = await navegador.newPage();
  await pagina.evaluate(PREPARAR_EMBLEMA, bruto.toString("base64"));
  const base64 = await pagina.evaluate(async ({ largura, altura, lado, qualidade }) => {
    const { emblema, reduzir } = window.__emblema;
    const tela = document.createElement("canvas");
    tela.width = largura;
    tela.height = altura;
    const g = tela.getContext("2d");
    const cx = largura / 2, cy = altura / 2;
    // O fundo: a noite do app (--night #140a24 nas bordas, --surface2 #2d1a56 no centro).
    const fundo = g.createRadialGradient(cx, cy, 40, cx, cy, largura * 0.62);
    fundo.addColorStop(0, "#2d1a56");
    fundo.addColorStop(1, "#140a24");
    g.fillStyle = fundo;
    g.fillRect(0, 0, largura, altura);
    // O brilho dourado atrás do emblema (o dourado da coroa).
    const brilho = g.createRadialGradient(cx, cy, lado * 0.3, cx, cy, lado * 0.82);
    brilho.addColorStop(0, "rgba(255, 196, 64, 0.38)");
    brilho.addColorStop(1, "rgba(255, 196, 64, 0)");
    g.fillStyle = brilho;
    g.fillRect(0, 0, largura, altura);
    // O emblema aprovado, inteiro, com sombra.
    g.shadowColor = "rgba(0, 0, 0, 0.55)";
    g.shadowBlur = 28;
    g.shadowOffsetY = 10;
    g.imageSmoothingQuality = "high";
    g.drawImage(reduzir(emblema, lado), Math.round(cx - lado / 2), Math.round(cy - lado / 2));

    const blob = await new Promise((ok) => tela.toBlob(ok, "image/jpeg", qualidade));
    const saida = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < saida.length; i += 0x8000) s += String.fromCharCode(...saida.subarray(i, i + 0x8000));
    return btoa(s);
  }, { largura: LARGURA, altura: ALTURA, lado: LADO, qualidade: QUALIDADE });
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
console.log(`arte    sha256 ${sha(bruto).slice(0, 16)}… (aprovada) · emblema ${LADO}×${LADO} no centro`);
if (conferir) {
  const versionada = readFileSync(raiz(SAIDA));
  const igual = versionada.equals(jpeg);
  console.log(`conferir ${SAIDA}: ${igual ? "IGUAL byte a byte" : `DIFERENTE (versionada ${sha(versionada).slice(0, 16)}…, refeita ${sha(jpeg).slice(0, 16)}…)`}`);
  if (!igual) process.exitCode = 1;
} else {
  writeFileSync(raiz(SAIDA), jpeg);
  console.log(`prévia  ${SAIDA}  ${LARGURA}×${ALTURA}  ${jpeg.length} B  sha256 ${sha(jpeg)}`);
}
