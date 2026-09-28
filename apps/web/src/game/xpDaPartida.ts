// O XP DE UMA PARTIDA ONLINE, NO FIM DELA — só leitura, e só o que o banco confirmou.
//
// O crédito é gravado pelo SERVIDOR depois que a partida termina, de forma assíncrona (outbox →
// banco). Quando o Placar Final abre, ele pode ainda não estar lá. Por isso a busca tenta algumas
// vezes, em intervalos curtos e LIMITADOS, e desiste em silêncio.
//
// O QUE ELA NUNCA FAZ:
//   - inventar zero: `null` quer dizer "ainda não sei" (crédito atrasado, sessão vencida, banco
//     fora) — e não "você não ganhou XP". Sem crédito real, a tela simplesmente não mostra o bloco;
//     o progresso certo aparece na próxima visita à Home;
//   - calcular XP ou nível: os números são os do banco (`meu_progresso`), relidos depois do crédito;
//   - escrever: o leitor não tem caminho de escrita, e o banco recusaria se tivesse;
//   - continuar depois de desmontar: o `cancelado` é conferido antes e depois de cada espera.
import { useEffect, useState } from "react";
import { matchIdValido, type CreditoDaPartida, type LeitorDeProgresso, type ProgressoDoJogador } from "../auth/progresso.js";

export interface XpDaPartida {
  credito: CreditoDaPartida;
  /** O progresso RELIDO depois do crédito. `null` se essa segunda leitura falhar. */
  progresso: ProgressoDoJogador | null;
}

/** Espera ANTES de cada tentativa: 5 tentativas em ~15 s. O crédito costuma chegar em segundos. */
export const ESPERAS_DO_CREDITO_MS: readonly number[] = [0, 1_000, 2_000, 4_000, 8_000];

const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

export async function buscarXpDaPartida(
  leitor: Pick<LeitorDeProgresso, "creditoDaPartida" | "meuProgresso">,
  matchId: string,
  opcoes: { cancelado: () => boolean; esperas?: readonly number[]; esperar?: (ms: number) => Promise<void> },
): Promise<XpDaPartida | null> {
  if (!matchIdValido(matchId)) return null; // id estranho não merece nem a primeira tentativa
  const esperar = opcoes.esperar ?? dormir;
  for (const ms of opcoes.esperas ?? ESPERAS_DO_CREDITO_MS) {
    if (opcoes.cancelado()) return null;
    if (ms > 0) await esperar(ms);
    if (opcoes.cancelado()) return null;
    const credito = await leitor.creditoDaPartida(matchId).catch(() => null);
    if (opcoes.cancelado()) return null;
    if (credito) {
      const progresso = await leitor.meuProgresso().catch(() => null);
      return opcoes.cancelado() ? null : { credito, progresso };
    }
  }
  return null;
}

/**
 * O XP desta partida, para o Placar Final do MULTIPLAYER. Sem `matchId` ou sem leitor (modo local,
 * publicação sem identidade) não há busca nenhuma. A busca começa quando a tela monta — o crédito
 * tem até a encenação terminar para chegar — e morre com ela.
 */
export function useXpDaPartida(matchId: string | undefined, leitor: LeitorDeProgresso | null | undefined): XpDaPartida | null {
  const [xp, setXp] = useState<XpDaPartida | null>(null);
  useEffect(() => {
    if (!matchId || !leitor) return;
    let cancelado = false;
    void buscarXpDaPartida(leitor, matchId, { cancelado: () => cancelado }).then((r) => {
      if (!cancelado && r) setXp(r);
    });
    return () => { cancelado = true; };
  }, [matchId, leitor]);
  return xp;
}

/**
 * O que o fim de partida MOSTRA. Crédito real e positivo: "+N XP". Crédito real de ZERO (abandono,
 * partida sobreposta) também é verdade, mas "+0 XP" sem o porquê só confunde — o bloco não aparece,
 * e a Home mostra o progresso de sempre.
 */
export function xpParaExibir(xp: XpDaPartida | null): XpDaPartida | null {
  return xp && xp.credito.xpDelta > 0 ? xp : null;
}
