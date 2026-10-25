// UMA VARIÁVEL DO BUILD, lida como o Vite lê — para os scripts nativos concordarem com o pacote web.
//
// O Vite junta, em ordem de precedência crescente, `.env`, `.env.local`, `.env.[modo]` e
// `.env.[modo].local` da pasta do app, e o que já está no ambiente do processo vence tudo. Um script
// que só olhasse `process.env` discordaria do pacote quando a variável mora num `.env.local` — e foi
// o que o red team da Fase 9 achou: o client ID do Google no iOS no pacote, sem o esquema de URL no
// Info.plist, fecha o app ao tocar no Google.
import { existsSync, readFileSync } from "node:fs";

/** O valor de `nome` para o build do app (`modo` = production, o do `vite build`). */
export function variavelDoBuild(nome, pastaDoApp, modo = "production") {
  if (process.env[nome] !== undefined) return process.env[nome];
  let valor;
  for (const arquivo of [".env", ".env.local", `.env.${modo}`, `.env.${modo}.local`]) {
    const caminho = new URL(arquivo, pastaDoApp);
    if (!existsSync(caminho)) continue;
    for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
      if (!m || m[1] !== nome) continue;
      valor = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return valor;
}
