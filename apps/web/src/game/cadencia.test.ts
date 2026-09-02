// A CADÊNCIA DAS JOGADAS APRESENTADAS — uma carta de cada vez, e cada uma perceptível.
//
// ══ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR ══
//
// Numa partida física real (2 humanos + 2 bots, multiplayer, aparelho Android) as cartas de dois
// bots em assentos CONSECUTIVOS entravam na mesa praticamente juntas. Não havia como ler a vaza:
// duas cartas apareciam no mesmo instante e ninguém sabia quem tinha jogado o quê.
//
// A causa não estava no servidor. Ele sequencia certo — cada bot decide `cortesiaDoBot` depois do
// anterior. Estava na política de escoamento da fila do cliente: depois de uma pausa de
// apresentação (a leitura de uma vaza com bucha dura 2700ms, a do Rei de Copas 3400ms), a fila
// acumula os passos que o servidor produziu durante a pausa, e a política consumia DOIS por tique
// para recuperar o atraso. Dois passos consumidos no mesmo tique são duas cartas no mesmo quadro.
//
// Essa política entrou para corrigir um atraso de ~1s entre dois aparelhos, e entrou SEM NENHUM
// TESTE. Trocou um atraso imperceptível (ninguém está correndo contra o outro num jogo de turnos)
// por um defeito de leitura muito perceptível.
//
// ══ POR QUE A MEDIÇÃO É POR SIMULAÇÃO, E POR QUE ISSO É HONESTO ══
//
// O que se quer medir é o INTERVALO entre duas cartas aparecendo. Aqui o relógio dos dois lados é
// reproduzido com os valores REAIS — `botPasso` do cliente, `cortesiaDoBot` do servidor (lido do
// arquivo do servidor, não copiado à mão), e as pausas reais de leitura de vaza —, e o que roda é
// a POLÍTICA DE VERDADE, importada, não uma cópia dela.
//
// O que isto não prova: que a Mesa desenha a carta quando a atualização é aplicada. Isso é do
// Playwright, e é onde o cenário físico (multiplayer, 800×360) é exercitado.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ehCadenciada, LIMITE_DA_FILA, proximoPasso, quantosPorTique,
} from "./filaDeApresentacao.js";
import { TEMPOS } from "./timings.js";
import type { Causa } from "../net/protocolo.js";

/**
 * A cortesia do bot vem do SERVIDOR, lida do arquivo — não copiada.
 *
 * Um número copiado à mão vira mentira silenciosa no dia em que o outro lado muda: o teste
 * continuaria verde medindo um ritmo que não existe mais. É o mesmo cuidado que o contrato do
 * respiro da última mão já usa entre os dois lados.
 */
const CORTESIA_DO_BOT = (() => {
  const fonte = readFileSync(
    new URL("../../../server/src/match/tempos.ts", import.meta.url), "utf8",
  );
  const m = /cortesiaDoBot:\s*([0-9_]+)/.exec(fonte);
  if (!m) throw new Error("cortesiaDoBot não encontrado em apps/server/src/match/tempos.ts");
  return Number(m[1].replace(/_/g, ""));
})();

interface Chegada { t: number; causa: Causa }
interface Apresentada { causa: Causa; em: number }

/**
 * Roda o relógio do cliente sobre uma sequência de chegadas do servidor.
 *
 * Reproduz o laço do hook: um tique a cada `botPasso`; durante uma pausa de apresentação a fila
 * REPRESA (não é descartada); fora dela, escoa segundo a política.
 */
function simular(chegadas: Chegada[], pausas: { de: number; ate: number }[] = []): Apresentada[] {
  const fim = Math.max(...chegadas.map((c) => c.t), ...pausas.map((p) => p.ate)) + 6_000;
  const pendentes = [...chegadas].sort((a, b) => a.t - b.t);
  let fila: Chegada[] = [];
  const vistas: Apresentada[] = [];

  for (let t = 0; t <= fim; t += TEMPOS.botPasso) {
    while (pendentes.length > 0 && pendentes[0].t <= t) fila.push(pendentes.shift()!);
    if (pausas.some((p) => t >= p.de && t < p.ate)) continue;

    const quantos = quantosPorTique(fila, (c) => ehCadenciada(c.causa));
    for (let i = 0; i < quantos; i++) {
      const passo = proximoPasso(fila, LIMITE_DA_FILA);
      if (!passo.proxima) break;
      fila = passo.resto;
      vistas.push({ causa: passo.proxima.causa, em: t });
    }
  }
  return vistas;
}

/** O menor intervalo entre duas apresentações consecutivas de carta. */
function menorIntervalo(vistas: Apresentada[]): number {
  const cartas = vistas.filter((v) => v.causa === "CARD_PLAYED" || v.causa === "TRUMP_SELECTED");
  let menor = Infinity;
  for (let i = 1; i < cartas.length; i++) menor = Math.min(menor, cartas[i].em - cartas[i - 1].em);
  return menor;
}

/** Duas cartas apresentadas no MESMO tique — o defeito, em uma função. */
const houveCartasGrudadas = (vistas: Apresentada[]) => menorIntervalo(vistas) === 0;

/** Jogadas de bots consecutivos, como o servidor as produz: uma a cada `cortesiaDoBot`. */
function bots(quantidade: number, desde: number): Chegada[] {
  return Array.from({ length: quantidade }, (_, i) => ({
    t: desde + CORTESIA_DO_BOT * (i + 1), causa: "CARD_PLAYED" as Causa,
  }));
}

describe("o servidor sequencia os bots — a cadência é responsabilidade do cliente", () => {
  it("a cortesia do bot é maior que o passo da apresentação, então a fila DRENA sozinha", () => {
    // É o fato que torna desnecessário consumir dois por tique: o cliente apresenta mais rápido
    // (520ms) do que o servidor produz (900ms), então qualquer atraso se fecha sozinho.
    expect(CORTESIA_DO_BOT).toBeGreaterThan(TEMPOS.botPasso);
  });
});

/**
 * O CENÁRIO EXATO DO RELATO FÍSICO.
 *
 * Uma vaza fecha com bucha — a mesa PARA 2700ms para todos verem quem se deu mal, que é
 * comportamento aprovado e não se mexe. Durante essa pausa o servidor não para: os dois bots da
 * vaza seguinte jogam, e as duas atualizações esperam na fila. Quando a pausa acaba é que o
 * defeito acontece.
 */
describe("BOT → BOT em assentos consecutivos", () => {
  const CENARIOS: [string, number][] = [
    ["vaza comum", TEMPOS.leituraDaVaza],
    ["vaza com bucha", TEMPOS.leituraDaVazaCastigo],
    ["Rei de Copas", TEMPOS.leituraDaVazaKing],
    ["fim de mão", TEMPOS.fimDeMao],
  ];

  for (const [nome, pausa] of CENARIOS) {
    it(`depois da pausa de "${nome}", as cartas dos dois bots NÃO entram juntas`, () => {
      const vistas = simular(bots(2, 0), [{ de: 0, ate: pausa }]);
      expect(
        houveCartasGrudadas(vistas),
        `duas cartas apresentadas no mesmo instante: ${JSON.stringify(vistas)}`,
      ).toBe(false);
    });
  }

  it("TRÊS bots consecutivos continuam entrando um de cada vez", () => {
    const vistas = simular(bots(3, 0), [{ de: 0, ate: TEMPOS.leituraDaVazaCastigo }]);
    expect(houveCartasGrudadas(vistas)).toBe(false);
  });

  /**
   * A INVARIANTE DO PEDIDO, ESCRITA COMO NÚMERO.
   *
   * Não basta "não estarem no mesmo quadro": cada carta precisa ser PERCEPTÍVEL antes da próxima.
   * O piso é `botPasso` — o mesmo ritmo do modo local, que é o KING já aprovado. Não é um valor
   * novo escolhido para este teste passar.
   */
  it("o intervalo mínimo entre cartas é a cadência canônica, em qualquer pausa", () => {
    for (const [nome, pausa] of CENARIOS) {
      const vistas = simular(bots(3, 0), [{ de: 0, ate: pausa }]);
      expect(menorIntervalo(vistas), `[${nome}] intervalo abaixo da cadência`)
        .toBeGreaterThanOrEqual(TEMPOS.botPasso);
    }
  });
});

describe("as transições que já estavam corretas continuam corretas", () => {
  it("sem pausa nenhuma, humano → bot → bot mantém a cadência", () => {
    const vistas = simular([{ t: 0, causa: "CARD_PLAYED" }, ...bots(2, 0)]);
    expect(menorIntervalo(vistas)).toBeGreaterThanOrEqual(TEMPOS.botPasso);
  });

  it("uma vaza inteira — quatro cartas — entra em quatro momentos distintos", () => {
    const vistas = simular([{ t: 0, causa: "CARD_PLAYED" }, ...bots(3, 0)]);
    const cartas = vistas.filter((v) => v.causa === "CARD_PLAYED");
    expect(cartas).toHaveLength(4);
    expect(new Set(cartas.map((c) => c.em)).size).toBe(4);
  });

  /**
   * A RECUPERAÇÃO NÃO PODE MORRER JUNTO COM O DEFEITO.
   *
   * Consumir dois por tique existia para o aparelho mais lento não ficar para trás. A correção
   * não pode simplesmente devolver aquele atraso — e não devolve, por um motivo aritmético: o
   * cliente apresenta a 520ms e o servidor produz a 900ms, então a fila encurta 380ms por passo
   * sozinha. Este teste trava esse fato.
   */
  it("depois da pausa mais longa, a fila se esvazia sem precisar de lote", () => {
    const vistas = simular(bots(3, 0), [{ de: 0, ate: TEMPOS.leituraDaVazaKing }]);
    expect(vistas).toHaveLength(3);
    const ultima = vistas[vistas.length - 1].em;
    // Tudo apresentado dentro de um passo depois de a última chegar — sem atraso acumulado.
    expect(ultima).toBeLessThanOrEqual(TEMPOS.leituraDaVazaKing + TEMPOS.botPasso * 3);
  });
});

/**
 * O TETO DA FILA É DERIVADO, NÃO ESCOLHIDO.
 *
 * Era 2 — menos do que uma partida normal produz. Numa pausa de leitura do Rei de Copas (3400ms)
 * o servidor joga três vezes, a fila estourava o teto e COLAPSAVA: duas cartas nunca eram
 * apresentadas, e as três apareciam juntas. O colapso existe para a avalanche de quem volta do
 * segundo plano, e estava disparando no meio do jogo.
 *
 * O piso é recalculado aqui a partir dos DOIS lados. Se alguém aumentar uma pausa aprovada ou
 * baixar a cortesia do bot, este teste reprova antes de a carta sumir na mão de alguém.
 */
describe("o teto da fila comporta o que o jogo normal produz", () => {
  const maiorPausa = Math.max(
    TEMPOS.leituraDaVaza, TEMPOS.leituraDaVazaCastigo, TEMPOS.leituraDaVazaKing, TEMPOS.fimDeMao,
  );
  const piso = Math.ceil(maiorPausa / CORTESIA_DO_BOT);

  it("o teto tem FOLGA sobre o pior caso aprovado — não apenas cabe", () => {
    expect(
      LIMITE_DA_FILA,
      `teto ${LIMITE_DA_FILA} não tem folga sobre o piso ${piso} ` +
      `(maior pausa ${maiorPausa}ms ÷ cortesia ${CORTESIA_DO_BOT}ms)`,
    ).toBeGreaterThan(piso);
  });

  it("nenhuma pausa aprovada faz a fila colapsar", () => {
    for (const pausa of [TEMPOS.leituraDaVaza, TEMPOS.leituraDaVazaCastigo,
      TEMPOS.leituraDaVazaKing, TEMPOS.fimDeMao]) {
      const vistas = simular(bots(3, 0), [{ de: 0, ate: pausa }]);
      expect(vistas, `pausa de ${pausa}ms descartou carta`).toHaveLength(3);
    }
  });

  it("a avalanche de quem volta do segundo plano CONTINUA colapsando", () => {
    const muitas = Array.from({ length: 30 }, (_, i) => ({
      t: i * 100, causa: "CARD_PLAYED" as Causa,
    }));
    const vistas = simular(muitas, [{ de: 0, ate: 4_000 }]);
    expect(vistas.length).toBeLessThan(muitas.length);
  });
});

/**
 * O QUE A APRESENTAÇÃO CUSTA DO PRAZO DO PRÓXIMO HUMANO — medido, e travado.
 *
 * ══ O FATO DESCONFORTÁVEL, DITO POR INTEIRO ══
 *
 * O prazo é do SERVIDOR e começa no instante em que ele libera o turno. O cliente ainda está
 * apresentando o que veio antes, então existe uma DÍVIDA: o tempo entre o servidor abrir o turno
 * e a última carta anterior aparecer na tela.
 *
 * Essa dívida NÃO nasceu com esta correção. Ela é anterior e aprovada: o servidor não dá respiro
 * nenhum quando uma vaza fecha (o único respiro que existe é o da abertura da última mão), então
 * a própria pausa de leitura — 1150ms, 2700ms com bucha, 3400ms no Rei de Copas — já corria
 * contra os 25s do próximo jogador, em toda vaza, desde sempre.
 *
 * O que esta correção muda é o tamanho dela nos dois cenários de pausa longa, e a comparação
 * honesta é esta: antes a dívida era menor **porque duas das três cartas eram descartadas**. Não
 * se estava pagando menos; estava-se entregando menos.
 *
 * O teto abaixo é o pior caso medido (Rei de Copas, três bots): 1980ms de 25000ms — 7,9%. Fica
 * travado para não crescer sem alguém decidir que pode.
 */
describe("a dívida de apresentação contra o prazo do humano", () => {
  /** Prazo autoritativo de uma jogada, lido do servidor — não copiado. */
  const TURNO = (() => {
    const fonte = readFileSync(
      new URL("../../../server/src/match/tempos.ts", import.meta.url), "utf8",
    );
    const m = /turno:\s*([0-9_]+)/.exec(fonte);
    if (!m) throw new Error("turno não encontrado em apps/server/src/match/tempos.ts");
    return Number(m[1].replace(/_/g, ""));
  })();

  /** Quanto tempo depois de o servidor abrir o turno a última carta anterior ainda aparece. */
  function divida(pausa: number, quantosBots: number): number {
    const abreEm = CORTESIA_DO_BOT * quantosBots; // servidor libera o humano após o último bot
    const vistas = simular(bots(quantosBots, 0), [{ de: 0, ate: pausa }]);
    expect(vistas, "carta descartada — a dívida não faria sentido").toHaveLength(quantosBots);
    return Math.max(0, vistas[vistas.length - 1].em - abreEm);
  }

  it("no pior caso aprovado, o humano recebe pelo menos 92% do prazo", () => {
    const pior = Math.max(
      divida(TEMPOS.leituraDaVaza, 3), divida(TEMPOS.leituraDaVazaCastigo, 3),
      divida(TEMPOS.leituraDaVazaKing, 3), divida(TEMPOS.fimDeMao, 3),
    );
    expect(pior, `dívida de ${pior}ms sobre um prazo de ${TURNO}ms`)
      .toBeLessThanOrEqual(TURNO * 0.08);
  });

  it("a dívida nunca passa de dois passos de apresentação por carta represada", () => {
    for (const pausa of [TEMPOS.leituraDaVaza, TEMPOS.leituraDaVazaCastigo,
      TEMPOS.leituraDaVazaKing, TEMPOS.fimDeMao]) {
      expect(divida(pausa, 3)).toBeLessThanOrEqual(TEMPOS.botPasso * 2 * 3);
    }
  });
});
