// PENALIDADE DO REI (Entrega C) — o que o servidor manda ao banco, e por qual porta.
//
// O XP continua sendo do banco: aqui se prova que o servidor só acrescenta um FATO (`capturouRei`) e a
// VERSÃO da regra, que o resultado antigo (sem o fato) sai idêntico ao de antes, que o outbox aceita os
// dois e recusa o meio-termo, e que o repositório escolhe a porta certa — com a v1 como volta segura
// SÓ quando o banco não conhece a v2 (42883), nunca por uma falha qualquer.
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type pg from "pg";
import { resultadoParaCredito, type AssentoAoFim, type PartidaEncerrada } from "./resultado.js";
import { ResultadoInvalido, validarResultado, type ResultadoDaPartida } from "./tipos.js";
import {
  CHAMADA_DE_CREDITO, CHAMADA_DE_CREDITO_V2, CHAMADA_DOS_PLACARES, parametrosDoCredito, parametrosDoCreditoV2, repositorioPg,
} from "./repositorio.js";
import { OutboxDeProgresso } from "./outbox.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PARTIDA = "33333333-3333-4333-8333-333333333333";

const bot = (seat: number): AssentoAoFim => ({ seat, playerId: `bot:${seat}`, bot: true, permanente: false, conectado: true, jogadasTotais: 30, jogadasProprias: 0 });
const humano = (seat: number, playerId: string, extra: Partial<AssentoAoFim> = {}): AssentoAoFim =>
  ({ seat, playerId, bot: false, permanente: true, conectado: true, jogadasTotais: 30, jogadasProprias: 30, ...extra });
const partida = (assentos: AssentoAoFim[], capturouRei?: number | null): PartidaEncerrada => ({
  partidaId: PARTIDA,
  iniciadaEm: new Date("2026-11-20T12:00:00Z"),
  terminadaEm: new Date("2026-11-20T12:20:00Z"),
  assentos,
  posicoes: { 0: 1, 1: 2, 2: 3, 3: 4 },
  ...(capturouRei !== undefined ? { capturouRei } : {}),
});
const MESA = [humano(0, A), bot(1), humano(2, B), bot(3)];
const copia = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("o resultado leva o FATO da captura e a versão da regra — e nada de XP", () => {
  it("humano capturou: regra 2, `capturouRei` em TODOS os humanos, só ele true", () => {
    const r = resultadoParaCredito(partida(MESA, 2))!;
    expect(r.regra).toBe(2);
    expect(r.humanos).toEqual([
      { playerId: A, posicao: 1, participou: true, capturouRei: false },
      { playerId: B, posicao: 3, participou: true, capturouRei: true },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/xp|penalidade|60/i);
  });

  it("um BOT capturou: regra 2 e ninguém marcado (bot não recebe XP, e nenhum humano paga por ele)", () => {
    const r = resultadoParaCredito(partida(MESA, 1))!;
    expect(r.regra).toBe(2);
    expect(r.humanos.map((h) => h.capturouRei)).toEqual([false, false]);
  });

  it("o capturador que ABANDONOU segue marcado — e o banco dá 0 a quem não participou, sem penalidade negativa", () => {
    const r = resultadoParaCredito(partida([humano(0, A, { conectado: false }), bot(1), humano(2, B), bot(3)], 0))!;
    expect(r.humanos[0]).toEqual({ playerId: A, posicao: 1, participou: false, capturouRei: true });
  });

  it("SEM o fato (null, ausente ou assento impossível) o resultado sai IDÊNTICO ao de antes — regra 1", () => {
    const antes = resultadoParaCredito(partida(MESA))!;
    expect(Object.keys(antes).sort()).toEqual(["bots", "humanos", "iniciadaEm", "partidaId", "terminadaEm"]);
    for (const sem of [null, 4, -1, 1.5, Number.NaN]) {
      expect(resultadoParaCredito(partida(MESA, sem))).toEqual(antes);
    }
  });

  it("os parâmetros da v2 são os da v1 MAIS `capturou_rei`; a v1 continua recebendo exatamente três campos", () => {
    const r = resultadoParaCredito(partida(MESA, 0))!;
    const v1 = JSON.parse(parametrosDoCredito(r)[5] as string) as Record<string, unknown>[];
    for (const h of v1) expect(Object.keys(h).sort()).toEqual(["participou", "player_id", "posicao"]);
    const v2 = parametrosDoCreditoV2(r)!;
    expect(v2.slice(0, 5)).toEqual(parametrosDoCredito(r).slice(0, 5));
    expect(JSON.parse(v2[5] as string)).toEqual([
      { player_id: A, posicao: 1, participou: true, capturou_rei: true },
      { player_id: B, posicao: 3, participou: true, capturou_rei: false },
    ]);
    expect(parametrosDoCreditoV2(resultadoParaCredito(partida(MESA))!)).toBeNull();
  });
});

describe("o OUTBOX: pendência antiga e nova valem; o meio-termo não", () => {
  const novo = resultadoParaCredito(partida(MESA, 2))!;
  const antigo = resultadoParaCredito(partida(MESA))!;

  it("aceita o resultado ANTIGO (sem regra, sem fato), o novo, e o novo com pontos", () => {
    expect(validarResultado(copia(antigo))).toEqual(antigo);
    expect(validarResultado(copia(novo))).toEqual(novo);
    const comPontos = { ...novo, humanos: novo.humanos.map((h) => ({ ...h, pontos: -40 })) };
    expect(validarResultado(copia(comPontos))).toEqual(comPontos);
  });

  it.each([
    ["regra desconhecida", { ...novo, regra: 3 }],
    ["regra 1 explícita (a 1 é a AUSÊNCIA do campo)", { ...novo, regra: 1 }],
    ["regra 2 sem o fato num humano", { ...novo, humanos: [novo.humanos[0], { playerId: B, posicao: 3, participou: true }] }],
    ["fato sem a regra 2", { ...antigo, humanos: antigo.humanos.map((h) => ({ ...h, capturouRei: false })) }],
    ["dois capturadores", { ...novo, humanos: novo.humanos.map((h) => ({ ...h, capturouRei: true })) }],
    ["fato que não é booleano", { ...novo, humanos: novo.humanos.map((h) => ({ ...h, capturouRei: "sim" })) }],
    ["fato nulo", { ...novo, humanos: novo.humanos.map((h) => ({ ...h, capturouRei: null })) }],
    ["XP escondido no humano", { ...novo, humanos: novo.humanos.map((h) => ({ ...h, penalidade: 60 })) }],
    ["XP escondido no resultado", { ...novo, penalidadeRei: 60 }],
  ])("recusa: %s", (_nome, ruim) => {
    expect(() => validarResultado(copia(ruim))).toThrow(ResultadoInvalido);
  });

  it("pendência ANTIGA gravada em disco por um servidor de antes volta como regra 1 (sem fato) e a nova como regra 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "king-outbox-rei-"));
    try {
      const o = new OutboxDeProgresso(dir);
      // o arquivo de antes, byte a byte como o servidor anterior gravava (sem `regra`, sem `capturouRei`)
      const velho = { ...antigo, partidaId: "55555555-5555-4555-8555-555555555555" };
      writeFileSync(join(dir, `${velho.partidaId}.json`), JSON.stringify(velho));
      o.gravar(novo);
      const { validas, corrompidas } = o.pendentes();
      expect(corrompidas).toEqual([]);
      const porId = new Map(validas.map((r) => [r.partidaId, r]));
      expect(porId.get(velho.partidaId)!.regra).toBeUndefined();
      expect(parametrosDoCreditoV2(porId.get(velho.partidaId)!)).toBeNull();
      expect(porId.get(PARTIDA)!.regra).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── o repositório com um pool FALSO: só registra o que seria enviado ao Postgres ──
type Resposta = { rows: unknown[] } | { erro: string };
function poolFalso(roteiro: (sql: string) => Resposta) {
  const enviados: string[] = [];
  const responder = async (sql: string) => {
    enviados.push(sql);
    const r = roteiro(sql);
    if ("erro" in r) throw Object.assign(new Error(`falso ${r.erro}`), { code: r.erro });
    return r;
  };
  const cliente = { query: responder, release: () => {} };
  const pool = { query: responder, connect: async () => cliente, on: () => pool, end: async () => {} };
  return { pool: pool as unknown as pg.Pool, enviados };
}
const LINHAS = [{ player_id: A, posicao: 1, xp_delta: 90, novo: true }];
const nome = (sql: string) =>
  sql === CHAMADA_DE_CREDITO_V2 ? "v2" : sql === CHAMADA_DE_CREDITO ? "v1" : sql === CHAMADA_DOS_PLACARES ? "placares" : sql;
const comPontos = (r: ResultadoDaPartida): ResultadoDaPartida => ({ ...r, humanos: r.humanos.map((h) => ({ ...h, pontos: 100 })) });

describe("o repositório escolhe a porta", () => {
  const novo = resultadoParaCredito(partida(MESA, 0))!;
  const antigo = resultadoParaCredito(partida(MESA))!;

  it("banco novo: regra 2 vai SÓ à v2", async () => {
    const { pool, enviados } = poolFalso(() => ({ rows: LINHAS }));
    const l = await repositorioPg({ pool }).creditar(novo);
    expect(enviados.map(nome)).toEqual(["v2"]);
    expect(l).toEqual([{ playerId: A, posicao: 1, xpDelta: 90, novo: true }]);
  });

  it("pendência antiga (sem o fato) vai SÓ à v1 — mesmo com o banco novo", async () => {
    const { pool, enviados } = poolFalso(() => ({ rows: LINHAS }));
    await repositorioPg({ pool }).creditar(antigo);
    expect(enviados.map(nome)).toEqual(["v1"]);
  });

  it("banco ANTIGO (42883 na v2): a MESMA partida vai à v1 — o crédito não se perde nem trava o outbox", async () => {
    const { pool, enviados } = poolFalso((sql) => (sql === CHAMADA_DE_CREDITO_V2 ? { erro: "42883" } : { rows: LINHAS }));
    const l = await repositorioPg({ pool }).creditar(novo);
    expect(enviados.map(nome)).toEqual(["v2", "v1"]);
    expect(l).toHaveLength(1);
  });

  it.each(["22023", "40001", "08006", "28P01", "42501"])("outro erro da v2 (%s) SOBE — nunca vira crédito pela regra antiga", async (codigo) => {
    const { pool, enviados } = poolFalso((sql) => (sql === CHAMADA_DE_CREDITO_V2 ? { erro: codigo } : { rows: LINHAS }));
    await expect(repositorioPg({ pool }).creditar(novo)).rejects.toMatchObject({ code: codigo });
    expect(enviados.map(nome)).toEqual(["v2"]);
  });

  it("com placar (transação): a v2 roda num SAVEPOINT; 42883 desfaz só ele, e v1 + placar seguem na MESMA transação", async () => {
    const { pool, enviados } = poolFalso((sql) => (sql === CHAMADA_DE_CREDITO_V2 ? { erro: "42883" } : { rows: LINHAS }));
    await repositorioPg({ pool }).creditar(comPontos(novo));
    expect(enviados.map(nome)).toEqual([
      "begin", "savepoint credito_v2", "v2", "rollback to savepoint credito_v2", "v1", "savepoint placares", "placares", "commit",
    ]);
  });

  it("com placar e banco novo: v2 e placar na mesma transação", async () => {
    const { pool, enviados } = poolFalso(() => ({ rows: LINHAS }));
    await repositorioPg({ pool }).creditar(comPontos(novo));
    expect(enviados.map(nome)).toEqual(["begin", "savepoint credito_v2", "v2", "savepoint placares", "placares", "commit"]);
  });

  it("com placar e erro qualquer na v2: a transação inteira volta (rollback), sem v1 e sem placar", async () => {
    const { pool, enviados } = poolFalso((sql) => (sql === CHAMADA_DE_CREDITO_V2 ? { erro: "40001" } : { rows: LINHAS }));
    await expect(repositorioPg({ pool }).creditar(comPontos(novo))).rejects.toMatchObject({ code: "40001" });
    expect(enviados.map(nome)).toEqual(["begin", "savepoint credito_v2", "v2", "rollback"]);
  });
});
