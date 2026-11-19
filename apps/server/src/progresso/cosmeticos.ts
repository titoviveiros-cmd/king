// OS COSMÉTICOS DA SALA (Entregas B e C) — o que a mesa mostra, decidido pelo BANCO.
//
// Aparecem para os outros jogadores: a MOLDURA escolhida (uma de cinco) e as REAÇÕES de nível ligadas
// (fogo, coroa, caveira, aplauso). O baralho é só do aparelho de quem equipou, e por isso nem passa
// por aqui; a mesa é a do anfitrião (`mesaDoJogador`).
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

/** As molduras do catálogo (o MESMO texto que o banco guarda em `cosmeticos_equipados.moldura`). */
export const MOLDURAS = ["real", "rubi", "onix", "diamante", "esmeralda"] as const;
/** As reações que exigem nível (as livres — risada e choro — não passam pelo banco). */
export const REACOES_DE_NIVEL = ["fogo", "coroa", "caveira", "aplauso"] as const;

export interface CosmeticosDoAssento {
  /** A moldura EFETIVA, ou `""` para nenhuma. */
  moldura: string;
  /** As reações de nível EFETIVAS, na ordem do catálogo. */
  reacoes: readonly string[];
}

export const SEM_COSMETICOS: CosmeticosDoAssento = Object.freeze({ moldura: "", reacoes: Object.freeze([]) });

/**
 * A MESA DO ANFITRIÃO (a toalha como cosmético): a toalha que ele equipou — já EFETIVA, decidida pelo
 * banco — e as toalhas que ele liberou. Nunca XP nem nível.
 */
export interface MesaDoJogador {
  toalha: string;
  liberadas: readonly string[];
}

/** O que a sala conhece: verbos que NUNCA lançam. */
export interface FonteDeCosmeticos {
  doJogador(playerId: string): Promise<CosmeticosDoAssento>;
  /** `null` = não deu para saber (sem banco, prazo, forma estranha): a sala fica nas mesas livres. */
  mesaDoJogador?(playerId: string): Promise<MesaDoJogador | null>;
}

export const COSMETICOS_DESLIGADOS: FonteDeCosmeticos = { doJogador: async () => SEM_COSMETICOS };

let atual: FonteDeCosmeticos = COSMETICOS_DESLIGADOS;
export function cosmeticosEmUso(): FonteDeCosmeticos { return atual; }
export function configurarCosmeticos(f: FonteDeCosmeticos): void { atual = f; }
export function restaurarCosmeticos(): void { atual = COSMETICOS_DESLIGADOS; }

export const PRAZO_MS = 3_000;

export const CHAMADA_DOS_COSMETICOS =
  "select player_id, moldura, reacoes from king_private.cosmeticos_dos_assentos($1::uuid[])";

export interface LinhaDeCosmeticos {
  player_id: string;
  moldura: unknown;
  reacoes: unknown;
}

/** Só passa o que é do catálogo: uma moldura estranha vira "nenhuma", uma reação estranha some. */
function lerAssento(l: LinhaDeCosmeticos): CosmeticosDoAssento {
  const moldura = typeof l.moldura === "string" && (MOLDURAS as readonly string[]).includes(l.moldura) ? l.moldura : "";
  const reacoes = Array.isArray(l.reacoes)
    ? REACOES_DE_NIVEL.filter((r) => (l.reacoes as unknown[]).includes(r))
    : [];
  return { moldura, reacoes };
}

export interface OpcoesDaFonte {
  /** A consulta de verdade (o pool do progresso). */
  consultar(ids: string[]): Promise<LinhaDeCosmeticos[]>;
  /** O disjuntor do progresso está fechado? Fora de `closed`, o banco não é tocado. */
  pronto(): boolean;
  /** A mesa do anfitrião (parte 2). Sem ela, a fonte não sabe de toalha nenhuma. */
  consultarMesa?(playerId: string): Promise<LinhaDaMesa[]>;
  prazoMs?: number;
  log?: (m: string) => void;
}

export const CHAMADA_DA_MESA = "select toalha, liberadas from king_private.toalhas_do_anfitriao($1::uuid)";

export interface LinhaDaMesa {
  toalha: unknown;
  liberadas: unknown;
}

/** A toalha só passa se for do catálogo, e as liberadas só se forem TODAS do catálogo. */
function lerMesa(l: LinhaDaMesa | undefined, catalogo: readonly string[]): MesaDoJogador | null {
  if (!l || typeof l.toalha !== "string" || !catalogo.includes(l.toalha)) return null;
  if (!Array.isArray(l.liberadas) || !l.liberadas.every((t) => typeof t === "string" && catalogo.includes(t))) return null;
  return { toalha: l.toalha, liberadas: l.liberadas as string[] };
}

/** A fonte real. Qualquer falha — erro, prazo, forma estranha — vira "sem cosméticos". */
export function fonteDeCosmeticosPg(o: OpcoesDaFonte, catalogoDasMesas: readonly string[] = []): FonteDeCosmeticos {
  const prazo = o.prazoMs ?? PRAZO_MS;
  const log = o.log ?? ((m: string) => console.log(m));
  /** A consulta com prazo; `null` em qualquer falha, com o CÓDIGO no log e nada mais. */
  async function comPrazo<T>(playerId: string, consulta: () => Promise<T>): Promise<T | null> {
    let relogio: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        consulta(),
        new Promise<never>((_, falha) => { relogio = setTimeout(() => falha(new Error("prazo")), prazo); }),
      ]);
    } catch (e) {
      // Só o CÓDIGO: a mensagem de erro de rede pode carregar o host do banco.
      const motivo = (e as Error)?.message === "prazo" ? "prazo" : ((e as { code?: string })?.code ?? (e as Error)?.name ?? "erro");
      log(`[cosmeticos] leitura falhou para ${mascarar(playerId)}: ${motivo}`);
      return null;
    } finally {
      if (relogio) clearTimeout(relogio);
    }
  }
  return {
    async doJogador(playerId) {
      if (!UUID.test(playerId) || !o.pronto()) return SEM_COSMETICOS;
      const linhas = await comPrazo(playerId, () => o.consultar([playerId]));
      const l = Array.isArray(linhas) ? linhas.find((x) => x?.player_id === playerId) : undefined;
      if (!l) return SEM_COSMETICOS;
      return lerAssento(l);
    },
    async mesaDoJogador(playerId) {
      const consultar = o.consultarMesa;
      if (!consultar || !UUID.test(playerId) || !o.pronto()) return null;
      const linhas = await comPrazo(playerId, () => consultar(playerId));
      return lerMesa(Array.isArray(linhas) ? linhas[0] : undefined, catalogoDasMesas);
    },
  };
}
