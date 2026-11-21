// O EXECUTOR — conduz as mesas de bots em fatias, sem congelar a tela.
//
// Uma partida inteira do Bot Normal custa pouco, mas a Copa tem oito mesas na primeira fase, e
// jogá-las de uma vez num toque prenderia a thread principal: a animação de "preparando as mesas"
// travaria e o Android poderia achar que o app parou. Aqui cada MÃO é uma fatia: depois de cada
// uma, o executor devolve a vez ao navegador (`ceder`) e só então continua.
//
// Por que fatias e não Web Worker: o motor já está no bundle principal, a fatia é pequena (uma
// mão = 52 jogadas) e o resultado precisa voltar ao mesmo estado React. Um Worker traria um
// segundo bundle e uma ponte de mensagens para economizar milissegundos. Se um dia a fatia
// crescer, a troca é local: o gerador de `simulacao.ts` roda igual dentro de um Worker.
import { partidaDeBots } from "./simulacao.js";
import { nomesDaMesa, pendentesDeBots, registrarResultado, type Torneio } from "./orquestrador.js";

export type Ceder = () => Promise<void>;

/**
 * Devolve a vez ao navegador. `MessageChannel` em vez de `setTimeout(0)`: o navegador limita
 * `setTimeout` encadeado a ≥ 4 ms, o que somaria segundos à Copa sem motivo; uma mensagem entra
 * na fila de tarefas e deixa pintura e toques passarem na frente do mesmo jeito.
 */
export const cederAoNavegador: Ceder = () =>
  new Promise<void>((ok) => {
    if (typeof MessageChannel === "undefined") { setTimeout(ok, 0); return; }
    const c = new MessageChannel();
    c.port1.onmessage = () => { c.port1.close(); ok(); };
    c.port2.postMessage(null);
  });

export interface OpcoesDoExecutor {
  ceder?: Ceder;
  /** Mãos já jogadas / total de mãos a jogar, para a barra de progresso. */
  aoProgresso?: (feitas: number, total: number) => void;
  /** Chamado a cada MESA confirmada — é onde a tela grava o checkpoint. */
  aoResultado?: (t: Torneio) => void;
  /** A tela saiu: para na próxima fatia e não registra nada parcial. */
  cancelado?: () => boolean;
}

/**
 * Joga todas as mesas de bots pendentes. Devolve o torneio com os resultados, ou `null` se foi
 * cancelado no meio — nesse caso só as mesas COMPLETAS já entregues por `aoResultado` contam;
 * uma mesa interrompida simplesmente é jogada de novo depois, do início (é determinística, então
 * o resultado é o mesmo).
 */
export async function simularPendentes(t0: Torneio, opcoes: OpcoesDoExecutor = {}): Promise<Torneio | null> {
  const ceder = opcoes.ceder ?? cederAoNavegador;
  const mesas = pendentesDeBots(t0);
  const total = mesas.length * 10;
  let feitas = 0;
  let t = t0;
  opcoes.aoProgresso?.(0, total);
  for (const mesa of mesas) {
    const partida = partidaDeBots(nomesDaMesa(t, mesa), mesa.semente);
    for (;;) {
      const r = partida.next();
      if (r.done) {
        t = registrarResultado(t, mesa.id, r.value);
        opcoes.aoResultado?.(t);
        break;
      }
      feitas++;
      opcoes.aoProgresso?.(feitas, total);
      await ceder();
      if (opcoes.cancelado?.()) return null;
    }
  }
  return t;
}
