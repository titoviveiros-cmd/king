// SMOKE DA FUNÇÃO `excluir-conta` NO PROJETO DE VERDADE (Fase 9, passo F do rollout).
//
//   node scripts/smoke-excluir-conta.mjs --url https://<ref>.supabase.co --chave <chave PÚBLICA>
//       → só o que NÃO cria nada: CORS, 405, 401 sem credencial e com credencial forjada.
//
//   node scripts/smoke-excluir-conta.mjs --url … --chave … --autorizado-criar-convidado
//       → além disso, cria UM convidado anônimo descartável, confere a recusa sem EXCLUIR, exclui de
//         verdade e repete (idempotência). Cria e apaga um usuário no projeto: só com autorização.
//
// A chave é a PÚBLICA (publishable/anon) — nunca a de serviço. Depois da parte com convidado,
// conferir no SQL Editor (só leitura) com o id impresso no fim:
//   select (select count(*) from king_private.contas_excluidas where player_id = '<id>') as lapide,
//          (select count(*) from public.players where id = '<id>') as perfil,
//          (select count(*) from auth.users where id = '<id>') as usuario;   -- esperado: 1, 0, 0
import { smokeExclusao } from "./lib/smoke-exclusao.mjs";

const arg = (nome) => { const i = process.argv.indexOf(nome); return i > 0 ? process.argv[i + 1] : undefined; };
const url = arg("--url");
const chave = arg("--chave");
if (!url || !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url) || !chave) {
  console.error("uso: node scripts/smoke-excluir-conta.mjs --url https://<ref>.supabase.co --chave <chave pública> [--autorizado-criar-convidado]");
  process.exit(2);
}
if (/service_role|sb_secret_/.test(chave)) {
  console.error("RECUSADO: isto parece a chave de SERVIÇO. O smoke usa só a chave pública.");
  process.exit(2);
}

const { passos, idDescartavel } = await smokeExclusao({
  url, chave, rede: (...a) => fetch(...a), criarDescartavel: process.argv.includes("--autorizado-criar-convidado"),
});
for (const p of passos) console.log(`  ${p.ok ? "ok" : "XX"}  ${p.nome} — ${p.detalhe}`);
if (idDescartavel) console.log(`\nid do convidado descartável (para a conferência da lápide): ${idDescartavel}`);
const falhas = passos.filter((p) => !p.ok).length;
console.log(falhas ? `\nREPROVADO — ${falhas} de ${passos.length}\n` : `\nAPROVADO — ${passos.length} verificações\n`);
process.exit(falhas ? 1 : 0);
