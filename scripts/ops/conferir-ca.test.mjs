// O CONFERIDOR DE CA — lê um certificado local e diz SÓ: subject, issuer, validade, SHA-256 e se
// vale hoje. Nunca imprime o certificado. O de teste (`fixtures/ca-teste.pem`) é uma CA fictícia
// gerada para isto; o de Production NÃO entra no repositório.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { conferirCa } from "./conferir-ca.mjs";

const CLI = fileURLToPath(new URL("./conferir-ca.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/ca-teste.pem", import.meta.url));
const PEM = readFileSync(FIXTURE, "utf8");
const CORPO = PEM.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");

/** A impressão digital calculada POR FORA: SHA-256 do DER, em hexadecimal com dois-pontos. */
const digitalIndependente = createHash("sha256").update(Buffer.from(CORPO, "base64")).digest("hex")
  .toUpperCase().match(/../g).join(":");

test("lê subject, issuer, validade e se é CA", () => {
  const r = conferirCa(PEM, new Date("2027-01-01T00:00:00Z"));
  assert.match(r.subject, /CN=KING TESTE CA/);
  assert.match(r.issuer, /CN=KING TESTE CA/);
  assert.equal(r.ehCa, true);
  assert.ok(r.validoDe < r.validoAte);
  assert.equal(r.validoAgora, true);
});

test("a impressão digital é o SHA-256 do DER — a mesma que se calcula por fora", () => {
  assert.equal(conferirCa(PEM).sha256, digitalIndependente);
  assert.equal(digitalIndependente, "BE:36:B2:87:F2:10:15:51:FA:43:12:24:C8:E1:22:2F:1E:35:8E:39:CB:5D:B1:05:A8:9A:86:CC:D5:55:66:5B");
});

test("validade é conferida CONTRA A DATA: vencido e ainda-não-válido reprovam", () => {
  assert.equal(conferirCa(PEM, new Date("2040-01-01T00:00:00Z")).validoAgora, false);
  assert.equal(conferirCa(PEM, new Date("2020-01-01T00:00:00Z")).validoAgora, false);
});

test("CA inválida é recusada, sem ecoar conteúdo", () => {
  const casos = [
    ["não é PEM", "isto não é certificado"],
    ["PEM corrompido", "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"],
    ["dois certificados", `${PEM}\n${PEM}`],
    ["com chave privada junto", `${PEM}\n-----BEGIN PRIVATE KEY-----\nMIGHAgEAsegredo\n-----END PRIVATE KEY-----\n`],
    ["vazio", ""],
  ];
  for (const [nome, texto] of casos) {
    assert.throws(() => conferirCa(texto), (e) => {
      assert.ok(!String(e.message).includes("MIGH") && !String(e.message).includes("segredo") && !String(e.message).includes(CORPO.slice(0, 20)), `${nome}: ecoou conteúdo`);
      return true;
    }, nome);
  }
});

test("CLI: imprime só os cinco campos, nunca o certificado; saída 0 se vale hoje", () => {
  const r = spawnSync(process.execPath, [CLI, FIXTURE], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const linhas = r.stdout.trim().split("\n").map((l) => l.split(":")[0].trim());
  assert.deepEqual(linhas, ["subject", "issuer", "validade", "sha256", "válido agora"]);
  assert.ok(r.stdout.includes(digitalIndependente));
  assert.ok(!r.stdout.includes("BEGIN") && !r.stdout.includes(CORPO.slice(0, 30)));
});

test("CLI: arquivo inválido sai com 2 e não ecoa conteúdo; sem argumento, uso", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "king-ca-teste-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ruim = join(dir, "ruim.crt");
  writeFileSync(ruim, "-----BEGIN PRIVATE KEY-----\nMIGHsegredo\n-----END PRIVATE KEY-----\n");
  const r = spawnSync(process.execPath, [CLI, ruim], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.ok(!`${r.stdout}${r.stderr}`.includes("segredo"));
  assert.equal(spawnSync(process.execPath, [CLI], { encoding: "utf8" }).status, 2);
});
