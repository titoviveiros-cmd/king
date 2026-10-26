// O SERVIÇO — ordem outbox → banco → remoção, retry, crash no pior instante e o DISJUNTOR.
//
// O repositório aqui é uma dublê com a MESMA semântica do banco (idempotente por `partidaId`) e com
// as falhas REAIS medidas na Fase 4C: `28P01` e o `ECIRCUITBREAKER` do Supavisor. Relógio e
// agendador são injetados: nenhum teste espera 10 minutos de verdade.
// A prova com o Postgres de verdade está em `scripts/testar-progresso-sql.mjs`, T21.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { OutboxDeProgresso } from "./outbox.js";
import { parametrosDoCredito, type RepositorioDeProgresso } from "./repositorio.js";
import { COOLDOWN_DO_DISJUNTOR_MS, ESPERA_DA_CONFIRMACAO_MS, INTERVALO_DO_EXPURGO_MS, ServicoDeProgresso, type OpcoesDoServico } from "./servico.js";
import type { AssentoAoFim, PartidaEncerrada } from "./resultado.js";
import type { LancamentoConfirmado } from "./tipos.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PARTIDA = "33333333-3333-4333-8333-333333333333";

/** As assinaturas REAIS observadas no Supabase (Fase 4C). */
const ERRO_AUTENTICACAO = () => Object.assign(new Error('password authentication failed for user "king_server"'), { code: "28P01" });
const ERRO_DISJUNTOR = () => Object.assign(
  new Error("(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked"), { code: "XX000" });
const ERRO_REDE = () => Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });

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
const outraPartida = () => partida({ partidaId: randomUUID() });

type Falha = () => Error;
/**
 * Dublê idempotente, como o banco. `falhas` é uma fila: cada operação (sonda ou crédito) consome a
 * próxima falha, se houver; fila vazia = sucesso.
 */
function bancoFalso(falhas: Falha[] = [], aoCreditar?: () => void) {
  const creditadas = new Map<string, LancamentoConfirmado[]>();
  const fila = [...falhas];
  const chamadas: string[] = [];
  /** O expurgo (E-2) tem fila própria: não consome as falhas da sonda e do crédito. */
  const expurgos: { marcador: string; protegidas: string[] }[] = [];
  const falhasDoExpurgo: Falha[] = [];
  const ganchos: { aoExpurgar?: () => Promise<void> | void } = {};
  const repo: RepositorioDeProgresso = {
    async sondar() {
      chamadas.push("sondar");
      const f = fila.shift();
      if (f) throw f();
    },
    async creditar(r) {
      chamadas.push(`creditar:${r.partidaId}`);
      aoCreditar?.();
      const f = fila.shift();
      if (f) throw f();
      const ja = creditadas.get(r.partidaId);
      if (ja) return ja.map((l) => ({ ...l, novo: false }));
      const novos = r.humanos.map((h) => ({ playerId: h.playerId, posicao: h.posicao, xpDelta: 100, novo: true }));
      creditadas.set(r.partidaId, novos);
      return novos;
    },
    async expurgarLapides(marcador, protegidas) {
      chamadas.push("expurgar");
      expurgos.push({ marcador, protegidas: [...protegidas] });
      await ganchos.aoExpurgar?.();
      const f = falhasDoExpurgo.shift();
      if (f) throw f();
      return { removidas: 0, retidas: 0 };
    },
    async encerrar() {},
  };
  return {
    repo, chamadas, creditadas, fila, expurgos, falhasDoExpurgo, ganchos,
    get toquesNoBanco() { return chamadas.length; },
  };
}

/** Relógio e agendador de mentira: o tempo só anda quando o teste manda. */
function tempoFalso() {
  let agora = 1_000_000;
  const agendados: { quando: number; fn: () => void }[] = [];
  return {
    agora: () => agora,
    agendar: (fn: () => void, ms: number) => { agendados.push({ quando: agora + ms, fn }); },
    get pendentes() { return agendados.length; },
    /** Avança o relógio e dispara o que venceu. */
    avancar(ms: number) {
      agora += ms;
      for (const a of agendados.splice(0).filter((x) => { if (x.quando <= agora) return true; agendados.push(x); return false; })) a.fn();
    },
  };
}

let dir = "";
let logs: string[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "king-servico-")); logs = []; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
const opcoesBase: OpcoesDoServico = { esperas: [0, 0], esperar: async () => {}, log: (m: string) => { logs.push(m); } };
const pendente = (id = PARTIDA) => existsSync(join(dir, `${id}.json`));
const pendencias = () => readdirSync(dir).filter((n) => n.endsWith(".json")).length;

async function servicoPronto(banco: ReturnType<typeof bancoFalso>, extra: OpcoesDoServico = {}) {
  const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), banco.repo, { ...opcoesBase, ...extra });
  await s.iniciar();
  return s;
}

describe("ordem: outbox ANTES do banco, remoção DEPOIS do COMMIT", () => {
  it("quando o banco é chamado, a pendência já está em disco", async () => {
    let naHora = false;
    const banco = bancoFalso([], () => { naHora = pendente(); });
    const s = await servicoPronto(banco);
    s.partidaEncerrada(partida());
    await s.ocioso();
    expect(naHora).toBe(true);
    expect(pendente()).toBe(false);
  });

  it("uma partida encerrada vira UM crédito, com o mesmo matchId", async () => {
    const banco = bancoFalso();
    const s = await servicoPronto(banco);
    s.partidaEncerrada(partida());
    await s.ocioso();
    expect(banco.chamadas).toEqual(["sondar", `creditar:${PARTIDA}`]);
  });
});

describe("retry e reprocessamento", () => {
  it("erro TRANSITÓRIO: tenta de novo com o MESMO matchId, e só remove depois de confirmar", async () => {
    const banco = bancoFalso();
    const s = await servicoPronto(banco);
    banco.fila.push(ERRO_REDE, ERRO_REDE);
    s.partidaEncerrada(partida());
    await s.ocioso();
    expect(banco.chamadas.filter((c) => c.startsWith("creditar"))).toEqual([`creditar:${PARTIDA}`, `creditar:${PARTIDA}`, `creditar:${PARTIDA}`]);
    expect(pendente()).toBe(false);
    expect(s.estado).toBe("closed");
  });

  it("tentativas esgotadas: a pendência FICA no outbox, e o estado continua closed", async () => {
    const banco = bancoFalso();
    const s = await servicoPronto(banco);
    banco.fila.push(ERRO_REDE, ERRO_REDE, ERRO_REDE);
    s.partidaEncerrada(partida());
    await s.ocioso();
    expect(pendente()).toBe(true);
    expect(s.estado).toBe("closed");
  });

  it("CRASH depois do COMMIT e antes da remoção: o boot reenvia e o banco NÃO soma de novo", async () => {
    const banco = bancoFalso();
    class OutboxQueMorreAoRemover extends OutboxDeProgresso {
      override remover(): void { throw new Error("o processo morreu aqui"); }
    }
    const primeira = new ServicoDeProgresso(new OutboxQueMorreAoRemover(dir), banco.repo, opcoesBase);
    await primeira.iniciar();
    primeira.partidaEncerrada(partida());
    await primeira.ocioso();
    expect(pendente()).toBe(true);

    const segunda = new ServicoDeProgresso(new OutboxDeProgresso(dir), banco.repo, opcoesBase);
    const { estado, balanco } = await segunda.iniciar();
    expect(estado).toBe("closed");
    expect(balanco).toEqual({ entregues: 1, pendentes: 0, corrompidas: [] });
    expect(banco.creditadas.size).toBe(1);
    expect(pendente()).toBe(false);
  });

  it("boot com pendência corrompida: reporta pelo NOME e não apaga", async () => {
    writeFileSync(join(dir, "77777777-7777-4777-8777-777777777777.json"), "{quebrado");
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), bancoFalso().repo, opcoesBase);
    const { balanco } = await s.iniciar();
    expect(balanco?.corrompidas).toEqual(["77777777-7777-4777-8777-777777777777.json"]);
    expect(existsSync(join(dir, "77777777-7777-4777-8777-777777777777.json"))).toBe(true);
  });
});

const TRINTA_S = 30_000;
const vez = () => new Promise((r) => setTimeout(r, 0));
const sondas = (banco: ReturnType<typeof bancoFalso>) => banco.chamadas.filter((c) => c === "sondar").length;

/**
 * Boot com a 1ª sonda RECUSADA (28P01) — o caso medido no Supabase real (4C.1): logo depois de trocar
 * a senha, o pooler recusa a credencial CERTA uma vez. `depois` = o que a confirmação recebe.
 */
async function bootRecusado(depois: Falha[] = []) {
  const t = tempoFalso();
  const banco = bancoFalso([ERRO_AUTENTICACAO, ...depois]);
  const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), banco.repo, { ...opcoesBase, agora: t.agora, agendar: t.agendar });
  const boot = s.iniciar();
  await vez();
  return { t, banco, s, boot };
}

describe("28P01 na sonda do BOOT: UMA confirmação 30 s depois, e acabou", () => {
  it("A · 1ª recusada, confirmação OK → closed; um timer só, e nem um milissegundo antes", async () => {
    const { s, t, banco, boot } = await bootRecusado();
    expect(s.estado).toBe("probing");
    expect(t.pendentes).toBe(1);
    t.avancar(TRINTA_S - 1);
    await vez();
    expect(sondas(banco)).toBe(1);
    t.avancar(1);
    const { estado } = await boot;
    expect(estado).toBe("closed");
    expect(sondas(banco)).toBe(2);
    expect(t.pendentes).toBe(0);
    expect(ESPERA_DA_CONFIRMACAO_MS).toBe(TRINTA_S);
  });

  it("B · 1ª e 2ª recusadas → open_auth DEFINITIVO: nenhum timer, nenhuma tentativa, nem em 24 h", async () => {
    const { s, t, banco, boot } = await bootRecusado([ERRO_AUTENTICACAO]);
    t.avancar(TRINTA_S);
    const { estado, balanco } = await boot;
    expect(estado).toBe("open_auth");
    expect(balanco).toBeNull();
    expect(t.pendentes).toBe(0);
    t.avancar(24 * 60 * 60_000);
    s.partidaEncerrada(outraPartida());
    await s.ocioso();
    expect(banco.toquesNoBanco).toBe(2); // as DUAS do boot — o teto — e nenhuma outra
    const tudo = logs.join("\n");
    expect(tudo).toMatch(/28P01\/autenticacao/);
    expect(tudo).not.toContain("password authentication failed");
  });

  it("C · durante os 30 s, 20 partidas: gravadas na hora, NENHUMA toca o banco", async () => {
    const { s, banco } = await bootRecusado();
    for (let i = 0; i < 20; i++) {
      s.partidaEncerrada(outraPartida());
      expect(pendencias()).toBe(i + 1); // síncrono: a sala não espera a confirmação
    }
    await s.ocioso();
    expect(banco.toquesNoBanco).toBe(1);
    expect(s.estado).toBe("probing");
  });

  it("D · confirmação OK: o outbox dos 30 s é reprocessado, cada partida creditada UMA vez", async () => {
    const { s, t, banco, boot } = await bootRecusado();
    for (let i = 0; i < 20; i++) s.partidaEncerrada(outraPartida());
    t.avancar(TRINTA_S);
    const { estado, balanco } = await boot;
    expect(estado).toBe("closed");
    expect(balanco?.entregues).toBe(20);
    expect(banco.creditadas.size).toBe(20);
    expect(banco.chamadas.filter((c) => c.startsWith("creditar"))).toHaveLength(20);
    expect(pendencias()).toBe(0);
  });

  it("ECIRCUITBREAKER na confirmação → open_circuit, com o cooldown de sempre", async () => {
    const { t, boot } = await bootRecusado([ERRO_DISJUNTOR]);
    t.avancar(TRINTA_S);
    expect((await boot).estado).toBe("open_circuit");
    expect(t.pendentes).toBe(1); // a meia-abertura dos 10 min, e só ela
  });

  it("erro transitório na confirmação: a política transitória do boot — closed, outbox entregue, sem loop", async () => {
    const { s, t, banco, boot } = await bootRecusado([ERRO_REDE]);
    s.partidaEncerrada(partida());
    t.avancar(TRINTA_S);
    const { estado, balanco } = await boot;
    expect(estado).toBe("closed");
    expect(balanco?.entregues).toBe(1);
    expect(sondas(banco)).toBe(2);
    expect(t.pendentes).toBe(0);
  });
});

describe("28P01 FORA da sonda do boot: open_auth imediato, SEM confirmação", () => {
  it("E · no meio de um crédito: open_auth, sem timer e sem segunda tentativa", async () => {
    const t = tempoFalso();
    const banco = bancoFalso();
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), banco.repo, { ...opcoesBase, agora: t.agora, agendar: t.agendar });
    await s.iniciar();
    banco.fila.push(ERRO_AUTENTICACAO);
    s.partidaEncerrada(partida());
    await s.ocioso();
    expect(s.estado).toBe("open_auth");
    expect(t.pendentes).toBe(0);
    t.avancar(TRINTA_S * 10);
    await s.ocioso();
    expect(banco.chamadas).toEqual(["sondar", `creditar:${PARTIDA}`]);
    expect(pendente()).toBe(true);
  });

  it("depois de open_auth, 20 partidas encerradas NÃO tocam o banco — e vão todas para o outbox", async () => {
    const { s, t, banco, boot } = await bootRecusado([ERRO_AUTENTICACAO]);
    t.avancar(TRINTA_S);
    await boot;
    for (let i = 0; i < 20; i++) s.partidaEncerrada(outraPartida());
    await s.ocioso();
    expect(banco.toquesNoBanco).toBe(2);
    expect(pendencias()).toBe(20);
    expect(s.estado).toBe("open_auth");
  });

  it("RESTART com a configuração corrigida: nova sonda, closed, e o outbox acumulado é creditado uma vez", async () => {
    const { s: s1, t, boot } = await bootRecusado([ERRO_AUTENTICACAO]);
    t.avancar(TRINTA_S);
    expect((await boot).estado).toBe("open_auth");
    for (let i = 0; i < 3; i++) s1.partidaEncerrada(outraPartida());
    expect(pendencias()).toBe(3);

    const consertado = bancoFalso();
    const s2 = new ServicoDeProgresso(new OutboxDeProgresso(dir), consertado.repo, opcoesBase);
    const { estado, balanco } = await s2.iniciar();
    expect(estado).toBe("closed");
    expect(balanco?.entregues).toBe(3);
    expect(consertado.creditadas.size).toBe(3);
    expect(pendencias()).toBe(0);
    // replay de novo não duplica
    await s2.reprocessar();
    expect(consertado.creditadas.size).toBe(3);
  });
});

describe("ECIRCUITBREAKER — disjuntor do pooler: open_circuit, cooldown de 10 min, UMA sonda", () => {
  async function aberto(filaDepois: Falha[] = []) {
    const t = tempoFalso();
    const banco = bancoFalso([ERRO_DISJUNTOR]);
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), banco.repo, { ...opcoesBase, agora: t.agora, agendar: t.agendar });
    await s.iniciar();
    banco.fila.push(...filaDepois);
    return { t, banco, s };
  }

  it("na sonda do boot: open_circuit, com UMA sonda agendada para daqui a 10 min", async () => {
    const { s, t } = await aberto();
    expect(s.estado).toBe("open_circuit");
    expect(t.pendentes).toBe(1);
    expect(COOLDOWN_DO_DISJUNTOR_MS).toBe(10 * 60_000);
  });

  it("durante os 10 minutos, NENHUMA partida toca o banco — o outbox acumula", async () => {
    const { s, t, banco } = await aberto();
    const toques = banco.toquesNoBanco;
    for (let min = 0; min < 10; min++) {
      t.avancar(59_000);
      s.partidaEncerrada(outraPartida());
    }
    await s.ocioso();
    expect(banco.toquesNoBanco).toBe(toques);
    expect(pendencias()).toBe(10);
    expect(s.estado).toBe("open_circuit");
  });

  it("vencido o cooldown: EXATAMENTE UMA sonda, mesmo com partidas chegando juntas", async () => {
    const { s, t, banco } = await aberto([ERRO_DISJUNTOR]);
    for (let i = 0; i < 5; i++) s.partidaEncerrada(outraPartida());
    t.avancar(COOLDOWN_DO_DISJUNTOR_MS);
    for (let i = 0; i < 5; i++) s.partidaEncerrada(outraPartida());
    await s.ocioso();
    expect(banco.chamadas.filter((c) => c === "sondar")).toHaveLength(2); // a do boot + UMA de meia-abertura
    expect(banco.chamadas.some((c) => c.startsWith("creditar"))).toBe(false);
  });

  it("sonda de meia-abertura OK: closed, e o outbox acumulado é reprocessado uma vez", async () => {
    const { s, t, banco } = await aberto();
    for (let i = 0; i < 4; i++) s.partidaEncerrada(outraPartida());
    t.avancar(COOLDOWN_DO_DISJUNTOR_MS);
    await s.ocioso();
    expect(s.estado).toBe("closed");
    expect(banco.creditadas.size).toBe(4);
    expect(pendencias()).toBe(0);
  });

  it("nova falha de disjuntor na meia-abertura: reabre por MAIS 10 minutos", async () => {
    const { s, t, banco } = await aberto([ERRO_DISJUNTOR]);
    t.avancar(COOLDOWN_DO_DISJUNTOR_MS);
    await s.ocioso();
    expect(s.estado).toBe("open_circuit");
    expect(t.pendentes).toBe(1);
    const toques = banco.toquesNoBanco;
    t.avancar(COOLDOWN_DO_DISJUNTOR_MS - 1);
    await s.ocioso();
    expect(banco.toquesNoBanco).toBe(toques); // um milissegundo antes, nada
    t.avancar(1);
    await s.ocioso();
    expect(s.estado).toBe("closed");
  });

  it("28P01 na meia-abertura: vira open_auth e PARA de vez — sem a confirmação, que é só do boot", async () => {
    const { s, t, banco } = await aberto([ERRO_AUTENTICACAO]);
    t.avancar(COOLDOWN_DO_DISJUNTOR_MS);
    await s.ocioso();
    expect(s.estado).toBe("open_auth");
    expect(t.pendentes).toBe(0);
    expect(sondas(banco)).toBe(2); // a do boot e a da meia-abertura
    const toques = banco.toquesNoBanco;
    t.avancar(COOLDOWN_DO_DISJUNTOR_MS * 3);
    s.partidaEncerrada(outraPartida());
    await s.ocioso();
    expect(banco.toquesNoBanco).toBe(toques);
  });

  it("erro transitório na meia-abertura: conservador — mais um cooldown, sem martelar", async () => {
    const { s, t } = await aberto([ERRO_REDE]);
    t.avancar(COOLDOWN_DO_DISJUNTOR_MS);
    await s.ocioso();
    expect(s.estado).toBe("open_circuit");
    expect(t.pendentes).toBe(1);
  });

  it("disjuntor no MEIO de um crédito: abre, e as entregas seguintes não furam", async () => {
    const t = tempoFalso();
    const banco = bancoFalso();
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), banco.repo, { ...opcoesBase, agora: t.agora, agendar: t.agendar });
    await s.iniciar();
    banco.fila.push(ERRO_DISJUNTOR);
    s.partidaEncerrada(outraPartida());
    await s.ocioso();
    expect(s.estado).toBe("open_circuit");
    const toques = banco.toquesNoBanco;
    for (let i = 0; i < 20; i++) s.partidaEncerrada(outraPartida());
    await s.ocioso();
    expect(banco.toquesNoBanco).toBe(toques);
    expect(pendencias()).toBe(21);
  });

  it("retry EM ANDAMENTO não fura o disjuntor que outra entrega abriu enquanto ele esperava", async () => {
    const t = tempoFalso();
    let acordar: () => void = () => {};
    const banco = bancoFalso();
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), banco.repo, {
      ...opcoesBase, esperas: [0], agora: t.agora, agendar: t.agendar,
      esperar: () => new Promise<void>((ok) => { acordar = ok; }),
    });
    await s.iniciar();
    const primeira = outraPartida();
    banco.fila.push(ERRO_REDE, ERRO_DISJUNTOR);
    s.partidaEncerrada(primeira);                  // rede caiu: fica esperando para tentar de novo
    await new Promise((r) => setTimeout(r, 0));
    s.partidaEncerrada(outraPartida());            // esta recebe o disjuntor e abre o circuito
    await new Promise((r) => setTimeout(r, 0));
    expect(s.estado).toBe("open_circuit");
    const toques = banco.toquesNoBanco;
    acordar();                                     // a primeira acorda com o circuito aberto
    await s.ocioso();
    expect(banco.toquesNoBanco).toBe(toques);
    expect(pendente(primeira.partidaId)).toBe(true);
  });

  it("dois créditos recebendo o disjuntor ao mesmo tempo abrem UM disjuntor, com UMA sonda agendada", async () => {
    const t = tempoFalso();
    const banco = bancoFalso();
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), banco.repo, { ...opcoesBase, agora: t.agora, agendar: t.agendar });
    await s.iniciar();
    banco.fila.push(ERRO_DISJUNTOR, ERRO_DISJUNTOR);
    s.partidaEncerrada(outraPartida());
    s.partidaEncerrada(outraPartida());
    await s.ocioso();
    expect(t.pendentes).toBe(1);
  });
});

describe("o que nunca vai ao banco, e o que nunca vai ao log", () => {
  it("identidade sorteada (legacy): nada é gravado nem enviado", async () => {
    const banco = bancoFalso();
    const s = await servicoPronto(banco);
    s.partidaEncerrada(partida({ assentos: [humano(0, A, { permanente: false }), bot(1), humano(2, B), bot(3)] }));
    await s.ocioso();
    expect(banco.chamadas).toEqual(["sondar"]);
    expect(pendente()).toBe(false);
  });

  it("os parâmetros da chamada não têm XP: cada humano leva só player_id, posicao e participou", () => {
    const params = parametrosDoCredito({
      partidaId: PARTIDA, iniciadaEm: "2026-09-24T12:00:00.000Z", terminadaEm: "2026-09-24T12:12:00.000Z", bots: 2,
      humanos: [{ playerId: A, posicao: 1, participou: true }, { playerId: B, posicao: 3, participou: false }],
    });
    expect(params.slice(0, 5)).toEqual([PARTIDA, "2026-09-24T12:00:00.000Z", "2026-09-24T12:12:00.000Z", 2, 2]);
    const humanos = JSON.parse(params[5] as string) as Record<string, unknown>[];
    for (const h of humanos) expect(Object.keys(h).sort()).toEqual(["participou", "player_id", "posicao"]);
    expect(params[5]).not.toMatch(/xp/i);
  });

  it("nenhum log leva id inteiro, mensagem do banco, URL ou senha — só código e classe", async () => {
    const senha = "senha-que-nunca-pode-aparecer";
    const vazante = () => Object.assign(new Error(`falhou em postgresql://king_server:${senha}@host:5432/postgres`), { code: "28P01" });
    const banco = bancoFalso([ERRO_REDE, ERRO_REDE]);
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), banco.repo, opcoesBase);
    await s.iniciar(); // sonda com erro transitório
    banco.fila.push(ERRO_REDE, vazante);
    s.partidaEncerrada(partida());
    await s.ocioso();
    const tudo = logs.join("\n");
    expect(tudo).not.toContain(senha);
    expect(tudo).not.toContain("postgresql://");
    expect(tudo).not.toContain(A);
    expect(tudo).toMatch(/28P01\/autenticacao/);
    expect(s.estado).toBe("open_auth");
  });
});

// ─────────────────────── EXPURGO DAS LÁPIDES (Fase 9, E-2) ───────────────────────

const C = "44444444-4444-4444-8444-444444444444";
const MARCADOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERRO_SEM_PERMISSAO = () => Object.assign(new Error("permission denied for function expurgar_lapides"), { code: "42501" });
const ERRO_OUTRO_OUTBOX = () => Object.assign(new Error("o outbox não é o registrado: nada foi expurgado"), { code: "KL001" });
const semSalas = { salasVivas: () => [] as string[] };
const expurgou = (banco: ReturnType<typeof bancoFalso>) => banco.chamadas.filter((c) => c === "expurgar").length;

describe("expurgo das lápides (E-2): o servidor diz o que está em aberto; o prazo é do banco", () => {
  it("sem pendência e sem sala: UMA chamada, com o marcador do diretório e a lista vazia", async () => {
    const banco = bancoFalso();
    const s = await servicoPronto(banco, semSalas);
    const r = await s.expurgarLapides();
    expect(r).toEqual({ desfecho: "expurgado", removidas: 0, retidas: 0 });
    expect(banco.expurgos).toHaveLength(1);
    expect(banco.expurgos[0].protegidas).toEqual([]);
    expect(banco.expurgos[0].marcador).toMatch(MARCADOR);
    expect(readFileSync(join(dir, ".king-outbox"), "utf8").trim()).toBe(banco.expurgos[0].marcador);
    await s.expurgarLapides();
    expect(banco.expurgos[1].marcador).toBe(banco.expurgos[0].marcador); // o mesmo diretório, o mesmo marcador
  });

  it("pendência que NÃO passa protege os jogadores dela; bot e id sorteado ficam de fora", async () => {
    const banco = bancoFalso();
    const s = await servicoPronto(banco, { salasVivas: () => ["bot:1", "", "id-sorteado-da-sala", C.toUpperCase()] });
    banco.fila.push(ERRO_REDE, ERRO_REDE, ERRO_REDE); // o crédito esgota as tentativas: a pendência fica
    s.partidaEncerrada(partida());
    await s.ocioso();
    banco.fila.push(ERRO_REDE); // e a UMA tentativa do reprocesso horário também falha
    await s.expurgarLapides();
    expect(pendente()).toBe(true);
    expect(banco.expurgos.at(-1)!.protegidas).toEqual([A, B, C]); // minúsculas, ordenadas, sem repetição
  });

  it("de hora em hora a pendência ganha UMA tentativa ANTES do retrato: entregue, deixa de proteger", async () => {
    const banco = bancoFalso();
    const s = await servicoPronto(banco, semSalas);
    banco.fila.push(ERRO_REDE, ERRO_REDE, ERRO_REDE);
    s.partidaEncerrada(partida());
    await s.ocioso();
    expect(pendente()).toBe(true);
    const antes = banco.chamadas.filter((c) => c.startsWith("creditar")).length;
    await s.expurgarLapides();
    expect(banco.chamadas.filter((c) => c.startsWith("creditar")).length).toBe(antes + 1); // UMA, sem as esperas
    expect(pendente()).toBe(false);
    expect(banco.expurgos.at(-1)!.protegidas).toEqual([]);
  });

  it("crédito EM VOO protege — mesmo quando o outbox não conseguiu gravar a pendência", async () => {
    class OutboxSemGravar extends OutboxDeProgresso {
      override gravar(): void { throw new Error("disco cheio"); }
    }
    let soltar!: () => void;
    const segurando = new Promise<void>((ok) => { soltar = ok; });
    const banco = bancoFalso([], () => {});
    const repo = { ...banco.repo, async creditar(r: Parameters<typeof banco.repo.creditar>[0]) { await segurando; return banco.repo.creditar(r); } };
    const s = new ServicoDeProgresso(new OutboxSemGravar(dir), repo, { ...opcoesBase, ...semSalas });
    await s.iniciar();
    s.partidaEncerrada(partida());
    expect(pendente()).toBe(false); // sem arquivo: só a memória sabe desta partida
    await s.expurgarLapides();
    expect(banco.expurgos.at(-1)!.protegidas).toEqual([A, B]);
    soltar();
    await s.ocioso();
    await s.expurgarLapides();
    expect(banco.expurgos.at(-1)!.protegidas).toEqual([]);
  });

  it("SALA VIVA protege: quem está no lobby (sem token desde a entrada) não perde a lápide", async () => {
    const banco = bancoFalso();
    const naSala = new Set([C]);
    const s = await servicoPronto(banco, { salasVivas: () => naSala });
    await s.expurgarLapides();
    expect(banco.expurgos.at(-1)!.protegidas).toEqual([C]);
    naSala.clear();
    await s.expurgarLapides();
    expect(banco.expurgos.at(-1)!.protegidas).toEqual([]);
  });

  it("arquivo ilegível no outbox: ADIA, o banco não é chamado, e o log diz por quê", async () => {
    const banco = bancoFalso();
    const s = await servicoPronto(banco, semSalas);
    writeFileSync(join(dir, "77777777-7777-4777-8777-777777777777.json"), "{quebrado");
    const r = await s.expurgarLapides();
    expect(r.desfecho).toBe("adiado");
    expect(expurgou(banco)).toBe(0);
    expect(logs.join("\n")).toMatch(/expurgo das lápides adiado: 1 pendência\(s\) ilegível\(is\) no outbox — nenhum concluído desde o boot/);
  });

  it("outbox AUSENTE: adia — e o expurgo não cria o diretório (vazio não prova nada)", async () => {
    const banco = bancoFalso();
    const ausente = join(dir, "nunca-criado");
    const s = new ServicoDeProgresso(new OutboxDeProgresso(ausente), banco.repo, { ...opcoesBase, ...semSalas });
    await s.iniciar();
    expect((await s.expurgarLapides()).desfecho).toBe("adiado");
    expect(existsSync(ausente)).toBe(false);
    expect(expurgou(banco)).toBe(0);
  });

  it("caminho do outbox que é ARQUIVO, ou marcador estragado: adia", async () => {
    const arquivo = join(dir, "sou-um-arquivo");
    writeFileSync(arquivo, "x");
    const banco = bancoFalso();
    const s1 = new ServicoDeProgresso(new OutboxDeProgresso(arquivo), banco.repo, { ...opcoesBase, ...semSalas });
    await expect(s1.iniciar()).rejects.toThrow(/ENOTDIR/); // o reprocesso do boot já não lê (comportamento de antes)
    expect(s1.estado).toBe("closed");
    const r1 = await s1.expurgarLapides(); // e a rodada do expurgo NÃO lança: rejeição solta derrubaria o jogo
    expect(r1).toMatchObject({ desfecho: "adiado" });
    expect(r1.motivo).toMatch(/o outbox não pôde ser lido \(ENOTDIR/);
    writeFileSync(join(dir, ".king-outbox"), "nao-sou-um-id");
    const s2 = await servicoPronto(banco, semSalas);
    const r2 = await s2.expurgarLapides();
    expect(r2).toMatchObject({ desfecho: "adiado" });
    expect(r2.motivo).toMatch(/KING_MARCADOR/); // o log diz qual foi a dúvida
    expect(expurgou(banco)).toBe(0);
  });

  it("fora de closed (disjuntor aberto, credencial recusada): adia sem tocar o banco", async () => {
    const banco = bancoFalso([ERRO_DISJUNTOR]);
    const s = new ServicoDeProgresso(new OutboxDeProgresso(dir), banco.repo, { ...opcoesBase, ...semSalas, agendar: () => {} });
    await s.iniciar();
    expect(s.estado).toBe("open_circuit");
    const r = await s.expurgarLapides();
    expect(r).toMatchObject({ desfecho: "adiado", motivo: "progresso em open_circuit" });
    expect(expurgou(banco)).toBe(0);
  });

  it("28P01 no expurgo abre open_auth; ECIRCUITBREAKER abre o disjuntor — a mesma regra do crédito", async () => {
    const b1 = bancoFalso();
    const s1 = await servicoPronto(b1, semSalas);
    b1.falhasDoExpurgo.push(ERRO_AUTENTICACAO);
    expect((await s1.expurgarLapides()).desfecho).toBe("falhou");
    expect(s1.estado).toBe("open_auth");
    const b2 = bancoFalso();
    const s2 = await servicoPronto(b2, { ...semSalas, agendar: () => {} });
    b2.falhasDoExpurgo.push(ERRO_DISJUNTOR);
    expect((await s2.expurgarLapides()).desfecho).toBe("falhou");
    expect(s2.estado).toBe("open_circuit");
  });

  it("função revogada (42501), outbox trocado (KL001), rede: falhou, nada sai, o serviço segue closed", async () => {
    const banco = bancoFalso();
    const s = await servicoPronto(banco, semSalas);
    for (const f of [ERRO_SEM_PERMISSAO, ERRO_OUTRO_OUTBOX, ERRO_REDE]) {
      banco.falhasDoExpurgo.push(f);
      expect((await s.expurgarLapides()).desfecho).toBe("falhou");
      expect(s.estado).toBe("closed");
    }
    const tudo = logs.join("\n");
    expect(tudo).toMatch(/expurgo das lápides falhou: 42501\/transitoria — nenhuma lápide saiu/);
    expect(tudo).toMatch(/expurgo das lápides falhou: o outbox não é o registrado no banco/);
    s.partidaEncerrada(partida()); // e o crédito continua normal
    await s.ocioso();
    expect(banco.creditadas.has(PARTIDA)).toBe(true);
  });

  it("iniciarExpurgoDeLapides: uma rodada já, outra a cada hora; ligar de novo não duplica", async () => {
    const t = tempoFalso();
    const banco = bancoFalso();
    const s = await servicoPronto(banco, { ...semSalas, agora: t.agora, agendar: t.agendar });
    s.iniciarExpurgoDeLapides();
    s.iniciarExpurgoDeLapides();
    await s.ocioso();
    expect(expurgou(banco)).toBe(1);
    expect(t.pendentes).toBe(1);
    t.avancar(INTERVALO_DO_EXPURGO_MS - 1);
    await s.ocioso();
    expect(expurgou(banco)).toBe(1);
    t.avancar(1);
    await s.ocioso();
    expect(expurgou(banco)).toBe(2);
    expect(t.pendentes).toBe(1);
  });

  it("rodada pendurada não se sobrepõe nem some: a seguinte adia e diz há quanto tempo", async () => {
    const t = tempoFalso();
    let soltar!: () => void;
    const banco = bancoFalso();
    banco.ganchos.aoExpurgar = () => new Promise<void>((ok) => { soltar = ok; });
    const s = await servicoPronto(banco, { ...semSalas, agora: t.agora, agendar: t.agendar });
    const primeira = s.expurgarLapides();
    await vez();
    t.avancar(90 * 60_000);
    const segunda = await s.expurgarLapides();
    expect(segunda).toMatchObject({ desfecho: "adiado" });
    expect(segunda.motivo).toMatch(/rodada anterior ainda está em andamento há 90 min/);
    soltar();
    expect((await primeira).desfecho).toBe("expurgado");
    expect(expurgou(banco)).toBe(1);
  });

  it("meia-abertura com o outbox ilegível NÃO vira rejeição solta — ela derrubaria o processo do jogo", async () => {
    const t = tempoFalso();
    const banco = bancoFalso();
    const s = await servicoPronto(banco, { ...semSalas, agora: t.agora, agendar: t.agendar });
    banco.fila.push(ERRO_DISJUNTOR);
    s.partidaEncerrada(outraPartida()); // o crédito abre o disjuntor; a meia-abertura fica agendada
    await s.ocioso();
    expect(s.estado).toBe("open_circuit");
    rmSync(dir, { recursive: true, force: true });
    writeFileSync(dir, "agora sou um arquivo"); // o outbox some no meio do cooldown
    t.avancar(COOLDOWN_DO_DISJUNTOR_MS);
    await s.ocioso(); // sem a guarda, aqui o vitest acusaria "Unhandled Rejection"
    expect(s.estado).toBe("closed");
    expect(logs.join("\n")).toMatch(/pendências do outbox não puderam ser lidas: ENOTDIR/);
  });

  it("o boot de produção liga o expurgo nos DOIS desfechos de iniciar(); a sonda de ativação, nunca", () => {
    const indice = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    expect(indice).toMatch(/\.finally\(\(\) => servico\.iniciarExpurgoDeLapides\(\)\)/);
    const sonda = readFileSync(new URL("./sonda.ts", import.meta.url), "utf8");
    expect(sonda).not.toMatch(/iniciarExpurgoDeLapides|\.expurgarLapides\(/);
  });

  it("o log do expurgo só tem contagens: nenhum id de jogador, nenhum marcador", async () => {
    const banco = bancoFalso();
    banco.repo.expurgarLapides = async (marcador, protegidas) => {
      banco.expurgos.push({ marcador, protegidas });
      return { removidas: 2, retidas: 1 };
    };
    const s = await servicoPronto(banco, { salasVivas: () => [C] });
    await s.expurgarLapides();
    const tudo = logs.join("\n");
    expect(tudo).toMatch(/lápides: 2 expurgada\(s\), 1 vencida\(s\) retida\(s\) — ainda em aberto/);
    expect(tudo).toMatch(/expurgo das lápides ativo — 1ª rodada concluída/);
    expect(tudo).not.toContain(C);
    expect(tudo).not.toContain(banco.expurgos[0].marcador);
  });
});
