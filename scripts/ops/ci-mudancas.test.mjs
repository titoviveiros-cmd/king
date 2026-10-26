// A DECISÃO DE RODAR O PLAYWRIGHT — só documentação dispensa, e a dúvida sempre roda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ehDocumentacao, precisaDeE2E } from "../lib/mudancas.mjs";

const BRANCH = "refs/heads/perf/x";
const SCRIPT = fileURLToPath(new URL("../ci-mudancas.mjs", import.meta.url));

/** Um repositório git descartável e o script de decisão rodando dentro dele. */
function repositorio(dir) {
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...a], { cwd: dir, encoding: "utf8" }).trim();
  const commit = (arquivo, texto) => {
    mkdirSync(dirname(join(dir, arquivo)), { recursive: true });
    writeFileSync(join(dir, arquivo), texto);
    git("add", "-A"); git("commit", "-q", "-m", arquivo);
    return git("rev-parse", "HEAD");
  };
  const decidir = (env) => {
    const out = join(dir, "saida.out"); // fora de qualquer commit: o diff é entre commits
    execFileSync(process.execPath, [SCRIPT], { cwd: dir, env: { ...process.env, REF: BRANCH, BASE: "", ...env, GITHUB_OUTPUT: out }, stdio: "pipe" });
    const r = readFileSync(out, "utf8"); rmSync(out); return r;
  };
  git("init", "-q", "-b", "main");
  return { git, commit, decidir };
}

function emRepositorio(corpo) {
  const dir = mkdtempSync(join(tmpdir(), "king-mudancas-git-"));
  try { corpo(repositorio(dir), dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

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

test("CLI com base explícita (PR): docs dispensa e código roda", () => {
  emRepositorio(({ commit, decidir }) => {
    const c0 = commit("a.ts", "1");
    const c1 = commit("docs/b.md", "1");
    const c2 = commit("a.ts", "2");
    assert.equal(decidir({ BASE: c0, HEAD: c1 }), "e2e=false\n");
    assert.equal(decidir({ BASE: c1, HEAD: c2 }), "e2e=true\n");
    assert.equal(decidir({ BASE: c0, HEAD: c2 }), "e2e=true\n");
  });
});

test("CLI no push: a base é o merge-base com a main, não o push anterior", () => {
  emRepositorio(({ git, commit, decidir }) => {
    const c0 = commit("a.ts", "1");
    // Push de código (e2e cancelado ou vermelho), depois push só de docs: comparar com o push
    // anterior daria "só documentação". Comparando com a main, o código continua na conta.
    git("checkout", "-q", "-b", "feat/codigo");
    commit("a.ts", "2");
    const docs = commit("docs/b.md", "1");
    assert.equal(decidir({ BASE_REF: "main", HEAD: docs }), "e2e=true\n");
    // Uma branch que só mexe em docs continua dispensada.
    git("checkout", "-q", "-b", "feat/docs", c0);
    const soDocs = commit("docs/c.md", "1");
    assert.equal(decidir({ BASE_REF: "main", HEAD: soDocs }), "e2e=false\n");
  });
});

test("CLI: mover código para docs/ lista a origem e roda", () => {
  emRepositorio(({ git, commit, decidir }, dir) => {
    commit("apps/web/tests/fixtures/pior-caso.html", "<p>1</p>");
    git("checkout", "-q", "-b", "feat/mover");
    mkdirSync(join(dir, "docs"), { recursive: true });
    git("mv", "apps/web/tests/fixtures/pior-caso.html", "docs/pior-caso.html");
    git("commit", "-q", "-m", "mover");
    assert.equal(decidir({ BASE_REF: "main", HEAD: git("rev-parse", "HEAD") }), "e2e=true\n");
  });
});

test("CLI: base inválida, inexistente ou de branch nova escreve e2e=true", () => {
  const dir = mkdtempSync(join(tmpdir(), "king-mudancas-"));
  try {
    for (const env of [
      { BASE: "0000000000000000000000000000000000000000" },
      { BASE: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
      { BASE: "nao-e-sha" },
      { BASE: "", BASE_REF: "referencia/que-nao-existe" },
    ]) {
      const out = join(dir, "out");
      execFileSync(process.execPath, [SCRIPT], { env: { ...process.env, REF: BRANCH, HEAD: "HEAD", ...env, GITHUB_OUTPUT: out }, stdio: "pipe" });
      assert.equal(readFileSync(out, "utf8"), "e2e=true\n", JSON.stringify(env));
      rmSync(out);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
