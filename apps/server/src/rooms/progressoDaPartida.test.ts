// O FIM DA PARTIDA CHEGA AO PROGRESSO — uma vez, com fatos, e só pela transição para `finished`.
//
// Sala REAL, clientes por WebSocket real, partida inteira de 10 mãos. O registrador de progresso
// é trocado por um coletor: aqui se prova o que a SALA entrega (elenco, posições, contagem de
// jogadas, conexão no fim, matchId), não o banco — o banco tem suíte própria em
// `scripts/testar-progresso-sql.mjs`.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { cardId, isKingOfHearts, legalCardsFor, type PlayerView, type Seat, type Trump } from "@king/engine";
import { configurarTempos, restaurarTempos } from "../match/tempos.js";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import { PROTOCOL_VERSION, type AtualizacaoDeEstado, type BoasVindas } from "../protocol/index.js";
import type { KingRoom } from "./KingRoom.js";
import { configurarProgresso, restaurarProgresso } from "../progresso/servico.js";
import type { PartidaEncerrada } from "../progresso/resultado.js";

const SEATS: Seat[] = [0, 1, 2, 3];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRUNFO: Record<number, Trump> = { 7: "hearts", 8: "diamonds", 9: "no-trump", 10: "spades" };

let colyseus: ColyseusTestServer;
let recebidas: PartidaEncerrada[] = [];
/**
 * PENALIDADE DO REI (Entrega C): quem levou a vaza do K♥ na mão 5, OBSERVADO NA MESA (as vazas
 * concluídas do estado autoritativo, no fim da mão 5) — a referência contra a qual o fato que a sala
 * entrega ao progresso (`capturouRei`, lido do histórico do motor) é conferido.
 */
let reiVisto: { winner: Seat; vaza: number } | null = null;

const TEMPOS_LONGOS = {
  pisoDoPlacar: 1, autoReadyDesconectado: 3_600_000, autoReadyConectado: 3_600_000,
  turno: 3_600_000, trunfo: 3_600_000, primeiraJogadaExtra: 0, aberturaDaUltimaMao: 0,
  // As pausas de apresentação atrasam cada prazo automático; aqui se mede contagem, não ritmo.
  leituraDaVaza: 1, leituraDaVazaCastigo: 1, leituraDaVazaKing: 1, fimDeMao: 1, passoDaApresentacao: 1, cortesiaDoBot: 1,
};

beforeAll(async () => { colyseus = await boot(servidor); });
afterAll(async () => { restaurarTempos(); await colyseus.shutdown(); });
beforeEach(async () => {
  await colyseus.cleanup();
  recebidas = [];
  reiVisto = null;
  configurarProgresso({ estado: "closed", partidaEncerrada: (p) => { recebidas.push(p); } });
});
afterEach(() => { restaurarProgresso(); restaurarTempos(); });

async function ate(cond: () => boolean, ms = 20_000, rotulo = "?"): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando: " + rotulo);
    await new Promise((r) => setTimeout(r, 2));
  }
}

interface Cliente {
  seat: Seat;
  sdk: { send: (t: string, m?: unknown) => void; leave: (consentido?: boolean) => Promise<unknown> };
  view: PlayerView | null;
  versao: number;
  matchId: string;
  credencial: string;
}

async function salaCom4(): Promise<{ room: KingRoom; clientes: Cliente[] }> {
  // Entrada pelo MATCHMAKER (create + joinById), como um cliente de verdade — é o caminho que a
  // reconexão por credencial reconhece.
  const clientes: Cliente[] = [];
  let codigo = "";
  for (const seat of SEATS) {
    const opcoes = { protocolVersion: PROTOCOL_VERSION, nick: `P${seat}`, avatar: AVATARES[seat] };
    const sdk = seat === 0 ? await colyseus.sdk.create(SALA_KING, opcoes) : await colyseus.sdk.joinById(codigo, opcoes);
    const c: Cliente = { seat, sdk: sdk as never, view: null, versao: 0, matchId: "", credencial: "" };
    escutar(sdk as never, c);
    await ate(() => c.credencial !== "", 8_000, `welcome P${seat}`);
    if (seat === 0) codigo = c.credencial.split(":")[0];
    clientes.push(c);
  }
  const room = colyseus.getRoomById<KingRoom>(codigo);
  for (const c of clientes) c.sdk.send("CLIENT_SET_READY", { ready: true });
  await ate(() => clientes.every((c) => c.view !== null), 20_000, "partida começar");
  return { room, clientes };
}

type SdkRoom = { onMessage: (t: string, cb: (m: never) => void) => void };
function escutar(sdk: SdkRoom, c: Cliente): void {
  sdk.onMessage("SERVER_WELCOME", (m: BoasVindas) => { c.credencial = m.you.recoveryToken; });
  sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => { c.view = m.view; c.versao = m.stateVersion; c.matchId = m.matchId; });
  for (const t of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "READY_STATE", "TURN_CLOCK", "AUTO_ACTION", "ACTION_REJECTED", "SERVER_ERROR"]) {
    sdk.onMessage(t, () => {});
  }
}

let seq = 0;
const acao = (p: string) => `${p}-${++seq}`;

/**
 * Joga as 10 mãos pelo protocolo. `calado` é um assento que NUNCA envia carta nem trunfo: tudo
 * dele sai por estouro de prazo, pelo mesmo caminho da assistência.
 */
async function jogarAteOFim(
  room: KingRoom,
  clientes: Cliente[],
  calado: Seat | null = null,
  /** Chamado uma vez por mão, antes da 1ª ação dela e antes do "pronto" do fim dela. */
  aoVer?: (momento: "inicio" | "fim", mao: number) => Promise<void>,
  /** Assentos FORA da mesa agora (desconectados): não recebem visão nem mandam nada. */
  ausentes: Set<Seat> = new Set(),
): Promise<void> {
  const vistos = new Set<string>();
  for (let guarda = 0; guarda < 6000; guarda++) {
    const m = room.autoridadeDaPartida().estadoAutoritativo()!;
    if (m.finished) return;
    // Toda ação parte da versão CORRENTE: espera as visões dos PRESENTES alcançarem o servidor, senão
    // a ação sai com versão velha e é recusada como STALE_ACTION.
    const corrente = room.autoridadeDaPartida().stateVersion;
    await ate(() => clientes.every((x) => ausentes.has(x.seat) || x.versao >= corrente), 20_000, "visões alcançarem o servidor");
    const h = m.hand!;
    const momento = h.handScores !== null ? "fim" : "inicio";
    if (aoVer && !vistos.has(`${momento}${h.handNumber}`)) {
      vistos.add(`${momento}${h.handNumber}`);
      await aoVer(momento, h.handNumber);
      continue; // o gancho pode ter mudado a mesa: relê o estado
    }
    if (h.awaitingTrumpFrom !== null) {
      const quem = clientes[h.awaitingTrumpFrom];
      const antes = room.autoridadeDaPartida().stateVersion;
      if (quem.seat !== calado && !ausentes.has(quem.seat)) {
        quem.sdk.send("CLIENT_SELECT_TRUMP", { actionId: acao("t"), trump: TRUNFO[h.handNumber], expectedStateVersion: quem.versao });
      }
      await ate(() => room.autoridadeDaPartida().stateVersion > antes, 20_000, "trunfo");
      continue;
    }
    if (h.handScores !== null) {
      const antes = h.handNumber;
      if (h.handNumber === 5) {
        for (const t of h.completedTricks) {
          if (t.cards.some((p) => isKingOfHearts(p.card))) reiVisto = { winner: t.winner, vaza: t.number };
        }
      }
      for (const c of clientes) if (!ausentes.has(c.seat)) c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: acao(`r${c.seat}`) });
      await ate(() => room.autoridadeDaPartida().estadoAutoritativo()!.handNumber > antes, 20_000, "avanço de mão");
      continue;
    }
    const vez = h.turn as Seat;
    const antes = room.autoridadeDaPartida().stateVersion;
    const c = clientes[vez];
    if (vez !== calado && !ausentes.has(vez)) {
      const legais = legalCardsFor(c.view!, vez);
      c.sdk.send("CLIENT_PLAY_CARD", { actionId: acao(`p${vez}`), cardId: cardId(legais[0]), expectedStateVersion: c.versao });
    }
    await ate(() => room.autoridadeDaPartida().stateVersion > antes, 20_000, "jogada");
  }
  throw new Error("loop de segurança da partida");
}

/**
 * Cartas de cada assento na ÚLTIMA mão, lidas do estado autoritativo. O motor não guarda as vazas
 * das mãos anteriores, então isto é um PISO: a contagem da sala tem de ser pelo menos isto.
 */
function cartasDaUltimaMao(room: KingRoom): number[] {
  const porAssento = [0, 0, 0, 0];
  for (const t of room.autoridadeDaPartida().estadoAutoritativo()!.hand!.completedTricks) {
    for (const p of t.cards) porAssento[p.seat] += 1;
  }
  return porAssento;
}

describe("o fim da partida chega ao progresso", () => {
  it("UMA entrega, com matchId UUID, elenco, posições e 100% das cartas próprias", async () => {
    configurarTempos(TEMPOS_LONGOS);
    const { room, clientes } = await salaCom4();
    await jogarAteOFim(room, clientes);
    await ate(() => recebidas.length > 0, 5_000, "entrega do fim");

    expect(recebidas).toHaveLength(1);
    const p = recebidas[0];
    expect(p.partidaId).toMatch(UUID);
    expect(p.partidaId).toBe(room.autoridadeDaPartida().matchId);
    for (const c of clientes) expect(c.matchId).toBe(p.partidaId); // o cliente recebe o MESMO id
    expect(p.terminadaEm.getTime()).toBeGreaterThan(p.iniciadaEm.getTime());
    expect(Object.keys(p.posicoes).sort()).toEqual(["0", "1", "2", "3"]);
    // RECORDES (Entrega D): a pontuação final de cada assento é a do MOTOR, no fim
    const fim = room.autoridadeDaPartida().estadoAutoritativo()!;
    expect(p.pontos).toEqual({ 0: fim.cumulative[0], 1: fim.cumulative[1], 2: fim.cumulative[2], 3: fim.cumulative[3] });
    // PENALIDADE DO REI (Entrega C): o fato entregue é o vencedor da vaza do K♥ que a MESA viu
    expect(reiVisto).not.toBeNull();
    expect(p.capturouRei).toBe(reiVisto!.winner);
    expect(fim.history.find((x) => x.handNumber === 5)!.handScores[reiVisto!.winner]).toBe(-160);

    const ultimaMao = cartasDaUltimaMao(room);
    for (const a of p.assentos) {
      expect(a.bot).toBe(false);
      expect(a.conectado).toBe(true);
      expect(a.jogadasProprias).toBe(a.jogadasTotais); // ninguém foi ajudado
      expect(a.jogadasTotais).toBeGreaterThanOrEqual(ultimaMao[a.seat]);
    }
    // todo assento jogou o mesmo número de cartas: uma por vaza
    expect(new Set(p.assentos.map((a) => a.jogadasTotais)).size).toBe(1);
    // sem credencial verificada, a identidade é sorteada: nada a gravar, e a sala sabe disso
    expect(p.assentos.every((a) => a.permanente === false)).toBe(true);
  }, 120_000);

  it("estouro de prazo conta no total e NÃO nas próprias; trunfo não entra na conta", async () => {
    configurarTempos({ ...TEMPOS_LONGOS, turno: 250, trunfo: 250 });
    const { room, clientes } = await salaCom4();
    await jogarAteOFim(room, clientes, 3);
    await ate(() => recebidas.length > 0, 5_000, "entrega do fim");
    const calado = recebidas[0].assentos[3];
    const outros = recebidas[0].assentos.slice(0, 3);
    expect(calado.jogadasProprias).toBe(0);
    expect(calado.jogadasTotais).toBe(outros[0].jogadasTotais); // o total conta as cartas automáticas
    expect(calado.jogadasTotais).toBeGreaterThan(100);
    // o K♥ pode ter caído com o assento 3 jogando no AUTOMÁTICO: o fato continua sendo o da mesa
    expect(recebidas[0].capturouRei).toBe(reiVisto!.winner);
  }, 180_000);

  it("PENALIDADE DO REI: cair e voltar NO MEIO da mão 5 não muda o capturador — é o assento que levou a vaza", async () => {
    configurarTempos({ ...TEMPOS_LONGOS, turno: 250, trunfo: 250, autoReadyDesconectado: 250 });
    const { room, clientes } = await salaCom4();
    const fora = new Set<Seat>();
    const c2 = clientes[2];
    await jogarAteOFim(room, clientes, null, async (momento, mao) => {
      if (momento === "inicio" && mao === 5) {
        // o assento 2 cai antes da 1ª carta da mão 5: as cartas dele saem no automático
        (c2.sdk as unknown as { reconnection: { enabled: boolean } }).reconnection.enabled = false;
        fora.add(2);
        await c2.sdk.leave(false);
        await ate(() => !room.state.seats[2].connected, 5_000, "queda registrada");
      }
      if (momento === "fim" && mao === 5) {
        // e volta pela credencial antes da mão 6, a tempo de terminar a partida jogando
        const novo = await colyseus.sdk.reconnect(c2.credencial);
        c2.sdk = novo as never;
        escutar(novo as never, c2);
        await ate(() => room.state.seats[2].connected, 5_000, "reconexão");
        fora.delete(2);
      }
    }, fora);
    await ate(() => recebidas.length > 0, 5_000, "entrega do fim");
    const p = recebidas[0];
    expect(reiVisto).not.toBeNull();
    expect(p.capturouRei).toBe(reiVisto!.winner);
    expect(p.assentos[2].conectado).toBe(true);
    expect(p.assentos[2].jogadasProprias).toBeLessThan(p.assentos[2].jogadasTotais); // houve automático
  }, 180_000);

  it("reconexão, pedido de próxima mão e ação repetida DEPOIS do fim não entregam de novo", async () => {
    configurarTempos(TEMPOS_LONGOS);
    const { room, clientes } = await salaCom4();
    await jogarAteOFim(room, clientes);
    await ate(() => recebidas.length === 1, 5_000, "entrega do fim");

    const c0 = clientes[0];
    // O SDK 0.17 RELIGA SOZINHO um socket que caiu depois de ~5 s de conexão — e, religado, o
    // `leave(false)` fica esperando um fechamento que nunca chega. Numa partida inteira a conexão
    // passa disso com folga. A religação automática sai de cena para a queda ser controlada aqui.
    (c0.sdk as unknown as { reconnection: { enabled: boolean } }).reconnection.enabled = false;
    await c0.sdk.leave(false);
    await ate(() => !room.state.seats[0].connected, 5_000, "queda registrada");
    const novo = await colyseus.sdk.reconnect(c0.credencial);
    escutar(novo as never, c0);
    await ate(() => room.state.seats[0].connected, 5_000, "reconexão");
    novo.send("CLIENT_READY_NEXT_HAND", { actionId: acao("depois") });
    clientes[1].sdk.send("CLIENT_PLAY_CARD", { actionId: acao("tarde"), cardId: "AS", expectedStateVersion: 0 });
    await new Promise((r) => setTimeout(r, 300));

    expect(recebidas).toHaveLength(1);
  }, 120_000);

  it("com o PROGRESSO QUEBRADO, a partida termina e a mesa segue — XP nunca é pedágio do jogo", async () => {
    configurarTempos(TEMPOS_LONGOS);
    let chamadas = 0;
    configurarProgresso({
      estado: "open_auth",
      partidaEncerrada: () => { chamadas += 1; throw new Error("o progresso caiu"); },
    });
    const { room, clientes } = await salaCom4();
    await jogarAteOFim(room, clientes);
    await ate(() => clientes.every((c) => c.view?.finished === true), 10_000, "clientes verem o fim");
    expect(chamadas).toBe(1);
    expect(room.state.status).toBe("finished");
    expect(room.state.seats.every((a) => a.connected)).toBe(true);
    // a sala continua respondendo depois do fim: um pedido fora de hora é recusado, não derruba nada
    clientes[1].sdk.send("CLIENT_READY_NEXT_HAND", { actionId: acao("depois-do-fim") });
    await new Promise((r) => setTimeout(r, 200));
    expect(room.state.seats.every((a) => a.connected)).toBe(true);
  }, 120_000);

  it("o protocolo continua na versão 3", () => {
    expect(PROTOCOL_VERSION).toBe(3);
  });
});
