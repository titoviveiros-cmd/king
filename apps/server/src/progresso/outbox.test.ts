// O OUTBOX EM DISCO DE VERDADE — diretório temporário, arquivos reais.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARCADOR_DO_OUTBOX, OutboxDeProgresso } from "./outbox.js";
import type { ResultadoDaPartida } from "./tipos.js";

const resultado = (partidaId = "33333333-3333-4333-8333-333333333333"): ResultadoDaPartida => ({
  partidaId,
  iniciadaEm: "2026-09-24T12:00:00.000Z",
  terminadaEm: "2026-09-24T12:12:00.000Z",
  bots: 2,
  humanos: [
    { playerId: "11111111-1111-4111-8111-111111111111", posicao: 1, participou: true },
    { playerId: "22222222-2222-4222-8222-222222222222", posicao: 3, participou: false },
  ],
});

let dir = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "king-outbox-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("gravar", () => {
  it("grava um arquivo por partida, com o nome da partida, e nada temporário sobra", () => {
    const o = new OutboxDeProgresso(join(dir, "pendencias"));
    o.gravar(resultado());
    expect(readdirSync(join(dir, "pendencias"))).toEqual(["33333333-3333-4333-8333-333333333333.json"]);
  });

  it("o conteúdo é só o resultado — sem XP, sem senha, sem token", () => {
    const o = new OutboxDeProgresso(dir);
    o.gravar(resultado());
    const bruto = readFileSync(join(dir, "33333333-3333-4333-8333-333333333333.json"), "utf8");
    expect(JSON.parse(bruto)).toEqual(resultado());
    expect(bruto).not.toMatch(/xp|senha|password|token|postgres/i);
  });

  it("recusa gravar lixo: resultado inválido não vira pendência", () => {
    const o = new OutboxDeProgresso(dir);
    expect(() => o.gravar({ ...resultado(), partidaId: "../../etc/passwd" })).toThrow();
    expect(() => o.gravar({ ...resultado(), xp: 999 } as unknown as ResultadoDaPartida)).toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("gravar a mesma partida de novo substitui, não duplica", () => {
    const o = new OutboxDeProgresso(dir);
    o.gravar(resultado());
    o.gravar(resultado());
    expect(o.pendentes().validas).toHaveLength(1);
  });
});

describe("pendentes e remover", () => {
  it("lista o que está pendente e remove o confirmado", () => {
    const o = new OutboxDeProgresso(dir);
    o.gravar(resultado("33333333-3333-4333-8333-333333333333"));
    o.gravar(resultado("44444444-4444-4444-8444-444444444444"));
    expect(o.pendentes().validas.map((r) => r.partidaId)).toHaveLength(2);
    o.remover("33333333-3333-4333-8333-333333333333");
    o.remover("33333333-3333-4333-8333-333333333333"); // já removida: tudo bem
    expect(o.pendentes().validas.map((r) => r.partidaId)).toEqual(["44444444-4444-4444-8444-444444444444"]);
  });

  it("diretório que ainda não existe = nada pendente", () => {
    expect(new OutboxDeProgresso(join(dir, "nunca-criado")).pendentes()).toEqual({ validas: [], corrompidas: [] });
  });

  it("arquivo CORROMPIDO é reportado e NÃO é apagado", () => {
    const o = new OutboxDeProgresso(dir);
    o.gravar(resultado());
    writeFileSync(join(dir, "55555555-5555-4555-8555-555555555555.json"), "{isto não é json");
    const p = o.pendentes();
    expect(p.validas).toHaveLength(1);
    expect(p.corrompidas).toEqual(["55555555-5555-4555-8555-555555555555.json"]);
    expect(readdirSync(dir)).toContain("55555555-5555-4555-8555-555555555555.json");
  });

  it("arquivo cujo nome não bate com a partida de dentro também é suspeito", () => {
    const o = new OutboxDeProgresso(dir);
    writeFileSync(join(dir, "66666666-6666-4666-8666-666666666666.json"), JSON.stringify(resultado()));
    expect(o.pendentes().corrompidas).toEqual(["66666666-6666-4666-8666-666666666666.json"]);
  });

  it("temporário de uma escrita interrompida é ignorado, nunca reenviado", () => {
    const o = new OutboxDeProgresso(dir);
    writeFileSync(join(dir, ".33333333-3333-4333-8333-333333333333.123.abcd.tmp"), "{\"parcial\":");
    expect(o.pendentes()).toEqual({ validas: [], corrompidas: [] });
  });
});

describe("inventário do expurgo das lápides (E-2): mais estrito que pendentes()", () => {
  const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it("lista os jogadores das pendências válidas, em minúsculas e sem repetição", () => {
    const o = new OutboxDeProgresso(dir);
    o.gravar(resultado("33333333-3333-4333-8333-333333333333"));
    const outra = resultado("44444444-4444-4444-8444-444444444444");
    outra.humanos[0].playerId = "11111111-1111-4111-8111-111111111111".toUpperCase();
    o.gravar(outra);
    const inv = o.inventario();
    expect(inv.jogadores).toEqual(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]);
    expect(inv.pendencias).toBe(2);
    expect(inv.duvidosos).toEqual([]);
  });

  it("o MARCADOR nasce no 1º inventário, é um id aleatório e não muda depois", () => {
    const o = new OutboxDeProgresso(dir);
    const primeiro = o.inventario().marcador;
    expect(primeiro).toMatch(ID);
    expect(readFileSync(join(dir, MARCADOR_DO_OUTBOX), "utf8").trim()).toBe(primeiro);
    expect(new OutboxDeProgresso(dir).inventario().marcador).toBe(primeiro);
    expect(readdirSync(dir)).toEqual([MARCADOR_DO_OUTBOX]); // nenhum temporário sobrou
    expect(o.pendentes()).toEqual({ validas: [], corrompidas: [] }); // e o reprocesso o ignora
  });

  it("gravar() NUNCA cria o marcador — senão um diretório recriado vazio pareceria o de sempre", () => {
    const o = new OutboxDeProgresso(join(dir, "novo"));
    o.gravar(resultado());
    expect(readdirSync(join(dir, "novo"))).toEqual(["33333333-3333-4333-8333-333333333333.json"]);
  });

  it("diretório AUSENTE: o inventário lança (para pendentes() continua sendo 'nada pendente')", () => {
    const o = new OutboxDeProgresso(join(dir, "nunca-criado"));
    expect(o.pendentes()).toEqual({ validas: [], corrompidas: [] });
    expect(() => o.inventario()).toThrow();
  });

  it("caminho que é ARQUIVO, ou marcador que não é um id: lança", () => {
    writeFileSync(join(dir, "arquivo"), "x");
    expect(() => new OutboxDeProgresso(join(dir, "arquivo")).inventario()).toThrow();
    writeFileSync(join(dir, MARCADOR_DO_OUTBOX), "isto não é um id\n");
    expect(() => new OutboxDeProgresso(dir).inventario()).toThrow(/marcador/);
  });

  it("arquivo corrompido vira DUVIDOSO; temporário de escrita interrompida, não (nunca é reenviado)", () => {
    const o = new OutboxDeProgresso(dir);
    writeFileSync(join(dir, "55555555-5555-4555-8555-555555555555.json"), "{quebrado");
    writeFileSync(join(dir, ".33333333-3333-4333-8333-333333333333.123.abcd.tmp"), "{\"parcial\":");
    expect(o.inventario().duvidosos).toEqual(["55555555-5555-4555-8555-555555555555.json"]);
  });

  it("pendência que some entre listar e ler foi confirmada nesse meio-tempo: não é dúvida", (ctx) => {
    // Um link quebrado é exatamente isso: o nome aparece na listagem e a leitura dá ENOENT.
    try {
      symlinkSync(join(dir, "nao-existe.json"), join(dir, "66666666-6666-4666-8666-666666666666.json"));
    } catch {
      ctx.skip(); // Windows sem permissão de link simbólico; a CI (Linux) roda
    }
    expect(new OutboxDeProgresso(dir).inventario().duvidosos).toEqual([]);
  });
});
