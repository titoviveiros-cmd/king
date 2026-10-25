// OS ARQUIVOS DE DOMÍNIO ASSOCIADO (Fase 9) — conteúdo exato, recusa de modelo e de formato, e a
// coerência com o que o app e o servidor web esperam (pacote, bundle, só a raiz com ?sala=).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appleAppSiteAssociation, arquivosDeDominio, assetLinks, impressoesDigitais, teamIdDaApple } from "../lib/well-known.mjs";

const SHA = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");
const RAIZ = new URL("../../", import.meta.url);

test("assetlinks: só este pacote, só handle_all_urls, impressões normalizadas e sem repetição", () => {
  const impressoes = impressoesDigitais(` ${SHA.toLowerCase()} , ${SHA} `);
  assert.deepEqual(impressoes, [SHA]);
  assert.deepEqual(assetLinks(impressoes), [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: "br.com.playkingcards.king", sha256_cert_fingerprints: [SHA] },
  }]);
});

test("AASA: o appID é TeamID.bundle, e só a raiz com ?sala= de quatro caracteres", () => {
  const aasa = appleAppSiteAssociation("ABCDE12345");
  assert.deepEqual(aasa.applinks.details[0].appIDs, ["ABCDE12345.br.com.playkingcards.king"]);
  const [c] = aasa.applinks.details[0].components;
  assert.equal(c["/"], "/");
  assert.deepEqual(c["?"], { sala: "????" });
  assert.equal(aasa.applinks.details[0].components.length, 1);
});

test("recusa valor de MODELO e formato errado — nada de arquivo inválido publicado em silêncio", () => {
  for (const ruim of [undefined, "", "TROCAR-PELO-SHA-256", "AA:BB", SHA.replace(/:/g, ""), SHA + ":00", SHA.replace("00", "GG")]) {
    assert.throws(() => impressoesDigitais(ruim), /SHA-256|KING_ANDROID_SHA256/, String(ruim));
  }
  for (const ruim of [undefined, "", "TROCAR-PELO-TEAM-ID", "ABC", "ABCDE12345X", "ABCD-12345"]) {
    assert.throws(() => teamIdDaApple(ruim), /KING_APPLE_TEAM_ID/, String(ruim));
  }
});

test("os modelos versionados batem com o gerador (pacote, relação, componentes)", () => {
  const modeloAndroid = JSON.parse(readFileSync(new URL("docs/mobile/assetlinks.modelo.json", RAIZ), "utf8"));
  assert.equal(modeloAndroid[0].target.package_name, "br.com.playkingcards.king");
  assert.deepEqual(modeloAndroid[0].relation, assetLinks([SHA])[0].relation);
  const modeloIos = JSON.parse(readFileSync(new URL("docs/mobile/apple-app-site-association.modelo.json", RAIZ), "utf8"));
  assert.deepEqual(modeloIos.applinks.details[0].components.map((c) => [c["/"], c["?"]]), [["/", { sala: "????" }]]);
  const gerado = JSON.parse(arquivosDeDominio({ sha256: SHA, teamId: "ABCDE12345" })["apple-app-site-association"]);
  assert.deepEqual(gerado.applinks.details[0].components.map((c) => [c["/"], c["?"]]), [["/", { sala: "????" }]]);
});

test("o script SEM os valores recusa e não grava nada", () => {
  const script = fileURLToPath(new URL("scripts/gerar-well-known.mjs", RAIZ));
  const env = { ...process.env };
  delete env.KING_ANDROID_SHA256;
  delete env.KING_APPLE_TEAM_ID;
  assert.throws(() => execFileSync(process.execPath, [script], { env, stdio: "pipe" }), /NADA GRAVADO|status 1|Command failed/);
});

test("a Vercel serve o AASA como JSON (sem extensão, o tipo viria errado)", () => {
  const vercel = JSON.parse(readFileSync(new URL("vercel.json", RAIZ), "utf8"));
  const regra = (vercel.headers ?? []).find((h) => h.source === "/.well-known/apple-app-site-association");
  assert.ok(regra, "vercel.json sem cabeçalho para o AASA");
  assert.deepEqual(regra.headers, [{ key: "Content-Type", value: "application/json" }]);
});
