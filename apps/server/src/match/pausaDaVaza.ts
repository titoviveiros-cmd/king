// O RESPIRO DA LEITURA DA VAZA — o segundo lugar em que o servidor sabe da apresentação.
//
// ══ O PROBLEMA, EM UMA FRASE ══
//
// O prazo do jogador começa quando o SERVIDOR abre o turno; a possibilidade de jogar começa
// quando o CLIENTE termina de apresentar o que veio antes. Entre os dois instantes o relógio
// corre contra alguém que ainda não pode agir.
//
// ══ POR QUE ISSO NÃO SE RESOLVE NO CLIENTE ══
//
// O relógio é autoritativo, e tem de continuar sendo: um cliente que dissesse "ainda estou
// apresentando" poderia dizer isso para sempre. Fingir 25s na tela enquanto o servidor conta 23
// seria pior ainda — a jogada seria recusada com o cronômetro mostrando tempo de sobra.
//
// Quem tem de saber é o servidor. E ele já sabe fazer isso: `aberturaDaUltimaMao` existe
// exatamente por este motivo, e é o precedente que este arquivo segue.
//
// ══ POR QUE ESTENDER O PRAZO, E NÃO ATRASAR O JOGO ══
//
// A alternativa seria o servidor esperar a pausa antes de retomar a sequência. Isso funcionaria,
// e custaria caro: as jogadas seguintes passariam a sair ~900ms depois, em toda vaza, somando
// espera sobre uma espera que o jogador já vê. Estender o prazo não atrasa nada — só deixa de
// cobrar do jogador um tempo em que ele estava impedido de jogar.
//
// ══ O RESPIRO SÓ EXISTE ENQUANTO O JOGADOR NÃO PODE AGIR ══
//
// Ele DECAI: o prazo é calculado no instante do agendamento e o `TURN_CLOCK` carrega o restante.
// Isso só dá o prazo cheio no instante clicável se o jogador estava mesmo impedido durante todo
// o respiro. A primeira versão supôs que ninguém joga durante a pausa — e para o LÍDER da vaza
// seguinte isso é falso: a Mesa habilita as cartas dele durante a pausa. O respiro inflava o
// relógio de quem já podia jogar (medido no navegador real: 25,6s e 27,2s). Ver `respiroDaLeitura`.
import { handBreakdown, type MatchState } from "@king/engine";
import { TEMPOS } from "./tempos.js";

/**
 * A pausa que o cliente aplica depois da vaza que acabou de fechar.
 *
 * ESPELHA `apps/web/src/game/anuncio.ts`, e a regra é a mesma, na mesma ordem. O que ela NÃO faz
 * é recontar nada: quem diz o que a vaza custou é `handBreakdown`, do motor — o mesmo que o
 * cliente chama. Não há segunda verdade sobre o que é bucha; há uma tradução de "teve bucha?"
 * para "quanto tempo a mesa fica parada".
 *
 * Devolve 0 quando não há vaza fechada — não há o que ler, não há o que descontar.
 */
export function pausaDaLeitura(m: MatchState | null): number {
  const h = m?.hand;
  if (!h || h.completedTricks.length === 0) return 0;

  // A última vaza da mão precisa de ar: o Placar só entra depois desta pausa.
  //
  // A ORDEM IMPORTA, e um teste de contrato pegou isto: o cliente decide a fase em cascata e
  // `matchEnd` vem ANTES de `handEnd`. Na última mão da partida quem entra não é o Placar da mão,
  // é o Placar Final — que tem encenação própria —, então o piso de fim de mão não se aplica.
  // A primeira versão daqui olhava só `handScores` e dava 1800ms onde o cliente dá 1150ms.
  const piso = !m.finished && h.handScores !== null ? TEMPOS.fimDeMao : 0;
  const normal = Math.max(TEMPOS.leituraDaVaza, piso);

  const ultima = h.completedTricks[h.completedTricks.length - 1];
  const contrato = h.contract;

  // Positivas: a vaza É o ponto, não há castigo a anunciar.
  if (contrato.isPositive) return normal;

  // "Não pegar Vazas": toda vaza custa e o vencedor é evidente na mesa. O cliente não anuncia.
  if (contrato.kind === "no-tricks") return normal;

  const bd = handBreakdown(contrato.kind, [ultima]);
  // Negativa sem bucha NESTA vaza: alívio, ritmo normal.
  if (bd.rows[ultima.winner].units === 0) return normal;

  const king = contrato.kind === "no-king";
  return Math.max(king ? TEMPOS.leituraDaVazaKing : TEMPOS.leituraDaVazaCastigo, piso);
}

/**
 * QUANDO O CLIENTE VAI APRESENTAR UMA ATUALIZAÇÃO — o espelho, no servidor, da fila do cliente.
 *
 * ESPELHA `instanteDaProximaApresentacao` (apps/web/src/game/filaDeApresentacao.ts), e a
 * equivalência é travada por teste do lado web, que importa as duas. A regra: a atualização entra
 * no mais tardio entre a chegada, a cadência desde a anterior e o fim da pausa visual.
 *
 * ══ POR QUE UMA RECORRÊNCIA, E NÃO UMA CONTA DE CARTAS ══
 *
 * Medido no navegador real (176 decisões, 2 humanos + 2 bots): nenhuma fórmula fixa explica o
 * instante clicável. `represadas × passo` inflava até +523ms; `(represadas − 1) × passo` erodia
 * até −758ms; e mesmo sem represada nenhuma o líder perdia até −329ms quando a carta que fecha a
 * vaza chegava menos de um passo depois da anterior. A recorrência explicou o DOM com mediana de
 * 2–5ms em todos os grupos.
 */
export function instanteDaApresentacao(p: {
  agora: number;
  ultimaEm: number | null;
  pausaAte: number;
  passo: number;
}): number {
  const cadencia = p.ultimaEm === null ? p.agora : p.ultimaEm + p.passo;
  return Math.max(p.agora, cadencia, p.pausaAte);
}

/**
 * Quantas atualizações represadas o cliente encena antes de COLAPSAR para a mais recente.
 * ESPELHA `LIMITE_DA_FILA` (apps/web/src/game/filaDeApresentacao.ts); igualdade travada por teste.
 */
export const LIMITE_DA_FILA_DO_CLIENTE = 5;

/** Uma publicação, do ponto de vista da fila do cliente. */
export interface ItemDaFila {
  /** Quando ela chega. */
  chegada: number;
  /** A pausa de leitura que ela abre ao entrar (a carta que FECHA a vaza); 0 se não abre. */
  pausa: number;
  /** Virar a mão limpa a pausa no cliente (`limpar()`). */
  viraMao: boolean;
}

/** O que a fila do cliente carrega entre uma publicação e outra. */
export interface EspelhoDaFila {
  fila: readonly ItemDaFila[];
  ultimaEm: number | null;
  pausaAte: number;
}

export const espelhoVazio = (): EspelhoDaFila => ({ fila: [], ultimaEm: null, pausaAte: 0 });

/** Salto (início, ressincronização): o cliente descarta a fila e a pausa e mostra na hora. */
export const saltarEspelho = (agora: number): EspelhoDaFila => ({ fila: [], ultimaEm: agora, pausaAte: 0 });

interface FilaMutavel { fila: ItemDaFila[]; ultimaEm: number | null; pausaAte: number }

/**
 * UM passo do dreno do cliente, se a cabeça da fila entra ANTES de `ate`.
 *
 * A cabeça entra no instante da recorrência. Nesse instante, se há mais que `limite` atualizações
 * já chegadas, a fila COLAPSA: aplica só a mais recente, descarta o resto e limpa a pausa — igual a
 * `proximoPasso` + `limpar()` no cliente. A atualização aplicada pode abrir pausa (fechou vaza) ou
 * limpá-la (virou a mão).
 */
function drenarUm(e: FilaMutavel, ate: number, passo: number, limite: number): { em: number; aplicado: ItemDaFila } | null {
  if (e.fila.length === 0) return null;
  const em = instanteDaApresentacao({ agora: e.fila[0].chegada, ultimaEm: e.ultimaEm, pausaAte: e.pausaAte, passo });
  if (em >= ate) return null;
  const chegadas = e.fila.filter((x) => x.chegada <= em).length;
  const consumidos = chegadas > limite ? chegadas : 1;
  if (chegadas > limite) e.pausaAte = 0;
  const aplicado = e.fila[consumidos - 1];
  e.fila = e.fila.slice(consumidos);
  if (aplicado.viraMao) e.pausaAte = 0;
  if (aplicado.pausa > 0) e.pausaAte = em + aplicado.pausa;
  e.ultimaEm = em;
  return { em, aplicado };
}

/**
 * PUBLICA no espelho: devolve a fila depois desta chegada e QUANDO esta atualização fica visível.
 *
 * Primeiro avança tudo o que o cliente já teria apresentado antes desta chegada; depois empilha a
 * atualização e simula o dreno para a frente, sem supor chegadas futuras — se outra publicação
 * vier, ela abre outra decisão e o prazo é recalculado.
 *
 * ══ POR QUE O COLAPSO PRECISA ESTAR AQUI ══
 *
 * Sem ele, uma mesa que joga depressa acumula um passo por atualização para sempre: a suíte da
 * última mão, que joga nove mãos em sequência rápida, viu a primeira jogada da décima nascer com
 * 350.971ms. O cliente real nunca fica tão atrás — colapsa acima de `limite` e salta para o presente.
 */
export function publicarNoEspelho(
  atual: EspelhoDaFila,
  item: ItemDaFila,
  passo: number,
  limite: number = LIMITE_DA_FILA_DO_CLIENTE,
): { espelho: EspelhoDaFila; visivelEm: number } {
  const e: FilaMutavel = { fila: [...atual.fila], ultimaEm: atual.ultimaEm, pausaAte: atual.pausaAte };
  while (drenarUm(e, item.chegada, passo, limite));
  e.fila.push(item);
  const espelho: EspelhoDaFila = { fila: [...e.fila], ultimaEm: e.ultimaEm, pausaAte: e.pausaAte };
  const futuro: FilaMutavel = { fila: [...e.fila], ultimaEm: e.ultimaEm, pausaAte: e.pausaAte };
  for (;;) {
    const r = drenarUm(futuro, Infinity, passo, limite)!;
    if (r.aplicado === item) return { espelho, visivelEm: r.em };
  }
}

/**
 * Quanto ainda falta, agora, para o cliente mostrar ao jogador a decisão que acabou de abrir.
 *
 * `visivelEm` é o instante em que a publicação que abriu a decisão entra na mesa — calculado por
 * `instanteDaApresentacao` sobre a sequência de publicações. O respiro é só a distância até lá.
 *
 * ══ O LÍDER NÃO GANHA A PAUSA ══
 *
 * A decisão do líder é aberta pela carta que FECHA a vaza, e a pausa começa DEPOIS de ela entrar:
 * a Mesa habilita as cartas dele durante a leitura. Somar a pausa ali dava a quem já podia agir
 * 25,6s a 27,9s. Mas se a carta que fechou esperou a cadência, esse tempo é devido.
 *
 * ══ O QUE FOI JOGADO DURANTE A PAUSA ══
 *
 * Entra depois dela, um passo por carta; a decisão aberta pela última só fica visível quando ela
 * entra. A recorrência cobre isso sem contar cartas.
 *
 * Decai sozinho: é uma diferença contra `agora`. Quando a apresentação termina, vale 0.
 */
export function respiroDaLeitura(agora: number, visivelEm: number | null): number {
  if (visivelEm === null) return 0;
  return Math.max(0, visivelEm - agora);
}
