// DECISÃO DA CI: o Playwright roda nesta execução?
//
// Lê a base (PR: o commit base; push: o `before`) e o HEAD do ambiente, lista os arquivos
// alterados e escreve `e2e=true|false` em $GITHUB_OUTPUT. A regra está em lib/mudancas.mjs;
// aqui só se descobre a lista — e, se ela não puder ser descoberta, o resultado é rodar tudo.
//
//   REF=refs/heads/x BASE=<sha> HEAD=<sha> node scripts/ci-mudancas.mjs
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { precisaDeE2E } from "./lib/mudancas.mjs";

const { REF = "", BASE = "", HEAD = "HEAD", GITHUB_OUTPUT } = process.env;

function arquivosAlterados() {
  if (!/^[0-9a-f]{7,40}$/i.test(BASE) || /^0+$/.test(BASE)) return null;
  try {
    const saida = execFileSync("git", ["diff", "--name-only", BASE, HEAD], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return saida.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

const arquivos = arquivosAlterados();
const { e2e, motivo } = precisaDeE2E({ ref: REF, arquivos });
console.log(`e2e=${e2e} — ${motivo}`);
if (arquivos) console.log(arquivos.map((a) => `  ${a}`).join("\n"));
if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `e2e=${e2e}\n`);
