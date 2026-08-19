import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Vitest = testes unit/integration do app (pura lógica sobre o motor), SÓ em `src`.
 * Os testes de layout do Playwright vivem em `tests/*.spec.ts` e são executados pelo Playwright
 * (`npm run test:e2e`), nunca pelo Vitest — por isso o include abaixo é restrito a `src`.
 */
export default defineConfig({
  plugins: [react()], // habilita JSX/TSX nos testes de componente (mesaScore.test.tsx)
  resolve: {
    alias: {
      "@king/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules/**", "dist/**", "tests/**"],
  },
});
