// FASE 5 — SALA PRIVADA + LOBBY AUTORITATIVO.
//
// Prova o ciclo criar → compartilhar código → entrar → ocupar assento → ready → início, com o
// estado da sala vivendo no servidor. A entrada é por MATCHMAKING real (`create` / `joinById`),
// não pelo atalho `connectTo` — porque o que está sendo testado aqui é justamente a porta.
//
// O código É o `roomId`, então `joinById(codigo)` é a entrada nativa do framework. Não existe
// segunda tabela código→sala para sair de sincronia.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { cardId, type Seat } from "@king/engine";
import { configurarTempos, restaurarTempos } from "../match/tempos.js";
import { SALA_KING, servidor } from "../app.js";
import { PROTOCOL_VERSION, type AcaoRecusada, type AtualizacaoDeEstado, type BoasVindas } from "../protocol/index.js";
import { ASSENTOS } from "./KingRoom.js";
import {
  ALFABETO, TAMANHO_CODIGO, codigoOcupado, codigoValido, gerarCodigo,
  liberarCodigo, normalizarCodigo, reservarCodigo, totalEmUso,
} from "./codigos.js";

const SEATS: Seat[] = [0, 1, 2, 3];

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

async function ate(cond: () => boolean, ms = 8000, rotulo = "?"): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando: " + rotulo);
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** O estado PÚBLICO da sala, como o cliente o enxerga depois do patch do Colyseus. */
interface AssentoView { seat: number; playerId: string; nick: string; connected: boolean; ready: boolean }
interface SalaView {
  protocolVersion: number; roomCode: string; roomId: string; status: string;
  seats: AssentoView[]; toJSON(): unknown;
}
interface SdkRoom {
  roomId: string;
  state: SalaView;
  send(tipo: string, msg?: unknown): void;
  onMessage(tipo: string, cb: (...a: never[]) => void): void;
  leave(): Promise<number>;
}

interface Cliente {
  sdk: SdkRoom;
  boasVindas: BoasVindas | null;
  view: AtualizacaoDeEstado["view"] | null;
  rejeicoes: AcaoRecusada[];
}

function escutar(sdk: SdkRoom): Cliente {
  const c: Cliente = { sdk, boasVindas: null, view: null, rejeicoes: [] };
  sdk.onMessage("SERVER_WELCOME", (m: BoasVindas) => { c.boasVindas = m; });
  sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => { c.view = m.view; });
  sdk.onMessage("ACTION_REJECTED", (m: AcaoRecusada) => c.rejeicoes.push(m));
  return c;
}

const opcoes = (nick: string) => ({ protocolVersion: PROTOCOL_VERSION, nick });

/** Cria a sala pelo matchmaking e devolve o cliente que a criou + o código. */
async function criarSala(nick = "P0"): Promise<{ dono: Cliente; codigo: string }> {
  const sdk = (await colyseus.sdk.create(SALA_KING, opcoes(nick))) as unknown as SdkRoom;
  const dono = escutar(sdk);
  await ate(() => dono.boasVindas !== null, 8000, "SERVER_WELCOME do criador");
  return { dono, codigo: dono.boasVindas!.roomCode };
}

const entrar = async (codigo: string, nick: string): Promise<Cliente> =>
  escutar((await colyseus.sdk.joinById(normalizarCodigo(codigo), opcoes(nick))) as unknown as SdkRoom);

// ═══════════════════ o código ═══════════════════

describe("1/2/3 · roomCode", () => {
  it("tem o formato certo: quatro digitos, nada de letra", () => {
    expect(ALFABETO).toBe("0123456789");
    expect(TAMANHO_CODIGO).toBe(4);
    for (let i = 0; i < 500; i++) {
      const c = gerarCodigo();
      expect(c).toMatch(/^\d{4}$/);
      expect(c).toHaveLength(TAMANHO_CODIGO);
      expect(codigoValido(c)).toBe(true);
    }
  });

  it("tolera separadores digitados e PRESERVA o zero a esquerda", () => {
    expect(normalizarCodigo("0315")).toBe("0315");
    expect(normalizarCodigo("03-15")).toBe("0315");
    expect(normalizarCodigo(" 03 15 ")).toBe("0315");
    expect(codigoValido(normalizarCodigo("0315"))).toBe(true);
    // o defeito que isto impede: tratar o codigo como numero
    expect(normalizarCodigo("0315")).not.toBe(String(Number("0315")));
  });

  it("recusa códigos inválidos", () => {
    for (const ruim of ["", "315", "03150", "ABCD", "03A5", "abcd!", "  "]) {
      expect(codigoValido(normalizarCodigo(ruim)), ruim).toBe(false);
    }
  });

  it("em colisão, tenta de novo até achar um livre", () => {
    const antes = totalEmUso();
    // rng viciado: devolve sempre a MESMA sequência nas duas primeiras rodadas
    let chamada = 0;
    const viciado = () => {
      const rodada = Math.floor(chamada++ / TAMANHO_CODIGO);
      return rodada < 2 ? 0 : 0.5; // rodadas 0 e 1 geram o mesmo código; a 2ª muda
    };
    const primeiro = reservarCodigo(viciado);
    const segundo = reservarCodigo(viciado);

    expect(primeiro).not.toBe(segundo);      // a colisão foi resolvida
    expect(codigoOcupado(primeiro)).toBe(true);
    expect(codigoOcupado(segundo)).toBe(true);
    expect(totalEmUso()).toBe(antes + 2);

    liberarCodigo(primeiro);
    liberarCodigo(segundo);
    expect(codigoOcupado(primeiro)).toBe(false);
    expect(totalEmUso()).toBe(antes);
  });

  it("duas salas vivas nunca compartilham código", async () => {
    const a = await criarSala("A");
    const b = await criarSala("B");
    expect(a.codigo).not.toBe(b.codigo);
    expect(codigoValido(a.codigo)).toBe(true);
    expect(codigoValido(b.codigo)).toBe(true);
    // e o código é o próprio roomId, então entrar por ele é a porta nativa
    expect(a.dono.sdk.roomId).toBe(a.codigo);
  });
});

// ═══════════════════ criar e entrar ═══════════════════

describe("1/4/5/6 · criar sala, entrar pelo código e ocupar assentos", () => {
  it("quem cria recebe o código e o assento 0", async () => {
    const { dono, codigo } = await criarSala("Tito");
    expect(codigoValido(codigo)).toBe(true);
    expect(dono.boasVindas!.you.seat).toBe(0);
    expect(dono.boasVindas!.roomCode).toBe(codigo);
    expect(dono.sdk.state.roomCode).toBe(codigo);
    expect(dono.sdk.state.status).toBe("lobby");
  });

  it("os outros entram pelo código e recebem 1, 2, 3 — sem duplicidade", async () => {
    const { dono, codigo } = await criarSala("P0");
    const outros = [];
    for (let i = 1; i < ASSENTOS; i++) outros.push(await entrar(codigo, `P${i}`));
    for (const c of outros) await ate(() => c.boasVindas !== null, 8000, "welcome");

    const assentos = [dono, ...outros].map((c) => c.boasVindas!.you.seat).sort();
    expect(assentos).toEqual([0, 1, 2, 3]);
    expect(new Set(assentos).size).toBe(ASSENTOS);
    // e cada um recebeu um playerId próprio
    const ids = [dono, ...outros].map((c) => c.boasVindas!.you.playerId);
    expect(new Set(ids).size).toBe(ASSENTOS);
  });

  it("o código digitado em minúsculas funciona", async () => {
    const { codigo } = await criarSala("P0");
    const c = await entrar(codigo.toLowerCase(), "P1");
    await ate(() => c.boasVindas !== null, 8000, "welcome minúsculo");
    expect(c.boasVindas!.you.seat).toBe(1);
  });

  it("6 · a quinta entrada é rejeitada e a sala continua com quatro", async () => {
    const { dono, codigo } = await criarSala("P0");
    for (let i = 1; i < ASSENTOS; i++) await entrar(codigo, `P${i}`);

    await expect(entrar(codigo, "Intruso")).rejects.toBeDefined();

    await ate(() => dono.sdk.state.seats.filter((a) => a.playerId !== "").length === ASSENTOS, 8000, "4 assentos");
    expect(dono.sdk.state.seats.filter((a) => a.playerId !== "")).toHaveLength(ASSENTOS);
  });

  it("código inexistente e código inválido não abrem sala nenhuma", async () => {
    await criarSala("P0"); // existe UMA sala, com outro código
    await expect(colyseus.sdk.joinById("ZZZZZ", opcoes("X"))).rejects.toBeDefined();
    await expect(colyseus.sdk.joinById("", opcoes("X"))).rejects.toBeDefined();
    await expect(colyseus.sdk.joinById("NAO-EXISTE", opcoes("X"))).rejects.toBeDefined();
  });
});

// ═══════════════════ ready ═══════════════════

describe("7/10/11 · ready, unready e início da partida", () => {
  /** Sala cheia, ninguém pronto ainda. */
  async function salaCheia(): Promise<{ todos: Cliente[]; codigo: string }> {
    const { dono, codigo } = await criarSala("P0");
    const todos = [dono];
    for (let i = 1; i < ASSENTOS; i++) {
      const c = await entrar(codigo, `P${i}`);
      await ate(() => c.boasVindas !== null, 8000, `welcome P${i}`);
      todos.push(c);
    }
    return { todos, codigo };
  }

  const prontos = (c: Cliente) => c.sdk.state.seats.filter((a) => a.ready).length;

  it("A/B/C/D · 1, 2 e 3 prontos não iniciam; o quarto inicia", async () => {
    const { todos } = await salaCheia();

    for (let i = 0; i < 3; i++) {
      todos[i].sdk.send("CLIENT_SET_READY", { ready: true });
      await ate(() => prontos(todos[0]) === i + 1, 8000, `${i + 1} prontos`);
      expect(todos[0].sdk.state.status).toBe("lobby");
      for (const c of todos) expect(c.view).toBeNull(); // nenhuma carta distribuída
    }

    todos[3].sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => todos.every((c) => c.view !== null), 8000, "início");
    // O STATE_UPDATE (mensagem) chega ANTES do patch do Schema — são dois canais com ritmos
    // diferentes. Esperar o patch em vez de supor sincronia.
    await ate(() => todos[0].sdk.state.status === "playing", 8000, "patch do status");
    for (const c of todos) {
      expect(c.view!.handNumber).toBe(1);
      expect(c.view!.hand!.hands[c.boasVindas!.you.seat]).toHaveLength(13);
    }
  });

  it("unready antes do quarto impede o início", async () => {
    const { todos } = await salaCheia();
    for (const c of todos) c.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => todos.every((c) => c.view !== null), 8000, "início");
    await ate(() => todos[0].sdk.state.status === "playing", 8000, "patch do status");

    // agora numa sala nova: três prontos, um desiste
    const outra = await salaCheia();
    for (let i = 0; i < 3; i++) outra.todos[i].sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => prontos(outra.todos[0]) === 3, 8000, "3 prontos");
    outra.todos[1].sdk.send("CLIENT_SET_READY", { ready: false });
    await ate(() => prontos(outra.todos[0]) === 2, 8000, "voltou a 2");
    outra.todos[3].sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => prontos(outra.todos[0]) === 3, 8000, "3 de novo");

    expect(outra.todos[0].sdk.state.status).toBe("lobby");
    for (const c of outra.todos) expect(c.view).toBeNull();
  });

  it("E · ready repetido é idempotente — não conta duas vezes nem inicia sozinho", async () => {
    const { todos } = await salaCheia();
    for (let i = 0; i < 5; i++) todos[0].sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => prontos(todos[0]) === 1, 8000, "1 pronto");
    // dá tempo de qualquer efeito indevido aparecer
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
    expect(prontos(todos[0])).toBe(1);
    expect(todos[0].sdk.state.status).toBe("lobby");
  });

  it("11 · a partida inicia UMA única vez, mesmo com rajada de ready", async () => {
    const { todos } = await salaCheia();
    const atualizacoes: number[] = todos.map(() => 0);
    todos.forEach((c, i) => c.sdk.onMessage("STATE_UPDATE", () => { atualizacoes[i]++; }));

    for (let r = 0; r < 3; r++) for (const c of todos) c.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => todos.every((c) => c.view !== null), 8000, "início");
    await ate(() => todos[0].sdk.state.status === "playing", 8000, "patch do status");
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));

    expect(atualizacoes.every((n) => n === 1), JSON.stringify(atualizacoes)).toBe(true);
    // os readys que sobraram viraram recusa, não um segundo início
    const recusas = todos.flatMap((c) => c.rejeicoes);
    expect(recusas.every((r) => r.code === "WRONG_PHASE")).toBe(true);
  });

  it("H · ready depois do início é rejeitado", async () => {
    const { todos } = await salaCheia();
    for (const c of todos) c.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => todos.every((c) => c.view !== null), 8000, "início");

    const antes = todos[0].rejeicoes.length;
    todos[0].sdk.send("CLIENT_SET_READY", { ready: false });
    await ate(() => todos[0].rejeicoes.length > antes, 8000, "recusa");
    expect(todos[0].rejeicoes.at(-1)!.code).toBe("WRONG_PHASE");
  });
});

// ═══════════════════ saída ═══════════════════

describe("8/9 · saída antes da partida", () => {
  it("sair libera o assento e apaga o ready; outro jogador ocupa a vaga", async () => {
    const { dono, codigo } = await criarSala("P0");
    const p1 = await entrar(codigo, "P1");
    await ate(() => p1.boasVindas !== null, 8000, "welcome P1");

    p1.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => dono.sdk.state.seats[1].ready === true, 8000, "P1 pronto");

    await p1.sdk.leave();
    await ate(() => dono.sdk.state.seats[1].playerId === "", 8000, "assento 1 livre");

    expect(dono.sdk.state.seats[1].ready).toBe(false);   // o ready foi embora junto
    expect(dono.sdk.state.seats[1].nick).toBe("");
    expect(dono.sdk.state.seats[0].playerId).not.toBe(""); // quem ficou não foi afetado

    const novo = await entrar(codigo, "Novo");
    await ate(() => novo.boasVindas !== null, 8000, "welcome Novo");
    expect(novo.boasVindas!.you.seat).toBe(1);           // menor índice livre
    await ate(() => dono.sdk.state.seats[1].nick === "Novo", 8000, "vaga ocupada");
    expect(dono.sdk.state.seats[1].ready).toBe(false);   // entra sem ready herdado
  });

  it("a saída de quem já estava pronto impede o início até a vaga ser preenchida", async () => {
    const { dono, codigo } = await criarSala("P0");
    const outros = [];
    for (let i = 1; i < ASSENTOS; i++) outros.push(await entrar(codigo, `P${i}`));
    for (const c of outros) await ate(() => c.boasVindas !== null, 8000, "welcome");

    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    for (const c of outros) c.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => dono.view !== null, 8000, "início"); // essa sala começou

    // outra sala: três prontos e um sai
    const s2 = await criarSala("Q0");
    const q = [];
    for (let i = 1; i < ASSENTOS; i++) q.push(await entrar(s2.codigo, `Q${i}`));
    for (const c of q) await ate(() => c.boasVindas !== null, 8000, "welcome Q");
    s2.dono.sdk.send("CLIENT_SET_READY", { ready: true });
    q[0].sdk.send("CLIENT_SET_READY", { ready: true });
    q[1].sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => s2.dono.sdk.state.seats.filter((a) => a.ready).length === 3, 8000, "3 prontos");

    await q[0].sdk.leave();
    await ate(() => s2.dono.sdk.state.seats[1].playerId === "", 8000, "vaga aberta");
    q[2].sdk.send("CLIENT_SET_READY", { ready: true }); // o quarto fica pronto

    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
    expect(s2.dono.sdk.state.status).toBe("lobby"); // 3 prontos, mas só 3 sentados
    expect(s2.dono.view).toBeNull();
  });
});

// ═══════════════ lobby → partida ═══════════════

describe("12/13/14 · a transição preserva assentos e não vaza nada", () => {
  it("os assentos do lobby viram os assentos da partida, sem troca silenciosa", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const outros = [];
    for (const nick of ["Bia", "Léo", "Nara"]) {
      const c = await entrar(codigo, nick);
      await ate(() => c.boasVindas !== null, 8000, "welcome " + nick);
      outros.push(c);
    }
    const todos = [dono, ...outros];
    const antes = todos.map((c) => ({ seat: c.boasVindas!.you.seat, nick: c.sdk.state.seats[c.boasVindas!.you.seat].nick }));

    for (const c of todos) c.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => todos.every((c) => c.view !== null), 8000, "início");

    for (let i = 0; i < todos.length; i++) {
      const c = todos[i];
      const seat = antes[i].seat;
      expect(c.view!.redactedFor).toBe(seat);                 // mesmo assento
      expect(c.view!.players[seat]).toBe(antes[i].nick);      // mesmo nome
    }
    expect(todos.map((c) => c.view!.players).every((p) => JSON.stringify(p) === JSON.stringify(["Tito", "Bia", "Léo", "Nara"]))).toBe(true);
  });

  it("14 · nem o lobby nem a transição entregam carta alheia", async () => {
    const { dono, codigo } = await criarSala("P0");
    const todos = [dono];
    for (let i = 1; i < ASSENTOS; i++) {
      const c = await entrar(codigo, `P${i}`);
      await ate(() => c.boasVindas !== null, 8000, "welcome");
      todos.push(c);
    }

    // no LOBBY: nenhuma mão distribuída, nada de carta no estado sincronizado
    const estadoLobby = JSON.stringify(dono.sdk.state.toJSON());
    expect(estadoLobby).not.toContain("suit");
    expect(estadoLobby).not.toContain("hands");
    for (const c of todos) expect(c.view).toBeNull();

    for (const c of todos) c.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => todos.every((c) => c.view !== null), 8000, "início");

    // DEPOIS do início: cada um só enxerga a própria mão
    for (const c of todos) {
      const seat = c.boasVindas!.you.seat;
      expect(c.view!.hand!.hands[seat]).toHaveLength(13);
      for (const outro of SEATS) if (outro !== seat) expect(c.view!.hand!.hands[outro]).toEqual([]);
      expect(c.view!.seed).toBe(0);
      // e o estado sincronizado da sala continua sem uma única carta
      expect(JSON.stringify(c.sdk.state.toJSON())).not.toContain("suit");
    }
    // as quatro mãos juntas formam o baralho inteiro
    const todasCartas = todos.flatMap((c) => c.view!.hand!.hands[c.boasVindas!.you.seat].map(cardId));
    expect(new Set(todasCartas).size).toBe(52);
  });
});
