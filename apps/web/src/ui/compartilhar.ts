// O TEXTO QUE SAI DA PARTIDA — o único pedaço do KING que vai parar no grupo da família.
//
// A versão anterior era um resumo: "KING 👑 — Tito venceu! 1º Tito +185 · 2º ..." Correto e
// esquecível. Quem perde não manda, quem ganha manda sem graça, e ninguém responde.
//
// A régua desta copy é uma só: DEVE DAR VONTADE DE RESPONDER. Por isso o texto muda com a
// posição — campeão comemora, segundo lugar promete voltar, último lugar tem humor —, tem uma
// linha de resultado real e termina numa pergunta.
//
// TRÊS PROIBIÇÕES, e as três têm teste:
//   • nada inventado. Só entra o que sai do estado da partida, e a estatística de destaque só
//     aparece quando o motor pode derivá-la com segurança;
//   • nada privado. Sem `playerId`, sem token de reconexão, sem código de sala, sem placar de
//     quem não pediu para aparecer além do resultado público da mesa;
//   • sem travessão como pontuação, e sem soar como anúncio.
//
// O tamanho é para WhatsApp: cabe na prévia da mensagem, sem rolagem.
import type { RankRow, MatchStats, Seat } from "@king/engine";
import { fmtSigned } from "./contractText.js";

export interface DadosDoCompartilhamento {
  /** Classificação final, já ordenada por posição. */
  finais: RankRow[];
  /** Quem está compartilhando. O texto é escrito da perspectiva dele. */
  eu: Seat;
  players: string[];
  stats: MatchStats;
  empate: boolean;
}

/**
 * Manchete por posição. É a linha que decide se alguém lê o resto.
 *
 * Do campeão para o último a energia cai, mas nunca vira humilhação: quem terminou em quarto
 * mandou a mensagem, e a mensagem é dele também.
 */
const MANCHETE: Record<number, (nome: string) => string> = {
  1: (n) => `🏆 ${n.toUpperCase()} É O CAMPEÃO!`,
  2: (n) => `🥈 ${n.toUpperCase()} FICOU A UM PASSO!`,
  3: (n) => `🥉 ${n.toUpperCase()} SEGUROU O PÓDIO!`,
  4: (n) => `🎲 ${n.toUpperCase()} JOGA A PRÓXIMA COM SEDE!`,
};

/** Fecho por posição. Convida a próxima partida sem pedir nada. */
const FECHO: Record<number, string> = {
  1: "👑 Quem encara a próxima?",
  2: "👑 Na próxima essa é minha.",
  3: "👑 Bora de novo?",
  4: "👑 Revanche. Agora.",
};

/** A medalha de cada posição, na coluna do placar. */
const MEDALHA: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉", 4: "4️⃣" };

/**
 * UMA estatística, e só se for verdade.
 *
 * A ordem é de raridade: o que quase não acontece vale mais como assunto. Cada linha aqui sai de
 * `matchStats`, que lê o histórico de mãos concluídas. Nenhuma delas é uma conquista inventada
 * para encher a mensagem, e quando nada se destaca a mensagem simplesmente não traz estatística.
 */
export function destaqueReal(d: DadosDoCompartilhamento): string | null {
  const meu = d.stats.perSeat[d.eu];
  const minhaPos = d.finais.find((r) => r.seat === d.eu)?.position ?? 4;

  // Levou o Rei de Copas e mesmo assim venceu: o −160 é a maior punição do jogo.
  if (d.stats.kingTaker === d.eu && minhaPos === 1) {
    return "👑 Levou o Rei de Copas e venceu mesmo assim";
  }
  // Escapou do Rei quando ele já tinha dono.
  if (d.stats.kingTaker !== null && d.stats.kingTaker !== d.eu) {
    return "👑 Escapou do Rei de Copas";
  }
  // Saiu ileso da maioria das negativas.
  if (meu.negativeHands >= 4 && meu.cleanNegatives >= meu.negativeHands - 1) {
    return `🛡️ Passou ileso por ${meu.cleanNegatives} das ${meu.negativeHands} mãos negativas`;
  }
  // Decidida no fio.
  if (!d.empate && d.stats.margin > 0 && d.stats.margin <= 30) {
    return `🔥 Decidida por ${d.stats.margin} pontos`;
  }
  // Mão de virada: a maior pontuação da partida foi sua.
  if (d.stats.biggestHand && d.stats.biggestHand.seat === d.eu && d.stats.biggestHand.score > 0) {
    return `⚔️ Melhor mão da mesa: ${fmtSigned(d.stats.biggestHand.score)} na Mão ${d.stats.biggestHand.handNumber}`;
  }
  // Dominou as positivas.
  if (meu.positiveTricks >= 20) {
    return `⚔️ ${meu.positiveTricks} vazas nas mãos positivas`;
  }
  return null;
}

/**
 * A mensagem final.
 *
 * Empate na liderança tem abertura própria: dizer que alguém "venceu" quando a posição é dividida
 * seria contar uma história que a mesa não viveu.
 */
export function textoDoCompartilhamento(d: DadosDoCompartilhamento): string {
  const eu = d.finais.find((r) => r.seat === d.eu)!;
  const nome = d.players[d.eu];
  const campeoes = d.finais.filter((r) => r.position === 1);

  const manchete = d.empate && eu.position === 1
    ? `🤝 ${campeoes.map((c) => d.players[c.seat]).join(" E ").toUpperCase()} DIVIDIRAM O TOPO!`
    : (MANCHETE[eu.position] ?? MANCHETE[4])(nome);

  // PLACAR VERTICAL, e é a diferença que faz a mensagem funcionar no celular.
  //
  // Numa linha só ("1º Tito +215  2º Sr. Trunfo +5  3º ..."), o WhatsApp quebra onde couber e o
  // resultado vira um parágrafo de números que ninguém lê. Empilhado, cada jogador tem a própria
  // linha, a medalha ancora o olho e o saldo fica embaixo do nome: dá para varrer sem ler.
  const placar = d.finais.flatMap((r) => [
    `${MEDALHA[r.position] ?? "▫️"} ${d.players[r.seat]}`,
    fmtSigned(r.score),
    "",
  ]);
  placar.pop(); // a última linha em branco quem coloca é o bloco seguinte

  const destaque = destaqueReal(d);

  return [
    "👑 KING",
    "",
    manchete,
    `🔥 ${fmtSigned(eu.score)} pontos`,
    "",
    "📊 PLACAR FINAL",
    "",
    ...placar,
    ...(destaque ? ["", "✨ DESTAQUE DA PARTIDA", destaque] : []),
    "",
    "🎴 10 mãos. 4 jogadores.",
    "",
    d.empate && eu.position === 1 ? "👑 Desempate na próxima?" : (FECHO[eu.position] ?? FECHO[4]),
  ].join("\n");
}
