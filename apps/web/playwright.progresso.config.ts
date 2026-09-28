import { defineConfig } from "@playwright/test";

/**
 * Playwright — O PROGRESSO NA HOME, com a identidade CONFIGURADA.
 *
 * Config separada, de propósito: o build de e2e principal não tem `VITE_SUPABASE_*` (e não deve
 * ter — a suíte multiplayer roda em identidade legacy). Com ele, o card de progresso nunca
 * apareceria, e um teste de layout passaria verde sem ter medido nada. Aqui o build aponta para um
 * Supabase fictício (`.env.e2e-progresso`) e o teste intercepta a rede.
 *
 * Viewports: os dois landscape de celular pedidos, a altura útil mais baixa que o KING promete,
 * um desktop, e um aparelho de TOQUE (`hasTouch` + `isMobile`).
 */
const CI = !!process.env.CI;

const PROJETOS = [
  { nome: "667x375", w: 667, h: 375 },
  { nome: "852x393", w: 852, h: 393 },
  { nome: "852x300", w: 852, h: 300 },
  { nome: "1600x900", w: 1600, h: 900 },
  { nome: "852x393-toque", w: 852, h: 393, toque: true },
];

export default defineConfig({
  testDir: "./tests-progresso",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? "line" : "list",
  use: {
    baseURL: "http://localhost:4174",
    trace: "on-first-retry",
    video: "off",
  },
  projects: PROJETOS.map(({ nome, w, h, toque }) => ({
    name: nome,
    use: {
      browserName: "chromium" as const,
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      ...(toque ? { hasTouch: true, isMobile: true } : {}),
    },
  })),
  webServer: {
    command: "npx vite preview --outDir dist-e2e-progresso --port 4174 --strictPort",
    url: "http://localhost:4174",
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
