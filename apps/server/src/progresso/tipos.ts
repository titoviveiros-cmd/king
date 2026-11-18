// O CONTRATO DO CRÉDITO — o que o servidor manda ao banco, e o que volta.
//
// O que vai é RESULTADO: quem jogou, em que posição terminou e se participou de verdade. O que
// NÃO vai é XP. O XP é calculado dentro de `king_private.creditar_partida`, e a função reprova
// qualquer entrada com campo a mais — então um `xp` que um dia escorregasse para cá seria recusado
// lá, e não somado.

export type Posicao = 1 | 2 | 3 | 4;

export interface HumanoDoResultado {
  /** O `sub` do JWT verificado — o mesmo `auth.users.id` de antes e depois do vínculo Google. */
  playerId: string;
  posicao: Posicao;
  participou: boolean;
  /**
   * RECORDES (Entrega D): a PONTUAÇÃO FINAL do motor, só de quem participou. Opcional: o outbox
   * gravado antes desta entrega não a tem, e continua válido. NÃO vai para `creditar_partida` (o
   * contrato do XP não muda): vai para `king_private.registrar_placares`, na mesma transação.
   */
  pontos?: number;
}

/** A faixa que o banco aceita (`placares_online_pontos`). */
export const PONTOS_MIN = -5000;
export const PONTOS_MAX = 5000;

export interface ResultadoDaPartida {
  /** `crypto.randomUUID()`, gerado pelo servidor no início da partida. */
  partidaId: string;
  iniciadaEm: string;
  terminadaEm: string;
  bots: number;
  humanos: HumanoDoResultado[];
}

/** O que o banco confirma. `novo = false` quando a partida já tinha sido creditada antes. */
export interface LancamentoConfirmado {
  playerId: string;
  posicao: number;
  xpDelta: number;
  novo: boolean;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Diagnóstico nunca mostra id inteiro. */
export const mascarar = (id: string): string => (id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : "∅");

export class ResultadoInvalido extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ResultadoInvalido";
  }
}

/**
 * Confere a forma EXATA de um resultado. Usado antes de gravar no outbox e ao reler o outbox:
 * lixo nunca entra, e lixo que apareça no disco é reportado em vez de reenviado.
 */
export function validarResultado(x: unknown): ResultadoDaPartida {
  const r = x as Partial<ResultadoDaPartida> | null;
  if (!r || typeof r !== "object") throw new ResultadoInvalido("resultado não é objeto");
  const chaves = Object.keys(r).sort().join(",");
  if (chaves !== "bots,humanos,iniciadaEm,partidaId,terminadaEm") throw new ResultadoInvalido("campos inesperados no resultado");
  if (typeof r.partidaId !== "string" || !UUID.test(r.partidaId)) throw new ResultadoInvalido("partidaId não é UUID");
  const inicio = Date.parse(String(r.iniciadaEm));
  const fim = Date.parse(String(r.terminadaEm));
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || inicio >= fim) throw new ResultadoInvalido("datas da partida inválidas");
  if (!Number.isInteger(r.bots) || (r.bots as number) < 0 || (r.bots as number) > 2) throw new ResultadoInvalido("bots fora de 0..2");
  if (!Array.isArray(r.humanos) || r.humanos.length < 2 || r.humanos.length + (r.bots as number) !== 4) {
    throw new ResultadoInvalido("composição inválida");
  }
  const vistos = new Set<string>();
  for (const h of r.humanos) {
    const chavesDoHumano = h && typeof h === "object" ? Object.keys(h).sort().join(",") : "";
    if (chavesDoHumano !== "participou,playerId,posicao" && chavesDoHumano !== "participou,playerId,pontos,posicao") {
      throw new ResultadoInvalido("humano com campos inesperados");
    }
    if (h.pontos !== undefined && (!Number.isInteger(h.pontos) || h.pontos < PONTOS_MIN || h.pontos > PONTOS_MAX)) {
      throw new ResultadoInvalido("pontuação fora da faixa");
    }
    if (h.pontos !== undefined && !h.participou) throw new ResultadoInvalido("pontuação de quem não participou");
    if (typeof h.playerId !== "string" || !UUID.test(h.playerId)) throw new ResultadoInvalido("playerId não é UUID");
    if (vistos.has(h.playerId)) throw new ResultadoInvalido("jogador repetido");
    vistos.add(h.playerId);
    if (![1, 2, 3, 4].includes(h.posicao)) throw new ResultadoInvalido("posição fora de 1..4");
    if (typeof h.participou !== "boolean") throw new ResultadoInvalido("participação não é booleana");
  }
  return r as ResultadoDaPartida;
}
