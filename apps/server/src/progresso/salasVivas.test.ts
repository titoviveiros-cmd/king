// QUEM ESTÁ NUMA SALA VIVA (E-2) — o registro que protege a lápide de quem ainda pode jogar.
//
// Sala REAL (Colyseus de teste, sem identidade: os ids são sorteados — o expurgo filtra só UUID depois).
// O que se prova aqui é o registro: a sala entra ao nascer, conta quem está sentado (inclusive quem
// caiu e tem o assento reservado sem token) e sai ao morrer.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "../rooms/identidade.js";
import { PROTOCOL_VERSION } from "../protocol/index.js";
import type { KingRoom } from "../rooms/KingRoom.js";
import { esquecerSala, jogadoresEmSalasVivas, registrarSala } from "./salasVivas.js";

let colyseus: ColyseusTestServer;
beforeAll(async () => { colyseus = await boot(servidor); });
afterAll(async () => { await colyseus.shutdown(); });
beforeEach(async () => { await colyseus.cleanup(); });

async function ate(cond: () => boolean, ms = 8000, rotulo = "?"): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando: " + rotulo);
    await new Promise((r) => setTimeout(r, 2));
  }
}
const opcoes = (nick: string, i: number) => ({ protocolVersion: PROTOCOL_VERSION, nick, avatar: AVATARES[i] });

describe("o registro das salas vivas", () => {
  it("sem sala, ninguém; uma sala que falha ao responder faz o retrato LANÇAR (o expurgo adia)", () => {
    expect(jogadoresEmSalasVivas()).toEqual([]);
    const quebrada = {};
    registrarSala(quebrada, () => { throw new Error("sala em estado inválido"); });
    expect(() => jogadoresEmSalasVivas()).toThrow();
    esquecerSala(quebrada);
    expect(jogadoresEmSalasVivas()).toEqual([]);
  });

  it("a sala conta quem está sentado — inclusive quem CAIU no lobby e tem o assento reservado — e sai ao morrer", async () => {
    const dono = await colyseus.sdk.create(SALA_KING, opcoes("P0", 0));
    let codigo = "";
    dono.onMessage("SERVER_WELCOME", (m: { roomCode: string }) => { codigo = m.roomCode; });
    await ate(() => codigo !== "", 8000, "welcome P0");
    const visita = await colyseus.sdk.joinById(codigo, opcoes("P1", 1));
    const room = colyseus.getRoomById<KingRoom>(codigo);
    await ate(() => room.state.seats.filter((a) => a.playerId !== "").length === 2, 8000, "dois sentados");
    const sentados = room.state.seats.map((a) => a.playerId).filter((id) => id !== "");
    for (const id of sentados) expect(jogadoresEmSalasVivas()).toContain(id);

    // queda NÃO consentida no lobby: o assento fica reservado e quem caiu volta SEM token
    await (visita as unknown as { leave(consentido?: boolean): Promise<unknown> }).leave(false);
    await ate(() => room.state.seats.some((a) => a.playerId === sentados[1] && !a.connected), 8000, "queda registrada");
    expect(jogadoresEmSalasVivas()).toContain(sentados[1]);

    await colyseus.cleanup(); // a sala morre
    await ate(() => jogadoresEmSalasVivas().length === 0, 8000, "registro vazio depois do descarte");
  });
});

describe("a sala ENCERRADA não protege ninguém", () => {
  it("depois de finished, os ids dela saem do retrato (o crédito já nasceu no outbox ou em voo)", async () => {
    const dono = await colyseus.sdk.create(SALA_KING, opcoes("P0", 0));
    let codigo = "";
    dono.onMessage("SERVER_WELCOME", (m: { roomCode: string }) => { codigo = m.roomCode; });
    await ate(() => codigo !== "", 8000, "welcome P0");
    const room = colyseus.getRoomById<KingRoom>(codigo);
    const id = room.state.seats[0].playerId;
    expect(jogadoresEmSalasVivas()).toContain(id);
    room.state.status = "finished"; // a transição do motor; aqui só o efeito no registro importa
    expect(jogadoresEmSalasVivas()).not.toContain(id);
  });
});
