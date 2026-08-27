// FASE 6 — QUEDA DE CONEXÃO E RETORNO AO MESMO ASSENTO.
//
// A identidade do jogador NÃO é o socket. Uma queda produz socket novo; o que reabre a sessão é
// a credencial `roomCode:recoveryToken`, que o servidor entrega no `SERVER_WELCOME` e que nunca
// sai do dono. O assento é RESTAURADO pelo servidor — jamais escolhido pelo cliente.
//
// Aqui a queda é simulada com `leave(false)` (saída NÃO consentida), que é o que o SDK produz
// quando a conexão morre sem aviso.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { cardId, legalCardsFor, type Card, type PlayerView, type Rank, type Seat, type Suit } from "@king/engine";
import { configurarTempos, restaurarTempos } from "../match/tempos.js";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import { PROTOCOL_VERSION, type AcaoRecusada, type AtualizacaoDeEstado, type BoasVindas } from "../protocol/index.js";
import { ASSENTOS, type KingRoom } from "./KingRoom.js";
import { normalizarCodigo } from "./codigos.js";

const SEATS: Seat[] = [0, 1, 2, 3];
const soma = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

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
beforeEach(async () => { proximoAvatar = 0; await colyseus.cleanup(); });

async function ate(cond: () => boolean, ms = 8000, rotulo = "?"): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando: " + rotulo);
    await new Promise((r) => setTimeout(r, 0));
  }
}
const respirar = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

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

interface AssentoView { seat: number; playerId: string; nick: string; connected: boolean; ready: boolean }
interface SalaView { roomCode: string; status: string; seats: AssentoView[]; toJSON(): unknown }
interface SdkRoom {
  roomId: string; state: SalaView; reconnectionToken: string;
  send(t: string, m?: unknown): void;
  onMessage(t: string, cb: (...a: never[]) => void): void;
  leave(consented?: boolean): Promise<number>;
}

interface Cliente {
  sdk: SdkRoom;
  seat: Seat;
  credencial: string;
  boasVindas: BoasVindas | null;
  view: PlayerView | null;
  versao: number;
  rejeicoes: AcaoRecusada[];
  recebidas: unknown[];
}

function escutar(sdk: SdkRoom, base?: Cliente): Cliente {
  const c: Cliente = base ?? {
    sdk, seat: 0 as Seat, credencial: "", boasVindas: null, view: null, versao: 0, rejeicoes: [], recebidas: [],
  };
  c.sdk = sdk;
  sdk.onMessage("SERVER_WELCOME", (m: BoasVindas) => {
    c.boasVindas = m; c.seat = m.you.seat; c.credencial = m.you.recoveryToken; c.recebidas.push(m);
  });
  sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => {
    c.view = m.view; c.versao = m.stateVersion; c.recebidas.push(m);
  });
  sdk.onMessage("ACTION_REJECTED", (m: AcaoRecusada) => { c.rejeicoes.push(m); c.recebidas.push(m); });
  sdk.onMessage("*", (t: string | number, p: unknown) => { c.recebidas.push({ t, p }); });
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

async function salaCheia(): Promise<{ room: KingRoom; todos: Cliente[]; codigo: string }> {
  const dono = escutar((await colyseus.sdk.create(SALA_KING, opcoes("P0"))) as unknown as SdkRoom);
  await ate(() => dono.boasVindas !== null, 8000, "welcome P0");
  const codigo = dono.boasVindas!.roomCode;
  const todos = [dono];
  for (let i = 1; i < ASSENTOS; i++) {
    const c = escutar((await colyseus.sdk.joinById(normalizarCodigo(codigo), opcoes(`P${i}`))) as unknown as SdkRoom);
    await ate(() => c.boasVindas !== null, 8000, `welcome P${i}`);
    todos.push(c);
  }
  const room = colyseus.getRoomById<KingRoom>(codigo);
  return { room, todos, codigo };
}

async function iniciar(todos: Cliente[]): Promise<void> {
  for (const c of todos) c.sdk.send("CLIENT_SET_READY", { ready: true });
  await ate(() => todos.every((c) => c.view !== null), 8000, "início");
}

/** Simula QUEDA: saída não consentida — é o que acontece quando a rede morre. */
const cair = async (c: Cliente) => { await c.sdk.leave(false); };

/**
 * Volta com a credencial. O socket é NOVO; a identidade é a mesma.
 * Zera `boasVindas` antes: sem isso a espera passaria com o dado ANTERIOR à queda.
 */
async function voltar(c: Cliente): Promise<void> {
  c.boasVindas = null;
  const novo = (await colyseus.sdk.reconnect(c.credencial)) as unknown as SdkRoom;
  escutar(novo, c);
  await ate(() => c.boasVindas !== null, 8000, "welcome após retorno");
  await respirar(); // deixa o STATE_UPDATE do retorno chegar
}

const daVez = (cs: Cliente[]) => cs.find((c) => c.view?.hand?.turn === c.seat && c.view.hand.handScores === null)!;


let seq = 0;
async function jogarUma(todos: Cliente[], c: Cliente): Promise<void> {
  const alvo = c.versao;
  c.sdk.send("CLIENT_PLAY_CARD", { actionId: `r${++seq}`, cardId: cardId(legalCardsFor(c.view!, c.seat)[0]) });
  await ate(() => todos.filter((x) => x.view !== null).every((x) => x.versao > alvo), 8000, "jogada");
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

// ═══════════════ A/B — queda no Lobby ═══════════════

describe("A/B · queda no Lobby", () => {
  it("o assento é RESERVADO na queda e devolvido a quem volta", async () => {
    const { room, todos } = await salaCheia();
    const p1 = todos[1];
    const playerIdAntes = p1.boasVindas!.you.playerId;

    await cair(p1);
    await ate(() => room.state.seats[1].connected === false, 8000, "marcado desconectado");

    expect(room.state.seats[1].playerId).toBe(playerIdAntes); // assento NÃO foi liberado
    expect(room.state.seats[1].nick).toBe("P1");
    // e ninguém consegue tomá-lo: a sala continua cheia
    await expect(colyseus.sdk.joinById(room.roomId, opcoes("Intruso"))).rejects.toBeDefined();

    await voltar(p1);
    await ate(() => room.state.seats[1].connected === true, 8000, "reconectado");
    expect(p1.boasVindas!.you.seat).toBe(1);
    expect(p1.boasVindas!.you.playerId).toBe(playerIdAntes); // MESMA identidade
  });

  it("sair de propósito no Lobby continua liberando o assento (Fase 5 preservada)", async () => {
    const { room, todos } = await salaCheia();
    await todos[2].sdk.leave(true); // consentido
    await ate(() => room.state.seats[2].playerId === "", 8000, "assento livre");
    expect(room.state.seats[2].nick).toBe("");

    const novo = escutar((await colyseus.sdk.joinById(room.roomId, opcoes("Novo"))) as unknown as SdkRoom);
    await ate(() => novo.boasVindas !== null, 8000, "welcome Novo");
    expect(novo.boasVindas!.you.seat).toBe(2);
  });
});

// ═══════════════ C/D/E/F/G — queda durante a partida ═══════════════

describe("C/D/E/F/G · queda durante a partida", () => {
  it("C/D · cai na PRÓPRIA vez, volta e joga normalmente — o turno o esperou", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);
    const c = daVez(todos);
    const versao = room.autoridadeDaPartida().stateVersion;

    await cair(c);
    await ate(() => room.state.seats[c.seat].connected === false, 8000, "desconectado");
    await respirar();

    // a partida NÃO andou: o turno continua dele
    expect(room.autoridadeDaPartida().stateVersion).toBe(versao);
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.hand!.turn).toBe(c.seat);

    await voltar(c);
    expect(c.view!.hand!.turn).toBe(c.seat);
    await jogarUma(todos, c);
    expect(room.autoridadeDaPartida().stateVersion).toBe(versao + 1);
  });

  it("E/F · cai enquanto os outros jogam e volta com o estado ATUAL, não o antigo", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);
    const vitima = todos.find((c) => c.seat !== daVez(todos).seat)!;
    const versaoNaQueda = vitima.versao;
    const vazasNaQueda = vitima.view!.hand!.completedTricks.length;

    await cair(vitima);
    await ate(() => room.state.seats[vitima.seat].connected === false, 8000, "desconectado");

    // os outros seguem jogando várias vazas
    const restantes = todos.filter((c) => c !== vitima);
    for (let i = 0; i < 10; i++) {
      const c = restantes.find((x) => x.view?.hand?.turn === x.seat);
      if (!c) break;
      await jogarUma(restantes, c);
    }
    const versaoAgora = room.autoridadeDaPartida().stateVersion;
    expect(versaoAgora).toBeGreaterThan(versaoNaQueda);

    await voltar(vitima);
    expect(vitima.versao).toBe(versaoAgora);                       // estado ATUAL
    expect(vitima.versao).toBeGreaterThan(versaoNaQueda);
    expect(vitima.view!.hand!.completedTricks.length).toBeGreaterThanOrEqual(vazasNaQueda);
    exigirVisaoLimpa(vitima.view!, vitima.seat);
  });

  it("G · socket novo mantém o MESMO playerId e o MESMO assento", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);
    const c = todos[3];
    const antes = { seat: c.seat, playerId: c.boasVindas!.you.playerId, socket: c.sdk.roomId };
    const maoAntes = c.view!.hand!.hands[c.seat].map(cardId);

    await cair(c);
    await voltar(c);

    expect(c.boasVindas!.you.seat).toBe(antes.seat);
    expect(c.boasVindas!.you.playerId).toBe(antes.playerId);
    expect(room.state.seats[antes.seat].playerId).toBe(antes.playerId);
    expect(c.view!.hand!.hands[c.seat].map(cardId)).toEqual(maoAntes); // P · cartas preservadas
  });
});

// ═══════════════ H/I/J/K/L — segurança da credencial ═══════════════

describe("H/I/J/K/L · a credencial é a identidade, e é secreta", () => {
  it("H · credencial inválida é recusada", async () => {
    const { room } = await salaCheia();
    await expect(colyseus.sdk.reconnect("QQQQQ:invalida")).rejects.toBeDefined();
    await expect(colyseus.sdk.reconnect(`${room.roomId}:naoexiste`)).rejects.toBeDefined();
    await expect(colyseus.sdk.reconnect("")).rejects.toBeDefined();
  });

  it("I/J · a credencial NUNCA sai do dono, e nick igual não dá identidade", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);

    // cada um tem a sua, e todas são distintas
    const credenciais = todos.map((c) => c.credencial);
    expect(new Set(credenciais).size).toBe(ASSENTOS);

    // nenhuma credencial alheia apareceu no que cada cliente recebeu
    for (const c of todos) {
      const texto = JSON.stringify(c.recebidas);
      for (const outro of todos) {
        if (outro === c) continue;
        const soToken = outro.credencial.split(":")[1];
        expect(texto.includes(soToken), `assento ${c.seat} viu a credencial de ${outro.seat}`).toBe(false);
      }
    }
    // nem no estado sincronizado da sala
    expect(JSON.stringify(room.state.toJSON())).not.toContain(credenciais[0].split(":")[1]);

    // J · entrar com o MESMO nick não dá acesso a assento nenhum (a sala está cheia)
    await expect(colyseus.sdk.joinById(room.roomId, opcoes("P0"))).rejects.toBeDefined();
  });

  it("I/13 · mesmo com a credencial em mãos, o assento nunca fica com DUAS conexões", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);
    const alvo = todos[2];

    // O framework aceita reconectar com a credencial de um cliente AINDA conectado e não derruba
    // o socket antigo. A trava é nossa: a conexão nova vence e a anterior é encerrada.
    const intruso = (await colyseus.sdk.reconnect(alvo.credencial)) as unknown as SdkRoom;
    await respirar(60);

    const noAssento = room.clients.filter((x) => x.userData?.seat === alvo.seat);
    expect(noAssento, "duas conexões no mesmo assento").toHaveLength(1);
    expect(room.state.seats[alvo.seat].playerId).toBe(alvo.boasVindas!.you.playerId);
    expect(room.state.seats.filter((a) => a.playerId !== "")).toHaveLength(ASSENTOS);
    // e a credencial usada não serve de novo: ela rotaciona a cada retorno
    await expect(colyseus.sdk.reconnect(alvo.credencial)).rejects.toBeDefined();
    expect(intruso).toBeDefined();
  });

  it("K/L · duas reconexões com a mesma credencial: só uma sessão sobrevive", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);
    const c = todos[1];
    const credencial = c.credencial;

    await cair(c);
    await ate(() => room.state.seats[1].connected === false, 8000, "desconectado");

    const primeira = (await colyseus.sdk.reconnect(credencial)) as unknown as SdkRoom;
    await respirar(60);
    // a credencial ROTACIONA a cada retorno: a antiga deixa de valer
    expect(primeira.reconnectionToken).not.toBe(credencial.split(":")[1]);
    await expect(colyseus.sdk.reconnect(credencial)).rejects.toBeDefined();

    await ate(() => room.state.seats[1].connected === true, 8000, "reconectado");
    expect(room.clients.filter((x) => x.userData?.seat === 1)).toHaveLength(1); // uma conexão só
  });
});

// ═══════════════ 7 — queda entre ações ═══════════════

describe("7 · queda logo depois de uma ação", () => {
  it("ação JÁ aplicada: ao voltar, a carta não pode ser jogada de novo", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);
    const c = daVez(todos);
    const carta = cardId(legalCardsFor(c.view!, c.seat)[0]);
    const acao = "acao-antes-da-queda";

    c.sdk.send("CLIENT_PLAY_CARD", { actionId: acao, cardId: carta });
    await ate(() => room.autoridadeDaPartida().estadoAutoritativo()!.hand!.currentTrick.length > 0, 8000, "aplicada");
    const versaoDepois = room.autoridadeDaPartida().stateVersion;

    await cair(c);
    await voltar(c);

    // a carta saiu da mão: o servidor é a verdade
    expect(c.view!.hand!.hands[c.seat].map(cardId)).not.toContain(carta);

    // M · reenviar a MESMA actionId é idempotente — não joga de novo
    c.sdk.send("CLIENT_PLAY_CARD", { actionId: acao, cardId: carta });
    await respirar();
    expect(room.autoridadeDaPartida().stateVersion).toBe(versaoDepois);
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.hand!.currentTrick).toHaveLength(1);

    // e tentar a mesma carta com actionId novo é recusado: ela não é mais dele
    c.sdk.send("CLIENT_PLAY_CARD", { actionId: "outra", cardId: carta });
    await ate(() => c.rejeicoes.length > 0, 8000, "recusa");
    expect(["CARD_NOT_OWNED", "NOT_YOUR_TURN"]).toContain(c.rejeicoes.at(-1)!.code);
    expect(room.autoridadeDaPartida().stateVersion).toBe(versaoDepois);
  });

  it("ação que NÃO chegou: ao voltar, a visão mostra que ainda falta jogar", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);
    const c = daVez(todos);
    const versao = room.autoridadeDaPartida().stateVersion;
    const maoAntes = c.view!.hand!.hands[c.seat].map(cardId);

    // o cliente cai ANTES de enviar — o servidor nunca soube da intenção
    await cair(c);
    await voltar(c);

    expect(room.autoridadeDaPartida().stateVersion).toBe(versao); // nada aconteceu
    expect(c.view!.hand!.turn).toBe(c.seat);                      // ainda é a vez dele
    expect(c.view!.hand!.hands[c.seat].map(cardId)).toEqual(maoAntes);
    await jogarUma(todos, c);                                     // e ele joga normalmente
    expect(room.autoridadeDaPartida().stateVersion).toBe(versao + 1);
  });
});

// ═══════════════ 8 — queda depois de uma vaza ═══════════════

describe("8 · queda depois da vaza resolvida", () => {
  it("volta com a vaza nova, não com a antiga", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);

    // fecha uma vaza inteira
    for (let i = 0; i < 4; i++) await jogarUma(todos, daVez(todos));
    const real = room.autoridadeDaPartida().estadoAutoritativo()!;
    expect(real.hand!.completedTricks).toHaveLength(1);

    const vitima = todos.find((c) => c.seat !== real.hand!.turn)!;
    await cair(vitima);

    // os outros abrem a vaza seguinte
    const restantes = todos.filter((c) => c !== vitima);
    for (let i = 0; i < 2; i++) {
      const c = restantes.find((x) => x.view?.hand?.turn === x.seat);
      if (!c) break;
      await jogarUma(restantes, c);
    }
    const vazaAtual = room.autoridadeDaPartida().estadoAutoritativo()!.hand!.currentTrick.length;

    await voltar(vitima);
    expect(vitima.view!.hand!.completedTricks).toHaveLength(1);
    expect(vitima.view!.hand!.currentTrick).toHaveLength(vazaAtual); // a vaza NOVA
    expect(vitima.versao).toBe(room.autoridadeDaPartida().stateVersion);
    exigirVisaoLimpa(vitima.view!, vitima.seat);
  });
});

// ═══════════════ 9 — queda entre mãos ═══════════════

describe("9 · queda no intervalo entre mãos", () => {
  it("volta ao mesmo assento, não duplica ready nem provoca avanço duplo", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);

    // termina a mão 1
    let guarda = 0;
    while (room.autoridadeDaPartida().estadoAutoritativo()!.hand!.handScores === null) {
      if (++guarda > 200) throw new Error("loop");
      await jogarUma(todos, daVez(todos));
    }
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.handNumber).toBe(1);

    const vitima = todos[2];
    const versaoAntes = room.autoridadeDaPartida().stateVersion;

    // ele cai SEM ter pedido a próxima
    await cair(vitima);
    await ate(() => room.state.seats[2].connected === false, 8000, "desconectado");

    // os outros três pedem — o consenso exige os QUATRO, então nada avança
    for (const c of todos.filter((x) => x !== vitima)) {
      c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: `p${c.seat}` });
    }
    await respirar(60);
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.handNumber).toBe(1);
    expect(room.autoridadeDaPartida().stateVersion).toBe(versaoAntes);

    await voltar(vitima);
    expect(vitima.seat).toBe(2);
    expect(vitima.view!.handNumber).toBe(1); // volta para o INTERVALO, não para outra mão

    // agora ele completa o consenso — e uma rajada não duplica o avanço
    for (let i = 0; i < 3; i++) {
      vitima.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: `volta-${i}` });
    }
    await ate(() => room.autoridadeDaPartida().estadoAutoritativo()!.handNumber === 2, 8000, "mão 2");
    await respirar(60);
    expect(room.autoridadeDaPartida().stateVersion).toBe(versaoAntes + 1); // UM avanço só
    await ate(() => todos.every((c) => c.view!.handNumber === 2), 8000, "todos na mão 2");
    for (const c of todos) exigirVisaoLimpa(c.view!, c.seat);
  }, 60_000);
});

// ═══════════════ 10 — GAME OVER ═══════════════

describe("10 · retorno depois do GAME OVER", () => {
  it("recupera o estado final: nenhuma M11, ranking e checksum intactos", async () => {
    const { room, todos } = await salaCheia();
    await iniciar(todos);

    // A partida é levada ao fim pela PRÓPRIA autoridade do servidor. Que o protocolo conduz uma
    // partida inteira já está provado nas Fases 3 e 4 — repetir 490 jogadas por WebSocket aqui só
    // tornaria este teste lento e frágil. O que ESTE teste prova é o RETORNO depois do fim, e isso
    // acontece pelo protocolo real, logo abaixo.
    const a = room.autoridadeDaPartida();
    let guarda = 0;
    while (!a.estadoAutoritativo()!.finished) {
      if (++guarda > 4000) throw new Error("loop da partida");
      const h = a.estadoAutoritativo()!.hand!;
      if (h.awaitingTrumpFrom !== null) {
        a.escolherTrunfo(h.awaitingTrumpFrom, `P${h.awaitingTrumpFrom}`, { actionId: `t${++seq}`, trump: "spades" });
        continue;
      }
      if (h.handScores !== null) {
        for (const s2 of SEATS) a.marcarPronto(s2, `P${s2}`, { actionId: `a${++seq}` });
        a.avancarMao(); // desde a Fase 7 o consenso não avança sozinho
        continue;
      }
      const turno = h.turn as Seat;
      const carta = legalCardsFor(a.estadoAutoritativo()!, turno)[0];
      a.jogarCarta(turno, `P${turno}`, { actionId: `j${++seq}`, cardId: cardId(carta) });
    }

    const real = a.estadoAutoritativo()!;
    expect(real.finished).toBe(true);
    expect(real.handNumber).toBe(10);
    const cumulativoFinal = [...real.cumulative];
    const versaoFinal = a.stateVersion;

    // ── e agora o que este teste existe para provar: a queda e o retorno ──
    const vitima = todos[1];
    await cair(vitima);
    await ate(() => room.state.seats[1].connected === false, 8000, "desconectado");
    await voltar(vitima);

    expect(vitima.view!.finished).toBe(true);
    expect(vitima.view!.handNumber).toBe(10);
    expect(vitima.view!.cumulative).toEqual(cumulativoFinal);   // O · score correto
    expect(soma(vitima.view!.cumulative)).toBe(0);
    expect(vitima.view!.history).toHaveLength(10);
    exigirVisaoLimpa(vitima.view!, vitima.seat);                // Q · sem vazamento

    // W · nada cria a mão 11, nem depois do retorno
    vitima.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: "depois-do-fim" });
    vitima.sdk.send("CLIENT_PLAY_CARD", { actionId: "depois-do-fim-2", cardId: "A-spades" });
    await ate(() => vitima.rejeicoes.length >= 2, 8000, "recusas pós-fim");
    expect(vitima.rejeicoes.every((r) => r.code === "WRONG_PHASE")).toBe(true);
    expect(a.estadoAutoritativo()!.handNumber).toBe(10);
    expect(a.stateVersion).toBe(versaoFinal);                   // N · versão intacta
    expect(a.estadoAutoritativo()!.history).toHaveLength(10);
  }, 60_000);
});
