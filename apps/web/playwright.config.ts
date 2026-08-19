import { defineConfig } from "@playwright/test";

/**
 * Playwright — testes de LAYOUT sobre o app real renderizado.
 *
 * Cada viewport é um PROJETO (parametrização, sem duplicar specs). Prioridade para os tamanhos
 * mobile landscape, que já revelaram ou poderiam revelar apertos de geometria (ver a tabela de
 * medições em docs/KING-DESIGN-SYSTEM.md). Servimos o BUILD de produção (`vite preview`) — assim
 * o CI valida o mesmo bundle que seria publicado.
 */

const CI = !!process.env.CI;

/** Viewports críticos (nome = dimensão). Os 5 primeiros são mobile landscape. */
const VIEWPORTS: Array<{ w: number; h: number }> = [
  { w: 667, h: 375 },
  { w: 800, h: 360 },
  { w: 852, h: 393 },
  { w: 874, h: 402 },
  { w: 956, h: 440 },
  { w: 1024, h: 768 },
  { w: 1600, h: 900 },
];

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "test-results",

  use: {
    baseURL: "http://localhost:4173",
    screenshot: "only-on-failure", // artefato de diagnóstico só quando falha
    trace: "on-first-retry",
    video: "off",
  },

  projects: VIEWPORTS.map(({ w, h }) => ({
    name: `${w}x${h}`,
    use: { browserName: "chromium", viewport: { width: w, height: h }, deviceScaleFactor: 1 },
  })),

  // Sobe o app buildado. Em CI o build roda antes (workflow); localmente, rode `npm run build`
  // no workspace antes do e2e. `reuseExistingServer` evita reinício quando já há um preview no ar.
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
