// PREPARAR OS PROJETOS NATIVOS — configuração como CÓDIGO.
//
// `apps/web/android/` e `apps/web/ios/` são gerados por `npx cap add` e ficam FORA do git (ver
// .gitignore). Isso deixa o repositório limpo, mas cria um problema real: tudo que se configura
// à mão dentro deles se perde na próxima geração, e ninguém descobre até o app abrir de lado
// errado na mão de um revisor da loja.
//
// Este script resolve isso pelo lado certo: a configuração vive AQUI, versionada, e é aplicada
// de novo a cada geração. Ele é idempotente — rodar duas vezes não faz diferença.
//
//   npm run mobile:preparar
//
// O que ele NÃO faz: instalar SDK, compilar, assinar ou publicar. Compilar iOS exige macOS com
// Xcode e CocoaPods; este projeto vive no Windows, então o build de iOS roda em runner macOS de
// CI. O Android compila em qualquer runner Linux com o SDK.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RAIZ = new URL("../apps/web/", import.meta.url);
const caminho = (p) => fileURLToPath(new URL(p, RAIZ));

/**
 * VERSÃO — uma fonte, três destinos.
 *
 * A versão de marketing vem do `package.json` da RAIZ e é escrita nos dois projetos nativos.
 * Sem isto, Web, Android e iOS divergem em silêncio: aconteceu de verdade — o web dizia 0.1.0
 * enquanto `npx cap add` tinha carimbado 1.0 nos dois nativos, e ninguém repara até a loja
 * recusar um envio.
 *
 * O BUILD NUMBER é outra coisa: um inteiro que só cresce, exigido pelas lojas a cada envio, sem
 * relação com a versão visível. Vem de `KING_BUILD_NUMBER` (no CI, o número da execução serve);
 * sem ele, 1 — que é o certo para prova de compilação, onde nada é enviado.
 */
const VERSAO = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
).version;
const BUILD = String(Math.max(1, Math.trunc(Number(process.env.KING_BUILD_NUMBER)) || 1));

const feitos = [];
const pulados = [];

/** Aplica uma substituição só se ainda não estiver aplicada. Idempotente por construção. */
function ajustar(arquivo, rotulo, de, para, jaAplicado) {
  const alvo = caminho(arquivo);
  if (!existsSync(alvo)) { pulados.push(`${rotulo} — ${arquivo} não existe (rode "npx cap add" antes)`); return; }
  const antes = readFileSync(alvo, "utf8");
  if (jaAplicado(antes)) { feitos.push(`${rotulo} — já estava aplicado`); return; }
  if (!de.test(antes)) { pulados.push(`${rotulo} — âncora não encontrada em ${arquivo}`); return; }
  writeFileSync(alvo, antes.replace(de, para));
  feitos.push(`${rotulo} — aplicado`);
}

/** Como `ajustar`, mas troca TODAS as ocorrências: o Xcode repete chaves por configuração. */
function ajustarTodos(arquivo, rotulo, de, para) {
  const alvo = caminho(arquivo);
  if (!existsSync(alvo)) { pulados.push(`${rotulo} — ${arquivo} não existe (rode "npx cap add" antes)`); return; }
  const antes = readFileSync(alvo, "utf8");
  const quantas = (antes.match(de) ?? []).length;
  if (quantas === 0) { pulados.push(`${rotulo} — âncora não encontrada em ${arquivo}`); return; }
  const depois = antes.replace(de, para);
  if (depois === antes) { feitos.push(`${rotulo} — já estava aplicado`); return; }
  writeFileSync(alvo, depois);
  feitos.push(`${rotulo} — aplicado em ${quantas} ocorrência(s)`);
}

// ─────────────────────────── ANDROID ───────────────────────────
//
// O KING é landscape por decisão de design (13 cartas + 4 jogadores não cabem em retrato).
// `sensorLandscape` aceita as duas orientações deitadas, o que é o certo: quem joga com o
// celular apoiado gira para qualquer lado.
ajustar(
  "android/app/src/main/AndroidManifest.xml",
  "Android: travar em landscape",
  /(\n\s*android:name="\.MainActivity")/,
  '\n            android:screenOrientation="sensorLandscape"$1',
  (s) => s.includes("android:screenOrientation"),
);

ajustar(
  "android/app/build.gradle",
  `Android: versionName ${VERSAO}`,
  /versionName\s+"[^"]*"/,
  `versionName "${VERSAO}"`,
  (s) => s.includes(`versionName "${VERSAO}"`),
);

ajustar(
  "android/app/build.gradle",
  `Android: versionCode ${BUILD}`,
  /versionCode\s+\d+/,
  `versionCode ${BUILD}`,
  (s) => new RegExp(`versionCode\\s+${BUILD}\\b`).test(s),
);

// ─────────────────────────── iOS ───────────────────────────
//
// Mesma decisão de orientação, escrita do jeito da Apple. Retrato sai das duas listas —
// inclusive do iPad, onde o padrão do Capacitor permite tudo.
const LANDSCAPE_IOS = `<array>
		<string>UIInterfaceOrientationLandscapeLeft</string>
		<string>UIInterfaceOrientationLandscapeRight</string>
	</array>`;

ajustar(
  "ios/App/App/Info.plist",
  "iOS: travar em landscape (iPhone e iPad)",
  /<key>UISupportedInterfaceOrientations<\/key>\s*<array>[\s\S]*?<\/array>\s*<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>[\s\S]*?<\/array>/,
  `<key>UISupportedInterfaceOrientations</key>
	${LANDSCAPE_IOS}
	<key>UISupportedInterfaceOrientations~ipad</key>
	${LANDSCAPE_IOS}`,
  (s) => !s.includes("UIInterfaceOrientationPortrait"),
);

ajustarTodos(
  "ios/App/App.xcodeproj/project.pbxproj",
  `iOS: MARKETING_VERSION ${VERSAO}`,
  /MARKETING_VERSION = [^;]+;/g,
  `MARKETING_VERSION = ${VERSAO};`,
);

ajustarTodos(
  "ios/App/App.xcodeproj/project.pbxproj",
  `iOS: CURRENT_PROJECT_VERSION ${BUILD}`,
  /CURRENT_PROJECT_VERSION = [^;]+;/g,
  `CURRENT_PROJECT_VERSION = ${BUILD};`,
);

console.log("\nPREPARAÇÃO DOS PROJETOS NATIVOS");
console.log(`versão ${VERSAO} · build ${BUILD}\n`);
for (const f of feitos) console.log("  ok  " + f);
for (const p of pulados) console.log("  --  " + p);

if (pulados.length > 0) {
  console.log("\nNada foi quebrado: o que faltou é projeto nativo ainda não gerado.");
  console.log('Gere com: cd apps/web && npx cap add android && npx cap add ios\n');
}
console.log("Lembrete: ícone, splash e assinatura ainda não estão configurados.\n");
