import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cada arquivo de teste sobe um servidor Colyseus REAL, que escuta numa porta. Rodar os
    // arquivos em paralelo faz dois servidores disputarem a mesma porta (EADDRINUSE) e derruba
    // a suíte de forma intermitente. Sequencial é o correto aqui, e o custo é baixo.
    fileParallelism: false,
  },
});
