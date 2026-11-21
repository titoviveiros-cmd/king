// O REPOSITÓRIO — uma chamada por porta, e só duas portas.
//
// O servidor não escreve em tabela nenhuma. Ele chama `king_private.creditar_partida` com o
// RESULTADO, e o banco decide o XP. O papel usado (`king_server`) não tem privilégio de tabela:
// mesmo que este arquivo tentasse um INSERT, o Postgres recusaria. A segunda porta, desde a E-2, é
// `king_private.expurgar_lapides` — com o mesmo desenho: o servidor informa, o banco decide. A
// terceira, desde a Entrega B, só LÊ: `king_private.cosmeticos_da_sala` devolve o efeito dos
// cosméticos (equipado E com nível) de quem sentou — o banco decide, a sala só mostra. A quarta, da
// toalha como cosmético, também só LÊ: `king_private.toalhas_do_anfitriao`.
//
// RECORDES (Entrega D): o crédito ganhou uma companheira na MESMA transação —
// `king_private.registrar_placares`, com a pontuação final de quem participou. O XP nunca depende
// dela: ela roda num SAVEPOINT, e qualquer recusa do banco a ela (migração ainda não aplicada, dado
// fora da regra) desfaz SÓ o placar e o crédito é gravado assim mesmo. Falha de conexão, de
// concorrência ou de autenticação derruba a transação inteira, e o retry de sempre cuida.
//
// PENALIDADE DO REI (Entrega C): resultado com `regra: 2` vai à porta NOVA,
// `king_private.creditar_partida_v2`, que recebe também o fato `capturou_rei`. A porta v1 não muda, e
// é para ela que vai todo resultado SEM o fato (o outbox gravado antes desta entrega). Banco ainda sem a
// v2 responde 42883 (função inexistente): o crédito é repetido na v1, pela regra antiga, e o jogo segue —
// o banco é quem diz qual regra conhece, e grava a versão usada em `partidas.versao_regra`.
import pg from "pg";
import { mascarar, type LancamentoConfirmado, type ResultadoDaPartida } from "./tipos.js";

const lancamento = (l: { player_id: string; posicao: number; xp_delta: number; novo: boolean }): LancamentoConfirmado => ({
  playerId: l.player_id, posicao: l.posicao, xpDelta: l.xp_delta, novo: l.novo,
});
import { CHAMADA_DA_MESA, CHAMADA_DOS_COSMETICOS, type LinhaDaMesa, type LinhaDeCosmeticos } from "./cosmeticos.js";

export interface RepositorioDeProgresso {
  /** UMA consulta trivial (`select 1`): prova conexão, TLS e credencial, sem tocar em dado nenhum. */
  sondar(): Promise<void>;
  creditar(r: ResultadoDaPartida): Promise<LancamentoConfirmado[]>;
  /**
   * O expurgo das lápides (E-2). O servidor manda só o marcador do outbox e quem ainda está em aberto;
   * o PRAZO (720 h) e a decisão são do banco.
   */
  expurgarLapides(marcador: string, protegidas: string[]): Promise<BalancoDasLapides>;
  encerrar(): Promise<void>;
}

export interface BalancoDasLapides {
  removidas: number;
  /** Vencidas que ficaram porque a lista as protegeu. */
  retidas: number;
}

export const CHAMADA_DE_CREDITO =
  "select player_id, posicao, xp_delta, novo from king_private.creditar_partida(" +
  "$1::uuid, $2::timestamptz, $3::timestamptz, $4::smallint, $5::smallint, $6::jsonb)";

export const CHAMADA_DOS_PLACARES = "select king_private.registrar_placares($1::uuid, $2::jsonb) as gravados";

/** Os placares da partida: só de quem participou e tem pontuação. Vazio = nada a gravar. */
export function parametrosDosPlacares(r: ResultadoDaPartida): [string, string] | null {
  const placares = r.humanos.filter((h) => h.participou && h.pontos !== undefined).map((h) => ({ player_id: h.playerId, pontos: h.pontos }));
  return placares.length > 0 ? [r.partidaId, JSON.stringify(placares)] : null;
}

/** Erros que NÃO são do placar em si: a transação inteira volta e o retry de sempre cuida. */
const ESTRUTURAIS = /^(08|28|40|53|57|58|XX)/;

export const CHAMADA_DE_EXPURGO = "select removidas, retidas from king_private.expurgar_lapides($1::uuid, $2::uuid[])";

/**
 * Os parâmetros da chamada. Puro, para o teste conferir o que sai — e, principalmente, o que NÃO
 * sai: cada humano leva exatamente `player_id`, `posicao` e `participou`.
 */
export function parametrosDoCredito(r: ResultadoDaPartida): unknown[] {
  const resultado = r.humanos.map((h) => ({ player_id: h.playerId, posicao: h.posicao, participou: h.participou }));
  return [r.partidaId, r.iniciadaEm, r.terminadaEm, r.humanos.length, r.bots, JSON.stringify(resultado)];
}

export const CHAMADA_DE_CREDITO_V2 =
  "select player_id, posicao, xp_delta, novo from king_private.creditar_partida_v2(" +
  "$1::uuid, $2::timestamptz, $3::timestamptz, $4::smallint, $5::smallint, $6::jsonb)";

/**
 * Os parâmetros da porta v2 — os da v1 mais o FATO `capturou_rei`, e nada além. `null` quando o
 * resultado não é da regra 2 (sem o fato não existe chamada v2: a pendência antiga vai pela v1).
 */
export function parametrosDoCreditoV2(r: ResultadoDaPartida): unknown[] | null {
  if (r.regra !== 2 || r.humanos.some((h) => typeof h.capturouRei !== "boolean")) return null;
  const resultado = r.humanos.map((h) => ({
    player_id: h.playerId, posicao: h.posicao, participou: h.participou, capturou_rei: h.capturouRei,
  }));
  return [r.partidaId, r.iniciadaEm, r.terminadaEm, r.humanos.length, r.bots, JSON.stringify(resultado)];
}

/** 42883 = `undefined_function`: o banco ainda não tem a porta v2 (migração não aplicada, ou desfeita). */
const SEM_A_V2 = "42883";

/**
 * Repositório sobre `pg`. Pool PEQUENA, criada uma vez: um crédito por partida encerrada não
 * justifica mais que duas conexões.
 *
 * A URL vem do arquivo de progresso já validada e SEM parâmetro SSL: o TLS é definido AQUI, com a
 * CA explícita e `rejectUnauthorized: true` — cadeia e nome do host verificados, sem fallback para
 * conexão sem TLS e sem `checkServerIdentity` próprio. Nada aqui monta host ou usuário do Supabase:
 * a string de conexão é a copiada do painel, na fase de operação.
 */
/**
 * O repositório real tem uma TERCEIRA porta, só de leitura: os cosméticos da sala (Entrega B). Ela
 * fica fora de `RepositorioDeProgresso` porque o progresso não precisa dela — quem a usa é a fonte
 * de cosméticos, ligada no boot. Mesmo papel, mesmo pool: nenhuma conexão a mais.
 */
export type RepositorioPg = RepositorioDeProgresso & {
  cosmeticosDaSala(ids: string[]): Promise<LinhaDeCosmeticos[]>;
  mesaDoAnfitriao(id: string): Promise<LinhaDaMesa[]>;
};

export function repositorioPg(origem: { connectionString: string; ca: string } | { pool: pg.Pool }): RepositorioPg {
  const pool = "pool" in origem
    ? origem.pool
    : new pg.Pool({
      connectionString: origem.connectionString,
      ssl: { ca: origem.ca, rejectUnauthorized: true },
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: "king-server-progresso",
    });
  // Erro de conexão ociosa não pode derrubar o servidor do jogo. E não imprime nada da conexão.
  pool.on("error", (e) => console.error(`[progresso] conexão ociosa com erro: ${(e as { code?: string }).code ?? e.name}`));

  /**
   * O crédito pela porta certa. Regra 2 → v2; banco sem a v2 (42883) → a MESMA partida pela v1. Dentro
   * de uma transação, o 42883 aborta a transação: por isso a v2 roda num SAVEPOINT, e só ele é desfeito.
   * Qualquer outro erro da v2 sobe como sempre (o retry e o disjuntor do serviço cuidam) — nunca vira
   * "credita pela v1", que seria trocar de regra por causa de uma falha passageira.
   */
  async function creditarNaPorta(c: pg.Pool | pg.PoolClient, r: ResultadoDaPartida, emTransacao: boolean) {
    const v2 = parametrosDoCreditoV2(r);
    if (v2) {
      if (emTransacao) await c.query("savepoint credito_v2");
      try {
        return (await c.query(CHAMADA_DE_CREDITO_V2, v2)).rows;
      } catch (e) {
        if ((e as { code?: unknown })?.code !== SEM_A_V2) throw e;
        if (emTransacao) await c.query("rollback to savepoint credito_v2");
        console.log(`[progresso] banco sem a regra de XP 2: partida ${mascarar(r.partidaId)} creditada pela regra 1`);
      }
    }
    return (await c.query(CHAMADA_DE_CREDITO, parametrosDoCredito(r))).rows;
  }

  return {
    async sondar() {
      await pool.query("select 1");
    },
    async creditar(r) {
      const placares = parametrosDosPlacares(r);
      // Sem placar: a chamada de sempre, sozinha (o crédito já é uma transação dentro da função).
      if (!placares) {
        return (await creditarNaPorta(pool, r, false)).map(lancamento);
      }
      const c = await pool.connect();
      let ok = false;
      try {
        await c.query("begin");
        const rows = await creditarNaPorta(c, r, true);
        await c.query("savepoint placares");
        try {
          await c.query(CHAMADA_DOS_PLACARES, placares);
        } catch (e) {
          const codigo = (e as { code?: unknown })?.code;
          if (typeof codigo !== "string" || ESTRUTURAIS.test(codigo)) throw e;
          // Recusa do banco ao PLACAR (função ausente, dado fora da regra): o XP segue sem ele.
          await c.query("rollback to savepoint placares");
          console.log(`[progresso] placar da partida ${mascarar(r.partidaId)} não gravado: ${codigo}`);
        }
        await c.query("commit");
        ok = true;
        return rows.map(lancamento);
      } finally {
        if (!ok) await c.query("rollback").catch(() => {});
        c.release(!ok);
      }
    },
    async expurgarLapides(marcador, protegidas) {
      const { rows: [l] } = await pool.query(CHAMADA_DE_EXPURGO, [marcador, protegidas]);
      return { removidas: Number(l.removidas), retidas: Number(l.retidas) };
    },
    async cosmeticosDaSala(ids) {
      const { rows } = await pool.query(CHAMADA_DOS_COSMETICOS, [ids]);
      return rows as LinhaDeCosmeticos[];
    },
    async mesaDoAnfitriao(id) {
      const { rows } = await pool.query(CHAMADA_DA_MESA, [id]);
      return rows as LinhaDaMesa[];
    },
    async encerrar() {
      await pool.end();
    },
  };
}
