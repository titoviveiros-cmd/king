// OS COSMÉTICOS VISTOS PELO CLIENTE (Entregas B e C) — catálogo fechado, por categoria, nenhuma decisão.
//
// O que este módulo NÃO faz é o que importa: não decide se um item está liberado para o servidor,
// não escreve na tabela e não informa nível a ninguém. Equipar é UM pedido ao banco
// (`equipar_item`), que confere o nível lá dentro e recusa se não alcançar. A moldura, as reações e
// a mesa que os outros veem vêm do SERVIDOR DO JOGO, que lê o banco por conta própria.
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
// PREPARADO PARA CRESCER. Uma categoria nova (avatares, por exemplo) é: uma entrada em `Categoria`,
// uma linha em `CATEGORIAS` e os itens dela no `CATALOGO` — mais a coluna e a porta no banco, com o
// nível conferido lá. A vitrine, a celebração e o contador da Home já leem tudo daqui.
//
// Hoje existem as quatro abaixo. "avatar" está no tipo para marcar o lugar, e NÃO tem item.
export type Categoria = "moldura" | "baralho" | "mesa" | "reacao" | "avatar";

export interface DescricaoDaCategoria {
  id: Categoria;
  nome: string;
  /**
   * SEMPRE UM item (a mesa): escolher outro troca, e não existe "nenhum". As outras categorias têm
   * botão de equipar/desequipar por item — e o BANCO garante que moldura e baralho são um por vez.
   */
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
export const TOALHAS = ["imperial", "verde", "vinho", "azul", "esmeralda", "preta"] as const;
export type Toalha = (typeof TOALHAS)[number];
export const TOALHA_PADRAO: Toalha = "imperial";

/** As molduras (o texto de `cosmeticos_equipados.moldura` e de `assento.estiloMoldura`). */
export const MOLDURAS = ["real", "rubi", "onix", "diamante", "esmeralda"] as const;
export type EstiloDeMoldura = (typeof MOLDURAS)[number];

/** Os baralhos (o texto de `cosmeticos_equipados.baralho` e de `html[data-baralho]`). */
export const BARALHOS = ["imperial", "safira", "ouro-negro", "rubi", "marfim"] as const;
export type EstiloDeBaralho = (typeof BARALHOS)[number];

/** As reações, na ordem do painel. As duas primeiras são LIVRES; as outras, de nível. */
export const REACOES = ["risada", "choro", "fogo", "coroa", "caveira", "aplauso"] as const;
export type Reacao = (typeof REACOES)[number];
export const REACOES_LIVRES: readonly Reacao[] = ["risada", "choro"];

export type ItemId =
  | `moldura-${EstiloDeMoldura}` | `baralho-${EstiloDeBaralho}` | `mesa-${Toalha}` | `reacao-${Reacao}`;

export interface ItemDoCatalogo {
  id: ItemId;
  categoria: Categoria;
  /** Nível em que o item libera. Espelho de `king_private.nivel_do_item` / `nivel_da_toalha`. */
  nivel: number;
  nome: string;
  descricao: string;
  /** O estilo/toalha/reação que o item representa (o texto depois da categoria no id). */
  valor: string;
  /** Só na categoria `mesa`: a toalha que o item representa. */
  toalha?: Toalha;
}

const item = (categoria: Exclude<Categoria, "avatar">, valor: string, nivel: number, nome: string, descricao: string): ItemDoCatalogo => ({
  id: `${categoria}-${valor}` as ItemId, categoria, nivel, nome, descricao, valor,
  ...(categoria === "mesa" ? { toalha: valor as Toalha } : {}),
});

/**
 * O catálogo FECHADO, na ordem de cada categoria (do nível menor para o maior). Nível 1 = livre (as
 * duas mesas de sempre e as reações Risada e Choro): está na vitrine, mas não conta como
 * "desbloqueio" nem é celebrado.
 */
export const CATALOGO: readonly ItemDoCatalogo[] = [
  item("moldura", "real", 2, "Moldura Real", "Aro de ouro, filete vinho e o selo da coroa no seu avatar. Os quatro da mesa veem."),
  item("moldura", "rubi", 7, "Moldura Rubi Real", "Ouro cravejado de rubis e a coroa com gema vermelha. Os quatro da mesa veem."),
  item("moldura", "onix", 11, "Moldura Ônix Imperial", "Ônix negro polido com veios de ouro e a coroa imperial. Os quatro da mesa veem."),
  item("moldura", "diamante", 15, "Moldura Diamante do Rei", "Diamante lapidado, com um brilho que gira, e a coroa do Rei. Os quatro da mesa veem."),
  item("moldura", "esmeralda", 16, "Moldura Esmeralda Suprema", "Esmeralda e ouro em aro duplo, com brilho vivo. A mais rara. Os quatro da mesa veem."),
  item("baralho", "imperial", 4, "Baralho Imperial", "Verso real com brasão da coroa e faces em marfim com filete de ouro. Só no seu aparelho."),
  item("baralho", "safira", 9, "Baralho Safira Noturna", "Verso azul-noite estrelado com aro de prata. Só no seu aparelho."),
  item("baralho", "ouro-negro", 13, "Baralho Ouro Negro", "Verso negro com arte em ouro e faces douradas. Só no seu aparelho."),
  item("baralho", "rubi", 17, "Baralho Imperial Rubi", "Verso rubi com treliça de ouro e brasão. Só no seu aparelho."),
  item("baralho", "marfim", 18, "Baralho Marfim Real", "Verso marfim com filigrana de ouro e selo vinho. Só no seu aparelho."),
  item("mesa", "imperial", 1, "Noite Imperial", "A mesa da casa, em violeta profundo."),
  item("mesa", "verde", 1, "Verde Clássica", "A mesa clássica de baralho."),
  item("mesa", "vinho", 3, "Vinho Imperial", "Vinho escuro com o aro dourado. Na sua sala, os quatro jogam nela."),
  item("mesa", "azul", 8, "Azul Royal", "Azul real profundo com filete de ouro. Na sua sala, os quatro jogam nela."),
  item("mesa", "esmeralda", 10, "Esmeralda Real", "Esmeralda com filete duplo de ouro. Na sua sala, os quatro jogam nela."),
  item("mesa", "preta", 12, "Preta Premium", "Preto acetinado com aro de ouro. Na sua sala, os quatro jogam nela."),
  item("reacao", "risada", 1, "Risada", "😂 no balão grande. De todo mundo. Uma por mão."),
  item("reacao", "choro", 1, "Choro", "😭 no balão grande. De todo mundo. Uma por mão."),
  item("reacao", "fogo", 5, "Fogo", "🔥 “Pegou fogo!” no balão grande. Uma por mão."),
  item("reacao", "coroa", 6, "Coroa", "“Viva o Rei! 👑” no balão de ouro. Uma por mão."),
  item("reacao", "caveira", 10, "Caveira / Azar", "💀 “Que azar!” no balão grande. Uma por mão."),
  item("reacao", "aplauso", 14, "Aplauso", "👏 “Aplausos!” no balão grande. Uma por mão."),
];

/** O item de uma toalha. */
export const itemDaToalha = (t: Toalha): ItemDoCatalogo => CATALOGO.find((i) => i.toalha === t)!;
export const ehToalha = (t: unknown): t is Toalha => typeof t === "string" && (TOALHAS as readonly string[]).includes(t);
export const ehMoldura = (m: unknown): m is EstiloDeMoldura => typeof m === "string" && (MOLDURAS as readonly string[]).includes(m);
export const ehBaralho = (b: unknown): b is EstiloDeBaralho => typeof b === "string" && (BARALHOS as readonly string[]).includes(b);
export const ehReacao = (r: unknown): r is Reacao => typeof r === "string" && (REACOES as readonly string[]).includes(r);
const nivelDe = (id: ItemId): number => CATALOGO.find((i) => i.id === id)?.nivel ?? Infinity;

/**
 * O que está equipado: por item. Na mesa, exatamente UM item é `true`; em moldura e baralho, no
 * máximo um; nas reações, as livres sempre `true` e as de nível conforme o banco. Assim a vitrine
 * pergunta a mesma coisa a qualquer categoria.
 */
export type Equipados = Record<ItemId, boolean>;
export const NADA_EQUIPADO: Equipados = Object.freeze(Object.fromEntries(
  CATALOGO.map((i) => [i.id, i.id === `mesa-${TOALHA_PADRAO}` || (i.categoria === "reacao" && i.nivel <= 1)]),
) as Equipados);

/** A toalha escolhida, lida dos equipados. */
export const toalhaEquipada = (e: Equipados): Toalha =>
  CATALOGO.find((i) => i.toalha && e[i.id])?.toalha ?? TOALHA_PADRAO;
/** O baralho escolhido, ou `null`. */
export const baralhoEquipado = (e: Equipados): EstiloDeBaralho | null =>
  (CATALOGO.find((i) => i.categoria === "baralho" && e[i.id])?.valor as EstiloDeBaralho | undefined) ?? null;

export type EstadoDoItem = "bloqueado" | "desbloqueado" | "equipado";

export function estadoDoItem(item: ItemDoCatalogo, nivel: number, equipados: Equipados): EstadoDoItem {
  if (nivel < item.nivel) return "bloqueado";
  return equipados[item.id] ? "equipado" : "desbloqueado";
}

/** O que conta como DESBLOQUEIO: os itens de nível (os livres não), do nível menor para o maior. */
export const DESBLOQUEAVEIS: readonly ItemDoCatalogo[] = [...CATALOGO.filter((i) => i.nivel > 1)].sort((a, b) => a.nivel - b.nivel);

/** Desbloqueios alcançados neste nível, na ordem da curva. */
export const liberadosNo = (nivel: number): ItemDoCatalogo[] => DESBLOQUEAVEIS.filter((i) => nivel >= i.nivel);

/** O próximo desbloqueio acima deste nível — o que a vitrine aponta como "o próximo". */
export const proximoDesbloqueio = (nivel: number): ItemDoCatalogo | null => DESBLOQUEAVEIS.find((i) => i.nivel > nivel) ?? null;

// ───────────────────────── o nível conhecido NESTE aparelho ─────────────────────────
//
// A sala online precisa saber, só para DESENHAR o cadeado, quais mesas o anfitrião liberou. O nível
// é o último lido de `meu_progresso` nesta sessão do app (memória, nunca disco). Quem decide é o
// servidor, que pergunta ao banco; isto é apresentação. Sem leitura, só as livres aparecem abertas.
let nivelConhecido: number | null = null;
export function lembrarNivel(n: number | null): void { nivelConhecido = n; }
export function nivelLembrado(): number | null { return nivelConhecido; }

// ───────────────────────── leitura e escrita no banco ─────────────────────────

/** A linha de `cosmeticos_equipados` (ou do retorno de `equipar_item`). */
export interface LinhaDosCosmeticos {
  moldura?: unknown;
  baralho?: unknown;
  reacoes?: unknown;
  toalha?: unknown;
}

type Resposta<T> = Promise<{ data: T | null; error: unknown }>;

export interface PortaDeCosmeticos {
  meus(): Resposta<LinhaDosCosmeticos>;
  equipar(item: ItemId, equipado: boolean): Resposta<LinhaDosCosmeticos[]>;
}

/** A linha só passa se vier INTEIRA e bem formada; senão, é como se a vitrine não existisse. */
function lerLinha(l: LinhaDosCosmeticos | null | undefined): Equipados | null {
  if (!l) return null;
  const { moldura: m, baralho: b, reacoes: r, toalha: t } = l;
  if ((m !== null && !ehMoldura(m)) || (b !== null && !ehBaralho(b)) || !ehToalha(t)) return null;
  if (!Array.isArray(r) || !r.every((x) => ehReacao(x) && !REACOES_LIVRES.includes(x))) return null;
  const e = { ...NADA_EQUIPADO } as Equipados;
  for (const i of CATALOGO) {
    e[i.id] = i.categoria === "moldura" ? i.valor === m
      : i.categoria === "baralho" ? i.valor === b
      : i.categoria === "mesa" ? i.valor === t
      : i.nivel <= 1 || (r as string[]).includes(i.valor);
  }
  return e;
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
     * Equipa ou desequipa. Quem confere o nível — e quem garante "uma moldura por vez" — é o banco;
     * aqui só se lê a linha INTEIRA que ele devolve. Nas reações livres não há o que pedir: são de
     * todo mundo, sempre.
     */
    async equipar(item: ItemId, equipado: boolean): Promise<ResultadoDoEquipar> {
      const doCatalogo = CATALOGO.find((i) => i.id === item);
      if (!doCatalogo || !temSessao()) return { ok: false, motivo: "falha" };
      if (doCatalogo.categoria === "reacao" && doCatalogo.nivel <= 1) return { ok: false, motivo: "falha" };
      try {
        const p = await porta();
        if (!p) return { ok: false, motivo: "falha" };
        const { data, error } = await p.equipar(item, equipado);
        if (error) return { ok: false, motivo: motivoDoErro(error) };
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
        .select("moldura, baralho, reacoes, toalha").maybeSingle<LinhaDosCosmeticos>(),
      equipar: async (item, equipado) => await c.rpc("equipar_item", { p_item: item, p_equipado: equipado }),
    };
  }, () => sessaoGuardada(r.url));
  unico = { url: r.url, api };
  return api;
}

// ───────────────────────── o BARALHO, no aparelho ─────────────────────────
//
// É o único item que não passa pela sala: cada aparelho desenha as PRÓPRIAS cartas. A escolha vem
// do banco (a mesma em todos os aparelhos da conta) e fica guardada aqui só para valer também numa
// partida contra os bots, que não abre conexão nenhuma. Quem adulterar esta chave muda o desenho
// das cartas da própria tela e nada mais: não ganha nada e ninguém vê.

const CHAVE_DO_BARALHO = "king:baralho";

/** O baralho guardado neste aparelho (o "imperial" da Entrega B continua valendo), ou `null`. */
export function baralhoGuardado(): EstiloDeBaralho | null {
  try {
    const b = globalThis.localStorage?.getItem(CHAVE_DO_BARALHO);
    return ehBaralho(b) ? b : null;
  } catch { return null; }
}

/** Troca o baralho deste aparelho. Só CSS: faces, valores, cores e alvos ficam iguais. */
export function aplicarBaralho(estilo: EstiloDeBaralho | null, guardar = true): void {
  try {
    const raiz = globalThis.document?.documentElement;
    if (raiz) {
      if (estilo) raiz.dataset.baralho = estilo;
      else delete raiz.dataset.baralho;
    }
  } catch { /* sem DOM (teste de render): nada a desenhar */ }
  if (!guardar) return;
  try {
    if (estilo) globalThis.localStorage?.setItem(CHAVE_DO_BARALHO, estilo);
    else globalThis.localStorage?.removeItem(CHAVE_DO_BARALHO);
  } catch { /* sem armazenamento: vale até fechar */ }
}

/** O baralho que vale neste aparelho: o equipado, se o nível alcança. */
export function baralhoQueVale(e: Equipados, nivel: number): EstiloDeBaralho | null {
  const b = baralhoEquipado(e);
  return b && nivel >= nivelDe(`baralho-${b}`) ? b : null;
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
