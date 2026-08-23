// MESA MISTA — humanos + BOT NORMAL na sala privada.
//
// A mesa tem sempre QUATRO assentos, mas não exige quatro pessoas. As composições oficiais são
// 4 humanos, 3+1 e 2+2. **1 humano + 3 bots não inicia**: uma sala privada com um humano só não
// é multiplayer, é o modo local com passos a mais — e esse já existe, sem servidor nenhum.
//
// O que estes testes protegem, em ordem de importância:
//
//   1. AUTORIZAÇÃO NO SERVIDOR. Esconder o botão de quem não é anfitrião é apresentação. Aqui a
//      mensagem é enviada de propósito por quem não pode, e tem de ser recusada.
//   2. COMPOSIÇÃO. O piso de dois humanos não pode ser contornado por ordem de cliques.
//   3. READY. Bot não clica em nada; humano clica. A partida só começa com todos os humanos.
//   4. FRONTEIRA. O bot do servidor decide pela visão redigida, como qualquer jogador.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { cardId, legalCardsFor, type Seat } from "@king/engine";
import { configurarTempos, restaurarTempos } from "../match/tempos.js";
import { SALA_KING, servidor } from "../app.js";
import { PROTOCOL_VERSION, type AcaoRecusada, type AtualizacaoDeEstado, type BoasVindas } from "../protocol/index.js";
import { ASSENTOS, MIN_HUMANOS } from "./KingRoom.js";

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  // Estes testes exercitam COMPOSIÇÃO e AUTORIZAÇÃO, não prazos. Sem encurtar o piso do Placar,
  // cada mão custaria 8s reais; sem alongar os turnos, o relógio agiria no meio do roteiro.
  configurarTempos({
    pisoDoPlacar: 1, autoReadyDesconectado: 3_600_000, autoReadyConectado: 3_600_000,
    turno: 3_600_000, trunfo: 3_600_000, primeiraJogadaExtra: 0, cortesiaDoBot: 1,
  });
  colyseus = await boot(servidor);
});
afterAll(() => restaurarTempos());
afterAll(async () => { await colyseus.shutdown(); });
beforeEach(async () => { await colyseus.cleanup(); });

async function ate(cond: () => boolean, ms = 10_000, rotulo = "?"): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando: " + rotulo);
    await new Promise((r) => setTimeout(r, 0));
  }
}

interface AssentoView {
  seat: number; playerId: string; nick: string;
  connected: boolean; ready: boolean; assisted: boolean; bot: boolean; host: boolean;
}
interface SalaView { roomCode: string; status: string; seats: AssentoView[] }
interface SdkRoom {
  roomId: string; state: SalaView;
  send(tipo: string, msg?: unknown): void;
  onMessage(tipo: string, cb: (...a: never[]) => void): void;
  leave(consented?: boolean): Promise<number>;
}
interface Cliente {
  sdk: SdkRoom; boasVindas: BoasVindas | null;
  view: AtualizacaoDeEstado["view"] | null; rejeicoes: AcaoRecusada[];
  /** Versão do último STATE_UPDATE recebido. É o que impede mandar duas jogadas pelo mesmo estado. */
  versao: number;
  /**
   * Reage ao STATE_UPDATE assim que ele chega, em vez de esperar o próximo giro de um laço.
   *
   * Uma partida completa são ~520 idas e voltas. Dirigir isso por polling custa pelo menos 1ms
   * de espera por passo mesmo quando a resposta já chegou — meio segundo de latência inventada,
   * que numa máquina lenta (o runner do CI tem 2 vCPU e roda servidor e clientes no MESMO
   * processo) vira a diferença entre passar e estourar o prazo.
   */
  aoAtualizar?: (c: Cliente) => void;
}

function escutar(sdk: SdkRoom): Cliente {
  const c: Cliente = { sdk, boasVindas: null, view: null, rejeicoes: [], versao: -1 };
  sdk.onMessage("SERVER_WELCOME", (m: BoasVindas) => { c.boasVindas = m; });
  sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => {
    c.view = m.view; c.versao = m.stateVersion;
    c.aoAtualizar?.(c);
  });
  sdk.onMessage("ACTION_REJECTED", (m: AcaoRecusada) => c.rejeicoes.push(m));
  for (const t of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "SERVER_ERROR",
    "READY_STATE", "TURN_CLOCK", "AUTO_ACTION"]) sdk.onMessage(t, () => {});
  return c;
}

const opcoes = (nick: string) => ({ protocolVersion: PROTOCOL_VERSION, nick });

async function criarSala(nick = "Anfitriao"): Promise<{ dono: Cliente; codigo: string }> {
  const sdk = (await colyseus.sdk.create(SALA_KING, opcoes(nick))) as unknown as SdkRoom;
  const dono = escutar(sdk);
  await ate(() => dono.boasVindas !== null, 8000, "SERVER_WELCOME do anfitriao");
  return { dono, codigo: dono.boasVindas!.roomCode };
}

async function entrar(codigo: string, nick: string): Promise<Cliente> {
  const sdk = (await colyseus.sdk.joinById(codigo, opcoes(nick))) as unknown as SdkRoom;
  const c = escutar(sdk);
  await ate(() => c.boasVindas !== null, 8000, "SERVER_WELCOME de " + nick);
  return c;
}

/** Estado público visto pelo cliente, depois do patch. */
const sala = (c: Cliente): SalaView => c.sdk.state;
const assentosDe = (c: Cliente): AssentoView[] => [...sala(c).seats];
const ocupados = (c: Cliente) => assentosDe(c).filter((a) => a.playerId !== "").length;
const humanos = (c: Cliente) => assentosDe(c).filter((a) => a.playerId !== "" && !a.bot).length;
const bots = (c: Cliente) => assentosDe(c).filter((a) => a.bot).length;
const primeiroLivre = (c: Cliente): number => assentosDe(c).findIndex((a) => a.playerId === "");

async function addBot(c: Cliente, seat: number): Promise<void> {
  const antes = bots(c);
  c.sdk.send("CLIENT_ADD_BOT", { seat });
  await ate(() => bots(c) > antes, 8000, `bot no assento ${seat}`);
}

// ═══════════════════ 1 · AUTORIZAÇÃO ═══════════════════

describe("1 · só o anfitrião mexe nos bots", () => {
  it("o primeiro a entrar é o anfitrião, e só ele", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");

    expect(assentosDe(dono)[0].host).toBe(true);
    expect(assentosDe(dono).filter((a) => a.host)).toHaveLength(1);
    expect(assentosDe(raiza)[1].host).toBe(false);
  });

  it("NÃO-ANFITRIÃO que envia a mensagem direto é RECUSADO pelo servidor", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");

    // Raiza não é anfitriã. A interface esconderia o botão; aqui a mensagem vai assim mesmo.
    raiza.sdk.send("CLIENT_ADD_BOT", { seat: 2 });
    await ate(() => raiza.rejeicoes.length > 0, 8000, "recusa do add");
    expect(raiza.rejeicoes[0].code).toBe("NOT_HOST");
    expect(bots(dono)).toBe(0);

    // e o anfitrião consegue
    await addBot(dono, 2);
    expect(bots(dono)).toBe(1);

    // remover também é só dele
    raiza.sdk.send("CLIENT_REMOVE_BOT", { seat: 2 });
    await ate(() => raiza.rejeicoes.length > 1, 8000, "recusa do remove");
    expect(raiza.rejeicoes[1].code).toBe("NOT_HOST");
    expect(bots(dono)).toBe(1); // o bot continua lá
  });

  it("o anfitrião não pode adicionar bot em assento ocupado nem remover humano", async () => {
    const { dono, codigo } = await criarSala("Tito");
    await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");

    dono.sdk.send("CLIENT_ADD_BOT", { seat: 1 }); // assento da Raiza
    await ate(() => dono.rejeicoes.length > 0, 8000, "recusa SEAT_TAKEN");
    expect(dono.rejeicoes[0].code).toBe("SEAT_TAKEN");

    dono.sdk.send("CLIENT_REMOVE_BOT", { seat: 1 }); // humano, não bot
    await ate(() => dono.rejeicoes.length > 1, 8000, "recusa NOT_A_BOT");
    expect(dono.rejeicoes[1].code).toBe("NOT_A_BOT");
    expect(humanos(dono)).toBe(2);
  });

  it("assento fora da faixa é recusado", async () => {
    const { dono } = await criarSala("Tito");
    for (const seat of [-1, 4, 99, 1.5]) {
      const antes = dono.rejeicoes.length;
      dono.sdk.send("CLIENT_ADD_BOT", { seat });
      await ate(() => dono.rejeicoes.length > antes, 8000, `recusa do assento ${seat}`);
      expect(dono.rejeicoes.at(-1)!.code).toBe("INVALID_PAYLOAD");
    }
  });
});

// ═══════════════════ 2 · COMPOSIÇÃO ═══════════════════

describe("2 · composições oficiais da mesa", () => {
  it("2 humanos + 2 bots INICIA", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");

    await addBot(dono, 2);
    await addBot(dono, 3);
    expect(humanos(dono)).toBe(2);
    expect(bots(dono)).toBe(2);
    expect(sala(dono).status).toBe("lobby"); // faltam os humanos prontos

    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "partida iniciada 2+2");
    expect(dono.view).not.toBeNull();
  });

  it("3 humanos + 1 bot INICIA", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const b = await entrar(codigo, "Raiza");
    const c = await entrar(codigo, "Vitor");
    await ate(() => ocupados(dono) === 3, 8000, "tres sentados");

    await addBot(dono, 3);
    for (const x of [dono, b, c]) x.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "partida iniciada 3+1");
    expect(humanos(dono)).toBe(3);
    expect(bots(dono)).toBe(1);
  });

  it("4 humanos INICIA, sem bot nenhum", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const outros = [await entrar(codigo, "Raiza"), await entrar(codigo, "Vitor"), await entrar(codigo, "Nara")];
    await ate(() => ocupados(dono) === 4, 8000, "quatro sentados");

    for (const x of [dono, ...outros]) x.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "partida iniciada 4 humanos");
    expect(bots(dono)).toBe(0);
  });

  it("1 humano + 3 bots NÃO INICIA — é o piso da composição", async () => {
    const { dono } = await criarSala("Tito");
    await addBot(dono, 1);
    await addBot(dono, 2);
    await addBot(dono, 3);

    expect(ocupados(dono)).toBe(ASSENTOS);
    expect(humanos(dono)).toBe(1);
    expect(humanos(dono)).toBeLessThan(MIN_HUMANOS);

    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    // dá tempo de sobra para o servidor iniciar se fosse iniciar
    await new Promise((r) => setTimeout(r, 300));
    expect(sala(dono).status).toBe("lobby");
    expect(dono.view).toBeNull();
  });

  it("o segundo humano chegando destrava a partida travada por composição", async () => {
    const { dono, codigo } = await criarSala("Tito");
    await addBot(dono, 2);
    await addBot(dono, 3);
    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    await new Promise((r) => setTimeout(r, 200));
    expect(sala(dono).status).toBe("lobby"); // 1 humano + 2 bots + 1 vago

    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 4, 8000, "quatro assentos");
    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "iniciou com 2+2");
  });

  it("host remove bot antes de começar e o assento volta a ficar livre", async () => {
    const { dono, codigo } = await criarSala("Tito");
    await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");

    await addBot(dono, 2);
    await addBot(dono, 3);
    expect(bots(dono)).toBe(2);

    dono.sdk.send("CLIENT_REMOVE_BOT", { seat: 3 });
    await ate(() => bots(dono) === 1, 8000, "bot removido");
    expect(ocupados(dono)).toBe(3);
    expect(primeiroLivre(dono)).toBe(3);
    expect(assentosDe(dono)[3].nick).toBe("");
  });

  it("depois que a partida começa, mexer em bot é recusado", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await addBot(dono, 3);
    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "iniciou");

    const antes = dono.rejeicoes.length;
    dono.sdk.send("CLIENT_REMOVE_BOT", { seat: 2 });
    await ate(() => dono.rejeicoes.length > antes, 8000, "recusa WRONG_PHASE");
    expect(dono.rejeicoes.at(-1)!.code).toBe("WRONG_PHASE");
    expect(bots(dono)).toBe(2);
  });
});

// ═══════════════════ 3 · READY ═══════════════════

describe("3 · ready: bot nasce pronto, humano marca", () => {
  it("o bot já entra pronto e o humano não", async () => {
    const { dono, codigo } = await criarSala("Tito");
    await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);

    const bot = assentosDe(dono)[2];
    expect(bot.bot).toBe(true);
    expect(bot.ready).toBe(true);
    expect(bot.nick).toBe("BOT NORMAL");
    expect(assentosDe(dono)[0].ready).toBe(false);
    expect(assentosDe(dono)[1].ready).toBe(false);
  });

  it("faltando UM humano pronto, a partida não começa", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await addBot(dono, 3);

    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(sala(dono).status).toBe("lobby");

    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "iniciou com os dois prontos");
  });
});

// ═══════════════════ 4 · O BOT JOGA, E JOGA LEGAL ═══════════════════

describe("4 · o bot do servidor joga a mesa mista", () => {
  it("os humanos jogam a sua carta e os BOTS respondem sozinhos, fechando vazas inteiras", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await addBot(dono, 3);
    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "iniciou");
    await ate(() => dono.view !== null && raiza.view !== null, 8000, "primeiras visoes");

    // Cada humano joga SÓ quando é a vez dele. Ninguém joga pelos assentos 2 e 3: se as vazas
    // fecharem, foi o servidor decidindo por eles — que é exatamente o que se quer provar.
    // O laço abaixo roda milhares de vezes por segundo; sem esta guarda o mesmo humano manda
    // a mesma carta várias vezes antes de a resposta chegar, e o servidor recusa a repetição —
    // corretamente. A guarda é por VERSÃO DE ESTADO: uma jogada por estado, no máximo.
    let acao = 0;
    const ultimaEnviada = new Map<Cliente, number>();
    const jogarSeForAVez = (c: Cliente, seat: Seat) => {
      const v = c.view;
      if (!v?.hand || v.hand.handScores !== null || v.hand.turn !== seat) return;
      if (ultimaEnviada.get(c) === c.versao) return;
      ultimaEnviada.set(c, c.versao);
      const legais = legalCardsFor(v, seat);
      if (legais.length === 0) return;
      c.sdk.send("CLIENT_PLAY_CARD", {
        actionId: "h" + (++acao), cardId: cardId(legais[0]), expectedStateVersion: c.versao,
      });
    };

    await ate(() => {
      jogarSeForAVez(dono, 0);
      jogarSeForAVez(raiza, 1);
      return (dono.view?.hand?.completedTricks.length ?? 0) >= 3;
    }, 15_000, "tres vazas completas com bots respondendo");

    const h = dono.view!.hand!;
    expect(h.completedTricks.length).toBeGreaterThanOrEqual(3);

    // toda vaza fechada tem as QUATRO cartas, e os assentos de bot aparecem em todas
    for (const t of h.completedTricks) {
      expect(t.cards).toHaveLength(4);
      const assentos = t.cards.map((pc) => pc.seat).sort();
      expect(assentos).toEqual([0, 1, 2, 3]);
    }
    // e nenhuma jogada ilegal foi recusada pelo caminho
    expect(dono.rejeicoes).toHaveLength(0);
    expect(raiza.rejeicoes).toHaveLength(0);
  }, 25_000);

  it("o bot NÃO recebe informação privilegiada: a visão do humano não expõe a mão do bot", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await addBot(dono, 3);
    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "iniciou");
    await ate(() => dono.view !== null, 8000, "primeira visao");

    const v = dono.view!;
    expect(v.seed).toBe(0);
    const maos = v.hand!.hands;
    expect(maos[0]).toHaveLength(13);                 // a dele
    for (const s of [1, 2, 3] as Seat[]) expect(maos[s]).toEqual([]); // humanos E bots, vazios
    // a contagem continua verdadeira para todos
    expect(v.hand!.handCounts.every((n) => n === 13)).toBe(true);
  });
});

// ═══════════════════ 5 · ANFITRIÃO SAI ═══════════════════

describe("5 · o posto de anfitrião não fica órfão", () => {
  it("se o anfitrião sai no lobby, outro humano assume e consegue mexer nos bots", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 3);

    await dono.sdk.leave(true);
    await ate(() => humanos(raiza) === 1, 8000, "anfitriao saiu");
    await ate(() => assentosDe(raiza).some((a) => a.host), 8000, "novo anfitriao");

    const novo = assentosDe(raiza).find((a) => a.host)!;
    expect(novo.bot).toBe(false);
    expect(novo.nick).toBe("Raiza");

    // e agora ela consegue o que antes era recusado
    const antes = raiza.rejeicoes.length;
    raiza.sdk.send("CLIENT_ADD_BOT", { seat: 2 });
    await ate(() => bots(raiza) === 2, 8000, "novo anfitriao adicionou bot");
    expect(raiza.rejeicoes).toHaveLength(antes);
  });
});

// ═══════════════════ 6 · PARTIDA COMPLETA EM MESA MISTA ═══════════════════

/**
 * Toca a partida até o fim: humanos respondem NO INSTANTE em que o estado muda, bots são do
 * servidor. Dirigido por evento e não por laço — ver o comentário de `aoAtualizar`.
 */
async function jogarPartidaCompleta(
  humanos: { c: Cliente; seat: Seat }[],
  limiteMs: number,
): Promise<AtualizacaoDeEstado["view"]> {
  let acao = 0;
  const maoPedida = new Map<Cliente, number>();

  for (const { c, seat } of humanos) {
    c.aoAtualizar = (cli) => {
      const w = cli.view;
      if (!w?.hand || w.finished) return;
      const h = w.hand;

      if (h.handScores !== null) {
        // uma vez por mão: repetir o pedido só gera mensagem à toa
        if (maoPedida.get(cli) === h.handNumber) return;
        maoPedida.set(cli, h.handNumber);
        cli.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: "r" + (++acao) });
      } else if (h.awaitingTrumpFrom === seat) {
        cli.sdk.send("CLIENT_SELECT_TRUMP", { actionId: "t" + (++acao), trump: "no-trump" });
      } else if (h.turn === seat) {
        const legais = legalCardsFor(w, seat);
        if (legais.length) {
          cli.sdk.send("CLIENT_PLAY_CARD", {
            actionId: "p" + (++acao), cardId: cardId(legais[0]), expectedStateVersion: cli.versao,
          });
        }
      }
    };
  }

  // PARTIDA A FRIO: o handler acabou de ser registrado, mas o primeiro STATE_UPDATE já chegou
  // antes disso. Sem este empurrão inicial ninguém joga a primeira carta, e a espera abaixo
  // aguardaria para sempre por uma atualização que só viria depois de alguém jogar.
  for (const { c } of humanos) c.aoAtualizar?.(c);

  try {
    await ate(() => !!humanos[0].c.view?.finished, limiteMs, "partida completa");
  } finally {
    for (const { c } of humanos) c.aoAtualizar = undefined;
  }
  return humanos[0].c.view!;
}

describe("6 · partida completa com bots na mesa", () => {
  it("2 humanos + 2 bots joga as 10 mãos inteiras e fecha com checksum 0", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await addBot(dono, 3);
    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "iniciou");
    await ate(() => dono.view !== null && raiza.view !== null, 8000, "primeiras visoes");

    const v = await jogarPartidaCompleta([{ c: dono, seat: 0 }, { c: raiza, seat: 1 }], 150_000);

    expect(v.finished).toBe(true);
    expect(v.handNumber).toBe(10);
    expect(v.history).toHaveLength(10);

    // CHECKSUMS — a regra de encerramento antecipado não os altera
    const negativas = v.history.slice(0, 6).reduce((t, h) => t + h.handScores.reduce((x, y) => x + y, 0), 0);
    const positivas = v.history.slice(6).reduce((t, h) => t + h.handScores.reduce((x, y) => x + y, 0), 0);
    expect(negativas).toBe(-1300);
    expect(positivas).toBe(1300);
    expect(v.cumulative.reduce((x, y) => x + y, 0)).toBe(0);

    // as dez mãos vieram na ordem, cada uma com o seu contrato e o seu total fechado
    expect(v.history.map((h) => h.handNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const h of v.history) {
      expect(h.handScores).toHaveLength(4);
      expect(Number.isFinite(h.handScores.reduce((x, y) => x + y, 0))).toBe(true);
    }
    // as quatro positivas valem +325 cada — nenhuma delas encerra antes da 13ª vaza
    for (const h of v.history.slice(6)) {
      expect(h.handScores.reduce((x, y) => x + y, 0)).toBe(325);
    }

    expect(dono.rejeicoes).toHaveLength(0);
    expect(raiza.rejeicoes).toHaveLength(0);
    // e o sigilo se manteve até o fim
    expect(v.seed).toBe(0);

    // ATENÇÃO: `v.finished` veio da MENSAGEM (STATE_UPDATE, imediata) e `status` vem do SCHEMA
    // (patch, em lote). Os dois não chegam juntos. Assertar o status na mesma linha em que se
    // leu a mensagem passa quando a máquina está ociosa e falha na suíte inteira — foi o que
    // aconteceu aqui. Espera-se o estado observável em vez de presumir sincronia.
    await ate(() => sala(dono).status === "finished", 10_000, "status finished no schema");
  }, 180_000);

  it("3 humanos + 1 bot joga as primeiras mãos com o bot respondendo em todas as vazas", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const b = await entrar(codigo, "Raiza");
    const c = await entrar(codigo, "Vitor");
    await ate(() => ocupados(dono) === 3, 8000, "tres sentados");
    await addBot(dono, 3);
    for (const x of [dono, b, c]) x.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "iniciou");
    await ate(() => dono.view !== null, 8000, "primeira visao");

    const humanos: { c: Cliente; seat: Seat }[] = [
      { c: dono, seat: 0 }, { c: b, seat: 1 }, { c: c, seat: 2 },
    ];
    let acao = 0;
    const ultima = new Map<Cliente, number>();
    await ate(() => {
      for (const { c: cli, seat } of humanos) {
        const w = cli.view;
        if (!w?.hand || w.hand.handScores !== null) continue;
        if (ultima.get(cli) === cli.versao) continue;
        if (w.hand.turn !== seat) continue;
        ultima.set(cli, cli.versao);
        const legais = legalCardsFor(w, seat);
        if (legais.length) {
          cli.sdk.send("CLIENT_PLAY_CARD", {
            actionId: "q" + (++acao), cardId: cardId(legais[0]), expectedStateVersion: cli.versao,
          });
        }
      }
      return (dono.view?.hand?.completedTricks.length ?? 0) >= 5;
    }, 30_000, "cinco vazas com 3 humanos + 1 bot");

    const h = dono.view!.hand!;
    for (const t of h.completedTricks) {
      expect(t.cards).toHaveLength(4);
      expect(t.cards.map((pc) => pc.seat).sort()).toEqual([0, 1, 2, 3]);
    }
    expect(dono.rejeicoes).toHaveLength(0);
  }, 60_000);
});

// ═══════════════════ 7 · RECONNECT EM MESA MISTA ═══════════════════

describe("7 · reconnect com bots na mesa", () => {
  it("humano cai, bots continuam, ele volta ao MESMO assento e nada da mão dele vazou", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await addBot(dono, 3);
    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "iniciou");
    await ate(() => raiza.view !== null, 8000, "visao da Raiza");

    const credencial = raiza.boasVindas!.you.recoveryToken;
    const assentoDela = raiza.boasVindas!.you.seat;
    expect(credencial.startsWith(sala(dono).roomCode + ":")).toBe(true);

    // ela cai
    await raiza.sdk.leave(false);
    await ate(() => !assentosDe(dono)[assentoDela].connected, 8000, "queda registrada");

    // a COMPOSIÇÃO não muda: o assento continua dela, e nenhum bot o ocupa
    expect(assentosDe(dono)[assentoDela].playerId).not.toBe("");
    expect(assentosDe(dono)[assentoDela].bot).toBe(false);
    expect(bots(dono)).toBe(2);
    expect(ocupados(dono)).toBe(ASSENTOS);

    // ela volta com a credencial e recebe o MESMO assento
    const volta = escutar((await colyseus.sdk.reconnect(credencial)) as unknown as SdkRoom);
    await ate(() => volta.boasVindas !== null, 8000, "SERVER_WELCOME do retorno");
    expect(volta.boasVindas!.you.seat).toBe(assentoDela);
    await ate(() => volta.view !== null, 8000, "visao restaurada");
    await ate(() => assentosDe(dono)[assentoDela].connected, 8000, "reconectada");

    // continua sendo a visão DELA, e só dela
    const v = volta.view!;
    expect(v.seed).toBe(0);
    expect(v.hand!.hands[assentoDela].length).toBeGreaterThan(0);
    for (const s of [0, 1, 2, 3] as Seat[]) {
      if (s !== assentoDela) expect(v.hand!.hands[s]).toEqual([]);
    }
    // e a credencial nova continua no formato certo, com o código de 4 dígitos
    expect(volta.boasVindas!.you.recoveryToken).toMatch(/^\d{4}:/);
    expect(bots(dono)).toBe(2);
  }, 40_000);
});
