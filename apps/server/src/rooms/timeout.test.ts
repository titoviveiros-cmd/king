// FASE 7 — RELÓGIO AUTORITATIVO, TIMEOUT E ASSISTÊNCIA TEMPORÁRIA.
//
// DISCIPLINA DE TEMPO DESTA SUÍTE — aprendida errando:
//
// 1. O padrão é prazo LONGO. Com prazo curto no `beforeEach`, a partida inteira se auto-joga ao
//    fundo de todo teste, inundando o socket e derrubando asserções por exaustão.
// 2. Cada teste encurta SÓ o prazo de que precisa, e **antes** da ação que agenda a decisão —
//    o relógio é armado no instante da mutação autoritativa, não depois.
// 3. Tudo passa pelo PROTOCOLO. Dirigir a autoridade direto pula o `#publicar` da Room, e então
//    o relógio nunca é agendado nem o fim da mão é registrado.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { cardId, legalCardsFor, type Card, type PlayerView, type Rank, type Seat, type Suit } from "@king/engine";
import { configurarTempos, restaurarTempos, TEMPOS, TEMPOS_PADRAO } from "../match/tempos.js";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import {
  PROTOCOL_VERSION,
  type AcaoAutomatica, type AcaoRecusada, type AtualizacaoDeEstado,
  type BoasVindas, type RelogioDaDecisao,
} from "../protocol/index.js";
import { ASSENTOS, type KingRoom } from "./KingRoom.js";
import { normalizarCodigo } from "./codigos.js";

const SEATS: Seat[] = [0, 1, 2, 3];
const soma = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
const HORA = 3_600_000;

/** Padrão: nada estoura sozinho. Cada teste encurta o que quiser exercitar. */
const PARADO = {
  turno: HORA, primeiraJogadaExtra: 0, trunfo: HORA,
  aviso: 60_000, critico: 30_000, pisoDoPlacar: 1,
  autoReadyDesconectado: HORA, autoReadyConectado: HORA,
  cortesiaDoBot: 5, lobbyReservaAposQueda: HORA, salaOrfa: HORA,
};

let colyseus: ColyseusTestServer;
beforeAll(async () => { colyseus = await boot(servidor); });
afterAll(async () => { await colyseus.shutdown(); });
beforeEach(async () => { proximoAvatar = 0; configurarTempos(PARADO); await colyseus.cleanup(); });
afterEach(() => restaurarTempos());

async function ate(cond: () => boolean, ms = 10_000, rotulo = "?"): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando: " + rotulo);
    await new Promise((r) => setTimeout(r, 1));
  }
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cartasEm(x: unknown, achadas: Card[] = []): Card[] {
  if (x === null || typeof x !== "object") return achadas;
  if (Array.isArray(x)) { for (const i of x) cartasEm(i, achadas); return achadas; }
  const o = x as Record<string, unknown>;
  if (typeof o.suit === "string" && typeof o.rank === "string") {
    achadas.push({ suit: o.suit as Suit, rank: o.rank as Rank }); return achadas;
  }
  for (const v of Object.values(o)) cartasEm(v, achadas);
  return achadas;
}

interface AssentoView { seat: number; playerId: string; nick: string; connected: boolean; ready: boolean; assisted: boolean }
interface SalaView { roomCode: string; status: string; seats: AssentoView[]; toJSON(): unknown }
interface SdkRoom {
  roomId: string; state: SalaView; reconnectionToken: string;
  send(t: string, m?: unknown): void;
  onMessage(t: string, cb: (...a: never[]) => void): void;
  leave(consented?: boolean): Promise<number>;
}
interface Cliente {
  sdk: SdkRoom; seat: Seat; credencial: string;
  boasVindas: BoasVindas | null; view: PlayerView | null; versao: number;
  rejeicoes: AcaoRecusada[]; relogios: RelogioDaDecisao[]; automaticas: AcaoAutomatica[];
}

function escutar(sdk: SdkRoom, base?: Cliente): Cliente {
  const c: Cliente = base ?? {
    sdk, seat: 0 as Seat, credencial: "", boasVindas: null, view: null, versao: 0,
    rejeicoes: [], relogios: [], automaticas: [],
  };
  c.sdk = sdk;
  sdk.onMessage("SERVER_WELCOME", (m: BoasVindas) => {
    c.boasVindas = m; c.seat = m.you.seat; c.credencial = m.you.recoveryToken;
  });
  sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => { c.view = m.view; c.versao = m.stateVersion; });
  sdk.onMessage("ACTION_REJECTED", (m: AcaoRecusada) => c.rejeicoes.push(m));
  sdk.onMessage("TURN_CLOCK", (m: RelogioDaDecisao) => c.relogios.push(m));
  sdk.onMessage("AUTO_ACTION", (m: AcaoAutomatica) => c.automaticas.push(m));
  return c;
}

/**
 * UM BICHO DIFERENTE PARA CADA HUMANO, por padrão.
 *
 * Desde que avatar ocupado virou identidade PENDENTE, dois humanos pedindo o mesmo avatar não
 * começam partida nenhuma — e é essa a regra, não um defeito. Um cliente de verdade resolve isso
 * no lobby; um teste que não resolve fica esperando um "iniciou" que nunca vem.
 *
 * O contador zera a cada teste, então a distribuição é determinística dentro de cada um. Quem
 * quer exercitar o conflito passa o avatar explicitamente.
 */
let proximoAvatar = 0;
const avatarDeTeste = () => AVATARES[proximoAvatar++ % AVATARES.length];

const opcoes = (nick: string) =>
  ({ protocolVersion: PROTOCOL_VERSION, nick, avatar: avatarDeTeste() });

async function salaCheia(): Promise<{ room: KingRoom; todos: Cliente[] }> {
  const dono = escutar((await colyseus.sdk.create(SALA_KING, opcoes("P0"))) as unknown as SdkRoom);
  await ate(() => dono.boasVindas !== null, 10_000, "welcome P0");
  const codigo = dono.boasVindas!.roomCode;
  const todos = [dono];
  for (let i = 1; i < ASSENTOS; i++) {
    const c = escutar((await colyseus.sdk.joinById(normalizarCodigo(codigo), opcoes(`P${i}`))) as unknown as SdkRoom);
    await ate(() => c.boasVindas !== null, 10_000, `welcome P${i}`);
    todos.push(c);
  }
  return { room: colyseus.getRoomById<KingRoom>(codigo), todos };
}

const versao = (room: KingRoom) => room.autoridadeDaPartida().stateVersion;
const real = (room: KingRoom) => room.autoridadeDaPartida().estadoAutoritativo()!;

async function iniciar(todos: Cliente[]): Promise<void> {
  for (const c of todos) c.sdk.send("CLIENT_SET_READY", { ready: true });
  await ate(() => todos.every((c) => c.view !== null), 10_000, "início");
}

/** Quem é a vez segundo o SERVIDOR, com a visão daquele cliente já alcançada. */
async function daVez(room: KingRoom, todos: Cliente[]): Promise<Cliente> {
  const s = real(room).hand!.turn as Seat;
  const c = todos[s];
  // exigir a VERSÃO, não só o turno: uma visão antiga pode ter o mesmo turno e cartas diferentes
  await ate(() => c.versao === versao(room) && c.view?.hand?.turn === c.seat, 10_000, "visão alcançar o turno " + s);
  return c;
}

let seq = 0;
async function jogarUma(room: KingRoom, todos: Cliente[]): Promise<void> {
  const c = await daVez(room, todos);
  const v = versao(room);
  c.sdk.send("CLIENT_PLAY_CARD", { actionId: `h${++seq}`, cardId: cardId(legalCardsFor(c.view!, c.seat)[0]) });
  await ate(() => versao(room) > v, 10_000, "jogada humana");
}

/** Termina a mão corrente PELO PROTOCOLO — é o que faz a Room registrar o fim e armar o relógio. */
async function terminarMao(room: KingRoom, todos: Cliente[]): Promise<void> {
  let guarda = 0;
  while (real(room).hand!.handScores === null) {
    if (++guarda > 200) throw new Error("loop ao terminar a mão");
    await jogarUma(room, todos);
  }
}

const cair = async (c: Cliente) => { await c.sdk.leave(false); };
async function voltar(c: Cliente): Promise<void> {
  c.boasVindas = null;
  escutar((await colyseus.sdk.reconnect(c.credencial)) as unknown as SdkRoom, c);
  await ate(() => c.boasVindas !== null, 10_000, "welcome do retorno");
}

function exigirVisaoLimpa(v: PlayerView, seat: Seat): void {
  expect(v.redactedFor).toBe(seat);
  expect(v.seed).toBe(0);
  const proprias = new Set(v.hand ? v.hand.hands[seat].map(cardId) : []);
  const publicas = new Set<string>();
  if (v.hand) {
    for (const t of v.hand.completedTricks) for (const p of t.cards) publicas.add(cardId(p.card));
    for (const p of v.hand.currentTrick) publicas.add(cardId(p.card));
  }
  for (const c of cartasEm(v)) {
    const id = cardId(c);
    expect(proprias.has(id) || publicas.has(id), `carta ${id} na visão de ${seat}`).toBe(true);
  }
  for (const o of SEATS) if (o !== seat) expect(v.hand?.hands[o] ?? []).toEqual([]);
}

// ═══════════════ tokens de produto ═══════════════

describe("tokens de tempo — decisões D2/D4/D5/D6", () => {
  it("os valores de produto são exatamente os aprovados", () => {
    expect(TEMPOS_PADRAO.turno).toBe(25_000);
    expect(TEMPOS_PADRAO.primeiraJogadaExtra).toBe(15_000);
    expect(TEMPOS_PADRAO.turno + TEMPOS_PADRAO.primeiraJogadaExtra).toBe(40_000);
    expect(TEMPOS_PADRAO.trunfo).toBe(45_000);
    expect(TEMPOS_PADRAO.aviso).toBe(10_000);
    expect(TEMPOS_PADRAO.critico).toBe(5_000);
    expect(TEMPOS_PADRAO.pisoDoPlacar).toBe(8_000);
    expect(TEMPOS_PADRAO.autoReadyDesconectado).toBe(20_000);
    expect(TEMPOS_PADRAO.autoReadyConectado).toBe(45_000);
    expect(TEMPOS_PADRAO.lobbyReservaAposQueda).toBe(60_000);
    expect(TEMPOS_PADRAO.salaOrfa).toBe(120_000);
  });

  it("restaurarTempos devolve exatamente os valores de produto", () => {
    configurarTempos({ turno: 1 });
    expect(TEMPOS.turno).toBe(1);
    restaurarTempos();
    expect(TEMPOS).toEqual(TEMPOS_PADRAO);
  });
});

// ═══════════════ 1/2/3 — turno de quem está conectado ═══════════════

describe("1/2/3 · turno de quem está conectado", () => {
  it("o relógio anuncia NORMAL, WARNING e CRITICAL antes de estourar", async () => {
    const { todos } = await salaCheia();
    configurarTempos({ turno: 600, aviso: 400, critico: 200 });
    await iniciar(todos);

    await ate(() => todos[0].relogios.some((r) => r.fase === "CRITICAL"), 10_000, "fase crítica");
    configurarTempos({ turno: HORA });

    const fases = todos[0].relogios.map((r) => r.fase);
    expect(fases[0]).toBe("NORMAL");
    expect(fases).toContain("WARNING");
    expect(fases).toContain("CRITICAL");
    for (const r of todos[0].relogios) {
      expect(r.tipo).toBe("PLAY");
      expect(r.restanteMs).toBeGreaterThanOrEqual(0);
      expect(r.restanteMs).toBeLessThanOrEqual(600);
    }
  }, 20_000);

  it("2/3 · expira → Bot Normal joga UMA carta; conectado NÃO entra em modo bot", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ turno: 250 });
    await iniciar(todos);
    const v0 = versao(room);
    const primeiro = todos[real(room).hand!.turn as Seat];
    const maoAntes = primeiro.view!.hand!.hands[primeiro.seat].map(cardId);

    await ate(() => versao(room) > v0, 10_000, "ação automática");
    configurarTempos({ turno: HORA });
    await dormir(60);

    const auto = primeiro.automaticas.find((a) => a.seat === primeiro.seat && a.tipo === "PLAY")!;
    expect(auto).toBeDefined();
    expect(auto.assistido).toBe(false);                       // conectado: assistência NÃO é contínua
    expect(room.state.seats[primeiro.seat].assisted).toBe(false);

    const depois = primeiro.view!.hand!.hands[primeiro.seat].map(cardId);
    expect(maoAntes.length - depois.length).toBe(1);          // exatamente UMA carta
    for (const x of todos) exigirVisaoLimpa(x.view!, x.seat);
  }, 20_000);
});

// ═══════════════ 9/10/11 — humano no limite e corrida ═══════════════

describe("9/10/11 · humano no limite e corrida com o timeout", () => {
  it("9 · ação humana a tempo aplica e o timeout não age", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ turno: 3000 });
    await iniciar(todos);
    const v0 = versao(room);

    await jogarUma(room, todos);
    configurarTempos({ turno: HORA });

    expect(versao(room)).toBe(v0 + 1);
    expect(todos.flatMap((c) => c.automaticas)).toHaveLength(0);
  }, 20_000);

  it("10/11 · humano e timeout no mesmo instante: UMA e somente uma ação é aplicada", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ turno: 300 });
    await iniciar(todos);
    const c = await daVez(room, todos);
    const v0 = versao(room);
    const carta = cardId(legalCardsFor(c.view!, c.seat)[0]);

    // envia exatamente quando o prazo estoura, e congela o relógio em seguida para que nenhuma
    // OUTRA decisão expire e polua a contagem
    await dormir(300);
    c.sdk.send("CLIENT_PLAY_CARD", { actionId: "no-limite", cardId: carta });
    configurarTempos({ turno: HORA });
    await dormir(200);

    expect(versao(room)).toBe(v0 + 1);                 // exatamente uma ação
    expect(real(room).hand!.currentTrick).toHaveLength(1);
    // ou o bot venceu (e o humano foi recusado), ou o humano venceu (e o bot ficou inerte)
    const agiuOBot = c.automaticas.some((a) => a.seat === c.seat);
    const humanoRecusado = c.rejeicoes.length > 0;
    expect(agiuOBot).toBe(humanoRecusado);
  }, 20_000);
});

// ═══════════════ 4/5/6/25/26/27/28/29 — ausência e assistência ═══════════════

describe("4/5/6/25 · queda no turno e assistência contínua", () => {
  it("5 · cair não pausa, não reinicia e não estende o prazo", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ turno: 700 });
    await iniciar(todos);
    const c = await daVez(room, todos);
    const v0 = versao(room);

    await dormir(450);           // a maior parte do prazo já correu
    await cair(c);
    const t0 = Date.now();
    await ate(() => versao(room) > v0, 10_000, "ação automática");
    const decorrido = Date.now() - t0;   // medido no ESTADO: é ele que carrega o prazo
    configurarTempos({ turno: HORA, cortesiaDoBot: HORA });

    // se a queda tivesse reiniciado o prazo, teria levado ~700ms DEPOIS dela
    expect(decorrido).toBeLessThan(600);
    expect(room.state.seats[c.seat].assisted).toBe(true);   // ausente → assistência contínua

    // a mensagem trafega DEPOIS de o estado mudar: esperar por ela, não pela versão
    const outro = todos.find((x) => x !== c)!;
    await ate(
      () => outro.automaticas.some((a) => a.seat === c.seat && a.tipo === "PLAY"),
      10_000, "AUTO_ACTION do assento ausente",
    );
    expect(outro.automaticas.find((a) => a.seat === c.seat)!.assistido).toBe(true);
  }, 20_000);

  it("6/25 · ausente prolongado: várias ações automáticas seguidas, todas legais", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ turno: 150, cortesiaDoBot: 10 });
    await iniciar(todos);
    const c = await daVez(room, todos);
    await cair(c);
    await ate(() => room.state.seats[c.seat].assisted === true, 10_000, "assistido");

    const v0 = versao(room);
    await ate(() => versao(room) >= v0 + 8, 10_000, "várias automáticas");
    configurarTempos({ turno: HORA, cortesiaDoBot: HORA });
    await dormir(60);

    const r = real(room);
    const jogadas = r.hand!.completedTricks.flatMap((t) => t.cards);
    expect(new Set(jogadas.map((p) => cardId(p.card))).size).toBe(jogadas.length); // nenhuma repetida
    for (const t of r.hand!.completedTricks) expect(t.cards).toHaveLength(4);
    for (const x of todos.filter((y) => y !== c)) exigirVisaoLimpa(x.view!, x.seat);
  }, 30_000);

  it("7/8/26/27/28/29 · o humano volta, retoma o controle e nada é desfeito", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ turno: 150, cortesiaDoBot: 10 });
    await iniciar(todos);
    const c = await daVez(room, todos);
    const playerId = c.boasVindas!.you.playerId;
    await cair(c);
    await ate(() => room.state.seats[c.seat].assisted === true, 10_000, "assistido");

    const v0 = versao(room);
    await ate(() => versao(room) >= v0 + 6, 10_000, "várias automáticas");
    configurarTempos({ turno: HORA, cortesiaDoBot: HORA });
    await dormir(60);
    const cumulativo = [...real(room).cumulative];
    const vAntesDoRetorno = versao(room);

    await voltar(c);

    expect(c.boasVindas!.you.seat).toBe(c.seat);              // 27 · mesmo assento
    expect(c.boasVindas!.you.playerId).toBe(playerId);        // mesma identidade
    expect(room.state.seats[c.seat].assisted).toBe(false);    // assistência termina no retorno
    expect(versao(room)).toBe(vAntesDoRetorno);              // nada foi desfeito nem refeito
    expect(real(room).cumulative).toEqual(cumulativo);        // 28 · score intacto
    exigirVisaoLimpa(c.view!, c.seat);                        // 17/29
  }, 30_000);

  it("13/14 · reconectar, várias vezes, não empurra o prazo", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ turno: 1200 });
    await iniciar(todos);
    const c = await daVez(room, todos);
    const v0 = versao(room);
    const t0 = Date.now();

    for (let i = 0; i < 3; i++) { await cair(c); await voltar(c); }
    await ate(() => versao(room) > v0, 10_000, "ação automática");
    configurarTempos({ turno: HORA, cortesiaDoBot: HORA });

    // três ciclos de queda/retorno não somaram tempo ao prazo original
    expect(Date.now() - t0).toBeLessThan(1200 + 900);
  }, 20_000);
});

// ═══════════════ 18/19/20 — READY e piso do Placar ═══════════════

describe("18/19/20 · auto-ready e piso do Placar", () => {
  it("20 · o Placar não some antes do piso, mesmo com os quatro prontos na hora", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ pisoDoPlacar: 500 });
    await iniciar(todos);
    await terminarMao(room, todos);

    const t0 = Date.now();
    for (const c of todos) c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: `p${c.seat}` });
    await ate(() => real(room).handNumber === 2, 10_000, "mão 2");
    configurarTempos({ pisoDoPlacar: 1 });

    expect(Date.now() - t0).toBeGreaterThanOrEqual(400); // o piso foi respeitado
    expect(real(room).history).toHaveLength(1);          // UM avanço só
  }, 40_000);

  it("18 · desconectado vira pronto sozinho e a partida segue", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ autoReadyDesconectado: 200 });
    await iniciar(todos);
    await terminarMao(room, todos);

    const ausente = todos[2];
    await cair(ausente);
    for (const c of todos.filter((x) => x !== ausente)) {
      c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: `q${c.seat}` });
    }
    await ate(() => real(room).handNumber === 2, 10_000, "mão 2");
    configurarTempos({ autoReadyDesconectado: HORA });

    // espera o EVENTO, não a versão: a mensagem chega depois de o estado mudar
    await ate(
      () => todos[0].automaticas.some((a) => a.tipo === "READY" && a.seat === ausente.seat && a.assistido),
      10_000, "AUTO_ACTION READY do ausente",
    );
    expect(real(room).history).toHaveLength(1); // UM avanço só
  }, 40_000);

  it("19 · conectado que não confirma também vira pronto, mas só depois do prazo maior", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ autoReadyConectado: 300 });
    await iniciar(todos);
    await terminarMao(room, todos);

    const t0 = Date.now();
    // ninguém confirma: só o auto-ready de conectado destrava
    await ate(() => real(room).handNumber === 2, 10_000, "mão 2 por auto-ready");
    const decorrido = Date.now() - t0;
    configurarTempos({ autoReadyConectado: HORA });

    expect(decorrido).toBeGreaterThanOrEqual(250);
    expect(real(room).history).toHaveLength(1);

    // os quatro AUTO_ACTION de READY chegam depois do avanço: esperar por eles
    await ate(
      () => todos[0].automaticas.filter((a) => a.tipo === "READY").length === ASSENTOS,
      10_000, "os quatro AUTO_ACTION de READY",
    );
    const autos = todos[0].automaticas.filter((a) => a.tipo === "READY");
    expect(autos.every((a) => a.assistido === false)).toBe(true); // todos estavam conectados
  }, 40_000);
});

// ═══════════════ 21/22/23/24 — Lobby e sala órfã ═══════════════

describe("21/22/23/24 · Lobby e sala órfã", () => {
  it("21/22 · queda no lobby reserva o assento e voltar a tempo o recupera", async () => {
    const { room, todos } = await salaCheia();
    const c = todos[1];
    const playerId = c.boasVindas!.you.playerId;

    await cair(c);
    await ate(() => room.state.seats[1].connected === false, 10_000, "desconectado");
    expect(room.state.seats[1].playerId).toBe(playerId);

    await voltar(c);
    expect(room.state.seats[1].playerId).toBe(playerId);
    expect(c.boasVindas!.you.seat).toBe(1);
  }, 20_000);

  it("23 · passado o prazo, o assento é liberado, o ready some e a sala não inicia", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ lobbyReservaAposQueda: 200 });
    todos[1].sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => room.state.seats[1].ready === true, 10_000, "pronto");

    await cair(todos[1]);
    await ate(() => room.state.seats[1].playerId === "", 10_000, "assento liberado");
    configurarTempos({ lobbyReservaAposQueda: HORA });

    expect(room.state.seats[1].ready).toBe(false);
    expect(room.state.seats[1].nick).toBe("");
    expect(room.state.status).toBe("lobby"); // não iniciou sozinha nem entrou bot
  }, 20_000);

  it("24 · sala sem ninguém expira", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ salaOrfa: 250 });
    const id = room.roomId;
    for (const c of todos) await cair(c);
    await ate(() => colyseus.getRoomById(id) === undefined, 10_000, "sala expirada");
    expect(colyseus.getRoomById(id)).toBeUndefined();
  }, 20_000);
});

// ═══════════════ 15/16/17 — trunfo automático ═══════════════

describe("15/16/17 · SELECT_TRUMP automático", () => {
  it("o Bot Normal escolhe com a própria mão, dentro do domínio oficial", async () => {
    const { room, todos } = await salaCheia();
    // o prazo do trunfo precisa estar curto ANTES de a fase chegar: o relógio é armado na
    // mutação que cria a decisão, não depois
    configurarTempos({ trunfo: 500 });
    await iniciar(todos);

    // chega à fase de trunfo PELO PROTOCOLO — é o que mantém o relógio da Room em dia
    let guarda = 0;
    while (real(room).hand!.awaitingTrumpFrom === null) {
      if (++guarda > 20) throw new Error("não chegou à fase de trunfo");
      await terminarMao(room, todos);
      const antes = real(room).handNumber;
      for (const c of todos) c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: `n${++seq}` });
      await ate(() => real(room).handNumber > antes, 10_000, "avanço da mão " + antes);
      await ate(() => todos.every((c) => c.view!.handNumber > antes), 10_000, "clientes na mão nova");
    }

    const escolhedor = real(room).hand!.awaitingTrumpFrom as Seat;
    const maoDele = real(room).hand!.hands[escolhedor].map(cardId);
    const esperado = room.autoridadeDaPartida().trunfoAutomatico(escolhedor);
    const v0 = versao(room);

    // o prazo do trunfo estoura e o servidor escolhe — esperar o EVENTO, que é o que se afirma
    await ate(() => versao(room) > v0, 15_000, "trunfo automático");
    await ate(
      () => todos[0].automaticas.some((a) => a.tipo === "TRUMP"),
      15_000, "AUTO_ACTION de TRUMP",
    );
    configurarTempos({ trunfo: HORA, turno: HORA });

    const trump = real(room).hand!.trump;
    expect(["spades", "hearts", "diamonds", "clubs", "no-trump"]).toContain(trump);
    expect(trump).toBe(esperado);                                       // determinístico
    expect(real(room).hand!.hands[escolhedor].map(cardId)).toEqual(maoDele); // 16 · só a própria mão
    const auto = todos[0].automaticas.find((a) => a.tipo === "TRUMP")!;
    expect(auto).toMatchObject({ seat: escolhedor, tipo: "TRUMP" });
    for (const x of todos) exigirVisaoLimpa(x.view!, x.seat);           // 17
  }, 180_000);
});

// ═══════════════ 31/32/33/34 — timers inertes e GAME OVER ═══════════════

describe("31/32/33/34 · timers inertes e GAME OVER", () => {
  it("31/34 · timer de decisão vencida não age sobre o estado novo", async () => {
    const { room, todos } = await salaCheia();
    configurarTempos({ turno: 2000 });
    await iniciar(todos);

    // seis jogadas humanas rápidas: cada uma invalida o timer da anterior
    for (let i = 0; i < 6; i++) await jogarUma(room, todos);
    configurarTempos({ turno: HORA });
    const vDepois = versao(room);
    await dormir(400); // muito além do que restava dos timers antigos

    expect(versao(room)).toBe(vDepois);   // nenhum timer velho agiu
    expect(versao(room)).toBe(7);         // 1 (início) + 6 jogadas
    const r = real(room);
    const naMesa = r.hand!.completedTricks.flatMap((t) => t.cards).length + r.hand!.currentTrick.length;
    expect(naMesa).toBe(6);
    expect(todos.flatMap((c) => c.automaticas)).toHaveLength(0);
  }, 30_000);

  it("32/33/30 · depois do GAME OVER nenhum timer age, não há M11 e o checksum fica", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);

    let guarda = 0;
    while (!real(room).finished) {
      if (++guarda > 40) throw new Error("partida não terminou");
      const h = real(room).hand!;
      if (h.awaitingTrumpFrom !== null) {
        const e = todos[h.awaitingTrumpFrom];
        const v = versao(room);
        e.sdk.send("CLIENT_SELECT_TRUMP", { actionId: `t${++seq}`, trump: "spades" });
        await ate(() => versao(room) > v, 10_000, "trunfo");
        continue;
      }
      await terminarMao(room, todos);
      if (real(room).finished) break;
      const antes = real(room).handNumber;
      for (const c of todos) c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: `w${++seq}` });
      await ate(() => real(room).handNumber > antes, 10_000, "avanço " + antes);
      await ate(() => todos.every((c) => c.view!.handNumber > antes), 10_000, "clientes na mão nova");
    }

    const vFinal = versao(room);
    // encurta TUDO: se algum timer sobrevivesse ao fim, agiria agora
    configurarTempos({ turno: 60, trunfo: 60, autoReadyConectado: 60, autoReadyDesconectado: 60, pisoDoPlacar: 1 });
    await dormir(500);

    expect(versao(room)).toBe(vFinal);                 // 32 · nenhum timer agiu
    expect(real(room).handNumber).toBe(10);            // 33 · sem M11
    expect(real(room).history).toHaveLength(10);
    expect(soma(real(room).cumulative)).toBe(0);       // 30 · checksums intactos
    expect(soma(real(room).negatives)).toBe(-1300);
    expect(soma(real(room).positives)).toBe(1300);
    expect(room.state.status).toBe("finished");
  }, 180_000);
});
