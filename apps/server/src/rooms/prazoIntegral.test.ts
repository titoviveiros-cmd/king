// O PRAZO DO HUMANO CHEGA INTEIRO — no instante em que a decisão fica visível no cliente.
//
// ══ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ══
//
// O prazo começa quando o SERVIDOR abre o turno. A possibilidade de jogar começa quando o CLIENTE
// apresenta a atualização que abriu o turno — e ela entra na mesa no ritmo da fila: a cadência
// desde a anterior e a pausa de leitura da vaza que fechou. Entre um instante e o outro o relógio
// corre contra alguém que ainda não pode agir; e, se o servidor somar tempo demais, infla o relógio
// de quem já pode.
//
// ══ O CONTRATO TEM DOIS LADOS ══
//
// No instante em que a decisão fica visível resta o prazo NOMINAL: nem menos (erodido), nem mais
// (inflado). As duas versões anteriores deste arquivo afirmavam só o piso — e cada uma escondeu um
// defeito do outro lado:
//
//   1. exigiam que o LÍDER da vaza seguinte recebesse a pausa inteira. Falso: a Mesa habilita as
//      cartas dele durante a pausa. Medido no navegador: 25,6s e 27,2s no instante clicável;
//   2. descontavam `represadas × passo` a partir do FECHAMENTO no servidor. Medido no navegador,
//      com a fila corrigida: até +523ms acima do nominal — e o líder até −329ms abaixo, porque a
//      carta que fecha a vaza também espera a cadência.
//
// ══ COMO "VISÍVEL" É CALCULADO AQUI ══
//
// Cada cliente sintético registra o instante de CHEGADA de cada estado. Sobre essa linha do tempo
// roda a recorrência da fila do cliente (`instanteDaApresentacao`, cuja equivalência com a do
// cliente é travada em apps/web/src/game/espelhoDaApresentacao.test.ts). Ela explicou o DOM real
// com mediana de 2–5ms em 176 decisões. Quem prova o instante CLICÁVEL de verdade é o navegador:
// apps/web/tests/prazoJogavel.spec.ts.
//
// ══ POR QUE 4 HUMANOS E NENHUM BOT ══
//
// É o cenário determinístico: quem joga é o próprio teste, no instante que escolhe. Sem sorteio,
// sem depender de qual vaza saiu bucha, sem bot decidindo a hora de uma jogada.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { cardId, legalCardsFor, type PlayerView, type Seat } from "@king/engine";
import { configurarTempos, restaurarTempos, TEMPOS, TEMPOS_PADRAO } from "../match/tempos.js";
import {
  espelhoVazio, instanteDaApresentacao, pausaDaLeitura, publicarNoEspelho, saltarEspelho,
} from "../match/pausaDaVaza.js";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import {
  PROTOCOL_VERSION, type AtualizacaoDeEstado, type Causa, type RelogioDaDecisao,
} from "../protocol/index.js";
import type { KingRoom } from "./KingRoom.js";

const SEATS: Seat[] = [0, 1, 2, 3];
const TURNO = 20_000;

/**
 * MARGEM DE AGENDAMENTO, e só isso.
 *
 * O servidor calcula o prazo em `Date.now()` e o teste mede em `Date.now()`; entre os dois há o
 * caminho do socket, o laço de eventos e a fatia de CPU que o Node resolveu dar. 150ms cobre isso
 * com sobra e fica abaixo do menor desvio que cada defeito produz aqui (a cadência de 520ms).
 * Não é tolerância para "23s valer por 25s" — é ruído de relógio.
 */
const MARGEM = 150;

let colyseus: ColyseusTestServer;
beforeAll(async () => {
  configurarTempos({
    pisoDoPlacar: 1, autoReadyDesconectado: 3_600_000, autoReadyConectado: 3_600_000,
    turno: TURNO, trunfo: 3_600_000, primeiraJogadaExtra: 0, aberturaDaUltimaMao: 0,
    // ══ A JANELA É ENORME DE PROPÓSITO: É ASSIM QUE A CORRIDA MORRE ══
    //
    // As jogadas "durante a pausa" precisam cair DENTRO dela sem depender de escorregão de timer
    // sob a carga da suíte inteira. Com 15s de pausa, caem a ~14s da borda. A corrida não é
    // tolerada, é removida — e nenhuma asserção foi afrouxada para isso.
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

interface Chegada { t: number; causa: Causa; versao: number; view: PlayerView }

interface Sintetico {
  seat: Seat;
  sdk: { send: (t: string, m?: unknown) => void; onMessage: (t: string, cb: (...a: never[]) => void) => void };
  view: PlayerView | null;
  /** Última versão autoritativa que este cliente aplicou. */
  versao: number;
  /** Cada estado recebido, com o instante de CHEGADA — a linha do tempo da fila do cliente. */
  chegadas: Chegada[];
  /**
   * Os relógios recebidos, cada um com a VERSÃO que o cliente já tinha aplicado quando ele
   * chegou. É esse par que permite dizer a QUAL decisão o relógio pertence.
   */
  relogios: { m: RelogioDaDecisao; versao: number; t: number }[];
}

async function salaCom4(): Promise<{ room: KingRoom; clientes: Sintetico[] }> {
  const room = await colyseus.createRoom<KingRoom>(SALA_KING);
  const clientes: Sintetico[] = [];
  for (const seat of SEATS) {
    const sdk = await colyseus.connectTo(room, {
      protocolVersion: PROTOCOL_VERSION, nick: `P${seat}`, avatar: AVATARES[seat % AVATARES.length],
    });
    const c: Sintetico = { seat, sdk: sdk as never, view: null, versao: 0, chegadas: [], relogios: [] };
    sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => {
      c.view = m.view; c.versao = m.stateVersion;
      c.chegadas.push({ t: Date.now(), causa: m.cause, versao: m.stateVersion, view: m.view });
    });
    // A VERSÃO VIGENTE VAI JUNTO. O servidor difunde o estado ANTES do relógio, no mesmo bloco
    // (`#publicar` faz o fan-out e só então `#reagendar` anuncia), e o transporte preserva a
    // ordem por cliente. Então a versão registrada aqui é a da decisão a que este relógio
    // pertence — e é por ela que se identifica o relógio, nunca pelo instante.
    sdk.onMessage("TURN_CLOCK", (m: RelogioDaDecisao) => c.relogios.push({ m, versao: c.versao, t: Date.now() }));
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


/**
 * O RELÓGIO DE UMA DECISÃO — identificado pela VERSÃO autoritativa, nunca pelo instante.
 *
 * ══ TRÊS ENGANOS, E CADA UM ENSINOU O SEGUINTE ══
 *
 * A primeira versão esperava `ultimo(c)` ser não-nulo — e ele já era, desde a primeira jogada da
 * partida. O teste lia um relógio VELHO e reprovava com o número certo pelo motivo errado.
 *
 * A segunda usou um corte por RELÓGIO DE PAREDE: `r.em >= marco`, com `marco = Date.now()`
 * tirado depois de a jogada ser aceita. Parecia seguro e não era. Quando a carta que fecha a vaza
 * chega, o servidor aplica a mutação E anuncia o relógio no MESMO bloco síncrono; o transporte do
 * `@colyseus/testing` é em processo, então o cliente pode registrar o relógio ANTES de o laço de
 * espera do teste (1ms) perceber a mudança de estado e tirar o `marco`. Nesse caso `r.em < marco`
 * e o ÚNICO relógio que servia era descartado — 10s de espera e "tempo esgotado".
 *
 * Localmente a ordem caía sempre do lado bom (22 execuções verdes); na CI, não. Não é
 * intermitência: é critério de identidade errado. Tempo não identifica um evento que é
 * causalmente simultâneo à observação.
 *
 * A terceira usou a POSIÇÃO na fila de mensagens. Também errada, e pelo mesmo tipo de motivo:
 * numa vaza o mesmo assento pode receber DOIS relógios de `PLAY` — o da vez dele antes de jogar e
 * o da vez dele na vaza seguinte. A posição não distingue os dois quando a entrega do primeiro
 * atravessa o marco.
 *
 * O critério certo não é tempo nem posição: é CAUSALIDADE. Cada relógio é registrado com a
 * versão autoritativa que o cliente já havia aplicado quando ele chegou, e a decisão que
 * interessa é a primeira com versão >= a versão de DEPOIS da jogada que a abriu.
 */
async function relogioDaDecisao(c: Sintetico, versaoMinima: number, seat: Seat) {
  const achar = () => c.relogios.find(
    (r) => r.versao >= versaoMinima && r.m.seat === seat && r.m.tipo === "PLAY",
  );
  await ate(() => !!achar(), 10_000, "o relógio da decisão desta versão");
  return achar()!;
}

const SALTOS: ReadonlySet<Causa> = new Set<Causa>(["RESYNC", "RECONNECTED", "MATCH_STARTED"]);

/**
 * QUANDO ESTE CLIENTE MOSTRA A VERSÃO `versao` — a fila do cliente, rodada sobre as chegadas reais.
 *
 * A primeira visão e os saltos entram na hora e limpam fila e pausa. As demais passam pelo espelho
 * da fila (`publicarNoEspelho`, com colapso), cuja equivalência com a fila do cliente — montada com
 * as funções REAIS do cliente — é travada em apps/web/src/game/espelhoDaApresentacao.test.ts.
 * A carta que FECHA uma vaza abre a pausa; virar a mão limpa a pausa.
 */
function visivelEm(c: Sintetico, versao: number): number {
  let espelho = espelhoVazio();
  let fechadasAntes = 0;
  for (let i = 0; i < c.chegadas.length; i++) {
    const u = c.chegadas[i];
    const fechadas = u.view.hand?.completedTricks.length ?? 0;
    let em: number;
    if (i === 0 || SALTOS.has(u.causa)) {
      espelho = saltarEspelho(u.t);
      em = u.t;
    } else {
      const r = publicarNoEspelho(espelho, {
        chegada: u.t,
        pausa: u.causa === "CARD_PLAYED" && fechadas > fechadasAntes ? pausaDaLeitura(u.view) : 0,
        viraMao: u.causa === "HAND_ADVANCED",
      }, TEMPOS.passoDaApresentacao);
      espelho = r.espelho;
      em = r.visivelEm;
    }
    fechadasAntes = fechadas;
    if (u.versao === versao) return em;
  }
  throw new Error(`a versão ${versao} não chegou a este cliente`);
}

/**
 * O PRAZO NO INSTANTE VISÍVEL: quanto resta quando a decisão entra na mesa deste jogador.
 *
 * `fim` é quando o prazo autoritativo expira, lido na chegada do relógio. `visivel` é quando a fila
 * do cliente mostra a decisão. Se ela já estava visível quando o relógio chegou, conta-se da
 * chegada do relógio — antes dele o jogador não tem cronômetro para perder.
 */
function prazoNoInstanteVisivel(c: Sintetico, r: { m: RelogioDaDecisao; versao: number; t: number }) {
  const visivel = visivelEm(c, r.versao);
  const fim = r.t + r.m.restanteMs;
  return { restante: fim - Math.max(visivel, r.t), atraso: Math.max(0, visivel - r.t) };
}

/** Teto e piso, com a explicação de cada lado. */
function exigirNominal(rotulo: string, p: { restante: number; atraso: number }): void {
  expect(
    p.restante,
    `${rotulo}: visível com ${p.restante}ms de um prazo de ${TURNO}ms (a fila atrasou ${p.atraso}ms) — ` +
    "INFLADO: o servidor somou tempo a quem já podia agir",
  ).toBeLessThanOrEqual(TURNO + MARGEM);
  expect(
    p.restante,
    `${rotulo}: visível com ${p.restante}ms de um prazo de ${TURNO}ms (a fila atrasou ${p.atraso}ms) — ` +
    "ERODIDO: o relógio correu enquanto a mesa ainda não mostrava a vez",
  ).toBeGreaterThanOrEqual(TURNO - MARGEM);
}

/**
 * ══ O LÍDER DA VAZA SEGUINTE ══
 *
 * A Mesa habilita as cartas dele DURANTE a pausa de leitura — então a pausa não é dele. Mas a carta
 * que FECHOU a vaza ainda precisa entrar na mesa, e ela entra na cadência: aqui, com as quatro
 * cartas jogadas em sequência rápida, ~3 passos depois de chegar. Só a partir daí ele pode agir.
 */
describe("o líder da vaza seguinte: nominal no instante em que a vaza fechada aparece", () => {
  it("o líder recebe o prazo nominal — sem a pausa, e sem pagar a cadência da carta que fechou", async () => {
    const { room, clientes } = await salaCom4();
    await resolverTrunfo(room, clientes);
    for (let i = 0; i < 4; i++) await jogarUma(room, clientes);
    const versao = room.autoridadeDaPartida().stateVersion;
    const m = room.autoridadeDaPartida().estadoAutoritativo()!;
    expect(m.hand!.completedTricks.length, "a vaza não fechou").toBe(1);
    expect(pausaDaLeitura(m), "pausa de leitura nula — o cenário não é o que se quer medir").toBeGreaterThan(0);

    await ate(() => !!daVezNaAutoridade(room, clientes), 10_000, "o próximo turno abrir");
    const lider = daVezNaAutoridade(room, clientes)!;
    const r = await relogioDaDecisao(lider, versao, lider.seat);
    const p = prazoNoInstanteVisivel(lider, r);
    expect(p.atraso, "a carta que fechou não esperou cadência — o cenário não mede o que se quer")
      .toBeGreaterThan(TEMPOS.passoDaApresentacao);
    exigirNominal("líder da vaza 2", p);
  }, 60_000);

  it("em duas vazas seguidas, cada líder recebe o nominal", async () => {
    const { room, clientes } = await salaCom4();
    await resolverTrunfo(room, clientes);
    for (let vaza = 1; vaza <= 2; vaza++) {
      for (let i = 0; i < 4; i++) await jogarUma(room, clientes);
      const versao = room.autoridadeDaPartida().stateVersion;
      expect(room.autoridadeDaPartida().estadoAutoritativo()!.hand!.completedTricks.length).toBe(vaza);
      await ate(() => !!daVezNaAutoridade(room, clientes), 10_000, "o próximo turno abrir");
      const lider = daVezNaAutoridade(room, clientes)!;
      const r = await relogioDaDecisao(lider, versao, lider.seat);
      exigirNominal(`líder da vaza ${vaza + 1}`, prazoNoInstanteVisivel(lider, r));
    }
  }, 60_000);
});

describe("a regra da pausa espelha a do cliente", () => {
  it("sem vaza fechada não há o que descontar", () => {
    expect(pausaDaLeitura(null)).toBe(0);
  }, 60_000);

  it("a apresentação: o mais tardio entre chegada, cadência e pausa", () => {
    const passo = 520;
    expect(instanteDaApresentacao({ agora: 1000, ultimaEm: null, pausaAte: 0, passo })).toBe(1000);
    expect(instanteDaApresentacao({ agora: 1000, ultimaEm: 900, pausaAte: 0, passo })).toBe(1420);
    expect(instanteDaApresentacao({ agora: 1000, ultimaEm: 900, pausaAte: 5000, passo })).toBe(5000);
    expect(instanteDaApresentacao({ agora: 9000, ultimaEm: 900, pausaAte: 5000, passo })).toBe(9000);
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
 * ══ O QUE FOI JOGADO DURANTE A PAUSA ══
 *
 * O que for jogado DURANTE a pausa entra na mesa depois dela, uma carta por passo — e o humano da
 * vez só pode agir quando a carta que abriu a vez dele entrar. Com N represadas isso é
 * `fim da pausa + (N − 1) × passo` SE a carta que fechou entrou na hora; se ela também esperou a
 * cadência, a pausa começa mais tarde. Nenhuma conta fixa acerta os dois casos — por isso o
 * servidor espelha a fila, e o teste afirma o resultado no instante visível para 1, 2 e 3.
 *
 * ══ POR QUE SEM BOTS ══
 *
 * A primeira versão deste teste montava 2 humanos + 2 bots e procurava uma vaza em que um bot
 * vencesse. Dependia do baralho e do relógio: reprovava em cerca de uma execução em quinze. Aqui
 * QUEM JOGA É O TESTE, no instante que ele escolhe, dentro de uma janela de 15s. Zero sorteio,
 * zero corrida.
 */
/**
 * Espera a última atualização recebida entrar na mesa — o que um jogador de verdade faz antes de
 * jogar a carta seguinte.
 *
 * NÃO é espera para esconder corrida: é o CENÁRIO. Com trunfo, quatro cartas e mais três jogadas a
 * milissegundos umas das outras, a fila do cliente passa de `LIMITE_DA_FILA` e COLAPSA — salta para
 * o presente e descarta a pausa. Aí não há represamento nenhum a medir, e a guarda de cenário
 * abaixo reprova, como deve. Medido: "a decisão não esperou a pausa: 511ms".
 */
async function aguardarVisivel(c: Sintetico): Promise<void> {
  const alvo = visivelEm(c, c.versao);
  await ate(() => Date.now() >= alvo, 10_000, "a última atualização entrar na mesa");
}

describe("o que foi jogado durante a pausa: nominal no instante visível", () => {
  for (const represadas of [1, 2, 3]) {
    it(`com ${represadas} carta(s) represada(s), o humano seguinte recebe o nominal`, async () => {
      const { room, clientes } = await salaCom4();
      await resolverTrunfo(room, clientes);
      // A vaza fecha com a mesa em dia: a pausa começa quando a carta que fecha chega.
      for (let i = 0; i < 4; i++) {
        await aguardarVisivel(clientes[0]);
        await jogarUma(room, clientes);
      }
      const fechouEm = Date.now();
      const pausa = pausaDaLeitura(room.autoridadeDaPartida().estadoAutoritativo()!);
      expect(pausa, "sem pausa não há represamento a medir").toBeGreaterThan(0);

      for (let i = 0; i < represadas; i++) await jogarUma(room, clientes);
      const versao = room.autoridadeDaPartida().stateVersion;
      expect(Date.now(), "a jogada saiu da janela da pausa — o cenário não é o que se quer medir")
        .toBeLessThan(fechouEm + pausa);

      await ate(() => !!daVezNaAutoridade(room, clientes), 10_000, "o turno seguinte abrir");
      const proximo = daVezNaAutoridade(room, clientes)!;
      const r = await relogioDaDecisao(proximo, versao, proximo.seat);
      const p = prazoNoInstanteVisivel(proximo, r);
      expect(p.atraso, "a decisão não esperou a pausa — o cenário não mede o que se quer")
        .toBeGreaterThan(pausa - MARGEM);
      exigirNominal(`${represadas} represada(s)`, p);
    }, 60_000);
  }
});
