// AS DUAS IMPLEMENTAÇÕES DA MESMA PAUSA, COMPARADAS EM TODA VAZA DE UMA PARTIDA INTEIRA.
//
// ══ POR QUE EXISTEM DUAS ══
//
// O cliente calcula a pausa de leitura porque é ele que para a mesa. O servidor passou a calcular
// a mesma pausa porque é ele que decide o prazo, e cobrar do jogador o tempo em que a mesa está
// parada é tirar dele tempo que ele não teve. São dois usos legítimos do mesmo fato.
//
// Duas implementações do mesmo fato é exatamente onde nasce a divergência silenciosa: alguém
// ajusta a regra de um lado, o outro continua com a antiga, e o sintoma aparece meses depois como
// "às vezes o relógio começa errado". Um teste de contrato entre os dois é o que impede isso.
//
// ══ POR QUE JOGAR PARTIDAS INTEIRAS EM VEZ DE ESCOLHER CASOS ══
//
// Escolher casos à mão prova o que eu lembrei de escolher. Aqui a comparação roda em TODAS as
// vazas de várias partidas completas, com todos os contratos que o KING tem — positivos,
// "não pegar vazas", Copas, Damas, Reis/Valetes, K de Copas e as duas últimas. As buchas
// aparecem porque a partida as produz, e não porque eu as encomendei.
import { describe, expect, it } from "vitest";
import {
  createMatch, startNextHand, selectTrump, playCard, legalCardsFor, chooseNormalTrump,
  buildBotView, type MatchState,
} from "@king/engine";
import { pausaDaLeitura } from "../../../server/src/match/pausaDaVaza.js";
import { anunciarVaza } from "./anuncio.js";
import { LeituraDaPartida } from "./leituraDaPartida.js";

const JOGADORES = ["Você", "Bia", "Léo", "Nara"];

/**
 * Joga uma partida inteira pelo motor e, a cada vaza fechada, compara as duas implementações.
 *
 * Devolve quantas comparações foram feitas e quantas delas caíram numa pausa de castigo — sem
 * essa segunda contagem o teste poderia passar tendo comparado só vazas comuns, que é o caso
 * fácil, e nunca ter tocado no caso que interessa.
 */
function conferirPartida(semente: number): { comparadas: number; castigos: number } {
  const m: MatchState = createMatch(JOGADORES, semente);
  let comparadas = 0;
  let castigos = 0;
  let vazasVistas = 0;

  for (let guarda = 0; guarda < 20_000; guarda++) {
    if (m.finished) break;
    if (m.hand === null || m.hand.handScores !== null) {
      if (m.hand?.handScores !== null && m.hand !== null) { startNextHand(m); vazasVistas = 0; continue; }
      startNextHand(m);
      vazasVistas = 0;
      continue;
    }
    const h = m.hand;

    if (h.awaitingTrumpFrom !== null) {
      const s = h.awaitingTrumpFrom;
      selectTrump(m, s, chooseNormalTrump(buildBotView(m, s).hand));
      continue;
    }
    if (h.turn === null) break;
    playCard(m, h.turn, legalCardsFor(m, h.turn)[0]);

    // Fechou uma vaza? É o momento exato em que os dois lados decidem a pausa.
    const agora = m.hand?.completedTricks.length ?? 0;
    if (agora > vazasVistas) {
      vazasVistas = agora;
      const doServidor = pausaDaLeitura(m);
      const doCliente = anunciarVaza(new LeituraDaPartida(m, 0), 0)?.pausa ?? 0;
      expect(
        doServidor,
        `semente ${semente}, vaza ${agora}: servidor ${doServidor}ms × cliente ${doCliente}ms`,
      ).toBe(doCliente);
      comparadas++;
      if (doServidor > 1_200) castigos++;
    }
  }
  return { comparadas, castigos };
}

describe("a pausa do servidor é a MESMA que o cliente aplica", () => {
  const SEMENTES = [7, 42, 101, 2024, 31337];

  it("em todas as vazas de várias partidas completas", () => {
    let total = 0;
    let castigos = 0;
    for (const s of SEMENTES) {
      const r = conferirPartida(s);
      total += r.comparadas;
      castigos += r.castigos;
    }
    // O instrumento precisa provar que MEDIU: uma partida de KING tem 130 vazas.
    expect(total, "nenhuma vaza foi comparada — o teste não testou nada").toBeGreaterThan(200);
    // E que tocou no caso difícil, não só nas vazas comuns.
    expect(castigos, "nenhuma pausa de castigo apareceu — só o caso fácil foi comparado")
      .toBeGreaterThan(0);
  });

  it("sem partida não há pausa — e isso não é erro", () => {
    expect(pausaDaLeitura(null)).toBe(0);
  });
});
