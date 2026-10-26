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
//
// ══ O EXPURGO DAS LÁPIDES (Fase 9, E-2) ══
//
// A lápide de quem excluiu a conta sai depois de 30 dias — mas só se nenhum crédito ainda puder lê-la.
// Quem sabe disso é ESTE processo: o outbox, os créditos em voo e as salas vivas (onde uma partida pode
// começar muito depois de uma exclusão). Uma vez por hora, só em `closed`: (1) as pendências antigas
// ganham UMA tentativa — crédito entregue não segura lápide à toa; (2) num trecho SÍNCRONO, o retrato
// do que está em aberto; (3) o banco tira só o que tem mais de 720 h e não está no retrato. Dúvida
// sobre o outbox (ausente, ilegível, arquivo que não valida, marcador trocado) = nada sai. Quem liga
// isto é o boot de produção (`index.ts`); a sonda, nunca.
import { classificarFalha, resumoSeguro } from "./falhas.js";
import type { InventarioDoOutbox, OutboxDeProgresso } from "./outbox.js";
import type { RepositorioDeProgresso } from "./repositorio.js";
import { resultadoParaCredito, type PartidaEncerrada } from "./resultado.js";
import { jogadoresEmSalasVivas } from "./salasVivas.js";
import { mascarar, UUID, type ResultadoDaPartida } from "./tipos.js";

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
/** Entre duas rodadas do expurgo das lápides. O prazo de 720 h é do banco; isto é só a granularidade. */
export const INTERVALO_DO_EXPURGO_MS = 60 * 60_000;

export type DesfechoDoExpurgo = "expurgado" | "adiado" | "falhou";
export interface BalancoDoExpurgo {
  desfecho: DesfechoDoExpurgo;
  removidas: number;
  retidas: number;
  /** Só contagens, códigos e estados — nunca id. */
  motivo?: string;
}

export interface OpcoesDoServico {
  /** Esperas entre tentativas de erro TRANSITÓRIO, em ms. Esgotadas, a pendência fica no outbox. */
  esperas?: number[];
  log?: (mensagem: string) => void;
  esperar?: (ms: number) => Promise<void>;
  /** Relógio e agendador injetáveis: os testes não esperam 10 minutos de verdade. */
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => void;
  cooldownMs?: number;
  /** Quem as salas vivas conhecem (E-2). Injetável para teste; o padrão é o registro das salas. */
  salasVivas?: () => Iterable<string>;
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
  readonly #salasVivas: () => Iterable<string>;
  /** Os jogadores de cada entrega em andamento: até ela terminar, a lápide deles não sai. */
  readonly #creditosEmVoo = new Map<symbol, string[]>();
  #estado: EstadoDoProgresso = "probing";
  #reabreEm = 0;
  #expurgoLigado = false;
  #expurgoDesde: number | null = null;
  #ultimoExpurgo: number | null = null;

  constructor(outbox: OutboxDeProgresso, repositorio: RepositorioDeProgresso, opcoes: OpcoesDoServico = {}) {
    this.#outbox = outbox;
    this.#repositorio = repositorio;
    this.#esperas = opcoes.esperas ?? [2_000, 10_000, 30_000];
    this.#log = opcoes.log ?? ((m) => console.log(m));
    this.#esperar = opcoes.esperar ?? dormir;
    this.#agora = opcoes.agora ?? Date.now;
    this.#agendar = opcoes.agendar ?? agendarDeVerdade;
    this.#cooldownMs = opcoes.cooldownMs ?? COOLDOWN_DO_DISJUNTOR_MS;
    this.#salasVivas = opcoes.salasVivas ?? jogadoresEmSalasVivas;
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

  /**
   * Reenvia tudo o que está pendente. Só em `closed`; para no primeiro sinal de disjuntor.
   * `umaTentativa`: sem as esperas do retry — é o reenvio de hora em hora do expurgo, que não pode
   * prender a rodada nem martelar o banco por um arquivo que nunca vai passar.
   */
  async reprocessar({ umaTentativa = false }: { umaTentativa?: boolean } = {}): Promise<BalancoDoReprocessamento> {
    const { validas, corrompidas } = this.#outbox.pendentes();
    for (const nome of corrompidas) this.#log(`[progresso] pendência ilegível mantida no outbox para análise: ${nome}`);
    let entregues = 0;
    for (const r of validas) {
      if (this.#estado !== "closed") break;
      if (await this.#entregar(r, umaTentativa ? [] : this.#esperas)) entregues += 1;
    }
    return { entregues, pendentes: validas.length - entregues, corrompidas };
  }

  /** Liga o expurgo das lápides: uma rodada agora e uma a cada hora. Chamar de novo não duplica. */
  iniciarExpurgoDeLapides(): void {
    if (this.#expurgoLigado) return;
    this.#expurgoLigado = true;
    const rodada = () => {
      this.#agendar(rodada, INTERVALO_DO_EXPURGO_MS);
      this.#acompanhar(this.expurgarLapides());
    };
    rodada();
  }

  /** UMA rodada do expurgo. Nunca lança; na dúvida, adia e nada sai. */
  async expurgarLapides(): Promise<BalancoDoExpurgo> {
    if (this.#expurgoDesde !== null) {
      return this.#adiarExpurgo(`a rodada anterior ainda está em andamento há ${Math.round((this.#agora() - this.#expurgoDesde) / 60_000)} min`);
    }
    this.#expurgoDesde = this.#agora();
    try {
      return await this.#rodadaDoExpurgo();
    } catch (e) {
      // Rejeição solta derrubaria o processo do jogo: qualquer imprevisto vira adiamento.
      return this.#adiarExpurgo(`erro inesperado (${resumoSeguro(e)})`);
    } finally {
      this.#expurgoDesde = null;
    }
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
    if (this.estado !== "closed") return;
    try {
      await this.reprocessar();
    } catch (e) {
      this.#log(`[progresso] pendências do outbox não puderam ser lidas: ${resumoSeguro(e)} — ficam para a próxima rodada`);
    }
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

  /**
   * Toda tarefa em segundo plano termina REGISTRADA, nunca lançada: sem handler de `unhandledRejection`,
   * uma rejeição solta derrubaria o processo do jogo inteiro (todas as salas).
   */
  #acompanhar(p: Promise<unknown>): void {
    const segura = p.catch((e) => { this.#log(`[progresso] tarefa em segundo plano falhou: ${resumoSeguro(e)}`); });
    this.#emVoo.add(segura);
    void segura.finally(() => this.#emVoo.delete(segura));
  }

  async #entregar(r: ResultadoDaPartida, esperas = this.#esperas): Promise<boolean> {
    // Antes do primeiro `await`: o retrato do expurgo nunca vê esta entrega "fora" de tudo.
    const emVoo = Symbol(r.partidaId);
    this.#creditosEmVoo.set(emVoo, r.humanos.map((h) => h.playerId));
    try {
      for (let tentativa = 0; tentativa <= esperas.length; tentativa++) {
        if (this.#estado !== "closed") return false; // outra entrega abriu o disjuntor: nada de furar
        try {
          await this.#repositorio.creditar(r);
        } catch (e) {
          const classe = classificarFalha(e);
          if (classe === "autenticacao") { this.#abrirAutenticacao(e); return false; }
          if (classe === "disjuntor") { this.#abrirCircuito(e); return false; }
          this.#log(`[progresso] crédito da partida ${mascarar(r.partidaId)} falhou (tentativa ${tentativa + 1}): ${resumoSeguro(e)}`);
          if (tentativa < esperas.length) await this.#esperar(esperas[tentativa]);
          continue;
        }
        // COMMIT confirmado. Se a remoção falhar, o próximo reenvio repete — e o banco devolve o mesmo.
        try {
          this.#outbox.remover(r.partidaId);
        } catch (e) {
          this.#log(`[progresso] partida ${mascarar(r.partidaId)} creditada, pendência não removida: ${resumoSeguro(e)}`);
        }
        return true;
      }
      return false;
    } finally {
      this.#creditosEmVoo.delete(emVoo);
    }
  }

  // ─────────────────────────── expurgo das lápides (E-2) ───────────────────────────

  async #rodadaDoExpurgo(): Promise<BalancoDoExpurgo> {
    if (this.#estado !== "closed") return this.#adiarExpurgo(`progresso em ${this.#estado}`);
    // 1. Pendência antiga ganha UMA tentativa: crédito entregue sai do outbox e deixa de proteger.
    try {
      await this.reprocessar({ umaTentativa: true });
    } catch (e) {
      return this.#adiarExpurgo(`o outbox não pôde ser lido (${resumoSeguro(e)})`);
    }
    if (this.#estado !== "closed") return this.#adiarExpurgo(`progresso em ${this.#estado}`);

    // 2. O RETRATO, num trecho síncrono, logo antes do banco: outbox (estrito), créditos em voo e
    //    salas vivas. Qualquer erro aqui é dúvida — e com dúvida nada sai.
    let inventario: InventarioDoOutbox;
    let naSala: string[];
    try {
      inventario = this.#outbox.inventario();
    } catch (e) {
      return this.#adiarExpurgo(`o outbox não pôde ser lido (${resumoSeguro(e)})`);
    }
    if (inventario.duvidosos.length) {
      return this.#adiarExpurgo(`${inventario.duvidosos.length} pendência(s) ilegível(is) no outbox`);
    }
    try {
      naSala = [...this.#salasVivas()];
    } catch (e) {
      return this.#adiarExpurgo(`as salas vivas não puderam ser lidas (${resumoSeguro(e)})`);
    }
    const ids = new Set<string>();
    for (const id of [...inventario.jogadores, ...[...this.#creditosEmVoo.values()].flat(), ...naSala]) {
      const normal = String(id).toLowerCase();
      if (UUID.test(normal)) ids.add(normal); // bot e id sorteado não têm lápide
    }
    const marcador = inventario.marcador;
    const protegidas = [...ids].sort();

    // 3. O banco decide o prazo; o servidor só disse o que ainda está em aberto.
    try {
      const { removidas, retidas } = await this.#repositorio.expurgarLapides(marcador, protegidas);
      if (this.#ultimoExpurgo === null) this.#log("[progresso] expurgo das lápides ativo — 1ª rodada concluída (depois, a cada hora)");
      this.#ultimoExpurgo = this.#agora();
      if (removidas || retidas) {
        this.#log(`[progresso] lápides: ${removidas} expurgada(s), ${retidas} vencida(s) retida(s) — ainda em aberto (outbox, crédito em voo ou sala viva)`);
      }
      return { desfecho: "expurgado", removidas, retidas };
    } catch (e) {
      const classe = classificarFalha(e);
      if (classe === "autenticacao") this.#abrirAutenticacao(e);
      else if (classe === "disjuntor") this.#abrirCircuito(e);
      else {
        const porque = (e as { code?: unknown } | null)?.code === "KL001"
          ? "o outbox não é o registrado no banco (ver docs/KING-MOBILE-RC.md §22.11)"
          : resumoSeguro(e);
        this.#log(`[progresso] expurgo das lápides falhou: ${porque} — nenhuma lápide saiu`);
      }
      return { desfecho: "falhou", removidas: 0, retidas: 0, motivo: resumoSeguro(e) };
    }
  }

  #adiarExpurgo(motivo: string): BalancoDoExpurgo {
    const desde = this.#ultimoExpurgo === null
      ? "nenhum concluído desde o boot"
      : `último concluído há ${Math.round((this.#agora() - this.#ultimoExpurgo) / 3_600_000)} h`;
    this.#log(`[progresso] expurgo das lápides adiado: ${motivo} — ${desde}`);
    return { desfecho: "adiado", removidas: 0, retidas: 0, motivo };
  }
}
