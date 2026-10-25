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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { variavelDoBuild } from "./lib/ambiente-vite.mjs";
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
/** Escolhas de configuração que valem registrar, mas não são projeto nativo faltando. */
const avisos = [];

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

/** Um arquivo inteiro que é NOSSO (não do modelo do Capacitor): grava se faltar ou divergir. */
function escrever(arquivo, rotulo, conteudo) {
  const pasta = caminho(arquivo.slice(0, arquivo.lastIndexOf("/") + 1));
  if (!existsSync(caminho(arquivo.split("/")[0] + "/"))) { pulados.push(`${rotulo} — ${arquivo.split("/")[0]}/ não existe (rode "npx cap add" antes)`); return; }
  const alvo = caminho(arquivo);
  if (existsSync(alvo) && readFileSync(alvo, "utf8") === conteudo) { feitos.push(`${rotulo} — já estava aplicado`); return; }
  mkdirSync(pasta, { recursive: true });
  writeFileSync(alvo, conteudo);
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

// BACKUP: a sessão do convidado não pode ser CLONADA. O WebView guarda em `app_webview/` o
// localStorage — inclusive a sessão do Supabase, com o refresh token do convidado. Com o backup
// padrão do Android, restaurar num segundo aparelho (ou a transferência entre aparelhos, que no
// Android 12+ não obedece a `allowBackup`) CLONA a identidade: os dois renovam o mesmo token, o
// Supabase detecta o reuso e derruba os dois (red team da Fase 8). O progresso acompanha o jogador
// pela conta vinculada (Google/Apple), não pela cópia do aparelho.
// FASE 9: a sessão saiu do WebView para o COFRE (`@aparajita/capacitor-secure-storage`), que no Android
// é um SharedPreferences cifrado com chave do Keystore. A chave nunca sai do aparelho — um arquivo
// restaurado noutro aparelho não decifraria —, mas o arquivo cifrado também fica fora: nada de
// identidade viaja por backup. A exclusão do WebView continua, para o que um build antigo deixou lá.
//
// O plugin de login (`@capgo/capacitor-social-login`) também grava a última resposta do Google —
// com o ID token — num SharedPreferences próprio. O KING apaga essa cópia logo depois de cada uso
// (ver apps/web/src/nativo/loginSocial.ts); se sobrar alguma, ela também não viaja.
const EXCLUSOES_DA_SESSAO = [
  '<exclude domain="root" path="app_webview/" />',
  '<exclude domain="sharedpref" path="WSSecureStorageSharedPreferences.xml" />',
  '<exclude domain="sharedpref" path="GOOGLE_LOGIN_F13oz0I_SHARED_PERF.xml" />',
];
const EXCLUSAO_DO_WEBVIEW = EXCLUSOES_DA_SESSAO.join("\n        ");
escrever(
  "android/app/src/main/res/xml/data_extraction_rules.xml",
  "Android: sessão fora do backup e da transferência (Android 12+)",
  `<?xml version="1.0" encoding="utf-8"?>
<!-- KING: a sessão do convidado (cofre e localStorage antigo do WebView) não vai para backup nem transferência. -->
<data-extraction-rules>
    <cloud-backup>
        ${EXCLUSAO_DO_WEBVIEW}
    </cloud-backup>
    <device-transfer>
        ${EXCLUSAO_DO_WEBVIEW}
    </device-transfer>
</data-extraction-rules>
`,
);
escrever(
  "android/app/src/main/res/xml/backup_rules.xml",
  "Android: sessão fora do backup (Android 11 e anteriores)",
  `<?xml version="1.0" encoding="utf-8"?>
<!-- KING: a sessão do convidado (cofre e localStorage antigo do WebView) não vai para o backup. -->
<full-backup-content>
    ${EXCLUSOES_DA_SESSAO.join("\n    ")}
</full-backup-content>
`,
);
ajustar(
  "android/app/src/main/AndroidManifest.xml",
  "Android: regras de backup ligadas no manifesto",
  /(\n\s*android:allowBackup="true")/,
  '$1\n        android:dataExtractionRules="@xml/data_extraction_rules"\n        android:fullBackupContent="@xml/backup_rules"',
  (s) => s.includes("android:dataExtractionRules") && s.includes("android:fullBackupContent"),
);

// APP LINKS (Fase 9): o convite `https://playkingcards.com.br/?sala=1234` abre o app. Só o domínio
// oficial, só HTTPS, só a raiz ("/"): o caminho exato impede que qualquer outra página do site seja
// sequestrada pelo app. `autoVerify` faz o Android conferir o assetlinks.json publicado no domínio —
// sem ele publicado (gate manual), o link continua abrindo o navegador, como hoje.
ajustar(
  "android/app/src/main/AndroidManifest.xml",
  "Android: App Link do convite (https://playkingcards.com.br/)",
  /(<category android:name="android\.intent\.category\.LAUNCHER" \/>\s*<\/intent-filter>)/,
  `$1

            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="playkingcards.com.br" android:path="/" />
            </intent-filter>`,
  (s) => s.includes('android:host="playkingcards.com.br"'),
);

// PERMISSÃO HERDADA: o plugin de login declara `USE_CREDENTIALS`, que é do AccountManager antigo
// (sem efeito desde a API 23; o minSdk do KING é 24) e o Credential Manager não usa. Sai do manifesto
// final — a lista de permissões continua só INTERNET.
ajustar(
  "android/app/src/main/AndroidManifest.xml",
  "Android: namespace tools no manifesto",
  /<manifest xmlns:android="http:\/\/schemas\.android\.com\/apk\/res\/android">/,
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:tools="http://schemas.android.com/tools">',
  (s) => s.includes('xmlns:tools="http://schemas.android.com/tools"'),
);
ajustar(
  "android/app/src/main/AndroidManifest.xml",
  "Android: sem USE_CREDENTIALS (herdada do plugin de login)",
  /(\n\s*<uses-permission android:name="android\.permission\.INTERNET" \/>)/,
  '$1\n    <uses-permission android:name="android.permission.USE_CREDENTIALS" tools:node="remove" />',
  (s) => s.includes('android.permission.USE_CREDENTIALS" tools:node="remove"'),
);
// O Credential Manager (`androidx.credentials` 1.5, do plugin de login) traz `androidx.biometric`,
// que declara USE_BIOMETRIC e USE_FINGERPRINT — para passkeys com biometria, que o KING não usa (o
// Google entrega o ID token sem biometria do app). Saem do manifesto final.
ajustar(
  "android/app/src/main/AndroidManifest.xml",
  "Android: sem USE_BIOMETRIC/USE_FINGERPRINT (herdadas do Credential Manager)",
  /(\n\s*<uses-permission android:name="android\.permission\.USE_CREDENTIALS" tools:node="remove" \/>)/,
  '$1\n    <uses-permission android:name="android.permission.USE_BIOMETRIC" tools:node="remove" />' +
    '\n    <uses-permission android:name="android.permission.USE_FINGERPRINT" tools:node="remove" />',
  (s) => s.includes('android.permission.USE_BIOMETRIC" tools:node="remove"'),
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

// SÓ IPHONE no 1º envio (decisão de produto, 23/10/2026). Paisagem fixa num iPad obrigaria a abrir
// mão da multitarefa, e a chave que fazia isso (`UIRequiresFullScreen`) foi depreciada no iPadOS 26
// — e por decisão NÃO é a saída futura. Suporte a iPad (retrato, janelas redimensionáveis) é
// evolução posterior, não bloqueio deste lançamento.
ajustarTodos(
  "ios/App/App.xcodeproj/project.pbxproj",
  "iOS: só iPhone (TARGETED_DEVICE_FAMILY = 1)",
  /TARGETED_DEVICE_FAMILY = [^;]+;/g,
  "TARGETED_DEVICE_FAMILY = 1;",
);

// Exportação: o KING só usa a criptografia do sistema (HTTPS/WSS). Declarar isso no Info.plist
// evita a pergunta de conformidade de exportação a cada envio ao App Store Connect.
ajustar(
  "ios/App/App/Info.plist",
  "iOS: criptografia isenta (só HTTPS/TLS do sistema)",
  /(\n\s*<key>CFBundleDevelopmentRegion<\/key>)/,
  "\n\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>$1",
  (s) => s.includes("ITSAppUsesNonExemptEncryption"),
);

// SIGN IN WITH APPLE e UNIVERSAL LINKS (Fase 9): o direito de usar vem dos ENTITLEMENTS do app, e
// não de código. O arquivo é nosso e o Xcode o encontra por `CODE_SIGN_ENTITLEMENTS` nas duas
// configurações do alvo. O perfil de provisionamento precisa das DUAS capacidades ligadas no Apple
// Developer ("Sign in with Apple" e "Associated Domains") — gate manual; sem elas a assinatura falha.
// O domínio associado é só o oficial (o AASA publicado lá restringe à raiz com ?sala=).
const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- KING: gerado por scripts/preparar-mobile.mjs. Não editar à mão. -->
<plist version="1.0">
<dict>
	<key>com.apple.developer.applesignin</key>
	<array>
		<string>Default</string>
	</array>
	<key>com.apple.developer.associated-domains</key>
	<array>
		<string>applinks:playkingcards.com.br</string>
	</array>
</dict>
</plist>
`;
escrever("ios/App/App/App.entitlements", "iOS: entitlement do Sign in with Apple", ENTITLEMENTS);
ajustarTodos(
  "ios/App/App.xcodeproj/project.pbxproj",
  "iOS: CODE_SIGN_ENTITLEMENTS nas configurações do app",
  /(\n(\s*))(?:CODE_SIGN_ENTITLEMENTS = [^;]+;\n\s*)?(PRODUCT_BUNDLE_IDENTIFIER = br\.com\.playkingcards\.king;)/g,
  "$1CODE_SIGN_ENTITLEMENTS = App/App.entitlements;$1$3",
);

// GOOGLE NO IPHONE: o Google Sign-In exige o esquema de URL do client ID iOS (invertido) no Info.plist
// — sem ele o SDK ENCERRA o app ao abrir o login. O valor é o mesmo do build web
// (`VITE_KING_GOOGLE_IOS_CLIENT_ID`), que não é segredo. Sem ele, o Google simplesmente não é
// oferecido no iPhone (ver apps/web/src/nativo/loginSocial.ts), e a Apple segue sozinha.
// Lido como o Vite lê (ambiente e .env*), para o esquema e o pacote web nunca discordarem.
const CLIENTE_GOOGLE_IOS = (variavelDoBuild("VITE_KING_GOOGLE_IOS_CLIENT_ID", RAIZ) ?? "").trim();
if (/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(CLIENTE_GOOGLE_IOS)) {
  const esquema = CLIENTE_GOOGLE_IOS.split(".").reverse().join(".");
  ajustar(
    "ios/App/App/Info.plist",
    "iOS: esquema de URL do Google Sign-In",
    /(\n\s*<key>CFBundleDevelopmentRegion<\/key>)/,
    `\n\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${esquema}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>$1`,
    (s) => s.includes(`<string>${esquema}</string>`),
  );
} else if (CLIENTE_GOOGLE_IOS) {
  avisos.push(`iOS: VITE_KING_GOOGLE_IOS_CLIENT_ID com formato inesperado ("…apps.googleusercontent.com") — Google no iPhone NÃO configurado`);
} else {
  avisos.push("iOS: sem VITE_KING_GOOGLE_IOS_CLIENT_ID — o iPhone oferece só a Apple (Google entra quando houver o client ID iOS)");
}

// MANIFESTO DE PRIVACIDADE (Fase 9, red team): o plugin de login usa `UserDefaults` — uma "API com
// motivo obrigatório" — e não traz manifesto próprio; sem a declaração no app, o envio ao App Store
// Connect é barrado (ITMS-91053). O motivo é CA92.1 (o app lê o que ele mesmo gravou). Os tipos de
// dados coletados espelham a política de privacidade (public/privacidade.html) e PRECISAM bater com
// a ficha "Privacidade do app" no App Store Connect — conferência do titular antes do envio.
const dadoColetado = (tipo, ligado, finalidade) => `		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>${tipo}</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<${ligado}/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
			<key>NSPrivacyCollectedDataTypePurposes</key>
			<array>
				<string>${finalidade}</string>
			</array>
		</dict>`;
const MANIFESTO_DE_PRIVACIDADE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- KING: gerado por scripts/preparar-mobile.mjs. Não editar à mão. -->
<plist version="1.0">
<dict>
	<key>NSPrivacyTracking</key>
	<false/>
	<key>NSPrivacyTrackingDomains</key>
	<array/>
	<key>NSPrivacyAccessedAPITypes</key>
	<array>
		<dict>
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array>
				<string>CA92.1</string>
			</array>
		</dict>
	</array>
	<key>NSPrivacyCollectedDataTypes</key>
	<array>
${[
  dadoColetado("NSPrivacyCollectedDataTypeUserID", "true", "NSPrivacyCollectedDataTypePurposeAppFunctionality"),
  dadoColetado("NSPrivacyCollectedDataTypeEmailAddress", "true", "NSPrivacyCollectedDataTypePurposeAppFunctionality"),
  dadoColetado("NSPrivacyCollectedDataTypeName", "true", "NSPrivacyCollectedDataTypePurposeAppFunctionality"),
  dadoColetado("NSPrivacyCollectedDataTypeGameplayContent", "true", "NSPrivacyCollectedDataTypePurposeAppFunctionality"),
  dadoColetado("NSPrivacyCollectedDataTypeProductInteraction", "false", "NSPrivacyCollectedDataTypePurposeAnalytics"),
].join("\n")}
	</array>
</dict>
</plist>
`;
escrever("ios/App/App/PrivacyInfo.xcprivacy", "iOS: manifesto de privacidade (UserDefaults CA92.1, sem rastreamento)", MANIFESTO_DE_PRIVACIDADE);
// O arquivo só vale se for RECURSO do alvo: referência, grupo e fase "Copy Bundle Resources".
// Ids fixos (24 hex) para a edição ser idempotente.
const REF_PRIVACIDADE = "4B494E4750524956414359A2";
const BUILD_PRIVACIDADE = "4B494E4750524956414359A1";
ajustar(
  "ios/App/App.xcodeproj/project.pbxproj",
  "iOS: manifesto de privacidade como arquivo do projeto",
  /(\n\t\t2FAD9762203C412B000D30F8 \/\* config\.xml \*\/ = \{isa = PBXFileReference;[^\n]*)/,
  `$1\n\t\t${REF_PRIVACIDADE} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };`,
  (s) => s.includes(`${REF_PRIVACIDADE} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference;`),
);
ajustar(
  "ios/App/App.xcodeproj/project.pbxproj",
  "iOS: manifesto de privacidade no grupo do app",
  /(\n\t\t\t\t2FAD9762203C412B000D30F8 \/\* config\.xml \*\/,)/,
  `$1\n\t\t\t\t${REF_PRIVACIDADE} /* PrivacyInfo.xcprivacy */,`,
  (s) => s.includes(`\t\t\t\t${REF_PRIVACIDADE} /* PrivacyInfo.xcprivacy */,`),
);
ajustar(
  "ios/App/App.xcodeproj/project.pbxproj",
  "iOS: manifesto de privacidade como recurso (build file)",
  /(\n\t\t2FAD9763203C412B000D30F8 \/\* config\.xml in Resources \*\/ = \{isa = PBXBuildFile;[^\n]*)/,
  `$1\n\t\t${BUILD_PRIVACIDADE} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${REF_PRIVACIDADE} /* PrivacyInfo.xcprivacy */; };`,
  (s) => s.includes(`${BUILD_PRIVACIDADE} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile;`),
);
ajustar(
  "ios/App/App.xcodeproj/project.pbxproj",
  "iOS: manifesto de privacidade na fase Copy Bundle Resources",
  /(\n\t\t\t\t2FAD9763203C412B000D30F8 \/\* config\.xml in Resources \*\/,)/,
  `$1\n\t\t\t\t${BUILD_PRIVACIDADE} /* PrivacyInfo.xcprivacy in Resources */,`,
  (s) => s.includes(`\t\t\t\t${BUILD_PRIVACIDADE} /* PrivacyInfo.xcprivacy in Resources */,`),
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
for (const a of avisos) console.log("  !!  " + a);

if (pulados.length > 0) {
  console.log("\nNada foi quebrado: o que faltou é projeto nativo ainda não gerado.");
  console.log('Gere com: cd apps/web && npx cap add android && npx cap add ios\n');
}
console.log("Lembrete: ícone, splash e assinatura ainda não estão configurados.\n");
