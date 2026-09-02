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
    // PAUSA LARGA E BOT LENTO, de propósito. Com a pausa de produção (1150ms) e a cortesia
    // mínima (5ms), as jogadas dos bots caíam a poucos milissegundos da borda da janela — e sob
    // a carga da suíte inteira o teste ficava INTERMITENTE, contando ora duas cartas represadas,
    // ora nenhuma. Afrouxar a margem esconderia a corrida; alargar a janela a remove sem tocar
    // em uma única asserção. O que se mede continua sendo exatamente o mesmo.
    leituraDaVaza: 3_000,
    leituraDaVazaCastigo: 3_000,
    leituraDaVazaKing: 3_000,
    fimDeMao: 3_000,
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
 * Com bots na mesa, a pausa de leitura não é a única coisa entre o servidor abrir o turno e o
 * jogador poder agir. O servidor continua produzindo DURANTE a pausa, e cada carta produzida ali
 * ainda vai entrar na mesa uma de cada vez — é a cadência corrigida em 3018e97, e ela custa tempo
 * exatamente porque cada carta agora é perceptível.
 *
 * Sem esta parcela o respiro cobriria a pausa e deixaria a diferença de fora, que é o cenário do
 * relato original: humano jogando depois de dois bots consecutivos.
 */
describe("com bots na mesa, o represamento também é descontado", () => {
  /**
   * A SEGUNDA PARCELA DA DÍVIDA: O QUE FICOU REPRESADO.
   *
   * Com bots na mesa, a pausa de leitura não é a única coisa entre o servidor abrir o turno e o
   * jogador poder agir. O servidor continua produzindo DURANTE a pausa, e cada carta produzida
   * ali ainda vai entrar na mesa uma de cada vez — é a cadência corrigida em 3018e97, e ela custa
   * tempo justamente porque cada carta agora é perceptível.
   *
   * O CENÁRIO NÃO SE ENCOMENDA: ele exige que um BOT vença a vaza, para que a seguinte comece
   * por ele. Quem decide isso é o baralho. Por isso o teste PROCURA a situação ao longo da mão em
   * vez de supor que ela cai na primeira vaza — e reprova explicitamente se não a encontrar, para
   * nunca passar por não ter medido nada.
   */
  it("o humano depois de bots recebe o prazo cheio a partir de quando pode agir", async () => {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    const humanos: Sintetico[] = [];
    for (const seat of [0, 1] as Seat[]) {
      const sdk = await colyseus.connectTo(room, {
        protocolVersion: PROTOCOL_VERSION, nick: `H${seat}`, avatar: AVATARES[seat],
      });
      const c: Sintetico = { seat, sdk: sdk as never, view: null, relogios: [] };
      sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => { c.view = m.view; });
      sdk.onMessage("TURN_CLOCK", (m: RelogioDaDecisao) => c.relogios.push({ m, em: Date.now() }));
      humanos.push(c);
    }
    // Dois bots completam a mesa nos assentos 2 e 3 — CONSECUTIVOS, que é o cenário do relato.
    humanos[0].sdk.send("CLIENT_ADD_BOT", { seat: 2 });
    humanos[0].sdk.send("CLIENT_ADD_BOT", { seat: 3 });
    await ate(() => room.state.seats.filter((a) => a.bot).length === 2, 15_000, "dois bots");

    for (const c of humanos) c.sdk.send("CLIENT_SET_READY", { ready: true });
    await ate(() => humanos.every((c) => c.view !== null), 15_000, "início da partida");
    await resolverTrunfo(room, humanos);

    const mao = () => room.autoridadeDaPartida().estadoAutoritativo()?.hand;
    const ehHumano = () => {
      const c = daVezNaAutoridade(room, humanos);
      return !!c && humanos.includes(c);
    };

    let medido = false;
    for (let vaza = 0; vaza < 12 && !medido; vaza++) {
      if ((mao()?.handScores ?? null) !== null) break;
      const alvo = (mao()?.completedTricks.length ?? 0) + 1;

      // Fecha mais uma vaza: o humano joga quando é dele, o servidor age pelos bots.
      const limite = Date.now() + 30_000;
      while ((mao()?.completedTricks.length ?? 0) < alvo) {
        if (Date.now() > limite) throw new Error("a vaza não fechou");
        if (ehHumano()) await jogarUma(room, humanos);
        else await new Promise((r) => setTimeout(r, 5));
      }
      const fechouEm = Date.now();
      const pausa = pausaDaLeitura(room.autoridadeDaPartida().estadoAutoritativo()!);
      const fimDaPausa = fechouEm + pausa;

      // Observa a vaza nova nascendo e marca quantas cartas caíram DENTRO da pausa: são essas que
      // ainda vão precisar do seu instante para entrar na mesa.
      let represados = 0;
      let vistas = 0;
      await ate(() => {
        const agora = mao()?.currentTrick.length ?? 0;
        if (agora > vistas) {
          if (Date.now() < fimDaPausa) represados += agora - vistas;
          vistas = agora;
        }
        return ehHumano() || (mao()?.handScores ?? null) !== null;
      }, 20_000, "a vez voltar a um humano");

      if ((mao()?.handScores ?? null) !== null) break; // a mão acabou: não há turno para medir
      if (represados === 0) continue;                  // vaza sem bot antes do humano: procura outra

      const proximo = daVezNaAutoridade(room, humanos)!;
      const r = await relogioDepoisDe(proximo, fechouEm, proximo.seat);
      // A LIBERAÇÃO REAL inclui a drenagem: a pausa mais uma cadência por carta represada.
      const util = prazoUtil(r, fechouEm, pausa + represados * TEMPOS.passoDaApresentacao);
      expect(
        util,
        `humano depois de ${represados} carta(s) represada(s) recebeu ${util}ms úteis de ${TURNO}ms`,
      ).toBeGreaterThanOrEqual(TURNO - MARGEM);
      medido = true;
    }

    expect(medido, "o cenário bot-antes-de-humano não apareceu — nada foi medido").toBe(true);
  }, 90_000);
});
