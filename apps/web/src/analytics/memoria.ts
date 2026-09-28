// A MEMÓRIA LOCAL DO ANALYTICS — só neste aparelho, nunca enviada.
//
// O que ela guarda existe para o analytics NÃO mentir, e não para identificar ninguém:
//
//   • `abriu`            → a próxima abertura já não é a primeira (`first_open`);
//   • `primeiroToque`    → a origem da PRIMEIRA abertura, para recortar tudo depois por ela;
//   • `primeiraPartida`  → `first_match_started` já saiu uma vez nesta instalação;
//   • `trafegoDeTeste`   → este navegador foi marcado como de teste (`?trafego=teste`);
//   • `inicios` / `fins` → partidas online já anunciadas. Um reload no meio (ou no fim) da partida
//                          remonta a Mesa e o Placar; sem isto, a mesma partida contaria duas vezes.
//
// Nenhum desses campos viaja em evento. O id da partida fica AQUI, no aparelho, só para comparar.
//
// Armazenamento indisponível (aba anônima estrita, WebView sem storage, cota estourada) nunca
// derruba nada: a memória cai para um objeto que vive enquanto a página viver. O efeito é medir
// um pouco a mais — um `first_open` repetido — e nunca deixar de jogar.
import type { Toque } from "./aquisicao.js";

export interface MemoriaDoAnalytics {
  abriu?: boolean;
  primeiroToque?: Toque;
  primeiraPartida?: boolean;
  trafegoDeTeste?: boolean;
  inicios?: string[];
  fins?: string[];
}

export interface ArmazenamentoSimples {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
}

export const CHAVE_DA_MEMORIA = "king.analytics";
/** Quantas partidas lembrar por lista. Um reload volta à partida corrente, não a vinte atrás. */
const LEMBRADAS = 20;

export interface Memoria {
  ler(): MemoriaDoAnalytics;
  atualizar(mudar: (m: MemoriaDoAnalytics) => MemoriaDoAnalytics): MemoriaDoAnalytics;
  /**
   * Marca a partida na lista e diz se ela é NOVA. Quem chama só anuncia quando é: a mesma partida
   * nunca é anunciada duas vezes neste aparelho.
   */
  marcarPartida(lista: "inicios" | "fins", id: string): boolean;
}

export function criarMemoria(armazenamento: () => ArmazenamentoSimples | null): Memoria {
  let reserva: MemoriaDoAnalytics = {};

  const ler = (): MemoriaDoAnalytics => {
    try {
      const bruto = armazenamento()?.getItem(CHAVE_DA_MEMORIA);
      if (!bruto) return { ...reserva };
      const lido = JSON.parse(bruto) as unknown;
      return lido && typeof lido === "object" ? { ...reserva, ...(lido as MemoriaDoAnalytics) } : { ...reserva };
    } catch {
      return { ...reserva };
    }
  };

  const gravar = (m: MemoriaDoAnalytics): void => {
    reserva = m;
    try { armazenamento()?.setItem(CHAVE_DA_MEMORIA, JSON.stringify(m)); } catch { /* fica na reserva */ }
  };

  return {
    ler,
    atualizar(mudar) {
      const nova = mudar(ler());
      gravar(nova);
      return nova;
    },
    marcarPartida(lista, id) {
      const atual = ler();
      const vistas = Array.isArray(atual[lista]) ? atual[lista]! : [];
      if (vistas.includes(id)) return false;
      gravar({ ...atual, [lista]: [...vistas, id].slice(-LEMBRADAS) });
      return true;
    },
  };
}

/** A memória do navegador. `localStorage` é lido a cada acesso: pode sumir no meio da sessão. */
export const memoria = criarMemoria(() => {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
});
