#!/usr/bin/env node
// MONTA O ARQUIVO ÚNICO DO PASSO D2 (retenção das lápides, E-2) — o que o Tito cola, inteiro, no SQL
// Editor de Production.
//
//   supabase/rollout/retencao-aplicar.sql =
//     cabeçalho + BEGIN + partes/retencao-1-antes.sql + A MIGRAÇÃO (texto idêntico) + partes/retencao-3-conferencias.sql
//
// A migração entra VERBATIM, e o cabeçalho traz o sha256 dela: o arquivo do rollout nunca pode divergir
// dela. O teste R13 de `scripts/testar-progresso-sql.mjs` reprova se o arquivo gravado não for exatamente
// o que este script monta agora.
//
//   node scripts/montar-rollout-retencao.mjs            # regrava o arquivo
//   node scripts/montar-rollout-retencao.mjs --conferir # só confere (sai 1 se divergir)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const RAIZ = new URL("../", import.meta.url);
const ler = (rel) => readFileSync(new URL(rel, RAIZ), "utf8").replace(/\r\n/g, "\n");
export const ARQUIVO_DO_ROLLOUT = "supabase/rollout/retencao-aplicar.sql";
export const MIGRACAO = "supabase/migrations/20261026120000_retencao_das_lapides.sql";

export function montarRollout() {
  const migracao = ler(MIGRACAO);
  const sha = createHash("sha256").update(migracao).digest("hex");
  const cabecalho = `-- PASSO D2 — RETENÇÃO DAS LÁPIDES (Fase 9, E-2) — COLAR ESTE ARQUIVO INTEIRO NO SQL EDITOR E RODAR UMA VEZ.
--
-- ARQUIVO GERADO por scripts/montar-rollout-retencao.mjs — não editar à mão.
-- Migração dentro dele, texto idêntico: ${MIGRACAO}
--   sha256 ${sha}
--
-- ANTES: rodar supabase/rollout/retencao-checkpoint-1-antes.sql (só leitura) e ver pronto_para_aplicar = true.
--
-- Colar INTEIRO, numa aba só, e rodar UMA vez. O editor pode pedir confirmação de operação destrutiva
-- (por causa do \`on commit drop\` e do \`delete\` dentro da função): confirmar. SÓ está aplicado se a última
-- tela mostrar a linha "RETENÇÃO DAS LÁPIDES (E-2) APLICADA E CONFERIDA"; sem ela, nada foi gravado.
--
-- É UMA transação: BEGIN, recusas e retrato do "antes", a migração, conferências e COMMIT. Se QUALQUER
-- passo falhar, o erro aparece, o COMMIT não roda e NADA é gravado — nesse caso, rodar \`rollback;\`
-- sozinho para limpar a sessão e me mandar o erro. "lock timeout" = uma exclusão de conta estava no
-- meio: rodar de novo um minuto depois. Se tudo passar, a última tela mostra uma linha
-- "RETENÇÃO DAS LÁPIDES (E-2) APLICADA E CONFERIDA".
--
-- DEPOIS: rodar supabase/rollout/retencao-checkpoint-3-depois.sql (só leitura) e ver tudo_certo = true.
--
-- O que muda: nasce a função de expurgo (EXECUTE só para king_server) e o estado dele (uma linha, sem
-- marcador); a função da lápide passa a guardar a exclusão mais recente. NENHUMA lápide sai aqui — nem
-- as vencidas: quem expurga é o servidor novo, no passo S. O servidor que está no ar hoje não chama a
-- função nova, e o crédito de XP segue o mesmo. Durante os poucos segundos da transação, uma exclusão de
-- conta espera e segue; o crédito de XP não espera.
--
-- Rollback: supabase/rollback/20261026120000_retencao_das_lapides_rollback.sql.

`;
  return cabecalho + "begin;\n\n" + ler("supabase/rollout/partes/retencao-1-antes.sql") +
    migracao + ler("supabase/rollout/partes/retencao-3-conferencias.sql");
}

if (import.meta.url === new URL(process.argv[1], "file://").href || process.argv[1]?.endsWith("montar-rollout-retencao.mjs")) {
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
