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
  const permissoes = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]);
  const extras = permissoes.filter((p) => p !== "android.permission.INTERNET");
  if (!permissoes.includes("android.permission.INTERNET")) falhar("falta a permissão INTERNET");
  else if (extras.length > 0) falhar(`permissões a mais, que a loja vai questionar: ${extras.join(", ")}`);
  else ok("permissões: só INTERNET");

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

  // O WebView do Capacitor só existe se o webDir foi copiado. Sem isso o app abre em branco —
  // e compila perfeitamente, que é justamente o perigo.
  if (existsSync(caminho("apps/web/android/app/src/main/assets/public/index.html"))) {
    ok("assets web copiados (index.html presente)");
  } else {
    falhar("assets web AUSENTES em android/app/src/main/assets/public — falta `cap sync`");
  }
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
  else if (Number(alvo) < 14) falhar(`IPHONEOS_DEPLOYMENT_TARGET ${alvo} — abaixo do exigido pelo Capacitor 7`);
  else ok(`deployment target: iOS ${alvo}`);

  if (existsSync(caminho("apps/web/ios/App/App/public/index.html"))) {
    ok("assets web copiados (index.html presente)");
  } else {
    falhar("assets web AUSENTES em ios/App/App/public — falta `cap sync`");
  }
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
