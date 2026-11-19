#!/usr/bin/env node
// MONTA O ARQUIVO ÚNICO DA ENTREGA D (recordes & XP) — o que se cola, inteiro, no SQL Editor de Production.
// NÃO foi aplicado em lugar nenhum: aplicar exige autorização própria.
//
//   supabase/rollout/recordes-aplicar.sql =
//     cabeçalho + BEGIN + partes/recordes-1-antes.sql + A MIGRAÇÃO (texto idêntico) + partes/recordes-3-conferencias.sql
//
// A migração entra VERBATIM, com o sha256 dela no cabeçalho; o teste R1 de scripts/testar-recordes-sql.mjs
// reprova se o arquivo gravado não for exatamente o que este script monta agora.
//
//   node scripts/montar-rollout-recordes.mjs            # regrava o arquivo
//   node scripts/montar-rollout-recordes.mjs --conferir # só confere (sai 1 se divergir)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const RAIZ = new URL("../", import.meta.url);
const ler = (rel) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
export const ARQUIVO_DO_ROLLOUT = "supabase/rollout/recordes-aplicar.sql";
export const MIGRACAO = "supabase/migrations/20261120120000_recordes.sql";
export const lerMigracao = () => ler(MIGRACAO);

export function montarRollout(migracao = lerMigracao()) {
  const sha = createHash("sha256").update(migracao).digest("hex");
  const cabecalho = `-- ENTREGA D — RECORDES & XP — COLAR ESTE ARQUIVO INTEIRO NO SQL EDITOR E RODAR UMA VEZ.
--
-- ARQUIVO GERADO por scripts/montar-rollout-recordes.mjs — não editar à mão.
-- Migração dentro dele, com o texto idêntico ao do repositório:
--   ${MIGRACAO}
--     sha256 ${sha}
--
-- Independe dos cosméticos: precisa só do progresso (partidas, ledger, crédito e curva de nível).
--
-- SÓ está aplicado se a última tela mostrar a linha "RECORDES (ENTREGA D) APLICADA E CONFERIDA"; sem
-- ela, nada foi gravado. É UMA transação: recusas e retrato do "antes", a migração, 7 conferências e
-- COMMIT. Se QUALQUER passo falhar, rodar \`rollback;\` sozinho e mandar o erro.
--
-- O que muda: nasce a tabela dos placares online (vazia), a porta do servidor e a view do XP por nível.
-- NADA do que existe muda: progresso, XP, ledger, crédito, cosméticos e privilégios ficam como estão.
--
-- Rollback: supabase/rollback/20261120120000_recordes_rollback.sql.

`;
  return cabecalho + "begin;\n\n" + ler("supabase/rollout/partes/recordes-1-antes.sql") +
    migracao + ler("supabase/rollout/partes/recordes-3-conferencias.sql");
}

if (process.argv[1]?.endsWith("montar-rollout-recordes.mjs")) {
  const montado = montarRollout();
  if (process.argv.includes("--conferir")) {
    if (ler(ARQUIVO_DO_ROLLOUT) !== montado) {
      console.error(`❌ ${ARQUIVO_DO_ROLLOUT} diverge do que as partes e a migração montam hoje. Rode sem --conferir.`);
      process.exit(1);
    }
    console.log(`✅ ${ARQUIVO_DO_ROLLOUT} confere com a migração e as partes.`);
  } else {
    writeFileSync(new URL(ARQUIVO_DO_ROLLOUT, RAIZ), montado);
    console.log(`✍️  ${ARQUIVO_DO_ROLLOUT} regravado (${montado.split("\n").length} linhas).`);
  }
}
