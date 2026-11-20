// O PLACAR DA MÃO DO REI FICA PARA SER LIDO — no servidor de verdade, pelo protocolo.
//
// ══ O DEFEITO ══
//
// O piso do Placar (8s) conta do fim da mão. Na mão 5 a mesa fica 6,5s parada na cena "O REI FOI
// CAPTURADO" antes de o Placar entrar: sobrava ~1,5s de Placar. Quem confirmava por reflexo
// via a tela sumir antes de ler quem perdeu os 160.
//
// ══ O QUE ESTES TESTES TRAVAM ══
//
//   1. a mão 6 não começa antes do piso do Rei, mesmo com os quatro prontos no PRIMEIRO instante —
//      e "os quatro" inclui um cliente ANTIGO: ele manda a mesma mensagem, o protocolo é o mesmo;
//   2. as outras mãos continuam com o piso de sempre (nada de 11,5s nas mãos 1–4 e 6);
//   3. o auto-ready não encurta o piso: quem não confirma vira pronto, mas não antes dele;
//   4. numa mesa mista, os bots ficam prontos na hora e NÃO jogam a mão 6 por trás do Placar;
//   5. uma reconexão no meio não reinicia o piso (nem trava a mesa) — e não reabre a cena;
//   6. quando a mão 6 abre, quem joga primeiro recebe o prazo INTEIRO.
//
// Valores de PRODUÇÃO para o que se mede (piso do Rei, pausa do King); o resto é encurtado só para
// as quatro mãos anteriores não custarem minutos.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { cardId, legalCardsFor, type PlayerView, type Seat } from "@king/engine";
import { configurarTempos, restaurarTempos, TEMPOS_PADRAO } from "../match/tempos.js";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import {
  PROTOCOL_VERSION,
  type AcaoAutomatica, type AtualizacaoDeEstado, type BoasVindas, type RelogioDaDecisao,
} from "../protocol/index.js";
import { ASSENTOS, type KingRoom } from "./KingRoom.js";
import { normalizarCodigo } from "./codigos.js";

const MAO_DO_REI = 5;
const PISO_DO_REI = TEMPOS_PADRAO.pisoDoPlacarDoRei;
const PAUSA_DO_KING = TEMPOS_PADRAO.leituraDaVazaKing;
/** A meta do produto: leitura REAL do Placar depois da cena. */
const META_DE_LEITURA = 4_600;
/** Piso geral encurtado: distinguível do do Rei, barato para as mãos 1–4. */
const PISO_GERAL = 300;
const TURNO = 20_000;
const HORA = 3_600_000;

const BASE = {
  turno: TURNO, primeiraJogadaExtra: 0, trunfo: 30_000,
  aviso: 5_000, critico: 2_000,
  pisoDoPlacar: PISO_GERAL, pisoDoPlacarDoRei: PISO_DO_REI,
  autoReadyDesconectado: HORA, autoReadyConectado: HORA,
  cortesiaDoBot: 5, lobbyReservaAposQueda: HORA, salaOrfa: HORA,
  aberturaDaUltimaMao: 0,
};

let colyseus: ColyseusTestServer;
beforeAll(async () => { colyseus = await boot(servidor); });
afterAll(async () => { await colyseus.shutdown(); });
beforeEach(async () => { proximoAvatar = 0; configurarTempos(BASE); await colyseus.cleanup(); });
afterEach(() => restaurarTempos());

async function ate(cond: () => boolean, ms = 20_000, rotulo = "?"): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando: " + rotulo);
    await new Promise((r) => setTimeout(r, 1));
  }
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SdkRoom {
  send(t: string, m?: unknown): void;
  onMessage(t: string, cb: (...a: never[]) => void): void;
  leave(consented?: boolean): Promise<number>;
}
interface Cliente {
  sdk: SdkRoom; seat: Seat; credencial: string; boasVindas: BoasVindas | null;
  view: PlayerView | null; versao: number; relogios: RelogioDaDecisao[];
  automaticas: { m: AcaoAutomatica; em: number }[];
  /** Causas dos STATE_UPDATE recebidos — RECONNECTED é o salto que NÃO reabre a cena. */
  causas: string[];
}

function escutar(sdk: SdkRoom, base?: Cliente): Cliente {
  const c: Cliente = base ?? {
    sdk, seat: 0 as Seat, credencial: "", boasVindas: null, view: null, versao: 0,
    relogios: [], automaticas: [], causas: [],
  };
  c.sdk = sdk;
  sdk.onMessage("SERVER_WELCOME", (m: BoasVindas) => {
    c.boasVindas = m; c.seat = m.you.seat; c.credencial = m.you.recoveryToken;
  });
  sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => {
    c.view = m.view; c.versao = m.stateVersion; c.causas.push(m.cause);
  });
  sdk.onMessage("TURN_CLOCK", (m: RelogioDaDecisao) => c.relogios.push(m));
  sdk.onMessage("AUTO_ACTION", (m: AcaoAutomatica) => c.automaticas.push({ m, em: Date.now() }));
  for (const t of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "SERVER_ERROR",
    "READY_STATE", "ACTION_REJECTED", "SOCIAL_MESSAGE"]) sdk.onMessage(t, () => {});
  return c;
}

let proximoAvatar = 0;
const opcoes = (nick: string) =>
  ({ protocolVersion: PROTOCOL_VERSION, nick, avatar: AVATARES[proximoAvatar++ % AVATARES.length] });

/** `humanos` pessoas pelo protocolo; os assentos restantes viram bots do anfitrião. */
async function mesa(humanos: number): Promise<{ room: KingRoom; todos: Cliente[] }> {
  const dono = escutar((await colyseus.sdk.create(SALA_KING, opcoes("P0"))) as unknown as SdkRoom);
  await ate(() => dono.boasVindas !== null, 10_000, "welcome P0");
  const codigo = dono.boasVindas!.roomCode;
  const todos = [dono];
  for (let i = 1; i < humanos; i++) {
    const c = escutar((await colyseus.sdk.joinById(normalizarCodigo(codigo), opcoes(`P${i}`))) as unknown as SdkRoom);
    await ate(() => c.boasVindas !== null, 10_000, `welcome P${i}`);
    todos.push(c);
  }
  const room = colyseus.getRoomById<KingRoom>(codigo);
  for (let seat = humanos; seat < ASSENTOS; seat++) {
    dono.sdk.send("CLIENT_ADD_BOT", { seat });
    await ate(() => room.state.seats[seat].bot, 10_000, `bot no ${seat}`);
  }
  for (const c of todos) c.sdk.send("CLIENT_SET_READY", { ready: true });
  await ate(() => todos.every((c) => c.view !== null), 10_000, "início");
  return { room, todos };
}

const real = (room: KingRoom) => room.autoridadeDaPartida().estadoAutoritativo()!;
const versao = (room: KingRoom) => room.autoridadeDaPartida().stateVersion;

let seq = 0;
/** Todos os humanos confirmam a próxima mão — exatamente o que um cliente ANTIGO também manda. */
function todosConfirmam(todos: Cliente[]): void {
  for (const c of todos) c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: `r${c.seat}-${++seq}`, ready: true });
}

/**
 * Joga pelo protocolo até a mão `alvo` ACABAR, e devolve quanto cada Placar anterior durou
 * (confirmação imediata dos humanos → avanço). Bots jogam pelo servidor.
 */
async function ateOFimDaMao(room: KingRoom, todos: Cliente[], alvo: number): Promise<Map<number, number>> {
  const placares = new Map<number, number>();
  for (let guarda = 0; guarda < 4000; guarda++) {
    const h = real(room).hand!;
    if (h.handScores !== null) {
      if (h.handNumber === alvo) return placares;
      const t0 = Date.now();
      todosConfirmam(todos);
      await ate(() => real(room).hand!.handNumber > h.handNumber, 30_000, `avanço da mão ${h.handNumber}`);
      placares.set(h.handNumber, Date.now() - t0);
      continue;
    }
    if (h.awaitingTrumpFrom !== null) { await dormir(1); continue; }
    const c = todos.find((x) => x.seat === h.turn);
    if (!c) { await dormir(1); continue; } // vez de bot: o servidor joga
    const v = versao(room);
    await ate(() => c.versao === v && c.view?.hand?.turn === c.seat, 10_000, "visão alcançar o turno");
    c.sdk.send("CLIENT_PLAY_CARD", { actionId: `p${++seq}`, cardId: cardId(legalCardsFor(c.view!, c.seat)[0]) });
    await ate(() => versao(room) > v, 10_000, "jogada");
  }
  throw new Error("loop de segurança");
}

describe("a mão do Rei segura o Placar; as outras não", () => {
  it("quatro prontos no primeiro instante (cliente novo OU antigo): a mão 6 só começa depois do piso do Rei", async () => {
    const { room, todos } = await mesa(4);
    const antes = await ateOFimDaMao(room, todos, MAO_DO_REI);
    const fim = Date.now();
    expect(real(room).hand!.contract.kind).toBe("no-king");

    // AS QUATRO MÃOS ANTERIORES: o piso de sempre, nada do Rei.
    for (const [mao, ms] of antes) {
      expect(ms, `mão ${mao} segurou ${ms}ms — o piso do Rei vazou para ela`).toBeLessThan(PISO_GERAL + 2_500);
    }

    // Os quatro confirmam JÁ — é o reflexo que encurtava a leitura.
    todosConfirmam(todos);
    await dormir(PISO_DO_REI - 600);
    expect(real(room).hand!.handNumber, "a mão 6 começou antes do piso do Rei").toBe(MAO_DO_REI);
    expect(real(room).hand!.handScores).not.toBeNull();

    await ate(() => real(room).hand!.handNumber === MAO_DO_REI + 1, 20_000, "mão 6");
    const segurou = Date.now() - fim;
    // A META: a cena (6,5s) e mais 4,6s de Placar, contados do fim da mão no servidor.
    expect(segurou, `Placar do Rei durou ${segurou - PAUSA_DO_KING}ms depois da cena`)
      .toBeGreaterThanOrEqual(PAUSA_DO_KING + META_DE_LEITURA);
    expect(segurou).toBeGreaterThanOrEqual(PISO_DO_REI - 50);
    // E não virou espera: só a cadência da vaza final pode somar algo.
    expect(segurou).toBeLessThan(PISO_DO_REI + 3_000);

    // A MÃO 6 VOLTA AO PISO DE SEMPRE.
    const depois = await ateOFimDaMao(room, todos, MAO_DO_REI + 1);
    expect(depois.size).toBe(0);
    const t6 = Date.now();
    todosConfirmam(todos);
    await ate(() => real(room).hand!.handNumber === MAO_DO_REI + 2, 20_000, "mão 7");
    expect(Date.now() - t6, "a mão 6 herdou o piso do Rei").toBeLessThan(PISO_GERAL + 2_500);
  }, 180_000);

  it("auto-ready não encurta o piso: ninguém confirma, todos viram prontos — mas só depois dele", async () => {
    // Auto-ready quase imediato: se ele mandasse, a mão viraria em ~200ms. (O prazo é armado no
    // fim da mão, por isso vale desde o começo; nas mãos 1–4 ele só corre junto da confirmação.)
    configurarTempos({ autoReadyConectado: 200, autoReadyDesconectado: 200 });
    const { room, todos } = await mesa(4);
    await ateOFimDaMao(room, todos, MAO_DO_REI);
    const fim = Date.now();

    await ate(() => real(room).hand!.handNumber === MAO_DO_REI + 1, 30_000, "mão 6 por auto-ready");
    expect(Date.now() - fim).toBeGreaterThanOrEqual(PISO_DO_REI - 50);
    const autos = todos[0].automaticas.filter((a) => a.m.tipo === "READY" && a.em >= fim);
    expect(autos.length, "o avanço não veio do auto-ready").toBe(4);
    for (const a of autos) expect(a.em - fim, "auto-ready antes do piso do Rei").toBeGreaterThanOrEqual(PISO_DO_REI - 50);
  }, 180_000);

  it("mesa mista: bots prontos na hora, mas nenhum bot joga a mão 6 por trás do Placar", async () => {
    const { room, todos } = await mesa(2);
    await ateOFimDaMao(room, todos, MAO_DO_REI);
    const fim = Date.now();
    todosConfirmam(todos);

    // Amostra o servidor durante TODO o piso: a mão continua a 5, encerrada, sem carta da 6.
    while (Date.now() - fim < PISO_DO_REI - 300) {
      const h = real(room).hand!;
      expect(h.handNumber, "a mão 6 abriu atrás do Placar do Rei").toBe(MAO_DO_REI);
      expect(h.handScores).not.toBeNull();
      await dormir(50);
    }
    await ate(() => real(room).hand!.handNumber === MAO_DO_REI + 1, 20_000, "mão 6");
    expect(Date.now() - fim).toBeGreaterThanOrEqual(PISO_DO_REI - 50);
  }, 180_000);
});

describe("reconexão e prazo da mão seguinte", () => {
  it("cair e voltar no meio do Placar do Rei não reinicia o piso — nem trava a mesa", async () => {
    const { room, todos } = await mesa(4);
    await ateOFimDaMao(room, todos, MAO_DO_REI);
    const fim = Date.now();
    todosConfirmam(todos);

    // No meio da cena: o assento 2 cai e volta.
    await dormir(4_000);
    const c = todos[2];
    // A sala já está no ar há mais que o `minUptime` do SDK: sem isto, `leave(false)` dispara a
    // reconexão AUTOMÁTICA do próprio SDK e a promessa nunca resolve (travou a 1ª versão daqui).
    // A volta é feita à mão logo abaixo, como em `reconexao.test.ts`.
    (c.sdk as unknown as { reconnection: { enabled: boolean } }).reconnection.enabled = false;
    await c.sdk.leave(false);
    c.boasVindas = null;
    const causasAntes = c.causas.length;
    escutar((await colyseus.sdk.reconnect(c.credencial)) as unknown as SdkRoom, c);
    await ate(() => c.boasVindas !== null, 10_000, "welcome do retorno");
    // A volta é um SALTO (RECONNECTED): o cliente limpa o castigo e não reabre a cena do Rei.
    await ate(() => c.causas.length > causasAntes, 10_000, "estado do retorno");
    expect(c.causas[causasAntes]).toBe("RECONNECTED");
    expect(c.view!.hand!.handScores, "quem volta cai direto no Placar").not.toBeNull();

    await ate(() => real(room).hand!.handNumber === MAO_DO_REI + 1, 25_000, "mão 6 depois da reconexão");
    const segurou = Date.now() - fim;
    expect(segurou).toBeGreaterThanOrEqual(PISO_DO_REI - 50);
    // Se a reconexão reiniciasse a contagem, seriam ≥ 4s + 11,5s. A folga de 3s é a cadência da
    // vaza final (fila do cliente), que pode atrasar a entrada do K♥ na mesa.
    expect(segurou, "a reconexão reiniciou o piso do Rei").toBeLessThan(PISO_DO_REI + 3_000);
  }, 180_000);

  it("a primeira decisão da mão 6 nasce com o prazo inteiro — o Placar não come tempo de ninguém", async () => {
    const { room, todos } = await mesa(4);
    await ateOFimDaMao(room, todos, MAO_DO_REI);
    todosConfirmam(todos);
    await ate(() => real(room).hand!.handNumber === MAO_DO_REI + 1, 20_000, "mão 6");
    await ate(() => todos.every((c) => c.relogios.length > 0 && c.relogios[c.relogios.length - 1].tipo !== "READY"),
      10_000, "relógio da mão 6");
    const r = todos[0].relogios[todos[0].relogios.length - 1];
    expect(r.tipo).toBe("PLAY");
    expect(r.restanteMs, `a mão 6 abriu com ${r.restanteMs}ms de ${TURNO}`).toBeGreaterThanOrEqual(TURNO - 500);
  }, 180_000);
});
