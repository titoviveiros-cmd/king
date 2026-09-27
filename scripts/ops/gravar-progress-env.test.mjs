// O GRAVADOR DO progress.env.pendente — para a VPS. Senha só por `read -rs` (nunca por argumento),
// `umask 077`, arquivo temporário na MESMA pasta + fsync + rename, e jamais o progress.env ativo.
//
// Roda o script de verdade, com bash. Permissões POSIX só são conferidas fora do Windows (a CI é
// Linux); no Git Bash o NTFS não tem modo 600.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./gravar-progress-env.sh", import.meta.url));
const CA_TESTE = fileURLToPath(new URL("./fixtures/ca-teste.pem", import.meta.url));
const SENHA = "Ab3dEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde"; // 43 caracteres base64url, só de teste
const REF = "abcdefghijklmnopqrst";
const HOST = "aws-0-sa-east-1.pooler.supabase.com";
const POSIX = process.platform !== "win32";
/** Caminho que o bash entende (no Git Bash, C:\… vira /c/…). */
const sh = (p) => (POSIX ? p : p.replace(/^([A-Za-z]):\\/, (_, d) => `/${d.toLowerCase()}/`).replace(/\\/g, "/"));

function preparar(t) {
  const raiz = mkdtempSync(join(tmpdir(), "king-gravar-"));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));
  const etc = join(raiz, "etc-king");
  mkdirSync(etc);
  const ca = join(etc, "supabase-ca.crt");
  writeFileSync(ca, readFileSync(CA_TESTE));
  return { raiz, etc, ca, destino: join(etc, "progress.env.pendente") };
}
function rodar(args, entrada, env = {}) {
  return spawnSync("bash", [sh(SCRIPT), ...args], { input: entrada, encoding: "utf8", env: { ...process.env, ...env } });
}
const argsBase = (p, extra = []) => ["--ca", sh(p.ca), "--outbox", "/var/lib/king/progresso-outbox", "--host", HOST, "--ref", REF, "--destino", sh(p.destino), ...extra];
const semSegredo = (r) => !`${r.stdout}${r.stderr}`.includes(SENHA) && !`${r.stdout}${r.stderr}`.includes("postgresql://");

/** `mv` e `sync` de mentira que registram o que receberam; o `mv` chama o de verdade. */
function binDeRegistro(p) {
  const bin = join(p.raiz, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(p.raiz, "chamadas.log");
  writeFileSync(join(bin, "mv"), `#!/usr/bin/env bash\nprintf 'mv %s\\n' "$*" >> "${sh(log)}"\nfor a in "$@"; do case "$a" in -*) ;; *) [ -f "$a" ] && printf 'conteudo %s\\n' "$(wc -l < "$a")" >> "${sh(log)}" && break ;; esac; done\nexec "$(PATH=/usr/bin:/bin command -v mv)" "$@"\n`);
  writeFileSync(join(bin, "sync"), `#!/usr/bin/env bash\nprintf 'sync %s\\n' "$*" >> "${sh(log)}"\nexit 0\n`);
  chmodSync(join(bin, "mv"), 0o755);
  chmodSync(join(bin, "sync"), 0o755);
  return { env: { PATH: `${sh(bin)}:${process.env.PATH}` }, log };
}
/**
 * O ambiente de cada caso. No Git Bash, `sync ARQUIVO` falha em QUALQUER arquivo (abre só para
 * leitura, e o Windows exige escrita para o flush) — e essa falha ABORTAVA o script antes do rename,
 * fazendo casos de recusa passarem por acidente, e não pela proteção (três mutações escaparam
 * assim). No Windows, então, todo caso usa o `sync` de registro e o fluxo chega até o `mv`; no
 * Linux — a VPS e a CI — o fsync é o de verdade.
 */
const ambiente = (p) => (POSIX ? {} : binDeRegistro(p).env);

test("caminho feliz: grava o pendente com as 4 chaves, sem ecoar a senha nem a URL", (t) => {
  const p = preparar(t);
  const r = rodar(argsBase(p), `${sh(p.ca)}\n${SENHA}\n`, ambiente(p));
  assert.equal(r.status, 0, r.stderr);
  assert.ok(semSegredo(r), "senha ou URL na saída");
  assert.equal(readFileSync(p.destino, "utf8"), [
    "KING_PROGRESS_MODE=database",
    `KING_PROGRESS_DATABASE_URL=postgresql://king_server.${REF}:${SENHA}@${HOST}:5432/postgres`,
    `KING_PROGRESS_SSL_ROOT_CERT=${sh(p.ca)}`,
    "KING_PROGRESS_OUTBOX_DIR=/var/lib/king/progresso-outbox",
    "",
  ].join("\n"));
  assert.deepEqual(readdirSync(p.etc).sort(), ["progress.env.pendente", "supabase-ca.crt"], "sobrou temporário");
  if (POSIX) assert.equal(statSync(p.destino).mode & 0o777, 0o600);
});

test("temporário na MESMA pasta, completo ANTES do rename, e fsync do arquivo e da pasta", (t) => {
  const p = preparar(t);
  const { env, log } = binDeRegistro(p);
  const r = rodar(argsBase(p), `${sh(p.ca)}\n${SENHA}\n`, env);
  assert.equal(r.status, 0, r.stderr);
  const chamadas = readFileSync(log, "utf8").trim().split("\n");
  const mv = chamadas.filter((l) => l.startsWith("mv "));
  assert.equal(mv.length, 1, `mv chamado ${mv.length}x`);
  const [origem, destino] = mv[0].split(" ").slice(-2);
  assert.equal(destino, sh(p.destino));
  assert.equal(origem.slice(0, origem.lastIndexOf("/")), sh(p.etc), "o temporário não está na mesma pasta do destino");
  assert.match(origem.slice(origem.lastIndexOf("/") + 1), /^\.progress\.env\./);
  assert.ok(chamadas.includes("conteudo 4"), "o arquivo não estava completo no rename");
  const syncs = chamadas.filter((l) => l.startsWith("sync "));
  assert.ok(syncs.some((l) => l.includes(".progress.env.")), "sem fsync do arquivo");
  assert.ok(syncs.some((l) => l === `sync ${sh(p.etc)}`), "sem fsync da pasta");
  assert.ok(chamadas.indexOf(syncs.find((l) => l.includes(".progress.env."))) < chamadas.indexOf(mv[0]), "fsync depois do rename");
});

test("senha NUNCA por argumento: --senha, --password, URL ou `@` na linha de comando são recusados", (t) => {
  const p = preparar(t);
  for (const extra of [["--senha", SENHA], [`--password=${SENHA}`], ["--url", `postgresql://u:${SENHA}@h/db`], [`--host=u:${SENHA}@${HOST}`],
    ["--dono", `u:${SENHA}@x`]]) {
    const r = rodar([...argsBase(p), ...extra], `${sh(p.ca)}\n${SENHA}\n`, ambiente(p));
    assert.notEqual(r.status, 0, `aceitou ${extra[0]}`);
    assert.ok(semSegredo(r), `ecoou com ${extra[0]}`);
    assert.equal(existsSync(p.destino), false);
  }
});

test("nunca o progress.env ATIVO, e nunca sobrescreve um pendente que já existe", (t) => {
  const p = preparar(t);
  const ativo = join(p.etc, "progress.env");
  const r1 = rodar([...argsBase(p).slice(0, -2), "--destino", sh(ativo)], `${sh(p.ca)}\n${SENHA}\n`, ambiente(p));
  assert.notEqual(r1.status, 0);
  assert.equal(existsSync(ativo), false);
  writeFileSync(p.destino, "ANTERIOR\n");
  const r2 = rodar(argsBase(p), `${sh(p.ca)}\n${SENHA}\n`, ambiente(p));
  assert.notEqual(r2.status, 0);
  assert.equal(readFileSync(p.destino, "utf8"), "ANTERIOR\n");
});

test("confirmação explícita da CA: caminho redigitado diferente reprova e nada é gravado", (t) => {
  const p = preparar(t);
  const r = rodar(argsBase(p), `/outro/caminho.crt\n${SENHA}\n`, ambiente(p));
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(p.destino), false);
  assert.ok(semSegredo(r));
});

test("CA que não é certificado, outbox relativo e senha fora do formato são recusados", (t) => {
  const p = preparar(t);
  const falso = join(p.etc, "falso.crt");
  writeFileSync(falso, "não sou certificado\n");
  const casos = [
    [["--ca", sh(falso), ...argsBase(p).slice(2)], `${sh(falso)}\n${SENHA}\n`],
    [[...argsBase(p).slice(0, 2), "--outbox", "relativo/outbox", ...argsBase(p).slice(4)], `${sh(p.ca)}\n${SENHA}\n`],
    [argsBase(p), `${sh(p.ca)}\ncurta\n`],
    [argsBase(p), `${sh(p.ca)}\n${SENHA}x\n`],
  ];
  for (const [args, entrada] of casos) {
    const r = rodar(args, entrada, ambiente(p));
    assert.notEqual(r.status, 0, `aceitou: ${args.join(" ")}`);
    assert.equal(existsSync(p.destino), false);
    assert.ok(!`${r.stdout}${r.stderr}`.includes("curta"), "ecoou a senha recusada");
  }
});

test("o script lê a senha com `read -rs` e escreve com o `printf` embutido (fora de argv de processo)", () => {
  const texto = readFileSync(SCRIPT, "utf8");
  assert.match(texto, /read -r?s[r]? /);
  assert.match(texto, /umask 077/);
  assert.ok(!/echo[^\n]*\$SENHA/.test(texto), "echo com a senha");
  assert.ok(!/export\s+SENHA|\benv\s[^\n]*SENHA/.test(texto), "senha exportada para processo filho");
});
