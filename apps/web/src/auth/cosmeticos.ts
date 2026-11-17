// OS COSMÉTICOS VISTOS PELO CLIENTE (Entrega B) — três itens, nenhuma decisão.
//
// O que este módulo NÃO faz é o que importa: não decide se um item está liberado para o servidor,
// não escreve na tabela e não informa nível a ninguém. Equipar é UM pedido ao banco
// (`equipar_cosmetico`), que confere o nível lá dentro e recusa se não alcançar. A moldura e a
// reação que os outros veem vêm do SERVIDOR DO JOGO, que lê o banco por conta própria.
//
// O nível usado aqui para desenhar "bloqueado/desbloqueado" é o de `meu_progresso` — o MESMO número
// que o banco usa para recusar. A tabela de níveis abaixo existe só para desenhar a vitrine; um
// cliente que a adulterasse veria um botão habilitado e levaria uma recusa do banco.
//
// FALHA NUNCA ATRAPALHA: sem sessão, sem a migração aplicada, banco fora ou resposta estranha, a
// vitrine some (`null`) e o jogo é o de sempre.
import { clienteCompartilhado } from "./clienteSupabase.js";
import { identidadeConfigurada } from "./identidade.js";
import { chaveDaSessao } from "./progresso.js";
import { marcadorDeSessao } from "./sessaoNativa.js";

export type ItemId = "moldura-real" | "baralho-imperial" | "reacao-coroa";

export interface ItemDoCatalogo {
  id: ItemId;
  /** Nível em que o item libera. Espelho de `king_private.nivel_do_cosmetico`. */
  nivel: number;
  nome: string;
  descricao: string;
}

/** O catálogo FECHADO. Três itens, nesta ordem, e nenhum outro. */
export const CATALOGO: readonly ItemDoCatalogo[] = [
  { id: "moldura-real", nivel: 2, nome: "Moldura Real", descricao: "Ouro e vinho em volta do seu avatar. Os quatro da mesa veem." },
  { id: "baralho-imperial", nivel: 4, nome: "Baralho Imperial", descricao: "Acabamento imperial nas suas cartas. Só no seu aparelho." },
  { id: "reacao-coroa", nivel: 6, nome: "Reação da Coroa", descricao: "“Viva o Rei! 👑” entre as mensagens rápidas. Uma por mão." },
];

export type Equipados = Record<ItemId, boolean>;
export const NADA_EQUIPADO: Equipados = Object.freeze({ "moldura-real": false, "baralho-imperial": false, "reacao-coroa": false });

export type EstadoDoItem = "bloqueado" | "desbloqueado" | "equipado";

export function estadoDoItem(item: ItemDoCatalogo, nivel: number, equipados: Equipados): EstadoDoItem {
  if (nivel < item.nivel) return "bloqueado";
  return equipados[item.id] ? "equipado" : "desbloqueado";
}

/** Itens liberados neste nível, na ordem do catálogo. */
export const liberadosNo = (nivel: number): ItemDoCatalogo[] => CATALOGO.filter((i) => nivel >= i.nivel);

// ───────────────────────── leitura e escrita no banco ─────────────────────────

/** A linha de `cosmeticos_equipados` (ou do retorno de `equipar_cosmetico`). */
export interface LinhaDosCosmeticos {
  moldura_real?: unknown;
  baralho_imperial?: unknown;
  reacao_coroa?: unknown;
}

type Resposta<T> = Promise<{ data: T | null; error: unknown }>;

export interface PortaDeCosmeticos {
  meus(): Resposta<LinhaDosCosmeticos>;
  equipar(item: ItemId, equipado: boolean): Resposta<LinhaDosCosmeticos[]>;
}

/** A linha só passa se vier INTEIRA e booleana; senão, é como se a vitrine não existisse. */
function lerLinha(l: LinhaDosCosmeticos | null | undefined): Equipados | null {
  if (!l) return null;
  const { moldura_real: m, baralho_imperial: b, reacao_coroa: c } = l;
  if (typeof m !== "boolean" || typeof b !== "boolean" || typeof c !== "boolean") return null;
  return { "moldura-real": m, "baralho-imperial": b, "reacao-coroa": c };
}

export type ResultadoDoEquipar =
  | { ok: true; equipados: Equipados }
  | { ok: false; motivo: "nivel" | "falha" };

export function criarCosmeticos(porta: () => Promise<PortaDeCosmeticos | null>, temSessao: () => boolean = () => true) {
  return {
    /** O que está equipado. Sem linha ainda = nada equipado. `null` = vitrine indisponível. */
    async meus(): Promise<Equipados | null> {
      if (!temSessao()) return null;
      try {
        const p = await porta();
        if (!p) return null;
        const { data, error } = await p.meus();
        if (error) return null;
        if (data === null) return { ...NADA_EQUIPADO };
        return lerLinha(data);
      } catch {
        return null;
      }
    },

    /** Equipa ou desequipa. Quem confere o nível é o banco; aqui só se lê a resposta. */
    async equipar(item: ItemId, equipado: boolean): Promise<ResultadoDoEquipar> {
      if (!CATALOGO.some((i) => i.id === item) || !temSessao()) return { ok: false, motivo: "falha" };
      try {
        const p = await porta();
        if (!p) return { ok: false, motivo: "falha" };
        const { data, error } = await p.equipar(item, equipado);
        if (error) {
          // 42501 é o banco dizendo "nível insuficiente" (ou sem identidade): não é falha de rede.
          return { ok: false, motivo: (error as { code?: string })?.code === "42501" ? "nivel" : "falha" };
        }
        const e = lerLinha(Array.isArray(data) ? data[0] : null);
        return e ? { ok: true, equipados: e } : { ok: false, motivo: "falha" };
      } catch {
        return { ok: false, motivo: "falha" };
      }
    },
  };
}

export type CosmeticosDoJogador = ReturnType<typeof criarCosmeticos>;

function sessaoGuardada(url: string): boolean {
  const chave = chaveDaSessao(url);
  if (!chave) return false;
  let local: Storage | null = null;
  try { local = globalThis.localStorage ?? null; } catch { return false; }
  try { return !!local?.getItem(chave) || marcadorDeSessao(local); } catch { return false; }
}

let unico: { url: string; api: CosmeticosDoJogador } | null = null;

/** A porta real, sobre o MESMO cliente Supabase da identidade. `null` sem identidade configurada. */
export function cosmeticosConfigurados(): CosmeticosDoJogador | null {
  const r = identidadeConfigurada();
  if (!r.configurado) return null;
  if (unico?.url === r.url) return unico.api;
  const api = criarCosmeticos(async () => {
    const c = await clienteCompartilhado(r);
    if (!c) return null;
    return {
      meus: async () => await c.from("cosmeticos_equipados")
        .select("moldura_real, baralho_imperial, reacao_coroa").maybeSingle<LinhaDosCosmeticos>(),
      equipar: async (item, equipado) => await c.rpc("equipar_cosmetico", { p_item: item, p_equipado: equipado }),
    };
  }, () => sessaoGuardada(r.url));
  unico = { url: r.url, api };
  return api;
}

// ───────────────────────── o Baralho Imperial, no aparelho ─────────────────────────
//
// É o único item que não passa pela sala: cada aparelho desenha as PRÓPRIAS cartas. A escolha vem
// do banco (a mesma em todos os aparelhos da conta) e fica guardada aqui só para valer também numa
// partida contra os bots, que não abre conexão nenhuma. Quem adulterar esta chave muda o desenho
// das cartas da própria tela e nada mais: não ganha nada e ninguém vê.

const CHAVE_DO_BARALHO = "king:baralho";

export function baralhoGuardado(): boolean {
  try { return globalThis.localStorage?.getItem(CHAVE_DO_BARALHO) === "imperial"; } catch { return false; }
}

/** Liga ou desliga o Baralho Imperial neste aparelho. Só CSS: faces, valores e alvos ficam iguais. */
export function aplicarBaralho(imperial: boolean, guardar = true): void {
  try {
    const raiz = globalThis.document?.documentElement;
    if (raiz) {
      if (imperial) raiz.dataset.baralho = "imperial";
      else delete raiz.dataset.baralho;
    }
  } catch { /* sem DOM (teste de render): nada a desenhar */ }
  if (!guardar) return;
  try {
    if (imperial) globalThis.localStorage?.setItem(CHAVE_DO_BARALHO, "imperial");
    else globalThis.localStorage?.removeItem(CHAVE_DO_BARALHO);
  } catch { /* sem armazenamento: vale até fechar */ }
}

// ───────────────────────── "NOVO ITEM DESBLOQUEADO!" — uma vez por item ─────────────────────────
//
// A celebração acontece quando o nível alcança um item que ainda não foi celebrado NESTA conta,
// neste aparelho. Guardado por conta, para uma troca de conta no mesmo aparelho não herdar o que a
// outra já viu. Voltar à Home, reconectar ou reabrir o app NÃO repete.

const CHAVE_DAS_CELEBRACOES = "king:cosmeticos:celebrados";

function lerCelebrados(): Record<string, string[]> {
  try {
    const bruto = JSON.parse(globalThis.localStorage?.getItem(CHAVE_DAS_CELEBRACOES) ?? "{}") as unknown;
    return bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto as Record<string, string[]> : {};
  } catch {
    return {};
  }
}

/** Os itens liberados que esta conta ainda não celebrou neste aparelho. */
export function paraCelebrar(nivel: number, conta: string): ItemDoCatalogo[] {
  const vistos = lerCelebrados()[conta];
  const ja = new Set(Array.isArray(vistos) ? vistos : []);
  return liberadosNo(nivel).filter((i) => !ja.has(i.id));
}

export function marcarCelebrados(conta: string, itens: readonly ItemId[]): void {
  try {
    const todos = lerCelebrados();
    const atuais = Array.isArray(todos[conta]) ? todos[conta] : [];
    todos[conta] = [...new Set([...atuais, ...itens])];
    globalThis.localStorage?.setItem(CHAVE_DAS_CELEBRACOES, JSON.stringify(todos));
  } catch { /* sem armazenamento: a celebração pode voltar uma vez, e só */ }
}
