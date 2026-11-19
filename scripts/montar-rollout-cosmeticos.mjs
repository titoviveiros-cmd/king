#!/usr/bin/env node
// MONTA O ARQUIVO ÚNICO DA ENTREGA B (cosméticos por nível) — o que o Tito cola, inteiro, no SQL Editor
// de Production. NÃO foi aplicado em lugar nenhum: aplicar exige autorização própria.
//
//   supabase/rollout/cosmeticos-aplicar.sql =
//     cabeçalho + BEGIN + partes/cosmeticos-1-antes.sql + AS TRÊS MIGRAÇÕES (texto idêntico) + partes/cosmeticos-3-conferencias.sql
//
// Cada migração entra VERBATIM, e o cabeçalho traz o sha256 de cada uma: o arquivo do rollout nunca pode
// divergir delas. O teste R1 de `scripts/testar-cosmeticos-sql.mjs` reprova se o arquivo gravado não for exatamente
// o que este script monta agora.
//
//   node scripts/montar-rollout-cosmeticos.mjs            # regrava o arquivo
//   node scripts/montar-rollout-cosmeticos.mjs --conferir # só confere (sai 1 se divergir)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const RAIZ = new URL("../", import.meta.url);
const ler = (rel) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
export const ARQUIVO_DO_ROLLOUT = "supabase/rollout/cosmeticos-aplicar.sql";
/** As migrações, NA ORDEM: a parte 1 (moldura, baralho, reação), a parte 2 (a toalha da mesa) e a 3 (o catálogo da Entrega C). */
export const MIGRACOES = [
  "supabase/migrations/20261117120000_cosmeticos.sql",
  "supabase/migrations/20261118120000_cosmeticos_mesa.sql",
  "supabase/migrations/20261119120000_cosmeticos_catalogo.sql",
];
export const lerMigracoes = () => MIGRACOES.map(ler);

export function montarRollout(migracoes = lerMigracoes()) {
  if (migracoes.length !== MIGRACOES.length) throw new Error("montarRollout: uma entrada por migração, na ordem");
  const shas = migracoes
    .map((m, i) => `--   ${MIGRACOES[i]}\n--     sha256 ${createHash("sha256").update(m).digest("hex")}`)
    .join("\n");
  const cabecalho = `-- ENTREGAS B e C — COSMÉTICOS POR NÍVEL — COLAR ESTE ARQUIVO INTEIRO NO SQL EDITOR E RODAR UMA VEZ.
--
-- ARQUIVO GERADO por scripts/montar-rollout-cosmeticos.mjs — não editar à mão.
-- Migrações dentro dele, nesta ordem e com o texto idêntico ao do repositório:
${shas}
--
-- ANTES: rodar supabase/rollout/cosmeticos-checkpoint-1-antes.sql (só leitura) e ver pronto_para_aplicar = true.
--
-- Colar INTEIRO, numa aba só, e rodar UMA vez. SÓ está aplicado se a última tela mostrar a linha
-- "COSMÉTICOS (ENTREGA B) APLICADA E CONFERIDA"; sem ela, nada foi gravado.
--
-- É UMA transação: BEGIN, recusas e retrato do "antes", a migração, conferências e COMMIT. Se QUALQUER
-- passo falhar, o erro aparece, o COMMIT não roda e NADA é gravado — nesse caso, rodar \`rollback;\`
-- sozinho para limpar a sessão e me mandar o erro. "lock timeout" = rodar de novo um minuto depois.
--
-- DEPOIS: rodar supabase/rollout/cosmeticos-checkpoint-3-depois.sql (só leitura) e ver tudo_certo = true.
--
-- O que muda: nasce a tabela das escolhas (vazia: moldura, baralho, reações e toalha) e nove funções. NADA do que existe muda: progresso,
-- XP, ledger, crédito, lápides, jogadores e privilégios ficam como estão (as conferências provam). O
-- servidor e a web que estão no ar hoje não usam nada disto; ativar é o passo seguinte (servidor, depois
-- web), cada um com autorização própria.
--
-- Rollback, NESTA ordem: supabase/rollback/20261119120000_cosmeticos_catalogo_rollback.sql,
-- supabase/rollback/20261118120000_cosmeticos_mesa_rollback.sql e por último
-- supabase/rollback/20261117120000_cosmeticos_rollback.sql (apagam as escolhas gravadas, e só elas).
-- Depois dos três, o checkpoint 1 volta a dizer pronto_para_aplicar = true.

`;
  const meio = migracoes.map((m, i) => `-- ─── ${MIGRACOES[i]} ───\n${m}`).join("\n");
  return cabecalho + "begin;\n\n" + ler("supabase/rollout/partes/cosmeticos-1-antes.sql") +
    meio + ler("supabase/rollout/partes/cosmeticos-3-conferencias.sql");
}

if (process.argv[1]?.endsWith("montar-rollout-cosmeticos.mjs")) {
  const montado = montarRollout();
  if (process.argv.includes("--conferir")) {
    const gravado = ler(ARQUIVO_DO_ROLLOUT);
    if (gravado !== montado) {
      console.error(`❌ ${ARQUIVO_DO_ROLLOUT} diverge do que as partes e a migração montam hoje. Rode sem --conferir.`);
      process.exit(1);
    }
    console.log(`✅ ${ARQUIVO_DO_ROLLOUT} confere com a migração e as partes.`);
  } else {
    writeFileSync(new URL(ARQUIVO_DO_ROLLOUT, RAIZ), montado);
    console.log(`✍️  ${ARQUIVO_DO_ROLLOUT} regravado (${montado.split("\n").length} linhas).`);
  }
}
