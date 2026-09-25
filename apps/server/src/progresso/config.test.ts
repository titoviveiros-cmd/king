// A CONFIGURAÇÃO DE PROGRESSO — separada da identidade, e muda sobre o que é segredo.
import { describe, expect, it } from "vitest";
import {
  ARQUIVO_DE_PROGRESSO_PADRAO, ConfiguracaoDeProgressoInvalida, OUTBOX_PADRAO, lerConfiguracaoDeProgresso,
  type LeitorDeArquivo,
} from "./config.js";

const SENHA = "senha-que-nunca-pode-aparecer-em-log";
const URL_BOA = `postgresql://king_server.projeto:${SENHA}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require`;

function disco(conteudo: string | null): LeitorDeArquivo & { lidos: string[] } {
  const lidos: string[] = [];
  return {
    lidos,
    existe: () => conteudo !== null,
    ler: (c) => { lidos.push(c); return conteudo ?? ""; },
  };
}
const ler = (conteudo: string | null, env: NodeJS.ProcessEnv = {}) => lerConfiguracaoDeProgresso(env, disco(conteudo));

/** Toda recusa precisa dizer O QUE está errado sem mostrar o valor. */
function recusa(conteudo: string, trecho: RegExp): void {
  let erro: unknown;
  try { ler(conteudo); } catch (e) { erro = e; }
  expect(erro).toBeInstanceOf(ConfiguracaoDeProgressoInvalida);
  const msg = String((erro as Error).message);
  expect(msg).toMatch(trecho);
  expect(msg).not.toContain(SENHA);
  expect(msg).not.toContain("pooler.supabase.com");
}

describe("arquivo de progresso", () => {
  it("AUSENTE → progresso desligado, e o jogo segue", () => {
    expect(ler(null)).toEqual({ modo: "desligado", motivo: "arquivo de progresso ausente" });
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

  it("MODE=database com URL válida e sslmode liga, com outbox padrão", () => {
    expect(ler(`KING_PROGRESS_MODE=database\nKING_PROGRESS_DATABASE_URL=${URL_BOA}\n`))
      .toEqual({ modo: "database", url: URL_BOA, outbox: OUTBOX_PADRAO });
  });

  it("outbox configurável, só com caminho absoluto", () => {
    const r = ler(`KING_PROGRESS_MODE=database\nKING_PROGRESS_DATABASE_URL=${URL_BOA}\nKING_PROGRESS_OUTBOX_DIR=/srv/outbox\n`);
    expect(r.modo === "database" && r.outbox).toBe("/srv/outbox");
    recusa(`KING_PROGRESS_MODE=database\nKING_PROGRESS_DATABASE_URL=${URL_BOA}\nKING_PROGRESS_OUTBOX_DIR=relativo\n`, /absoluto/);
  });
});

describe("recusas — e nenhuma delas vaza a URL", () => {
  it("database sem URL", () => recusa("KING_PROGRESS_MODE=database\n", /exige KING_PROGRESS_DATABASE_URL/));
  it("modo ausente ou desconhecido", () => {
    recusa(`KING_PROGRESS_DATABASE_URL=${URL_BOA}\n`, /KING_PROGRESS_MODE/);
    recusa("KING_PROGRESS_MODE=talvez\n", /KING_PROGRESS_MODE/);
  });
  it("URL sem sslmode — TLS é obrigatório", () =>
    recusa(`KING_PROGRESS_MODE=database\nKING_PROGRESS_DATABASE_URL=${URL_BOA.replace("?sslmode=require", "")}\n`, /sslmode/));
  it("sslmode=disable não serve", () =>
    recusa(`KING_PROGRESS_MODE=database\nKING_PROGRESS_DATABASE_URL=${URL_BOA.replace("require", "disable")}\n`, /sslmode/));
  it("protocolo que não é postgres", () =>
    recusa(`KING_PROGRESS_MODE=database\nKING_PROGRESS_DATABASE_URL=${URL_BOA.replace("postgresql:", "https:")}\n`, /postgres/));
  it("chave não suportada — inclusive as de identidade", () => {
    recusa("KING_PROGRESS_MODE=disabled\nSUPABASE_URL=https://x.supabase.co\n", /não suportada.*: SUPABASE_URL/);
    recusa("KING_PROGRESS_MODE=disabled\nSERVICE_ROLE_KEY=abc\n", /não suportada.*: SERVICE_ROLE_KEY/);
  });
  it("chave repetida e linha fora do formato", () => {
    recusa("KING_PROGRESS_MODE=disabled\nKING_PROGRESS_MODE=database\n", /repetida/);
    recusa("KING_PROGRESS_MODE=disabled\nisto não é chave\n", /linha 2/);
  });
});
