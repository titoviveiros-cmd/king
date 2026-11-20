// QUEM CAPTUROU O REI DE COPAS — o fato da penalidade do Rei, lido do MOTOR no servidor.
//
// O navegador nunca diz quem levou o K♥: quem diz é o histórico autoritativo da partida. A fonte é a
// mesma do "destaque" do Placar Final (`matchStats(m).kingTaker`), que lê a mão "no-king" do histórico.
// Ela é seguida, e não reinventada — mas aqui o fato vira XP, então só passa se o histórico for
// INEQUÍVOCO; na dúvida, `null`, e o crédito vai pela regra 1 (sem penalidade), que é a regra que não
// precisa do fato.
//
// POR QUE O HISTÓRICO BASTA: na mão 5 a ÚNICA carta que pontua é o K♥ (−160 para quem vence a vaza que
// o contém), e a mão termina na vaza em que ele cai (ou na 13ª, se só cair nela). Então a linha "no-king"
// do histórico tem exatamente um assento com −160 e três com 0 — e esse assento é quem levou a vaza do
// K♥. Abandono, assistência e reconexão não mudam nada: o motor pontua o ASSENTO (a mesma regra que lhe
// tira os 160 pontos), e a sala liga o assento ao jogador pelo elenco congelado no início.
import { HAND_CONTRACTS, matchStats, type MatchState, type Seat } from "@king/engine";

/** O número da mão "não pegar o Rei de Copas", pelo catálogo do motor (hoje, a 5). */
const MAO_DO_REI = Number(Object.keys(HAND_CONTRACTS).find((n) => HAND_CONTRACTS[Number(n)].kind === "no-king"));
const PONTOS_DO_REI = HAND_CONTRACTS[MAO_DO_REI].handTotal; // −160

/**
 * O assento que capturou o K♥, ou `null` quando o fato não é inequívoco: partida sem a mão 5 concluída
 * (incompleta), mão 5 repetida no histórico, ou pontuação que não seja "um −160 e três zeros".
 */
export function capturadorDoRei(m: MatchState): Seat | null {
  const maos = m.history.filter((h) => h.kind === "no-king");
  if (maos.length !== 1 || maos[0].handNumber !== MAO_DO_REI) return null;
  const pontos = maos[0].handScores;
  if (pontos.length !== 4) return null;
  const quem = pontos.flatMap((p, seat) => (p !== 0 ? [seat] : []));
  if (quem.length !== 1 || pontos[quem[0]] !== PONTOS_DO_REI) return null;
  // A MESMA resposta do destaque do Placar: se um dia as duas leituras divergirem, nenhuma vale.
  if (matchStats(m).kingTaker !== quem[0]) return null;
  return quem[0] as Seat;
}
