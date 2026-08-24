// ESTADO DO RELÓGIO DA DECISÃO — lógica pura, separada do componente para poder ser testada.
//
// O prazo é do SERVIDOR: ele manda `restanteMs` no início da decisão e a cada mudança de fase, e
// o cliente conta sozinho entre as mensagens. Nada aqui decide quando o tempo acaba — quem
// derruba a jogada por estouro é o servidor, sempre. Isto é representação.
//
// POR QUE O LIMIAR É DO CLIENTE
// O servidor já emite fases próprias (aviso aos 10s, crítico aos 5s), mas o produto pediu o
// estado crítico começando aos **10 segundos**. Calcular isso a partir do `restanteMs` que já
// chega evita mudar o protocolo — e, principalmente, evita exigir um deploy do servidor para
// uma decisão de apresentação.
import type { RelogioRecebido } from "../game/useKingOnline.js";

/** A partir daqui o turno entra em estado crítico. */
export const LIMIAR_CRITICO_MS = 10_000;

export type EstadoDoRelogio = "normal" | "critico";

export interface LeituraDoRelogio {
  /** Milissegundos restantes, já descontado o tempo desde que a mensagem chegou. */
  restanteMs: number;
  /** O que o jogador vê: 10, 9, 8… Arredondado para cima, para não mostrar 0 com tempo restante. */
  segundos: number;
  estado: EstadoDoRelogio;
  /** A decisão é minha? Só então o alerta faz sentido. */
  meu: boolean;
  /** Instante em que o prazo expira — identidade estável da decisão, usada para não repetir o som. */
  prazoEm: number;
  /** Deve aparecer na tela? READY é assunto do Placar, não do chip. */
  visivel: boolean;
}

/**
 * Traduz o relógio recebido para o que a tela precisa saber, num instante `agora`.
 * Puro de propósito: recebe o tempo em vez de consultar o relógio do sistema.
 */
export function lerRelogio(
  relogio: RelogioRecebido | null,
  eu: number,
  agora: number,
): LeituraDoRelogio | null {
  if (!relogio) return null;
  if (relogio.tipo === "READY" || relogio.seat === null) return null;

  const restanteMs = relogio.restanteMs - (agora - relogio.recebidoEm);
  return {
    restanteMs,
    segundos: Math.max(0, Math.ceil(restanteMs / 1000)),
    estado: restanteMs <= LIMIAR_CRITICO_MS ? "critico" : "normal",
    meu: relogio.seat === eu,
    prazoEm: relogio.recebidoEm + relogio.restanteMs,
    visivel: restanteMs > 0,
  };
}

/**
 * O alerta sonoro deve tocar agora?
 *
 * Uma vez por decisão, na TRANSIÇÃO para o estado crítico, e só quando a vez é sua. `jaAvisado`
 * é o `prazoEm` da decisão já anunciada; a tolerância existe porque o servidor manda várias
 * mensagens para a mesma decisão (início, aviso, crítico) e o prazo calculado varia alguns
 * milissegundos entre elas — sem a folga, o mesmo turno alertaria duas ou três vezes.
 */
export function deveAlertar(leitura: LeituraDoRelogio | null, jaAvisado: number): boolean {
  if (!leitura || !leitura.visivel) return false;
  if (!leitura.meu || leitura.estado !== "critico") return false;
  return Math.abs(jaAvisado - leitura.prazoEm) > 1500;
}
