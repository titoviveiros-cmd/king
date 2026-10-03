#!/usr/bin/env node
// MONTA O ARQUIVO ÚNICO DO ROLLOUT DA SEQUÊNCIA — o que o Tito cola, inteiro, no SQL Editor.
//
//   supabase/rollout/sequencia-aplicar.sql =
//     cabeçalho + BEGIN + partes/1-antes.sql + A MIGRAÇÃO (texto idêntico) + partes/3-conferencias.sql
//
// A migração entra VERBATIM: o arquivo do rollout nunca pode divergir dela. O teste S23 de
// `scripts/testar-progresso-sql.mjs` reprova se o arquivo gravado não for exatamente o que este
// script monta agora.
//
//   node scripts/montar-rollout-sequencia.mjs            # regrava o arquivo
//   node scripts/montar-rollout-sequencia.mjs --conferir # só confere (sai 1 se divergir)
import { readFileSync, writeFileSync } from "node:fs";

const RAIZ = new URL("../", import.meta.url);
const ler = (rel) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
export const ARQUIVO_DO_ROLLOUT = "supabase/rollout/sequencia-aplicar.sql";

const CABECALHO = `-- ROLLOUT DA SEQUÊNCIA (streak v1) — COLAR ESTE ARQUIVO INTEIRO NO SQL EDITOR E RODAR UMA VEZ.
--
-- ARQUIVO GERADO por scripts/montar-rollout-sequencia.mjs — não editar à mão.
--
-- É UMA transação: BEGIN, retrato do "antes", a migração 20261001120000_sequencia.sql (texto
-- idêntico), conferências e COMMIT. Se QUALQUER passo falhar, o erro aparece, o COMMIT não roda e
-- NADA é gravado — nesse caso, rodar \`rollback;\` sozinho para limpar a sessão e me mandar o erro.
-- Se tudo passar, a última tela mostra uma linha "SEQUÊNCIA APLICADA E CONFERIDA".
--
-- Durante os poucos segundos da transação, nenhum crédito de XP confirma (ele espera e segue).

`;

export function montarRollout() {
  return CABECALHO + "begin;\n\n" + ler("supabase/rollout/partes/1-antes.sql") +
    ler("supabase/migrations/20261001120000_sequencia.sql") + ler("supabase/rollout/partes/3-conferencias.sql");
}

if (import.meta.url === new URL(process.argv[1], "file://").href || process.argv[1]?.endsWith("montar-rollout-sequencia.mjs")) {
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
