// O SERVIÇO DE PROGRESSO — da partida encerrada ao crédito confirmado.
//
// Ordem, e ela não muda: (1) resultado → (2) OUTBOX em disco → (3) banco → (4) só então remove a
// pendência. Se o processo morrer em qualquer ponto depois de (2), o boot reprocessa. Se morrer
// DEPOIS do COMMIT e ANTES de (4), o reprocessamento reenvia a mesma partida e o banco devolve o
// que já gravou, sem somar de novo — a idempotência é do banco, não da memória deste processo.
//
// A sala nunca espera o banco. Ela entrega o fim da partida e segue; falha de rede vira pendência,
// nunca erro na mesa.
import type { OutboxDeProgresso } from "./outbox.js";
import type { RepositorioDeProgresso } from "./repositorio.js";
import { resultadoParaCredito, type PartidaEncerrada } from "./resultado.js";
import { mascarar, type ResultadoDaPartida } from "./tipos.js";

/** O que a sala conhece do progresso: um verbo, síncrono, que nunca lança. */
export interface RegistradorDeProgresso {
  partidaEncerrada(p: PartidaEncerrada): void;
}

/** Progresso desligado (sem arquivo, CI, e2e, smoke): o fim da partida não vai a lugar nenhum. */
export const PROGRESSO_DESLIGADO: RegistradorDeProgresso = { partidaEncerrada() {} };

let atual: RegistradorDeProgresso = PROGRESSO_DESLIGADO;
export function progressoEmUso(): RegistradorDeProgresso { return atual; }
export function configurarProgresso(r: RegistradorDeProgresso): void { atual = r; }
export function restaurarProgresso(): void { atual = PROGRESSO_DESLIGADO; }

export interface OpcoesDoServico {
  /** Esperas entre tentativas, em ms. Esgotadas, a pendência fica no outbox até o próximo boot. */
  esperas?: number[];
  log?: (mensagem: string) => void;
  esperar?: (ms: number) => Promise<void>;
}

export interface BalancoDoReprocessamento {
  entregues: number;
  pendentes: number;
  corrompidas: string[];
}

const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const codigo = (e: unknown) => (e as { code?: string })?.code ?? (e as Error)?.name ?? "erro";

export class ServicoDeProgresso implements RegistradorDeProgresso {
  readonly #outbox: OutboxDeProgresso;
  readonly #repositorio: RepositorioDeProgresso;
  readonly #esperas: number[];
  readonly #log: (m: string) => void;
  readonly #esperar: (ms: number) => Promise<void>;
  readonly #emVoo = new Set<Promise<boolean>>();

  constructor(outbox: OutboxDeProgresso, repositorio: RepositorioDeProgresso, opcoes: OpcoesDoServico = {}) {
    this.#outbox = outbox;
    this.#repositorio = repositorio;
    this.#esperas = opcoes.esperas ?? [2_000, 10_000, 30_000];
    this.#log = opcoes.log ?? ((m) => console.log(m));
    this.#esperar = opcoes.esperar ?? dormir;
  }

  partidaEncerrada(p: PartidaEncerrada): void {
    const r = resultadoParaCredito(p);
    if (!r) return; // identidade sorteada ou mesa sem humanos suficientes: não há de quem gravar
    try {
      this.#outbox.gravar(r);
    } catch (e) {
      // Sem outbox, a tentativa ainda vale — perder a durabilidade não é motivo para perder o crédito.
      this.#log(`[progresso] outbox indisponível para a partida ${mascarar(r.partidaId)}: ${codigo(e)}`);
    }
    this.#acompanhar(this.#entregar(r));
  }

  /** Boot: reenvia tudo o que ficou pendente. Idempotente — reenviar o já creditado não soma. */
  async reprocessar(): Promise<BalancoDoReprocessamento> {
    const { validas, corrompidas } = this.#outbox.pendentes();
    for (const nome of corrompidas) this.#log(`[progresso] pendência ilegível mantida no outbox para análise: ${nome}`);
    let entregues = 0;
    for (const r of validas) if (await this.#entregar(r)) entregues += 1;
    return { entregues, pendentes: validas.length - entregues, corrompidas };
  }

  /** Espera as entregas em andamento. Para teste e para desligamento ordenado. */
  async ocioso(): Promise<void> {
    while (this.#emVoo.size) await Promise.allSettled([...this.#emVoo]);
  }

  #acompanhar(p: Promise<boolean>): void {
    this.#emVoo.add(p);
    void p.finally(() => this.#emVoo.delete(p));
  }

  async #entregar(r: ResultadoDaPartida): Promise<boolean> {
    for (let tentativa = 0; tentativa <= this.#esperas.length; tentativa++) {
      try {
        await this.#repositorio.creditar(r);
      } catch (e) {
        this.#log(`[progresso] crédito da partida ${mascarar(r.partidaId)} falhou (tentativa ${tentativa + 1}): ${codigo(e)}`);
        if (tentativa < this.#esperas.length) await this.#esperar(this.#esperas[tentativa]);
        continue;
      }
      // COMMIT confirmado. Se a remoção falhar, o próximo boot reenvia — e o banco devolve o mesmo.
      try {
        this.#outbox.remover(r.partidaId);
      } catch (e) {
        this.#log(`[progresso] partida ${mascarar(r.partidaId)} creditada, pendência não removida: ${codigo(e)}`);
      }
      return true;
    }
    return false;
  }
}
