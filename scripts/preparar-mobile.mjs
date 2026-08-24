// PREPARAR OS PROJETOS NATIVOS — configuração como CÓDIGO.
//
// `apps/web/android/` e `apps/web/ios/` são gerados por `npx cap add` e ficam FORA do git (ver
// .gitignore). Isso deixa o repositório limpo, mas cria um problema real: tudo que se configura
// à mão dentro deles — orientação, cor de fundo, permissões — se perde na próxima geração, e
// ninguém descobre até o app abrir de lado errado na mão de um revisor da loja.
//
// Este script resolve isso pelo lado certo: a configuração vive AQUI, versionada, e é aplicada
// de novo a cada geração. Ele é idempotente — rodar duas vezes não faz diferença.
//
//   npm run mobile:preparar
//
// O que ele NÃO faz: instalar SDK, compilar, assinar ou publicar. Compilar iOS exige macOS com
// Xcode e CocoaPods; este projeto vive no Windows, então o build de iOS depende de uma máquina
// Apple (ou de um runner de CI com macOS). O Android compila no Windows com Android Studio/JDK.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RAIZ = new URL("../apps/web/", import.meta.url);
const caminho = (p) => fileURLToPath(new URL(p, RAIZ));

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

// ─────────────────────────── iOS ───────────────────────────
//
// Mesma decisão, escrita do jeito da Apple. Retrato sai das duas listas — inclusive do iPad,
// onde o padrão do Capacitor permite tudo.
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

console.log("\nPREPARAÇÃO DOS PROJETOS NATIVOS\n");
for (const f of feitos) console.log("  ok  " + f);
for (const p of pulados) console.log("  --  " + p);

if (pulados.length > 0) {
  console.log("\nNada foi quebrado: o que faltou é projeto nativo ainda não gerado.");
  console.log('Gere com: cd apps/web && npx cap add android && npx cap add ios\n');
}
console.log("Lembrete: ícone, splash e assinatura ainda não estão configurados.\n");
