// A SONDA PELA LINHA DE COMANDO — o processo de verdade, sobre o servidor COMPILADO. Sem banco: o
// destino é uma porta local fechada (recusa imediata). A lógica 28P01 → confirmação está provada em
// `apps/server/src/progresso/sonda.test.ts` e, com o Postgres de verdade, no T23 da suíte SQL.
//
// Exige `npm run build:server` antes (o `npm run test:ops` já faz).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../progresso-sonda.mjs", import.meta.url));
const CA_TESTE = fileURLToPath(new URL("./fixtures/ca-teste.pem", import.meta.url));
const SENHA = "senha-que-nunca-pode-aparecer-na-saida-0123";
const CORPO_DA_CA = readFileSync(CA_TESTE, "utf8").split("\n")[1];

async function portaFechada() {
  return await new Promise((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); });
}
function preparar(t, linhas) {
  const dir = mkdtempSync(join(tmpdir(), "king-sonda-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const arquivo = join(dir, "progress.env.pendente");
  writeFileSync(arquivo, linhas.join("\n"));
  return arquivo;
}
const rodar = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 60_000 });
const limpo = (r) => {
  const t = `${r.stdout}${r.stderr}`;
  return !t.includes(SENHA) && !t.includes("postgresql://") && !t.includes(CORPO_DA_CA) && !t.includes("king_server.");
};

test("banco inalcançável: erro transitório (saída 12), 1 tentativa, e nada sensível na saída", async (t) => {
  const porta = await portaFechada();
  const arquivo = preparar(t, [
    "KING_PROGRESS_MODE=database",
    `KING_PROGRESS_DATABASE_URL=postgresql://king_server.abcdefghijklmnopqrst:${SENHA}@127.0.0.1:${porta}/postgres`,
    `KING_PROGRESS_SSL_ROOT_CERT=${CA_TESTE}`,
  ]);
  const r = rodar(arquivo);
  assert.equal(r.status, 12, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /tentativas: 1/);
  assert.match(r.stdout, /ECONNREFUSED\/transitoria/);
  assert.match(r.stdout, /estado final: transitoria/);
  assert.ok(limpo(r), "vazou segredo, URL ou CA");
});

test("configuração inválida: saída 78, sem tentativa, e o motivo sem VALOR", (t) => {
  const arquivo = preparar(t, [
    "KING_PROGRESS_MODE=database",
    `KING_PROGRESS_DATABASE_URL=postgresql://king_server.x:${SENHA}@127.0.0.1:1/postgres?sslmode=require`,
    `KING_PROGRESS_SSL_ROOT_CERT=${CA_TESTE}`,
  ]);
  const r = rodar(arquivo);
  assert.equal(r.status, 78);
  assert.match(r.stdout, /parâmetros SSL/);
  assert.match(r.stdout, /tentativas: 0/);
  assert.ok(limpo(r));
});

test("CA inválida e arquivo inexistente: 78", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "king-sonda-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const caFalsa = join(dir, "falsa.crt");
  writeFileSync(caFalsa, "não sou certificado");
  const arquivo = join(dir, "progress.env.pendente");
  writeFileSync(arquivo, ["KING_PROGRESS_MODE=database", `KING_PROGRESS_DATABASE_URL=postgresql://u:${SENHA}@127.0.0.1:1/postgres`, `KING_PROGRESS_SSL_ROOT_CERT=${caFalsa}`].join("\n"));
  const r1 = rodar(arquivo);
  assert.equal(r1.status, 78);
  assert.match(r1.stdout, /não contém certificado PEM/);
  assert.ok(limpo(r1));
  assert.equal(rodar(join(dir, "nao-existe.env")).status, 78);
});

test("uso: exige UM caminho ABSOLUTO (saída 64) — nada de URL ou senha por argumento", () => {
  assert.equal(rodar().status, 64);
  assert.equal(rodar("relativo/progress.env").status, 64);
  const r = rodar(`postgresql://u:${SENHA}@h/db`);
  assert.equal(r.status, 64);
  assert.ok(limpo(r));
  assert.equal(rodar("/a", "/b").status, 64);
});
