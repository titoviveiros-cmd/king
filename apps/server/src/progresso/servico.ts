// O SERVIÇO DE PROGRESSO — da partida encerrada ao crédito confirmado, com DISJUNTOR.
//
// Ordem, e ela não muda: (1) resultado → (2) OUTBOX em disco → (3) banco → (4) só então remove a
// pendência. Se o processo morrer depois de (2), o boot reprocessa; se morrer DEPOIS do COMMIT e
// ANTES de (4), o banco devolve o que já gravou, sem somar de novo.
//
// ══ POR QUE UM DISJUNTOR ══
//
// Medido no Supabase real (Fase 4C): falhas de autenticação em série abrem o disjuntor do Supavisor
// para o projeto INTEIRO a partir do nosso IP, por minutos. Um serviço que tentasse de novo a cada
// partida encerrada transformaria uma senha errada numa tempestade — e bloquearia o próprio acesso.
//
// ══ OS ESTADOS ══
//
//   disabled     — progresso desligado nesta publicação (sem arquivo de progresso).
//   probing      — sonda em andamento: a do boot (e a sua única confirmação), ou a sonda única
//                  depois do cooldown.
//   closed       — normal: cada partida encerrada é creditada.
//   open_auth    — o banco recusou a CREDENCIAL (28P01). Parado até o processo reiniciar com a
//                  configuração corrigida. Nenhuma tentativa automática — nenhuma.
//   open_circuit — o pooler abriu o disjuntor dele. Parado por 10 min; depois, EXATAMENTE UMA sonda.
//
// ══ A ÚNICA EXCEÇÃO: 28P01 NA SONDA DO BOOT ══
//
// Medido no Supabase real (Fase 4C.1): logo depois de trocar a senha do papel, o pooler recusa a
// credencial CERTA uma vez — mesmo 120 s depois — e aceita na tentativa seguinte. Esperar não
// resolve; o segredo em cache só se renova depois de uma falha. Por isso, e SÓ na sonda do boot, um
// 28P01 ganha UMA confirmação 30 s depois. Teto: duas falhas de autenticação por boot. Um 28P01 em
// qualquer outro momento (crédito, meia-abertura) vai direto para `open_auth`.
//
// Em qualquer estado diferente de `closed`, a partida encerrada vai para o OUTBOX e o banco não é
// tocado. O jogo não espera nada disto: a sala entrega o fim da partida e segue.
import { classificarFalha, resumoSeguro } from "./falhas.js";
import type { OutboxDeProgresso } from "./outbox.js";
import type { RepositorioDeProgresso } from "./repositorio.js";
import { resultadoParaCredito, type PartidaEncerrada } from "./resultado.js";
import { mascarar, type ResultadoDaPartida } from "./tipos.js";

export type EstadoDoProgresso = "disabled" | "probing" | "closed" | "open_auth" | "open_circuit";

/** O que a sala conhece do progresso: um verbo, síncrono, que nunca lança. */
export interface RegistradorDeProgresso {
  partidaEncerrada(p: PartidaEncerrada): void;
  readonly estado: EstadoDoProgresso;
}

/** Progresso desligado (sem arquivo, CI, e2e, smoke): o fim da partida não vai a lugar nenhum. */
export const PROGRESSO_DESLIGADO: RegistradorDeProgresso = { partidaEncerrada() {}, estado: "disabled" };

let atual: RegistradorDeProgresso = PROGRESSO_DESLIGADO;
export function progressoEmUso(): RegistradorDeProgresso { return atual; }
export function configurarProgresso(r: RegistradorDeProgresso): void { atual = r; }
export function restaurarProgresso(): void { atual = PROGRESSO_DESLIGADO; }

export const COOLDOWN_DO_DISJUNTOR_MS = 10 * 60_000;
/** Entre o 28P01 da sonda do boot e a sua única confirmação. */
export const ESPERA_DA_CONFIRMACAO_MS = 30_000;

export interface OpcoesDoServico {
  /** Esperas entre tentativas de erro TRANSITÓRIO, em ms. Esgotadas, a pendência fica no outbox. */
  esperas?: number[];
  log?: (mensagem: string) => void;
  esperar?: (ms: number) => Promise<void>;
  /** Relógio e agendador injetáveis: os testes não esperam 10 minutos de verdade. */
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => void;
  cooldownMs?: number;
}

export interface BalancoDoReprocessamento {
  entregues: number;
  pendentes: number;
  corrompidas: string[];
}

const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
const agendarDeVerdade = (fn: () => void, ms: number) => { setTimeout(fn, ms).unref?.(); };

export class ServicoDeProgresso implements RegistradorDeProgresso {
  readonly #outbox: OutboxDeProgresso;
  readonly #repositorio: RepositorioDeProgresso;
  readonly #esperas: number[];
  readonly #log: (m: string) => void;
  readonly #esperar: (ms: number) => Promise<void>;
  readonly #agora: () => number;
  readonly #agendar: (fn: () => void, ms: number) => void;
  readonly #cooldownMs: number;
  readonly #emVoo = new Set<Promise<unknown>>();
  #estado: EstadoDoProgresso = "probing";
  #reabreEm = 0;

  constructor(outbox: OutboxDeProgresso, repositorio: RepositorioDeProgresso, opcoes: OpcoesDoServico = {}) {
    this.#outbox = outbox;
    this.#repositorio = repositorio;
    this.#esperas = opcoes.esperas ?? [2_000, 10_000, 30_000];
    this.#log = opcoes.log ?? ((m) => console.log(m));
    this.#esperar = opcoes.esperar ?? dormir;
    this.#agora = opcoes.agora ?? Date.now;
    this.#agendar = opcoes.agendar ?? agendarDeVerdade;
    this.#cooldownMs = opcoes.cooldownMs ?? COOLDOWN_DO_DISJUNTOR_MS;
  }

  get estado(): EstadoDoProgresso { return this.#estado; }

  /**
   * O BOOT: UMA sonda. Passou → `closed` e reprocessa o outbox. 28P01 → UMA confirmação 30 s depois
   * (ver o cabeçalho); recusada de novo → `open_auth`. Disjuntor do pooler → `open_circuit`. Erro
   * transitório → `closed`, e o retry controlado de cada crédito cuida do resto. Em nenhum caso o
   * jogo deixa de subir: quem chama isto não espera o resultado, e as partidas que terminarem
   * enquanto isso vão para o outbox.
   */
  async iniciar(): Promise<{ estado: EstadoDoProgresso; balanco: BalancoDoReprocessamento | null }> {
    this.#estado = "probing";
    await this.#sondar({ transitoriaFecha: true, confirmarAutenticacao: true });
    // `this.estado` (e não o campo): a sonda MUDA o estado durante o await.
    const balanco = this.estado === "closed" ? await this.reprocessar() : null;
    return { estado: this.estado, balanco };
  }

  partidaEncerrada(p: PartidaEncerrada): void {
    const r = resultadoParaCredito(p);
    if (!r) return; // identidade sorteada ou mesa sem humanos suficientes: não há de quem gravar
    try {
      this.#outbox.gravar(r);
    } catch (e) {
      // Sem outbox, a tentativa ainda vale — perder a durabilidade não é motivo para perder o crédito.
      this.#log(`[progresso] outbox indisponível para a partida ${mascarar(r.partidaId)}: ${resumoSeguro(e)}`);
    }
    // FORA DE `closed` O BANCO NÃO É TOCADO. A pendência já está no disco; quem a entrega é a volta
    // para `closed` (sonda do disjuntor) ou o próximo boot.
    if (this.#estado !== "closed") return;
    this.#acompanhar(this.#entregar(r));
  }

  /** Reenvia tudo o que está pendente. Só em `closed`; para no primeiro sinal de disjuntor. */
  async reprocessar(): Promise<BalancoDoReprocessamento> {
    const { validas, corrompidas } = this.#outbox.pendentes();
    for (const nome of corrompidas) this.#log(`[progresso] pendência ilegível mantida no outbox para análise: ${nome}`);
    let entregues = 0;
    for (const r of validas) {
      if (this.#estado !== "closed") break;
      if (await this.#entregar(r)) entregues += 1;
    }
    return { entregues, pendentes: validas.length - entregues, corrompidas };
  }

  /** Espera as entregas em andamento. Para teste e para desligamento ordenado. */
  async ocioso(): Promise<void> {
    while (this.#emVoo.size) await Promise.allSettled([...this.#emVoo]);
  }

  // ─────────────────────────── transições ───────────────────────────

  #mudar(novo: EstadoDoProgresso, motivo: string): void {
    if (this.#estado === novo) return;
    this.#estado = novo;
    this.#log(`[progresso] estado: ${novo} (${motivo})`);
  }

  #abrirAutenticacao(e: unknown): void {
    this.#mudar("open_auth", `${resumoSeguro(e)} — sem novas tentativas até reiniciar com a configuração corrigida`);
  }

  #abrirCircuito(e: unknown): void {
    // Já aberto: não reagenda. Duas entregas simultâneas recebendo o mesmo erro abrem UM disjuntor.
    if (this.#estado === "open_circuit") return;
    this.#reabreEm = this.#agora() + this.#cooldownMs;
    this.#mudar("open_circuit", `${resumoSeguro(e)} — sonda única em ${Math.round(this.#cooldownMs / 60_000)} min`);
    this.#agendar(() => this.#acompanhar(this.#meiaAbertura()), this.#cooldownMs);
  }

  /** Depois do cooldown: EXATAMENTE UMA sonda. */
  async #meiaAbertura(): Promise<void> {
    if (this.#estado !== "open_circuit" || this.#agora() < this.#reabreEm) return;
    this.#mudar("probing", "cooldown do disjuntor cumprido — sonda única");
    await this.#sondar({ transitoriaFecha: false });
    if (this.estado === "closed") await this.reprocessar();
  }

  /**
   * UMA consulta de sonda. `transitoriaFecha`: no boot, um erro transitório não prende o serviço
   * (o retry por crédito cuida); depois de um disjuntor, qualquer coisa que não seja sucesso mantém
   * a porta fechada por mais um cooldown — é a hora de ser conservador. `confirmarAutenticacao`: só
   * a sonda do boot; a confirmação em si já não tem.
   */
  async #sondar({ transitoriaFecha, confirmarAutenticacao = false }: { transitoriaFecha: boolean; confirmarAutenticacao?: boolean }): Promise<void> {
    try {
      await this.#repositorio.sondar();
      this.#mudar("closed", "sonda ok");
    } catch (e) {
      const classe = classificarFalha(e);
      if (classe === "autenticacao") {
        if (!confirmarAutenticacao) return this.#abrirAutenticacao(e);
        this.#log(`[progresso] sonda do boot: ${resumoSeguro(e)} — UMA confirmação em ${ESPERA_DA_CONFIRMACAO_MS / 1000} s`);
        await new Promise<void>((ok) => this.#agendar(ok, ESPERA_DA_CONFIRMACAO_MS));
        return this.#sondar({ transitoriaFecha });
      }
      // Estamos em `probing` (e não em `open_circuit`), então isto reagenda um cooldown novo.
      if (classe === "disjuntor" || !transitoriaFecha) return this.#abrirCircuito(e);
      this.#log(`[progresso] sonda com erro transitório: ${resumoSeguro(e)} — segue com retry por crédito`);
      this.#mudar("closed", "erro transitório na sonda");
    }
  }

  #acompanhar(p: Promise<unknown>): void {
    this.#emVoo.add(p);
    void p.finally(() => this.#emVoo.delete(p));
  }

  async #entregar(r: ResultadoDaPartida): Promise<boolean> {
    for (let tentativa = 0; tentativa <= this.#esperas.length; tentativa++) {
      if (this.#estado !== "closed") return false; // outra entrega abriu o disjuntor: nada de furar
      try {
        await this.#repositorio.creditar(r);
      } catch (e) {
        const classe = classificarFalha(e);
        if (classe === "autenticacao") { this.#abrirAutenticacao(e); return false; }
        if (classe === "disjuntor") { this.#abrirCircuito(e); return false; }
        this.#log(`[progresso] crédito da partida ${mascarar(r.partidaId)} falhou (tentativa ${tentativa + 1}): ${resumoSeguro(e)}`);
        if (tentativa < this.#esperas.length) await this.#esperar(this.#esperas[tentativa]);
        continue;
      }
      // COMMIT confirmado. Se a remoção falhar, o próximo boot reenvia — e o banco devolve o mesmo.
      try {
        this.#outbox.remover(r.partidaId);
      } catch (e) {
        this.#log(`[progresso] partida ${mascarar(r.partidaId)} creditada, pendência não removida: ${resumoSeguro(e)}`);
      }
      return true;
    }
    return false;
  }
}
