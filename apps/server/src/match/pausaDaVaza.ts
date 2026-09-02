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
// ══ POR QUE O RESPIRO NÃO APARECE COMO "28s" NA TELA ══
//
// Porque ele DECAI. O prazo é calculado no instante do agendamento e o `TURN_CLOCK` carrega o
// restante; quando a pausa termina e o jogador finalmente pode agir, o respiro já foi consumido
// por ela e o que sobra é o prazo cheio. É a mesma mecânica do respiro da última mão.
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
 * Quanto ainda falta, agora, para o cliente poder mostrar este turno ao jogador.
 *
 * Duas parcelas, e as duas são tempo em que ele está impedido de agir:
 *
 *   1. o resto da PAUSA de leitura — a mesa está parada mostrando a vaza que fechou;
 *   2. `represados × passoDaApresentacao` — o que o servidor produziu DURANTE a pausa ainda
 *      precisa entrar na mesa, uma carta por vez. É a cadência corrigida em 3018e97, e ela custa
 *      tempo justamente porque cada carta agora é perceptível.
 *
 * Decai sozinho: é uma diferença contra `agora`. Quando a apresentação termina, vale 0, e o prazo
 * volta a ser exatamente o prazo.
 */
export function respiroDaLeitura(
  agora: number,
  fechouEm: number | null,
  pausa: number,
  represados: number,
): number {
  if (fechouEm === null) return 0;
  const liberaEm = fechouEm + pausa + represados * TEMPOS.passoDaApresentacao;
  return Math.max(0, liberaEm - agora);
}
