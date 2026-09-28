import { defineConfig } from "@playwright/test";

/**
 * Playwright — o ANALYTICS com o PostHog CONFIGURADO, contra um host fictício.
 *
 * Config separada, de propósito: nenhum outro build de e2e tem `VITE_POSTHOG_*` (e não deve ter —
 * lá o analytics tem de ficar em silêncio). Aqui o build (`.env.e2e-analytics`) liga o adaptador
 * PostHog apontando para `https://ph.king-e2e.test`, e o teste intercepta cada envio.
 *
 * Um viewport só: o que se mede aqui é o que sai pela rede, não layout. O servidor Colyseus sobe
 * numa porta própria (2568) para não disputar com a suíte principal.
 */
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests-analytics",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? "line" : "list",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:4175",
    trace: "on-first-retry",
    video: "off",
  },
  projects: [
    {
      name: "852x393",
      use: { browserName: "chromium", viewport: { width: 852, height: 393 }, deviceScaleFactor: 1 },
    },
  ],
  webServer: [
    {
      command: "npx vite preview --outDir dist-e2e-analytics --port 4175 --strictPort",
      url: "http://localhost:4175",
      reuseExistingServer: !CI,
      timeout: 120_000,
    },
    {
      command: "node ../../apps/server/dist/index.js",
      url: "http://127.0.0.1:2568",
      reuseExistingServer: !CI,
      timeout: 120_000,
      env: { PORT: "2568", NODE_ENV: "test" },
    },
  ],
});
