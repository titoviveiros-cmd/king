// OS ÍCONES DO SITE — tela de início do iPhone/iPad, favicon e atalho do Android (manifest).
//
//   node scripts/gerar-icones-web.mjs              gera em apps/web/public/
//   node scripts/gerar-icones-web.mjs --conferir   refaz em memória e compara byte a byte
//
// FONTE ÚNICA: a arte aprovada (ver scripts/lib/identidade-web.mjs), a mesma do ícone do Android.
//
// Por que existe: sem `<link rel="apple-touch-icon">`, o iPhone procura /apple-touch-icon.png e o
// /favicon.ico na raiz, e a Vercel reescreve caminho desconhecido para o index.html com 200 — o
// iOS recebe HTML, não imagem, e usa uma foto da página no lugar do ícone.
//
// Saídas (apps/web/public/):
//   apple-touch-icon.png    180×180, RGB SEM alfa (o iOS pinta de preto o que for transparente).
//                           O emblema ocupa o quadro todo; os cantos de fora do arredondado dele
//                           viram o feltro escuro, e quem arredonda é o iOS. Coroa, naipes e "KING"
//                           ficam longe dos cantos, fora do alcance da máscara.
//   icon-192.png, icon-512.png   o emblema de cantos transparentes (manifest, "any").
//   icon-maskable-512.png   feltro escuro + emblema na proporção do ícone adaptativo do Android
//                           (68 de 108): cabe no círculo de 80% de qualquer máscara.
//   favicon.ico             16, 32 e 48 px (PNG dentro do ICO), cantos transparentes.
import { readFileSync, writeFileSync } from "node:fs";
import {
  PREPARAR_EMBLEMA, abrirNavegador, arteAprovada, codificarIco, codificarPng, raiz, sha,
} from "./lib/identidade-web.mjs";

const PUBLICO = "apps/web/public/";
/** Proporção do emblema no ícone adaptativo do Android (scripts/gerar-recursos-android.mjs). */
const ADAPTATIVO = { lado: 108, emblema: 68 };
const conferir = process.argv.includes("--conferir");

const pedidos = [
  { nome: "apple", tipo: "cheio", lado: 180 },
  { nome: "192", tipo: "emblema", lado: 192 },
  { nome: "512", tipo: "emblema", lado: 512 },
  { nome: "maskable", tipo: "adaptativo", lado: 512 },
  { nome: "ico16", tipo: "emblema", lado: 16 },
  { nome: "ico32", tipo: "emblema", lado: 32 },
  { nome: "ico48", tipo: "emblema", lado: 48 },
];

const bruto = arteAprovada();
const navegador = await abrirNavegador();
const versao = navegador.version();
let medidas;
const pixels = {};
try {
  const pagina = await navegador.newPage();
  medidas = await pagina.evaluate(PREPARAR_EMBLEMA, bruto.toString("base64"));
  for (const p of pedidos) {
    const b64 = await pagina.evaluate(({ tipo, lado, ADAPTATIVO }) => {
      const { emblema, feltro, reduzir } = window.__emblema;
      const c = new OffscreenCanvas(lado, lado);
      const g = c.getContext("2d");
      if (tipo === "cheio" || tipo === "adaptativo") {
        g.fillStyle = feltro;
        g.fillRect(0, 0, lado, lado);
      }
      const e = tipo === "adaptativo" ? Math.round((lado * ADAPTATIVO.emblema) / ADAPTATIVO.lado) : lado;
      g.drawImage(reduzir(emblema, e), Math.round((lado - e) / 2), Math.round((lado - e) / 2));
      const d = g.getImageData(0, 0, lado, lado).data;
      let s = "";
      for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
      return btoa(s);
    }, { tipo: p.tipo, lado: p.lado, ADAPTATIVO });
    pixels[p.nome] = Buffer.from(b64, "base64");
  }
} finally {
  await navegador.close();
}

const png = (nome, lado, opcoes) => codificarPng(pixels[nome], lado, lado, opcoes);
const saidas = {
  "apple-touch-icon.png": png("apple", 180, { opaco: true }),
  "icon-192.png": png("192", 192),
  "icon-512.png": png("512", 512),
  "icon-maskable-512.png": png("maskable", 512, { opaco: true }),
  "favicon.ico": codificarIco([16, 32, 48].map((lado) => ({ lado, png: png(`ico${lado}`, lado) }))),
};

console.log(`chromium ${versao}`);
console.log(`arte     sha256 ${sha(bruto).slice(0, 16)}… (aprovada) · raio ${medidas.raio.toFixed(1)} px · feltro ${medidas.feltro}`);
let diferentes = 0;
for (const [arquivo, bytes] of Object.entries(saidas)) {
  const destino = raiz(PUBLICO + arquivo);
  if (conferir) {
    const igual = readFileSync(destino).equals(bytes);
    if (!igual) diferentes++;
    console.log(`conferir ${arquivo}: ${igual ? "IGUAL byte a byte" : "DIFERENTE"}`);
  } else {
    writeFileSync(destino, bytes);
    console.log(`${arquivo.padEnd(22)} ${String(bytes.length).padStart(7)} B  sha256 ${sha(bytes)}`);
  }
}
if (diferentes) process.exitCode = 1;
