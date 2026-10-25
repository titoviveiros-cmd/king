// Testes das Edge Functions, no Node. Só os módulos puros (`nucleo.ts`, `apple.ts`); a entrada
// `index.ts` é Deno e não é importada por teste nenhum.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    include: ["**/*.test.ts"],
  },
});
