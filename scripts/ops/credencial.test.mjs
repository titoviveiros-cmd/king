// O GERADOR DE CREDENCIAL DO king_server — SCRAM compatível com o PostgreSQL, senha que nunca
// aparece e SQL temporário que só leva o VERIFICADOR.
//
// A compatibilidade com um Postgres DE VERDADE (login por SCRAM com o verificador gerado aqui) está
// em `scripts/testar-progresso-sql.mjs`, T22.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gerarSenha, validarVerificador, verificadorScram } from "../lib/scram.mjs";
import { gerarCredencial, limparCredencial } from "./credencial-king-server.mjs";

const CLI = fileURLToPath(new URL("./credencial-king-server.mjs", import.meta.url));
const b64 = (s) => Buffer.from(s, "base64");

test("RFC 7677 §3: StoredKey e ServerKey batem com o vetor oficial do SCRAM-SHA-256", () => {
  // Usuário "user", senha "pencil", sal e iterações do exemplo da RFC.
  const v = verificadorScram("pencil", { sal: b64("W22ZaJ0SNY7soEsUEjb6gQ=="), iteracoes: 4096 });
  const [, iter, sal, stored, server] = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(v);
  assert.equal(iter, "4096");
  assert.equal(sal, "W22ZaJ0SNY7soEsUEjb6gQ==");
  const authMessage = [
    "n=user,r=rOprNGfwEbeRWgbNEkqO",
    "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096",
    "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0",
  ].join(",");
  // ServerSignature = HMAC(ServerKey, AuthMessage) — o "v=" da RFC.
  assert.equal(createHmac("sha256", b64(server)).update(authMessage).digest("base64"), "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
  // ClientKey = ClientProof XOR HMAC(StoredKey, AuthMessage); StoredKey = H(ClientKey) — o "p=" da RFC.
  const assinatura = createHmac("sha256", b64(stored)).update(authMessage).digest();
  const prova = b64("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=");
  const clientKey = Buffer.from(prova.map((byte, i) => byte ^ assinatura[i]));
  assert.equal(createHash("sha256").update(clientKey).digest("base64"), stored);
});

test("formato do verificador: 4096 iterações, sal de 16 bytes, chaves de 32 bytes — e sal novo a cada vez", () => {
  const a = verificadorScram("uma-senha");
  const b = verificadorScram("uma-senha");
  assert.equal(validarVerificador(a), true);
  assert.notEqual(a, b, "sal repetido");
  const [, iter, sal, stored, server] = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(a);
  assert.equal(Number(iter), 4096);
  assert.equal(b64(sal).length, 16);
  assert.equal(b64(stored).length, 32);
  assert.equal(b64(server).length, 32);
});

test("o validador recusa verificador MALFORMADO — inclusive o `$` comido pelo shell, que já aconteceu", () => {
  const bom = verificadorScram("x");
  const ruins = [
    bom.replace("SCRAM-SHA-256$", "SCRAM-SHA-256"),        // `$` engolido
    bom.replace(/\$([^:$]+):/, "$1:").replace("$", ""),     // os dois `$` engolidos
    bom.replace("4096", "1000"),                            // iterações abaixo do padrão
    bom.slice(0, -4),                                       // ServerKey truncada
    bom.replace(/:([^:]+)$/, ":não-é-base64"),
    `md5${"a".repeat(32)}`,
    "", "senha-em-texto", null, undefined, 42,
  ];
  for (const r of ruins) assert.equal(validarVerificador(r), false, `aceitou: ${String(r).slice(0, 40)}`);
});

test("senha: 32 bytes aleatórios em base64url (43 caracteres), nunca repetida", () => {
  const s = gerarSenha();
  assert.match(s, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(s, gerarSenha());
});

test("gerarCredencial: senha só no clipboard; o SQL leva só o verificador; nada disso na saída", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "king-cred-teste-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  let senha = null;
  const linhas = [];
  const { dir } = await gerarCredencial({ copiar: async (s) => { senha = s; }, dirBase: base, escrever: (l) => linhas.push(l) });
  assert.match(senha, /^[A-Za-z0-9_-]{43}$/);
  const saida = linhas.join("\n");
  assert.ok(!saida.includes(senha), "a senha apareceu na saída");
  assert.ok(!saida.includes("SCRAM-SHA-256"), "o verificador apareceu na saída");
  assert.ok(saida.includes(dir), "o caminho do SQL não foi informado");
  const arquivos = readdirSync(dir).sort();
  assert.deepEqual(arquivos, ["aplicar.sql", "conferir.sql"]);
  const aplicar = readFileSync(join(dir, "aplicar.sql"), "utf8");
  const conferir = readFileSync(join(dir, "conferir.sql"), "utf8");
  for (const [nome, texto] of [["aplicar", aplicar], ["conferir", conferir]]) {
    assert.ok(!texto.includes(senha), `a senha foi gravada em ${nome}.sql`);
  }
  const v = /'(SCRAM-SHA-256\$[^']+)'/.exec(aplicar)[1];
  assert.equal(validarVerificador(v), true);
  assert.equal(aplicar, `alter role king_server login password '${v}';\n`);
  assert.match(conferir, /^select .* from pg_authid where rolname = 'king_server';\n$/);
  assert.ok(conferir.includes(`rolpassword = '${v}'`));
  if (process.platform !== "win32") {
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    for (const f of arquivos) assert.equal(statSync(join(dir, f)).mode & 0o777, 0o600);
  }
});

test("clipboard falhou: nada fica em disco", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "king-cred-teste-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  await assert.rejects(gerarCredencial({ copiar: async () => { throw new Error("sem clipboard"); }, dirBase: base, escrever: () => {} }));
  assert.deepEqual(readdirSync(base), []);
});

test("limparCredencial: sobrescreve, apaga os arquivos e a pasta, e limpa o clipboard", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "king-cred-teste-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const { dir } = await gerarCredencial({ copiar: async () => {}, dirBase: base, escrever: () => {} });
  let limpou = false;
  await limparCredencial(dir, { limparClipboard: async () => { limpou = true; }, escrever: () => {} });
  assert.equal(existsSync(dir), false);
  assert.equal(limpou, true);
});

test("limparCredencial recusa pasta que não é de credencial", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "outra-coisa-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  await assert.rejects(limparCredencial(base, { limparClipboard: async () => {}, escrever: () => {} }), /não é uma pasta de credencial/);
  assert.equal(existsSync(base), true);
});

test("CLI: não aceita nenhum argumento além de --limpar <pasta> — senha nunca por argv", () => {
  for (const args of [["--senha", "abc"], ["abc"], ["--password=abc"]]) {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
    assert.notEqual(r.status, 0, `aceitou ${args.join(" ")}`);
    assert.ok(!`${r.stdout}${r.stderr}`.includes("abc"), "ecoou o argumento");
  }
});

test("CLI fora do Windows: recusa ANTES de gerar qualquer coisa", { skip: process.platform === "win32" }, () => {
  const base = mkdtempSync(join(tmpdir(), "king-cred-cli-"));
  try {
    const r = spawnSync(process.execPath, [CLI], { encoding: "utf8", env: { ...process.env, TMPDIR: base, TMP: base, TEMP: base } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Windows/);
    assert.deepEqual(readdirSync(base), []);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
