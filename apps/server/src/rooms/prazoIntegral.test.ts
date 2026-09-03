// O PRAZO DO HUMANO CHEGA INTEIRO — mesmo quando a apresentação anterior ainda está na tela.
//
// ══ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ══
//
// O prazo começa quando o SERVIDOR abre o turno. A possibilidade de jogar começa quando o CLIENTE
// termina de apresentar o que veio antes — a pausa de leitura da vaza, e as cartas que o servidor
// produziu durante ela. Entre um instante e o outro o relógio corre contra alguém que ainda não
// pode agir.
//
// Medido antes desta correção: até 1980ms de 25000ms num caso de bots consecutivos, e a pausa de
// leitura INTEIRA (até 3400ms) quando o próprio humano lidera a vaza seguinte — que é o caso pior
// e o que passou despercebido na primeira medição.
//
// ══ POR QUE O TESTE MEDE "PRAZO ÚTIL", E NÃO "PRAZO" ══
//
// O prazo anunciado sempre foi 25s; o defeito nunca esteve nele. O que faltava era descontar o
// tempo em que a mesa estava legitimamente parada. Por isso a asserção é sobre a diferença entre
// o instante em que o jogador PODE agir e o instante em que o prazo termina — que é o tempo que
// ele de fato tem.
//
// ══ POR QUE 4 HUMANOS E NENHUM BOT ══
//
// É o cenário determinístico: sem bot, nada é produzido durante a pausa, então a dívida é
// exatamente a pausa de leitura. Sem sorteio, sem depender de qual vaza saiu bucha. Os bots
// entram no segundo bloco, onde o que se mede é a parcela de represamento.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { cardId, legalCardsFor, type PlayerView, type Seat } from "@king/engine";
import { configurarTempos, restaurarTempos, TEMPOS, TEMPOS_PADRAO } from "../match/tempos.js";
import { pausaDaLeitura } from "../match/pausaDaVaza.js";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import {
  PROTOCOL_VERSION, type AtualizacaoDeEstado, type RelogioDaDecisao,
} from "../protocol/index.js";
import type { KingRoom } from "./KingRoom.js";

const SEATS: Seat[] = [0, 1, 2, 3];
const TURNO = 20_000;

/**
 * MARGEM DE AGENDAMENTO, e só isso.
 *
 * O servidor calcula o prazo em `Date.now()` e o teste mede em `Date.now()`; entre os dois há o
 * caminho do socket, o laço de eventos e a fatia de CPU que o Node resolveu dar. 150ms cobre isso
 * com sobra e está uma ordem de grandeza abaixo da dívida que se quer pegar (1150ms na pausa mais
 * curta). Não é tolerância para "23s valer por 25s" — é ruído de relógio.
 */
const MARGEM = 150;

let colyseus: ColyseusTestServer;
beforeAll(async () => {
  configurarTempos({
    pisoDoPlacar: 1, autoReadyDesconectado: 3_600_000, autoReadyConectado: 3_600_000,
    turno: TURNO, trunfo: 3_600_000, primeiraJogadaExtra: 0, aberturaDaUltimaMao: 0,
    // ══ A JANELA É ENORME DE PROPÓSITO: É ASSIM QUE A CORRIDA MORRE ══
    //
    // O teste conta as cartas represadas pelo instante em que OBSERVA a autoridade mudar; o
    // servidor conta pelo instante em que publica. A autoridade muda um pouco ANTES da
    // publicação, então na borda da janela os dois discordam por milissegundos — e sob a carga
    // da suíte inteira, com timers escorregando, a borda era alcançada. O teste falhava em
    // cerca de uma execução em cinco.
    //
    // Com 15s de pausa e bots de 200ms, as jogadas caem a ~14,6s da borda: nenhum escorregão
    // plausível chega perto. A corrida não é tolerada, é removida — e nenhuma asserção foi
    // afrouxada para isso. O que se mede continua sendo exatamente o mesmo.
    leituraDaVaza: 15_000,
    leituraDaVazaCastigo: 15_000,
    leituraDaVazaKing: 15_000,
    fimDeMao: 15_000,
    cortesiaDoBot: 200,
  });
  colyseus = await boot(servidor);
});
afterAll(() => restaurarTempos());
afterAll(async () => { await colyseus.shutdown(); });
beforeEach(async () => { await colyseus.cleanup(); });

async function ate(cond: () => boolean, ms = 15_000, rotulo = "?"): Promise<void> {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("tempo esgotado esperando: " + rotulo);
    await new Promise((r) => setTimeout(r, 1));
  }
}

interface Sintetico {
  seat: Seat;
  sdk: { send: (t: string, m?: unknown) => void; onMessage: (t: string, cb: (...a: never[]) => void) => void };
  view: PlayerView | null;
  relogios: { m: RelogioDaDecisao; em: number }[];
}

async function salaCom4(): Promise<{ room: KingRoom; clientes: Sintetico[] }> {
  const room = await colyseus.createRoom<KingRoom>(SALA_KING);
  const clientes: Sintetico[] = [];
  for (const seat of SEATS) {
    const sdk = await colyseus.connectTo(room, {
      protocolVersion: PROTOCOL_VERSION, nick: `P${seat}`, avatar: AVATARES[seat % AVATARES.length],
    });
    const c: Sintetico = { seat, sdk: sdk as never, view: null, relogios: [] };
    sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => { c.view = m.view; });
    // O INSTANTE DA CHEGADA importa tanto quanto o valor: `restanteMs` só significa alguma coisa
    // junto com o momento em que foi lido.
    sdk.onMessage("TURN_CLOCK", (m: RelogioDaDecisao) => c.relogios.push({ m, em: Date.now() }));
    clientes.push(c);
  }
  for (const c of clientes) c.sdk.send("CLIENT_SET_READY", { ready: true });
  await ate(() => clientes.every((c) => c.view !== null), 15_000, "início da partida");
  return { room, clientes };
}

let seq = 0;
/** Quem a AUTORIDADE está esperando — nunca a visão do cliente, que pode estar atrás. */
function daVezNaAutoridade(room: KingRoom, cs: Sintetico[]): Sintetico | undefined {
  const h = room.autoridadeDaPartida().estadoAutoritativo()?.hand;
  if (!h || h.handScores !== null || h.turn === null) return undefined;
  return cs[h.turn];
}

/**
 * Joga uma carta legal pelo protocolo — o mesmo caminho de um cliente de verdade.
 *
 * QUEM É DA VEZ VEM DA AUTORIDADE, não da visão do cliente. A primeira versão perguntava ao
 * `view`, que chega por mensagem e pode estar um passo atrás; `legalCardsFor` então devolvia
 * lista vazia e o teste morria com "Cannot read properties of undefined" — reprovando por engano
 * meu, sem chegar perto do que veio medir.
 */
async function jogarUma(room: KingRoom, clientes: Sintetico[]): Promise<void> {
  const m = room.autoridadeDaPartida().estadoAutoritativo()!;
  const turno = m.hand?.turn;
  if (turno === null || turno === undefined) throw new Error("ninguém é da vez");
  const c = clientes[turno]!;
  const carta = legalCardsFor(m, turno)[0];
  if (!carta) throw new Error("nenhuma carta legal para o assento da vez");
  const antes = m.hand!.completedTricks.length + m.hand!.currentTrick.length;
  c.sdk.send("CLIENT_PLAY_CARD", { actionId: `p-${++seq}`, cardId: cardId(carta) });
  await ate(() => {
    const h = room.autoridadeDaPartida().estadoAutoritativo()?.hand;
    return !!h && h.completedTricks.length + h.currentTrick.length !== antes;
  }, 10_000, "a carta ser aceita");
}

/** Escolhe o trunfo, se a mão pedir, para chegar às jogadas. */
async function resolverTrunfo(room: KingRoom, clientes: Sintetico[]): Promise<void> {
  const m = room.autoridadeDaPartida().estadoAutoritativo()!;
  const alvo = m.hand?.awaitingTrumpFrom;
  if (alvo === null || alvo === undefined) return;
  const c = clientes[alvo]!;
  c.sdk.send("CLIENT_SELECT_TRUMP", { actionId: `t-${++seq}`, trump: "hearts" });
  await ate(() => room.autoridadeDaPartida().estadoAutoritativo()?.hand?.awaitingTrumpFrom === null,
    10_000, "trunfo escolhido");
}

/** O último relógio que o servidor anunciou, com o instante em que chegou. */
const ultimo = (c: Sintetico) => c.relogios[c.relogios.length - 1];

/**
 * ESPERA O RELÓGIO NOVO, e não "algum" relógio.
 *
 * A primeira versão esperava `ultimo(c)` ser não-nulo — e ele já era, desde a primeira jogada da
 * partida. O teste lia um relógio VELHO e reprovava com o número certo pelo motivo errado: teria
 * continuado vermelho mesmo com a correção aplicada, que é a pior espécie de teste.
 */
async function relogioDepoisDe(c: Sintetico, marco: number, seat: Seat) {
  await ate(
    () => c.relogios.some((r) => r.em >= marco && r.m.seat === seat && r.m.tipo === "PLAY"),
    10_000, "o relógio do turno seguinte",
  );
  return c.relogios.filter((r) => r.em >= marco && r.m.seat === seat && r.m.tipo === "PLAY")[0]!;
}

/**
 * O PRAZO ÚTIL: quanto tempo o jogador realmente tem depois de a mesa liberar.
 *
 * `libera` é quando a apresentação termina — a pausa de leitura contada a partir do fechamento da
 * vaza. `fim` é quando o prazo autoritativo expira. A diferença é o que ele pode usar.
 */
function prazoUtil(r: { m: RelogioDaDecisao; em: number }, fechouEm: number, pausa: number): number {
  const fim = r.em + r.m.restanteMs;
  const libera = fechouEm + pausa;
  return fim - libera;
}

describe("depois que uma vaza fecha, o prazo do próximo humano chega inteiro", () => {
  it("quem joga a primeira carta da vaza seguinte não paga a pausa de leitura", async () => {
    const { room, clientes } = await salaCom4();
    await resolverTrunfo(room, clientes);

    // Uma vaza inteira: quatro cartas.
    for (let i = 0; i < 4; i++) await jogarUma(room, clientes);
    const fechouEm = Date.now();

    const m = room.autoridadeDaPartida().estadoAutoritativo()!;
    expect(m.hand!.completedTricks.length, "a vaza não fechou").toBe(1);
    const pausa = pausaDaLeitura(m);
    expect(pausa, "pausa de leitura nula — o cenário não é o que se quer medir")
      .toBeGreaterThan(0);

    await ate(() => !!daVezNaAutoridade(room, clientes), 10_000, "o próximo turno abrir");
    const proximo = daVezNaAutoridade(room, clientes)!;
    const r = await relogioDepoisDe(proximo, fechouEm, proximo.seat);

    const util = prazoUtil(r, fechouEm, pausa);
    expect(
      util,
      `o jogador recebeu ${util}ms úteis de um prazo de ${TURNO}ms — ` +
      `a pausa de leitura de ${pausa}ms foi cobrada dele`,
    ).toBeGreaterThanOrEqual(TURNO - MARGEM);
  }, 60_000);

  it("o prazo anunciado continua sendo o prazo — o respiro DECAI, não infla o relógio", async () => {
    const { room, clientes } = await salaCom4();
    await resolverTrunfo(room, clientes);
    for (let i = 0; i < 4; i++) await jogarUma(room, clientes);
    const fechouEm = Date.now();
    const pausa = pausaDaLeitura(room.autoridadeDaPartida().estadoAutoritativo()!);

    await ate(() => !!daVezNaAutoridade(room, clientes), 10_000, "o próximo turno abrir");
    const proximo = daVezNaAutoridade(room, clientes)!;
    const r = await relogioDepoisDe(proximo, fechouEm, proximo.seat);

    // Passada a pausa, o que resta tem de ser o prazo cheio — nem mais, nem menos. Um respiro
    // que não decaísse apareceria aqui como um relógio maior que o prazo, e o jogador veria
    // "23s" virar "26s" sem explicação.
    const restanteAoLiberar = r.em + r.m.restanteMs - (fechouEm + pausa);
    expect(restanteAoLiberar).toBeLessThanOrEqual(TURNO + MARGEM);
  }, 60_000);
});

describe("a regra da pausa espelha a do cliente", () => {
  it("sem vaza fechada não há o que descontar", () => {
    expect(pausaDaLeitura(null)).toBe(0);
  }, 60_000);

  it("os tempos do servidor são os mesmos que o cliente apresenta", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync(
      new URL("../../../web/src/game/timings.ts", import.meta.url), "utf8",
    );
    const numero = (nome: string): number => {
      const m = new RegExp(`${nome}:\\s*([0-9_]+)`).exec(fonte);
      if (!m) throw new Error(`${nome} não encontrado em timings.ts`);
      return Number(m[1].replace(/_/g, ""));
    };
    // Um número copiado à mão vira mentira silenciosa no dia em que o outro lado muda. Este teste
    // é o que impede os dois lados de se separarem sem ninguém perceber.
    //
    // COMPARA COM TEMPOS_PADRAO, E NÃO CHAMA `restaurarTempos()`. A primeira versão restaurava —
    // e devolvia TODOS os prazos aos de produção no meio da suíte, com `turno` voltando de 20s
    // para 25s. O teste seguinte então media um prazo que ele não tinha configurado e passava
    // sozinho, inclusive com o defeito reintroduzido. É a mesma armadilha que `ultimaMao.test.ts`
    // já documenta, e eu caí nela.
    expect(TEMPOS_PADRAO.leituraDaVaza).toBe(numero("leituraDaVaza"));
    expect(TEMPOS_PADRAO.leituraDaVazaCastigo).toBe(numero("leituraDaVazaCastigo"));
    expect(TEMPOS_PADRAO.leituraDaVazaKing).toBe(numero("leituraDaVazaKing"));
    expect(TEMPOS_PADRAO.fimDeMao).toBe(numero("fimDeMao"));
    expect(TEMPOS_PADRAO.passoDaApresentacao).toBe(numero("botPasso"));
  }, 60_000);
});

/**
 * A SEGUNDA PARCELA DA DÍVIDA: O QUE FICOU REPRESADO.
 *
 * A pausa de leitura não é a única coisa entre o servidor abrir o turno e o jogador poder agir.
 * O que for jogado DURANTE a pausa ainda vai entrar na mesa uma carta de cada vez — é a cadência
 * corrigida em 3018e97, e ela custa tempo justamente porque cada carta agora é perceptível.
 *
 * ══ POR QUE SEM BOTS ══
 *
 * A primeira versão deste teste montava 2 humanos + 2 bots e procurava uma vaza em que um bot
 * vencesse, para que a seguinte começasse por ele. Dependia do baralho e do relógio: reprovava em
 * cerca de uma execução em quinze, ora por "nada foi medido", ora sob a carga da suíte inteira.
 * Fixar a semente reduziu, mas não eliminou.
 *
 * Um teste intermitente não é um teste: ele treina quem o lê a ignorar vermelho. E o represamento
 * não precisa de bot nenhum para existir — precisa de uma jogada acontecendo enquanto a mesa está
 * parada. Aqui QUEM JOGA É O TESTE, no instante que ele escolhe, dentro de uma janela de 15s.
 * Zero sorteio, zero corrida, e o que se mede é exatamente o mesmo.
 */
describe("o que foi jogado durante a pausa também é descontado", () => {
  it("com uma carta represada, o humano seguinte ainda recebe o prazo cheio", async () => {
    const { room, clientes } = await salaCom4();
    await resolverTrunfo(room, clientes);
    for (let i = 0; i < 4; i++) await jogarUma(room, clientes);
    const fechouEm = Date.now();
    const pausa = pausaDaLeitura(room.autoridadeDaPartida().estadoAutoritativo()!);
    expect(pausa, "sem pausa não há dívida a medir").toBeGreaterThan(0);

    // UMA carta da vaza nova, ainda DENTRO da pausa. Para a mesa ela está represada: só vai
    // entrar quando a leitura terminar, e só então o próximo pode agir.
    await jogarUma(room, clientes);
    expect(Date.now(), "a jogada saiu da janela da pausa — o cenário não é o que se quer medir")
      .toBeLessThan(fechouEm + pausa);

    await ate(() => !!daVezNaAutoridade(room, clientes), 10_000, "o turno seguinte abrir");
    const proximo = daVezNaAutoridade(room, clientes)!;
    const r = await relogioDepoisDe(proximo, fechouEm, proximo.seat);

    // A liberação real: a pausa MAIS uma cadência pela carta represada.
    const util = prazoUtil(r, fechouEm, pausa + TEMPOS.passoDaApresentacao);
    expect(
      util,
      `com 1 carta represada o jogador recebeu ${util}ms úteis de um prazo de ${TURNO}ms`,
    ).toBeGreaterThanOrEqual(TURNO - MARGEM);
  }, 60_000);

  it("duas cartas represadas custam duas cadências, e o prazo continua inteiro", async () => {
    const { room, clientes } = await salaCom4();
    await resolverTrunfo(room, clientes);
    for (let i = 0; i < 4; i++) await jogarUma(room, clientes);
    const fechouEm = Date.now();
    const pausa = pausaDaLeitura(room.autoridadeDaPartida().estadoAutoritativo()!);

    await jogarUma(room, clientes);
    await jogarUma(room, clientes);
    expect(Date.now()).toBeLessThan(fechouEm + pausa);

    await ate(() => !!daVezNaAutoridade(room, clientes), 10_000, "o turno seguinte abrir");
    const proximo = daVezNaAutoridade(room, clientes)!;
    const r = await relogioDepoisDe(proximo, fechouEm, proximo.seat);

    const util = prazoUtil(r, fechouEm, pausa + 2 * TEMPOS.passoDaApresentacao);
    expect(
      util,
      `com 2 cartas represadas o jogador recebeu ${util}ms úteis de um prazo de ${TURNO}ms`,
    ).toBeGreaterThanOrEqual(TURNO - MARGEM);
  }, 60_000);
});
