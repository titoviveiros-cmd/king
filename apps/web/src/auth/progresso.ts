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
  /**
   * Ausente quando o banco ainda não tem a sequência (migração não aplicada) ou mandou dado
   * estranho. Ausente, a tela é exatamente a de antes.
   */
  sequencia?: SequenciaDoJogador;
}

/**
 * A SEQUÊNCIA (dias seguidos de São Paulo com XP), como o BANCO a calcula. O cliente não conta
 * dia, não olha relógio e não decide se quebrou: `atual` já chega EFETIVA — zero para quem
 * deixou passar um dia —, e `hoje` diz se o dia de hoje já conta, pelo relógio do banco.
 */
export interface SequenciaDoJogador {
  atual: number;
  recorde: number;
  hoje: boolean;
  /** A partida que qualificou o último dia. O Placar Final só mostra a sequência se for a dele. */
  partida: string | null;
}

export interface CreditoDaPartida {
  xpDelta: number;
  posicao: number;
}

type Resposta<T> = Promise<{ data: T | null; error: unknown }>;

/** A linha de `meu_progresso`. As colunas da sequência só existem depois da migração dela. */
export interface LinhaDoMeuProgresso {
  xp_total: number;
  nivel: number;
  xp_no_nivel: number;
  xp_do_nivel: number;
  sequencia_atual?: unknown;
  sequencia_recorde?: unknown;
  sequencia_hoje?: unknown;
  sequencia_partida?: unknown;
}

/** O que a leitura precisa do banco. Duas consultas, nenhuma escrita. */
export interface PortaDeProgresso {
  meuProgresso(): Resposta<LinhaDoMeuProgresso>;
  creditoDaPartida(partidaId: string): Resposta<{ xp_delta: number; posicao: number }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** O `matchId` tem a forma de um id de partida? Lixo não vira consulta, nem tentativa repetida. */
export const matchIdValido = (matchId: unknown): matchId is string => typeof matchId === "string" && UUID.test(matchId);

/** A sequência só passa se vier INTEIRA e coerente; senão a tela fica como era antes dela. */
function lerSequencia(d: LinhaDoMeuProgresso): SequenciaDoJogador | null {
  const { sequencia_atual: atual, sequencia_recorde: recorde, sequencia_hoje: hoje, sequencia_partida: partida } = d;
  if (!inteiro(atual) || !inteiro(recorde) || recorde < atual || typeof hoje !== "boolean") return null;
  if (partida !== null && !matchIdValido(partida)) return null;
  return { atual, recorde, hoje, partida: partida === null ? null : partida.toLowerCase() };
}

/**
 * `temSessao`: há uma sessão GUARDADA neste aparelho? Sem ela não existe de quem ler progresso — e
 * a leitura NÃO cria uma. Quem só jogou contra os bots nunca entrou online, então nunca teve
 * convidado; mostrar "0 XP" para essa pessoa exigiria criar um usuário só para desenhar um zero.
 * Sem sessão, nem o SDK é baixado.
 */
export function criarLeitorDeProgresso(porta: () => Promise<PortaDeProgresso | null>, temSessao: () => boolean = () => true) {
  return {
    /** O progresso do jogador desta sessão. `null` quando não há sessão, provedor, ou a leitura falha. */
    async meuProgresso(): Promise<ProgressoDoJogador | null> {
      if (!temSessao()) return null;
      try {
        const p = await porta();
        if (!p) return null;
        const { data, error } = await p.meuProgresso();
        if (error || !data) return null;
        const { xp_total, nivel, xp_no_nivel, xp_do_nivel } = data;
        if (![xp_total, nivel, xp_no_nivel, xp_do_nivel].every(inteiro) || nivel < 1) return null;
        const sequencia = lerSequencia(data);
        return { xpTotal: xp_total, nivel, xpNoNivel: xp_no_nivel, xpDoNivel: xp_do_nivel, ...(sequencia ? { sequencia } : {}) };
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
      if (!matchIdValido(matchId)) return null; // lixo não vira consulta
      if (!temSessao()) return null;
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

/**
 * Onde o SDK guarda a sessão: `sb-<ref do projeto>-auth-token`, o padrão do supabase-js v2. Se um
 * dia o SDK mudar isso, o efeito é o módulo de progresso não aparecer — nunca um convidado novo.
 */
export function chaveDaSessao(url: string): string | null {
  try { return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`; } catch { return null; }
}

function sessaoGuardada(url: string): boolean {
  const chave = chaveDaSessao(url);
  if (!chave) return false;
  try { return !!globalThis.localStorage?.getItem(chave); } catch { return false; }
}

let leitorUnico: { url: string; leitor: LeitorDeProgresso } | null = null;

/**
 * O leitor real, sobre o cliente único. `null` quando esta publicação não tem identidade.
 *
 * É SEMPRE O MESMO objeto por configuração: quem o recebe usa-o como dependência de efeito, e um
 * leitor novo a cada render reiniciaria a leitura a cada render.
 */
export function leitorDeProgressoConfigurado(): LeitorDeProgresso | null {
  const r = identidadeConfigurada();
  if (!r.configurado) return null;
  if (leitorUnico?.url === r.url) return leitorUnico.leitor;
  const leitor = criarLeitorDeProgresso(async () => {
    const c = await clienteCompartilhado(r);
    if (!c) return null;
    return {
      // `*` DE PROPÓSITO: num banco sem a migração da sequência, pedir as colunas novas pelo nome
      // derrubaria a leitura inteira — e o card de XP junto. Com `*`, banco velho devolve as 5
      // colunas de sempre e a sequência simplesmente não aparece. A ordem do rollout não importa.
      meuProgresso: async () => await c.from("meu_progresso").select("*").maybeSingle<LinhaDoMeuProgresso>(),
      creditoDaPartida: async (partidaId) =>
        await c.from("xp_eventos").select("xp_delta, posicao").eq("partida_id", partidaId).maybeSingle(),
    };
  }, () => sessaoGuardada(r.url));
  leitorUnico = { url: r.url, leitor };
  return leitor;
}
