// OS COSMÉTICOS VISTOS PELO CLIENTE (Entrega B) — catálogo fechado, por categoria, nenhuma decisão.
//
// O que este módulo NÃO faz é o que importa: não decide se um item está liberado para o servidor,
// não escreve na tabela e não informa nível a ninguém. Equipar é UM pedido ao banco
// (`equipar_cosmetico`, ou `equipar_toalha` para a mesa), que confere o nível lá dentro e recusa se
// não alcançar. A moldura, a reação e a mesa que os outros veem vêm do SERVIDOR DO JOGO, que lê o
// banco por conta própria.
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

// ───────────────────────── as categorias ─────────────────────────
//
// PREPARADO PARA CRESCER, SEM CRESCER AGORA. Uma categoria nova (avatares, por exemplo) é: uma
// entrada em `Categoria`, uma linha em `CATEGORIAS` e os itens dela no `CATALOGO` — mais a coluna e a
// porta no banco, com o nível conferido lá. A vitrine, a celebração e o contador da Home já leem
// tudo daqui, por categoria. `exclusiva` = um item por vez (a mesa); senão, liga/desliga por item.
//
// Hoje existem só as quatro abaixo. "avatar" está no tipo para marcar o lugar, e NÃO tem item.
export type Categoria = "moldura" | "baralho" | "mesa" | "reacao" | "avatar";

export interface DescricaoDaCategoria {
  id: Categoria;
  nome: string;
  /** Um item por vez (escolher um troca o outro). */
  exclusiva: boolean;
}

/** As categorias com item, NA ORDEM da vitrine. */
export const CATEGORIAS: readonly DescricaoDaCategoria[] = [
  { id: "moldura", nome: "Molduras", exclusiva: false },
  { id: "baralho", nome: "Baralhos", exclusiva: false },
  { id: "mesa", nome: "Mesas", exclusiva: true },
  { id: "reacao", nome: "Reações", exclusiva: false },
];

// ───────────────────────── o catálogo ─────────────────────────

/** As toalhas, com o MESMO id que a sala sincroniza (`tableTheme`) e que o banco guarda. */
export type Toalha = "imperial" | "verde" | "vinho" | "esmeralda";
export const TOALHA_PADRAO: Toalha = "imperial";

export type ItemId =
  | "moldura-real" | "baralho-imperial" | "reacao-coroa"
  | "mesa-imperial" | "mesa-verde" | "mesa-vinho" | "mesa-esmeralda";

export interface ItemDoCatalogo {
  id: ItemId;
  categoria: Categoria;
  /** Nível em que o item libera. Espelho de `king_private.nivel_do_cosmetico` / `nivel_da_toalha`. */
  nivel: number;
  nome: string;
  descricao: string;
  /** Só na categoria `mesa`: a toalha que o item representa. */
  toalha?: Toalha;
}

/**
 * O catálogo FECHADO, na ordem de cada categoria. Nível 1 = livre (as duas mesas de sempre): está
 * na vitrine para ser escolhido, mas não conta como "desbloqueio" nem é celebrado.
 */
export const CATALOGO: readonly ItemDoCatalogo[] = [
  { id: "moldura-real", categoria: "moldura", nivel: 2, nome: "Moldura Real",
    descricao: "Aro de ouro, filete vinho e o selo da coroa no seu avatar. Os quatro da mesa veem." },
  { id: "baralho-imperial", categoria: "baralho", nivel: 4, nome: "Baralho Imperial",
    descricao: "Verso real com brasão da coroa e faces em marfim com filete de ouro. Só no seu aparelho." },
  { id: "mesa-imperial", categoria: "mesa", nivel: 1, toalha: "imperial", nome: "Noite Imperial",
    descricao: "A mesa da casa, em violeta profundo." },
  { id: "mesa-verde", categoria: "mesa", nivel: 1, toalha: "verde", nome: "Verde Clássica",
    descricao: "A mesa clássica de baralho." },
  { id: "mesa-vinho", categoria: "mesa", nivel: 8, toalha: "vinho", nome: "Vinho Clássica",
    descricao: "Vinho escuro com o aro dourado. Na sua sala, os quatro jogam nela." },
  { id: "mesa-esmeralda", categoria: "mesa", nivel: 10, toalha: "esmeralda", nome: "Esmeralda Real",
    descricao: "Esmeralda com filete duplo de ouro. Na sua sala, os quatro jogam nela." },
  { id: "reacao-coroa", categoria: "reacao", nivel: 6, nome: "Reação da Coroa",
    descricao: "“Viva o Rei! 👑” entre as mensagens rápidas. Uma por mão." },
];

/** O item de uma toalha. */
export const itemDaToalha = (t: Toalha): ItemDoCatalogo => CATALOGO.find((i) => i.toalha === t)!;
export const ehToalha = (t: unknown): t is Toalha =>
  typeof t === "string" && CATALOGO.some((i) => i.toalha === t);

/**
 * O que está equipado: por item. Na mesa, exatamente UM item é `true` (a toalha escolhida). Assim
 * a vitrine pergunta a mesma coisa a qualquer categoria.
 */
export type Equipados = Record<ItemId, boolean>;
export const NADA_EQUIPADO: Equipados = Object.freeze({
  "moldura-real": false, "baralho-imperial": false, "reacao-coroa": false,
  "mesa-imperial": true, "mesa-verde": false, "mesa-vinho": false, "mesa-esmeralda": false,
});

/** A toalha escolhida, lida dos equipados. */
export const toalhaEquipada = (e: Equipados): Toalha =>
  CATALOGO.find((i) => i.toalha && e[i.id])?.toalha ?? TOALHA_PADRAO;

export type EstadoDoItem = "bloqueado" | "desbloqueado" | "equipado";

export function estadoDoItem(item: ItemDoCatalogo, nivel: number, equipados: Equipados): EstadoDoItem {
  if (nivel < item.nivel) return "bloqueado";
  return equipados[item.id] ? "equipado" : "desbloqueado";
}

/** O que conta como DESBLOQUEIO: os itens de nível (os livres não). */
export const DESBLOQUEAVEIS: readonly ItemDoCatalogo[] = CATALOGO.filter((i) => i.nivel > 1);

/** Desbloqueios alcançados neste nível, na ordem do catálogo. */
export const liberadosNo = (nivel: number): ItemDoCatalogo[] => DESBLOQUEAVEIS.filter((i) => nivel >= i.nivel);

/** O próximo desbloqueio acima deste nível — o que a vitrine aponta como "o próximo". */
export const proximoDesbloqueio = (nivel: number): ItemDoCatalogo | null =>
  [...DESBLOQUEAVEIS].sort((a, b) => a.nivel - b.nivel).find((i) => i.nivel > nivel) ?? null;

// ───────────────────────── o nível conhecido NESTE aparelho ─────────────────────────
//
// A sala online precisa saber, só para DESENHAR o cadeado, quais mesas o anfitrião liberou. O nível
// é o último lido de `meu_progresso` nesta sessão do app (memória, nunca disco). Quem decide é o
// servidor, que pergunta ao banco; isto é apresentação. Sem leitura, só as livres aparecem abertas.
let nivelConhecido: number | null = null;
export function lembrarNivel(n: number | null): void { nivelConhecido = n; }
export function nivelLembrado(): number | null { return nivelConhecido; }

// ───────────────────────── leitura e escrita no banco ─────────────────────────

/** A linha de `cosmeticos_equipados` (ou do retorno de `equipar_cosmetico`). */
export interface LinhaDosCosmeticos {
  moldura_real?: unknown;
  baralho_imperial?: unknown;
  reacao_coroa?: unknown;
  toalha?: unknown;
}

type Resposta<T> = Promise<{ data: T | null; error: unknown }>;

export interface PortaDeCosmeticos {
  meus(): Resposta<LinhaDosCosmeticos>;
  equipar(item: ItemId, equipado: boolean): Resposta<LinhaDosCosmeticos[]>;
  equiparToalha(toalha: Toalha): Resposta<Array<{ toalha?: unknown }>>;
}

const comToalha = (e: Omit<Equipados, `mesa-${Toalha}`>, t: Toalha): Equipados => ({
  ...e,
  "mesa-imperial": t === "imperial", "mesa-verde": t === "verde", "mesa-vinho": t === "vinho", "mesa-esmeralda": t === "esmeralda",
});

/** A linha só passa se vier INTEIRA e bem formada; senão, é como se a vitrine não existisse. */
function lerLinha(l: LinhaDosCosmeticos | null | undefined): Equipados | null {
  if (!l) return null;
  const { moldura_real: m, baralho_imperial: b, reacao_coroa: c, toalha: t } = l;
  if (typeof m !== "boolean" || typeof b !== "boolean" || typeof c !== "boolean" || !ehToalha(t)) return null;
  return comToalha({ "moldura-real": m, "baralho-imperial": b, "reacao-coroa": c }, t);
}

export type ResultadoDoEquipar =
  | { ok: true; equipados: Equipados }
  | { ok: false; motivo: "nivel" | "falha" };

/** 42501 é o banco dizendo "nível insuficiente" (ou sem identidade): não é falha de rede. */
const motivoDoErro = (error: unknown): "nivel" | "falha" =>
  (error as { code?: string })?.code === "42501" ? "nivel" : "falha";

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

    /**
     * Equipa ou desequipa. Quem confere o nível é o banco; aqui só se lê a resposta. Na MESA,
     * "equipar" escolhe a toalha e "desequipar" volta para a padrão; `atual` é o que já estava, para
     * as outras categorias ficarem como estão.
     */
    async equipar(item: ItemId, equipado: boolean, atual: Equipados = NADA_EQUIPADO): Promise<ResultadoDoEquipar> {
      const doCatalogo = CATALOGO.find((i) => i.id === item);
      if (!doCatalogo || !temSessao()) return { ok: false, motivo: "falha" };
      try {
        const p = await porta();
        if (!p) return { ok: false, motivo: "falha" };
        if (doCatalogo.toalha) {
          const pedida = equipado ? doCatalogo.toalha : TOALHA_PADRAO;
          const { data, error } = await p.equiparToalha(pedida);
          if (error) return { ok: false, motivo: motivoDoErro(error) };
          const t = Array.isArray(data) ? data[0]?.toalha : undefined;
          return ehToalha(t) ? { ok: true, equipados: comToalha(atual, t) } : { ok: false, motivo: "falha" };
        }
        const { data, error } = await p.equipar(item, equipado);
        if (error) return { ok: false, motivo: motivoDoErro(error) };
        const linha = Array.isArray(data) ? data[0] : null;
        // `equipar_cosmetico` devolve só as três colunas dela: a toalha é a que já estava.
        const e = lerLinha(linha ? { ...linha, toalha: toalhaEquipada(atual) } : null);
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
        .select("moldura_real, baralho_imperial, reacao_coroa, toalha").maybeSingle<LinhaDosCosmeticos>(),
      equipar: async (item, equipado) => await c.rpc("equipar_cosmetico", { p_item: item, p_equipado: equipado }),
      equiparToalha: async (toalha) => await c.rpc("equipar_toalha", { p_toalha: toalha }),
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

// ───────────────────────── a mesa CONTRA OS BOTS ─────────────────────────
//
// No online a mesa é da SALA (o anfitrião escolhe, o servidor confere). Contra os bots não há sala:
// vale a toalha equipada na vitrine, guardada aqui pelo mesmo motivo do baralho. Adulterar a chave
// muda a cor da própria mesa e nada mais.

const CHAVE_DA_MESA = "king:mesa";

export function mesaGuardada(): Toalha {
  try {
    const t = globalThis.localStorage?.getItem(CHAVE_DA_MESA);
    return ehToalha(t) ? t : TOALHA_PADRAO;
  } catch { return TOALHA_PADRAO; }
}

export function guardarMesa(t: Toalha): void {
  try {
    if (t === TOALHA_PADRAO) globalThis.localStorage?.removeItem(CHAVE_DA_MESA);
    else globalThis.localStorage?.setItem(CHAVE_DA_MESA, t);
  } catch { /* sem armazenamento: vale até fechar */ }
}

// ───────────────────────── "NOVO ITEM DESBLOQUEADO!" — uma vez por item ─────────────────────────
//
// A celebração acontece quando o nível alcança um item que ainda não foi celebrado NESTA conta,
// neste aparelho. Guardado por conta, para uma troca de conta no mesmo aparelho não herdar o que a
// outra já viu. Voltar à Home, reconectar ou reabrir o app NÃO repete. Os itens livres nunca são
// celebrados: não foram desbloqueados, sempre estiveram ali.

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
