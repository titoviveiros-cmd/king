// CAPACITOR — o KING empacotado para iOS e Android.
//
// A decisão foi manter o app web como base e embrulhá-lo, em vez de reescrever em React Native
// ou Flutter. Isto aqui é a fundação: o que o `npx cap sync` precisa saber para montar os
// projetos nativos a partir de `dist/`.
//
// O QUE FOI CONFERIDO ANTES DE ESCREVER ESTE ARQUIVO (medido, não suposto):
//
//   • CORS do matchmaking — o Colyseus reflete a origem, e a cadeia real (Nginx + TLS) também:
//     `capacitor://localhost` (iOS), `http://localhost` (Android) e `ionic://localhost` todos
//     recebem `Access-Control-Allow-Origin` do endpoint de produção. Era o risco arquitetural
//     mais provável e não existe.
//   • WSS — o certificado é Let's Encrypt válido, então nem o ATS do iOS nem a política de
//     cleartext do Android barram. Nenhuma exceção de segurança precisa ser aberta.
//   • Safe areas — o `index.html` já traz `viewport-fit=cover` e o CSS já consome
//     `env(safe-area-inset-*)`. Notch e Dynamic Island entram por esse mesmo caminho.
//
// O QUE AINDA NÃO ESTÁ AQUI, e por quê:
//   • ORIENTAÇÃO travada em landscape mora nos projetos nativos (`Info.plist` no iOS,
//     `android:screenOrientation` no Manifest), não neste arquivo. Entra quando `cap add` rodar.
//   • ÍCONE e SPLASH idem — e dependem da arte que ainda não existe.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "br.com.playkingcards.king",
  appName: "KING",

  /**
   * O build do Vite, tal como vai para a Vercel. Empacotar EXATAMENTE o mesmo artefato que roda
   * na web é o que impede o app de loja e o app do navegador de divergirem em silêncio.
   */
  webDir: "dist",

  server: {
    // Android serve de `http://localhost` em vez de `http://192.168.x.x`: origem estável, que é
    // o que faz o CORS conferido acima valer sempre.
    androidScheme: "https",
    iosScheme: "capacitor",
  },

  ios: {
    // O KING é escuro. Sem isto o WebView pisca branco entre o splash e a primeira pintura.
    backgroundColor: "#140a24",
    // A rolagem elástica não faz sentido numa mesa que não rola.
    scrollEnabled: false,
    contentInset: "never",
  },

  android: {
    backgroundColor: "#140a24",
    // TLS de verdade em todo lugar: nenhuma exceção de cleartext é necessária nem desejada.
    allowMixedContent: false,
  },
};

export default config;
