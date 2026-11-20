// O CONTRATO TEMPORAL DOS DOIS MOMENTOS LONGOS DA PARTIDA — o Rei capturado e a Última Mão.
//
// ══ O QUE MUDOU, E O QUE NÃO PODIA MUDAR ══
//
// As duas cenas ficaram mais longas: a do Rei foi de 2s para 5s (e a pausa do King de 3,4s para
// 6,5s), o anúncio da Última Mão de ~3,7s para 6s. O que NÃO podia mudar é o que torna isso seguro:
//
//   • nenhum bot age por trás de uma cena, no solo ou online;
//   • nenhum jogador paga com o próprio prazo o tempo em que estava vendo uma cena;
//   • cliente e servidor continuam com o MESMO número para cada pausa;
//   • nada da cena dura mais do que a pausa que a abriga, e nada fica rodando depois dela.
//
// Cada uma dessas frases tem um teste aqui, e os números são lidos das fontes — nunca copiados.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createMatch, startNextHand, selectTrump, playCard, legalCardsFor, chooseNormalTrump,
  buildBotView, isKingOfHearts, type MatchState,
} from "@king/engine";
import { pausaDaLeitura } from "../../../server/src/match/pausaDaVaza.js";
import { TEMPOS_PADRAO } from "../../../server/src/match/tempos.js";
import { placarLiberadoEm, ehPlacarDoRei as ehPlacarDoReiNoServidor } from "../../../server/src/match/pisoDoPlacar.js";
import { anunciarVaza } from "./anuncio.js";
import { ehPlacarDoRei, leituraDoPlacarDoRei, podeAvancarDoPlacar } from "./placarDoRei.js";
import { LeituraDaPartida } from "./leituraDaPartida.js";
import { TEMPOS } from "./timings.js";
import { permanenciaRestante } from "../ui/ReiCapturado.js";

const ler = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const CSS = ler("../ui/theme.css");
const FONTE_REI = ler("../ui/ReiCapturado.tsx");
const FONTE_UM = ler("../ui/UltimaMao.tsx");

/** Uma constante numérica declarada como `const NOME = 123;` num arquivo-fonte. */
function constante(fonte: string, nome: string): number {
  const m = new RegExp(`const ${nome} = (\\d+);`).exec(fonte);
  if (!m) throw new Error(`${nome} não encontrado`);
  return Number(m[1]);
}

/** O trecho do theme.css entre dois cabeçalhos de seção. */
function bloco(de: string, ate: string): string {
  const i = CSS.indexOf(de);
  const f = CSS.indexOf(ate, i);
  if (i < 0 || f < 0) throw new Error(`bloco não encontrado: ${de}`);
  return CSS.slice(i, f);
}
const BLOCO_REI = bloco("/* ══════════════════ O REI FOI CAPTURADO", "/* ══════════════════ A ÚLTIMA VAZA");
const BLOCO_UM = bloco("/* ══════════════════ ÚLTIMA MÃO DO JOGO", "/* ══════════════════ O REI FOI CAPTURADO");

/**
 * QUANDO CADA ANIMAÇÃO DE UM BLOCO TERMINA, em segundos: atraso + duração × repetições.
 *
 * Lê o atalho `animation:` do jeito que este projeto o escreve (nome, duração, curva, atraso,
 * repetições, preenchimento). `var(--atraso)` é das faíscas, que têm o próprio cálculo abaixo.
 * `infinite` vira `Infinity` — e reprova qualquer teto.
 */
function finsDasAnimacoes(css: string): { decl: string; fim: number }[] {
  const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: { decl: string; fim: number }[] = [];
  for (const m of semComentarios.matchAll(/animation:([^;}]+)[;}]/g)) {
    for (const parte of m[1].split(/,(?![^(]*\))/)) {
      const tokens = parte.trim().split(/\s+/);
      if (tokens[0] === "none") continue;
      const tempos = tokens.filter((t) => /^\d*\.?\d+s$/.test(t)).map((t) => parseFloat(t));
      const repeticoes = tokens.includes("infinite")
        ? Infinity
        : Number(tokens.find((t) => /^\d+$/.test(t)) ?? 1);
      const duracao = tempos[0] ?? 0;
      const atraso = tempos[1] ?? 0;
      out.push({ decl: parte.trim(), fim: atraso + duracao * repeticoes });
    }
  }
  return out;
}

// ═════════════════════════════════ O REI FOI CAPTURADO ═════════════════════════════════

describe("O REI FOI CAPTURADO — a cena e a pausa que a abriga", () => {
  const SAIDA = constante(FONTE_REI, "SAIDA_MS");

  it("a cena fica VISÍVEL ao menos 4,5s — e não passa de 5,5s", () => {
    expect(TEMPOS.cenaDoRei).toBeGreaterThanOrEqual(4500);
    expect(TEMPOS.cenaDoRei).toBeLessThanOrEqual(5500);
    // a permanência (antes de começar a sair) é a cena menos a saída, e a saída é curta
    expect(TEMPOS.cenaDoRei - SAIDA).toBeGreaterThanOrEqual(4500);
    expect(SAIDA).toBeLessThanOrEqual(500);
  });

  it("o destaque da mesa continua com 1,35s, DEPOIS da cena", () => {
    expect(TEMPOS.kCopasCaptura).toBe(1350);
  });

  it("cena + destaque cabem na pausa do King, com folga — não apenas cabem", () => {
    const folga = TEMPOS.leituraDaVazaKing - (TEMPOS.cenaDoRei + TEMPOS.kCopasCaptura);
    expect(folga, `folga de ${folga}ms`).toBeGreaterThanOrEqual(100);
    // e a pausa não virou espera: no máximo ~7s parada
    expect(TEMPOS.leituraDaVazaKing).toBeLessThanOrEqual(7000);
  });

  it("o servidor conhece a MESMA pausa do King que o cliente aplica", () => {
    expect(TEMPOS_PADRAO.leituraDaVazaKing).toBe(TEMPOS.leituraDaVazaKing);
  });

  it("a pausa do King nunca vaza para a mão seguinte: o piso do Placar é maior que ela", () => {
    // Depois do K♥ vem o Placar, e ninguém avança antes de `pisoDoPlacar`. Se a pausa passasse do
    // piso, a mão 6 poderia abrir com a mesa ainda parada na cena — e a primeira jogada dela
    // começaria a correr contra quem ainda estava vendo o Rei.
    expect(TEMPOS_PADRAO.pisoDoPlacar).toBeGreaterThan(TEMPOS.leituraDaVazaKing);
    // e o piso que vale na mão do Rei é ainda maior (ver "O PLACAR DA MÃO DO REI" abaixo)
    expect(TEMPOS_PADRAO.pisoDoPlacarDoRei).toBeGreaterThan(TEMPOS.leituraDaVazaKing);
  });

  it("nenhuma animação da cena dura mais que a cena, e nenhuma é infinita", () => {
    const fins = finsDasAnimacoes(BLOCO_REI);
    // o instrumento precisa provar que mediu: a cena tem mais de dez animações declaradas
    expect(fins.length).toBeGreaterThan(10);
    for (const { decl, fim } of fins) {
      expect(fim, `"${decl}" termina em ${fim}s, depois da cena`).toBeLessThanOrEqual(TEMPOS.cenaDoRei / 1000);
    }
    // As faíscas têm o atraso no JSX: a última da última onda ainda some dentro da cena.
    const ondas = /const ONDAS_DE_FAISCAS = \[([^\]]+)\]/.exec(FONTE_REI)![1].split(",").map(Number);
    const porOnda = constante(FONTE_REI, "FAISCAS_POR_ONDA");
    const duracao = parseFloat(/\.rc-faiscas i\{[^}]*animation:rcFaisca (\d*\.?\d+)s/.exec(BLOCO_REI)![1]);
    const ultima = Math.max(...ondas) + (porOnda - 1) * 0.03 + duracao;
    expect(ultima).toBeLessThanOrEqual(TEMPOS.cenaDoRei / 1000);
  });

  it("movimento reduzido: as peças novas (luz, −160 que bate) também calam — pela classe e pela media query", () => {
    expect(BLOCO_REI).toMatch(/\.rc\.calmo \.rc-luz\{display:none;\}/);
    expect(BLOCO_REI).toMatch(/\.rc\.calmo \.rc-pontos\{animation:none;\}/);
    const media = BLOCO_REI.slice(BLOCO_REI.indexOf("@media (prefers-reduced-motion:reduce){"));
    expect(media).toMatch(/\.rc-luz\{display:none;\}/);
    expect(media).toMatch(/\.rc-pontos\{animation:none;\}/);
    // e no JSX a luz e as faíscas nem são desenhadas quando o movimento é reduzido
    expect(FONTE_REI).toMatch(/\{!reduzido && <span className="rc-luz" aria-hidden \/>\}/);
    expect(FONTE_REI).toMatch(/\{!reduzido && \(\s*<div className="rc-faiscas"/);
  });

  it("a luz e as faíscas não capturam toque — quem recebe o dedo é a camada da cena", () => {
    expect(BLOCO_REI).toMatch(/\.rc-luz\{[^}]*pointer-events:none;/);
    expect(BLOCO_REI).toMatch(/\.rc-faiscas\{[^}]*pointer-events:none;/);
  });

  it("o nome de quem pegou e o −160 continuam na cena", () => {
    expect(FONTE_REI).toMatch(/\{voce \? "Você pegou o K♥" : `\$\{quem\} pegou o K♥`\}/);
    expect(FONTE_REI).toMatch(/<span className="rc-pontos">\{pontos\}<\/span>/);
    expect(FONTE_REI).toMatch(/O REI FOI CAPTURADO!/);
  });
});

/**
 * NENHUM TEXTO SOLTO FORA DE COMENTÁRIO NO theme.css.
 *
 * Este teste nasceu de um defeito real desta rodada: um `*\/` a mais fechou o comentário do
 * cabeçalho da cena no meio do parágrafo. O resto da prosa virou "CSS" inválido, o navegador o
 * descartou junto com a regra `.rc{…}` seguinte, e a cena passou a ser desenhada SEM
 * `position:fixed` — 218px de altura, por baixo da vaza, com o toque caindo nas cartas. Os testes
 * por regex continuavam verdes, porque o texto da regra estava lá. Só o Playwright viu.
 */
describe("o theme.css não tem prosa fora de comentário", () => {
  it("nenhuma linha fora de comentário tem acento ou travessão (marca de texto em português)", () => {
    const semComentarios = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const soltas = semComentarios.split("\n")
      .map((l, i) => `${i + 1}: ${l.trim()}`)
      .filter((l) => /[ãõçéêáâíóôú—]/i.test(l));
    expect(soltas).toEqual([]);
  });
});

describe("a cena retoma de onde parou se a Mesa remontar — e nunca passa da pausa", () => {
  const PERMANENCIA = TEMPOS.cenaDoRei - constante(FONTE_REI, "SAIDA_MS");

  it("começando agora, resta a permanência inteira", () => {
    expect(permanenciaRestante(1000, 1000)).toBe(PERMANENCIA);
  });

  it("remontada no meio, resta só o que faltava", () => {
    expect(permanenciaRestante(1000, 1000 + 3000)).toBe(PERMANENCIA - 3000);
  });

  it("remontada depois do fim, fecha na hora — não recomeça", () => {
    expect(permanenciaRestante(1000, 1000 + 60_000)).toBe(0);
  });

  it("relógio que andou para trás não estica a cena além da permanência", () => {
    expect(permanenciaRestante(5000, 1000)).toBe(PERMANENCIA);
  });

  it("a marca de início é por captura (nonce), fora do React, como a de 'já vista'", () => {
    expect(FONTE_REI).toMatch(/const inicios = new Map<number, number>\(\);/);
    expect(FONTE_REI).toMatch(/if \(!inicios\.has\(nonce\)\) inicios\.set\(nonce, Date\.now\(\)\);/);
  });
});

/**
 * A PAUSA DO KING É TERMINAL — o fato que permite a ela ser longa.
 *
 * Se depois da pausa do King viesse a vez de alguém, 6,5s de cena sairiam do prazo dessa pessoa
 * (online) ou seriam 6,5s de bots represados (fila). Não vem: capturar o K♥ encerra a mão 5. Aqui
 * isso é PROVADO, não suposto — partidas inteiras pelo motor, e toda vez que qualquer um dos dois
 * lados decide a pausa do King, a mão tem de estar encerrada e sem decisão de jogada pendente.
 */
describe("a pausa do King só acontece na vaza que ENCERRA a mão", () => {
  const JOGADORES = ["Você", "Bia", "Léo", "Nara"];

  function verificarPartida(semente: number): number {
    const m: MatchState = createMatch(JOGADORES, semente);
    let vistas = 0;
    let pausasDoKing = 0;
    for (let guarda = 0; guarda < 20_000 && !m.finished; guarda++) {
      if (m.hand === null || m.hand.handScores !== null) { startNextHand(m); vistas = 0; continue; }
      const h = m.hand;
      if (h.awaitingTrumpFrom !== null) {
        selectTrump(m, h.awaitingTrumpFrom, chooseNormalTrump(buildBotView(m, h.awaitingTrumpFrom).hand));
        continue;
      }
      if (h.turn === null) break;
      // varia a jogada pela semente: o K♥ precisa cair em vazas diferentes, não sempre na mesma
      const legais = legalCardsFor(m, h.turn);
      playCard(m, h.turn, legais[(semente + guarda) % legais.length]);

      const fechadas = m.hand?.completedTricks.length ?? 0;
      if (fechadas <= vistas) continue;
      vistas = fechadas;
      const doServidor = pausaDaLeitura(m);
      const doCliente = anunciarVaza(new LeituraDaPartida(m, 0), 0)?.pausa ?? 0;
      const ultima = m.hand!.completedTricks[fechadas - 1];
      const capturouK = m.hand!.contract.kind === "no-king" && ultima.cards.some((c) => isKingOfHearts(c.card));

      // os dois lados só chegam ao valor do King quando o K♥ foi capturado — e vice-versa
      expect(doServidor === TEMPOS.leituraDaVazaKing, `semente ${semente}, vaza ${fechadas}`).toBe(capturouK);
      expect(doCliente === TEMPOS.leituraDaVazaKing, `semente ${semente}, vaza ${fechadas}`).toBe(capturouK);
      if (!capturouK) continue;
      pausasDoKing++;
      // A MÃO ACABOU: há placar, ninguém tem a vez, ninguém escolhe trunfo.
      expect(m.hand!.handScores, `semente ${semente}: o K♥ saiu e a mão continuou`).not.toBeNull();
      expect(m.hand!.turn).toBeNull();
      expect(m.hand!.awaitingTrumpFrom).toBeNull();
    }
    expect(m.finished, `semente ${semente}: a partida não terminou`).toBe(true);
    return pausasDoKing;
  }

  it("em partidas inteiras: toda pausa do King fecha a mão 5, exatamente uma por partida", () => {
    for (const s of [1, 7, 42, 101, 2024, 31337, 65_537, 99_991]) {
      expect(verificarPartida(s), `semente ${s}`).toBe(1);
    }
  });
});

// ═════════════════════════════════ O PLACAR DA MÃO DO REI ═════════════════════════════════

/**
 * O PLACAR DA MÃO DO REI FICA PARA SER LIDO.
 *
 * O piso geral (8s) conta do fim da mão, e na mão 5 a mesa passa 6,5s na cena: sobrava ~1,5s de
 * Placar. A meta é 4,6s REAIS de Placar depois da cena — no solo (cliente) e online (servidor),
 * com o MESMO número dos dois lados. As outras nove mãos não mudam.
 */
describe("O PLACAR DA MÃO DO REI — leitura mínima depois da cena, nos dois lados", () => {
  const META = 4_600;

  /** A partida, pelo motor, parada no fim da mão `alvo`. */
  function fimDaMao(alvo: number, semente = 42): MatchState {
    const m = createMatch(["Você", "Bia", "Léo", "Nara"], semente);
    for (let guarda = 0; guarda < 20_000; guarda++) {
      const h = m.hand;
      if ((h && h.handNumber === alvo && h.handScores !== null) || m.finished) return m;
      if (h === null || h.handScores !== null) { startNextHand(m); continue; }
      if (h.awaitingTrumpFrom !== null) {
        selectTrump(m, h.awaitingTrumpFrom, chooseNormalTrump(buildBotView(m, h.awaitingTrumpFrom).hand));
        continue;
      }
      playCard(m, h.turn!, legalCardsFor(m, h.turn!)[0]);
    }
    throw new Error("não chegou à mão " + alvo);
  }

  it("CONTRATO: o cliente e o servidor seguram o Placar do Rei pelo MESMO número", () => {
    expect(TEMPOS.pisoDoPlacarDoRei).toBe(TEMPOS_PADRAO.pisoDoPlacarDoRei);
    expect(TEMPOS.leituraDaVazaKing).toBe(TEMPOS_PADRAO.leituraDaVazaKing);
  });

  it("a leitura depois da cena é ≥ 4,6s, com folga — e não virou espera (≤ 6s)", () => {
    expect(leituraDoPlacarDoRei()).toBe(TEMPOS.pisoDoPlacarDoRei - TEMPOS.leituraDaVazaKing);
    expect(leituraDoPlacarDoRei()).toBeGreaterThanOrEqual(META + 300);
    expect(leituraDoPlacarDoRei()).toBeLessThanOrEqual(6_000);
    // contada do fim da ANIMAÇÃO (cena + destaque), a meta também é cumprida
    expect(TEMPOS.pisoDoPlacarDoRei - (TEMPOS.cenaDoRei + TEMPOS.kCopasCaptura)).toBeGreaterThanOrEqual(META);
  });

  it("SOLO e ONLINE liberam a mão 6 no MESMO instante para a mesma vaza do K♥", () => {
    const m = fimDaMao(5);
    const fechou = 50_000;
    const placarEntra = fechou + TEMPOS.leituraDaVazaKing; // `pausaAte()` no solo
    const servidor = placarLiberadoEm({ m, maoTerminouEm: fechou, vazaFinalEntraEm: fechou });
    const g = new LeituraDaPartida(m, 0);
    expect(podeAvancarDoPlacar(g, placarEntra, servidor - 1)).toBe(false);
    expect(podeAvancarDoPlacar(g, placarEntra, servidor)).toBe(true);
  });

  it("os dois lados reconhecem a MESMA mão — só a 5, em todas as dez", () => {
    for (let mao = 1; mao <= 10; mao++) {
      const m = fimDaMao(mao);
      const g = new LeituraDaPartida(m, 0);
      expect(ehPlacarDoRei(g), `mão ${mao} no cliente`).toBe(mao === 5);
      expect(ehPlacarDoReiNoServidor(m), `mão ${mao} no servidor`).toBe(mao === 5);
    }
  });

  it("solo: confirmação cedo é ignorada; as outras mãos avançam no ato", () => {
    const placarEntra = 10_000;
    const g5 = new LeituraDaPartida(fimDaMao(5), 0);
    expect(podeAvancarDoPlacar(g5, placarEntra, placarEntra)).toBe(false);
    expect(podeAvancarDoPlacar(g5, placarEntra, placarEntra + META)).toBe(false);
    expect(podeAvancarDoPlacar(g5, placarEntra, placarEntra + leituraDoPlacarDoRei())).toBe(true);
    // tela por cima sem hora marcada (pausa "infinita"): não libera
    expect(podeAvancarDoPlacar(g5, Infinity, Number.MAX_SAFE_INTEGER)).toBe(false);
    for (const mao of [1, 4, 6, 9]) {
      const g = new LeituraDaPartida(fimDaMao(mao), 0);
      expect(podeAvancarDoPlacar(g, placarEntra, placarEntra), `mão ${mao}`).toBe(true);
    }
  });

  it("o hook do solo passa pela guarda, e o Placar do solo nasce com o botão segurado", () => {
    const hook = ler("./useKingGame.ts");
    expect(hook).toMatch(/if \(!podeAvancarDoPlacar\(g, pausaAte\(\), Date\.now\(\)\)\) return;/);
    const placar = ler("../ui/Placar.tsx");
    expect(placar).toMatch(/useLeituraMinima\(!mp && ehPlacarDoRei\(game\), leituraDoPlacarDoRei\(\)\)/);
    expect(placar).toMatch(/disabled=\{segurando\}/);
  });
});

// ═════════════════════════════════════ ÚLTIMA MÃO ═════════════════════════════════════

describe("ÚLTIMA MÃO — o anúncio e o respiro do servidor", () => {
  const DURACAO = constante(FONTE_UM, "DURACAO_MS");
  const SAIDA = constante(FONTE_UM, "SAIDA_MS");

  it("~6s de presença: entre 5,5s e 6,5s, com ao menos 5s antes de começar a sair", () => {
    expect(DURACAO + SAIDA).toBeGreaterThanOrEqual(5500);
    expect(DURACAO + SAIDA).toBeLessThanOrEqual(6500);
    expect(DURACAO).toBeGreaterThanOrEqual(5000);
  });

  it("o servidor segura bots e estende o prazo exatamente pelo tempo do anúncio", () => {
    // É o par que impede o bot de agir por trás do véu e o relógio de correr durante ele. O teste
    // do servidor (`rooms/ultimaMao.test.ts`) prova o comportamento com esse mesmo número.
    expect(TEMPOS_PADRAO.aberturaDaUltimaMao).toBe(DURACAO + SAIDA);
    // e o bot, que decide com a cortesia, só pode decidir DEPOIS do anúncio inteiro
    expect(TEMPOS_PADRAO.aberturaDaUltimaMao + TEMPOS_PADRAO.cortesiaDoBot).toBeGreaterThan(DURACAO + SAIDA);
  });

  it("o texto continua o mesmo", () => {
    expect(FONTE_UM).toMatch(/<b>ÚLTIMA MÃO<\/b>/);
    expect(FONTE_UM).toMatch(/<i>Tudo pode mudar agora\.<\/i>/);
  });

  it("nenhuma animação do anúncio dura mais que ele, e nenhuma é infinita", () => {
    const fins = finsDasAnimacoes(BLOCO_UM);
    expect(fins.length).toBeGreaterThan(6);
    for (const { decl, fim } of fins) {
      expect(fim, `"${decl}" termina em ${fim}s, depois do anúncio`).toBeLessThanOrEqual(DURACAO / 1000);
    }
    const ondas = /const ONDAS_DE_FAISCAS = \[([^\]]+)\]/.exec(FONTE_UM)![1].split(",").map(Number);
    const duracao = parseFloat(/\.um-faiscas i\{[^}]*animation:umFaisca (\d*\.?\d+)s/.exec(BLOCO_UM)![1]);
    expect(Math.max(...ondas) + 5 * 0.045 + duracao).toBeLessThanOrEqual(DURACAO / 1000);
  });

  it("movimento reduzido: o halo novo também cala — pela classe e pela media query", () => {
    expect(BLOCO_UM).toMatch(/\.um\.calmo \.um-luz\{display:none;\}/);
    const media = BLOCO_UM.slice(BLOCO_UM.indexOf("@media (prefers-reduced-motion:reduce){"));
    expect(media).toMatch(/\.um-luz\{display:none;\}/);
    expect(FONTE_UM).toMatch(/\{!reduzido && <span className="um-luz" aria-hidden \/>\}/);
    expect(BLOCO_UM).toMatch(/\.um-luz\{[^}]*pointer-events:none;/);
  });

  it("o toque encerra o anúncio e não atravessa para a Mesa", () => {
    expect(FONTE_UM).toMatch(/onClick=\{\(e\) => \{ e\.stopPropagation\(\); encerrar\.current\(\); \}\}/);
  });
});
