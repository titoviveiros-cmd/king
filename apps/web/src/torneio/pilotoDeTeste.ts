// PILOTO DE TESTE DO MINI-TORNEIO — SÓ EXISTE NOS BUILDS DE E2E E NO SERVIDOR DE DESENVOLVIMENTO.
//
// Para provar de ponta a ponta a VITÓRIA no mini-torneio (celebração, tela final, nada duplicado),
// o teste precisa de um assento humano que ganhe — sem inventar resultado, sem mexer no ranking e
// sem burlar o motor. A saída honesta: o assento humano joga EXATAMENTE o que o Bot Normal jogaria
// no lugar dele. Este módulo só RESPONDE "o que o Bot Normal faria agora?"; quem joga é o teste,
// tocando na carta (ou no trunfo) pela interface de verdade, como qualquer pessoa.
//
// Como o Bot Normal é determinístico e o motor embaralha pela semente, a partida com o piloto é a
// mesma partida que `vitoriaDeterministica.test.ts` joga sem tela. É lá que a semente da vitória
// foi achada (busca offline) e é lá que ela é conferida a cada execução da suíte.
//
// GARANTIA DE QUE NÃO VAZA PARA PRODUÇÃO: `ModoTorneio` só importa este arquivo (import dinâmico)
// dentro de um `if` sobre `import.meta.env`, que o Vite troca por constantes no build. No build de
// produção o ramo é morto, o import some e este módulo nem vira arquivo do bundle (conferível com
// uma busca por `__kingPilotoDoTorneio` em `dist/` depois de `npm run build`: zero ocorrências).
//
// Ler o estado do motor exige o `MatchState` da partida, que `LeituraDaPartida` guarda como
// `protected`. O acesso abaixo é só de leitura, e só aqui: nenhuma classe de produção ganhou
// método novo por causa do teste.
import { buildBotView, chooseNormalCard, chooseNormalTrump, type Card, type MatchState, type Trump } from "@king/engine";
import type { KingGame } from "../game/kingGame.js";

/** O nome do gancho na janela. Um só, com o prefixo dos outros diagnósticos do KING. */
export const NOME_DO_GANCHO = "__kingPilotoDoTorneio";

/** Os rótulos dos botões de trunfo da Mesa (`TRUMPS` em Mesa.tsx). */
const ROTULO_DO_TRUNFO: Record<Trump, string> = {
  hearts: "Copas", diamonds: "Ouros", clubs: "Paus", spades: "Espadas", "no-trump": "Sem Trunfo",
};

export type SugestaoDoPiloto =
  | { tipo: "trunfo"; trunfo: Trump; rotulo: string }
  /** `rotulo` = o `aria-label` da carta no leque (`CardView`): "Q de hearts". */
  | { tipo: "carta"; carta: Card; rotulo: string };

/** O que o Bot Normal faria no lugar do humano AGORA, ou `null` se não é a vez dele. Não joga nada. */
export function sugestaoDoBotNormal(jogo: KingGame): SugestaoDoPiloto | null {
  const m = (jogo as unknown as { m: MatchState }).m;
  const seat = jogo.humanSeat;
  if (jogo.humanChoosesTrump()) {
    const trunfo = chooseNormalTrump(buildBotView(m, seat).hand);
    return { tipo: "trunfo", trunfo, rotulo: ROTULO_DO_TRUNFO[trunfo] };
  }
  if (jogo.isHumanTurn()) {
    const carta = chooseNormalCard(buildBotView(m, seat));
    return { tipo: "carta", carta, rotulo: `${carta.rank} de ${carta.suit}` };
  }
  return null;
}

/** Põe o gancho na janela. Devolve quem o tira. */
export function instalarPilotoDeTeste(jogoAtual: () => KingGame | null): () => void {
  const w = window as unknown as Record<string, unknown>;
  w[NOME_DO_GANCHO] = () => {
    const j = jogoAtual();
    return j ? sugestaoDoBotNormal(j) : null;
  };
  return () => { delete w[NOME_DO_GANCHO]; };
}
