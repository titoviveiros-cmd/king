// FASE 3 — partida real governada pela KingRoom, ponta a ponta.
//
// Quatro clientes sintéticos conectados por WebSocket real. Cada um decide **apenas** com a
// PlayerView que recebeu: nunca lê o MatchState do servidor para escolher carta. O objetivo é
// provar o protocolo, não jogar bem — a política é "primeira carta legal".
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import {
  cardId, legalCardsFor,
  type Card, type PlayerView, type Rank, type Seat, type Suit,
} from "@king/engine";
import { configurarTempos, restaurarTempos } from "../match/tempos.js";
import { SALA_KING, servidor } from "../app.js";
import { PROTOCOL_VERSION, type AcaoRecusada, type AtualizacaoDeEstado } from "../protocol/index.js";
import { ASSENTOS, type KingRoom } from "./KingRoom.js";

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
beforeEach(async () => { await colyseus.cleanup(); });

/** Varredura estrutural: recolhe toda carta em qualquer profundidade. */
function cartasEm(x: unknown, achadas: Card[] = []): Card[] {
  if (x === null || typeof x !== "object") return achadas;
  if (Array.isArray(x)) { for (const i of x) cartasEm(i, achadas); return achadas; }
  const o = x as Record<string, unknown>;
  if (typeof o.suit === "string" && typeof o.rank === "string") {
    achadas.push({ suit: o.suit as Suit, rank: o.rank as Rank });
    return achadas;
  }
  for (const v of Object.values(o)) cartasEm(v, achadas);
  return achadas;
}

/** Espera ativa curta — as mensagens do Colyseus chegam de forma assíncrona. */
async function ate(cond: () => boolean, ms = 8000): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando o estado");
    await new Promise((r) => setTimeout(r, 1));
  }
}

interface Sintetico {
  seat: Seat;
  sdk: { send: (t: string, m?: unknown) => void; onMessage: (t: string, cb: (...a: never[]) => void) => void };
  view: PlayerView | null;
  versao: number;
  atualizacoes: AtualizacaoDeEstado[];
  rejeicoes: AcaoRecusada[];
  /** TUDO que este cliente recebeu — base da varredura anti-vazamento. */
  recebidas: unknown[];
}

/** Cria uma sala com quatro clientes sintéticos já escutando. */
async function salaCom4(): Promise<{ room: KingRoom; clientes: Sintetico[] }> {
  const room = await colyseus.createRoom<KingRoom>(SALA_KING);
  const clientes: Sintetico[] = [];
  for (const seat of SEATS) {
    const sdk = await colyseus.connectTo(room, { protocolVersion: PROTOCOL_VERSION, nick: `P${seat}` });
    const c: Sintetico = { seat, sdk: sdk as never, view: null, versao: 0, atualizacoes: [], rejeicoes: [], recebidas: [] };
    sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => {
      c.view = m.view; c.versao = m.stateVersion; c.atualizacoes.push(m); c.recebidas.push(m);
    });
    sdk.onMessage("ACTION_REJECTED", (m: AcaoRecusada) => { c.rejeicoes.push(m); c.recebidas.push(m); });
    sdk.onMessage("*", (tipo: string | number, payload: unknown) => {
      c.recebidas.push({ tipo, payload });
    });
    clientes.push(c);
  }
  return { room, clientes };
}

/** O início é por CONSENSO: os quatro prontos. Nenhum jogador isolado inicia a partida. */
async function iniciarPartida(clientes: Sintetico[]): Promise<void> {
  for (const c of clientes) c.sdk.send("CLIENT_SET_READY", { ready: true });
  await ate(() => clientes.every((c) => c.view !== null));
}

/** O cliente da vez, segundo a PRÓPRIA visão de cada um. */
const daVez = (cs: Sintetico[]) =>
  cs.find((c) => c.view?.hand?.handScores === null && c.view.hand.turn === c.seat);

let contador = 0;
/** Uma jogada legal, decidida só com a PlayerView, e a espera do eco autoritativo. */
async function jogarUma(clientes: Sintetico[], c: Sintetico): Promise<void> {
  const legais = legalCardsFor(c.view!, c.seat);
  expect(legais.length).toBeGreaterThan(0);
  const alvo = c.versao;
  c.sdk.send("CLIENT_PLAY_CARD", {
    actionId: `p${c.seat}-${++contador}`,
    cardId: cardId(legais[0]),
    expectedStateVersion: c.versao, // exercita a checagem estrita no caminho feliz
  });
  await ate(() => clientes.every((x) => x.versao > alvo));
}

/** Toda carta de uma visão é própria ou já pública — verificação auto-contida. */
function exigirVisaoLimpa(v: PlayerView, seat: Seat): void {
  expect(v.redactedFor).toBe(seat);
  const proprias = new Set(v.hand ? v.hand.hands[seat].map(cardId) : []);
  const publicas = new Set<string>();
  if (v.hand) {
    for (const t of v.hand.completedTricks) for (const p of t.cards) publicas.add(cardId(p.card));
    for (const p of v.hand.currentTrick) publicas.add(cardId(p.card));
  }
  for (const c of cartasEm(v)) {
    const id = cardId(c);
    expect(proprias.has(id) || publicas.has(id), `carta ${id} na visão do assento ${seat}`).toBe(true);
  }
  for (const outro of SEATS) if (outro !== seat) expect(v.hand?.hands[outro] ?? []).toEqual([]);
}

// ═══════════════════ A · B · C — partida autoritativa ═══════════════════

describe("A/B/C · a partida nasce no servidor e cada cliente recebe a sua visão", () => {
  it("A · o consenso dos quatro prontos cria a Match autoritativa e a versão vai a 1", async () => {
    const { room, clientes } = await salaCom4();
    expect(room.partidaIniciada()).toBe(false);
    await iniciarPartida(clientes);

    expect(room.partidaIniciada()).toBe(true);
    expect(room.autoridadeDaPartida().stateVersion).toBe(1);
    for (const c of clientes) {
      expect(c.versao).toBe(1);
      expect(c.atualizacoes[0].cause).toBe("MATCH_STARTED");
      expect(c.atualizacoes[0].matchId).toBeTruthy();
      expect(c.view!.handNumber).toBe(1);
      expect(c.view!.hand!.contract.kind).toBe("no-tricks");
    }
  });

  it("A · sala incompleta não inicia, mesmo com todos os presentes prontos", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    const sdks = [];
    for (let i = 0; i < 3; i++) {
      sdks.push(await colyseus.connectTo(room, { protocolVersion: PROTOCOL_VERSION, nick: `P${i}` }));
    }
    for (const s of sdks) s.send("CLIENT_SET_READY", { ready: true });
    await ate(() => room.state.seats.filter((a) => a.ready).length === 3);

    expect(room.partidaIniciada()).toBe(false);   // falta o quarto assento
    expect(room.state.status).toBe("lobby");
  });

  it("B · os quatro assentos batem com a sessão, e o seat nunca vem do payload", async () => {
    const { room, clientes } = await salaCom4();
    await iniciarPartida(clientes);
    for (const c of clientes) {
      expect(c.view!.redactedFor).toBe(c.seat);
      expect(room.clients[c.seat].userData!.seat).toBe(c.seat);
      expect(c.view!.players[c.seat]).toBe(`P${c.seat}`);
    }
    expect(new Set(clientes.map((c) => c.view!.redactedFor)).size).toBe(ASSENTOS);
  });

  it("C · cada cliente recebe uma visão DIFERENTE, com as próprias 13 cartas", async () => {
    const { clientes } = await salaCom4();
    await iniciarPartida(clientes);

    const maos = clientes.map((c) => c.view!.hand!.hands[c.seat].map(cardId).sort().join("|"));
    expect(new Set(maos).size).toBe(ASSENTOS); // quatro visões distintas
    for (const c of clientes) {
      expect(c.view!.hand!.hands[c.seat]).toHaveLength(13);
      exigirVisaoLimpa(c.view!, c.seat);
    }
    // as quatro mãos juntas formam o baralho inteiro, sem repetição
    const todas = clientes.flatMap((c) => c.view!.hand!.hands[c.seat].map(cardId));
    expect(new Set(todas).size).toBe(52);
  });
});

// ═══════════════════ D — anti-vazamento com partida real ═══════════════════

describe("D · nenhuma mão adversária cruza o fio", () => {
  it("no meio da mão, nenhuma carta oculta de outro assento aparece em nenhuma visão", async () => {
    const { room, clientes } = await salaCom4();
    await iniciarPartida(clientes);

    for (let i = 0; i < 14; i++) { // ~3 vazas e meia
      const c = daVez(clientes);
      if (!c) break;
      await jogarUma(clientes, c);
    }

    const real = room.autoridadeDaPartida().estadoAutoritativo()!;
    const publicas = new Set<string>();
    for (const t of real.hand!.completedTricks) for (const p of t.cards) publicas.add(cardId(p.card));
    for (const p of real.hand!.currentTrick) publicas.add(cardId(p.card));

    for (const c of clientes) {
      const encontradas = new Set(cartasEm(JSON.parse(JSON.stringify(c.recebidas))).map(cardId));
      for (const outro of SEATS) {
        if (outro === c.seat) continue;
        for (const carta of real.hand!.hands[outro]) {
          // carta ainda OCULTA de outro assento: não pode ter aparecido nunca
          expect(
            encontradas.has(cardId(carta)),
            `assento ${c.seat} viu ${cardId(carta)}, que está na mão de ${outro}`,
          ).toBe(false);
        }
      }
      // e nada além de próprias/públicas jamais apareceu
      for (const id of encontradas) {
        const propriaAlgumaVez = real.hand!.hands[c.seat].some((x) => cardId(x) === id);
        expect(propriaAlgumaVez || publicas.has(id)).toBe(true);
      }
    }
  });

  it("a semente não cruza o fio em nenhuma mensagem", async () => {
    const { room, clientes } = await salaCom4();
    await iniciarPartida(clientes);
    const semente = room.autoridadeDaPartida().estadoAutoritativo()!.seed;
    for (const c of clientes) {
      expect(c.view!.seed).toBe(0);
      expect(JSON.stringify(c.recebidas)).not.toContain(String(semente));
    }
  });
});

// ═══════════════════ E · F · G · H · I · J — ações ═══════════════════

describe("E/F/G/H · jogadas legais e ilegais pelo protocolo", () => {
  it("E · PLAY_CARD legal move a carta e avança a versão para todos", async () => {
    const { room, clientes } = await salaCom4();
    await iniciarPartida(clientes);
    const c = daVez(clientes)!;
    const carta = legalCardsFor(c.view!, c.seat)[0];

    await jogarUma(clientes, c);

    expect(room.autoridadeDaPartida().stateVersion).toBe(2);
    for (const x of clientes) expect(x.versao).toBe(2);
    expect(c.view!.hand!.hands[c.seat].map(cardId)).not.toContain(cardId(carta));
    expect(c.view!.hand!.currentTrick).toHaveLength(1);
    expect(c.atualizacoes.at(-1)!.cause).toBe("CARD_PLAYED");
  });

  it("F · fora do turno: recusado, estado e versão intactos", async () => {
    const { room, clientes } = await salaCom4();
    await iniciarPartida(clientes);
    const c = daVez(clientes)!;
    const intruso = clientes.find((x) => x.seat !== c.seat)!;
    const versao = room.autoridadeDaPartida().stateVersion;

    intruso.sdk.send("CLIENT_PLAY_CARD", {
      actionId: "fora-de-turno",
      cardId: cardId(intruso.view!.hand!.hands[intruso.seat][0]),
    });
    await ate(() => intruso.rejeicoes.length > 0);

    expect(intruso.rejeicoes[0].code).toBe("NOT_YOUR_TURN");
    expect(room.autoridadeDaPartida().stateVersion).toBe(versao);
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.hand!.turn).toBe(c.seat);
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.hand!.currentTrick).toHaveLength(0);
  });

  it("G · carta que está na mão adversária: recusado, sem vazar de quem é", async () => {
    const { room, clientes } = await salaCom4();
    await iniciarPartida(clientes);
    const c = daVez(clientes)!;
    const outro = ((c.seat + 1) % 4) as Seat;
    // o TESTE conhece a mão alheia pelo servidor; o CLIENTE não conheceria
    const alheia = room.autoridadeDaPartida().estadoAutoritativo()!.hand!.hands[outro][0];
    const versao = room.autoridadeDaPartida().stateVersion;

    c.sdk.send("CLIENT_PLAY_CARD", { actionId: "carta-alheia", cardId: cardId(alheia) });
    await ate(() => c.rejeicoes.length > 0);

    expect(c.rejeicoes[0].code).toBe("CARD_NOT_OWNED");
    expect(c.rejeicoes[0].message).not.toContain(alheia.suit);
    expect(c.rejeicoes[0].message).not.toContain(String(outro));
    expect(room.autoridadeDaPartida().stateVersion).toBe(versao);
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.hand!.hands[outro]).toHaveLength(13);
  });

  it("H · baldar tendo o naipe puxado: recusado por ILLEGAL_CARD", async () => {
    const { room, clientes } = await salaCom4();
    await iniciarPartida(clientes);
    const lider = daVez(clientes)!;
    const naipe = legalCardsFor(lider.view!, lider.seat)[0].suit;
    await jogarUma(clientes, lider);

    const seguidor = daVez(clientes)!;
    const propria = seguidor.view!.hand!.hands[seguidor.seat];
    if (!propria.some((c) => c.suit === naipe)) return; // distribuição sem o naipe: caso não aplicável
    const fora = propria.find((c) => c.suit !== naipe);
    if (!fora) return;

    const versao = room.autoridadeDaPartida().stateVersion;
    seguidor.sdk.send("CLIENT_PLAY_CARD", { actionId: "balda-indevida", cardId: cardId(fora) });
    await ate(() => seguidor.rejeicoes.length > 0);

    expect(seguidor.rejeicoes[0].code).toBe("ILLEGAL_CARD");
    expect(room.autoridadeDaPartida().stateVersion).toBe(versao);
  });
});

describe("I/J · idempotência e versão pelo protocolo", () => {
  it("I · a MESMA actionId enviada duas vezes aplica a carta UMA vez", async () => {
    const { room, clientes } = await salaCom4();
    await iniciarPartida(clientes);
    const c = daVez(clientes)!;
    const carta = legalCardsFor(c.view!, c.seat)[0];
    const acao = { actionId: "duplicada-de-proposito", cardId: cardId(carta) };

    c.sdk.send("CLIENT_PLAY_CARD", acao);
    await ate(() => clientes.every((x) => x.versao === 2));
    const depois = room.autoridadeDaPartida().stateVersion;
    const atualizacoesAntes = c.atualizacoes.length;

    c.sdk.send("CLIENT_PLAY_CARD", acao); // exatamente a mesma
    await ate(() => c.atualizacoes.length > atualizacoesAntes);

    expect(room.autoridadeDaPartida().stateVersion).toBe(depois); // versão parada
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.hand!.currentTrick).toHaveLength(1);
    expect(c.atualizacoes.at(-1)!.cause).toBe("RESYNC"); // política: reenviar o estado a quem repetiu
    expect(c.rejeicoes).toHaveLength(0);
    // e o estado final é idêntico ao cenário sem duplicação
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.hand!.hands[c.seat]).toHaveLength(12);
  });

  it("J · expectedStateVersion atrasada vira STALE_ACTION sem efeito", async () => {
    const { room, clientes } = await salaCom4();
    await iniciarPartida(clientes);
    const c = daVez(clientes)!;
    const versao = room.autoridadeDaPartida().stateVersion;

    c.sdk.send("CLIENT_PLAY_CARD", {
      actionId: "atrasada",
      cardId: cardId(legalCardsFor(c.view!, c.seat)[0]),
      expectedStateVersion: versao - 1,
    });
    await ate(() => c.rejeicoes.length > 0);

    expect(c.rejeicoes[0].code).toBe("STALE_ACTION");
    expect(c.rejeicoes[0].stateVersion).toBe(versao); // o servidor devolve a versão corrente
    expect(room.autoridadeDaPartida().stateVersion).toBe(versao);
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.hand!.currentTrick).toHaveLength(0);
  });
});

// ═══════════════════ K · L · M · N — mão completa ═══════════════════

describe("K/L/M/N · Mão 1 completa (Não fazer Vazas) pelo protocolo", () => {
  it("13 vazas, 52 cartas, checksum −260 e quatro visões válidas", async () => {
    const { room, clientes } = await salaCom4();
    await iniciarPartida(clientes);

    let guard = 0;
    while (true) {
      if (++guard > 400) throw new Error("loop de segurança");
      const c = daVez(clientes);
      if (!c) break;
      await jogarUma(clientes, c);
      // a cada jogada, TODA visão continua limpa
      for (const x of clientes) exigirVisaoLimpa(x.view!, x.seat);
    }

    const real = room.autoridadeDaPartida().estadoAutoritativo()!;
    const h = real.hand!;

    expect(h.handScores).not.toBeNull();                    // a mão acabou
    expect(h.completedTricks).toHaveLength(13);             // M · 13 vazas
    expect(h.completedTricks.flatMap((t) => t.cards)).toHaveLength(52); // N · 52 cartas
    const ids = h.completedTricks.flatMap((t) => t.cards.map((p) => cardId(p.card)));
    expect(new Set(ids).size).toBe(52);                     // nenhuma duplicada
    for (const s of SEATS) expect(h.hands[s]).toHaveLength(0);
    expect(soma(h.handScores!)).toBe(-260);                 // L · checksum do contrato
    expect(soma(h.handScores!)).toBe(h.contract.handTotal); // e bate com o motor

    // as quatro visões continuam válidas e coerentes com o servidor
    for (const c of clientes) {
      expect(c.view!.hand!.handScores).toEqual(h.handScores);
      expect(c.view!.hand!.completedTricks).toHaveLength(13);
      expect(c.rejeicoes).toHaveLength(0);                  // nenhuma jogada ilegal no caminho
      exigirVisaoLimpa(c.view!, c.seat);
    }
  }, 60_000);
});
