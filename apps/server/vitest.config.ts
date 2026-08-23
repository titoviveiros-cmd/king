import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // ALIAS EXCLUSIVO DE TESTE. O pacote `@king/engine` resolve, em runtime de produção, para
  // `dist/index.js` — é assim que o servidor compilado o encontra. Aqui, e SÓ aqui, os testes
  // leem o código-fonte, para não exigirem um build prévio e não testarem artefato velho.
  //
  // A produção NÃO depende deste alias: `node dist/index.js` resolve pelo campo `exports` do
  // pacote, sem passar por Vite nem por Vitest. É essa separação que impede o defeito clássico
  // de "teste verde, processo real quebrado".
  resolve: {
    alias: {
      "@king/engine": fileURLToPath(new URL("../../packages/engine/src/index.ts", import.meta.url)),
    },
  },
  test: {
    // Cada arquivo de teste sobe um servidor Colyseus REAL, que escuta numa porta. Rodar os
    // arquivos em paralelo faz dois servidores disputarem a mesma porta (EADDRINUSE) e derruba
    // a suíte de forma intermitente. Sequencial é o correto aqui, e o custo é baixo.
    fileParallelism: false,
  },
});
