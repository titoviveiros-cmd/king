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
import {
  PROTOCOL_VERSION,
  type AcaoRecusada, type AtualizacaoDeEstado, type BoasVindas, type MensagemSocialDifundida,
} from "../protocol/index.js";
import { ASSENTOS, MIN_HUMANOS } from "./KingRoom.js";
import { AVATAR_PADRAO, AVATARES, NOMES_DE_BOT } from "./identidade.js";
import { COOLDOWN_MS, MENSAGENS_SOCIAIS } from "./social.js";

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
beforeEach(async () => { proximoAvatar = 0; await colyseus.cleanup(); });

async function ate(cond: () => boolean, ms = 10_000, rotulo = "?"): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando: " + rotulo);
    await new Promise((r) => setTimeout(r, 0));
  }
}

interface AssentoView {
  seat: number; playerId: string; nick: string;
  connected: boolean; ready: boolean; assisted: boolean; bot: boolean; host: boolean; avatar: string;
}
interface SalaView { roomCode: string; status: string; tableTheme: string; seats: AssentoView[] }
interface SdkRoom {
  roomId: string; state: SalaView;
  send(tipo: string, msg?: unknown): void;
  onMessage(tipo: string, cb: (...a: never[]) => void): void;
  leave(consented?: boolean): Promise<number>;
}
interface Cliente {
  sdk: SdkRoom; boasVindas: BoasVindas | null;
  view: AtualizacaoDeEstado["view"] | null; rejeicoes: AcaoRecusada[];
  /** Mensagens sociais recebidas, na ordem. */
  sociais: MensagemSocialDifundida[];
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
  const c: Cliente = { sdk, boasVindas: null, view: null, rejeicoes: [], sociais: [], versao: -1 };
  sdk.onMessage("SERVER_WELCOME", (m: BoasVindas) => { c.boasVindas = m; });
  sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => {
    c.view = m.view; c.versao = m.stateVersion;
    c.aoAtualizar?.(c);
  });
  sdk.onMessage("ACTION_REJECTED", (m: AcaoRecusada) => c.rejeicoes.push(m));
  sdk.onMessage("SOCIAL_MESSAGE", (m: MensagemSocialDifundida) => c.sociais.push(m));
  for (const t of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "SERVER_ERROR",
    "READY_STATE", "TURN_CLOCK", "AUTO_ACTION"]) sdk.onMessage(t, () => {});
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

const opcoes = (nick: string, avatar?: unknown) =>
  ({ protocolVersion: PROTOCOL_VERSION, nick, avatar: avatar ?? avatarDeTeste() });

async function criarSala(nick = "Anfitriao", avatar?: unknown): Promise<{ dono: Cliente; codigo: string }> {
  const sdk = (await colyseus.sdk.create(SALA_KING, opcoes(nick, avatar))) as unknown as SdkRoom;
  const dono = escutar(sdk);
  await ate(() => dono.boasVindas !== null, 8000, "SERVER_WELCOME do anfitriao");
  return { dono, codigo: dono.boasVindas!.roomCode };
}

async function entrar(codigo: string, nick: string, avatar?: unknown): Promise<Cliente> {
  const sdk = (await colyseus.sdk.joinById(codigo, opcoes(nick, avatar))) as unknown as SdkRoom;
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
    // O nome é de personagem, sorteado PELO SERVIDOR na lista fechada — não mais "BOT NORMAL".
    expect(NOMES_DE_BOT as readonly string[]).toContain(bot.nick);
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

// ═══════════════════ 8 · IDENTIDADE: AVATAR E NOME DE BOT ═══════════════════
//
// A regra que estes testes protegem cabe numa frase: **identidade é do servidor**. O que o
// cliente manda é uma sugestão; o que aparece na tela de todo mundo é o que ficou no estado
// sincronizado. Sem isso, a Raiza veria "Reizinho" no assento onde o Tito vê "Mão Fria".

describe("8 · avatar viaja pelo protocolo e vale para todos", () => {
  it("o avatar escolhido entra no estado autoritativo e o OUTRO cliente vê o mesmo", async () => {
    const { dono, codigo } = await criarSala("Tito", "raposa");
    const raiza = await entrar(codigo, "Raiza", "sapo");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");

    // cada um vê os DOIS avatares, iguais nos dois aparelhos
    for (const c of [dono, raiza]) {
      expect(assentosDe(c)[0].avatar).toBe("raposa");
      expect(assentosDe(c)[1].avatar).toBe("sapo");
    }
  });

  it("avatar inválido é SANITIZADO, não derruba a entrada", async () => {
    // texto livre, HTML e URL são exatamente o que não pode chegar à tela dos outros
    const { dono, codigo } = await criarSala("Tito", "<img src=x onerror=alert(1)>");
    const raiza = await entrar(codigo, "Raiza", "https://exemplo.com/foto.png");
    const vitor = await entrar(codigo, "Vitor", 42);
    await ate(() => ocupados(dono) === 3, 8000, "tres sentados");

    // Os três lixos viram o PADRÃO, e o padrão só cabe uma vez. Quem chega depois NÃO recebe um
    // substituto escolhido pelo servidor: fica pendente, com o campo vazio, até escolher. O que
    // se garante aqui é o que sempre importou (nada de HTML, URL ou número chega à tela de
    // ninguém) mais o que passou a valer: ninguém ganha identidade que não pediu.
    const tres = assentosDe(dono).slice(0, 3);
    expect(tres[0].avatar).toBe(AVATAR_PADRAO);
    expect(tres[1].avatar).toBe("");
    expect(tres[2].avatar).toBe("");
    expect(AVATARES as readonly string[]).toContain(tres[0].avatar);
    expect(raiza.boasVindas).not.toBeNull();
    expect(vitor.boasVindas).not.toBeNull();
  });

  it("quem entra pedindo o mesmo bicho fica PENDENTE, não recebe um substituto", async () => {
    const { dono, codigo } = await criarSala("Tito", AVATAR_PADRAO);
    await entrar(codigo, "Raiza", AVATAR_PADRAO);
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    const dois = assentosDe(dono).slice(0, 2);
    // O primeiro fica com o que pediu. O segundo fica com NADA — e "nada" é o único valor que não
    // parece uma escolha. Escolher por ele seria dar identidade a quem não pediu identidade
    // nenhuma, que é o defeito que esta regra existe para eliminar.
    expect(dois[0].avatar).toBe(AVATAR_PADRAO);
    expect(dois[1].avatar).toBe("");
    // assento vago também tem avatar válido: o lobby nunca lê `undefined`
    expect(AVATARES as readonly string[]).toContain(assentosDe(dono)[3].avatar);
  });

  it("o avatar SOBREVIVE ao reconnect, e continua igual para quem ficou", async () => {
    const { dono, codigo } = await criarSala("Tito", "unicornio");
    const raiza = await entrar(codigo, "Raiza", "coruja");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await addBot(dono, 3);
    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "iniciou");

    const credencial = raiza.boasVindas!.you.recoveryToken;
    const dela = raiza.boasVindas!.you.seat;
    await raiza.sdk.leave(false);
    await ate(() => !assentosDe(dono)[dela].connected, 8000, "queda registrada");
    // caída, ela continua sendo ela na tela do Tito
    expect(assentosDe(dono)[dela].avatar).toBe("coruja");

    const volta = escutar((await colyseus.sdk.reconnect(credencial)) as unknown as SdkRoom);
    await ate(() => volta.boasVindas !== null, 8000, "SERVER_WELCOME do retorno");
    await ate(() => assentosDe(dono)[dela].connected, 8000, "reconectada");
    expect(assentosDe(dono)[dela].avatar).toBe("coruja");
    expect(assentosDe(volta)[dela].avatar).toBe("coruja");
    expect(assentosDe(volta)[0].avatar).toBe("unicornio");
  }, 30_000);

  it("o assento liberado volta ao padrão — o avatar não fica de herança para o próximo", async () => {
    const { dono, codigo } = await criarSala("Tito", "panda");
    const raiza = await entrar(codigo, "Raiza", "unicornio");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    const dela = raiza.boasVindas!.you.seat;

    await raiza.sdk.leave(true); // saída definitiva, ainda no lobby
    await ate(() => ocupados(dono) === 1, 8000, "assento liberado");
    expect(assentosDe(dono)[dela].avatar).toBe(AVATAR_PADRAO);
  });

  // ── EXCLUSIVIDADE ────────────────────────────────────────────────────────────────────────
  //
  // A regra é: numa mesa, cada bicho é de uma pessoa só. O lobby de cada aparelho já desabilita o
  // que está em uso, mas essa checagem roda ANTES do envio, sobre uma foto da sala que pode ter
  // envelhecido no caminho. Estes testes exercitam justamente o que o frontend não alcança.

  it("quem pede um avatar já ocupado ENTRA MESMO ASSIM, mas sem avatar", async () => {
    const { dono, codigo } = await criarSala("Tito", "unicornio");
    const raiza = await entrar(codigo, "Raiza", "unicornio");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    const dela = raiza.boasVindas!.you.seat;

    // Recusar a ENTRADA por causa de um desenho seria desproporcional: ela entra, senta, vê a
    // sala. O que ela não faz é ganhar um bicho que não pediu.
    expect(assentosDe(dono)[0].avatar).toBe("unicornio");
    expect(assentosDe(dono)[dela].avatar).toBe("");
    expect(raiza.boasVindas).not.toBeNull();
  });

  it("PENDENTE não fica pronta, e a mesa não começa sem ela resolver", async () => {
    const { dono, codigo } = await criarSala("Tito", "unicornio");
    const raiza = await entrar(codigo, "Raiza", "unicornio");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await addBot(dono, 3);
    const dela = raiza.boasVindas!.you.seat;

    // 1 · O servidor recusa o pronto de quem não tem identidade, com motivo dizível.
    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => raiza.rejeicoes.length > 0, 8000, "recusa do pronto pendente");
    expect(raiza.rejeicoes.at(-1)!.code).toBe("AVATAR_PENDING");
    expect(assentosDe(dono)[dela].ready).toBe(false);

    // 2 · E a partida NÃO começa, nem com o anfitrião pronto: a regra é da mesa, não do botão.
    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    await new Promise((r) => setTimeout(r, 400));
    expect(sala(dono).status).toBe("lobby");

    // 3 · Resolvida a identidade, o caminho destrava — e só então.
    raiza.sdk.send("CLIENT_SET_AVATAR", { avatar: "sapo" });
    await ate(() => assentosDe(dono)[dela].avatar === "sapo", 8000, "escolha aceita");
    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "iniciou depois da escolha");
  }, 30_000);

  it("trocar para um avatar LIVRE vale, e os dois aparelhos veem a troca", async () => {
    const { dono, codigo } = await criarSala("Tito", "leao");
    const raiza = await entrar(codigo, "Raiza", "coruja");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    const dela = raiza.boasVindas!.you.seat;

    raiza.sdk.send("CLIENT_SET_AVATAR", { avatar: "sapo" });
    await ate(() => assentosDe(dono)[dela].avatar === "sapo", 8000, "troca refletida no anfitriao");
    expect(assentosDe(raiza)[dela].avatar).toBe("sapo");
    expect(raiza.rejeicoes).toHaveLength(0);
  });

  it("DOIS PEDINDO O MESMO, no mesmo instante: um leva, o outro é recusado", async () => {
    const { dono, codigo } = await criarSala("Tito", "leao");
    const raiza = await entrar(codigo, "Raiza", "coruja");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    const dela = raiza.boasVindas!.you.seat;

    // Sem espera entre os dois envios: é o mais perto de "ao mesmo tempo" que se consegue montar,
    // e é o suficiente — a sala processa mensagens em fila, então o desempate acontece aqui
    // dentro, não no relógio de quem clicou.
    dono.sdk.send("CLIENT_SET_AVATAR", { avatar: "unicornio" });
    raiza.sdk.send("CLIENT_SET_AVATAR", { avatar: "unicornio" });
    await ate(() => dono.rejeicoes.length + raiza.rejeicoes.length > 0, 8000, "a recusa do segundo");
    // A recusa chega por mensagem direta; a troca do vencedor chega pelo patch do Schema, que é
    // outro canal. Esperar só a recusa leria o estado meio passo antes de ele existir.
    await ate(() => assentosDe(dono).some((x) => x.avatar === "unicornio"), 8000, "o unicornio do vencedor");
    await ate(() => assentosDe(raiza).some((x) => x.avatar === "unicornio"), 8000, "e no outro aparelho");

    // QUEM ganha não se afirma aqui, e essa omissão é o teste: são dois sockets, e a ordem em que
    // o servidor recebe é do sistema operacional, não do roteiro. O que a regra promete não é
    // "Tito leva", é "um leva". Um teste que exigisse um vencedor fixo estaria testando a rede.
    const perdedor = dono.rejeicoes.length ? dono : raiza;
    const vencedor = perdedor === dono ? raiza : dono;
    const dele = vencedor.boasVindas!.you.seat;
    const dele2 = perdedor.boasVindas!.you.seat;

    expect(perdedor.rejeicoes.at(-1)!.code).toBe("AVATAR_TAKEN");
    expect(vencedor.rejeicoes).toHaveLength(0);
    expect(assentosDe(dono)[dele].avatar).toBe("unicornio");
    // O RECUSADO FICA COM O QUE TINHA. Não vira padrão, não vira "outro qualquer": ele pediu uma
    // coisa, não conseguiu, e nada mais muda.
    expect(assentosDe(dono)[dele2].avatar).toBe(dele2 === 0 ? "leao" : "coruja");
    // e nenhum dos dois aparelhos diverge do outro
    expect(assentosDe(raiza).map((a) => a.avatar)).toEqual(assentosDe(dono).map((a) => a.avatar));
    // e a mesa continua com uma ocupação só de cada bicho
    const bichos = assentosDe(dono).filter((a) => a.playerId !== "").map((a) => a.avatar);
    expect(new Set(bichos).size).toBe(bichos.length);
    void dela;
  });

  it("o avatar de um BOT também está ocupado — humano não assume o bicho do robô", async () => {
    const { dono, codigo } = await criarSala("Tito", "leao");
    const raiza = await entrar(codigo, "Raiza", "coruja");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    const doBot = assentosDe(dono)[2].avatar;

    raiza.sdk.send("CLIENT_SET_AVATAR", { avatar: doBot });
    await ate(() => raiza.rejeicoes.length > 0, 8000, "recusa do bicho do bot");
    expect(raiza.rejeicoes.at(-1)!.code).toBe("AVATAR_TAKEN");
    expect(assentosDe(dono)[raiza.boasVindas!.you.seat].avatar).toBe("coruja");
  });

  it("etiqueta fora do catálogo é RECUSADA, não sanitizada em silêncio", async () => {
    const { dono, codigo } = await criarSala("Tito", "leao");
    const raiza = await entrar(codigo, "Raiza", "coruja");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    const dela = raiza.boasVindas!.you.seat;

    // Na ENTRADA, lixo vira padrão: derrubar alguém na porta por causa de um avatar seria
    // desproporcional. Aqui não — a pessoa pediu uma troca específica, e trocar por outra coisa
    // seria responder uma pergunta que ela não fez.
    raiza.sdk.send("CLIENT_SET_AVATAR", { avatar: "capivara" });
    await ate(() => raiza.rejeicoes.length > 0, 8000, "recusa da etiqueta");
    expect(raiza.rejeicoes.at(-1)!.code).toBe("INVALID_PAYLOAD");
    expect(assentosDe(dono)[dela].avatar).toBe("coruja");
  });

  it("com a partida em curso NÃO se troca de avatar", async () => {
    const { dono, codigo } = await criarSala("Tito", "leao");
    const raiza = await entrar(codigo, "Raiza", "coruja");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await addBot(dono, 3);
    dono.sdk.send("CLIENT_SET_READY", { ready: true });
    raiza.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => sala(dono).status === "playing", 10_000, "iniciou");
    const dela = raiza.boasVindas!.you.seat;

    raiza.sdk.send("CLIENT_SET_AVATAR", { avatar: "sapo" });
    await ate(() => raiza.rejeicoes.length > 0, 8000, "recusa em partida");
    expect(raiza.rejeicoes.at(-1)!.code).toBe("WRONG_PHASE");
    expect(assentosDe(dono)[dela].avatar).toBe("coruja");
  }, 30_000);
});

describe("8 · o nome do bot é do SERVIDOR", () => {
  it("o servidor batiza o bot, e os dois clientes leem o MESMO nome", async () => {
    const { dono, codigo } = await criarSala("Tito");
    const raiza = await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await ate(() => bots(raiza) === 1, 8000, "a Raiza tambem ve o bot");

    const noDono = assentosDe(dono)[2];
    const naRaiza = assentosDe(raiza)[2];
    expect(NOMES_DE_BOT as readonly string[]).toContain(noDono.nick);
    expect(naRaiza.nick).toBe(noDono.nick);
    expect(naRaiza.avatar).toBe(noDono.avatar);
    // e continua declarado como bot: nome próprio não disfarça a natureza do oponente
    expect(noDono.bot).toBe(true);
    expect(naRaiza.bot).toBe(true);
  });

  it("dois bots na mesma mesa não recebem o mesmo nome nem o mesmo avatar", async () => {
    const { dono, codigo } = await criarSala("Tito");
    await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await addBot(dono, 3);

    const [b2, b3] = [assentosDe(dono)[2], assentosDe(dono)[3]];
    expect(b2.nick).not.toBe(b3.nick);
    expect(b2.avatar).not.toBe(b3.avatar);
    expect(new Set(assentosDe(dono).map((a) => a.nick)).size).toBe(ASSENTOS);
  });

  it("o bot removido e recolocado continua sendo um bot com nome da lista", async () => {
    const { dono, codigo } = await criarSala("Tito");
    await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);

    dono.sdk.send("CLIENT_REMOVE_BOT", { seat: 2 });
    await ate(() => bots(dono) === 0, 8000, "bot removido");
    expect(assentosDe(dono)[2].nick).toBe("");

    await addBot(dono, 2);
    const bot = assentosDe(dono)[2];
    expect(bot.bot).toBe(true);
    expect(bot.ready).toBe(true);
    expect(NOMES_DE_BOT as readonly string[]).toContain(bot.nick);
  });
});

// ═══════════════════ 9 · MENSAGENS SOCIAIS ═══════════════════
//
// Duas garantias, e a segunda é a que importa mais: (1) todo mundo na mesa recebe a mesma
// mensagem, e (2) mandar mensagem NÃO é jogar. Nada aqui pode encostar em regra, relógio ou
// estado da partida.

/** Sobe uma mesa 2H+2B já em partida. É o cenário real das mensagens. */
async function mesaEmPartida(): Promise<{ dono: Cliente; raiza: Cliente }> {
  const { dono, codigo } = await criarSala("Tito");
  const raiza = await entrar(codigo, "Raiza");
  await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
  await addBot(dono, 2);
  await addBot(dono, 3);
  dono.sdk.send("CLIENT_SET_READY", { ready: true });
  raiza.sdk.send("CLIENT_SET_READY", { ready: true });
  await ate(() => sala(dono).status === "playing", 10_000, "iniciou");
  await ate(() => dono.view !== null && raiza.view !== null, 8000, "visoes");
  return { dono, raiza };
}

describe("9 · mensagem social chega igual para todos", () => {
  it("quem manda e quem assiste recebem o MESMO evento, com o assento de quem falou", async () => {
    const { dono, raiza } = await mesaEmPartida();
    const assentoDele = dono.boasVindas!.you.seat;

    dono.sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: "boa" });
    await ate(() => raiza.sociais.length > 0, 8000, "a Raiza recebe");
    await ate(() => dono.sociais.length > 0, 8000, "o Tito tambem recebe o proprio");

    for (const c of [dono, raiza]) {
      expect(c.sociais[0].seat).toBe(assentoDele);
      expect(c.sociais[0].messageId).toBe("boa");
      // o prazo vem do servidor: as quatro telas apagam o balão na mesma hora
      expect(c.sociais[0].duracaoMs).toBeGreaterThan(0);
    }
  }, 30_000);

  it("etiqueta desconhecida é RECUSADA e não chega a ninguém", async () => {
    const { dono, raiza } = await mesaEmPartida();
    for (const lixo of ["", "oi tudo bem?", "<script>", "BOA", 42, null]) {
      dono.sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: lixo });
    }
    await ate(() => dono.rejeicoes.length > 0, 8000, "recusa");
    expect(dono.rejeicoes[0].code).toBe("INVALID_PAYLOAD");
    expect(raiza.sociais).toHaveLength(0);
  }, 30_000);

  it("no lobby ninguém fala: o painel só existe com partida em curso", async () => {
    const { dono, codigo } = await criarSala("Tito");
    await entrar(codigo, "Raiza");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");

    dono.sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: "boa" });
    await ate(() => dono.rejeicoes.length > 0, 8000, "recusa");
    expect(dono.rejeicoes[0].code).toBe("WRONG_PHASE");
    expect(dono.sociais).toHaveLength(0);
  });

  it("o limitador é do SERVIDOR: um cliente que ignora o cooldown é barrado assim mesmo", async () => {
    const { dono, raiza } = await mesaEmPartida();
    // dez mensagens de uma vez, como faria um cliente modificado
    for (let i = 0; i < 10; i++) dono.sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: "boa" });
    await ate(() => dono.rejeicoes.length > 0, 8000, "recusa por ritmo");

    expect(dono.rejeicoes.some((r) => r.code === "RATE_LIMITED")).toBe(true);
    // passou UMA. Não dez, não zero.
    expect(raiza.sociais).toHaveLength(1);
    expect(COOLDOWN_MS).toBeGreaterThan(0);
  }, 30_000);

  it("falar NÃO é jogar: estado, versão e vez continuam exatamente onde estavam", async () => {
    const { dono, raiza } = await mesaEmPartida();
    const versaoAntes = dono.versao;
    const vezAntes = dono.view!.hand!.turn;
    const maoAntes = dono.view!.hand!.handNumber;

    for (const id of MENSAGENS_SOCIAIS.slice(0, 3)) {
      dono.sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: id });
      await new Promise((r) => setTimeout(r, COOLDOWN_MS + 50));
    }
    await ate(() => raiza.sociais.length >= 3, 8000, "as tres chegaram");

    expect(dono.versao).toBe(versaoAntes);
    expect(dono.view!.hand!.turn).toBe(vezAntes);
    expect(dono.view!.hand!.handNumber).toBe(maoAntes);
    expect(sala(dono).status).toBe("playing");
  }, 40_000);

  it("o sigilo continua de pé: nenhuma mensagem carrega carta, mão ou semente", async () => {
    const { dono, raiza } = await mesaEmPartida();
    dono.sdk.send("CLIENT_SOCIAL_MESSAGE", { messageId: "doeu" });
    await ate(() => raiza.sociais.length > 0, 8000, "chegou");
    expect(Object.keys(raiza.sociais[0]).sort()).toEqual(["duracaoMs", "messageId", "seat"]);
  }, 30_000);
});

describe("9 · o bot não copia o avatar de quem já está na mesa", () => {
  it("humano escolhe a dama; o bot do assento 2 pega outra coisa", async () => {
    // O assento 2 preferiria "raposa" — é o determinismo. Mas a Raiza chegou primeiro.
    const { dono, codigo } = await criarSala("Tito", "leao");
    await entrar(codigo, "Raiza", "raposa");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);

    const avatares = assentosDe(dono).slice(0, 3).map((a) => a.avatar);
    expect(new Set(avatares).size, avatares.join(",")).toBe(3);
    expect(AVATARES as readonly string[]).toContain(avatares[2]);
  });

  it("mesa cheia: quatro identidades, quatro desenhos diferentes", async () => {
    const { dono, codigo } = await criarSala("Tito", "tucano");
    await entrar(codigo, "Raiza", "sapo");
    await ate(() => ocupados(dono) === 2, 8000, "dois sentados");
    await addBot(dono, 2);
    await addBot(dono, 3);

    const avatares = assentosDe(dono).map((a) => a.avatar);
    expect(new Set(avatares).size, avatares.join(",")).toBe(ASSENTOS);
  });
});

/**
 * A MESA DA SALA — cosmético com dono.
 *
 * Todo mundo joga na MESMA mesa, então a escolha não pode ser preferência de aparelho: se cada um
 * guardasse a sua, duas pessoas na mesma partida veriam mesas diferentes e a mesa deixaria de ser
 * um lugar comum. Por isso o valor vive no estado sincronizado e o dono da escolha é o anfitrião.
 *
 * Autorização é do SERVIDOR. Esconder o seletor de quem não é anfitrião é apresentação; recusar a
 * mensagem é autorização, e um cliente modificado manda a mensagem do mesmo jeito.
 */
describe("tema da mesa", () => {
  it("nasce no padrão aprovado", async () => {
    const { dono } = await criarSala();
    expect(sala(dono).tableTheme).toBe("imperial");
  });

  it("o anfitrião troca, e TODOS os clientes veem", async () => {
    const { dono, codigo } = await criarSala();
    const raiza = await entrar(codigo, "Raiza");

    dono.sdk.send("CLIENT_SET_TABLE_THEME", { theme: "verde" });
    await ate(() => sala(raiza).tableTheme === "verde", 8000, "o verde chegar no convidado");
    expect(sala(dono).tableTheme).toBe("verde");
  });

  it("quem NÃO é anfitrião é recusado, e a mesa não muda", async () => {
    const { dono, codigo } = await criarSala();
    const raiza = await entrar(codigo, "Raiza");

    const antes = raiza.rejeicoes.length;
    raiza.sdk.send("CLIENT_SET_TABLE_THEME", { theme: "verde" });
    await ate(() => raiza.rejeicoes.length > antes, 8000, "a recusa chegar");

    expect(raiza.rejeicoes.at(-1)!.code).toBe("NOT_HOST");
    expect(sala(dono).tableTheme).toBe("imperial");
    expect(sala(raiza).tableTheme).toBe("imperial");
  });

  it("etiqueta fora do conjunto fechado é recusada", async () => {
    const { dono } = await criarSala();
    const antes = dono.rejeicoes.length;
    // Nem cor, nem CSS, nem texto livre: o que trafega é uma etiqueta que o servidor conhece.
    dono.sdk.send("CLIENT_SET_TABLE_THEME", { theme: "rgb(0,255,0)" });
    await ate(() => dono.rejeicoes.length > antes, 8000, "a recusa chegar");

    expect(dono.rejeicoes.at(-1)!.code).toBe("INVALID_PAYLOAD");
    expect(sala(dono).tableTheme).toBe("imperial");
  });

  it("quem entra DEPOIS já encontra a mesa escolhida", async () => {
    const { dono, codigo } = await criarSala();
    dono.sdk.send("CLIENT_SET_TABLE_THEME", { theme: "verde" });
    await ate(() => sala(dono).tableTheme === "verde", 8000, "o verde valer");

    const atrasado = await entrar(codigo, "Atrasado");
    await ate(() => sala(atrasado).tableTheme === "verde", 8000, "o verde no recém-chegado");
  });

  it("a escolha sobrevive à saída e ao retorno de alguém", async () => {
    const { dono, codigo } = await criarSala();
    const raiza = await entrar(codigo, "Raiza");
    dono.sdk.send("CLIENT_SET_TABLE_THEME", { theme: "verde" });
    await ate(() => sala(raiza).tableTheme === "verde", 8000, "o verde valer");

    await raiza.sdk.leave(true);
    const devolta = await entrar(codigo, "Raiza");
    await ate(() => sala(devolta).tableTheme === "verde", 8000, "o verde depois do retorno");
  });
});
