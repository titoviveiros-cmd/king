/**
 * AS SEMENTES DOS E2E DO MINI-TORNEIO — achadas por busca offline e conferidas aqui a cada execução.
 *
 * O E2E da vitória (`tests/minitorneio.spec.ts`) precisa de um torneio em que o assento humano
 * CHEGA AO TÍTULO, sem resultado inventado, sem ranking manipulado e sem atalho no motor. A regra é:
 *
 *   • o assento humano joga o que o Bot Normal jogaria no lugar dele (`pilotoDeTeste.ts`);
 *   • todo o resto é o torneio de verdade — sorteio, mesas de bots, desempate — pela semente;
 *   • `?mao=10` (parâmetro de QA que já existia) faz a partida do humano começar na mão 10, como o
 *     E2E faz para caber no tempo; as mesas de bots jogam as 10 mãos sempre.
 *
 * Aqui a partida do humano é jogada pela MESMA classe da tela (`PartidaDoTorneio`, um `KingGame`),
 * com o MESMO `sugestaoDoBotNormal` que o gancho do navegador usa, e os bots pelos MESMOS
 * `stepBotTrump`/`stepBotPlay` que a Mesa chama. A única coisa que falta é a animação, que não
 * decide nada. Se o motor ou o Bot Normal mudarem e uma semente deixar de servir, ESTE teste
 * quebra primeiro, com a mensagem de como achar outra:
 *
 *   BUSCAR_SEMENTES=1 npx vitest run src/torneio/vitoriaDeterministica.test.ts
 *
 * (em `apps/web`). A busca percorre as sementes 1, 2, 3… e imprime a primeira de cada caso.
 */
import { describe, it, expect } from "vitest";
import { PartidaDoTorneio } from "./partidaDoTorneio.js";
import { sugestaoDoBotNormal } from "./pilotoDeTeste.js";
import { jogarMesaDeBots } from "./simulacao.js";
import {
  avancarFase, caminhoDoHumano, campeao, criarTorneio, faseDaEliminacao, nomesDaMesa, registrarResultado, situacao,
  ID_DO_HUMANO, type MesaDoTorneio, type Torneio,
} from "./orquestrador.js";
import { FORMATOS, type FormatoId } from "./formatos.js";
import type { FatosDaMesa } from "./desempate.js";
import { SEMENTES_DO_E2E, AVATAR_DO_E2E, MAO_DO_E2E } from "../../tests/fixtures/torneioDeterministico.js";

/** A partida do humano com o piloto: a classe da tela, sem a tela. */
function jogarMinhaMesaComPiloto(t: Torneio, mesa: MesaDoTorneio): FatosDaMesa {
  const jogo = new PartidaDoTorneio(t, mesa);
  for (let passos = 0; !jogo.finished(); passos++) {
    if (passos > 2000) throw new Error(`a partida da mesa ${mesa.id} não terminou`);
    const fase = jogo.phase();
    if (fase === "handEnd") { jogo.advanceHand(); continue; }
    if (jogo.needsBotTrump()) { jogo.stepBotTrump(); continue; }
    if (jogo.needsBotPlay()) { jogo.stepBotPlay(); continue; }
    const s = sugestaoDoBotNormal(jogo);
    if (!s) throw new Error(`fase ${fase} sem vez de ninguém na mesa ${mesa.id}`);
    if (s.tipo === "trunfo") jogo.chooseTrumpHuman(s.trunfo);
    else jogo.playHuman(s.carta);
  }
  return jogo.fatos()!;
}

/** O torneio inteiro, do jeito que o app conduz: bots da fase → a mesa do humano → a fase seguinte. */
function torneioComPiloto(formato: FormatoId, semente: number, maoInicial = MAO_DO_E2E): Torneio {
  let t = criarTorneio(formato, semente, AVATAR_DO_E2E, { qa: true, maoInicial });
  for (let passos = 0; passos < 100; passos++) {
    const s = situacao(t);
    if (s.tipo === "encerrado") return t;
    if (s.tipo === "simular") {
      for (const m of s.mesas) t = registrarResultado(t, m.id, jogarMesaDeBots(nomesDaMesa(t, m), m.semente));
    } else if (s.tipo === "jogar") {
      t = registrarResultado(t, s.mesa.id, jogarMinhaMesaComPiloto(t, s.mesa));
    } else {
      t = avancarFase(t);
    }
  }
  throw new Error("o torneio não terminou");
}

type Caso = "vitoria" | "eliminacaoNaPrimeira";
function serve(t: Torneio, caso: Caso): boolean {
  return caso === "vitoria" ? campeao(t) === ID_DO_HUMANO : faseDaEliminacao(t) === 0;
}

describe("as sementes dos E2E do mini-torneio (assento humano no piloto do Bot Normal, mão 10)", () => {
  it.runIf(process.env.BUSCAR_SEMENTES)("BUSCA (manual): a primeira semente de cada caso", () => {
    const casos: Array<[FormatoId, Caso]> = [["mini16", "vitoria"], ["copa32", "vitoria"], ["mini16", "eliminacaoNaPrimeira"]];
    for (const [formato, caso] of casos) {
      for (let s = 1; s < 5000; s++) {
        if (serve(torneioComPiloto(formato, s), caso)) { console.log(`[busca] ${formato} ${caso}: semente ${s}`); break; }
      }
    }
  }, 600_000);

  for (const formato of ["mini16", "copa32"] as const) {
    it(`${FORMATOS[formato].nome}: a semente ${SEMENTES_DO_E2E[formato].vitoria} leva o humano ao título`, () => {
      const t = torneioComPiloto(formato, SEMENTES_DO_E2E[formato].vitoria);
      expect(campeao(t), "semente da vitória não serve mais — rode a busca (ver cabeçalho)").toBe(ID_DO_HUMANO);
      // o caminho: uma mesa por fase, sempre classificado, e a final vencida
      const caminho = caminhoDoHumano(t);
      expect(caminho.map((m) => m.fase)).toEqual(FORMATOS[formato].fases.map((_, i) => i));
      for (const m of caminho) expect(m.resultado!.classificacao.ordem.indexOf(ID_DO_HUMANO)).toBeLessThan(2);
      expect(caminho[caminho.length - 1].resultado!.classificacao.ordem[0]).toBe(ID_DO_HUMANO);
      // repetível: a mesma semente dá o mesmo torneio, mesa por mesa
      expect(torneioComPiloto(formato, SEMENTES_DO_E2E[formato].vitoria)).toEqual(t);
    });
  }

  it(`Mini-torneio: a semente ${SEMENTES_DO_E2E.mini16.eliminacao} elimina o humano nas Mesas iniciais`, () => {
    const t = torneioComPiloto("mini16", SEMENTES_DO_E2E.mini16.eliminacao);
    expect(faseDaEliminacao(t), "semente da eliminação não serve mais — rode a busca (ver cabeçalho)").toBe(0);
  });

  it("o piloto joga só o que o Bot Normal jogaria: a mesa do humano com piloto = a mesma mesa toda de bots", () => {
    // Partida inteira (mão 1 a 10), sem QA: o humano no piloto e os três bots dão EXATAMENTE os
    // fatos da simulação sem tela com o Bot Normal nos quatro assentos.
    const t = criarTorneio("mini16", 77, AVATAR_DO_E2E);
    const mesa = t.mesas.find((m) => m.assentos[0] === ID_DO_HUMANO)!;
    expect(jogarMinhaMesaComPiloto(t, mesa)).toEqual(jogarMesaDeBots(nomesDaMesa(t, mesa), mesa.semente));
  });
});
