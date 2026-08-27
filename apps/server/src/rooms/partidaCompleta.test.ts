// FASE 4 — PARTIDA COMPLETA governada pela KingRoom, do início ao GAME OVER.
//
// Quatro clientes sintéticos por WebSocket real, decidindo **só** com a própria PlayerView.
// Estratégia: primeira carta legal. Não é o Bot Normal, e não lê estado alheio.
//
// NOTA SOBRE OS INVARIANTES DE CONTAGEM
// Uma mão negativa termina assim que TODAS as suas cartas penalizadas foram capturadas
// (`match.ts` — encerramento antecipado, regra do KING). Logo:
//   M1 (Vazas), M2 (Copas), M6 (duas últimas) e M7–M10 (positivas) → sempre 13 vazas
//   M3 (Damas), M4 (Reis/Valetes), M5 (King)                       → PODEM terminar antes
// Medido em 200 partidas: o total de vazas vai de 111 a 130 (média 121,5), e só ~1% das
// partidas chega a 130. Portanto 130 vazas / 520 cartas é o TETO, não o invariante. O que É
// invariante — e o que este teste prova — é: vazas ≤ 13 por mão, cartas = 4 × vazas, e o total
// de cada mão sempre igual a `contract.handTotal`, porque o encerramento antecipado acontece
// exatamente quando todas as penalizadas já saíram.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import {
  cardId, legalCardsFor, trumpChooserFor,
  type Card, type PlayerView, type Rank, type Seat, type Suit, type Trump,
} from "@king/engine";
import { configurarTempos, restaurarTempos } from "../match/tempos.js";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import {
  PROTOCOL_VERSION,
  type AcaoRecusada, type AtualizacaoDeEstado, type EstadoDeConsenso,
} from "../protocol/index.js";
import { ASSENTOS, type KingRoom } from "./KingRoom.js";

const SEATS: Seat[] = [0, 1, 2, 3];
const soma = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);

/** Trunfos da partida sintética: naipes diferentes + SEM TRUNFO na M9. */
const TRUNFO_DA_MAO: Record<number, Trump> = {
  7: "hearts", 8: "diamonds", 9: "no-trump", 10: "spades",
};

let colyseus: ColyseusTestServer;
// Estes testes exercitam PROTOCOLO, não prazos. Sem encurtar o piso do Placar e os timeouts,
// cada avanço de mão custaria 8s reais e um turno lento viraria ação automática no meio do
// roteiro. Os prazos em si têm suíte própria (timeout.test.ts).
/**
 * UM BICHO DIFERENTE PARA CADA ASSENTO.
 *
 * Desde que avatar ocupado virou identidade PENDENTE, quatro humanos pedindo o mesmo avatar não
 * começam partida nenhuma — e é essa a regra, não um defeito. Um cliente de verdade resolve o
 * conflito no lobby; aqui basta cada assento pedir o seu.
 */
const avatarDoAssento = (seat: number) => AVATARES[seat % AVATARES.length];
beforeAll(async () => {
  configurarTempos({ pisoDoPlacar: 1, autoReadyDesconectado: 3_600_000, autoReadyConectado: 3_600_000, turno: 3_600_000, trunfo: 3_600_000, primeiraJogadaExtra: 0 });
  colyseus = await boot(servidor);
});
afterAll(() => restaurarTempos());
afterAll(async () => { await colyseus.shutdown(); });
beforeEach(async () => { await colyseus.cleanup(); });

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

async function ate(cond: () => boolean, ms = 15000, rotulo = "?"): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando: " + rotulo);
    await new Promise((r) => setTimeout(r, 0));
  }
}

interface Sintetico {
  seat: Seat;
  sdk: { send: (t: string, m?: unknown) => void; onMessage: (t: string, cb: (...a: never[]) => void) => void };
  view: PlayerView | null;
  versao: number;
  rejeicoes: AcaoRecusada[];
  consensos: EstadoDeConsenso[];
  versoesVistas: number[];
}

async function salaCom4(): Promise<{ room: KingRoom; clientes: Sintetico[] }> {
  const room = await colyseus.createRoom<KingRoom>(SALA_KING);
  const clientes: Sintetico[] = [];
  for (const seat of SEATS) {
    const sdk = await colyseus.connectTo(room, { protocolVersion: PROTOCOL_VERSION, nick: `P${seat}`, avatar: avatarDoAssento(seat) });
    const c: Sintetico = { seat, sdk: sdk as never, view: null, versao: 0, rejeicoes: [], consensos: [], versoesVistas: [] };
    sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => {
      c.view = m.view; c.versao = m.stateVersion; c.versoesVistas.push(m.stateVersion);
    });
    sdk.onMessage("ACTION_REJECTED", (m: AcaoRecusada) => c.rejeicoes.push(m));
    sdk.onMessage("READY_STATE", (m: EstadoDeConsenso) => c.consensos.push(m));
    clientes.push(c);
  }
  return { room, clientes };
}

let seq = 0;
const idAcao = (p: string) => `${p}-${++seq}`;

/** Espera o servidor parar de produzir efeito — usado depois de uma rajada. */
async function quiescencia(medir: () => string, estaveis = 25): Promise<void> {
  let anterior = "";
  let iguais = 0;
  const fim = Date.now() + 5000;
  while (iguais < estaveis) {
    if (Date.now() > fim) return;
    await new Promise((r) => setTimeout(r, 0));
    const agora = medir();
    iguais = agora === anterior ? iguais + 1 : 0;
    anterior = agora;
  }
}

/** Registro do que aconteceu em cada mão, montado só a partir do estado autoritativo. */
interface Registro {
  mao: number; kind: string; vazas: number; cartas: number;
  total: number; handTotal: number; trump: Trump | null; chooser: Seat | null;
}

/**
 * Joga a partida INTEIRA pelo protocolo. Devolve o registro por mão.
 * `aoLongoDoCaminho` é chamado a cada jogada para as verificações contínuas.
 */
async function jogarPartidaCompleta(
  room: KingRoom,
  clientes: Sintetico[],
  aoLongoDoCaminho?: (mao: number) => void,
): Promise<Registro[]> {
  const registros: Registro[] = [];
  let guard = 0;

  while (true) {
    if (++guard > 4000) throw new Error("loop de segurança da partida");
    const real = room.autoridadeDaPartida().estadoAutoritativo()!;
    const h = real.hand!;   // a saída é no ramo da mão encerrada, para a M10 ser registrada

    // 1) escolha de trunfo, quando o motor exige
    if (h.awaitingTrumpFrom !== null) {
      const escolhedor = clientes[h.awaitingTrumpFrom];
      const alvo = escolhedor.versao;
      escolhedor.sdk.send("CLIENT_SELECT_TRUMP", {
        actionId: idAcao("t"),
        trump: TRUNFO_DA_MAO[h.handNumber],
        expectedStateVersion: escolhedor.versao,
      });
      await ate(() => clientes.every((x) => x.versao > alvo), 15000, "trunfo mao "+h.handNumber);
      continue;
    }

    // 2) mão encerrada: consenso dos QUATRO para avançar
    if (h.handScores !== null) {
      registros.push({
        mao: h.handNumber,
        kind: h.contract.kind,
        vazas: h.completedTricks.length,
        cartas: h.completedTricks.reduce((n, t) => n + t.cards.length, 0),
        total: soma(h.handScores),
        handTotal: h.contract.handTotal,
        trump: h.trump,
        chooser: h.contract.isPositive ? trumpChooserFor(h.handNumber) : null,
      });
      if (h.handNumber === 10) break;

      const numeroAntes = h.handNumber;
      for (const c of clientes) c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: idAcao(`r${c.seat}`) });
      await ate(() => room.autoridadeDaPartida().estadoAutoritativo()!.handNumber > numeroAntes, 15000, "avanco da mao "+numeroAntes);
      await ate(() => clientes.every((x) => x.view!.handNumber > numeroAntes), 15000, "clientes na mao "+(numeroAntes+1));
      continue;
    }

    // 3) jogada normal
    const c = clientes.find((x) => x.view?.hand?.turn === x.seat && x.view.hand.handScores === null);
    if (!c) { await ate(() => false, 50).catch(() => undefined); continue; }
    const legais = legalCardsFor(c.view!, c.seat);
    expect(legais.length).toBeGreaterThan(0);
    const alvo = c.versao;
    c.sdk.send("CLIENT_PLAY_CARD", {
      actionId: idAcao(`p${c.seat}`),
      cardId: cardId(legais[0]),
      expectedStateVersion: c.versao,
    });
    await ate(() => clientes.every((x) => x.versao > alvo), 15000, "jogada mao "+h.handNumber+" vaza "+h.trickNumber);
    aoLongoDoCaminho?.(h.handNumber);
  }
  return registros;
}

/** Toda carta de uma visão é própria ou já pública. */
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
    expect(proprias.has(id) || publicas.has(id), `carta ${id} na visão do assento ${seat}`).toBe(true);
  }
  for (const outro of SEATS) if (outro !== seat) expect(v.hand?.hands[outro] ?? []).toEqual([]);
}

// ═══════════════════════════ A PARTIDA INTEIRA ═══════════════════════════

describe("partida completa autoritativa — 10 mãos até o GAME OVER", () => {
  it(
    "10 mãos, checksums por contrato, −1300 / +1300 / 0 e nenhum vazamento no caminho",
    async () => {
      const { room, clientes } = await salaCom4();
      for (const c of clientes) c.sdk.send("CLIENT_SET_READY", { ready: true });
      await ate(() => clientes.every((c) => c.view !== null), 15000, "inicio da partida");

      // verificação CONTÍNUA: a cada jogada, as quatro visões continuam limpas
      const maosAuditadas = new Set<number>();
      const registros = await jogarPartidaCompleta(room, clientes, (mao) => {
        for (const c of clientes) exigirVisaoLimpa(c.view!, c.seat);
        maosAuditadas.add(mao);
      });

      const real = room.autoridadeDaPartida().estadoAutoritativo()!;

      // ── R · 10 mãos ────────────────────────────────────────────────────
      expect(registros).toHaveLength(10);
      expect(registros.map((r) => r.mao)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(real.history).toHaveLength(10);

      // ── A–F · cada mão negativa fecha no total do seu contrato ─────────
      const esperado: Record<number, number> = {
        1: -260, 2: -260, 3: -200, 4: -240, 5: -160, 6: -180,
        7: 325, 8: 325, 9: 325, 10: 325,
      };
      for (const r of registros) {
        expect(r.total, `mão ${r.mao} (${r.kind})`).toBe(esperado[r.mao]);
        expect(r.total).toBe(r.handTotal);          // e bate com o motor
        expect(r.vazas).toBeGreaterThan(0);
        expect(r.vazas).toBeLessThanOrEqual(13);    // teto, nunca ultrapassado
        expect(r.cartas).toBe(r.vazas * 4);         // invariante real de contagem
      }

      // mãos que NUNCA encerram antes: toda vaza é penalizada, ou é positiva
      for (const n of [1, 2, 6, 7, 8, 9, 10]) {
        expect(registros[n - 1].vazas, `mão ${n} deve ir até a 13ª`).toBe(13);
        expect(registros[n - 1].cartas).toBe(52);
      }

      // ── G/Q/U · checksums ──────────────────────────────────────────────
      expect(soma(registros.slice(0, 6).map((r) => r.total))).toBe(-1300);
      expect(soma(registros.slice(6).map((r) => r.total))).toBe(1300);
      expect(soma(real.negatives)).toBe(-1300);
      expect(soma(real.positives)).toBe(1300);
      expect(soma(real.cumulative)).toBe(0);

      // ── S/T · totais de vaza e carta ──────────────────────────────────
      const vazas = soma(registros.map((r) => r.vazas));
      const cartas = soma(registros.map((r) => r.cartas));
      expect(cartas).toBe(vazas * 4);
      expect(vazas).toBeLessThanOrEqual(130);
      expect(vazas).toBeGreaterThanOrEqual(7 * 13);   // as 7 mãos que sempre vão até a 13ª
      expect(cartas).toBeLessThanOrEqual(520);

      // ── I–M · choosers: rotação do motor, cada assento exatamente uma vez ──
      const choosers = registros.slice(6).map((r) => r.chooser);
      expect(choosers).toEqual([0, 1, 2, 3]);
      expect(new Set(choosers).size).toBe(ASSENTOS);
      for (const n of [7, 8, 9, 10]) {
        expect(real.history[n - 1].chooser).toBe(trumpChooserFor(n));
      }

      // ── N/O · trunfos, incluindo Sem Trunfo ───────────────────────────
      expect(registros.slice(6).map((r) => r.trump)).toEqual(["hearts", "diamonds", "no-trump", "spades"]);
      const semTrunfo = registros.find((r) => r.trump === "no-trump")!;
      expect(semTrunfo.mao).toBe(9);
      expect(semTrunfo.vazas).toBe(13);           // mão inteira jogada em Sem Trunfo
      expect(semTrunfo.cartas).toBe(52);
      expect(semTrunfo.total).toBe(325);

      // ── AB · a auditoria contínua cobriu negativa, positiva com naipe e Sem Trunfo ──
      expect(maosAuditadas.has(1)).toBe(true);
      expect(maosAuditadas.has(7)).toBe(true);
      expect(maosAuditadas.has(9)).toBe(true);
      expect(maosAuditadas.size).toBe(10);

      // ── AC · stateVersion monotônica, nunca decrescente ───────────────
      for (const c of clientes) {
        for (let i = 1; i < c.versoesVistas.length; i++) {
          expect(c.versoesVistas[i]).toBeGreaterThanOrEqual(c.versoesVistas[i - 1]);
        }
        expect(c.versao).toBe(room.autoridadeDaPartida().stateVersion);
        expect(c.rejeicoes).toHaveLength(0);   // nenhuma ação legal foi rejeitada
      }

      // ── V/W · GAME OVER: nada cria a mão 11 ───────────────────────────
      expect(real.finished).toBe(true);
      expect(real.handNumber).toBe(10);
      const versaoFinal = room.autoridadeDaPartida().stateVersion;

      for (const c of clientes) c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: idAcao("pos") });
      const c0 = clientes[0];
      c0.sdk.send("CLIENT_PLAY_CARD", { actionId: idAcao("pos"), cardId: "A-spades" });
      c0.sdk.send("CLIENT_SELECT_TRUMP", { actionId: idAcao("pos"), trump: "hearts" });
      await ate(() => c0.rejeicoes.length >= 3, 15000, "recusas pos-GAME OVER (tem "+c0.rejeicoes.length+")");

      expect(room.autoridadeDaPartida().estadoAutoritativo()!.handNumber).toBe(10);
      expect(room.autoridadeDaPartida().estadoAutoritativo()!.history).toHaveLength(10);
      expect(room.autoridadeDaPartida().stateVersion).toBe(versaoFinal);
      for (const c of clientes) {
        expect(c.rejeicoes.every((r) => r.code === "WRONG_PHASE")).toBe(true);
      }
      expect(soma(room.autoridadeDaPartida().estadoAutoritativo()!.cumulative)).toBe(0);
    },
    180_000,
  );
});

// ═══════════════════════ consenso pelo protocolo ═══════════════════════

describe("X/Y/Z/AA · consenso entre-mãos pelo protocolo real", () => {
  /** Leva a sala até o fim da mão 1. */
  async function ateFimDaMao1(): Promise<{ room: KingRoom; clientes: Sintetico[] }> {
    const { room, clientes } = await salaCom4();
    for (const c of clientes) c.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => clientes.every((c) => c.view !== null));
    let guard = 0;
    while (room.autoridadeDaPartida().estadoAutoritativo()!.hand!.handScores === null) {
      if (++guard > 200) throw new Error("loop");
      const c = clientes.find((x) => x.view?.hand?.turn === x.seat)!;
      const alvo = c.versao;
      c.sdk.send("CLIENT_PLAY_CARD", { actionId: idAcao(`m1-${c.seat}`), cardId: cardId(legalCardsFor(c.view!, c.seat)[0]) });
      await ate(() => clientes.every((x) => x.versao > alvo));
    }
    return { room, clientes };
  }

  it("X/Y · 1, 2 e 3 prontos não avançam; o quarto avança uma única vez", async () => {
    const { room, clientes } = await ateFimDaMao1();
    const versao = room.autoridadeDaPartida().stateVersion;

    for (const s of [0, 1, 2] as Seat[]) {
      const antes = clientes[0].consensos.length;
      clientes[s].sdk.send("CLIENT_READY_NEXT_HAND", { actionId: idAcao(`x${s}`) });
      await ate(() => clientes[0].consensos.length > antes);
      expect(room.autoridadeDaPartida().estadoAutoritativo()!.handNumber).toBe(1);
      expect(room.autoridadeDaPartida().stateVersion).toBe(versao);
    }
    expect(clientes[0].consensos.at(-1)!.ready).toEqual([0, 1, 2]);
    expect(clientes[0].consensos.at(-1)!.handNumber).toBe(1);

    clientes[3].sdk.send("CLIENT_READY_NEXT_HAND", { actionId: idAcao("x3") });
    await ate(() => room.autoridadeDaPartida().estadoAutoritativo()!.handNumber === 2);
    expect(room.autoridadeDaPartida().stateVersion).toBe(versao + 1);
    await ate(() => clientes.every((c) => c.view!.handNumber === 2));
    for (const c of clientes) {
      expect(c.view!.hand!.hands[c.seat]).toHaveLength(13); // novo deal
      exigirVisaoLimpa(c.view!, c.seat);
    }
  }, 60_000);

  it("Z/15 · rajada de prontos duplicados avança UMA mão só — nunca M1→M3", async () => {
    const { room, clientes } = await ateFimDaMao1();
    const versao = room.autoridadeDaPartida().stateVersion;

    // cada cliente manda três vezes, quase simultaneamente
    for (let i = 0; i < 3; i++) {
      for (const c of clientes) c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: idAcao(`z${c.seat}-${i}`) });
    }
    await ate(() => room.autoridadeDaPartida().estadoAutoritativo()!.handNumber === 2);
    // as 12 mensagens precisam ser todas drenadas antes de afirmar qualquer coisa
    const a = room.autoridadeDaPartida();
    await quiescencia(() => `${a.estadoAutoritativo()!.handNumber}:${a.stateVersion}:${clientes.reduce((n, c) => n + c.rejeicoes.length, 0)}`);

    expect(a.estadoAutoritativo()!.handNumber).toBe(2); // NÃO pulou para 3
    expect(a.stateVersion).toBe(versao + 1);            // exatamente UM avanço
    expect(a.estadoAutoritativo()!.history).toHaveLength(1);
    // Nem todo cliente recebe recusa: as mensagens de um mesmo socket chegam em lote, então o
    // consenso pode fechar antes de os retardatários dos outros serem processados. O que precisa
    // valer é: sobrou pedido, e TODO pedido que sobrou foi recusado com o mesmo motivo.
    const recusas = clientes.flatMap((c) => c.rejeicoes);
    expect(recusas.length).toBeGreaterThan(0);
    expect(recusas.every((r) => r.code === "HAND_NOT_OVER")).toBe(true);
  }, 60_000);

  it("AA/16 · ação atrasada da mão anterior não afeta a mão nova", async () => {
    const { room, clientes } = await ateFimDaMao1();
    const versaoDaMao1 = room.autoridadeDaPartida().stateVersion;

    for (const c of clientes) c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: idAcao("aa") });
    await ate(() => room.autoridadeDaPartida().estadoAutoritativo()!.handNumber === 2);
    await ate(() => clientes.every((c) => c.view!.handNumber === 2));

    const antes = JSON.stringify(room.autoridadeDaPartida().estadoAutoritativo());
    const versaoAgora = room.autoridadeDaPartida().stateVersion;
    const c0 = clientes[0];
    const rejeicoesAntes = c0.rejeicoes.length;

    // PLAY_CARD carregando a versão da mão ANTERIOR — é o que um cliente atrasado enviaria
    c0.sdk.send("CLIENT_PLAY_CARD", {
      actionId: idAcao("atrasada"),
      cardId: cardId(c0.view!.hand!.hands[c0.seat][0]),
      expectedStateVersion: versaoDaMao1 - 1,
    });
    await ate(() => c0.rejeicoes.length > rejeicoesAntes);

    expect(c0.rejeicoes.at(-1)!.code).toBe("STALE_ACTION");
    expect(room.autoridadeDaPartida().stateVersion).toBe(versaoAgora);
    expect(JSON.stringify(room.autoridadeDaPartida().estadoAutoritativo())).toBe(antes);
  }, 60_000);
});
