// DECISÃO DA CI: o Playwright roda nesta execução?
//
// Lista os arquivos alterados e escreve `e2e=true|false` em $GITHUB_OUTPUT. A regra está em
// lib/mudancas.mjs; aqui só se descobre a lista — e, se ela não puder ser descoberta, o resultado
// é rodar tudo.
//
// A BASE NÃO É O PUSH ANTERIOR. Numa PR, é o commit base da PR. Num push, é o ponto em que a
// branch saiu da main (`merge-base`): a branch INTEIRA. Comparar com o push anterior deixava um
// buraco — push de código cujo e2e foi cancelado (ou ficou vermelho), depois um push só de docs, e
// a branch ficava verde sem o código nunca ter passado pelo Playwright.
//
//   REF=refs/heads/x HEAD=<sha> [BASE=<sha da base da PR>] [BASE_REF=origin/main] node scripts/ci-mudancas.mjs
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { precisaDeE2E } from "./lib/mudancas.mjs";

const { REF = "", BASE = "", BASE_REF = "origin/main", HEAD = "HEAD", GITHUB_OUTPUT } = process.env;
const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function arquivosAlterados() {
  try {
    const base = BASE || git("merge-base", BASE_REF, HEAD);
    if (!/^[0-9a-f]{7,40}$/i.test(base) || /^0+$/.test(base)) return null;
    // --no-renames: uma renomeação lista a origem (como removida) e o destino. Com a detecção
    // ligada, mover um arquivo de teste para docs/ apareceria só como docs/… e pularia o e2e.
    const saida = git("diff", "--name-only", "--no-renames", base, HEAD);
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
