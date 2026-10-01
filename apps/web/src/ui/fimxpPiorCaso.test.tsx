// O PIOR CASO DO BLOCO DE XP + SEQUÊNCIA NO PLACAR FINAL — o markup que o Playwright mede.
//
// O Placar Final ONLINE só existe no fim de uma partida multiplayer inteira com crédito no banco,
// e isso não cabe numa suíte de layout. A coluna de dados (`.fimdados`) é a MESMA nos dois modos;
// então o teste de layout (`tests/placarFinal.spec.ts`, em todos os viewports) leva a partida
// LOCAL até a tela final e põe nela o markup REAL de `XpNoFim` no pior caso. Este teste garante
// que esse markup é o que o componente desenha HOJE: mudou o componente, o arquivo muda junto.
//
//   ATUALIZAR_FIXTURE=1 npx vitest run src/ui/fimxpPiorCaso.test.tsx   → regrava o arquivo
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { XpNoFim } from "./Progresso.js";

const ARQUIVO = new URL("../../tests/fixtures/fimxp-pior-caso.html", import.meta.url);
const PARTIDA = "33333333-3333-4333-8333-333333333333";

/** Os números mais LARGOS plausíveis: nível de dois dígitos, XP de quatro, sequência de três. */
export const PIOR_CASO = renderToStaticMarkup(
  <XpNoFim
    matchId={PARTIDA}
    xp={{
      credito: { xpDelta: 150, posicao: 1 },
      progresso: { xpTotal: 63_650, nivel: 49, xpNoNivel: 2_450, xpDoNivel: 2_500, sequencia: { atual: 365, recorde: 365, hoje: true, partida: PARTIDA } },
    }}
  />,
);

describe("fixture do Playwright", () => {
  it("é o markup ATUAL do XpNoFim no pior caso, com a sequência", () => {
    if (process.env.ATUALIZAR_FIXTURE) writeFileSync(ARQUIVO, `${PIOR_CASO}\n`);
    expect(PIOR_CASO).toContain("🔥 Sequência: 365 dias");
    expect(readFileSync(ARQUIVO, "utf8").replace(/\r\n/g, "\n").trim()).toBe(PIOR_CASO);
  });
});
