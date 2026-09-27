// CONFERIR A CA — antes de a CA de um projeto Supabase entrar na VPS.
//
// USO:
//   node scripts/ops/conferir-ca.mjs <arquivo.crt>
//
// Imprime SÓ: subject, issuer, validade, SHA-256 (do DER) e se vale hoje. Nunca o certificado.
// Recusa arquivo com mais de um certificado, sem certificado, corrompido ou com chave privada junto.
// A impressão digital é a que se compara com a da homologação — NÃO se presume que a CA de
// Production seja a mesma até essa conferência.
//
// SAÍDA: 0 válido hoje · 1 fora da validade · 2 arquivo inválido ou uso.
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export class CaInvalida extends Error {}

const BLOCO = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

export function conferirCa(texto, agora = new Date()) {
  if (typeof texto !== "string") throw new CaInvalida("conteúdo ilegível");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(texto)) throw new CaInvalida("o arquivo contém CHAVE PRIVADA — recusado; uma CA é só o certificado público");
  const blocos = texto.match(BLOCO) ?? [];
  if (blocos.length !== 1) throw new CaInvalida(`o arquivo precisa ter exatamente 1 certificado PEM (encontrados: ${blocos.length})`);
  let cert;
  try {
    cert = new X509Certificate(blocos[0]);
  } catch {
    throw new CaInvalida("o certificado PEM está corrompido");
  }
  const validoDe = new Date(cert.validFrom);
  const validoAte = new Date(cert.validTo);
  return {
    subject: cert.subject.split("\n").join(", "),
    issuer: cert.issuer.split("\n").join(", "),
    validoDe,
    validoAte,
    sha256: cert.fingerprint256, // SHA-256 do DER, hexadecimal com dois-pontos
    ehCa: cert.ca,
    validoAgora: validoDe <= agora && agora <= validoAte,
  };
}

// ─────────────────────────── linha de comando ───────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("uso: node scripts/ops/conferir-ca.mjs <arquivo.crt>");
    process.exit(2);
  }
  let r;
  try {
    r = conferirCa(readFileSync(args[0], "utf8"));
  } catch (e) {
    console.error(`[ca] ${e instanceof CaInvalida ? e.message : "arquivo não pôde ser lido"}`);
    process.exit(2);
  }
  console.log(`subject: ${r.subject}`);
  console.log(`issuer: ${r.issuer}`);
  console.log(`validade: ${r.validoDe.toISOString()} → ${r.validoAte.toISOString()}`);
  console.log(`sha256: ${r.sha256}`);
  console.log(`válido agora: ${r.validoAgora ? "sim" : "NÃO"}${r.ehCa ? "" : " (atenção: não é certificado de CA)"}`);
  process.exitCode = r.validoAgora ? 0 : 1;
}
