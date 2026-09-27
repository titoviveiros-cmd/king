// SCRAM-SHA-256 PARA O POSTGRESQL — a senha vira um VERIFICADOR, e é o verificador (nunca a senha)
// que vai para o `ALTER ROLE`.
//
// Por quê: o Supabase registra DDL no log do Postgres (`log_statement = ddl`). Um
// `ALTER ROLE … PASSWORD 'texto'` deixaria a senha no log. Com o verificador calculado aqui, o
// banco guarda exatamente o que recebeu, e a senha nunca sai da máquina que a gerou.
//
// Formato do PostgreSQL (RFC 5802/7677):
//   SCRAM-SHA-256$<iterações>:<sal base64>$<StoredKey base64>:<ServerKey base64>
// Um verificador MALFORMADO não é recusado pelo Postgres: vira senha em texto (aconteceu na Fase 4C,
// com o `$` comido pelo shell). Por isso `validarVerificador` roda ANTES de qualquer uso.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

export const ITERACOES_SCRAM = 4096; // o padrão do PostgreSQL (scram_iterations)

/** 32 bytes aleatórios em base64url: 43 caracteres, só [A-Za-z0-9_-] — seguro em URL e em shell. */
export function gerarSenha() {
  return randomBytes(32).toString("base64url");
}

export function verificadorScram(senha, { sal = randomBytes(16), iteracoes = ITERACOES_SCRAM } = {}) {
  // SASLprep de senha ASCII é a identidade; a senha desta ferramenta é sempre base64url.
  const salgada = pbkdf2Sync(Buffer.from(senha, "utf8"), sal, iteracoes, 32, "sha256");
  const clientKey = createHmac("sha256", salgada).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salgada).update("Server Key").digest();
  return `SCRAM-SHA-256$${iteracoes}:${sal.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

const B64 = "[A-Za-z0-9+/]+={0,2}";
const FORMATO = new RegExp(`^SCRAM-SHA-256\\$(\\d+):(${B64})\\$(${B64}):(${B64})$`);
const decodificaPara = (b64, bytes) => {
  const buf = Buffer.from(b64, "base64");
  return buf.length === bytes && buf.toString("base64") === b64; // base64 canônico, sem sobra
};

/** Estrutura inteira conferida: prefixo, iterações ≥ 4096, sal de 16 bytes, chaves de 32 bytes. */
export function validarVerificador(v) {
  if (typeof v !== "string") return false;
  const m = FORMATO.exec(v);
  if (!m) return false;
  const [, iteracoes, sal, stored, server] = m;
  return Number(iteracoes) >= ITERACOES_SCRAM
    && decodificaPara(sal, 16) && decodificaPara(stored, 32) && decodificaPara(server, 32);
}
