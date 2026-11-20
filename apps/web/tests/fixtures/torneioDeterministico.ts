/**
 * AS SEMENTES DOS E2E DO MINI-TORNEIO — compartilhadas entre o Playwright (`minitorneio.spec.ts`)
 * e o Vitest (`src/torneio/vitoriaDeterministica.test.ts`), que as confere a cada execução.
 *
 * Como foram achadas: busca offline (`BUSCAR_SEMENTES=1`, ver o cabeçalho do teste do Vitest), com
 * o assento humano jogando o que o Bot Normal jogaria no lugar dele (`pilotoDeTeste.ts`), a partida
 * do humano começando na mão 10 (`?mao=10`, parâmetro de QA que já existia) e as mesas de bots
 * jogando as 10 mãos. A primeira semente de cada caso, a partir de 1. Nada é escolhido à mão
 * depois: o motor, o sorteio e o desempate decidem.
 */
export const AVATAR_DO_E2E = "sapo" as const;
/** O rótulo do avatar no seletor da Home. */
export const ROTULO_DO_AVATAR_DO_E2E = "Sapo";
export const MAO_DO_E2E = 10;

export const SEMENTES_DO_E2E = {
  mini16: { vitoria: 71, eliminacao: 1 },
  copa32: { vitoria: 275 },
} as const;
