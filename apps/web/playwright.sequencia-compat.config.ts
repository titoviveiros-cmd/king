import base from "./playwright.sequencia.config.js";

/**
 * Playwright — A WEB NOVA CONTRA O BANCO DE HOJE (sem a migração da sequência).
 *
 * O mesmo stack local da prova online (`tests-sequencia/stack.ts`), mas o Postgres recebe só as
 * migrações que a Production tem hoje: identidade e progresso. É a ordem "web antes da migração"
 * do rollout: a web pede `meu_progresso` com `select=*`, recebe as 5 colunas antigas, e o card de
 * XP e o Placar online têm de funcionar exatamente como antes — sem sequência, sem erro.
 *
 *   npm run test:e2e:sequencia:compat   (dentro de apps/web)
 */
process.env.KING_E2E_SEM_SEQUENCIA = "1";

export default {
  ...base,
  testMatch: /compatibilidade\.spec\.ts$/,
};
