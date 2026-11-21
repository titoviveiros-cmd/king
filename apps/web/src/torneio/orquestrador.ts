// O ORQUESTRADOR DO TORNEIO — puro, determinístico e sem tela.
//
// Ele sabe quem senta com quem, quais mesas faltam, quem avançou e quem foi campeão. Não sabe
// jogar: as partidas são do motor (mesas de bots, `simulacao.ts`) ou da Mesa solo de sempre
// (a do humano). O orquestrador só recebe os FATOS de cada partida terminada e classifica.
//
// Fica isolado do multiplayer de propósito: não importa rede, servidor, Supabase nem React. Tudo
// aqui é função de entrada → saída, e o estado é imutável — cada registro devolve um torneio novo.
// É isso que deixa testar a chave inteira em milissegundos, e o que faz o registro ser idempotente:
// registrar duas vezes a mesma mesa devolve o MESMO objeto, sem resultado duplicado.
import { HAND_CONTRACTS, TOTAL_HANDS } from "@king/engine";
import type { Avatar } from "../ui/avatares.js";
import {
  CLASSIFICADOS_POR_MESA, ASSENTOS_POR_MESA, FORMATOS, mesasNaFase, ultimaFase, type FormatoId,
} from "./formatos.js";
import { sortearParticipantes, mesasIniciais, type Participante } from "./participantes.js";
import { classificar, type Classificacao, type FatosDaMesa } from "./desempate.js";
import { derivar, USO } from "./sementes.js";

/** O id do humano no torneio. Fixo: é o que a persistência e a Mesa usam para achá-lo. */
export const ID_DO_HUMANO = 0;

export interface ResultadoDaMesa {
  fatos: FatosDaMesa;
  classificacao: Classificacao;
}

export interface MesaDoTorneio {
  /** `f{fase}m{indice}` — estável, é a chave do resultado no armazenamento. */
  id: string;
  fase: number;
  indice: number;
  /** Ids por assento (0..3). Se o humano está na mesa, ele está no assento 0. */
  assentos: number[];
  semente: number;
  /** `null` até a partida terminar. Uma vez preenchido, nunca muda. */
  resultado: ResultadoDaMesa | null;
}

export interface Torneio {
  formato: FormatoId;
  semente: number;
  avatar: Avatar;
  /**
   * Torneio de QA (semente ou mão inicial vindas da URL). Fica marcado e visível. Torneio nenhum
   * concede XP ou recorde — este flag existe para a tela dizer "teste" e para nada mais.
   */
  qa: boolean;
  /** Por qual mão a partida do HUMANO começa. 1 fora de QA. As mesas de bots jogam sempre as 10. */
  maoInicial: number;
  participantes: Participante[];
  mesas: MesaDoTorneio[];
}

export const idDaMesa = (fase: number, indice: number): string => `f${fase}m${indice}`;

/**
 * Gira os assentos até o humano ficar no 0, preservando a ordem relativa.
 *
 * A Mesa solo desenha o jogador local embaixo, no assento 0, e o `KingGame` local nasce assim.
 * Girar (e não trocar dois de lugar) mantém a vizinhança decidida pela chave.
 */
function humanoNoAssento0(ids: number[]): number[] {
  const i = ids.indexOf(ID_DO_HUMANO);
  return i <= 0 ? ids : [...ids.slice(i), ...ids.slice(0, i)];
}

function novaMesa(t: Pick<Torneio, "semente">, fase: number, indice: number, ids: number[]): MesaDoTorneio {
  return {
    id: idDaMesa(fase, indice),
    fase,
    indice,
    assentos: humanoNoAssento0(ids),
    semente: derivar(t.semente, USO.mesa, fase, indice),
    resultado: null,
  };
}

export interface OpcoesDoTorneio {
  qa?: boolean;
  maoInicial?: number;
}

export function criarTorneio(formato: FormatoId, semente: number, avatar: Avatar, opcoes: OpcoesDoTorneio = {}): Torneio {
  const f = FORMATOS[formato];
  const s = semente >>> 0;
  const { participantes, ordem } = sortearParticipantes(f, s, avatar);
  const maoInicial = Number.isInteger(opcoes.maoInicial) && opcoes.maoInicial! >= 1 && opcoes.maoInicial! <= TOTAL_HANDS
    ? opcoes.maoInicial!
    : 1;
  const base = { semente: s };
  return {
    formato,
    semente: s,
    avatar,
    qa: opcoes.qa === true || maoInicial !== 1,
    maoInicial,
    participantes,
    mesas: mesasIniciais(ordem).map((ids, i) => novaMesa(base, 0, i, ids)),
  };
}

// ───────────────────────────── leitura ─────────────────────────────

export const faseAtual = (t: Torneio): number => t.mesas.reduce((f, m) => Math.max(f, m.fase), 0);
export const mesasDaFase = (t: Torneio, fase: number): MesaDoTorneio[] =>
  t.mesas.filter((m) => m.fase === fase).sort((a, b) => a.indice - b.indice);
export const temHumano = (m: MesaDoTorneio): boolean => m.assentos.includes(ID_DO_HUMANO);
export const mesaPorId = (t: Torneio, id: string): MesaDoTorneio | undefined => t.mesas.find((m) => m.id === id);
export const participante = (t: Torneio, id: number): Participante => t.participantes[id];
/** Os nomes por assento, do jeito que o motor pede. */
export const nomesDaMesa = (t: Torneio, m: MesaDoTorneio): string[] => m.assentos.map((id) => t.participantes[id].nome);

/** As mesas do caminho do humano, da primeira fase até onde ele chegou. */
export const caminhoDoHumano = (t: Torneio): MesaDoTorneio[] =>
  t.mesas.filter(temHumano).sort((a, b) => a.fase - b.fase);

/** Classificou-se? (1º ou 2º da mesa) — só para mesa com resultado. */
export const classificou = (m: MesaDoTorneio, id: number): boolean =>
  !!m.resultado && m.resultado.classificacao.ordem.indexOf(id) >= 0
  && m.resultado.classificacao.ordem.indexOf(id) < CLASSIFICADOS_POR_MESA;

/** A fase em que o humano caiu, ou `null` se ele segue vivo (ou é campeão). */
export function faseDaEliminacao(t: Torneio): number | null {
  for (const m of caminhoDoHumano(t)) if (m.resultado && !classificou(m, ID_DO_HUMANO)) return m.fase;
  return null;
}

/** O campeão — o 1º da mesa final, depois do desempate. `null` enquanto a final não acabou. */
export function campeao(t: Torneio): number | null {
  const final = mesasDaFase(t, ultimaFase(FORMATOS[t.formato]))[0];
  return final?.resultado ? final.resultado.classificacao.ordem[0] : null;
}

/** Mesas sem o humano que ainda não foram jogadas — o que o executor tem a simular. */
export const pendentesDeBots = (t: Torneio): MesaDoTorneio[] =>
  t.mesas.filter((m) => !m.resultado && !temHumano(m));

export type Situacao =
  | { tipo: "simular"; mesas: MesaDoTorneio[] }
  | { tipo: "jogar"; mesa: MesaDoTorneio }
  | { tipo: "avancar"; proximaFase: number }
  | { tipo: "encerrado"; campeao: number };

/**
 * O que falta acontecer agora. A ordem é a da experiência: as mesas de bots da fase são jogadas
 * primeiro (rápido, sem tela), depois a do humano, e só então a fase seguinte é montada.
 */
export function situacao(t: Torneio): Situacao {
  const c = campeao(t);
  if (c !== null) return { tipo: "encerrado", campeao: c };
  const pendentes = pendentesDeBots(t);
  if (pendentes.length) return { tipo: "simular", mesas: pendentes };
  const minha = mesasDaFase(t, faseAtual(t)).find((m) => temHumano(m) && !m.resultado);
  if (minha) return { tipo: "jogar", mesa: minha };
  return { tipo: "avancar", proximaFase: faseAtual(t) + 1 };
}

// ───────────────────────────── escrita ─────────────────────────────

/** As mãos jogadas por uma partida que começou em `maoInicial`. */
const maosJogadas = (maoInicial: number): number[] =>
  Array.from({ length: TOTAL_HANDS - maoInicial + 1 }, (_, i) => maoInicial + i);

/**
 * Os fatos fecham com as regras oficiais? Não é paranoia: é o que barra um save adulterado (ou
 * um defeito futuro) de virar "vitória". A conta usa os totais de mão do PRÓPRIO motor:
 *   • a soma das pontuações é a soma dos totais das mãos jogadas (−1300 + 1300 = 0 na partida
 *     inteira — os checksums oficiais);
 *   • a soma das negativas é a soma das mãos negativas jogadas;
 *   • o que cada um fez nas positivas (total − negativas) é ≥ 0 e múltiplo de 25 (uma vaza);
 *   • ilesas fica entre 0 e o número de negativas jogadas.
 */
export function fatosValidos(f: unknown, maoInicial: number): f is FatosDaMesa {
  if (!f || typeof f !== "object") return false;
  const o = f as Record<string, unknown>;
  const lista = (v: unknown): v is number[] =>
    Array.isArray(v) && v.length === ASSENTOS_POR_MESA && v.every((x) => Number.isSafeInteger(x));
  if (!lista(o.pontos) || !lista(o.negativas) || !lista(o.ilesas)) return false;
  const maos = maosJogadas(maoInicial);
  const negJogadas = maos.filter((h) => !HAND_CONTRACTS[h].isPositive);
  const somaTotal = maos.reduce((s, h) => s + HAND_CONTRACTS[h].handTotal, 0);
  const somaNeg = negJogadas.reduce((s, h) => s + HAND_CONTRACTS[h].handTotal, 0);
  const soma = (v: number[]) => v.reduce((s, x) => s + x, 0);
  if (soma(o.pontos) !== somaTotal || soma(o.negativas) !== somaNeg) return false;
  for (let i = 0; i < ASSENTOS_POR_MESA; i++) {
    const pos = o.pontos[i] - o.negativas[i];
    if (o.negativas[i] > 0 || pos < 0 || pos % 25 !== 0) return false;
    if (o.ilesas[i] < 0 || o.ilesas[i] > negJogadas.length) return false;
  }
  return true;
}

/**
 * Registra o resultado de uma mesa. IDEMPOTENTE: uma mesa que já tem resultado devolve o mesmo
 * torneio, intocado — é o que impede a mesma partida de contar duas vezes (um clique repetido,
 * um efeito que roda de novo, um reload no meio do registro).
 *
 * Lança para mesa desconhecida ou fatos que não fecham: os dois são defeito, e engolir em
 * silêncio seria aceitar um resultado que não aconteceu.
 */
export function registrarResultado(t: Torneio, mesaId: string, fatos: FatosDaMesa): Torneio {
  const m = mesaPorId(t, mesaId);
  if (!m) throw new Error(`Mesa desconhecida no torneio: ${mesaId}`);
  if (m.resultado) return t;
  const maoInicial = temHumano(m) ? t.maoInicial : 1;
  if (!fatosValidos(fatos, maoInicial)) throw new Error(`Fatos inválidos para a mesa ${mesaId}`);
  const copia: FatosDaMesa = { pontos: fatos.pontos.slice(), negativas: fatos.negativas.slice(), ilesas: fatos.ilesas.slice() };
  const resultado: ResultadoDaMesa = { fatos: copia, classificacao: classificar(m.assentos, copia, m.semente) };
  return { ...t, mesas: t.mesas.map((x) => (x.id === mesaId ? { ...x, resultado } : x)) };
}

/**
 * Monta a fase seguinte, se a atual acabou. A mesa k junta os dois classificados das mesas 2k e
 * 2k+1, CRUZADOS: [1º de A, 2º de B, 1º de B, 2º de A] — os dois primeiros de cada lado não
 * sentam lado a lado, e a ordem não depende de nada além da chave. Sem fase a montar, devolve o
 * mesmo torneio (idempotente, como o registro).
 */
export function avancarFase(t: Torneio): Torneio {
  const f = faseAtual(t);
  const formato = FORMATOS[t.formato];
  if (f >= ultimaFase(formato)) return t;
  const atuais = mesasDaFase(t, f);
  if (atuais.some((m) => !m.resultado)) return t;
  const novas: MesaDoTorneio[] = [];
  for (let k = 0; k < mesasNaFase(formato, f + 1); k++) {
    const a = atuais[2 * k].resultado!.classificacao.ordem;
    const b = atuais[2 * k + 1].resultado!.classificacao.ordem;
    novas.push(novaMesa(t, f + 1, k, [a[0], b[1], b[0], a[1]]));
  }
  return { ...t, mesas: [...t.mesas, ...novas] };
}
