// O PROGRESSO VISTO PELO CLIENTE — só leitura.
//
// O cliente NUNCA escreve progresso: não existe aqui nenhum caminho de insert, update ou RPC de
// crédito, e o banco recusaria se existisse (RLS de leitura própria, zero GRANT de escrita). O XP
// nasce no servidor da partida; o cliente só pergunta "quanto tenho?" e "quanto ganhei nesta?".
//
// Tudo passa pelo MESMO cliente Supabase da identidade (`clienteSupabase.ts`). Nada de segundo
// cliente: dois clientes seriam duas sessões concorrendo pelo mesmo `localStorage`.
import { clienteCompartilhado } from "./clienteSupabase.js";
import { identidadeConfigurada } from "./identidade.js";

export interface ProgressoDoJogador {
  xpTotal: number;
  nivel: number;
  /** XP acumulado DENTRO do nível atual. */
  xpNoNivel: number;
  /** XP que o nível atual exige para subir — a barra vai de 0 a isto. */
  xpDoNivel: number;
}

export interface CreditoDaPartida {
  xpDelta: number;
  posicao: number;
}

type Resposta<T> = Promise<{ data: T | null; error: unknown }>;

/** O que a leitura precisa do banco. Duas consultas, nenhuma escrita. */
export interface PortaDeProgresso {
  meuProgresso(): Resposta<{ xp_total: number; nivel: number; xp_no_nivel: number; xp_do_nivel: number }>;
  creditoDaPartida(partidaId: string): Resposta<{ xp_delta: number; posicao: number }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

export function criarLeitorDeProgresso(porta: () => Promise<PortaDeProgresso | null>) {
  return {
    /** O progresso do jogador desta sessão. `null` quando não há provedor ou a leitura falha. */
    async meuProgresso(): Promise<ProgressoDoJogador | null> {
      try {
        const p = await porta();
        if (!p) return null;
        const { data, error } = await p.meuProgresso();
        if (error || !data) return null;
        const { xp_total, nivel, xp_no_nivel, xp_do_nivel } = data;
        if (![xp_total, nivel, xp_no_nivel, xp_do_nivel].every(inteiro) || nivel < 1) return null;
        return { xpTotal: xp_total, nivel, xpNoNivel: xp_no_nivel, xpDoNivel: xp_do_nivel };
      } catch {
        return null;
      }
    },

    /**
     * Quanto esta partida rendeu, pelo `matchId` que o servidor entrega na `STATE_UPDATE`.
     *
     * `null` também quando o crédito ainda não chegou: ele é gravado depois do fim da partida, de
     * forma assíncrona. Quem mostrar isto na tela tenta de novo algumas vezes.
     */
    async creditoDaPartida(matchId: string): Promise<CreditoDaPartida | null> {
      if (!UUID.test(matchId)) return null; // lixo não vira consulta
      try {
        const p = await porta();
        if (!p) return null;
        const { data, error } = await p.creditoDaPartida(matchId);
        if (error || !data || !inteiro(data.xp_delta) || !inteiro(data.posicao)) return null;
        return { xpDelta: data.xp_delta, posicao: data.posicao };
      } catch {
        return null;
      }
    },
  };
}

export type LeitorDeProgresso = ReturnType<typeof criarLeitorDeProgresso>;

/** O leitor real, sobre o cliente único. `null` quando esta publicação não tem identidade. */
export function leitorDeProgressoConfigurado(): LeitorDeProgresso | null {
  const r = identidadeConfigurada();
  if (!r.configurado) return null;
  return criarLeitorDeProgresso(async () => {
    const c = await clienteCompartilhado(r);
    if (!c) return null;
    return {
      meuProgresso: async () => await c.from("meu_progresso").select("xp_total, nivel, xp_no_nivel, xp_do_nivel").maybeSingle(),
      creditoDaPartida: async (partidaId) =>
        await c.from("xp_eventos").select("xp_delta, posicao").eq("partida_id", partidaId).maybeSingle(),
    };
  });
}
