// A CONFIGURAÇÃO DE PROGRESSO — separada da identidade, com TLS verificado por CA EXPLÍCITA.
//
// O pooler do Supabase apresenta um certificado emitido por uma raiz PRIVADA ("Supabase Root 2021
// CA"). Sem essa CA, a cadeia não valida; e parâmetro SSL dentro da URL depende de uma semântica
// que o `pg` vai mudar na versão 9 (`require` deixa de verificar). Por isso a CA vem de ARQUIVO,
// em chave própria, e a URL não pode carregar parâmetro SSL nenhum.
import { describe, expect, it } from "vitest";
import {
  ARQUIVO_DE_PROGRESSO_PADRAO, ConfiguracaoDeProgressoInvalida, OUTBOX_PADRAO, lerConfiguracaoDeProgresso,
  type LeitorDeArquivo,
} from "./config.js";

const SENHA = "senha-que-nunca-pode-aparecer-em-log";
const URL_BOA = `postgresql://king_server.projeto:${SENHA}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`;
const CA_CAMINHO = "/etc/king/supabase-ca-2021.crt";
const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL\n-----END CERTIFICATE-----\n";

/**
 * Um disco de mentira. Os arquivos de progresso (padrão e o do `KING_PROGRESS_ENV_FILE`) têm
 * `conteudo`; qualquer outro caminho só existe se estiver em `outros` — e um `Error` ali simula
 * arquivo que existe mas não pode ser lido.
 */
const ARQUIVOS_DE_PROGRESSO = new Set([ARQUIVO_DE_PROGRESSO_PADRAO, "/tmp/x/progress.env"]);
function disco(conteudo: string | null, outros: Record<string, string | Error> = { [CA_CAMINHO]: CA_PEM }): LeitorDeArquivo & { lidos: string[] } {
  const lidos: string[] = [];
  return {
    lidos,
    existe: (c) => (ARQUIVOS_DE_PROGRESSO.has(c) ? conteudo !== null : c in outros),
    ler: (c) => {
      lidos.push(c);
      if (ARQUIVOS_DE_PROGRESSO.has(c)) return conteudo ?? "";
      const v = outros[c];
      if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      if (v instanceof Error) throw v;
      return v;
    },
  };
}
const ler = (conteudo: string | null, outros?: Record<string, string | Error>) =>
  lerConfiguracaoDeProgresso({}, disco(conteudo, outros));

const valido = (extra = "") =>
  `KING_PROGRESS_MODE=database\nKING_PROGRESS_DATABASE_URL=${URL_BOA}\nKING_PROGRESS_SSL_ROOT_CERT=${CA_CAMINHO}\n${extra}`;

/** Toda recusa diz O QUE está errado sem mostrar valor — nem URL, nem senha, nem certificado. */
function recusa(conteudo: string, trecho: RegExp, outros?: Record<string, string | Error>): void {
  let erro: unknown;
  try { ler(conteudo, outros); } catch (e) { erro = e; }
  expect(erro).toBeInstanceOf(ConfiguracaoDeProgressoInvalida);
  const msg = String((erro as Error).message);
  expect(msg).toMatch(trecho);
  expect(msg).not.toContain(SENHA);
  expect(msg).not.toContain("pooler.supabase.com");
  expect(msg).not.toContain("BEGIN CERTIFICATE");
}

describe("arquivo de progresso", () => {
  it("AUSENTE → progresso desligado, e o jogo segue", () => {
    expect(ler(null, {})).toEqual({ modo: "desligado", motivo: "arquivo de progresso ausente" });
  });

  it("lê do caminho padrão, fora do repositório, e aceita outro só por KING_PROGRESS_ENV_FILE", () => {
    const d = disco("KING_PROGRESS_MODE=disabled\n");
    lerConfiguracaoDeProgresso({}, d);
    lerConfiguracaoDeProgresso({ KING_PROGRESS_ENV_FILE: "/tmp/x/progress.env" }, d);
    expect(d.lidos).toEqual([ARQUIVO_DE_PROGRESSO_PADRAO, "/tmp/x/progress.env"]);
    expect(ARQUIVO_DE_PROGRESSO_PADRAO).not.toBe("/etc/king/server.env");
  });

  it("MODE=disabled desliga explicitamente", () => {
    expect(ler("KING_PROGRESS_MODE=disabled\n").modo).toBe("desligado");
  });

  it("GREEN — database com URL limpa e CA EXTERNA: liga, com o conteúdo da CA e o outbox padrão", () => {
    expect(ler(valido())).toEqual({ modo: "database", url: URL_BOA, ca: CA_PEM, caminhoDaCa: CA_CAMINHO, outbox: OUTBOX_PADRAO });
  });

  it("outbox configurável, só com caminho absoluto", () => {
    const r = ler(valido("KING_PROGRESS_OUTBOX_DIR=/srv/outbox\n"));
    expect(r.modo === "database" && r.outbox).toBe("/srv/outbox");
    recusa(valido("KING_PROGRESS_OUTBOX_DIR=relativo\n"), /OUTBOX_DIR precisa ser caminho absoluto/);
  });
});

describe("a CA do TLS — de arquivo, e só de arquivo", () => {
  it("RED/GREEN — CA ausente em MODE=database", () =>
    recusa(`KING_PROGRESS_MODE=database\nKING_PROGRESS_DATABASE_URL=${URL_BOA}\n`, /exige KING_PROGRESS_SSL_ROOT_CERT/));

  it("RED/GREEN — caminho relativo", () =>
    recusa(valido().replace(CA_CAMINHO, "certs/ca.crt"), /SSL_ROOT_CERT precisa ser caminho absoluto/));

  it("RED/GREEN — arquivo inexistente", () =>
    recusa(valido().replace(CA_CAMINHO, "/etc/king/nao-existe.crt"), /SSL_ROOT_CERT aponta para arquivo que não existe/, {}));

  it("RED/GREEN — arquivo ilegível", () =>
    recusa(valido(), /SSL_ROOT_CERT não pôde ser lido/, { [CA_CAMINHO]: Object.assign(new Error("EACCES"), { code: "EACCES" }) }));

  it("RED/GREEN — certificado INLINE no lugar do caminho", () =>
    recusa(valido().replace(CA_CAMINHO, "-----BEGIN CERTIFICATE-----MIIDx"), /conteúdo inline/));

  it("RED/GREEN — arquivo que não é certificado PEM", () =>
    recusa(valido(), /não contém certificado PEM/, { [CA_CAMINHO]: "isto não é certificado" }));
});

describe("a URL não carrega parâmetro SSL nenhum", () => {
  it.each(["sslmode=require", "sslmode=verify-full", "sslrootcert=/etc/ca.crt", "sslcert=/etc/c.crt", "sslkey=/etc/c.key", "SSLMODE=disable"])(
    "RED/GREEN — %s na DATABASE_URL",
    (parametro) => recusa(valido().replace(URL_BOA, `${URL_BOA}?${parametro}`), /parâmetros SSL na KING_PROGRESS_DATABASE_URL/),
  );
});

describe("outras recusas — e nenhuma vaza a URL", () => {
  it("database sem URL", () => recusa(`KING_PROGRESS_MODE=database\nKING_PROGRESS_SSL_ROOT_CERT=${CA_CAMINHO}\n`, /exige KING_PROGRESS_DATABASE_URL/));
  it("modo ausente ou desconhecido", () => {
    recusa(`KING_PROGRESS_DATABASE_URL=${URL_BOA}\n`, /KING_PROGRESS_MODE/);
    recusa("KING_PROGRESS_MODE=talvez\n", /KING_PROGRESS_MODE/);
  });
  it("protocolo que não é postgres", () =>
    recusa(valido().replace("postgresql:", "https:"), /postgres/));
  it("chave não suportada — inclusive as de identidade e de segredo", () => {
    recusa("KING_PROGRESS_MODE=disabled\nSUPABASE_URL=https://x.supabase.co\n", /não suportada.*: SUPABASE_URL/);
    recusa("KING_PROGRESS_MODE=disabled\nSERVICE_ROLE_KEY=abc\n", /não suportada.*: SERVICE_ROLE_KEY/);
  });
  it("chave repetida e linha fora do formato", () => {
    recusa("KING_PROGRESS_MODE=disabled\nKING_PROGRESS_MODE=database\n", /repetida/);
    recusa("KING_PROGRESS_MODE=disabled\nisto não é chave\n", /linha 2/);
  });
});
