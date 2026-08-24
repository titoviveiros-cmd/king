// TESTES DA FASE 2 — bootstrap, lifecycle, assentos e a fronteira anti-vazamento.
//
// Usa o `@colyseus/testing` oficial: sobe o MESMO servidor definido em `app.ts` (não uma cópia de
// teste) e conecta clientes reais por WebSocket. Nada de mock do framework.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { Card, Rank, Suit } from "@king/engine";
import { configurarTempos, restaurarTempos } from "../match/tempos.js";
import { SALA_KING, servidor } from "../app.js";
import { CODIGO, PROTOCOL_VERSION, type BoasVindas, type EventoDeJogador } from "../protocol/index.js";
import { ASSENTOS, type KingRoom } from "./KingRoom.js";

const entrada = (nick?: string) => ({ protocolVersion: PROTOCOL_VERSION, nick });

let colyseus: ColyseusTestServer;

// Estes testes exercitam PROTOCOLO, não prazos. Sem encurtar o piso do Placar e os timeouts,
// cada avanço de mão custaria 8s reais e um turno lento viraria ação automática no meio do
// roteiro. Os prazos em si têm suíte própria (timeout.test.ts).
beforeAll(async () => {
  configurarTempos({ pisoDoPlacar: 1, autoReadyDesconectado: 3_600_000, autoReadyConectado: 3_600_000, turno: 3_600_000, trunfo: 3_600_000, primeiraJogadaExtra: 0 });
  colyseus = await boot(servidor);
});
afterAll(() => restaurarTempos());
afterAll(async () => { await colyseus.shutdown(); });
beforeEach(async () => { await colyseus.cleanup(); });

/** Recolhe TODA carta ({suit, rank}) em qualquer profundidade — a mesma varredura da Fase 1. */
function cartasEm(x: unknown, achadas: Card[] = []): Card[] {
  if (x === null || typeof x !== "object") return achadas;
  if (Array.isArray(x)) {
    for (const item of x) cartasEm(item, achadas);
    return achadas;
  }
  const o = x as Record<string, unknown>;
  if (typeof o.suit === "string" && typeof o.rank === "string") {
    achadas.push({ suit: o.suit as Suit, rank: o.rank as Rank });
    return achadas;
  }
  for (const v of Object.values(o)) cartasEm(v, achadas);
  return achadas;
}

// ═══════════════════════ A · B — bootstrap ═══════════════════════

describe("A/B · bootstrap", () => {
  it("A · o servidor sobe e responde", () => {
    expect(colyseus.server).toBeDefined();
    expect(colyseus.sdk).toBeDefined();
  });

  it("B · a KingRoom é criada com quatro assentos vazios e a versão do protocolo", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    expect(room.roomId).toBeTruthy();
    expect(room.maxClients).toBe(ASSENTOS);
    expect(room.state.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(room.state.roomId).toBe(room.roomId);
    expect(room.state.seats).toHaveLength(ASSENTOS);
    for (let s = 0; s < ASSENTOS; s++) {
      expect(room.state.seats[s].seat).toBe(s);
      expect(room.state.seats[s].playerId).toBe("");
      expect(room.state.seats[s].connected).toBe(false);
      expect(room.state.seats[s].ready).toBe(false);
    }
    expect(room.partidaIniciada()).toBe(false);
  });
});

// ═══════════════════════ C · D · E — entrada e assentos ═══════════════════════

describe("C/D/E · entrada de clientes e atribuição de assentos", () => {
  it("C · o primeiro cliente entra e recebe o assento 0", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    await colyseus.connectTo(room, entrada("Tito"));
    expect(room.clients).toHaveLength(1);
    expect(room.clients[0].userData?.seat).toBe(0);
    expect(room.state.seats[0].nick).toBe("Tito");
    expect(room.state.seats[0].connected).toBe(true);
    expect(room.state.seats[0].playerId).not.toBe("");
  });

  it("D · quatro clientes entram e a sala fica cheia", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    for (let i = 0; i < ASSENTOS; i++) await colyseus.connectTo(room, entrada(`P${i}`));
    expect(room.clients).toHaveLength(ASSENTOS);
    for (let s = 0; s < ASSENTOS; s++) {
      expect(room.state.seats[s].connected).toBe(true);
      expect(room.state.seats[s].nick).toBe(`P${s}`);
    }
  });

  it("E · os assentos são exatamente 0,1,2,3 — sem duplicidade e sem buraco", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    for (let i = 0; i < ASSENTOS; i++) await colyseus.connectTo(room, entrada(`P${i}`));

    const atribuidos = room.clients.map((c) => c.userData!.seat).sort();
    expect(atribuidos).toEqual([0, 1, 2, 3]);
    expect(new Set(atribuidos).size).toBe(ASSENTOS);

    // e os playerId são todos distintos
    const ids = room.state.seats.map((a) => a.playerId);
    expect(new Set(ids).size).toBe(ASSENTOS);
  });

  it("E · a atribuição é determinística: o mesmo roteiro produz a mesma ordem", async () => {
    for (let repeticao = 0; repeticao < 3; repeticao++) {
      const room = await colyseus.createRoom<KingRoom>(SALA_KING);
      const ordem: number[] = [];
      for (let i = 0; i < ASSENTOS; i++) {
        await colyseus.connectTo(room, entrada(`P${i}`));
        ordem.push(room.clients[i].userData!.seat);
      }
      expect(ordem).toEqual([0, 1, 2, 3]);
      await room.disconnect();
    }
  });
});

// ═══════════════════════ F — o quinto é recusado ═══════════════════════

describe("F · o quinto cliente é recusado", () => {
  it("com a sala cheia, a quinta conexão falha e o estado não muda", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    for (let i = 0; i < ASSENTOS; i++) await colyseus.connectTo(room, entrada(`P${i}`));

    await expect(colyseus.connectTo(room, entrada("Intruso"))).rejects.toBeDefined();

    expect(room.clients).toHaveLength(ASSENTOS);
    expect(room.state.seats).toHaveLength(ASSENTOS);
    for (let s = 0; s < ASSENTOS; s++) expect(room.state.seats[s].nick).toBe(`P${s}`);
  });

  it("cliente com protocolo incompatível é recusado na porta", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    await expect(
      colyseus.connectTo(room, { protocolVersion: PROTOCOL_VERSION + 1, nick: "Antigo" }),
    ).rejects.toBeDefined();
    expect(room.clients).toHaveLength(0);
    expect(CODIGO.PROTOCOLO_INCOMPATIVEL).toBe(4001);
  });
});

// ═══════════════════════ G · H — saída e encerramento ═══════════════════════

describe("G/H · saída e encerramento", () => {
  it("G · a saída libera o assento e avisa quem ficou", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    const c0 = await colyseus.connectTo(room, entrada("P0"));
    const c1 = await colyseus.connectTo(room, entrada("P1"));

    const saidas: EventoDeJogador[] = [];
    c0.onMessage("PLAYER_LEFT", (m: EventoDeJogador) => saidas.push(m));

    await c1.leave();
    await room.waitForNextPatch();

    expect(room.clients).toHaveLength(1);
    expect(room.state.seats[1].playerId).toBe("");
    expect(room.state.seats[1].connected).toBe(false);
    expect(room.state.seats[1].nick).toBe("");
    expect(room.state.seats[0].connected).toBe(true); // quem ficou não foi afetado
    expect(saidas.map((s) => s.seat)).toEqual([1]);
    expect(saidas[0].nick).toBe("P1");
  });

  it("G · o assento liberado é reaproveitado pelo próximo a entrar", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    const c0 = await colyseus.connectTo(room, entrada("P0"));
    await colyseus.connectTo(room, entrada("P1"));

    await c0.leave(); // libera o assento 0
    await room.waitForNextPatch();

    await colyseus.connectTo(room, entrada("Novo"));
    expect(room.state.seats[0].nick).toBe("Novo"); // menor índice livre
    expect(room.state.seats[1].nick).toBe("P1");
  });

  it("H · a room encerra corretamente e o onDispose roda", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    const roomId = room.roomId;
    await colyseus.connectTo(room, entrada("P0"));

    let disposeChamado = false;
    const original = room.onDispose?.bind(room);
    room.onDispose = () => { disposeChamado = true; return original?.(); };

    await room.disconnect();

    expect(disposeChamado).toBe(true);
    expect(colyseus.getRoomById(roomId)).toBeUndefined();
  });
});

// ═══════════════════════ I — protocolo tipado ═══════════════════════

describe("I · o protocolo é tipado nas duas direções", () => {
  it("SERVER_WELCOME chega com a forma declarada e o assento correto", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    const c0 = await colyseus.connectTo(room, entrada("P0"));

    // o assento 1 entra depois: o cliente 0 já está escutando, sem corrida
    const entradas: EventoDeJogador[] = [];
    c0.onMessage("PLAYER_JOINED", (m: EventoDeJogador) => entradas.push(m));
    await colyseus.connectTo(room, entrada("P1"));
    await room.waitForNextPatch();

    expect(entradas).toHaveLength(1);
    expect(entradas[0].seat).toBe(1);
    expect(entradas[0].nick).toBe("P1");
    expect(typeof entradas[0].playerId).toBe("string");

    // e o SERVER_WELCOME do próprio cliente, capturado no fio
    const boasVindas: BoasVindas[] = [];
    const c2 = await colyseus.connectTo(room, entrada("P2"));
    c2.onMessage("SERVER_WELCOME", (m: BoasVindas) => boasVindas.push(m));
    await room.waitForNextPatch();

    expect(boasVindas).toHaveLength(1);
    const w = boasVindas[0];
    expect(w.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(w.roomId).toBe(room.roomId);
    expect(w.you.seat).toBe(2);
    expect(typeof w.you.playerId).toBe("string");
    expect(typeof w.you.sessionToken).toBe("string");
    expect(w.you.playerId).not.toBe(w.you.sessionToken); // identidade ≠ credencial
    // o servidor guardou a identidade fora do estado sincronizado; a credencial de retorno
    // NÃO é guardada em userData — ela é derivada do socket a cada envio
    const { recoveryToken, ...identidade } = w.you;
    expect(room.clients[2].userData).toEqual(identidade);
    expect(recoveryToken.startsWith(room.roomId + ":")).toBe(true);
  });

  it("CLIENT_SET_READY altera só o assento de quem enviou", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    await colyseus.connectTo(room, entrada("P0"));
    const c1 = await colyseus.connectTo(room, entrada("P1"));

    await c1.send("CLIENT_SET_READY", { ready: true });
    await room.waitForNextPatch();

    expect(room.state.seats[1].ready).toBe(true);
    expect(room.state.seats[0].ready).toBe(false);
  });
});

// ═══════════════════════ J — ANTI-VAZAMENTO ESTRUTURAL ═══════════════════════

describe("J · nenhum estado privado chega ao cliente", () => {
  const SEMENTE = 987654321; // distintiva, para procurar no payload como texto

  it("com uma partida REAL no campo privado, o cliente não observa uma única carta", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);

    const mensagens: unknown[] = [];
    const clientes = [];
    for (let i = 0; i < ASSENTOS; i++) {
      const c = await colyseus.connectTo(room, entrada(`P${i}`));
      c.onMessage("*", (tipo, payload) => mensagens.push({ tipo, payload }));
      clientes.push(c);
    }

    // Inicia uma partida REAL pela autoridade — mãos distribuídas, semente do servidor.
    room.autoridadeDaPartida().iniciar(["P0", "P1", "P2", "P3"], "m-teste", SEMENTE);
    const partida = room.autoridadeDaPartida().estadoAutoritativo()!;
    expect(room.partidaIniciada()).toBe(true); // o SERVIDOR tem a partida...

    await room.waitForNextPatch();

    for (const c of clientes) {
      // ...e o cliente não vê nada dela
      const observado = JSON.parse(JSON.stringify({ state: c.state.toJSON(), mensagens }));
      expect(cartasEm(observado)).toHaveLength(0);

      const texto = JSON.stringify(observado);
      // nenhuma carta de nenhuma mão, em nenhuma representação
      for (let s = 0; s < ASSENTOS; s++) {
        for (const carta of partida.hand!.hands[s]) {
          expect(texto).not.toContain(`"${carta.suit}"`);
        }
      }
      // a semente reconstruiria o baralho inteiro: também não pode aparecer
      expect(texto).not.toContain(String(SEMENTE));
      // e nada com cara de MatchState
      const bruto = observado as Record<string, unknown>;
      expect(JSON.stringify(bruto)).not.toContain("\"hands\"");
      expect(JSON.stringify(bruto)).not.toContain("\"deck\"");
      expect(JSON.stringify(bruto)).not.toContain("\"cumulative\"");
    }
  });

  it("o estado sincronizado contém SOMENTE campos de lobby", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    const c0 = await colyseus.connectTo(room, entrada("P0"));
    room.autoridadeDaPartida().iniciar(["a", "b", "c", "d"], "m-teste", SEMENTE);
    await room.waitForNextPatch();

    const estado = c0.state.toJSON() as Record<string, unknown>;
    expect(Object.keys(estado).sort()).toEqual(["protocolVersion", "roomCode", "roomId", "seats", "status"]);

    const assentos = estado.seats as Record<string, unknown>[];
    expect(assentos).toHaveLength(ASSENTOS);
    for (const a of assentos) {
      // LISTA FECHADA, de propósito. Cada campo aqui é uma decisão consciente de tornar algo
      // público; um campo novo que apareça sem passar por esta linha reprova o teste, que é
      // exatamente o ponto. `bot` e `host` são públicos porque o lobby precisa desenhar quem é
      // bot e quem manda na composição — nenhum dos dois revela informação de jogo. `avatar`
      // é público pelo mesmo motivo: identidade tem de ser IGUAL nos quatro aparelhos.
      expect(Object.keys(a).sort()).toEqual(
        ["assisted", "avatar", "bot", "connected", "host", "nick", "playerId", "ready", "seat"],
      );
    }
  });
});
