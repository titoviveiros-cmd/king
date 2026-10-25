// A DECISÃO DE RODAR O PLAYWRIGHT — só documentação dispensa, e a dúvida sempre roda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ehDocumentacao, precisaDeE2E } from "../lib/mudancas.mjs";

const BRANCH = "refs/heads/perf/x";

test("só documentação dispensa o e2e", () => {
  for (const a of ["docs/KING-MOBILE-RC.md", "README.md", "apps/web/README.md", "docs/img/fluxo.png"]) {
    assert.equal(ehDocumentacao(a), true, a);
  }
  assert.deepEqual(precisaDeE2E({ ref: BRANCH, arquivos: ["docs/a.md", "README.md"] }).e2e, false);
});

test("qualquer arquivo fora da documentação roda tudo", () => {
  for (const a of [
    "apps/web/src/ui/Mesa.tsx", "apps/web/src/notas.md", "apps/web/public/termos.md", "package-lock.json",
    ".github/workflows/ci.yml", "apps/web/playwright.config.ts", "scripts/ci-mudancas.mjs", "apps/web/index.html",
  ]) {
    assert.equal(ehDocumentacao(a), false, a);
    assert.equal(precisaDeE2E({ ref: BRANCH, arquivos: ["docs/a.md", a] }).e2e, true, a);
  }
});

test("fail-closed: main, sem base ou sem arquivos roda tudo", () => {
  assert.equal(precisaDeE2E({ ref: "refs/heads/main", arquivos: ["docs/a.md"] }).e2e, true);
  assert.equal(precisaDeE2E({ ref: BRANCH, arquivos: null }).e2e, true);
  assert.equal(precisaDeE2E({ ref: BRANCH, arquivos: [] }).e2e, true);
});

test("CLI: num repositório de verdade, docs dispensa e código roda", () => {
  const dir = mkdtempSync(join(tmpdir(), "king-mudancas-git-"));
  try {
    const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...a], { cwd: dir, encoding: "utf8" }).trim();
    const commit = (arquivo, texto) => { writeFileSync(join(dir, arquivo), texto); git("add", "-A"); git("commit", "-q", "-m", arquivo); return git("rev-parse", "HEAD"); };
    git("init", "-q");
    mkdirSync(join(dir, "docs"));
    const c0 = commit("a.ts", "1");
    const c1 = commit("docs/b.md", "1");
    const c2 = commit("a.ts", "2");
    const script = fileURLToPath(new URL("../ci-mudancas.mjs", import.meta.url));
    const decidir = (BASE, HEAD) => {
      const out = join(dir, "saida.out"); // fora de qualquer commit: o diff é entre commits
      execFileSync(process.execPath, [script], { cwd: dir, env: { ...process.env, REF: BRANCH, BASE, HEAD, GITHUB_OUTPUT: out }, stdio: "pipe" });
      const r = readFileSync(out, "utf8"); rmSync(out); return r;
    };
    assert.equal(decidir(c0, c1), "e2e=false\n");
    assert.equal(decidir(c1, c2), "e2e=true\n");
    assert.equal(decidir(c0, c2), "e2e=true\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: base inválida, inexistente ou de branch nova escreve e2e=true", () => {
  const dir = mkdtempSync(join(tmpdir(), "king-mudancas-"));
  try {
    const script = fileURLToPath(new URL("../ci-mudancas.mjs", import.meta.url));
    for (const BASE of ["", "0000000000000000000000000000000000000000", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "nao-e-sha"]) {
      const out = join(dir, `out-${BASE.length}-${BASE.slice(0, 4)}`);
      execFileSync(process.execPath, [script], { env: { ...process.env, REF: BRANCH, BASE, HEAD: "HEAD", GITHUB_OUTPUT: out }, stdio: "pipe" });
      assert.equal(readFileSync(out, "utf8"), "e2e=true\n", `BASE=${BASE}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
