// A CONFIGURAÇÃO DE IDENTIDADE — o modo declarado, o arquivo persistente e o fail closed.
//
// Testes puros: o sistema de arquivos é um mapa em memória. A prova com processo de verdade
// (servidor compilado, arquivo em disco, cliente real) é `scripts/verificar-modo-persistente.mjs`.
import { describe, expect, it } from "vitest";
import {
  ARQUIVO_DE_AMBIENTE_PADRAO, ConfiguracaoInvalida, carregarAmbiente, lerArquivoDeAmbiente,
  prepararIdentidade, resolverModoDeIdentidade, resumoSeguro, type SistemaDeArquivos,
} from "./ambiente.js";

const URL_OK = "https://abcdefghij.supabase.co";

function discoCom(arquivos: Record<string, string>): SistemaDeArquivos {
  return { existe: (p) => p in arquivos, ler: (p) => arquivos[p] };
}
const DISCO_VAZIO = discoCom({});

const erro = (fn: () => unknown) => expect(fn).toThrow(ConfiguracaoInvalida);

describe("o modo de identidade", () => {
  it("sem modo e sem URL: legacy — local, CI e a VPS de hoje", () => {
    expect(resolverModoDeIdentidade({})).toEqual({ modo: "legacy", declarado: false });
    expect(resolverModoDeIdentidade({ SUPABASE_URL: "   " }).modo).toBe("legacy");
  });

  it("legacy declarado: MODO A, mesmo com URL presente — o rollback não exige apagar a URL", () => {
    expect(resolverModoDeIdentidade({ KING_IDENTITY_MODE: "legacy" })).toEqual({ modo: "legacy", declarado: true });
    expect(resolverModoDeIdentidade({ KING_IDENTITY_MODE: "legacy", SUPABASE_URL: URL_OK }).modo).toBe("legacy");
  });

  it("permanent declarado com URL válida: MODO B, com a origem normalizada e a plateia padrão", () => {
    expect(resolverModoDeIdentidade({ KING_IDENTITY_MODE: "permanent", SUPABASE_URL: `${URL_OK}/` })).toEqual({
      modo: "permanent", declarado: true, url: URL_OK, audience: "authenticated",
    });
  });

  it("permanent sem URL (ausente ou vazia): ERRO — nunca legacy", () => {
    erro(() => resolverModoDeIdentidade({ KING_IDENTITY_MODE: "permanent" }));
    erro(() => resolverModoDeIdentidade({ KING_IDENTITY_MODE: "permanent", SUPABASE_URL: "" }));
    erro(() => resolverModoDeIdentidade({ KING_IDENTITY_MODE: "permanent", SUPABASE_URL: "  " }));
  });

  it("permanent com URL inválida: ERRO", () => {
    for (const ruim of [
      "nao-e-url", "http://abcdefghij.supabase.co", "ftp://x.supabase.co",
      `${URL_OK}/auth/v1`, `${URL_OK}?x=1`, `${URL_OK}#frag`, "https://user:pw@abcdefghij.supabase.co",
    ]) {
      erro(() => resolverModoDeIdentidade({ KING_IDENTITY_MODE: "permanent", SUPABASE_URL: ruim }));
    }
  });

  it("http só no loopback — é o que a prova local usa", () => {
    expect(resolverModoDeIdentidade({ KING_IDENTITY_MODE: "permanent", SUPABASE_URL: "http://127.0.0.1:5432" }).modo)
      .toBe("permanent");
  });

  it("modo desconhecido: ERRO, inclusive grafia parecida", () => {
    for (const m of ["banana", "Permanent", "PERMANENT", "legado", "b", "true"]) {
      erro(() => resolverModoDeIdentidade({ KING_IDENTITY_MODE: m, SUPABASE_URL: URL_OK }));
    }
  });

  it("URL sem modo: preserva o comportamento histórico (permanent), e URL inválida continua erro", () => {
    expect(resolverModoDeIdentidade({ SUPABASE_URL: URL_OK })).toMatchObject({ modo: "permanent", declarado: false });
    erro(() => resolverModoDeIdentidade({ SUPABASE_URL: "http://abcdefghij.supabase.co" }));
  });

  it("a plateia configurada é respeitada", () => {
    expect(resolverModoDeIdentidade({
      KING_IDENTITY_MODE: "permanent", SUPABASE_URL: URL_OK, SUPABASE_JWT_AUDIENCE: "outra",
    })).toMatchObject({ audience: "outra" });
  });
});

describe("o arquivo de ambiente", () => {
  it("aceita comentário, linha vazia, export, aspas, BOM e CRLF", () => {
    const texto = `﻿# KING\r\n\r\nexport KING_IDENTITY_MODE="permanent"\r\nSUPABASE_URL='${URL_OK}'\r\nSUPABASE_JWT_AUDIENCE = authenticated\r\n`;
    expect(lerArquivoDeAmbiente(texto)).toEqual({
      KING_IDENTITY_MODE: "permanent", SUPABASE_URL: URL_OK, SUPABASE_JWT_AUDIENCE: "authenticated",
    });
  });

  it("recusa chave com cara de segredo — o servidor não precisa de nenhum", () => {
    for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET", "PRIVATE_KEY", "DB_PASSWORD"]) {
      erro(() => lerArquivoDeAmbiente(`KING_IDENTITY_MODE=legacy\n${k}=x`));
    }
  });

  it("recusa chave fora da lista, chave repetida e linha malformada", () => {
    erro(() => lerArquivoDeAmbiente("KING_IDENTITY_MODE=legacy\nPORT=1"));
    erro(() => lerArquivoDeAmbiente("KING_IDENTITY_MODE=legacy\nKING_IDENTITY_MODE=permanent"));
    erro(() => lerArquivoDeAmbiente("KING_IDENTITY_MODE legacy"));
  });

  it("a mensagem de erro não carrega o valor", () => {
    try {
      lerArquivoDeAmbiente("SUPABASE_SERVICE_ROLE_KEY=valor-que-nao-pode-vazar");
    } catch (e) {
      expect((e as Error).message).not.toContain("valor-que-nao-pode-vazar");
    }
  });
});

/**
 * O DEFEITO D5, SIMULADO SEM VPS: a shell que reinicia o processo não tem a variável.
 */
describe("o arquivo persistente é a fonte — a shell não decide", () => {
  const permanente = { [ARQUIVO_DE_AMBIENTE_PADRAO]: `KING_IDENTITY_MODE=permanent\nSUPABASE_URL=${URL_OK}\n` };
  const legado = { [ARQUIVO_DE_AMBIENTE_PADRAO]: `KING_IDENTITY_MODE=legacy\nSUPABASE_URL=${URL_OK}\n` };

  it("shell SEM SUPABASE_URL + arquivo permanent: o processo termina em permanent com a URL", () => {
    const shell = { PATH: "/usr/bin", pm_id: "0" };
    const { env, origem } = carregarAmbiente(shell, discoCom(permanente));
    expect(origem).toEqual({ arquivo: ARQUIVO_DE_AMBIENTE_PADRAO, carregado: true, exigido: true });
    expect(resolverModoDeIdentidade(env)).toMatchObject({ modo: "permanent", url: URL_OK });
    expect(env.PATH).toBe("/usr/bin");
  });

  it("shell com legacy/URL velhos NÃO vence o arquivo — nem para ligar, nem para desligar", () => {
    const shellLegado = { KING_IDENTITY_MODE: "legacy", SUPABASE_URL: "https://outro.supabase.co", pm_id: "0" };
    expect(resolverModoDeIdentidade(carregarAmbiente(shellLegado, discoCom(permanente)).env))
      .toMatchObject({ modo: "permanent", url: URL_OK });
    const shellPermanente = { KING_IDENTITY_MODE: "permanent", SUPABASE_URL: URL_OK, pm_id: "0" };
    expect(resolverModoDeIdentidade(carregarAmbiente(shellPermanente, discoCom(legado)).env).modo).toBe("legacy");
  });

  it("chave que o arquivo não tem é APAGADA, e não herdada da shell", () => {
    const shell = { SUPABASE_JWT_AUDIENCE: "herdada", pm_id: "0" };
    expect(carregarAmbiente(shell, discoCom(permanente)).env.SUPABASE_JWT_AUDIENCE).toBeUndefined();
  });

  it("sob PM2 (pm_id) o arquivo é obrigatório: ausente é ERRO, nunca legacy", () => {
    erro(() => carregarAmbiente({ pm_id: "0", KING_IDENTITY_MODE: "permanent", SUPABASE_URL: URL_OK }, DISCO_VAZIO));
  });

  it("KING_ENV_FILE apontando para arquivo ausente é ERRO", () => {
    erro(() => carregarAmbiente({ KING_ENV_FILE: "/tmp/nao-existe.env" }, DISCO_VAZIO));
  });

  it("KING_ENV_FILE aponta outro caminho, e ele é usado", () => {
    const { origem, env } = carregarAmbiente(
      { KING_ENV_FILE: "/tmp/k.env" }, discoCom({ "/tmp/k.env": "KING_IDENTITY_MODE=legacy" }),
    );
    expect(origem).toEqual({ arquivo: "/tmp/k.env", carregado: true, exigido: true });
    expect(resolverModoDeIdentidade(env).modo).toBe("legacy");
  });

  it("arquivo que não declara o modo é ERRO", () => {
    erro(() => carregarAmbiente({}, discoCom({ [ARQUIVO_DE_AMBIENTE_PADRAO]: `SUPABASE_URL=${URL_OK}` })));
  });

  it("sem PM2 e sem arquivo (local, CI, e2e): o ambiente fica como está", () => {
    const { env, origem } = carregarAmbiente({ PORT: "2567" }, DISCO_VAZIO);
    expect(env).toEqual({ PORT: "2567" });
    expect(origem.carregado).toBe(false);
    expect(resolverModoDeIdentidade(env).modo).toBe("legacy");
  });
});

describe("o boot escreve de volta só a identidade, e o log não carrega a URL", () => {
  it("prepararIdentidade aplica o arquivo e apaga o que ele não tem", () => {
    const processo: Record<string, string | undefined> = { SUPABASE_JWT_AUDIENCE: "velha", pm_id: "0", OUTRA: "fica" };
    const r = prepararIdentidade(processo, discoCom({
      [ARQUIVO_DE_AMBIENTE_PADRAO]: `KING_IDENTITY_MODE=permanent\nSUPABASE_URL=${URL_OK}`,
    }));
    expect(r.modo.modo).toBe("permanent");
    expect(processo.KING_IDENTITY_MODE).toBe("permanent");
    expect(processo.SUPABASE_URL).toBe(URL_OK);
    expect("SUPABASE_JWT_AUDIENCE" in processo).toBe(false);
    expect(processo.OUTRA).toBe("fica");
    expect(r.resumo).toContain("identity mode: permanent");
    expect(r.resumo).toContain("SUPABASE_URL: configured");
    expect(r.resumo).not.toContain("abcdefghij");
  });

  it("incoerência não mexe no ambiente do processo", () => {
    const processo: Record<string, string | undefined> = { SUPABASE_URL: URL_OK };
    expect(() => prepararIdentidade(processo, discoCom({
      [ARQUIVO_DE_AMBIENTE_PADRAO]: "KING_IDENTITY_MODE=permanent",
    }))).toThrow(ConfiguracaoInvalida);
    expect(processo.SUPABASE_URL).toBe(URL_OK);
  });

  it("o resumo do legacy diz se a URL está sendo ignorada, sem mostrá-la", () => {
    const r = resumoSeguro({ modo: "legacy", declarado: true }, { SUPABASE_URL: URL_OK });
    expect(r).toBe("identity mode: legacy · SUPABASE_URL: ignored (legacy)");
  });
});
