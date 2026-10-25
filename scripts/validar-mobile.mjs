// VALIDAÇÃO DOS PROJETOS NATIVOS — o que o compilador não reprova, mas a loja reprova.
//
// `gradlew assembleDebug` e `xcodebuild` provam que o código COMPILA. Não provam que o app abre
// em landscape, que o bundle identifier é o certo, que ninguém abriu uma exceção de tráfego em
// texto claro nem que Web, Android e iOS concordam sobre a versão. Isso é o que se descobre no
// aparelho, ou pior, na revisão da loja.
//
//   node scripts/validar-mobile.mjs [android|ios]
//
// Sem argumento, valida o que estiver presente. Uma plataforma ausente não é falha — é apenas
// não gerada; mas se for pedida explicitamente e não existir, aí sim reprova.
//
// Sai 0 se tudo passa, 1 se qualquer verificação falha. É portão de CI, não relatório.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RAIZ = new URL("../", import.meta.url);
const caminho = (p) => fileURLToPath(new URL(p, RAIZ));
const ler = (p) => readFileSync(caminho(p), "utf8");

/** Um arquivo do plugin de login como o build nativo o lê (o `cap sync` reescreve ali). */
const arquivoDoPluginDeLogin = (rel) => {
  for (const base of ["node_modules/@capgo/capacitor-social-login/", "apps/web/node_modules/@capgo/capacitor-social-login/"]) {
    if (existsSync(caminho(base + rel))) return ler(base + rel);
  }
  return "";
};

const pedido = process.argv[2];
const falhas = [];
const oks = [];
const ok = (t) => { oks.push(t); console.log("  ok  " + t); };
const falhar = (t) => { falhas.push(t); console.error("  XX  " + t); };

// ───────────────────────── fonte da verdade ─────────────────────────

const versaoDoProjeto = JSON.parse(ler("package.json")).version;
const configCapacitor = ler("apps/web/capacitor.config.ts");
const appIdEsperado = /appId:\s*"([^"]+)"/.exec(configCapacitor)?.[1];

console.log("\nVALIDAÇÃO DOS PROJETOS NATIVOS\n");
if (!appIdEsperado) {
  falhar("appId não encontrado em apps/web/capacitor.config.ts");
} else {
  ok(`appId de referência: ${appIdEsperado}`);
}
ok(`versão de referência (package.json da raiz): ${versaoDoProjeto}`);

// ───────────────────────── ANDROID ─────────────────────────

const TEM_ANDROID = existsSync(caminho("apps/web/android/app/src/main/AndroidManifest.xml"));

if (pedido === "android" && !TEM_ANDROID) {
  falhar("android/ pedido mas não existe — rode `npx cap add android` antes");
} else if (TEM_ANDROID && pedido !== "ios") {
  console.log("\n── ANDROID ──");
  const manifest = ler("apps/web/android/app/src/main/AndroidManifest.xml");
  const gradle = ler("apps/web/android/app/build.gradle");

  // ORIENTAÇÃO: o KING é landscape por decisão de design (13 cartas + 4 jogadores).
  if (/android:screenOrientation="sensorLandscape"/.test(manifest)) {
    ok("landscape travado (sensorLandscape)");
  } else {
    falhar('AndroidManifest sem android:screenOrientation="sensorLandscape" — rode mobile:preparar');
  }

  // A única permissão que o jogo precisa. Qualquer outra é pergunta na revisão da loja.
  // (Uma linha com `tools:node="remove"` não é permissão: é a remoção de uma que um plugin declarou.)
  const declaracoes = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"([^>]*)\/>/g)];
  const permissoes = declaracoes.filter((m) => !/tools:node="remove"/.test(m[2])).map((m) => m[1]);
  const removidas = declaracoes.filter((m) => /tools:node="remove"/.test(m[2])).map((m) => m[1]);
  const extras = permissoes.filter((p) => p !== "android.permission.INTERNET");
  if (!permissoes.includes("android.permission.INTERNET")) falhar("falta a permissão INTERNET");
  else if (extras.length > 0) falhar(`permissões a mais, que a loja vai questionar: ${extras.join(", ")}`);
  else ok("permissões: só INTERNET");
  // O plugin de login declara USE_CREDENTIALS (AccountManager antigo, sem efeito desde a API 23):
  // ela precisa sair do manifesto final.
  if (!removidas.includes("android.permission.USE_CREDENTIALS") || !/xmlns:tools=/.test(manifest)) {
    falhar("USE_CREDENTIALS (herdada do plugin de login) não é removida do manifesto final — rode mobile:preparar");
  } else ok("USE_CREDENTIALS do plugin de login removida do manifesto final");

  // TRÁFEGO EM TEXTO CLARO: o servidor é wss:// com certificado válido. Nenhuma exceção é
  // necessária, e uma exceção aberta "para testar" costuma ficar para sempre.
  if (/usesCleartextTraffic="true"/.test(manifest)) {
    falhar("usesCleartextTraffic=true — o KING fala só WSS, isto não pode existir");
  } else if (/networkSecurityConfig/.test(manifest)) {
    falhar("networkSecurityConfig declarado — conferir manualmente; hoje não deveria existir");
  } else {
    ok("sem exceção de tráfego em texto claro");
  }

  const appId = /applicationId\s+"([^"]+)"/.exec(gradle)?.[1];
  if (appId !== appIdEsperado) falhar(`applicationId "${appId}" ≠ capacitor.config "${appIdEsperado}"`);
  else ok(`applicationId confere: ${appId}`);

  const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];
  if (versionName !== versaoDoProjeto) {
    falhar(`versionName "${versionName}" ≠ versão do projeto "${versaoDoProjeto}" — rode mobile:preparar`);
  } else ok(`versionName confere: ${versionName}`);

  const versionCode = /versionCode\s+(\d+)/.exec(gradle)?.[1];
  if (!versionCode || Number(versionCode) < 1) falhar("versionCode ausente ou inválido");
  else ok(`versionCode: ${versionCode}`);

  // BACKUP: a sessão do convidado mora no localStorage do WebView (`app_webview/`). Ela não pode ir
  // para o backup nem para a transferência entre aparelhos — isso clonaria a identidade.
  const regras = (arquivo) => existsSync(caminho(`apps/web/android/app/src/main/res/xml/${arquivo}`))
    ? ler(`apps/web/android/app/src/main/res/xml/${arquivo}`) : "";
  const extracao = regras("data_extraction_rules.xml");
  // Fase 9: a sessão mora agora no COFRE (SharedPreferences cifrado com chave do Keystore); o
  // WebView continua excluído pelo que um build antigo deixou lá.
  const excluiUm = (xml, secao, alvo) => new RegExp(`<${secao}>[\\s\\S]*${alvo}[\\s\\S]*</${secao}>`).test(xml);
  // E a cópia da resposta do Google que o plugin de login grava (o KING a apaga após cada uso).
  const exclui = (xml, secao) =>
    excluiUm(xml, secao, 'domain="root" path="app_webview/"') &&
    excluiUm(xml, secao, 'domain="sharedpref" path="WSSecureStorageSharedPreferences\\.xml"') &&
    excluiUm(xml, secao, 'domain="sharedpref" path="GOOGLE_LOGIN_F13oz0I_SHARED_PERF\\.xml"');
  if (!/android:dataExtractionRules="@xml\/data_extraction_rules"/.test(manifest) || !/android:fullBackupContent="@xml\/backup_rules"/.test(manifest)) {
    falhar("manifesto sem as regras de backup (dataExtractionRules/fullBackupContent) — rode mobile:preparar");
  } else if (!exclui(extracao, "cloud-backup") || !exclui(extracao, "device-transfer") || !exclui(regras("backup_rules.xml"), "full-backup-content")) {
    falhar("regras de backup não excluem a sessão do convidado (cofre e app_webview/) — rode mobile:preparar");
  } else ok("sessão do convidado (cofre e WebView) fora do backup e da transferência entre aparelhos");

  // API ALVO: desde 31/08/2026 a Play só aceita app novo (e atualização) mirando a API 36
  // (Android 16). O Capacitor 7 parava na 35 — foi isso que levou ao Capacitor 8.
  const variaveis = existsSync(caminho("apps/web/android/variables.gradle")) ? ler("apps/web/android/variables.gradle") : "";
  for (const [nome, minimo] of [["targetSdkVersion", 36], ["compileSdkVersion", 36]]) {
    const valor = Number(new RegExp(`${nome}\\s*=\\s*(\\d+)`).exec(variaveis)?.[1]);
    if (!valor) falhar(`${nome} não encontrado em android/variables.gradle`);
    else if (valor < minimo) falhar(`${nome} ${valor} — a Play exige ${minimo} para app novo desde 31/08/2026`);
    else ok(`${nome}: ${valor}`);
  }

  // O WebView do Capacitor só existe se o webDir foi copiado. Sem isso o app abre em branco —
  // e compila perfeitamente, que é justamente o perigo.
  if (existsSync(caminho("apps/web/android/app/src/main/assets/public/index.html"))) {
    ok("assets web copiados (index.html presente)");
  } else {
    falhar("assets web AUSENTES em android/app/src/main/assets/public — falta `cap sync`");
  }

  // SEM SDK DO FACEBOOK: o plugin de login o inclui por padrão; o gancho do `cap sync` o desliga
  // conforme `plugins.SocialLogin.providers` (capacitor.config.ts). Confere-se o que o Gradle lê.
  const propsDoLogin = arquivoDoPluginDeLogin("android/gradle.properties");
  if (!/^socialLogin\.facebook\.include=false$/m.test(propsDoLogin)) {
    falhar("SDK do Facebook NÃO desligado no plugin de login (socialLogin.facebook.include) — rode `cap sync`");
  } else ok("plugin de login sem SDK do Facebook (Android)");
}

// ───────────────────────── iOS ─────────────────────────

const TEM_IOS = existsSync(caminho("apps/web/ios/App/App/Info.plist"));

if (pedido === "ios" && !TEM_IOS) {
  falhar("ios/ pedido mas não existe — rode `npx cap add ios` antes");
} else if (TEM_IOS && pedido !== "android") {
  console.log("\n── iOS ──");
  const plist = ler("apps/web/ios/App/App/Info.plist");
  const pbx = ler("apps/web/ios/App/App.xcodeproj/project.pbxproj");

  /** Extrai o array de um `<key>` do plist. */
  const arrayDe = (chave) => {
    const m = new RegExp(`<key>${chave}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(plist);
    return m ? [...m[1].matchAll(/<string>([^<]+)<\/string>/g)].map((x) => x[1]) : null;
  };

  for (const [chave, rotulo] of [
    ["UISupportedInterfaceOrientations", "iPhone"],
    ["UISupportedInterfaceOrientations~ipad", "iPad"],
  ]) {
    const orientacoes = arrayDe(chave);
    if (!orientacoes) { falhar(`${rotulo}: ${chave} ausente no Info.plist`); continue; }
    const retrato = orientacoes.filter((o) => o.includes("Portrait"));
    const paisagem = orientacoes.filter((o) => o.includes("Landscape"));
    if (retrato.length > 0) falhar(`${rotulo}: ainda aceita retrato (${retrato.join(", ")}) — rode mobile:preparar`);
    else if (paisagem.length < 2) falhar(`${rotulo}: precisa das duas orientações deitadas, tem ${paisagem.length}`);
    else ok(`${rotulo}: landscape apenas (${paisagem.length} orientações)`);
  }

  // ATS: o padrão da Apple já exige TLS moderno, e o servidor do KING tem certificado válido.
  // Qualquer afrouxamento aqui é pergunta garantida na revisão — e desnecessário.
  if (/NSAllowsArbitraryLoads/.test(plist)) {
    falhar("NSAllowsArbitraryLoads presente — o KING fala só WSS com certificado válido, isto não pode existir");
  } else if (/NSAppTransportSecurity/.test(plist)) {
    falhar("NSAppTransportSecurity declarado — conferir manualmente; hoje não deveria existir");
  } else {
    ok("ATS no padrão da Apple, sem exceções");
  }

  const bundle = /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/.exec(pbx)?.[1]?.trim();
  if (bundle !== appIdEsperado) falhar(`PRODUCT_BUNDLE_IDENTIFIER "${bundle}" ≠ capacitor.config "${appIdEsperado}"`);
  else ok(`bundle identifier confere: ${bundle}`);

  const marketing = /MARKETING_VERSION = ([^;]+);/.exec(pbx)?.[1]?.trim();
  if (marketing !== versaoDoProjeto) {
    falhar(`MARKETING_VERSION "${marketing}" ≠ versão do projeto "${versaoDoProjeto}" — rode mobile:preparar`);
  } else ok(`MARKETING_VERSION confere: ${marketing}`);

  const build = /CURRENT_PROJECT_VERSION = ([^;]+);/.exec(pbx)?.[1]?.trim();
  if (!build || Number(build) < 1) falhar("CURRENT_PROJECT_VERSION ausente ou inválido");
  else ok(`CURRENT_PROJECT_VERSION: ${build}`);

  const alvo = /IPHONEOS_DEPLOYMENT_TARGET = ([^;]+);/.exec(pbx)?.[1]?.trim();
  if (!alvo) falhar("IPHONEOS_DEPLOYMENT_TARGET ausente");
  else if (Number(alvo) < 15) falhar(`IPHONEOS_DEPLOYMENT_TARGET ${alvo} — abaixo do exigido pelo Capacitor 8`);
  else ok(`deployment target: iOS ${alvo}`);

  // SÓ IPHONE no 1º envio (decisão de produto, 23/10/2026): paisagem fixa num iPad exigiria abrir
  // mão da multitarefa, e `UIRequiresFullScreen` (a saída antiga) foi depreciado no iPadOS 26.
  const familias = [...pbx.matchAll(/TARGETED_DEVICE_FAMILY = ([^;]+);/g)].map((m) => m[1].replace(/"/g, "").trim());
  if (familias.length === 0) falhar("TARGETED_DEVICE_FAMILY ausente");
  else if (familias.some((f) => f !== "1")) {
    falhar(`TARGETED_DEVICE_FAMILY ${[...new Set(familias)].join(", ")} — o RC é só iPhone ("1"); rode mobile:preparar`);
  } else ok("só iPhone (TARGETED_DEVICE_FAMILY = 1)");
  if (/UIRequiresFullScreen/.test(plist)) falhar("UIRequiresFullScreen presente — depreciado no iPadOS 26; decisão: não usar");
  else ok("sem UIRequiresFullScreen");

  if (/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(plist)) ok("criptografia declarada isenta (só HTTPS/TLS)");
  else falhar("ITSAppUsesNonExemptEncryption ausente — rode mobile:preparar");

  if (existsSync(caminho("apps/web/ios/App/App/public/index.html"))) {
    ok("assets web copiados (index.html presente)");
  } else {
    falhar("assets web AUSENTES em ios/App/App/public — falta `cap sync`");
  }

  // SIGN IN WITH APPLE: entitlement no arquivo e ligado nas DUAS configurações do alvo do app.
  const entitlements = existsSync(caminho("apps/web/ios/App/App/App.entitlements")) ? ler("apps/web/ios/App/App/App.entitlements") : "";
  const configsDoApp = [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = br\.com\.playkingcards\.king;/g)].length;
  const comEntitlements = [...pbx.matchAll(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)].length;
  if (!/<key>com\.apple\.developer\.applesignin<\/key>\s*<array>\s*<string>Default<\/string>/.test(entitlements)) {
    falhar("App.entitlements sem com.apple.developer.applesignin — rode mobile:preparar");
  } else if (configsDoApp === 0 || comEntitlements !== configsDoApp) {
    falhar(`CODE_SIGN_ENTITLEMENTS em ${comEntitlements} de ${configsDoApp} configurações do app — rode mobile:preparar`);
  } else ok(`Sign in with Apple: entitlement ligado (${comEntitlements} configurações)`);

  // SEM SDK DO FACEBOOK no Swift Package Manager nem no CocoaPods (o gancho do `cap sync` comenta).
  const pacote = arquivoDoPluginDeLogin("Package.swift");
  const podspec = arquivoDoPluginDeLogin("CapgoCapacitorSocialLogin.podspec");
  const ativa = (texto, re) => texto.split("\n").some((l) => re.test(l) && !/^\s*(\/\/|#)/.test(l));
  if (!pacote || ativa(pacote, /facebook-ios-sdk/) || ativa(podspec, /FBSDK/)) {
    falhar("SDK do Facebook ainda ligado no plugin de login (Package.swift/podspec) — rode `cap sync`");
  } else ok("plugin de login sem SDK do Facebook (iOS)");

  // GOOGLE NO IPHONE: com o client ID iOS no build, o esquema invertido TEM de estar no Info.plist —
  // sem ele o Google Sign-In encerra o app ao abrir o login.
  const clienteIos = (process.env.VITE_KING_GOOGLE_IOS_CLIENT_ID ?? "").trim();
  if (clienteIos) {
    const esquema = clienteIos.split(".").reverse().join(".");
    if (!plist.includes(`<string>${esquema}</string>`)) {
      falhar(`Google no iPhone: esquema ${esquema} ausente do Info.plist — rode mobile:preparar com a mesma variável`);
    } else ok("Google no iPhone: esquema de URL do client ID registrado");
  } else ok("Google no iPhone: não configurado neste build (o iPhone oferece só a Apple)");
}


// ───────────────────── O ENDEREÇO DO MULTIPLAYER, DENTRO DO PACOTE ─────────────────────
//
// O bundle empacotado não tem de onde ler variável de ambiente: o que valeu na hora do
// `vite build` é o que o app vai usar para sempre. Se `VITE_KING_SERVER_URL` não estiver
// definida naquele instante, o KING não inventa endereço — ele publica um app em que o
// multiplayer simplesmente não existe, e isso COMPILA PERFEITAMENTE. É a falha mais cara possível
// nesta fase: só aparece com o APK instalado na mão de alguém.
//
// Um app de loja também não pode carregar `localhost` nem a URL de um Preview temporário: o
// primeiro não existe no aparelho de quem instalou, e o segundo morre quando o deploy expira.
//
// Por isso a conferência é do ARTEFATO, e não da configuração: lê-se o que foi realmente copiado
// para dentro do projeto nativo.
function conferirEndpoint(rotulo, dir) {
  if (!existsSync(caminho(dir))) return;
  const arquivos = readdirSync(caminho(dir)).filter((f) => f.endsWith(".js"));
  if (arquivos.length === 0) { falhar(`${rotulo}: nenhum .js empacotado em ${dir}`); return; }
  const tudo = arquivos.map((f) => readFileSync(caminho(dir + f), "utf8")).join("");

  const wss = [...tudo.matchAll(/wss:\/\/[a-z0-9.-]+/gi)].map((m) => m[0]);
  const proprios = [...new Set(wss)];
  if (proprios.length === 0) {
    falhar(`${rotulo}: nenhum endpoint wss:// no bundle — o app foi empacotado SEM multiplayer ` +
      "(defina VITE_KING_SERVER_URL antes do build)");
  } else {
    ok(`${rotulo}: multiplayer aponta para ${proprios.join(", ")}`);
  }

  // O default interno do SDK do Colyseus (`ws://127.0.0.1:2567`) fica de fora: é string morta,
  // só usada por quem constrói o cliente sem URL, e o KING sempre passa a dele.
  const proibidos = [...new Set([
    ...[...tudo.matchAll(/wss?:\/\/localhost[:0-9]*/gi)].map((m) => m[0]),
    ...[...tudo.matchAll(/https?:\/\/[a-z0-9-]+\.vercel\.app/gi)].map((m) => m[0]),
  ])];
  if (proibidos.length > 0) {
    falhar(`${rotulo}: endereço que não sobrevive fora desta máquina: ${proibidos.join(", ")}`);
  } else {
    ok(`${rotulo}: sem localhost nem URL de Preview embutidos`);
  }
}

if (TEM_ANDROID && pedido !== "ios") {
  console.log("\n── ENDPOINT (Android) ──");
  conferirEndpoint("Android", "apps/web/android/app/src/main/assets/public/assets/");
}
if (TEM_IOS && pedido !== "android") {
  console.log("\n── ENDPOINT (iOS) ──");
  conferirEndpoint("iOS", "apps/web/ios/App/App/public/assets/");
}

if (!TEM_ANDROID && !TEM_IOS && !pedido) {
  console.log("\nNenhum projeto nativo presente. Gere com:");
  console.log("  cd apps/web && npx cap add android && npx cap add ios\n");
}

console.log("");
if (falhas.length > 0) {
  console.error(`REPROVADO — ${falhas.length} de ${falhas.length + oks.length} verificações falharam:`);
  for (const f of falhas) console.error("   • " + f);
  console.error("");
  process.exit(1);
}
console.log(`APROVADO — ${oks.length} verificações.\n`);
process.exit(0);
