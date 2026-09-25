// O REPOSITÓRIO — uma chamada, e só uma.
//
// O servidor não escreve em tabela nenhuma. Ele chama `king_private.creditar_partida` com o
// RESULTADO, e o banco decide o XP. O papel usado (`king_server`) não tem privilégio de tabela:
// mesmo que este arquivo tentasse um INSERT, o Postgres recusaria.
import pg from "pg";
import type { LancamentoConfirmado, ResultadoDaPartida } from "./tipos.js";

export interface RepositorioDeProgresso {
  creditar(r: ResultadoDaPartida): Promise<LancamentoConfirmado[]>;
  encerrar(): Promise<void>;
}

export const CHAMADA_DE_CREDITO =
  "select player_id, posicao, xp_delta, novo from king_private.creditar_partida(" +
  "$1::uuid, $2::timestamptz, $3::timestamptz, $4::smallint, $5::smallint, $6::jsonb)";

/**
 * Os parâmetros da chamada. Puro, para o teste conferir o que sai — e, principalmente, o que NÃO
 * sai: cada humano leva exatamente `player_id`, `posicao` e `participou`.
 */
export function parametrosDoCredito(r: ResultadoDaPartida): unknown[] {
  const resultado = r.humanos.map((h) => ({ player_id: h.playerId, posicao: h.posicao, participou: h.participou }));
  return [r.partidaId, r.iniciadaEm, r.terminadaEm, r.humanos.length, r.bots, JSON.stringify(resultado)];
}

/**
 * Repositório sobre `pg`. Pool PEQUENA, criada uma vez: um crédito por partida encerrada não
 * justifica mais que duas conexões.
 *
 * A URL vem do arquivo de progresso já validada (inclusive `sslmode`). Nada aqui monta host ou
 * usuário do Supabase — a string de conexão é a copiada do painel, na fase de operação.
 */
export function repositorioPg(origem: { connectionString: string } | { pool: pg.Pool }): RepositorioDeProgresso {
  const pool = "pool" in origem
    ? origem.pool
    : new pg.Pool({
      connectionString: origem.connectionString,
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "king-server-progresso",
    });
  // Erro de conexão ociosa não pode derrubar o servidor do jogo. E não imprime nada da conexão.
  pool.on("error", (e) => console.error(`[progresso] conexão ociosa com erro: ${(e as { code?: string }).code ?? e.name}`));

  return {
    async creditar(r) {
      const { rows } = await pool.query(CHAMADA_DE_CREDITO, parametrosDoCredito(r));
      return rows.map((l: { player_id: string; posicao: number; xp_delta: number; novo: boolean }) => ({
        playerId: l.player_id, posicao: l.posicao, xpDelta: l.xp_delta, novo: l.novo,
      }));
    },
    async encerrar() {
      await pool.end();
    },
  };
}
