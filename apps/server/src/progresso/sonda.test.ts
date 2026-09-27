// A SONDA DA ATIVAÇÃO — o boot do progresso, rodado UMA vez, fora do servidor, contra um arquivo
// de configuração explícito. Mesmo parser, mesmo repositório, mesma lógica de sonda do serviço.
//
// O repositório aqui é uma dublê com as falhas REAIS medidas no Supabase (28P01, ECIRCUITBREAKER,
// erro de rede). O agendador é falso: nenhum teste espera 30 s de verdade. A prova com o Postgres
// de verdade está em `scripts/testar-progresso-sql.mjs`, T23.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LeitorDeArquivo } from "./config.js";
import { OutboxDeProgresso } from "./outbox.js";
import type { RepositorioDeProgresso } from "./repositorio.js";
import { ESPERA_DA_CONFIRMACAO_MS } from "./servico.js";
import { criarAgendador, linhasDaSonda, SAIDA_DA_SONDA, sondarProgresso } from "./sonda.js";

const ERRO_AUTENTICACAO = () => Object.assign(new Error('password authentication failed for user "king_server"'), { code: "28P01" });
const ERRO_DISJUNTOR = () => Object.assign(
  new Error("(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked"), { code: "XX000" });
const ERRO_REDE = () => Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" });

const SENHA = "senha-que-nunca-pode-aparecer-0123456789";
const HOST = "aws-0-sa-east-1.pooler.supabase.com";
const URL_OK = `postgresql://king_server.projeto:${SENHA}@${HOST}:5432/postgres`;
const CA = "-----BEGIN CERTIFICATE-----\nMIIBfakeCAcontentXYZ\n-----END CERTIFICATE-----\n";

/** Disco em memória: o arquivo de progresso e a CA, sem tocar o disco de verdade. */
function disco(arquivos: Record<string, string>): LeitorDeArquivo {
  return { existe: (c) => c in arquivos, ler: (c) => { if (!(c in arquivos)) throw new Error("ENOENT"); return arquivos[c]; } };
}
const ENV = "/etc/king/progress.env.pendente";
const conteudo = (extra: Record<string, string> = {}) => Object.entries({
  KING_PROGRESS_MODE: "database", KING_PROGRESS_DATABASE_URL: URL_OK,
  KING_PROGRESS_SSL_ROOT_CERT: "/etc/king/ca.crt", KING_PROGRESS_OUTBOX_DIR: "/var/lib/king/progresso-outbox", ...extra,
}).map(([k, v]) => `${k}=${v}`).join("\n");
const discoOk = (extra: Record<string, string> = {}) => disco({ [ENV]: conteudo(extra), "/etc/king/ca.crt": CA });

type Falha = () => Error;
/** Dublê do repositório: cada sonda consome a próxima falha da fila; fila vazia = sucesso. */
function bancoFalso(falhas: Falha[] = []) {
  const fila = [...falhas];
  const chamadas: string[] = [];
  let recebido: { url: string; ca: string } | null = null;
  const criar = (c: { url: string; ca: string }): RepositorioDeProgresso => {
    recebido = c;
    return {
      async sondar() { chamadas.push("sondar"); const f = fila.shift(); if (f) throw f(); },
      async creditar() { chamadas.push("creditar"); return []; },
      async encerrar() { chamadas.push("encerrar"); },
    };
  };
  return { criar, chamadas, get recebido() { return recebido; } };
}

/** Agendador de mentira: guarda o que foi pedido; o teste decide quando disparar. */
function agendadorFalso() {
  const pedidos: { ms: number; fn: () => void }[] = [];
  return { pedidos, agendar: (fn: () => void, ms: number) => { pedidos.push({ fn, ms }); } };
}
const vez = () => new Promise((r) => setTimeout(r, 0));

describe("a sonda usa o MESMO parser, a MESMA CA e a MESMA lógica de sonda do servidor", () => {
  it("credencial aceita: closed, UMA tentativa, saída 0, e a conexão é encerrada", async () => {
    const banco = bancoFalso();
    const r = await sondarProgresso({ arquivo: ENV, disco: discoOk(), criarRepositorio: banco.criar });
    expect(r).toMatchObject({ desfecho: "closed", saida: SAIDA_DA_SONDA.closed, tentativas: 1 });
    expect(banco.recebido).toEqual({ url: URL_OK, ca: CA }); // a URL e a CA que o parser leu, sem retoque
    expect(banco.chamadas).toEqual(["sondar", "encerrar"]);
  });

  it("28P01 → espera 30 s → UMA confirmação aceita → closed, 2 tentativas", async () => {
    const banco = bancoFalso([ERRO_AUTENTICACAO]);
    const ag = agendadorFalso();
    const sonda = sondarProgresso({ arquivo: ENV, disco: discoOk(), criarRepositorio: banco.criar, agendar: ag.agendar });
    await vez();
    expect(ag.pedidos.map((p) => p.ms)).toEqual([ESPERA_DA_CONFIRMACAO_MS]);
    expect(banco.chamadas).toEqual(["sondar"]); // nada antes dos 30 s
    ag.pedidos[0].fn();
    const r = await sonda;
    expect(r).toMatchObject({ desfecho: "closed", saida: 0, tentativas: 2, codigos: ["28P01/autenticacao", "ok"] });
  });

  it("28P01 → confirmação 28P01 → open_auth, 2 tentativas e NENHUMA outra", async () => {
    const banco = bancoFalso([ERRO_AUTENTICACAO, ERRO_AUTENTICACAO]);
    const ag = agendadorFalso();
    const sonda = sondarProgresso({ arquivo: ENV, disco: discoOk(), criarRepositorio: banco.criar, agendar: ag.agendar });
    await vez();
    ag.pedidos[0].fn();
    const r = await sonda;
    expect(r).toMatchObject({ desfecho: "open_auth", saida: SAIDA_DA_SONDA.open_auth, tentativas: 2 });
    expect(ag.pedidos).toHaveLength(1);
    expect(banco.chamadas.filter((c) => c === "sondar")).toHaveLength(2);
  });

  it("ECIRCUITBREAKER → open_circuit, 1 tentativa; a meia-abertura de 10 min NÃO acontece na sonda", async () => {
    const banco = bancoFalso([ERRO_DISJUNTOR]);
    const r = await sondarProgresso({ arquivo: ENV, disco: discoOk(), criarRepositorio: banco.criar });
    expect(r).toMatchObject({ desfecho: "open_circuit", saida: SAIDA_DA_SONDA.open_circuit, tentativas: 1 });
  });

  it("erro transitório: o SERVIÇO seguiria em closed, mas a SONDA diz que não conectou (saída própria)", async () => {
    const banco = bancoFalso([ERRO_REDE]);
    const r = await sondarProgresso({ arquivo: ENV, disco: discoOk(), criarRepositorio: banco.criar });
    expect(r).toMatchObject({ desfecho: "transitoria", saida: SAIDA_DA_SONDA.transitoria, tentativas: 1, codigos: ["ECONNREFUSED/transitoria"] });
  });

  it("28P01 e depois erro transitório na confirmação: transitória, sem terceira tentativa", async () => {
    const banco = bancoFalso([ERRO_AUTENTICACAO, ERRO_REDE]);
    const ag = agendadorFalso();
    const sonda = sondarProgresso({ arquivo: ENV, disco: discoOk(), criarRepositorio: banco.criar, agendar: ag.agendar });
    await vez();
    ag.pedidos[0].fn();
    const r = await sonda;
    expect(r).toMatchObject({ desfecho: "transitoria", tentativas: 2 });
    expect(ag.pedidos).toHaveLength(1);
  });

  it("as cinco saídas são distintas", () => {
    const valores = Object.values(SAIDA_DA_SONDA);
    expect(new Set(valores).size).toBe(valores.length);
    expect(Object.keys(SAIDA_DA_SONDA).sort()).toEqual(["closed", "config_invalida", "open_auth", "open_circuit", "transitoria"]);
  });
});

describe("configuração inválida: saída 78, e o banco nem é procurado", () => {
  const casos: [string, LeitorDeArquivo][] = [
    ["arquivo ausente", disco({})],
    ["KING_PROGRESS_MODE=disabled", disco({ [ENV]: "KING_PROGRESS_MODE=disabled" })],
    ["parâmetro SSL na URL", discoOk({ KING_PROGRESS_DATABASE_URL: `${URL_OK}?sslmode=require` })],
    ["CA inexistente", disco({ [ENV]: conteudo() })],
    ["CA que não é PEM", disco({ [ENV]: conteudo(), "/etc/king/ca.crt": "isto não é certificado" })],
    ["chave desconhecida", disco({ [ENV]: `${conteudo()}\nKING_PROGRESS_SENHA=${SENHA}`, "/etc/king/ca.crt": CA })],
  ];
  for (const [nome, d] of casos) {
    it(nome, async () => {
      const banco = bancoFalso();
      const r = await sondarProgresso({ arquivo: ENV, disco: d, criarRepositorio: banco.criar });
      expect(r).toMatchObject({ desfecho: "config_invalida", saida: SAIDA_DA_SONDA.config_invalida, tentativas: 0 });
      expect(banco.chamadas).toEqual([]);
      expect(linhasDaSonda(r).join("\n")).not.toContain(SENHA);
    });
  }
});

describe("o que a sonda NUNCA faz", () => {
  let dir = "";
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "king-sonda-outbox-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("não credita nem mexe no OUTBOX da configuração — mesmo com pendência VÁLIDA lá dentro", async () => {
    const partidaId = "33333333-3333-4333-8333-333333333333";
    new OutboxDeProgresso(dir).gravar({
      partidaId, iniciadaEm: "2026-09-24T12:00:00.000Z", terminadaEm: "2026-09-24T12:12:00.000Z", bots: 2,
      humanos: [{ playerId: "11111111-1111-4111-8111-111111111111", posicao: 1, participou: true },
        { playerId: "22222222-2222-4222-8222-222222222222", posicao: 2, participou: true }],
    });
    const banco = bancoFalso();
    const r = await sondarProgresso({ arquivo: ENV, disco: discoOk({ KING_PROGRESS_OUTBOX_DIR: dir }), criarRepositorio: banco.criar });
    expect(r.desfecho).toBe("closed");
    expect(banco.chamadas).not.toContain("creditar");
    expect(readdirSync(dir)).toEqual([`${partidaId}.json`]);
  });

  it("o outbox da configuração nem é LIDO: apontá-lo para um arquivo comum não atrapalha a sonda", async () => {
    // Se a sonda lesse o outbox configurado, `readdir` num arquivo quebraria o boot (ENOTDIR).
    const arquivoComum = join(dir, "nao-sou-pasta");
    writeFileSync(arquivoComum, "x");
    const banco = bancoFalso();
    const r = await sondarProgresso({ arquivo: ENV, disco: discoOk({ KING_PROGRESS_OUTBOX_DIR: arquivoComum }), criarRepositorio: banco.criar });
    expect(r.desfecho).toBe("closed");
    expect(existsSync(arquivoComum)).toBe(true);
  });

  it("não imprime senha, URL, host nem a CA — nem quando o erro do banco traz tudo isso", async () => {
    const vazante = () => Object.assign(new Error(`falhou em ${URL_OK} com a CA ${CA}`), { code: "28P01" });
    const banco = bancoFalso([vazante, vazante]);
    const ag = agendadorFalso();
    const sonda = sondarProgresso({ arquivo: ENV, disco: discoOk(), criarRepositorio: banco.criar, agendar: ag.agendar });
    await vez();
    ag.pedidos[0].fn();
    const texto = linhasDaSonda(await sonda).join("\n");
    for (const proibido of [SENHA, "postgresql://", HOST, "BEGIN CERTIFICATE", "fakeCA", "password authentication"]) {
      expect(texto).not.toContain(proibido);
    }
    expect(texto).toMatch(/estado final: open_auth/);
    expect(texto).toMatch(/tentativas: 2/);
    expect(texto).toMatch(/28P01\/autenticacao/);
  });

  it("o agendador padrão MANTÉM o processo vivo durante a espera (timer com ref) e cancela o que sobrar", () => {
    const ag = criarAgendador();
    let disparou = false;
    ag.agendar(() => { disparou = true; }, 60_000);
    expect(ag.timers).toHaveLength(1);
    expect(ag.timers[0].hasRef()).toBe(true); // com unref, o Node sairia no meio dos 30 s, calado
    ag.cancelarTudo();
    expect(disparou).toBe(false);
  });

  it("com o agendador PADRÃO, o disjuntor aberto não deixa a meia-abertura pendurando o processo", async () => {
    const banco = bancoFalso([ERRO_DISJUNTOR]);
    const antes = process.getActiveResourcesInfo().filter((t) => t === "Timeout").length;
    await sondarProgresso({ arquivo: ENV, disco: discoOk(), criarRepositorio: banco.criar });
    const depois = process.getActiveResourcesInfo().filter((t) => t === "Timeout").length;
    expect(depois).toBe(antes);
  });
});
