// A CONFIGURAÇÃO DO PROGRESSO — separada da identidade, de propósito.
//
// `/etc/king/server.env` declara IDENTIDADE e recusa qualquer chave com cara de segredo. Isso
// continua exatamente como está: a senha do banco não vai para lá, e aquele parser não é afrouxado.
// O progresso tem arquivo próprio, `/etc/king/progress.env`, com permissões próprias:
//
//   KING_PROGRESS_MODE=database          (ou `disabled`)
//   KING_PROGRESS_DATABASE_URL=<secreta> (obrigatória em `database`; exige sslmode)
//   KING_PROGRESS_OUTBOX_DIR=/var/lib/king/progresso-outbox   (opcional)
//
// ARQUIVO AUSENTE = PROGRESSO DESLIGADO. É o caso da máquina local, da CI e do e2e.
// ARQUIVO PRESENTE E INCOERENTE = boot reprovado (78), como na identidade.
//
// NENHUMA mensagem daqui carrega VALOR — nem a URL, nem pedaço dela. Nomes de chave e número de
// linha bastam para achar o erro.
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export const ARQUIVO_DE_PROGRESSO_PADRAO = "/etc/king/progress.env";
export const OUTBOX_PADRAO = "/var/lib/king/progresso-outbox";
export const CHAVES_DE_PROGRESSO = ["KING_PROGRESS_MODE", "KING_PROGRESS_DATABASE_URL", "KING_PROGRESS_OUTBOX_DIR"] as const;
const SSLMODES_ACEITOS = new Set(["require", "verify-ca", "verify-full"]);

export type ConfiguracaoDeProgresso =
  | { modo: "desligado"; motivo: string }
  | { modo: "database"; url: string; outbox: string };

export class ConfiguracaoDeProgressoInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConfiguracaoDeProgressoInvalida";
  }
}

export interface LeitorDeArquivo {
  existe(caminho: string): boolean;
  ler(caminho: string): string;
}
const DISCO: LeitorDeArquivo = { existe: existsSync, ler: (c) => readFileSync(c, "utf8") };

/** Onde está o arquivo. `KING_PROGRESS_ENV_FILE` existe para teste e para o smoke isolado. */
export function caminhoDoArquivoDeProgresso(env: NodeJS.ProcessEnv): string {
  return env.KING_PROGRESS_ENV_FILE?.trim() || ARQUIVO_DE_PROGRESSO_PADRAO;
}

export function lerConfiguracaoDeProgresso(
  env: NodeJS.ProcessEnv = process.env,
  disco: LeitorDeArquivo = DISCO,
): ConfiguracaoDeProgresso {
  const caminho = caminhoDoArquivoDeProgresso(env);
  if (!disco.existe(caminho)) return { modo: "desligado", motivo: "arquivo de progresso ausente" };

  const valores = new Map<string, string>();
  disco.ler(caminho).split(/\r?\n/).forEach((linha, i) => {
    const t = linha.trim();
    if (!t || t.startsWith("#")) return;
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(t);
    if (!m) throw new ConfiguracaoDeProgressoInvalida(`linha ${i + 1} do arquivo de progresso não é CHAVE=valor`);
    const [, chave, valor] = m;
    if (!(CHAVES_DE_PROGRESSO as readonly string[]).includes(chave)) {
      throw new ConfiguracaoDeProgressoInvalida(`chave não suportada no arquivo de progresso: ${chave}`);
    }
    if (valores.has(chave)) throw new ConfiguracaoDeProgressoInvalida(`chave repetida no arquivo de progresso: ${chave}`);
    valores.set(chave, valor.trim().replace(/^(["'])(.*)\1$/, "$2"));
  });

  const modo = valores.get("KING_PROGRESS_MODE");
  if (modo === "disabled") return { modo: "desligado", motivo: "KING_PROGRESS_MODE=disabled" };
  if (modo !== "database") {
    throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_MODE precisa ser `database` ou `disabled`");
  }

  const url = valores.get("KING_PROGRESS_DATABASE_URL") ?? "";
  if (!url) throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_MODE=database exige KING_PROGRESS_DATABASE_URL");
  let analisada: URL;
  try {
    analisada = new URL(url);
  } catch {
    throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_DATABASE_URL não é uma URL válida");
  }
  if (analisada.protocol !== "postgres:" && analisada.protocol !== "postgresql:") {
    throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_DATABASE_URL precisa ser postgres:// ou postgresql://");
  }
  // SSL OBRIGATÓRIO. O crédito viaja com a senha do papel; sem TLS ela iria em texto claro.
  const sslmode = analisada.searchParams.get("sslmode");
  if (!sslmode || !SSLMODES_ACEITOS.has(sslmode)) {
    throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_DATABASE_URL exige sslmode=require, verify-ca ou verify-full");
  }

  const outbox = valores.get("KING_PROGRESS_OUTBOX_DIR") || OUTBOX_PADRAO;
  if (!isAbsolute(outbox)) throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_OUTBOX_DIR precisa ser caminho absoluto");

  return { modo: "database", url, outbox };
}
