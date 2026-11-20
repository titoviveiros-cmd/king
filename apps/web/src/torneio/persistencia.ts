// PERSISTÊNCIA DO TORNEIO — guarda o mínimo e REFAZ o resto para conferir.
//
// O que vai para o `localStorage` (esquema versionado, poucas centenas de bytes):
//   formato, semente, avatar do humano, flag de QA, mão inicial de QA,
//   os FATOS de cada mesa já confirmada (pontos, negativas, ilesas — por assento)
//   e qual mesa do humano estava em andamento, se alguma.
//
// O que NÃO vai: participantes, chave, sementes das mesas, classificações. Tudo isso é derivado
// da semente e dos fatos — e por isso a leitura não CONFIA no que leu: ela recria o torneio do
// zero e reaplica os resultados um a um, fase por fase, pelas mesmas funções que o jogo usa. Um
// resultado que não fecha com as regras, uma mesa que não existe na chave refeita, um formato
// desconhecido ou um JSON quebrado tornam o save INTEIRO inválido — e ele é descartado com aviso,
// nunca "consertado" pela metade. Meio torneio adivinhado é pior que nenhum.
//
// Nada sensível: nenhum apelido digitado, nenhum id de conta, nenhuma data. O avatar é uma das
// oito etiquetas públicas.
//
// Toda leitura e escrita está em try/catch: aba anônima, cota cheia e armazenamento ausente são
// reais, e nenhuma delas pode impedir alguém de jogar. Sem armazenamento, perde-se só a retomada.
import { AVATARES, type Avatar } from "../ui/avatares.js";
import { ehFormato, type FormatoId } from "./formatos.js";
import type { FatosDaMesa } from "./desempate.js";
import {
  criarTorneio, avancarFase, campeao, registrarResultado, mesaPorId, mesasDaFase, faseAtual, temHumano,
  type Torneio,
} from "./orquestrador.js";

export const CHAVE_DO_TORNEIO = "king:torneio";
export const VERSAO_DO_ESQUEMA = 1;

/** O formato gravado. Mudou a forma? Sobe a versão — um save antigo nunca é lido como novo. */
export interface TorneioSalvo {
  v: typeof VERSAO_DO_ESQUEMA;
  formato: FormatoId;
  semente: number;
  avatar: Avatar;
  qa: boolean;
  maoInicial: number;
  resultados: Record<string, FatosDaMesa>;
  /** A mesa do humano que estava em andamento quando o save foi feito. Nunca um resultado. */
  emPartida: string | null;
}

export interface Restaurado {
  torneio: Torneio;
  /** Havia uma partida do humano em andamento: ela recomeça do início, com a semente original. */
  partidaReiniciada: string | null;
}

export type Leitura =
  | { tipo: "vazio" }
  | { tipo: "ok"; restaurado: Restaurado }
  | { tipo: "corrompido" };

export function paraSalvar(t: Torneio, emPartida: string | null): TorneioSalvo {
  const resultados: Record<string, FatosDaMesa> = {};
  for (const m of t.mesas) if (m.resultado) resultados[m.id] = m.resultado.fatos;
  const mesa = emPartida ? mesaPorId(t, emPartida) : undefined;
  return {
    v: VERSAO_DO_ESQUEMA,
    formato: t.formato,
    semente: t.semente,
    avatar: t.avatar,
    qa: t.qa,
    maoInicial: t.maoInicial,
    resultados,
    emPartida: mesa && temHumano(mesa) && !mesa.resultado ? mesa.id : null,
  };
}

/**
 * Recria o torneio a partir do que foi salvo. `null` = o save não é íntegro.
 *
 * O laço reaplica os resultados FASE POR FASE: registra os da fase atual que estão no save,
 * monta a próxima, e repete. Se sobrar resultado que não coube em mesa nenhuma, o save mentia
 * sobre a chave — inválido.
 */
export function restaurar(bruto: unknown): Restaurado | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  if (o.v !== VERSAO_DO_ESQUEMA || !ehFormato(o.formato)) return null;
  if (typeof o.semente !== "number" || !Number.isInteger(o.semente) || o.semente < 0 || o.semente > 0xffffffff) return null;
  if (typeof o.avatar !== "string" || !(AVATARES as readonly string[]).includes(o.avatar)) return null;
  if (typeof o.qa !== "boolean" || typeof o.maoInicial !== "number") return null;
  if (!o.resultados || typeof o.resultados !== "object" || Array.isArray(o.resultados)) return null;
  if (o.emPartida !== null && typeof o.emPartida !== "string") return null;

  try {
    let t = criarTorneio(o.formato, o.semente, o.avatar as Avatar, { qa: o.qa, maoInicial: o.maoInicial });
    if (t.maoInicial !== o.maoInicial || t.qa !== o.qa) return null;
    const resultados = o.resultados as Record<string, unknown>;
    const pendentes = new Set(Object.keys(resultados));
    for (;;) {
      const f = faseAtual(t);
      for (const m of mesasDaFase(t, f)) {
        if (!pendentes.has(m.id)) continue;
        // `registrarResultado` lança para fatos que não fecham com as regras: o catch abaixo
        // transforma isso em save inválido.
        t = registrarResultado(t, m.id, resultados[m.id] as FatosDaMesa);
        pendentes.delete(m.id);
      }
      const seguinte = avancarFase(t);
      if (seguinte === t) break;
      t = seguinte;
    }
    if (pendentes.size > 0) return null;
    const emPartida = typeof o.emPartida === "string" ? mesaPorId(t, o.emPartida) : undefined;
    if (o.emPartida !== null && (!emPartida || !temHumano(emPartida) || emPartida.resultado)) return null;
    return { torneio: t, partidaReiniciada: emPartida ? emPartida.id : null };
  } catch {
    return null;
  }
}

/** Onde o torneio é lido e gravado. Interface estreita: os testes passam um armazenamento falso. */
export interface Armazenamento {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function armazenamentoPadrao(): Armazenamento | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // acessar o `localStorage` pode LANÇAR (Safari com cookies bloqueados)
  }
}

export function lerTorneio(arm: Armazenamento | null = armazenamentoPadrao()): Leitura {
  try {
    const bruto = arm?.getItem(CHAVE_DO_TORNEIO);
    if (!bruto) return { tipo: "vazio" };
    const r = restaurar(JSON.parse(bruto));
    return r ? { tipo: "ok", restaurado: r } : { tipo: "corrompido" };
  } catch {
    return { tipo: "corrompido" };
  }
}

/** Grava. Devolve `false` se não deu — a partida segue; perde-se só a retomada. */
export function gravarTorneio(t: Torneio, emPartida: string | null, arm: Armazenamento | null = armazenamentoPadrao()): boolean {
  try {
    if (!arm) return false;
    arm.setItem(CHAVE_DO_TORNEIO, JSON.stringify(paraSalvar(t, emPartida)));
    return true;
  } catch {
    return false;
  }
}

export function apagarTorneio(arm: Armazenamento | null = armazenamentoPadrao()): void {
  try { arm?.removeItem(CHAVE_DO_TORNEIO); } catch { /* sem armazenamento: nada a apagar */ }
}

/**
 * A Home pergunta só isto: existe um torneio para continuar? Um save corrompido responde "não"
 * aqui — o aviso de descarte aparece quando a pessoa abre o torneio, não na Home.
 * Um torneio já ENCERRADO também não se oferece para continuar.
 */
export function haTorneioParaContinuar(arm: Armazenamento | null = armazenamentoPadrao()): boolean {
  const l = lerTorneio(arm);
  if (l.tipo !== "ok") return false;
  return campeao(l.restaurado.torneio) === null;
}
