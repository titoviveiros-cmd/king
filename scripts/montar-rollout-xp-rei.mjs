#!/usr/bin/env node
// MONTA O ARQUIVO ÚNICO DA ENTREGA C (penalidade do Rei no XP) — o que se cola, inteiro, no SQL Editor de
// Production. NÃO foi aplicado em lugar nenhum: aplicar exige autorização própria.
//
//   supabase/rollout/xp-rei-aplicar.sql =
//     cabeçalho + BEGIN + partes/xp-rei-1-antes.sql + A MIGRAÇÃO (texto idêntico) + partes/xp-rei-3-conferencias.sql
//
// A migração entra VERBATIM, com o sha256 dela no cabeçalho; o teste R1 de scripts/testar-xp-rei-sql.mjs
// reprova se o arquivo gravado não for exatamente o que este script monta agora.
//
//   node scripts/montar-rollout-xp-rei.mjs            # regrava o arquivo
//   node scripts/montar-rollout-xp-rei.mjs --conferir # só confere (sai 1 se divergir)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const RAIZ = new URL("../", import.meta.url);
const ler = (rel) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
export const ARQUIVO_DO_ROLLOUT = "supabase/rollout/xp-rei-aplicar.sql";
export const MIGRACAO = "supabase/migrations/20261121120000_xp_penalidade_rei.sql";
export const lerMigracao = () => ler(MIGRACAO);

export function montarRollout(migracao = lerMigracao()) {
  const sha = createHash("sha256").update(migracao).digest("hex");
  const cabecalho = `-- ENTREGA C — PENALIDADE DO REI NO XP — COLAR ESTE ARQUIVO INTEIRO NO SQL EDITOR E RODAR UMA VEZ.
--
-- ARQUIVO GERADO por scripts/montar-rollout-xp-rei.mjs — não editar à mão.
-- Migração dentro dele, com o texto idêntico ao do repositório:
--   ${MIGRACAO}
--     sha256 ${sha}
--
-- ANTES: rodar supabase/rollout/xp-rei-checkpoint-1-antes.sql (só leitura) e ver pronto_para_aplicar = true.
--
-- Independe dos cosméticos e dos recordes: precisa só do progresso (partidas, ledger, crédito v1, lápides).
--
-- SÓ está aplicado se a última tela mostrar a linha "PENALIDADE DO REI (ENTREGA C) APLICADA E CONFERIDA";
-- sem ela, nada foi gravado. É UMA transação: recusas e retrato do "antes", a migração, 7 conferências e
-- COMMIT. Se QUALQUER passo falhar, rodar \`rollback;\` sozinho e mandar o erro. "lock timeout" = rodar de
-- novo um minuto depois.
--
-- DEPOIS: rodar supabase/rollout/xp-rei-checkpoint-3-depois.sql (só leitura) e ver tudo_certo = true.
--
-- O que muda: nasce a tabela da composição do XP (vazia), a regra v2 e a porta v2 do servidor. NADA do que
-- existe muda: a porta v1, a regra v1, XP, ledger, partidas, sequência e privilégios ficam como estão. O
-- servidor no ar hoje continua creditando pela v1; a regra nova só vale depois do servidor novo.
--
-- Rollback: supabase/rollback/20261121120000_xp_penalidade_rei_rollback.sql.

`;
  return cabecalho + "begin;\n\n" + ler("supabase/rollout/partes/xp-rei-1-antes.sql") +
    migracao + ler("supabase/rollout/partes/xp-rei-3-conferencias.sql");
}

if (process.argv[1]?.endsWith("montar-rollout-xp-rei.mjs")) {
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
