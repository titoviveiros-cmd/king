// O SERVIÇO — ordem outbox → banco → remoção, retry e o crash no pior instante.
//
// O repositório aqui é uma dublê com a MESMA semântica do banco: idempotente por `partidaId`.
// A prova com o Postgres de verdade (crash depois do COMMIT e antes da remoção) está em
// `scripts/testar-progresso-sql.mjs`, T21.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutboxDeProgresso } from "./outbox.js";
import { parametrosDoCredito, type RepositorioDeProgresso } from "./repositorio.js";
import { ServicoDeProgresso } from "./servico.js";
import type { AssentoAoFim, PartidaEncerrada } from "./resultado.js";
import type { LancamentoConfirmado, ResultadoDaPartida } from "./tipos.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PARTIDA = "33333333-3333-4333-8333-333333333333";

const humano = (seat: number, playerId: string, extra: Partial<AssentoAoFim> = {}): AssentoAoFim => ({
  seat, playerId, bot: false, permanente: true, conectado: true, jogadasTotais: 30, jogadasProprias: 30, ...extra,
});
const bot = (seat: number): AssentoAoFim => ({
  seat, playerId: `bot:${seat}`, bot: true, permanente: false, conectado: true, jogadasTotais: 30, jogadasProprias: 0,
});
const partida = (extra: Partial<PartidaEncerrada> = {}): PartidaEncerrada => ({
  partidaId: PARTIDA,
  iniciadaEm: new Date("2026-09-24T12:00:00Z"),
  terminadaEm: new Date("2026-09-24T12:12:00Z"),
  assentos: [humano(0, A), bot(1), humano(2, B), bot(3)],
  posicoes: { 0: 1, 1: 2, 2: 3, 3: 4 },
  ...extra,
});

/** Dublê idempotente, como o banco: a mesma partida devolve o mesmo, com novo=false. */
function bancoFalso(opcoes: { falhasAntes?: number; aoCreditar?: () => void } = {}) {
  const creditadas = new Map<string, LancamentoConfirmado[]>();
  let falhas = opcoes.falhasAntes ?? 0;
  const chamadas: ResultadoDaPartida[] = [];
  const repo: RepositorioDeProgresso = {
    async creditar(r) {
      chamadas.push(r);
      opcoes.aoCreditar?.();
      if (falhas > 0) { falhas -= 1; throw Object.assign(new Error("rede"), { code: "ECONNRESET" }); }
      const ja = creditadas.get(r.partidaId);
      if (ja) return ja.map((l) => ({ ...l, novo: false }));
      const novos = r.humanos.map((h) => ({ playerId: h.playerId, posicao: h.posicao, xpDelta: 100, novo: true }));
      creditadas.set(r.partidaId, novos);
      return novos;
    },
    async encerrar() {},
  };
  return { repo, chamadas, creditadas };
}

let dir = "";
let logs: string[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "king-servico-")); logs = []; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const opcoes = { esperas: [0, 0], esperar: async () => {}, log: (m: string) => logs.push(m) };
const pendente = () => existsSync(join(dir, `${PARTIDA}.json`));

describe("ordem: outbox ANTES do banco, remoção DEPOIS do COMMIT", () => {
  it("quando o banco é chamado, a pendência já está em disco", async () => {
    let naHora = false;
    const { repo } = bancoFalso({ aoCreditar: () => { naHora = pendente(); } });
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), repo, opcoes);
    s.partidaEncerrada(partida());
    await s.ocioso();
    expect(naHora).toBe(true);
    expect(pendente()).toBe(false);
  });

  it("uma partida encerrada vira UM crédito, com o mesmo matchId", async () => {
    const { repo, chamadas } = bancoFalso();
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), repo, opcoes);
    s.partidaEncerrada(partida());
    await s.ocioso();
    expect(chamadas.map((c) => c.partidaId)).toEqual([PARTIDA]);
  });
});

describe("retry e reprocessamento", () => {
  it("falha de rede: tenta de novo com o MESMO matchId, e só remove depois de confirmar", async () => {
    const { repo, chamadas } = bancoFalso({ falhasAntes: 2 });
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), repo, opcoes);
    s.partidaEncerrada(partida());
    await s.ocioso();
    expect(chamadas.map((c) => c.partidaId)).toEqual([PARTIDA, PARTIDA, PARTIDA]);
    expect(pendente()).toBe(false);
  });

  it("tentativas esgotadas: a pendência FICA no outbox para o próximo boot", async () => {
    const { repo } = bancoFalso({ falhasAntes: 99 });
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), repo, opcoes);
    s.partidaEncerrada(partida());
    await s.ocioso();
    expect(pendente()).toBe(true);
    expect(logs.join("\n")).not.toContain(A); // id nunca inteiro no log
  });

  it("CRASH depois do COMMIT e antes da remoção: o boot reenvia e o banco NÃO soma de novo", async () => {
    const banco = bancoFalso();
    // 1ª vida do processo: o COMMIT acontece, e o processo "morre" antes de remover a pendência
    class OutboxQueMorreAoRemover extends OutboxDeProgresso {
      override remover(): void { throw new Error("o processo morreu aqui"); }
    }
    const primeira = new ServicoDeProgresso(new OutboxQueMorreAoRemover(dir), banco.repo, opcoes);
    primeira.partidaEncerrada(partida());
    await primeira.ocioso();
    expect(pendente()).toBe(true);
    expect(banco.creditadas.get(PARTIDA)?.every((l) => l.novo)).toBe(true);

    // 2ª vida: boot reprocessa
    const segunda = new ServicoDeProgresso(new OutboxDeProgresso(dir), banco.repo, opcoes);
    const balanco = await segunda.reprocessar();
    expect(balanco).toEqual({ entregues: 1, pendentes: 0, corrompidas: [] });
    expect(banco.chamadas.map((c) => c.partidaId)).toEqual([PARTIDA, PARTIDA]);
    expect(banco.creditadas.size).toBe(1);
    expect(pendente()).toBe(false);
  });

  it("boot com pendência corrompida: reporta pelo NOME e não apaga", async () => {
    writeFileSync(join(dir, "77777777-7777-4777-8777-777777777777.json"), "{quebrado");
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), bancoFalso().repo, opcoes);
    const b = await s.reprocessar();
    expect(b.corrompidas).toEqual(["77777777-7777-4777-8777-777777777777.json"]);
    expect(existsSync(join(dir, "77777777-7777-4777-8777-777777777777.json"))).toBe(true);
  });
});

describe("o que nunca vai ao banco", () => {
  it("identidade sorteada (legacy): nada é gravado nem enviado", async () => {
    const { repo, chamadas } = bancoFalso();
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), repo, opcoes);
    s.partidaEncerrada(partida({ assentos: [humano(0, A, { permanente: false }), bot(1), humano(2, B), bot(3)] }));
    await s.ocioso();
    expect(chamadas).toEqual([]);
    expect(pendente()).toBe(false);
  });

  it("os parâmetros da chamada não têm XP: cada humano leva só player_id, posicao e participou", () => {
    const { repo } = bancoFalso();
    void repo;
    const params = parametrosDoCredito({
      partidaId: PARTIDA, iniciadaEm: "2026-09-24T12:00:00.000Z", terminadaEm: "2026-09-24T12:12:00.000Z", bots: 2,
      humanos: [{ playerId: A, posicao: 1, participou: true }, { playerId: B, posicao: 3, participou: false }],
    });
    expect(params.slice(0, 5)).toEqual([PARTIDA, "2026-09-24T12:00:00.000Z", "2026-09-24T12:12:00.000Z", 2, 2]);
    const humanos = JSON.parse(params[5] as string) as Record<string, unknown>[];
    for (const h of humanos) expect(Object.keys(h).sort()).toEqual(["participou", "player_id", "posicao"]);
    expect(params[5]).not.toMatch(/xp/i);
  });
});
