// GERA os arquivos de domínio associado (App Links / Universal Links) em apps/web/public/.well-known/.
//
//   KING_ANDROID_SHA256="AA:BB:…" KING_APPLE_TEAM_ID="ABCDE12345" node scripts/gerar-well-known.mjs
//
// GATE MANUAL (Fase 9): os dois valores só existem fora do repositório — o SHA-256 do certificado de
// assinatura da Play (Play Console → Integridade do app → Assinatura de apps; com Play App Signing,
// a chave de ASSINATURA do app, e opcionalmente a de upload, separadas por vírgula) e o Team ID da
// Apple. Gerados os arquivos, eles vão para o repositório e só ficam públicos quando a main for
// publicada — a decisão de publicar é do dono do projeto, não deste script.
//
// Sem os dois valores, o script RECUSA e não grava nada.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { arquivosDeDominio } from "./lib/well-known.mjs";

const destino = fileURLToPath(new URL("../apps/web/public/.well-known/", import.meta.url));
try {
  const arquivos = arquivosDeDominio({ sha256: process.env.KING_ANDROID_SHA256, teamId: process.env.KING_APPLE_TEAM_ID });
  mkdirSync(destino, { recursive: true });
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    writeFileSync(destino + nome, conteudo);
    console.log(`  ok  ${nome}`);
  }
  console.log(`\nGravado em ${destino}\nConfira, faça o commit, e publique só com autorização.\n`);
} catch (e) {
  console.error(`\nNADA GRAVADO: ${e.message}\n`);
  process.exit(1);
}
