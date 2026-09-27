// A SONDA DO PROGRESSO, PELA LINHA DE COMANDO — para a VPS, ANTES de ativar o progress.env.
//
// USO (na VPS, como o MESMO usuário do PM2, depois de `npm run build:server`):
//   node scripts/progresso-sonda.mjs /etc/king/progress.env.pendente
//
// Roda o boot do progresso UMA vez com o código compilado do próprio servidor
// (apps/server/dist/progresso/sonda.js): parser, CA, pool com TLS e a lógica de sonda — inclusive
// a confirmação única do 28P01, 30 s depois. Não credita, não toca o outbox, não reinicia nada.
//
// Imprime SÓ o estado final, o código seguro de cada tentativa e quantas foram.
//
// SAÍDA: 0 closed · 10 open_auth · 11 open_circuit · 12 erro transitório · 78 configuração
//        inválida · 64 uso · 70 servidor não compilado ou falha inesperada.
import { isAbsolute } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 1 || !isAbsolute(args[0])) {
  // O argumento NÃO é ecoado: se alguém colar uma URL com senha aqui, ela não vai para o terminal.
  console.error("uso: node scripts/progresso-sonda.mjs <caminho ABSOLUTO do arquivo de progresso>");
  process.exit(64);
}

let sonda;
try {
  sonda = await import(new URL("../apps/server/dist/progresso/sonda.js", import.meta.url).href);
} catch {
  console.error("[sonda] servidor não compilado: rode `npm run build:server` antes");
  process.exit(70);
}

try {
  const r = await sonda.sondarProgresso({ arquivo: args[0] });
  for (const linha of sonda.linhasDaSonda(r)) console.log(linha);
  process.exitCode = r.saida;
} catch (e) {
  console.error(`[sonda] falha inesperada: ${e?.name ?? "erro"}`);
  process.exitCode = 70;
}
