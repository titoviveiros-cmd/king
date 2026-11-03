import { defineConfig } from "@playwright/test";

/**
 * Playwright — O APP NATIVO DO ANDROID, SIMULADO NA PONTE.
 *
 * O bundle é o mesmo que vai para o AAB (identidade + servidor configurados, `.env.e2e-nativo`). O
 * teste instala, antes de qualquer script da página, a ponte que o Capacitor do Android injeta no
 * WebView (`androidBridge` + `Capacitor.PluginHeaders` + `nativePromise`), com o lado nativo dos
 * plugins em memória. Assim o `@capacitor/core` e os plugins REAIS rodam como no aparelho, e o
 * caminho cofre → Supabase → matchmaking → WebSocket → lobby é exercitado de ponta a ponta.
 *
 * NÃO substitui o aparelho: não há WebView do Android, nem Keystore, nem a rede do celular. É o
 * teste que teria pegado o defeito do vc1 antes do envio.
 *
 * Portas próprias (4186 / 2586): a 4173 pode estar com outro projeto, e `reuseExistingServer`
 * testaria o app errado.
 */
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests-nativo",
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? "line" : "list",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:4186",
    trace: "on-first-retry",
    video: "off",
    browserName: "chromium",
    viewport: { width: 852, height: 393 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  },
  webServer: [
    {
      command: "npx vite preview --outDir dist-e2e-nativo --port 4186 --strictPort",
      url: "http://localhost:4186",
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: "node ../../apps/server/dist/index.js",
      url: "http://127.0.0.1:2586",
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: { PORT: "2586", NODE_ENV: "test" },
    },
  ],
});
