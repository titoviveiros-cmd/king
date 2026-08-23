/**
 * PARTIDA REMOTA — a fronteira do multiplayer no cliente.
 *
 * O que este arquivo prova, em ordem de importância:
 *
 *   1. PARIDADE — para o MESMO estado, `PartidaRemota` (alimentada pela `PlayerView` redigida)
 *      responde exatamente o mesmo que `KingGame` (dono do `MatchState` completo). É isso que
 *      garante que a Mesa não enxerga diferença entre os dois modos.
 *   2. SIGILO — o que chega ao cliente não contém carta alheia nenhuma, em nenhuma profundidade.
 *   3. INTENÇÃO — jogar, escolher trunfo e pedir a próxima mão viram MENSAGEM, nunca mutação.
 *   4. AUTORIDADE — placar, turno, fim de mão e fim de partida vêm da visão; o cliente não
 *      recalcula nada (item 7 da Fase 8).
 */
import { describe, it, expect } from "vitest";
import {
  createMatch, startNextHand, selectTrump, playCard, legalCardsFor, redactFor, cardId, chooseNormalCard,
  buildBotView, chooseNormalTrump, liveScores, rankings, matchStats,
  type Card, type MatchState, type Seat,
} from "@king/engine";
import { KingGame } from "./kingGame.js";
import { PartidaRemota } from "./partidaRemota.js";
import type { AtualizacaoDeEstado, Causa, ClienteParaServidor, MensagemDoCliente } from "../net/protocolo.js";

const SEATS: Seat[] = [0, 1, 2, 3];
const JOGADORES = ["Você", "Bia", "Léo", "Nara"];

type Enviada = { tipo: MensagemDoCliente; payload: ClienteParaServidor[MensagemDoCliente] };

/** Servidor de mentira: guarda o que foi enviado. Nenhuma rede, nenhum Colyseus. */
function espiao() {
  const enviadas: Enviada[] = [];
  const enviar = <T extends MensagemDoCliente>(tipo: T, payload: ClienteParaServidor[T]) => {
    enviadas.push({ tipo, payload } as Enviada);
  };
  return { enviadas, enviar };
}

/** O que o servidor mandaria para `seat` a partir do estado autoritativo. */
function atualizacao(m: MatchState, seat: Seat, versao: number, cause: Causa = "CARD_PLAYED"): AtualizacaoDeEstado {
  return { matchId: "m1", stateVersion: versao, view: redactFor(m, seat), cause };
}

function partidaNova(seed = 42): MatchState {
  const m = createMatch(JOGADORES, seed);
  startNextHand(m);
  return m;
}

/** Leva a mão até o fim usando SÓ o motor — a mesma autoridade que o servidor usaria. */
function terminarMao(m: MatchState): void {
  for (let guarda = 0; guarda < 3000; guarda++) {
    if (m.finished || m.hand === null) return;
    const h = m.hand;
    if (h.handScores !== null) return;
    if (h.awaitingTrumpFrom !== null) {
      const s = h.awaitingTrumpFrom;
      selectTrump(m, s, chooseNormalTrump(buildBotView(m, s).hand));
      continue;
    }
    const s = h.turn!;
    playCard(m, s, chooseNormalCard(buildBotView(m, s)));
  }
  throw new Error("a mão não encerrou dentro do limite");
}

/** Todo objeto com forma de carta encontrado em qualquer profundidade do payload SERIALIZADO. */
function cartasNoPayload(valor: unknown, achadas: Card[] = []): Card[] {
  if (!valor || typeof valor !== "object") return achadas;
  if (Array.isArray(valor)) {
    for (const v of valor) cartasNoPayload(v, achadas);
    return achadas;
  }
  const o = valor as Record<string, unknown>;
  if (typeof o.rank === "string" && typeof o.suit === "string") achadas.push(o as unknown as Card);
  for (const v of Object.values(o)) cartasNoPayload(v, achadas);
  return achadas;
}

// ═══════════════════════════════ 1. PARIDADE ═══════════════════════════════

describe("paridade entre modo local e modo multiplayer", () => {
  /** Os métodos de leitura que a Mesa, o Placar e o Placar Final consomem. */
  const LEITURAS = [
    "players", "view", "handNumber", "finished", "cumulative", "liveScores", "completedTrickCount",
    "negatives", "positives", "rankings", "winners", "history", "summary", "stats", "lastHandScores",
    "turn", "lastCompletedTrick", "trickNumber", "lastTrickBreakdown", "handBreakdownSoFar",
    "currentTrick", "handCounts", "awaitingTrumpFrom", "trump", "trumpChooser", "contract", "phase",
    "isHumanTurn", "humanChoosesTrump", "legalCards", "handOver",
  ] as const;

  it("responde IDÊNTICO ao KingGame para o mesmo estado, método a método", () => {
    const seed = 7;
    const local = new KingGame(JOGADORES, seed);
    const autoritativo = partidaNova(seed);

    // avança as duas em paralelo pelo MESMO caminho, para compararem o mesmo instante
    for (let i = 0; i < 9; i++) {
      if (local.phase() === "trump") {
        if (local.humanChoosesTrump()) local.chooseTrumpHuman("no-trump");
        else local.stepBotTrump();
        const h = autoritativo.hand!;
        const s = h.awaitingTrumpFrom!;
        selectTrump(autoritativo, s, s === 0 ? "no-trump" : chooseNormalTrump(buildBotView(autoritativo, s).hand));
      } else if (local.isHumanTurn()) {
        const c = local.legalCards()[0];
        local.playHuman(c);
        playCard(autoritativo, 0, legalCardsFor(autoritativo, 0)[0]);
      } else {
        local.stepBotPlay();
        const s = autoritativo.hand!.turn!;
        playCard(autoritativo, s, chooseNormalCard(buildBotView(autoritativo, s)));
      }
    }

    const remota = new PartidaRemota(atualizacao(autoritativo, 0, 9), 0, espiao().enviar);

    for (const nome of LEITURAS) {
      const a = JSON.stringify((local as unknown as Record<string, () => unknown>)[nome]());
      const b = JSON.stringify((remota as unknown as Record<string, () => unknown>)[nome]());
      expect(b, `divergência em ${nome}()`).toBe(a);
    }
  });

  it("gira em torno do assento do servidor: cada assento vê a SUA mão", () => {
    const m = partidaNova(11);
    for (const eu of SEATS) {
      const p = new PartidaRemota(atualizacao(m, eu, 1, "MATCH_STARTED"), eu, espiao().enviar);
      expect(p.humanSeat).toBe(eu);
      expect(p.view().yourSeat).toBe(eu);
      expect(p.view().yourHand).toHaveLength(13);
      // a mão que ele vê é MESMO a dele, carta a carta
      expect(p.view().yourHand.map(cardId).sort()).toEqual(m.hand!.hands[eu].map(cardId).sort());
    }
  });
});

// ═══════════════════════════════ 2. SIGILO ═══════════════════════════════

describe("nenhuma carta alheia chega ao cliente", () => {
  it("o payload serializado só contém a própria mão e o que é público", () => {
    const m = partidaNova(23);
    // adianta algumas jogadas para existir vaza em curso e vaza resolvida
    for (let i = 0; i < 6; i++) {
      const s = m.hand!.turn!;
      playCard(m, s, chooseNormalCard(buildBotView(m, s)));
    }

    for (const eu of SEATS) {
      const u = atualizacao(m, eu, 6);
      // exatamente o que trafega: JSON, como o transporte entrega
      const trafegado = JSON.parse(JSON.stringify(u));
      const cartas = cartasNoPayload(trafegado).map(cardId);

      const proprias = new Set(m.hand!.hands[eu].map(cardId));
      const publicas = new Set([
        ...m.hand!.completedTricks.flatMap((t) => t.cards.map((pc) => cardId(pc.card))),
        ...m.hand!.currentTrick.map((pc) => cardId(pc.card)),
      ]);

      for (const c of cartas) {
        expect(proprias.has(c) || publicas.has(c), `carta ${c} não deveria chegar ao assento ${eu}`).toBe(true);
      }

      // e a semente, que sozinha reconstruiria o baralho inteiro, vai zerada
      expect(trafegado.view.seed).toBe(0);
      // as mãos alheias vêm vazias, mas a CONTAGEM continua verdadeira
      for (const s of SEATS) {
        if (s !== eu) expect(trafegado.view.hand.hands[s]).toEqual([]);
      }
      expect(trafegado.view.hand.handCounts).toEqual(m.hand!.handCounts);
    }
  });

  it("a Mesa nunca consegue pedir as cartas legais de um adversário", () => {
    const m = partidaNova(31);
    const p = new PartidaRemota(atualizacao(m, 2, 1, "MATCH_STARTED"), 2, espiao().enviar);
    // `legalCards()` é sempre do PRÓPRIO assento — não existe versão para outro seat
    for (const c of p.legalCards()) {
      expect(m.hand!.hands[2].map(cardId)).toContain(cardId(c));
    }
  });
});

// ═══════════════════════════════ 3. INTENÇÃO ═══════════════════════════════

describe("PLAY_CARD é intenção, nunca mutação", () => {
  /**
    * Estado limpo com a vez do assento 0 ABRINDO a vaza: assim a mesa está vazia antes do toque
    * e a carta confirmada é a primeira a entrar — o que torna as asserções inequívocas.
    */
  function prontoParaJogar() {
    for (let seed = 1; seed < 200; seed++) {
      const m = partidaNova(seed);
      if (m.hand!.awaitingTrumpFrom !== null) continue;
      // avança pelo motor até o assento 0 ABRIR uma vaza (mesa vazia), para as asserções sobre
      // "a carta entrou na vaza" e "a mesa continua vazia" serem inequívocas
      for (let guarda = 0; guarda < 24; guarda++) {
        const h = m.hand!;
        if (h.handScores !== null) break;
        if (h.turn === 0 && h.currentTrick.length === 0) {
          const sp = espiao();
          return { m, p: new PartidaRemota(atualizacao(m, 0, 1, "MATCH_STARTED"), 0, sp.enviar), sp };
        }
        const s = h.turn!;
        playCard(m, s, chooseNormalCard(buildBotView(m, s)));
      }
    }
    throw new Error("nenhuma semente deu ao assento 0 a abertura de uma vaza");
  }

  it("envia actionId, cardId e expectedStateVersion — e NADA mais decide", () => {
    const { p, sp } = prontoParaJogar();
    expect(p.isHumanTurn()).toBe(true);
    const carta = p.legalCards()[0];
    p.playHuman(carta);

    expect(sp.enviadas).toHaveLength(1);
    expect(sp.enviadas[0].tipo).toBe("CLIENT_PLAY_CARD");
    const payload = sp.enviadas[0].payload as { actionId: string; cardId: string; expectedStateVersion?: number };
    expect(payload.cardId).toBe(cardId(carta));
    expect(payload.actionId).toBeTruthy();
    expect(payload.expectedStateVersion).toBe(1);
    // o payload NÃO carrega assento: quem sabe o assento é a sessão no servidor
    expect(Object.keys(payload)).not.toContain("seat");
  });

  it("otimismo LIMITADO: a carta continua na mão até o servidor confirmar", () => {
    const { p, sp } = prontoParaJogar();
    const carta = p.legalCards()[0];
    p.playHuman(carta);

    expect(p.cartaEmVoo()).toBe(cardId(carta));
    expect(p.aguardandoServidor()).toBe(true);
    // não saiu da mão por conta do cliente
    expect(p.view().yourHand.map(cardId)).toContain(cardId(carta));
    expect(p.currentTrick()).toHaveLength(0);
    expect(sp.enviadas).toHaveLength(1);
  });

  it("duplo toque durante a ida e volta não manda uma segunda carta", () => {
    const { p, sp } = prontoParaJogar();
    const [a, b] = p.legalCards();
    p.playHuman(a);
    p.playHuman(b ?? a);
    expect(sp.enviadas).toHaveLength(1);
  });

  it("a confirmação do servidor é o que tira a carta da mão e a põe na vaza", () => {
    const { m, p } = prontoParaJogar();
    const carta = p.legalCards()[0];
    p.playHuman(carta);

    // o servidor aplica pelo motor e devolve a visão nova
    playCard(m, 0, carta);
    p.aplicar(atualizacao(m, 0, 2, "CARD_PLAYED"));

    expect(p.cartaEmVoo()).toBeNull();
    expect(p.aguardandoServidor()).toBe(false);
    expect(p.view().yourHand.map(cardId)).not.toContain(cardId(carta));
    expect(p.currentTrick().some((pc) => cardId(pc.card) === cardId(carta))).toBe(true);
  });

  it("recusa devolve o leque ao estado correto — sem nada a desfazer", () => {
    const { p, sp } = prontoParaJogar();
    const antes = p.view().yourHand.map(cardId).sort();
    const carta = p.legalCards()[0];
    p.playHuman(carta);
    const { actionId } = sp.enviadas[0].payload as { actionId: string };

    p.recusar(actionId);

    expect(p.cartaEmVoo()).toBeNull();
    expect(p.aguardandoServidor()).toBe(false);
    // a mão é exatamente a de antes: a carta nunca chegou a sair
    expect(p.view().yourHand.map(cardId).sort()).toEqual(antes);
    expect(p.currentTrick()).toHaveLength(0);
    // e o leque volta a aceitar toque
    p.playHuman(carta);
    expect(sp.enviadas).toHaveLength(2);
  });

  it("fora da vez não envia nada", () => {
    const m = partidaNova(5);
    const sp = espiao();
    const naoEhAVez = SEATS.find((s) => s !== m.hand!.turn)!;
    const p = new PartidaRemota(atualizacao(m, naoEhAVez, 1, "MATCH_STARTED"), naoEhAVez, sp.enviar);
    expect(p.isHumanTurn()).toBe(false);
    p.playHuman(p.view().yourHand[0]);
    expect(sp.enviadas).toHaveLength(0);
  });
});

describe("SELECT_TRUMP", () => {
  /** Mãos 7–10 são positivas: alguém escolhe o trunfo antes da primeira jogada. */
  function maoPositiva() {
    const m = partidaNova(3);
    for (let i = 0; i < 6; i++) { terminarMao(m); startNextHand(m); }
    expect(m.hand!.awaitingTrumpFrom).not.toBeNull();
    return m;
  }

  it("quem escolhe envia a intenção; o painel espera a confirmação", () => {
    const m = maoPositiva();
    const escolhedor = m.hand!.awaitingTrumpFrom!;
    const sp = espiao();
    const p = new PartidaRemota(atualizacao(m, escolhedor, 10, "HAND_ADVANCED"), escolhedor, sp.enviar);

    expect(p.humanChoosesTrump()).toBe(true);
    p.chooseTrumpHuman("hearts");

    expect(sp.enviadas).toHaveLength(1);
    expect(sp.enviadas[0].tipo).toBe("CLIENT_SELECT_TRUMP");
    expect(sp.enviadas[0].payload).toMatchObject({ trump: "hearts", expectedStateVersion: 10 });
    expect(p.aguardandoServidor()).toBe(true);
    // o trunfo só existe quando o servidor disser que existe
    expect(p.trump()).toBeNull();

    selectTrump(m, escolhedor, "hearts");
    p.aplicar(atualizacao(m, escolhedor, 11, "TRUMP_SELECTED"));
    expect(p.trump()).toBe("hearts");
    expect(p.aguardandoServidor()).toBe(false);
  });

  it("quem NÃO escolhe não envia nada", () => {
    const m = maoPositiva();
    const escolhedor = m.hand!.awaitingTrumpFrom!;
    const outro = SEATS.find((s) => s !== escolhedor)!;
    const sp = espiao();
    const p = new PartidaRemota(atualizacao(m, outro, 10, "HAND_ADVANCED"), outro, sp.enviar);
    expect(p.humanChoosesTrump()).toBe(false);
    p.chooseTrumpHuman("spades");
    expect(sp.enviadas).toHaveLength(0);
  });
});

describe("READY_NEXT_HAND — o Continuar vira VOTO", () => {
  function maoTerminada() {
    const m = partidaNova(13);
    terminarMao(m);
    const sp = espiao();
    const p = new PartidaRemota(atualizacao(m, 0, 40, "CARD_PLAYED"), 0, sp.enviar);
    return { m, p, sp };
  }

  it("envia o voto uma única vez e passa a mostrar 'pedi a próxima mão'", () => {
    const { p, sp } = maoTerminada();
    expect(p.handOver()).toBe(true);
    expect(p.pediProximaMao()).toBe(false);

    p.advanceHand();
    expect(sp.enviadas).toHaveLength(1);
    expect(sp.enviadas[0].tipo).toBe("CLIENT_READY_NEXT_HAND");
    expect(p.pediProximaMao()).toBe(true);

    p.advanceHand(); // clicar de novo não manda outro voto
    expect(sp.enviadas).toHaveLength(1);
  });

  it("o voto NÃO vira a mão: quem vira é o servidor", () => {
    const { m, p } = maoTerminada();
    const mao = p.handNumber();
    p.advanceHand();
    expect(p.handNumber()).toBe(mao);
    expect(p.handOver()).toBe(true);

    startNextHand(m); // decisão do servidor, depois do consenso e do piso de leitura
    p.aplicar(atualizacao(m, 0, 41, "HAND_ADVANCED"));
    expect(p.handNumber()).toBe(mao + 1);
    expect(p.pediProximaMao()).toBe(false); // consenso zerado na virada
  });

  it("READY_STATE do servidor é a verdade sobre quem já confirmou", () => {
    const { p } = maoTerminada();
    p.refletirProntos([1, 2]);
    expect(p.pediProximaMao()).toBe(false);
    p.refletirProntos([0, 1, 2]);
    expect(p.pediProximaMao()).toBe(true);
  });
});

// ═══════════════════════════════ 4. AUTORIDADE ═══════════════════════════════

describe("o cliente não recalcula nada", () => {
  it("placar, turno e contrato vêm da visão — não de conta local", () => {
    const m = partidaNova(17);
    terminarMao(m);
    const p = new PartidaRemota(atualizacao(m, 1, 50), 1, espiao().enviar);

    // tudo é a MESMA função do motor aplicada à visão redigida — nenhum cálculo próprio
    expect(p.cumulative()).toEqual(m.cumulative);
    expect(p.liveScores()).toEqual(liveScores(m));
    expect(JSON.stringify(p.rankings())).toBe(JSON.stringify(rankings(m)));
    expect(JSON.stringify(p.stats())).toBe(JSON.stringify(matchStats(m)));
    // o somatório da mão fecha com o contrato — checksum do motor, não do cliente
    const soma = p.summary()!.breakdown.rows.reduce((t, r) => t + r.points, 0);
    expect(soma).toBe(m.hand!.contract.handTotal);
  });

  it("visão mais VELHA que a corrente é descartada", () => {
    const m = partidaNova(19);
    const p = new PartidaRemota(atualizacao(m, 0, 10), 0, espiao().enviar);
    const antes = p.view().yourHand.length;

    const velha = atualizacao(m, 0, 9);
    expect(p.aplicar(velha)).toBe(false);
    expect(p.stateVersion).toBe(10);
    expect(p.view().yourHand).toHaveLength(antes);
  });

  it("RECONNECTED é salto para o presente, não reprise do passado", () => {
    const m = partidaNova(29);
    const p = new PartidaRemota(atualizacao(m, 0, 1, "MATCH_STARTED"), 0, espiao().enviar);

    // enquanto o jogador estava fora, a partida andou (inclusive com o servidor jogando por ele)
    for (let i = 0; i < 9; i++) {
      const s = m.hand!.turn!;
      playCard(m, s, chooseNormalCard(buildBotView(m, s)));
    }
    expect(p.aplicar(atualizacao(m, 0, 10, "RECONNECTED"))).toBe(true);

    expect(p.stateVersion).toBe(10);
    expect(p.completedTrickCount()).toBe(m.hand!.completedTricks.length);
    expect(p.view().yourHand.map(cardId).sort()).toEqual(m.hand!.hands[0].map(cardId).sort());
    // o que o servidor jogou por ele CONTINUA valendo: nada é desfeito
    expect(p.view().yourHand.length).toBeLessThan(13);
  });

  it("fim de partida é declarado pelo servidor, não deduzido aqui", () => {
    const m = partidaNova(37);
    for (let i = 0; i < 10; i++) {
      terminarMao(m);
      if (!m.finished) startNextHand(m);
    }
    expect(m.finished).toBe(true);

    const p = new PartidaRemota(atualizacao(m, 0, 999, "CARD_PLAYED"), 0, espiao().enviar);
    expect(p.finished()).toBe(true);
    expect(p.phase()).toBe("matchEnd");
    expect(p.winners().length).toBeGreaterThan(0);
    // checksum do KING: a soma dos saldos finais é zero
    expect(p.cumulative().reduce((a, b) => a + b, 0)).toBe(0);
  });
});

// ═══════════════════════════════ 5. ISOLAMENTO ═══════════════════════════════

describe("local e online não contaminam estado entre si", () => {
  it("jogar no modo local não muda a partida remota, e vice-versa", () => {
    const local = new KingGame(JOGADORES, 77);
    const m = partidaNova(77);
    const sp = espiao();
    const remota = new PartidaRemota(atualizacao(m, 0, 1, "MATCH_STARTED"), 0, sp.enviar);

    const maoRemotaAntes = remota.view().yourHand.map(cardId).sort();

    // o modo local anda sozinho
    while (local.phase() === "play" && local.needsBotPlay()) local.stepBotPlay();
    if (local.isHumanTurn()) local.playHuman(local.legalCards()[0]);

    expect(remota.view().yourHand.map(cardId).sort()).toEqual(maoRemotaAntes);
    expect(remota.stateVersion).toBe(1);
    expect(sp.enviadas).toHaveLength(0);
  });

  it("a partida remota não tem passo de bot nenhum — quem assiste é o servidor", () => {
    const m = partidaNova(83);
    const remota = new PartidaRemota(atualizacao(m, 0, 1, "MATCH_STARTED"), 0, espiao().enviar);
    const comoObjeto = remota as unknown as Record<string, unknown>;
    for (const proibido of ["stepBotPlay", "stepBotTrump", "needsBotPlay", "needsBotTrump"]) {
      expect(comoObjeto[proibido], `PartidaRemota não pode expor ${proibido}`).toBeUndefined();
    }
  });
});
