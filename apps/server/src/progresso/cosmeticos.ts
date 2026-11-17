// OS COSMÉTICOS DA SALA (Entrega B) — o que a mesa mostra, decidido pelo BANCO.
//
// Dois dos três itens aparecem para os outros jogadores: a Moldura Real e a Reação da Coroa. O
// Baralho Imperial é só do aparelho de quem equipou, e por isso nem passa por aqui.
//
// ══ QUEM DECIDE ══
//
// O cliente NUNCA diz "estou de moldura". Ao sentar uma identidade PERMANENTE (JWT verificado), a
// sala pergunta ao banco — `king_private.cosmeticos_da_sala`, EXECUTE só do `king_server` — e o
// banco devolve o EFEITO: equipado E com nível. Identidade sorteada (sem conta) não tem o que ler.
//
// ══ NUNCA ATRAPALHA A PARTIDA ══
//
//   • a leitura é DEPOIS de sentar, assíncrona: a entrada nunca espera o banco;
//   • tem prazo (`PRAZO_MS`); estourou, a mesa segue sem cosmético;
//   • fora de `closed` o banco não é tocado — é o mesmo disjuntor do crédito, e martelar um pooler
//     que recusou a credencial é o que o bloqueia;
//   • sem arquivo de progresso (local, CI, e2e), a fonte é a DESLIGADA e nada é lido.
//
// NENHUM log daqui carrega id inteiro, token ou dado da conexão.
import { mascarar, UUID } from "./tipos.js";

export interface CosmeticosDoAssento {
  moldura: boolean;
  coroa: boolean;
}

export const SEM_COSMETICOS: CosmeticosDoAssento = Object.freeze({ moldura: false, coroa: false });

/** O que a sala conhece: um verbo, que NUNCA lança. */
export interface FonteDeCosmeticos {
  doJogador(playerId: string): Promise<CosmeticosDoAssento>;
}

export const COSMETICOS_DESLIGADOS: FonteDeCosmeticos = { doJogador: async () => SEM_COSMETICOS };

let atual: FonteDeCosmeticos = COSMETICOS_DESLIGADOS;
export function cosmeticosEmUso(): FonteDeCosmeticos { return atual; }
export function configurarCosmeticos(f: FonteDeCosmeticos): void { atual = f; }
export function restaurarCosmeticos(): void { atual = COSMETICOS_DESLIGADOS; }

export const PRAZO_MS = 3_000;

export const CHAMADA_DOS_COSMETICOS =
  "select player_id, moldura_real, reacao_coroa from king_private.cosmeticos_da_sala($1::uuid[])";

export interface LinhaDeCosmeticos {
  player_id: string;
  moldura_real: boolean;
  reacao_coroa: boolean;
}

export interface OpcoesDaFonte {
  /** A consulta de verdade (o pool do progresso). */
  consultar(ids: string[]): Promise<LinhaDeCosmeticos[]>;
  /** O disjuntor do progresso está fechado? Fora de `closed`, o banco não é tocado. */
  pronto(): boolean;
  prazoMs?: number;
  log?: (m: string) => void;
}

/** A fonte real. Qualquer falha — erro, prazo, forma estranha — vira "sem cosméticos". */
export function fonteDeCosmeticosPg(o: OpcoesDaFonte): FonteDeCosmeticos {
  const prazo = o.prazoMs ?? PRAZO_MS;
  const log = o.log ?? ((m: string) => console.log(m));
  return {
    async doJogador(playerId) {
      if (!UUID.test(playerId) || !o.pronto()) return SEM_COSMETICOS;
      let relogio: ReturnType<typeof setTimeout> | undefined;
      try {
        const linhas = await Promise.race([
          o.consultar([playerId]),
          new Promise<never>((_, falha) => { relogio = setTimeout(() => falha(new Error("prazo")), prazo); }),
        ]);
        const l = Array.isArray(linhas) ? linhas.find((x) => x?.player_id === playerId) : undefined;
        if (!l) return SEM_COSMETICOS;
        return { moldura: l.moldura_real === true, coroa: l.reacao_coroa === true };
      } catch (e) {
        // Só o CÓDIGO: a mensagem de erro de rede pode carregar o host do banco.
        const motivo = (e as Error)?.message === "prazo" ? "prazo" : ((e as { code?: string })?.code ?? (e as Error)?.name ?? "erro");
        log(`[cosmeticos] leitura falhou para ${mascarar(playerId)}: ${motivo}`);
        return SEM_COSMETICOS;
      } finally {
        if (relogio) clearTimeout(relogio);
      }
    },
  };
}
