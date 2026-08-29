// O RESPIRO DA ABERTURA DA ÚLTIMA MÃO — a única concessão do servidor à apresentação.
//
// ══ POR QUE ELE EXISTE ══
//
// O cliente cobre a Mesa com o anúncio "ÚLTIMA MÃO" quando a décima começa, e durante ele nada da
// mão nova é apresentado: nem trunfo, nem leque, nem vaza. Isso é decisão de produto, e o servidor
// não sabe do anúncio.
//
// O que ele sabe é que a PRIMEIRA decisão da última mão cai numa janela em que ninguém está
// olhando para a mesa. Sem o respiro, o cliente teria de escolher entre dois defeitos, e nenhum
// dos dois se conserta do lado dele:
//
//   • deixar a partida correr atrás do véu — que é justamente o defeito que a rodada corrigiu;
//   • represar a apresentação e ficar para trás, com quem escolhe o trunfo perdendo do PRÓPRIO
//     prazo o tempo da animação, e um bot escolhendo por trás dela (900ms de cortesia contra
//     ~3,7s de anúncio).
//
// O prazo é autoritativo e o bot é o servidor. Por isso o respiro mora aqui.
//
// ══ O QUE ESTES TESTES TRAVAM ══
//
//   1. só a mão 10 ganha o respiro — as outras nove abrem como sempre abriram;
//   2. ele DECAI a partir do início da mão, em vez de ser somado a cada decisão: quem consumir o
//      respiro escolhendo o trunfo não o ganha de novo na primeira jogada. O total nunca passa da
//      duração do anúncio, que é o limite pedido;
//   3. ele vale para TODOS os assentos igualmente — humano e bot —, que é o que faz os quatro
//      aparelhos verem a mesma transição;
//   4. o número no servidor é o mesmo da animação no cliente. Dois arquivos, um valor.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { cardId, legalCardsFor, TOTAL_HANDS, type PlayerView, type Seat, type Trump } from "@king/engine";
import { configurarTempos, restaurarTempos, TEMPOS, TEMPOS_PADRAO } from "../match/tempos.js";
import { SALA_KING, servidor } from "../app.js";
import { AVATARES } from "./identidade.js";
import {
  PROTOCOL_VERSION,
  type AtualizacaoDeEstado, type RelogioDaDecisao,
} from "../protocol/index.js";
import type { KingRoom } from "./KingRoom.js";

const SEATS: Seat[] = [0, 1, 2, 3];
const RESPIRO = 3_720;
/** Prazos folgados e distinguíveis: o que se mede aqui é a DIFERENÇA que o respiro faz. */
const TURNO = 20_000;
const TRUNFO = 30_000;

let colyseus: ColyseusTestServer;
beforeAll(async () => {
  configurarTempos({
    pisoDoPlacar: 1, autoReadyDesconectado: 3_600_000, autoReadyConectado: 3_600_000,
    turno: TURNO, trunfo: TRUNFO, primeiraJogadaExtra: 0, aberturaDaUltimaMao: RESPIRO,
    // A cortesia do bot vai a 5ms para as nove primeiras mãos da mesa mista não custarem
    // minutos reais. Isso deixa a prova do respiro MAIS nítida, e não menos: sem ele o bot
    // decidiria em 5ms, e o que se mede é justamente ele não decidir durante a animação.
    cortesiaDoBot: 5,
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
    // 1ms, e não 0: com espera zero o laço fica quente e os timers do PRÓPRIO servidor
    // deixam de disparar no prazo. Numa mesa mista, em que quem age é o servidor, isso trava a
    // partida — o teste passava sozinho e estourava quando rodava junto dos outros.
    await new Promise((r) => setTimeout(r, 1));
  }
}

interface Sintetico {
  seat: Seat;
  sdk: { send: (t: string, m?: unknown) => void; onMessage: (t: string, cb: (...a: never[]) => void) => void };
  view: PlayerView | null;
  versao: number;
  relogios: RelogioDaDecisao[];
}

async function salaCom4(): Promise<{ room: KingRoom; clientes: Sintetico[] }> {
  const room = await colyseus.createRoom<KingRoom>(SALA_KING);
  const clientes: Sintetico[] = [];
  for (const seat of SEATS) {
    const sdk = await colyseus.connectTo(room, {
      protocolVersion: PROTOCOL_VERSION, nick: `P${seat}`, avatar: AVATARES[seat % AVATARES.length],
    });
    const c: Sintetico = { seat, sdk: sdk as never, view: null, versao: 0, relogios: [] };
    sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => { c.view = m.view; c.versao = m.stateVersion; });
    sdk.onMessage("TURN_CLOCK", (m: RelogioDaDecisao) => c.relogios.push(m));
    clientes.push(c);
  }
  return { room, clientes };
}

let seq = 0;
const idAcao = (p: string) => `${p}-${++seq}`;

/** O relógio mais recente que o servidor anunciou a este cliente. */
const ultimoRelogio = (c: Sintetico): RelogioDaDecisao | undefined => c.relogios[c.relogios.length - 1];

/**
 * Leva a partida até a ABERTURA da mão pedida e para ali — antes da primeira decisão dela.
 *
 * Joga pelo protocolo, como um cliente de verdade: nada de dirigir a autoridade direto, que
 * pularia o `#publicar` da Room e portanto o agendamento do relógio, que é o que se mede aqui.
 */
async function abrirMao(room: KingRoom, clientes: Sintetico[], alvo: number): Promise<void> {
  for (const c of clientes) c.sdk.send("CLIENT_SET_READY", { ready: true });
  await ate(() => clientes.every((c) => c.view !== null), 15_000, "início da partida");

  let guarda = 0;
  while (true) {
    if (guarda > 4000) throw new Error("loop de segurança: ações demais para uma partida");
    const m = room.autoridadeDaPartida().estadoAutoritativo()!;
    const h = m.hand!;
    if (h.handNumber === alvo && h.completedTricks.length === 0 && h.currentTrick.length === 0
        && h.handScores === null) {
      // O estado autoritativo já virou, mas o relógio da mão nova é uma MENSAGEM: ela chega
      // depois. Sem esperar por ela, o último relógio visto ainda é o READY do Placar anterior.
      await ate(() => clientes.every((c) => ultimoRelogio(c) && ultimoRelogio(c)!.tipo !== "READY"),
        15_000, `relógio de abertura da mão ${alvo}`);
      return;
    }

    if (h.awaitingTrumpFrom !== null) {
      // Numa mesa MISTA quem escolhe pode ser um bot — `trumpChooserFor` põe o assento 2 na mão 9
      // e o 3 na mão 10. Aí não há cliente para mandar a mensagem: quem escolhe é o servidor, e o
      // roteiro só espera. (Na mão ALVO o laço já retornou acima, antes desta decisão.)
      const quem = clientes.find((x) => x.seat === h.awaitingTrumpFrom);
      if (!quem) { await new Promise((r) => setTimeout(r, 1)); continue; }
      const antes = quem.versao;
      quem.sdk.send("CLIENT_SELECT_TRUMP", {
        actionId: idAcao("t"), trump: "hearts" as Trump, expectedStateVersion: quem.versao,
      });
      await ate(() => quem.versao > antes, 15_000, `trunfo da mão ${h.handNumber}`);
      continue;
    }
    if (h.handScores !== null) {
      const numeroAntes = h.handNumber;
      for (const c of clientes) c.sdk.send("CLIENT_READY_NEXT_HAND", { actionId: idAcao(`r${c.seat}`) });
      await ate(() => room.autoridadeDaPartida().estadoAutoritativo()!.handNumber > numeroAntes,
        15_000, `avanço da mão ${numeroAntes}`);
      continue;
    }
    // Vez de um BOT: quem age é o servidor, no prazo dele. Esperar não é uma ação, e por isso não
    // conta no guarda — foi o que estourava o limite na mesa mista sem ninguém ter jogado nada.
    const c = clientes.find((x) => x.view?.hand?.turn === x.seat && x.view.hand.handScores === null);
    if (!c) { await new Promise((r) => setTimeout(r, 1)); continue; }
    guarda++;
    const legais = legalCardsFor(c.view!, c.seat);
    const antes = c.versao;
    c.sdk.send("CLIENT_PLAY_CARD", {
      actionId: idAcao(`p${c.seat}`), cardId: cardId(legais[0]), expectedStateVersion: c.versao,
    });
    await ate(() => c.versao > antes, 15_000, `jogada da mão ${h.handNumber}`);
  }
}

describe("o respiro da abertura da última mão", () => {
  it("a mão 10 abre com o prazo do trunfo MAIS a duração do anúncio", async () => {
    const { room, clientes } = await salaCom4();
    await abrirMao(room, clientes, TOTAL_HANDS);

    const r = ultimoRelogio(clientes[0]);
    expect(r?.tipo, "a decisão de abertura da mão 10 devia ser a do trunfo").toBe("TRUMP");
    // Folga de 1s para o tempo real gasto entre o agendamento e a leitura: o que importa é que o
    // prazo passou do teto normal, e não o milissegundo exato.
    expect(r!.restanteMs,
      `a mão 10 abriu sem respiro: ${r!.restanteMs}ms para um trunfo de ${TRUNFO}ms`)
      .toBeGreaterThan(TRUNFO);
    expect(r!.restanteMs, "o respiro passou da duração do anúncio")
      .toBeLessThanOrEqual(TRUNFO + RESPIRO);
  }, 180_000);

  it("as outras nove abrem exatamente como sempre abriram", async () => {
    const { room, clientes } = await salaCom4();
    await abrirMao(room, clientes, 9);

    // A mão 9 pode abrir pedindo trunfo ou pedindo jogada, conforme o contrato dela — o que se
    // afirma é que, seja qual for, o prazo é o normal do tipo, sem nada somado.
    const r = ultimoRelogio(clientes[0])!;
    const teto = r.tipo === "TRUMP" ? TRUNFO : TURNO;
    expect(r.restanteMs,
      `a mão 9 ganhou um respiro que não é dela: ${r.restanteMs}ms num ${r.tipo} de ${teto}ms`)
      .toBeLessThanOrEqual(teto);
  }, 180_000);

  it("os quatro assentos recebem o MESMO prazo — a transição é uma só", async () => {
    const { room, clientes } = await salaCom4();
    await abrirMao(room, clientes, TOTAL_HANDS);

    const vistos = clientes.map((c) => ultimoRelogio(c));
    for (const r of vistos) expect(r?.tipo).toBe("TRUMP");
    // O `restanteMs` é medido no envio a cada cliente, então diferem por milissegundos de rede
    // sintética. O que não pode diferir é a FAIXA: ou todos têm respiro, ou nenhum tem.
    for (const r of vistos) {
      expect(r!.restanteMs, "um assento abriu a mão 10 sem o respiro que os outros tiveram")
        .toBeGreaterThan(TRUNFO);
    }
    const menor = Math.min(...vistos.map((r) => r!.restanteMs));
    const maior = Math.max(...vistos.map((r) => r!.restanteMs));
    expect(maior - menor, `os prazos divergiram entre assentos: ${maior - menor}ms`)
      .toBeLessThan(1_000);
  }, 180_000);

  it("DECAI: quem gasta o respiro escolhendo o trunfo não o ganha de novo na primeira jogada", async () => {
    const { room, clientes } = await salaCom4();
    await abrirMao(room, clientes, TOTAL_HANDS);

    // Consome o respiro inteiro antes de escolher. O anúncio já teria saído neste ponto.
    await new Promise((r) => setTimeout(r, RESPIRO + 200));

    const m = room.autoridadeDaPartida().estadoAutoritativo()!;
    const quem = clientes[m.hand!.awaitingTrumpFrom!];
    const antes = quem.versao;
    quem.sdk.send("CLIENT_SELECT_TRUMP", {
      actionId: idAcao("t"), trump: "hearts" as Trump, expectedStateVersion: quem.versao,
    });
    await ate(() => quem.versao > antes, 15_000, "trunfo da mão 10");

    const r = ultimoRelogio(clientes[0]);
    expect(r?.tipo).toBe("PLAY");
    expect(r!.restanteMs,
      `a primeira jogada da mão 10 ganhou respiro de novo: ${r!.restanteMs}ms sobre um turno de ${TURNO}ms`)
      .toBeLessThanOrEqual(TURNO);
  }, 180_000);
});

/**
 * O NÚMERO É UM SÓ, EM DOIS ARQUIVOS.
 *
 * O respiro não é folga arbitrária: é exatamente a presença do anúncio na tela. Se alguém ajustar
 * a animação e esquecer o servidor, a mão 10 volta a abrir por trás dela — e o defeito seria
 * invisível até uma partida de verdade. O contrato é lido da fonte dos dois lados.
 */
describe("o servidor e a animação combinam o mesmo tempo", () => {
  const FONTE = readFileSync(
    fileURLToPath(new URL("../../../web/src/ui/UltimaMao.tsx", import.meta.url)), "utf8");

  const numero = (nome: string): number => {
    const m = new RegExp(`const ${nome} = (\\d+);`).exec(FONTE);
    if (!m) throw new Error(`${nome} não encontrado em UltimaMao.tsx`);
    return Number(m[1]);
  };

  it("o respiro do servidor é a permanência mais a saída do anúncio", () => {
    expect(TEMPOS_PADRAO.aberturaDaUltimaMao).toBe(numero("DURACAO_MS") + numero("SAIDA_MS"));
  });

  it("e não é maior que o anúncio — atraso artificial além dele não foi autorizado", () => {
    expect(TEMPOS_PADRAO.aberturaDaUltimaMao).toBeLessThanOrEqual(numero("DURACAO_MS") + numero("SAIDA_MS"));
  });

  /**
   * Este teste já derrubou a própria suíte.
   *
   * A primeira versão chamava `restaurarTempos()` para conferir o valor em uso — e devolvia TODOS
   * os prazos aos de produção: piso do Placar de 8s, cortesia de bot de 900ms. Os testes seguintes
   * passaram a custar minutos e estouraram por tempo, com a causa a três `describe` de distância.
   *
   * Conferir a constante congelada não exige mexer no estado global. `TEMPOS_PADRAO` é `Object.
   * freeze`, então é ele que responde "qual é o valor", e nenhum teste precisa alterar nada.
   */
  it("o respiro está na tabela congelada, e não só na mutável", () => {
    expect(TEMPOS_PADRAO.aberturaDaUltimaMao).toBeGreaterThan(0);
    expect(Object.isFrozen(TEMPOS_PADRAO)).toBe(true);
    expect(TEMPOS).toHaveProperty("aberturaDaUltimaMao");
  });
});

/**
 * O BOT NÃO AVANÇA POR TRÁS DA ANIMAÇÃO.
 *
 * É a metade do problema que só o servidor resolve. No solo basta pausar o motor, que roda no
 * próprio navegador. Numa mesa mista o bot é o SERVIDOR: ele decide por cortesia de 900ms contra
 * ~3,7s de anúncio, e escolheria o trunfo — e depois jogaria — enquanto ninguém está olhando.
 * Represar a apresentação no cliente não impediria isso; só faria a mesa reaparecer adiantada.
 *
 * `trumpChooserFor(10)` é o assento 3. Com um bot ali, a primeira decisão da última mão é dele —
 * exatamente o caso que interessa.
 */
describe("na mesa mista, o bot espera a animação terminar", () => {
  /** Dois humanos e dois bots, com os bots nos assentos 2 e 3. */
  async function mesaMista(): Promise<{ room: KingRoom; clientes: Sintetico[] }> {
    const room = await colyseus.createRoom<KingRoom>(SALA_KING);
    const clientes: Sintetico[] = [];
    for (const seat of [0, 1] as Seat[]) {
      const sdk = await colyseus.connectTo(room, {
        protocolVersion: PROTOCOL_VERSION, nick: `P${seat}`, avatar: AVATARES[seat],
      });
      const c: Sintetico = { seat, sdk: sdk as never, view: null, versao: 0, relogios: [] };
      sdk.onMessage("STATE_UPDATE", (m: AtualizacaoDeEstado) => { c.view = m.view; c.versao = m.stateVersion; });
      sdk.onMessage("TURN_CLOCK", (m: RelogioDaDecisao) => c.relogios.push(m));
      clientes.push(c);
    }
    for (const seat of [2, 3]) {
      const antes = room.state.seats.filter((a) => a.bot).length;
      clientes[0].sdk.send("CLIENT_ADD_BOT", { seat });
      await ate(() => room.state.seats.filter((a) => a.bot).length > antes, 8_000, `bot no ${seat}`);
    }
    return { room, clientes };
  }

  it("o trunfo da mão 10 continua por escolher enquanto o anúncio está na tela", async () => {
    const { room, clientes } = await mesaMista();
    await abrirMao(room, clientes, TOTAL_HANDS);

    const escolhedor = room.autoridadeDaPartida().estadoAutoritativo()!.hand!.awaitingTrumpFrom;
    expect(escolhedor, "a mão 10 deveria abrir pedindo trunfo").not.toBeNull();
    expect(room.state.seats[escolhedor!].bot,
      "este teste só vale se quem escolhe o trunfo da mão 10 for um bot").toBe(true);

    // A METADE DA ANIMAÇÃO. Sem o respiro o bot teria decidido em 5ms — e em produção, com a
    // cortesia de 900ms contra ~3,7s de anúncio, teria decidido e ainda jogado. É exatamente a
    // mesa reaparecendo com a mão em curso.
    await new Promise((r) => setTimeout(r, RESPIRO / 2));
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.hand!.awaitingTrumpFrom,
      "o bot escolheu o trunfo por trás do anúncio").toBe(escolhedor);
    expect(room.autoridadeDaPartida().estadoAutoritativo()!.hand!.currentTrick.length,
      "alguém jogou uma carta por trás do anúncio").toBe(0);

    // E DEPOIS DELA o bot age normalmente: o respiro adia, não trava.
    await ate(() => room.autoridadeDaPartida().estadoAutoritativo()!.hand!.awaitingTrumpFrom === null,
      15_000, "o bot escolher o trunfo depois do anúncio");
  }, 180_000);
});

/**
 * O CRONÔMETRO SÓ COMEÇA DEPOIS DA TRANSIÇÃO — e é isto que o respiro significa na prática.
 *
 * Ele não atrasa o agendamento do relógio: soma ao prazo. Dá no mesmo para quem joga, e é o que
 * este teste mede — quando a animação termina, o que ainda resta é o prazo INTEIRO da decisão.
 * Ninguém pagou a animação com o próprio tempo de pensar.
 */
describe("o prazo útil começa quando o anúncio sai", () => {
  it("terminada a animação, resta o prazo cheio da decisão", async () => {
    const { room, clientes } = await salaCom4();
    await abrirMao(room, clientes, TOTAL_HANDS);

    const naAbertura = ultimoRelogio(clientes[0])!;
    expect(naAbertura.tipo).toBe("TRUMP");

    // Espera a animação inteira, como faria quem assistiu ao anúncio sem tocar.
    await new Promise((r) => setTimeout(r, RESPIRO));

    // O servidor não reenvia relógio sem mutação, então o restante é calculado do prazo anunciado
    // menos o que passou — a mesma conta que o cliente faz (ver `relogio.ts`).
    const decorrido = RESPIRO;
    const aindaResta = naAbertura.restanteMs - decorrido;
    expect(aindaResta,
      `quem assistiu ao anúncio inteiro perdeu ${TRUNFO - aindaResta}ms do próprio prazo`)
      .toBeGreaterThanOrEqual(TRUNFO - 500);
  }, 180_000);
});
