// GERAR OS RECURSOS VISUAIS DO ANDROID — ícone (adaptativo, legado, redondo) e splash.
//
//   node scripts/gerar-recursos-android.mjs
//
// A FONTE é uma só: o ícone que o titular APROVOU (`apps/web/recursos-nativos/arte/`). O hash dele
// está fixado abaixo — trocar a arte por outra (a "v2 de sangria total", por exemplo, que segue
// pendente) exige mudar o hash aqui, num commit que diga quem aprovou. Sem isso, o script recusa.
//
// O que sai daqui é VERSIONADO em `apps/web/recursos-nativos/res-android/` e copiado para o
// projeto nativo pelo `preparar-mobile.mjs` a cada `mobile:sync` — a pasta `android/` é gerada e
// fica fora do git, então nada configurado só lá sobrevive.
//
// ÚNICA intervenção na arte: os cantos FORA do arredondado do emblema vinham pretos e opacos; aqui
// viram transparentes, recortados pela própria curva do emblema. Os pixels de dentro não mudam.
//
// Desenha com o Chromium do Playwright (já é dependência do repositório): redução em etapas de
// metade com `imageSmoothingQuality: high`, que é o que evita serrilhado no 48×48.
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = new URL("../apps/web/recursos-nativos/", import.meta.url);
const caminho = (p) => fileURLToPath(new URL(p, RAIZ));

/** O ícone aprovado pelo titular (KING branco sobre feltro verde, 512×512). */
const ARTE = "arte/king-icone-aprovado-512.png";
const SHA256_APROVADO = "66854c2564df33ed49b3fa85227dbb051ed3fd4a7679716db9629b2e70e51ac9";

/** Fundo do app (o mesmo `backgroundColor` do capacitor.config.ts): o splash não pisca outra cor. */
const FUNDO_DO_APP = "#140A24";

/**
 * Proporções, em unidades do ícone adaptativo (108 por lado, 72 visíveis, 66 de zona segura).
 * O emblema ocupa 68: a coroa, os naipes e o "KING" ficam dentro da zona segura em qualquer
 * máscara de launcher (círculo, squircle, quadrado arredondado).
 */
const ADAPTATIVO = { lado: 108, emblema: 68 };
/** Legado (API 24–25): 48 de lado, 46 de desenho. */
const LEGADO = { lado: 48, desenho: 46 };
/**
 * SPLASH (Android 7–11): NÃO é mais uma imagem de tela inteira. O Android ESTICA o bitmap de fundo
 * da janela para a tela — um PNG 3:2 num celular 20:9 achatava o emblema. Agora é uma `layer-list`
 * nativa: fundo de cor sólida + o emblema centralizado no tamanho dele (128 dp), sem escala. Em
 * 128 dp, o xxxhdpi (4×) é exatamente o 512 da arte aprovada: nenhuma densidade é ampliada.
 * (Android 12+ usa o splash do sistema, configurado no tema pelo preparar-mobile.mjs.)
 */
const SPLASH_EMBLEMA_DP = 128;

const DENSIDADES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const bruto = readFileSync(caminho(ARTE));
const sha = createHash("sha256").update(bruto).digest("hex");
if (sha !== SHA256_APROVADO) {
  console.error(`RECUSADO: ${ARTE} não é a arte aprovada (sha256 ${sha}).`);
  console.error("Trocar a arte exige aprovação do titular e a atualização de SHA256_APROVADO neste script.");
  process.exit(1);
}

const pedidos = [];
for (const [d, f] of Object.entries(DENSIDADES)) {
  pedidos.push({ tipo: "legado", arquivo: `res-android/mipmap-${d}/ic_launcher.png`, lado: Math.round(LEGADO.lado * f) });
  pedidos.push({ tipo: "redondo", arquivo: `res-android/mipmap-${d}/ic_launcher_round.png`, lado: Math.round(LEGADO.lado * f) });
  pedidos.push({ tipo: "frente", arquivo: `res-android/mipmap-${d}/ic_launcher_foreground.png`, lado: Math.round(ADAPTATIVO.lado * f) });
  pedidos.push({ tipo: "emblema", arquivo: `res-android/drawable-${d}/king_splash_emblema.png`, lado: Math.round(SPLASH_EMBLEMA_DP * f) });
}
pedidos.push({ tipo: "emblema", arquivo: "play-store/king-icone-play-512.png", lado: 512 });

const navegador = await chromium.launch();
const pagina = await navegador.newPage();
const resultado = await pagina.evaluate(async ({ b64, pedidos, ADAPTATIVO, LEGADO }) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const N = img.width;
  const base = new OffscreenCanvas(N, N);
  const gb = base.getContext("2d");
  gb.drawImage(img, 0, 0);
  const px = gb.getImageData(0, 0, N, N).data;
  const cor = (x, y) => { const i = (y * N + x) * 4; return [px[i], px[i + 1], px[i + 2]]; };

  // O raio do arredondado do emblema, medido na diagonal de cada canto: onde acaba o preto.
  const preto = ([r, g, b]) => r + g + b < 40;
  const cantos = [[0, 0, 1, 1], [N - 1, 0, -1, 1], [0, N - 1, 1, -1], [N - 1, N - 1, -1, -1]].map(([x0, y0, dx, dy]) => {
    let i = 0;
    while (i < N / 2 && preto(cor(x0 + dx * i, y0 + dy * i))) i++;
    return i;
  });
  const diagonal = Math.max(...cantos);
  const raio = diagonal / (1 - Math.SQRT1_2);

  // O emblema com os cantos transparentes, recortado pela própria curva.
  const emblema = new OffscreenCanvas(N, N);
  const ge = emblema.getContext("2d");
  ge.beginPath();
  ge.roundRect(0, 0, N, N, raio);
  ge.clip();
  ge.drawImage(img, 0, 0);

  // A cor de fundo do ícone adaptativo: a mediana da borda de dentro do emblema (o feltro escuro).
  const amostra = [];
  for (let t = Math.round(N / 3); t < Math.round((2 * N) / 3); t++) {
    for (let p = 4; p <= 10; p++) amostra.push(cor(p, t), cor(N - 1 - p, t), cor(t, p), cor(t, N - 1 - p));
  }
  const mediana = (k) => amostra.map((c) => c[k]).sort((a, b) => a - b)[Math.floor(amostra.length / 2)];
  const hex = (v) => v.toString(16).padStart(2, "0").toUpperCase();
  const fundoIcone = `#${hex(mediana(0))}${hex(mediana(1))}${hex(mediana(2))}`;

  /** Reduz em etapas de metade, como um bom reamostrador faria. */
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
  const centro = (g, lado, w, h) => { const e = reduzir(emblema, lado); g.drawImage(e, Math.round((w - lado) / 2), Math.round((h - lado) / 2)); };

  const saida = [];
  for (const p of pedidos) {
    let c;
    if (p.tipo === "legado") {
      c = new OffscreenCanvas(p.lado, p.lado);
      centro(c.getContext("2d"), Math.round((p.lado * LEGADO.desenho) / LEGADO.lado), p.lado, p.lado);
    } else if (p.tipo === "redondo") {
      // O que o launcher mostra numa máscara redonda: fundo + emblema na proporção do adaptativo.
      c = new OffscreenCanvas(p.lado, p.lado);
      const g = c.getContext("2d");
      const d = (p.lado * LEGADO.desenho) / LEGADO.lado;
      g.beginPath();
      g.arc(p.lado / 2, p.lado / 2, d / 2, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = fundoIcone;
      g.fillRect(0, 0, p.lado, p.lado);
      centro(g, Math.round((d * ADAPTATIVO.emblema) / 72), p.lado, p.lado);
    } else if (p.tipo === "frente") {
      c = new OffscreenCanvas(p.lado, p.lado);
      centro(c.getContext("2d"), Math.round((p.lado * ADAPTATIVO.emblema) / ADAPTATIVO.lado), p.lado, p.lado);
    } else {
      // O emblema sozinho, de cantos transparentes (splash e ícone da loja). No tamanho da arte, é ela.
      c = p.lado === N ? emblema : reduzir(emblema, p.lado);
    }
    const blob = await c.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    saida.push({ arquivo: p.arquivo, b64: btoa(s), w: c.width, h: c.height });
  }
  return { saida, cantos, raio, fundoIcone };
}, { b64: bruto.toString("base64"), pedidos, ADAPTATIVO, LEGADO });
await navegador.close();

// A pasta gerada é refeita do zero: nada de arquivo velho sobrando (como os splash.png esticados).
rmSync(caminho("res-android/"), { recursive: true, force: true });
for (const { arquivo, b64 } of resultado.saida) {
  mkdirSync(dirname(caminho(arquivo)), { recursive: true });
  writeFileSync(caminho(arquivo), Buffer.from(b64, "base64"));
}
const cores = (nome, valor) => `<?xml version="1.0" encoding="utf-8"?>
<!-- KING: gerado por scripts/gerar-recursos-android.mjs. Não editar à mão. -->
<resources>
${Object.entries(valor).map(([k, v]) => `    <color name="${k}">${v}</color>`).join("\n")}
</resources>
`;
mkdirSync(caminho("res-android/values/"), { recursive: true });
writeFileSync(caminho("res-android/values/ic_launcher_background.xml"), cores("ic_launcher_background", { ic_launcher_background: resultado.fundoIcone }));
writeFileSync(caminho("res-android/values/king_splash.xml"), cores("king_splash", { king_splash_fundo: FUNDO_DO_APP, king_splash_fundo_do_icone: resultado.fundoIcone }));
// O splash do Android 7–11: cor sólida + emblema centralizado em tamanho fixo. Nada estica.
mkdirSync(caminho("res-android/drawable/"), { recursive: true });
writeFileSync(caminho("res-android/drawable/king_splash.xml"), `<?xml version="1.0" encoding="utf-8"?>
<!-- KING: gerado por scripts/gerar-recursos-android.mjs. Não editar à mão.
     Fundo da janela até o app pintar (Android 7–11): cor do app + emblema no tamanho dele, centralizado. -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/king_splash_fundo" />
    <item>
        <bitmap android:gravity="center" android:src="@drawable/king_splash_emblema" />
    </item>
</layer-list>
`);

console.log(`\nRECURSOS ANDROID GERADOS a partir de ${ARTE} (sha256 ${sha.slice(0, 16)}…, aprovada)`);
console.log(`raio do arredondado medido: ${resultado.raio.toFixed(1)} px (diagonais ${resultado.cantos.join("/")}) · fundo do ícone ${resultado.fundoIcone}`);
for (const { arquivo, w, h } of resultado.saida) console.log(`  ${arquivo}  ${w}x${h}`);
