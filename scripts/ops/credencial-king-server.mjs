// A CREDENCIAL DO king_server — gerada NESTE computador (Windows), sem nunca aparecer.
//
// USO:
//   node scripts/ops/credencial-king-server.mjs
//     → gera a senha (32 bytes aleatórios), calcula o verificador SCRAM, VALIDA a estrutura,
//       copia a SENHA para a área de transferência e grava, numa pasta temporária privada, dois
//       SQL que levam SÓ o verificador:
//         aplicar.sql   — alter role king_server login password '<verificador>';
//         conferir.sql  — compara o que o banco guardou com o verificador (só leitura)
//       Imprime apenas o caminho da pasta.
//   node scripts/ops/credencial-king-server.mjs --limpar <pasta>
//     → sobrescreve e apaga os dois SQL e a pasta, e esvazia a área de transferência.
//
// Nunca: senha na tela, senha em arquivo, senha ou URL por argumento. A senha sai daqui SÓ pela
// área de transferência, para ser colada num `read -rs` na VPS (scripts/ops/gravar-progress-env.sh).
import { spawnSync } from "node:child_process";
import { closeSync, fsyncSync, mkdtempSync, openSync, readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gerarSenha, validarVerificador, verificadorScram } from "../lib/scram.mjs";

const PREFIXO = "king-credencial-";
const ARQUIVOS = ["aplicar.sql", "conferir.sql"];

/** A área de transferência do Windows. A senha vai pela ENTRADA do clip.exe, nunca por argumento. */
function clipboardDoWindows(texto) {
  const r = spawnSync("clip.exe", { input: texto, windowsHide: true });
  if (r.status !== 0) throw new Error("clip.exe falhou");
}

export async function gerarCredencial({ copiar, dirBase = tmpdir(), escrever = (l) => console.log(l) }) {
  const senha = gerarSenha();
  const verificador = verificadorScram(senha);
  if (!validarVerificador(verificador)) throw new Error("verificador SCRAM malformado — nada foi gerado");
  // Primeiro o clipboard: se falhar, nada chega ao disco.
  await copiar(senha);
  const dir = mkdtempSync(join(dirBase, PREFIXO));
  try {
    writeFileSync(join(dir, "aplicar.sql"), `alter role king_server login password '${verificador}';\n`, { mode: 0o600, flag: "wx" });
    writeFileSync(join(dir, "conferir.sql"),
      `select rolcanlogin, rolpassword = '${verificador}' as verificador_confere from pg_authid where rolname = 'king_server';\n`,
      { mode: 0o600, flag: "wx" });
  } catch (e) {
    await limparCredencial(dir, { limparClipboard: async () => copiar(""), escrever: () => {} }).catch(() => {});
    throw e;
  }
  escrever("[credencial] senha: copiada para a área de transferência (não exibida, não gravada)");
  escrever(`[credencial] SQL com SÓ o verificador: ${dir}`);
  escrever(`[credencial] depois de usar: node scripts/ops/credencial-king-server.mjs --limpar "${dir}"`);
  return { dir };
}

/** Sobrescreve com zeros, fsync, apaga — e esvazia a área de transferência. */
export async function limparCredencial(dir, { limparClipboard, escrever = (l) => console.log(l) }) {
  if (!basename(dir).startsWith(PREFIXO)) throw new Error("não é uma pasta de credencial desta ferramenta — nada apagado");
  for (const nome of readdirSync(dir)) {
    if (!ARQUIVOS.includes(nome)) throw new Error("a pasta tem arquivo inesperado — nada apagado");
  }
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    const fd = openSync(caminho, "r+");
    try {
      writeSync(fd, Buffer.alloc(statSync(caminho).size));
      fsyncSync(fd);
    } finally { closeSync(fd); }
    unlinkSync(caminho);
  }
  rmdirSync(dir);
  await limparClipboard();
  escrever("[credencial] SQL apagados e área de transferência esvaziada");
}

// ─────────────────────────── linha de comando ───────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const limpar = args.length === 2 && args[0] === "--limpar";
  if (!(args.length === 0 || limpar)) {
    // O argumento NÃO é ecoado: senha nunca entra por aqui.
    console.error("uso: node scripts/ops/credencial-king-server.mjs  |  --limpar <pasta>  (nenhum outro argumento)");
    process.exit(64);
  }
  if (process.platform !== "win32") {
    console.error("[credencial] esta ferramenta é para o Windows deste computador (usa o clip.exe) — nada foi gerado");
    process.exit(69);
  }
  try {
    if (limpar) await limparCredencial(args[1], { limparClipboard: async () => clipboardDoWindows("") });
    else await gerarCredencial({ copiar: async (s) => clipboardDoWindows(s) });
  } catch (e) {
    console.error(`[credencial] ${e?.message ?? "falha"}`);
    process.exitCode = 1;
  }
}
