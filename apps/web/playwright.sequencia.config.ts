import { defineConfig } from "@playwright/test";

/**
 * Playwright — A PROVA ONLINE DA SEQUÊNCIA, de ponta a ponta, em stack LOCAL.
 *
 * Duas pessoas (dois navegadores) jogam partidas online INTEIRAS contra dois bots, no servidor do
 * jogo compilado, com crédito de XP de verdade no Postgres com as migrações reais (ver
 * `tests-sequencia/stack.ts`). Prova o que a 6A só tinha medido por injeção: o Placar Final online
 * real com a sequência, a Home atualizada, a 2ª partida do dia sem avanço fingido, a reconexão e o
 * refresh sem duplicar.
 *
 * NÃO roda na CI: cada partida leva ~10 minutos de jogo real. É a ferramenta de prova antes do
 * rollout: `npm run test:e2e:sequencia` (dentro de apps/web). Com `KING_SHOTS=<pasta>`, guarda as
 * capturas dos quatro viewports.
 */
export default defineConfig({
  testDir: "./tests-sequencia",
  testMatch: /partidaOnline\.spec\.ts$/,
  globalSetup: "./tests-sequencia/stack.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 70 * 60_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4176",
    viewport: { width: 852, height: 393 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npx vite preview --outDir dist-e2e-sequencia --port 4176 --strictPort",
    url: "http://localhost:4176",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
