// A IDENTIDADE DE UM ASSENTO — uma fonte, todas as telas.
//
// ══ POR QUE ISTO É UM MÓDULO, E NÃO UM COMPONENTE DENTRO DA MESA ══
//
// A identidade de um jogador aparece em seis lugares: Mesa, mini perfil, placar entre-mãos, placar
// final, consenso da próxima mão e resumo da última mão. Enquanto a resolução morava dentro da
// Mesa, cada uma das outras telas resolvia do seu jeito — e "do seu jeito" acabou virando
// `nome[0]`, a inicial, em quatro delas. O resultado era uma mesa de bichos e placares de letras.
//
// ══ A ORDEM DE AUTORIDADE ══
//
//   1. o estado sincronizado da SALA, quando existe multiplayer. É ele que os quatro aparelhos
//      compartilham, então é ele que decide;
//   2. a partida LOCAL, que conhece a identidade dos seus quatro assentos;
//   3. `undefined`.
//
// O terceiro caso é deliberado e não tem padrão. "Não sei" é diferente de "é o leão", e essa
// distinção não é preciosismo: `undefined → leao` foi exatamente o atalho que fez os quatro cards
// de uma partida abrirem o mesmo bicho, e o defeito só apareceu na mão de uma pessoa jogando.
// Quem recebe `undefined` decide o que fazer — e o único lugar onde isso é legítimo é um estado
// que não deveria acontecer numa partida normal.
import type { Seat } from "@king/engine";
import type { LeituraDaPartida } from "../game/leituraDaPartida.js";
import type { AssentoLido } from "../net/clienteKing.js";
import { desenhoDoAvatar } from "./avatares.js";

/** Os assentos da sala, quando há multiplayer. */
export type AssentosDaSala = readonly AssentoLido[] | null | undefined;

/**
 * A etiqueta do avatar de um assento, ou `undefined` se ninguém souber.
 *
 * É a única função do projeto autorizada a responder essa pergunta. Se uma tela nova precisar de
 * avatar, ela chama aqui — e não inventa uma terceira regra.
 */
export function etiquetaDoAvatar(
  game: LeituraDaPartida, sala: AssentosDaSala, seat: Seat,
): string | undefined {
  return sala?.find((a) => a.seat === seat)?.avatar ?? game.avatarDoAssento(seat);
}

/**
 * O círculo do jogador: cor pelo ASSENTO, desenho pelo avatar.
 *
 * A cor pertence ao assento e é a mesma em todas as telas — é o que permite reconhecer alguém no
 * placar depois de tê-lo visto na mesa. O desenho vem da etiqueta.
 *
 * Quando não há etiqueta, cai na inicial do nome. Esse caminho existe por defesa, não por projeto:
 * numa partida normal ele nunca deveria ser exercido, e o teste que o cobre é o de estado
 * degenerado, não o de partida.
 */
export function Insignia({ seat, avatar, nome, classe = "av", selo }: {
  seat: Seat;
  avatar?: string;
  nome: string;
  /** A classe base do círculo, que muda de tela para tela (`av`, `pl-av`, `sl-av`). */
  classe?: string;
  /** O selo do castigo desenha um `<i>` dentro de uma linha de texto, não um bloco. */
  selo?: boolean;
}) {
  const d = avatar ? desenhoDoAvatar(avatar) : null;
  const cls = `${classe} s${seat}`;
  const conteudo = d ? d.glifo : (nome[0] ?? "?");
  return selo
    ? <i className={cls} aria-label={d?.rotulo}>{conteudo}</i>
    : <div className={cls} aria-label={d?.rotulo}>{conteudo}</div>;
}

/** A mesma insígnia como `<span>`, para caber dentro de linhas de texto (placares). */
export function InsigniaEmLinha({ seat, avatar, nome, classe }: {
  seat: Seat;
  avatar?: string;
  nome: string;
  classe: string;
}) {
  const d = avatar ? desenhoDoAvatar(avatar) : null;
  return (
    <span className={`${classe} s${seat}`} aria-label={d?.rotulo}>
      {d ? d.glifo : (nome[0] ?? "?")}
    </span>
  );
}
