/**
 * CLIENTE MULTIPLAYER — a fiação entre os sinais do Colyseus e a interface `SessaoKing`.
 *
 * Nenhum servidor sobe aqui: o objetivo é provar que cada sinal chega a quem deve, e que a
 * leitura do estado sincronizado é tolerante — ele chega decodificado por REFLEXÃO, então pode
 * vir como ArraySchema, como array comum ou incompleto, e não pode quebrar a Sala.
 */
import { describe, it, expect, vi } from "vitest";
import type { Room } from "@colyseus/sdk";
import { envolverSala, lerEstadoDaSala } from "./clienteKing.js";

/** Uma `Room` de mentira com a mesma superfície que o envelope usa. */
function salaFalsa(estadoInicial: unknown = null) {
  const ouvintes = {
    estado: [] as ((s: unknown) => void)[],
    mensagens: new Map<string, (p: unknown) => void>(),
    caiu: [] as (() => void)[],
    voltou: [] as (() => void)[],
    saiu: [] as ((c: number, m?: string) => void)[],
    erro: [] as ((c: number, m?: string) => void)[],
  };
  const enviadas: { tipo: string; payload: unknown }[] = [];
  let saiuConsentido: boolean | null = null;
  const sala = {
    roomId: "0315",
    state: estadoInicial,
    onStateChange: (cb: (s: unknown) => void) => { ouvintes.estado.push(cb); },
    onMessage: (tipo: string, cb: (p: unknown) => void) => {
      ouvintes.mensagens.set(tipo, cb);
      return () => ouvintes.mensagens.delete(tipo);
    },
    onDrop: (cb: () => void) => { ouvintes.caiu.push(cb); },
    onReconnect: (cb: () => void) => { ouvintes.voltou.push(cb); },
    onLeave: (cb: (c: number, m?: string) => void) => { ouvintes.saiu.push(cb); },
    onError: (cb: (c: number, m?: string) => void) => { ouvintes.erro.push(cb); },
    send: (tipo: string, payload: unknown) => { enviadas.push({ tipo, payload }); },
    leave: (consentido?: boolean) => { saiuConsentido = consentido ?? null; return Promise.resolve(0); },
  };
  return {
    sala: sala as unknown as Room,
    ouvintes,
    enviadas,
    consentido: () => saiuConsentido,
    mudarEstado(novo: unknown) { sala.state = novo; for (const cb of ouvintes.estado) cb(novo); },
  };
}

const ESTADO = {
  protocolVersion: 1, roomCode: "0315", roomId: "0315", status: "lobby",
  seats: [
    { seat: 0, playerId: "p0", nick: "Tito", connected: true, ready: true, assisted: false, avatar: "espadas" },
    { seat: 1, playerId: "", nick: "", connected: false, ready: false, assisted: false },
    { seat: 2, playerId: "p2", nick: "Bia", connected: false, ready: false, assisted: true },
    { seat: 3, playerId: "", nick: "", connected: false, ready: false, assisted: false },
  ],
};

describe("lerEstadoDaSala", () => {
  it("lê o estado normal", () => {
    const e = lerEstadoDaSala(ESTADO)!;
    expect(e.roomCode).toBe("0315");
    expect(e.status).toBe("lobby");
    expect(e.seats).toHaveLength(4);
    expect(e.seats[0]).toMatchObject({ nick: "Tito", ready: true, connected: true, avatar: "espadas" });
    expect(e.seats[2]).toMatchObject({ nick: "Bia", connected: false, assisted: true });
  });

  it("aceita ArraySchema (que expõe toArray) e iteráveis", () => {
    const comToArray = { ...ESTADO, seats: { toArray: () => ESTADO.seats } };
    expect(lerEstadoDaSala(comToArray)!.seats).toHaveLength(4);
    const iteravel = { ...ESTADO, seats: new Set(ESTADO.seats) };
    expect(lerEstadoDaSala(iteravel)!.seats).toHaveLength(4);
  });

  it("não quebra com estado ausente, incompleto ou com tipos errados", () => {
    expect(lerEstadoDaSala(null)).toBeNull();
    expect(lerEstadoDaSala("nada")).toBeNull();
    const magro = lerEstadoDaSala({})!;
    expect(magro.seats).toEqual([]);
    expect(magro.status).toBe("lobby");
    const torto = lerEstadoDaSala({ status: 7, seats: [{}, null] })!;
    expect(torto.status).toBe("lobby"); // status desconhecido cai no seguro
    // `avatar` vazio é aceitável AQUI: quem garante um valor do conjunto fechado é o servidor,
    // e a camada de desenho cai no padrão sozinha. O leitor não inventa dado que não veio.
    expect(torto.seats).toEqual([
      { seat: 0, playerId: "", nick: "", connected: false, ready: false, assisted: false, bot: false, host: false, avatar: "" },
      { seat: 1, playerId: "", nick: "", connected: false, ready: false, assisted: false, bot: false, host: false, avatar: "" },
    ]);
  });

  it("status conhecido é preservado", () => {
    expect(lerEstadoDaSala({ ...ESTADO, status: "playing" })!.status).toBe("playing");
    expect(lerEstadoDaSala({ ...ESTADO, status: "finished" })!.status).toBe("finished");
  });
});

describe("envelope da sessão", () => {
  it("expõe o código da sala e envia mensagens tipadas", () => {
    const f = salaFalsa(ESTADO);
    const s = envolverSala(f.sala);
    expect(s.roomCode).toBe("0315");
    s.enviar("CLIENT_SET_READY", { ready: true });
    expect(f.enviadas).toEqual([{ tipo: "CLIENT_SET_READY", payload: { ready: true } }]);
  });

  it("entrega as mensagens do servidor a quem assinou", () => {
    const f = salaFalsa(ESTADO);
    const s = envolverSala(f.sala);
    const visto = vi.fn();
    s.ao("READY_STATE", visto);
    f.ouvintes.mensagens.get("READY_STATE")!({ handNumber: 3, ready: [0, 2] });
    expect(visto).toHaveBeenCalledWith({ handNumber: 3, ready: [0, 2] });
  });

  it("mantém o último estado lido, sem precisar de assinatura", () => {
    const f = salaFalsa(ESTADO);
    const s = envolverSala(f.sala);
    expect(s.estado()!.status).toBe("lobby");
    f.mudarEstado({ ...ESTADO, status: "playing" });
    expect(s.estado()!.status).toBe("playing");
  });

  it("traduz queda, retorno, saída e erro — é o que a UI usa para contar a história", () => {
    const f = salaFalsa(ESTADO);
    const s = envolverSala(f.sala);
    const caiu = vi.fn(); const voltou = vi.fn(); const saiu = vi.fn(); const erro = vi.fn();
    s.aoCair(caiu); s.aoVoltar(voltou); s.aoSair(saiu); s.aoErro(erro);

    // queda transitória: quem tenta voltar é o próprio SDK, com backoff
    f.ouvintes.caiu[0]();
    expect(caiu).toHaveBeenCalled();
    f.ouvintes.voltou[0]();
    expect(voltou).toHaveBeenCalled();
    // saída definitiva
    f.ouvintes.saiu[0](4000, "consentido");
    expect(saiu).toHaveBeenCalledWith(4000, "consentido");
    f.ouvintes.erro[0](4001, "Protocolo incompatível");
    expect(erro).toHaveBeenCalledWith(4001, "Protocolo incompatível");
  });

  it("sair é CONSENTIDO — o servidor libera o assento na hora, no lobby", () => {
    const f = salaFalsa(ESTADO);
    envolverSala(f.sala).sair();
    expect(f.consentido()).toBe(true);
  });
});
