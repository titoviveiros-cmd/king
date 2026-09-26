// A CONFIGURAÇÃO DO PROGRESSO — separada da identidade, de propósito.
//
// `/etc/king/server.env` declara IDENTIDADE e recusa qualquer chave com cara de segredo. Isso
// continua exatamente como está: a senha do banco não vai para lá, e aquele parser não é afrouxado.
// O progresso tem arquivo próprio, `/etc/king/progress.env`, com permissões próprias:
//
//   KING_PROGRESS_MODE=database                                (ou `disabled`)
//   KING_PROGRESS_DATABASE_URL=<secreta>                       (obrigatória; SEM parâmetro SSL)
//   KING_PROGRESS_SSL_ROOT_CERT=/etc/king/supabase-ca-2021.crt (obrigatória; CA de arquivo)
//   KING_PROGRESS_OUTBOX_DIR=/var/lib/king/progresso-outbox    (opcional)
//
// ══ TLS: VERIFICADO, E COM A CA EXPLÍCITA ══
//
// O pooler do Supabase apresenta um certificado emitido por uma raiz PRIVADA ("Supabase Root 2021
// CA"), que nenhum sistema tem por padrão. Medido na homologação da Fase 4C: sem essa CA, a cadeia
// não valida. E `sslmode` dentro da URL não serve de trava: no `pg` 8, `require` é tratado como
// `verify-full`; no `pg` 9 passa a CRIPTOGRAFAR SEM VERIFICAR — uma atualização de dependência
// desligaria a verificação em silêncio. Por isso a CA vem de ARQUIVO, em chave própria, o pool é
// criado com `rejectUnauthorized: true` (cadeia e nome do host), e a URL que trouxer qualquer
// parâmetro SSL é recusada: um parâmetro na URL sobrescreveria a configuração do código.
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
export const CHAVES_DE_PROGRESSO = [
  "KING_PROGRESS_MODE", "KING_PROGRESS_DATABASE_URL", "KING_PROGRESS_SSL_ROOT_CERT", "KING_PROGRESS_OUTBOX_DIR",
] as const;
/** Parâmetros que, na URL, mudariam o TLS por fora do código. Nenhum é aceito. */
const PARAMETROS_SSL = new Set(["sslmode", "sslrootcert", "sslcert", "sslkey"]);

export type ConfiguracaoDeProgresso =
  | { modo: "desligado"; motivo: string }
  | {
    modo: "database";
    url: string;
    /** Conteúdo PEM da CA — lido do arquivo agora, para o boot falhar aqui e não na 1ª partida. */
    ca: string;
    caminhoDaCa: string;
    outbox: string;
  };

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
  // O TLS É DO CÓDIGO, não da URL. Qualquer parâmetro SSL ali reprova — ver o cabeçalho.
  if ([...analisada.searchParams.keys()].some((k) => PARAMETROS_SSL.has(k.toLowerCase()))) {
    throw new ConfiguracaoDeProgressoInvalida(
      "parâmetros SSL na KING_PROGRESS_DATABASE_URL não são aceitos: o TLS vem de KING_PROGRESS_SSL_ROOT_CERT",
    );
  }

  const caminhoDaCa = valores.get("KING_PROGRESS_SSL_ROOT_CERT") ?? "";
  if (!caminhoDaCa) throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_MODE=database exige KING_PROGRESS_SSL_ROOT_CERT");
  if (caminhoDaCa.includes("-----BEGIN")) {
    throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_SSL_ROOT_CERT recebe o CAMINHO do arquivo; conteúdo inline não é aceito");
  }
  if (!isAbsolute(caminhoDaCa)) throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_SSL_ROOT_CERT precisa ser caminho absoluto");
  if (!disco.existe(caminhoDaCa)) throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_SSL_ROOT_CERT aponta para arquivo que não existe");
  let ca: string;
  try {
    ca = disco.ler(caminhoDaCa);
  } catch {
    throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_SSL_ROOT_CERT não pôde ser lido");
  }
  if (!ca.includes("-----BEGIN CERTIFICATE-----")) {
    throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_SSL_ROOT_CERT não contém certificado PEM");
  }

  const outbox = valores.get("KING_PROGRESS_OUTBOX_DIR") || OUTBOX_PADRAO;
  if (!isAbsolute(outbox)) throw new ConfiguracaoDeProgressoInvalida("KING_PROGRESS_OUTBOX_DIR precisa ser caminho absoluto");

  return { modo: "database", url, ca, caminhoDaCa, outbox };
}
