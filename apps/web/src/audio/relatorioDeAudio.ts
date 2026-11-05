// O RELATÓRIO DO "DIAGNÓSTICO DE ÁUDIO" — SÓ no APK DEBUG de QA (rodada 5, 04/11/2026).
//
// Sem cabo USB e sem ADB, o logcat não chega a ninguém. Este módulo junta, no próprio aparelho, o que
// a fita (`diagnostico.ts`) e a sonda do motor (`engine.ts`) viram, separa o que foi capturado DURANTE
// a falha (A) do resultado dos sons de teste (B) e do estado depois da tentativa de recuperação (C),
// e devolve um texto legível que a pessoa copia ou compartilha POR AÇÃO PRÓPRIA. Nada vai para a rede.
//
// Puro e injetável: o painel (`ui/DiagnosticoDeAudio.tsx`) entrega a fita, a sonda e o ambiente.

import { carimbar, msDesdeOInicio, type DiagnosticoDeAudio, type Retrato, type RetratoGuardado, type Valor } from "./diagnostico.js";
import type { ResultadoDoTeste, SondaDoMotor, TrocaRegistrada } from "./engine.js";
import { matrizDeDecisao, type EstadoDoSistema, type LetraDiferencial, type ResultadoDiferencial, type RespostasDaMatriz } from "./testesDiferenciais.js";
import { resumoEmCampos, type JanelaDoMonitor, type ResumoDoMonitor } from "./monitorDeAudio.js";

// ───────────────────────── a sessão: falhas, testes, recuperação ─────────────────────────

export type Momento = "antes-da-recuperacao" | "depois-da-recuperacao";
export interface TesteRegistrado {
  n: number; t: string; momento: Momento; resultado: ResultadoDoTeste; ouviu: boolean | null;
  /** Rodada 6: o áudio do Android ~250 ms depois de mandar tocar (null fora do APK debug no Android). */
  sistemaDurante?: EstadoDoSistema | null;
}
/** Rodada 6: um teste diferencial (A, A′, B, C) — mecanismo, resultado técnico, erro e "ouviu?". */
export interface TesteDiferencial {
  n: number; t: string; momento: Momento; resultado: ResultadoDiferencial; ouviu: boolean | null;
  sistemaDurante: EstadoDoSistema | null;
  /** O mecanismo não existe aqui (C fora do APK debug no Android): sem "ouviu?", fora da matriz. */
  indisponivel: boolean;
}
/** Quem executa os testes diferenciais e lê o áudio do sistema (o painel injeta; os testes também). */
export interface ExecutoresDiferenciais {
  /** Começa SÍNCRONO (dentro do toque) e devolve a promessa do resultado. */
  executar(letra: LetraDiferencial): Promise<ResultadoDiferencial>;
  sistema(): Promise<EstadoDoSistema | null>;
}

export interface Ocorrencia {
  n: number;
  t: string;
  ms: number;
  /**
   * A1: o motor ANTES do toque no 🔊 que abriu o painel de som (o reparo do 🔊 vem depois). Rodada 6:
   * cada abertura do 🔊 serve a UMA falha só (a 1ª registrada depois dela) e só se tiver ≤ 2 min.
   */
  abertura: RetratoGuardado | null;
  /** Sem A1: por quê (🔊 não reaberto desde a falha anterior, aberto há tempo demais, nunca aberto). */
  aberturaDescartada: string | null;
  /** O motor ~1,2 s depois do toque no 🔊 (o que o reparo do 🔊 fez). */
  depoisDoPainel: RetratoGuardado | null;
  /** A2: o motor ANTES do toque em "Registrar falha de som". */
  antesDoRegistro: RetratoGuardado | null;
  /** A3: o motor no instante do registro (depois do toque). */
  noRegistro: Retrato | null;
  /** Os retratos tirados antes de cada toque recente (até 6), para ver o 1º toque depois do silêncio. */
  toquesRecentes: RetratoGuardado[];
  testes: TesteRegistrado[];
  /** Rodada 6: A (Web Audio isolado), A′ (direto no contexto do jogo), B (HTML5), C (nativo). */
  diferenciais: TesteDiferencial[];
  /** Rodada 6: o áudio do Android lido no registro (só leitura; chega um instante depois). */
  sistemaNaFalha: EstadoDoSistema | null;
  recuperacao: { t: string; antes: Retrato; depois: Retrato | null } | null;
}

/** Ocorrências guardadas (as mais antigas saem) e testes por ocorrência: memória limitada. */
export const MAX_OCORRENCIAS = 5;
export const MAX_TESTES = 12;
/** Retrato "antes do toque" mais velho que isto não é deste toque. */
const TOQUE_RECENTE_MS = 2000;
/** Abertura do 🔊 mais velha que isto não é o estado DESTE silêncio (rodada 6). */
export const ABERTURA_MAX_MS = 120_000;

export interface DependenciasDaSessao {
  diag: DiagnosticoDeAudio;
  sonda: () => SondaDoMotor | null;
  esperar?: (ms: number) => Promise<void>;
  /** Rodada 6: testes diferenciais e áudio do sistema (ausente = só os testes do motor). */
  diferenciais?: ExecutoresDiferenciais;
  /** Rodada 8: o resumo do monitor contínuo do relógio (ausente = sem monitor). */
  monitor?: () => ResumoDoMonitor | null;
}

export interface SessaoDeDiagnostico {
  /** Chamado pelo 🔊 ANTES do reparo dele (`reativar`): guarda o motor como estava. */
  aoAbrirPainelDeSom(): void;
  /** A: guarda o estado da falha. NUNCA tenta reparar, nunca toca som. Síncrono. */
  registrarFalha(): Ocorrencia;
  /** B: toca o som de teste no contexto atual (sem retomar, sem trocar) e mede. */
  testar(qual: "musica" | "efeito"): Promise<TesteRegistrado>;
  /** Rodada 6: A, A′, B ou C — começa dentro do toque; nada repara, nada troca. */
  testarDiferencial(letra: LetraDiferencial): Promise<TesteDiferencial>;
  /** Rodada 6: lê o áudio do Android agora (só leitura) — o relatório usa a última leitura. */
  lerSistema(): Promise<EstadoDoSistema | null>;
  /** A resposta da pessoa: o analisador mede o grafo, não o alto-falante. */
  responder(teste: TesteRegistrado | TesteDiferencial, ouviu: boolean): void;
  /** C: o motor antes, o `religar` de sempre (dentro do toque) e o motor ~1,5 s depois. */
  recuperar(): Promise<void>;
  ocorrencias(): Ocorrencia[];
  relatorio(ambiente: AmbienteDoRelatorio): string;
}

const esperarDeVerdade = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

function recente(lista: RetratoGuardado[]): RetratoGuardado | null {
  const ult = lista[lista.length - 1];
  return ult && msDesdeOInicio() - ult.ms <= TOQUE_RECENTE_MS ? ult : null;
}

export function criarSessaoDeDiagnostico(deps: DependenciasDaSessao): SessaoDeDiagnostico {
  const esperar = deps.esperar ?? esperarDeVerdade;
  const ocorrencias: Ocorrencia[] = [];
  /** A abertura do 🔊 mais recente, e a falha que já a usou (rodada 6: uma abertura → uma falha). */
  let painel: { abertura: RetratoGuardado; depois: RetratoGuardado | null; dona: Ocorrencia | null } | null = null;
  /** Retratos de toque já usados como A2 (o mesmo toque não serve a duas falhas). */
  const toquesUsados = new WeakSet<RetratoGuardado>();
  let nTeste = 0;
  let ultimoSistema: EstadoDoSistema | null = null;
  /** O áudio do Android ~250 ms depois de mandar tocar (o som de teste está no ar). */
  const sistemaDurante = (): Promise<EstadoDoSistema | null> =>
    deps.diferenciais ? esperar(250).then(() => deps.diferenciais!.sistema()).catch(() => null) : Promise.resolve(null);

  const atual = (): Ocorrencia => ocorrencias[ocorrencias.length - 1] ?? sessao.registrarFalha();

  const sessao: SessaoDeDiagnostico = {
    aoAbrirPainelDeSom() {
      const s = deps.sonda();
      if (!s) return;
      // o retrato do pointerdown DESTE toque; sem ele (teclado), o motor agora — ainda antes do reparo
      const p: NonNullable<typeof painel> = {
        abertura: recente(s.antesDoToque()) ?? carimbar("ao-abrir-o-painel", s.retrato()),
        depois: null,
        dona: null,
      };
      painel = p;
      deps.diag.registrar("painel-de-som-aberto", { fase: p.abertura.r.fase ?? null, contexto: p.abertura.r.contexto ?? null });
      void esperar(1200).then(() => {
        p.depois = carimbar("1,2s-depois-do-painel", s.retrato());
        // a falha registrada antes de 1,2 s recebe o "depois" quando ele chega
        if (p.dona && p.dona.abertura === p.abertura) p.dona.depoisDoPainel = p.depois;
      });
    },

    registrarFalha() {
      const s = deps.sonda();
      // tudo LIDO, nada chamado que repare: sem unlock, sem religar, sem som
      const noRegistro = s ? s.retrato() : null;
      const toques = s ? s.antesDoToque() : [];
      const n = (ocorrencias[ocorrencias.length - 1]?.n ?? 0) + 1;
      const agoraMs = msDesdeOInicio();
      let abertura: RetratoGuardado | null = null;
      let depoisDoPainel: RetratoGuardado | null = null;
      let aberturaDescartada: string | null = null;
      if (!painel) aberturaDescartada = "o painel não foi aberto pelo 🔊 nesta sessão";
      else if (painel.dona) aberturaDescartada = `o 🔊 não foi aberto de novo depois da falha #${painel.dona.n}`;
      else if (agoraMs - painel.abertura.ms > ABERTURA_MAX_MS) {
        aberturaDescartada = `o 🔊 foi aberto há ${Math.round((agoraMs - painel.abertura.ms) / 1000)} s (> ${ABERTURA_MAX_MS / 1000} s): não é deste silêncio`;
      } else {
        abertura = painel.abertura;
        depoisDoPainel = painel.depois;
      }
      let a2 = recente(toques);
      if (a2 && toquesUsados.has(a2)) a2 = null;
      if (a2) toquesUsados.add(a2);
      const o: Ocorrencia = {
        n,
        t: new Date().toISOString(),
        ms: agoraMs,
        abertura,
        aberturaDescartada,
        depoisDoPainel,
        antesDoRegistro: a2,
        noRegistro,
        toquesRecentes: toques,
        testes: [],
        diferenciais: [],
        sistemaNaFalha: null,
        recuperacao: null,
      };
      // o áudio do Android, SÓ LEITURA (volume, mudo, rota, reproduções): chega um instante depois
      if (deps.diferenciais) {
        void deps.diferenciais.sistema().then((sis) => { o.sistemaNaFalha = sis; if (sis) ultimoSistema = sis; }, () => {});
      }
      if (painel && !painel.dona) painel.dona = o; // esta abertura do 🔊 não serve a mais nenhuma falha
      ocorrencias.push(o);
      if (ocorrencias.length > MAX_OCORRENCIAS) ocorrencias.shift();
      deps.diag.registrar("falha-registrada", {
        n: o.n, fase: noRegistro?.fase ?? null, contexto: noRegistro?.contexto ?? null, rms: noRegistro?.rms ?? null,
      });
      return o;
    },

    async testar(qual) {
      const o = atual();
      const s = deps.sonda();
      const momento: Momento = o.recuperacao ? "depois-da-recuperacao" : "antes-da-recuperacao";
      const t = new Date().toISOString();
      const durante = sistemaDurante();
      const resultado: ResultadoDoTeste = s
        ? await s.tocarTeste(qual)
        : { qual, tocou: false, motivo: "sem-motor", antes: {}, durante: null };
      const teste: TesteRegistrado = { n: ++nTeste, t, momento, resultado, ouviu: null, sistemaDurante: await durante };
      o.testes.push(teste);
      if (o.testes.length > MAX_TESTES) o.testes.shift();
      return teste;
    },

    async testarDiferencial(letra) {
      const o = atual();
      const momento: Momento = o.recuperacao ? "depois-da-recuperacao" : "antes-da-recuperacao";
      const t = new Date().toISOString();
      // o mecanismo começa AQUI, síncrono, ainda dentro do toque; a leitura do sistema vem em paralelo
      const exec = deps.diferenciais;
      const pResultado: Promise<ResultadoDiferencial> = exec
        ? exec.executar(letra).catch((e: unknown) => ({ letra, mecanismo: "?", aceitou: false, tecnico: {}, erro: String(e).slice(0, 120) }))
        : Promise.resolve({ letra, mecanismo: "?", aceitou: false, tecnico: {}, erro: "testes diferenciais indisponíveis" });
      const [resultado, sis] = await Promise.all([pResultado, sistemaDurante()]);
      const indisponivel = !resultado.aceitou && /indisponív/i.test(resultado.erro ?? "");
      const teste: TesteDiferencial = { n: ++nTeste, t, momento, resultado, ouviu: null, sistemaDurante: sis, indisponivel };
      o.diferenciais.push(teste);
      if (o.diferenciais.length > MAX_TESTES) o.diferenciais.shift();
      deps.diag.registrar("teste-diferencial", { letra, aceitou: resultado.aceitou, erro: resultado.erro, momento });
      return teste;
    },

    async lerSistema() {
      const sis = deps.diferenciais ? await deps.diferenciais.sistema().catch(() => null) : null;
      if (sis) ultimoSistema = sis;
      return sis;
    },

    responder(teste, ouviu) {
      teste.ouviu = ouviu;
      const qual = "letra" in teste.resultado ? teste.resultado.letra : teste.resultado.qual;
      deps.diag.registrar("teste-respondido", { qual, ouviu, momento: teste.momento });
    },

    async recuperar() {
      const o = atual();
      const s = deps.sonda();
      if (!s) return;
      const antes = s.retrato();
      deps.diag.registrar("recuperacao-manual", { fase: antes.fase ?? null, contexto: antes.contexto ?? null });
      const rec: NonNullable<Ocorrencia["recuperacao"]> = { t: new Date().toISOString(), antes, depois: null };
      o.recuperacao = rec;
      s.recuperar(); // síncrono, ainda dentro do toque (o contexto novo precisa do gesto)
      await esperar(1500);
      rec.depois = s.retrato();
      deps.diag.registrar("recuperacao-manual-depois", { fase: rec.depois.fase ?? null, contexto: rec.depois.contexto ?? null });
    },

    ocorrencias: () => ocorrencias.slice(),

    relatorio(ambiente) {
      const s = deps.sonda();
      return montarRelatorio({
        ambiente,
        diag: deps.diag,
        agora: s ? s.retrato() : null,
        trocas: s ? s.trocas() : [],
        toques: s ? s.antesDoToque() : [],
        ocorrencias,
        sistemaAgora: ultimoSistema,
        monitor: deps.monitor?.() ?? null,
      });
    },
  };
  return sessao;
}

// ───────────────────────── os indícios H1–H8 ─────────────────────────

export type Sinal = "sim" | "não" | "indeterminado";
export interface Indicio { h: string; nome: string; sinal: Sinal; porque: string }

const num = (v: Valor | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const QUASE_ZERO = 0.001;
/** Eventos de ciclo de vida que, logo antes da falha, apontam H7. */
const CICLO = new Set(["fundo", "volta", "estado", "ev-pause", "ev-resume", "ev-freeze", "ev-visibilitychange", "ev-blur", "ev-pagehide"]);

/** O estado DURANTE a falha: o mais cedo que existe (antes do 🔊 > antes do registro > no registro). */
export function estadoDaFalha(o: Ocorrencia): { rotulo: string; r: Retrato } | null {
  if (o.abertura) return { rotulo: "A1 antes do toque no 🔊", r: o.abertura.r };
  if (o.antesDoRegistro) return { rotulo: "A2 antes do toque em Registrar", r: o.antesDoRegistro.r };
  if (o.noRegistro) return { rotulo: "A3 no registro", r: o.noRegistro };
  return null;
}

export function indicios(o: Ocorrencia, diag: DiagnosticoDeAudio): Indicio[] {
  const a = estadoDaFalha(o)?.r ?? null;
  const cont = diag.contagens();
  const out: Indicio[] = [];
  const add = (h: string, nome: string, sinal: Sinal, porque: string) => out.push({ h, nome, sinal, porque });

  if (!a) {
    add("—", "sem retrato do motor", "indeterminado", "o motor ainda não tinha contexto (nenhum som tinha começado)");
    return out;
  }
  const ctx = a.contexto;
  // H1
  if (ctx === null) add("H1", "AudioContext suspenso/interrompido", "indeterminado", "sem contexto no motor");
  else if (ctx === "running") add("H1", "AudioContext suspenso/interrompido", "não", "contexto \"running\"");
  else add("H1", "AudioContext suspenso/interrompido", "sim", `contexto "${String(ctx)}"`);
  // H2
  const andou = num(a.andouDesdeVigia);
  const parede = num(a.paredeDesdeVigiaMs);
  if (ctx === "running" && andou !== null && parede !== null && parede >= 1000) {
    const parado = andou < 0.05;
    add("H2", "contexto ativo com relógio parado", parado ? "sim" : "não",
      `relógio andou ${andou}s em ${(parede / 1000).toFixed(1)}s de parede`);
  } else if (a.zumbi === true) {
    add("H2", "contexto ativo com relógio parado", "sim", "o vigia já tinha marcado o contexto como zumbi");
  } else {
    add("H2", "contexto ativo com relógio parado", "indeterminado", "sem medida do relógio entre dois exames do vigia");
  }
  // H3
  const compasso = num(a.compassoHaMs);
  if (a.prefMusica !== true) add("H3", "agendador da música interrompido", "indeterminado", "música desligada nas preferências");
  else if (a.musicaAgendada !== true) add("H3", "agendador da música interrompido", "sim", "música ligada, mas nenhum agendador ativo");
  else if (compasso !== null && compasso > 6000) add("H3", "agendador da música interrompido", "sim", `último compasso há ${compasso} ms (normal ≤ ~2 s)`);
  else add("H3", "agendador da música interrompido", "não", `agendador ativo; último compasso há ${compasso ?? "?"} ms`);
  // H4
  const gm = num(a.ganhoMaster);
  const gmu = num(a.ganhoMusica);
  const gef = num(a.ganhoEfeitos);
  const zeros: string[] = [];
  if (gm !== null && gm < QUASE_ZERO) zeros.push(`master=${gm}`);
  if (a.prefMusica === true && num(a.volMusica) !== 0 && gmu !== null && gmu < QUASE_ZERO) zeros.push(`música=${gmu}`);
  if (a.prefEfeitos === true && num(a.volEfeitos) !== 0 && gef !== null && gef < QUASE_ZERO) zeros.push(`efeitos=${gef}`);
  const volZero = a.volMusica === 0 || a.volEfeitos === 0 ? " (atenção: algum volume escolhido = 0)" : "";
  if (gm === null && gmu === null) add("H4", "barramento/ganho em zero", "indeterminado", "sem grafo");
  else if (zeros.length) add("H4", "barramento/ganho em zero", "sim", `${zeros.join(", ")}${volZero}`);
  else add("H4", "barramento/ganho em zero", "não", `master=${gm} música=${gmu} efeitos=${gef}${volZero}`);
  // H5
  const internos = o.testes.filter((t) => num(t.resultado.durante?.rms) !== null && num(t.resultado.durante?.rms)! > 0.0005);
  const naoOuviu = internos.filter((t) => t.ouviu === false);
  const ouviu = o.testes.filter((t) => t.ouviu === true);
  if (naoOuviu.length) {
    add("H5", "sinal interno, saída física muda", "sim",
      `${naoOuviu.length} teste(s) com sinal no grafo e "não ouvi" — COMPATÍVEL, não comprova (o analisador não ouve o alto-falante)`);
  } else if (ouviu.length) add("H5", "sinal interno, saída física muda", "não", `${ouviu.length} teste(s) ouvido(s)`);
  else add("H5", "sinal interno, saída física muda", "indeterminado", "sem teste respondido com sinal no grafo");
  // H6
  const falhas = cont["reconstruir-falhou"] ?? 0;
  const trocas = cont["reconstruir"] ?? 0;
  const ok = cont["reconstruir-ok"] ?? 0;
  if (falhas > 0) add("H6", "falha de reconstrução do contexto", "sim", `${falhas} troca(s) falharam (de ${trocas})`);
  else if (trocas > ok) add("H6", "falha de reconstrução do contexto", "indeterminado", `${trocas} troca(s) começadas, ${ok} concluídas`);
  else add("H6", "falha de reconstrução do contexto", "não", `${ok} troca(s), nenhuma falhou`);
  // H7
  const ciclo = diag.fita().filter((r) => CICLO.has(r.evento) && r.ms <= o.ms && o.ms - r.ms <= 60_000);
  const ult = ciclo[ciclo.length - 1];
  if (ult) add("H7", "perda após evento de ciclo de vida", "sim", `"${ult.evento}" ${((o.ms - ult.ms) / 1000).toFixed(1)}s antes do registro (${ciclo.length} evento(s) no último minuto)`);
  else add("H7", "perda após evento de ciclo de vida", "não", "nenhum evento de ciclo de vida no minuto anterior ao registro");
  // H8
  const vozes = num(a.vozes);
  const criados = cont["contexto-novo"] ?? 0;
  const fechados = cont["contexto-fechado"] ?? 0;
  const depois = o.testes.filter((t) => t.momento === "depois-da-recuperacao");
  const motivos: string[] = [];
  if (vozes !== null && vozes > 150) motivos.push(`${vozes} vozes no ar`);
  if (criados - fechados > 2) motivos.push(`${criados} contextos criados × ${fechados} fechados`);
  if (depois.length && depois.every((t) => t.ouviu === false)) motivos.push("nem o contexto NOVO foi ouvido depois da recuperação");
  if (motivos.length) add("H8", "acúmulo de recursos / falha da WebView", "sim", motivos.join("; "));
  else add("H8", "acúmulo de recursos / falha da WebView", "indeterminado", `vozes=${vozes ?? "?"}; contextos ${criados} criados, ${fechados} fechados`);
  return out;
}

// ───────────────────────── o texto ─────────────────────────

export interface AmbienteDoRelatorio {
  versao: string | null;
  build: string | null;
  plataforma: string;
  motor: string;
  webview: boolean | null;
  nativo: boolean | null;
  tela: string | null;
  online: boolean | null;
  nucleos: number | null;
  memoriaGb: number | null;
}

/**
 * O aparelho SEM identidade: versão do Android e versão MAIOR do Chrome/WebView. Nada de modelo, de
 * "Build/…", de agente completo — isso começa a identificar o aparelho.
 */
export function ambienteDoAparelho(o: {
  nav?: Partial<Navigator> & { deviceMemory?: number };
  tela?: { width: number; height: number } | null;
  dpr?: number | null;
  nativo?: boolean | null;
  versao?: string | null;
  build?: string | null;
} = {}): AmbienteDoRelatorio {
  const ua = o.nav?.userAgent ?? "";
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua)?.[1];
  const ios = /OS (\d+)_\d+/.exec(ua)?.[1];
  const chrome = /Chrome\/(\d+)/.exec(ua)?.[1];
  const plataforma = android ? `Android ${android}` : /iPhone|iPad/.test(ua) ? `iOS ${ios ?? "?"}` : /Windows/.test(ua) ? "Windows" : "outra";
  return {
    versao: o.versao ?? null,
    build: o.build ?? null,
    plataforma,
    motor: chrome ? `Chromium ${chrome}` : /AppleWebKit/.test(ua) ? "WebKit" : "desconhecido",
    webview: ua ? /; wv\)/.test(ua) : null,
    nativo: o.nativo ?? null,
    tela: o.tela ? `${o.tela.width}x${o.tela.height}${o.dpr ? ` @${Number(o.dpr.toFixed(2))}x` : ""}` : null,
    online: typeof o.nav?.onLine === "boolean" ? o.nav.onLine : null,
    nucleos: typeof o.nav?.hardwareConcurrency === "number" ? o.nav.hardwareConcurrency : null,
    memoriaGb: typeof o.nav?.deviceMemory === "number" ? o.nav.deviceMemory : null,
  };
}

/** Grupos do retrato, na ordem em que se lê um defeito de áudio. */
const GRUPOS: [string, string[]][] = [
  ["contexto", ["fase", "contexto", "relogio", "andouDesdeVigia", "paredeDesdeVigiaMs", "taxa", "latBase", "latSaida", "saidaCtx", "saidaIdadeMs", "idadeContextoMs", "geracao"]],
  ["música", ["musicaAgendada", "compassoHaMs", "musicaDesdeMs"]],
  ["preferências", ["prefMusica", "volMusica", "prefEfeitos", "volEfeitos", "prefVibracao"]],
  ["ganhos", ["ganhoMaster", "ganhoMusica", "ganhoEfeitos"]],
  ["sinal interno", ["analisador", "rms", "pico", "sinalNaN", "analisadorProvado", "vozes"]],
  ["vigia", ["zumbi", "condenado", "naoConfiavel", "gestoArmado", "recuperando", "trocaBloqueada", "falhasDoGesto"]],
  ["página", ["visivel", "foco"]],
];

const fmt = (v: Valor | undefined): string => (v === undefined ? "?" : v === null ? "—" : String(v));

export function linhasDoRetrato(r: Retrato | null, recuo = "    "): string[] {
  if (!r) return [`${recuo}(sem retrato)`];
  const vistos = new Set<string>();
  const linhas: string[] = [];
  for (const [nome, chaves] of GRUPOS) {
    const partes = chaves.filter((k) => k in r).map((k) => { vistos.add(k); return `${k}=${fmt(r[k])}`; });
    if (partes.length) linhas.push(`${recuo}${nome}: ${partes.join(" · ")}`);
  }
  const resto = Object.keys(r).filter((k) => !vistos.has(k));
  if (resto.length) linhas.push(`${recuo}outros: ${resto.map((k) => `${k}=${fmt(r[k])}`).join(" · ")}`);
  return linhas;
}

const hora = (iso: string) => iso.slice(11, 23);

function linhaDaFita(r: Record<string, Valor>): string {
  const { t, ms, evento, ...resto } = r;
  const campos = Object.entries(resto).map(([k, v]) => `${k}=${fmt(v)}`).join(" ");
  return `  +${(Number(ms) / 1000).toFixed(1)}s ${hora(String(t))} ${String(evento)}${campos ? ` ${campos}` : ""}`;
}

/**
 * A LEITURA DA RODADA 7, por falha: relógio do KING × contexto limpo (R), isolamento (I1/I2) e a escada
 * (E1…E5). Só junta os números e as respostas — quem conclui é a pessoa com o relatório na mão.
 */
export function leituraDaRodada7(o: Ocorrencia): string[] {
  const out: string[] = [];
  const ult = (l: LetraDiferencial) => [...o.diferenciais].reverse().find((d) => d.resultado.letra === l && !d.indisponivel);
  const n = (v: Valor | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const r = ult("R");
  if (r) {
    const rei = n(r.resultado.tecnico["rei.razao"]);
    const limpo = n(r.resultado.tecnico["limpo.razao"]);
    const falta = (k: string) => { const d = n(r.resultado.tecnico[`${k}.stats.underrunDuration`]); const e = n(r.resultado.tecnico[`${k}.stats.underrunEvents`]); return d === null ? "não exposto" : `${d}s em ${e ?? "?"} evento(s)`; };
    out.push(`RENDERIZAÇÃO FALTANDO (playbackStats do Chromium, se exposto): KING ${falta("rei")} × limpo ${falta("limpo")}`);
    out.push(`RELÓGIOS (${r.momento}): KING ${rei ?? "?"} × limpo ${limpo ?? "?"} do tempo real${rei !== null && limpo !== null ? (rei < 0.9 && limpo >= 0.97 ? " → SÓ o contexto do KING renderiza abaixo do tempo real" : rei < 0.9 && limpo < 0.9 ? " → os DOIS abaixo do tempo real (aparelho/sistema)" : rei >= 0.97 ? " → o KING em tempo real nesta medição" : "") : ""}`);
  }
  for (const l of ["I1", "I2"] as const) {
    const d = ult(l);
    if (!d) continue;
    const razao = n(d.resultado.tecnico.razao);
    out.push(`ISOLAMENTO ${l} (${l === "I1" ? "música parada" : "grafo isolado"}): relógio ${razao ?? "?"} do tempo real · A′ ${d.ouviu === null ? "sem resposta" : d.ouviu ? "OUVIDO" : "NÃO ouvido"}`);
  }
  const degraus = (["E1", "E2", "E3", "E4", "E5"] as const).map((l) => ult(l)).filter((d): d is TesteDiferencial => Boolean(d));
  if (degraus.length) {
    const falha = degraus.find((d) => d.ouviu === false || (n(d.resultado.tecnico.razao) ?? 1) < 0.9);
    out.push(`ESCADA: ${degraus.map((d) => `${d.resultado.letra}=${d.ouviu === null ? "?" : d.ouviu ? "ouviu" : "NÃO"}/${n(d.resultado.tecnico.razao) ?? "?"}`).join(" · ")}${falha ? ` → falha a partir de ${falha.resultado.letra}` : ""}`);
  }
  return out;
}

/** Rodada 8: as variantes do grafo, na ordem do pedido. */
export const VARIANTES = ["VA", "VB", "VC", "VD", "VE"] as const;
/** Critério técnico da rodada 8: processamento sustentado perto de 1,0× e sem underrun relevante. */
export const RAZAO_SUSTENTADA = 0.98;

/**
 * A LEITURA DA RODADA 8, por falha: cada variante do grafo (o MESMO motor, contexto novo com o perfil) —
 * razão do relógio, pior janela, underruns pela DIFERENÇA na medição, vozes no ar e o "ouviu normal?".
 */
export function leituraDaRodada8(o: Ocorrencia): string[] {
  const out: string[] = [];
  const n = (v: Valor | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const linhas: string[] = [];
  for (const l of VARIANTES) {
    const d = [...o.diferenciais].reverse().find((x) => x.resultado.letra === l && !x.indisponivel);
    if (!d) continue;
    const t = d.resultado.tecnico;
    const razao = n(t.razao);
    const ev = n(t["stats.underrunEvents"]);
    const seg = n(t["stats.underrunDuration"]);
    const sustenta = razao !== null && razao >= RAZAO_SUSTENTADA && (ev === null || ev === 0);
    linhas.push(`${l} ${String(t.perfil ?? "?")}: razão ${razao ?? "?"} (pior janela ${n(t.razaoMin) ?? "?"}) · underruns ${ev ?? "não exposto"}${seg !== null ? ` / ${seg}s` : ""} · vozes máx ${n(t.vozesMax) ?? "?"} · ouviu normal: ${d.ouviu === null ? "sem resposta" : d.ouviu ? "SIM" : "NÃO"} → relógio ${sustenta ? "SUSTENTA" : "NÃO sustenta"}`);
  }
  if (linhas.length) {
    out.push(`VARIANTES (o próprio motor, contexto novo por variante; critério: razão ≥ ${RAZAO_SUSTENTADA} e 0 underrun):`);
    out.push(...linhas.map((l) => `  ${l}`));
  }
  return out;
}

/** Rodada 8: o monitor contínuo, por perfil, e as últimas janelas. */
function linhasDoMonitor(r: ResumoDoMonitor | null): string[] {
  if (!r) return ["  (sem monitor — fora do APK DEBUG)"];
  const out = [`  ${r.ligado ? "ligado" : "parado"} · ${r.duracaoS}s · ${r.janelas} janelas (${r.validas} válidas, ${r.emFundo} em fundo, ${r.trocasDeContexto} trocas de contexto)`];
  const c = resumoEmCampos(r);
  for (const p of Object.keys(r.porPerfil)) {
    out.push(`  perfil ${p}: ${c[`${p}.janelas`]} janelas · razão média ${fmt(c[`${p}.razaoMedia`])} · pior ${fmt(c[`${p}.razaoMin`])} · abaixo de 0,95: ${c[`${p}.abaixoDe095`]} · underruns ${fmt(c[`${p}.underrunEventos`])} (${fmt(c[`${p}.underrunSegundos`])}s; fração ${fmt(c[`${p}.fracaoUnderrun`])})`);
  }
  const j = (x: JanelaDoMonitor) => `    +${x.s}s ${x.perfil} razão=${fmt(x.razao)} underruns=${fmt(x.underrunEventos)}/${fmt(x.underrunSegundos)}s${x.visivel ? "" : " (fundo)"}${x.contextoNovo ? " (contexto novo: janela descartada)" : ""}`;
  if (r.recentes.length) out.push("  últimas janelas:", ...r.recentes.map(j));
  return out;
}

const simNao = (v: boolean | null) => (v === null ? "?" : v ? "ouviu" : "NÃO");

/** As respostas "ouviu?" de uma falha, por mecanismo (a última respondida de cada um, no momento dado). */
export function respostasDaMatriz(o: Ocorrencia, momento: Momento): RespostasDaMatriz {
  const ultima = (letra: LetraDiferencial) =>
    [...o.diferenciais].reverse().find((d) => d.momento === momento && d.resultado.letra === letra && !d.indisponivel && d.ouviu !== null)?.ouviu ?? null;
  const doMotor = o.testes.filter((t) => t.momento === momento && t.ouviu !== null && t.resultado.qual !== "direto");
  const D = doMotor.length ? doMotor.some((t) => t.ouviu === true) : null;
  return { A: ultima("A"), "A′": ultima("A′"), B: ultima("B"), C: ultima("C"), D };
}

const CAMPOS_DO_SISTEMA = [
  "volumeMidia", "volumeMidiaMax", "midiaMuda", "volumeFixo", "modoCampainha", "modoAudio", "musicaAtiva",
  "saidas", "rotaAtual", "reproducoesAtivas", "reproducoesUsos", "webviewPacote", "webviewGestoExigido", "taxaNativa", "framesPorBuffer", "sdk", "erro",
];
function resumoDoSistema(s: EstadoDoSistema): string {
  const c = s.campos;
  return ["volumeMidia", "midiaMuda", "musicaAtiva", "reproducoesAtivas", "reproducoesUsos", "rotaAtual", "erro"]
    .filter((k) => k in c).map((k) => `${k}=${fmt(c[k])}`).join(" · ") || "(vazio)";
}
function linhasDoSistema(s: EstadoDoSistema | null, recuo: string): string[] {
  if (!s) return [`${recuo}(sem leitura — fora do APK debug no Android, ou ainda não lido)`];
  const c = s.campos;
  const vistos = CAMPOS_DO_SISTEMA.filter((k) => k in c);
  const resto = Object.keys(c).filter((k) => !CAMPOS_DO_SISTEMA.includes(k));
  const linhas = [`${recuo}${vistos.map((k) => `${k}=${fmt(c[k])}`).join(" · ")}`];
  if (resto.length) linhas.push(`${recuo}outros: ${resto.map((k) => `${k}=${fmt(c[k])}`).join(" · ")}`);
  return linhas;
}

/** Linhas de histórico no relatório (o anel tem 600; o texto precisa caber num WhatsApp). */
export const MAX_LINHAS_HISTORICO = 220;
export const MAX_PULSOS = 15;
/** Teto do texto inteiro (caracteres). */
export const MAX_RELATORIO = 120_000;

export function montarRelatorio(e: {
  ambiente: AmbienteDoRelatorio;
  diag: DiagnosticoDeAudio;
  agora: Retrato | null;
  trocas: TrocaRegistrada[];
  toques: RetratoGuardado[];
  ocorrencias: Ocorrencia[];
  sistemaAgora?: EstadoDoSistema | null;
  monitor?: ResumoDoMonitor | null;
}): string {
  const L: string[] = [];
  const amb = e.ambiente;
  const fita = e.diag.fita();
  const cont = e.diag.contagens();
  L.push("KING — DIAGNÓSTICO DE ÁUDIO (APK DEBUG de QA)");
  L.push(`Gerado: ${new Date().toISOString()} · diagnóstico desde ${e.diag.inicio || "?"} (+${(msDesdeOInicio() / 1000).toFixed(0)}s)`);
  L.push(`Versão: ${amb.versao ?? "?"} · build DEBUG: ${amb.build || "sem identificador"}`);
  L.push(`Aparelho: ${amb.plataforma} · ${amb.motor}${amb.webview ? " (WebView)" : ""}${amb.nativo ? " · app nativo" : ""} · tela ${amb.tela ?? "?"} · núcleos ${amb.nucleos ?? "?"} · memória ${amb.memoriaGb ?? "?"} GB · online ${fmt(amb.online)}`);
  L.push("LEITURA: o analisador (rms/pico) mede o SINAL DENTRO do grafo de áudio; ele NÃO prova que o alto-falante");
  L.push("tocou. \"ouviu\" é a resposta de quem testou. Indício ≠ causa comprovada.");
  L.push("GRAFO: barramentos (música, efeitos, reverb) → compressor → master → destination; o analisador escuta o");
  L.push("MASTER em derivação (depois do ganho master = o último nó antes do destination; nada passa por ele).");
  L.push("");

  L.push("== ESTADO ATUAL DO MOTOR ==");
  L.push(...linhasDoRetrato(e.agora));
  L.push("");

  L.push("== MONITOR CONTÍNUO DO RELÓGIO (rodada 8: razão e underruns por janela de ~5 s) ==");
  L.push(...linhasDoMonitor(e.monitor ?? null));
  L.push("");

  L.push("== CONTAGENS DESDE O INÍCIO ==");
  const c = (k: string) => cont[k] ?? 0;
  L.push(`  contextos: criados ${c("contexto-novo")} · fechados ${c("contexto-fechado")} · trocas ${c("reconstruir")} (ok ${c("reconstruir-ok")}, falhas ${c("reconstruir-falhou")})`);
  L.push(`  vigia: condenou ${c("vigia-condenou")} · parado ${c("vigia-parado")} · absolveu ${c("vigia-absolveu")} · resume recusado ${c("resume-recusado")} · compassos pulados ${c("compasso-pulado")}`);
  L.push(`  ciclo de vida: fundo ${c("fundo")} · volta ${c("volta")} · pause ${c("ev-pause")} · resume ${c("ev-resume")} · visibilidade ${c("ev-visibilitychange")} · blur ${c("ev-blur")} · focus ${c("ev-focus")} · freeze ${c("ev-freeze")}`);
  L.push(`  ações: 🔊 aberto ${c("painel-de-som-aberto")} · reativar ${c("reativar")} · religar ${c("religar")} · gestos ${c("gesto")} · falhas registradas ${c("falha-registrada")} · testes ${c("teste-de-som")}`);
  L.push("");

  L.push("== ÚLTIMA ATIVIDADE SONORA ==");
  const pulsos = fita.filter((r) => r.evento === "pulso");
  const comSom = [...pulsos].reverse().find((r) => typeof r.rms === "number" && r.rms > 0);
  const testeOk = [...fita].reverse().find((r) => r.evento === "teste-de-som-medido" && typeof r.rms === "number" && r.rms > 0);
  L.push(`  último pulso com sinal no grafo: ${comSom ? `${hora(comSom.t)} (rms ${fmt(comSom.rms)})` : "nenhum na fita"}`);
  L.push(`  último som de teste com sinal no grafo: ${testeOk ? `${hora(testeOk.t)} (${fmt(testeOk.qual)}, rms ${fmt(testeOk.rms)})` : "nenhum"}`);
  L.push(`  último compasso da música: ${e.agora?.compassoHaMs != null ? `há ${fmt(e.agora.compassoHaMs)} ms` : "—"}`);
  L.push("");

  L.push(`== FALHAS REGISTRADAS (${e.ocorrencias.length}) ==`);
  if (!e.ocorrencias.length) L.push("  nenhuma — quando o som sumir, toque em \"Registrar falha de som\" ANTES de qualquer outra coisa");
  for (const o of e.ocorrencias) {
    L.push(`--- FALHA #${o.n} às ${hora(o.t)} (+${(o.ms / 1000).toFixed(1)}s) ---`);
    L.push("A. ESTADO CAPTURADO DURANTE A FALHA (antes de qualquer tentativa de reparo)");
    L.push(`  A1 antes do toque no 🔊${o.abertura ? ` (${hora(o.abertura.t)})` : `: não houve — ${o.aberturaDescartada ?? "sem retrato"}`}`);
    if (o.abertura) L.push(...linhasDoRetrato(o.abertura.r));
    L.push(`  A2 antes do toque em "Registrar falha"${o.antesDoRegistro ? ` (${hora(o.antesDoRegistro.t)})` : ": sem retrato"}`);
    if (o.antesDoRegistro) L.push(...linhasDoRetrato(o.antesDoRegistro.r));
    L.push("  A3 no registro");
    L.push(...linhasDoRetrato(o.noRegistro));
    if (o.depoisDoPainel) {
      L.push(`  (o que o reparo do 🔊 deixou, ${hora(o.depoisDoPainel.t)})`);
      L.push(...linhasDoRetrato(o.depoisDoPainel.r));
    }
    L.push("B. SONS DE TESTE");
    if (!o.testes.length) L.push("  nenhum teste feito");
    for (const t of o.testes) {
      const d = t.resultado.durante;
      L.push(`  #${t.n} ${t.resultado.qual} (${t.momento}, ${hora(t.t)}): agendado=${t.resultado.tocou}${t.resultado.motivo ? ` (${t.resultado.motivo})` : ""}`
        + ` · rms antes=${fmt(t.resultado.antes.rms)} durante=${fmt(d?.rms)} · contexto=${fmt(d?.contexto ?? t.resultado.antes.contexto)}`
        + ` · relógio ${fmt(t.resultado.antes.relogio)}→${fmt(d?.relogio)} · ganho barramento=${fmt(t.resultado.qual === "musica" ? d?.ganhoMusica : d?.ganhoEfeitos)}`
        + ` · OUVIU: ${t.ouviu === null ? "sem resposta" : t.ouviu ? "SIM" : "NÃO"}`);
    }
    L.push("E. TESTES DIFERENCIAIS (em que camada o som some)");
    if (!o.diferenciais.length) L.push("  nenhum (A Web Audio isolado · A′ direto no contexto do jogo · B <audio> HTML5 · C nativo Android)");
    for (const d of o.diferenciais) {
      const r = d.resultado;
      L.push(`  #${d.n} ${r.letra} ${r.mecanismo} (${d.momento}, ${hora(d.t)}): aceitou=${r.aceitou}${r.erro ? ` · ERRO ${r.erro}` : ""} · OUVIU: ${d.indisponivel ? "— (não rodou)" : d.resultado.semOuvir ? "— (medição)" : d.ouviu === null ? "sem resposta" : d.ouviu ? "SIM" : "NÃO"}`);
      const tec = Object.entries(r.tecnico).map(([k, v]) => `${k}=${fmt(v)}`).join(" · ");
      if (tec) L.push(`     técnico: ${tec}`);
      if (d.sistemaDurante) L.push(`     Android durante: ${resumoDoSistema(d.sistemaDurante)}`);
    }
    for (const l of leituraDaRodada7(o)) L.push(`  ${l}`);
    for (const l of leituraDaRodada8(o)) L.push(`  ${l}`);
    for (const t of o.testes) if (t.sistemaDurante) L.push(`  (D #${t.n} ${t.resultado.qual}) Android durante: ${resumoDoSistema(t.sistemaDurante)}`);
    for (const m of ["antes-da-recuperacao", "depois-da-recuperacao"] as const) {
      const resp = respostasDaMatriz(o, m);
      if (Object.values(resp).every((v) => v === null)) continue;
      const mz = matrizDeDecisao(resp);
      L.push(`  MATRIZ (${m}): A=${simNao(resp.A)} A′=${simNao(resp["A′"])} B=${simNao(resp.B)} C=${simNao(resp.C)} D(KING)=${simNao(resp.D)} → ${mz.ramo}: investigar ${mz.investigar}`);
    }
    L.push("F. ÁUDIO DO SISTEMA ANDROID NO REGISTRO (só leitura)");
    L.push(...linhasDoSistema(o.sistemaNaFalha, "    "));
    L.push("C. DEPOIS DA TENTATIVA DE RECUPERAÇÃO");
    if (!o.recuperacao) L.push("  nenhuma tentativa pelo botão \"Tentar recuperar\"");
    else {
      L.push(`  antes (${hora(o.recuperacao.t)}):`);
      L.push(...linhasDoRetrato(o.recuperacao.antes));
      L.push("  ~1,5 s depois:");
      L.push(...linhasDoRetrato(o.recuperacao.depois));
    }
    L.push("INDÍCIOS (não são causa comprovada)");
    for (const i of indicios(o, e.diag)) L.push(`  ${i.h} ${i.nome}: ${i.sinal.toUpperCase()} — ${i.porque}`);
    if (o.toquesRecentes.length) {
      L.push("Retratos antes dos toques recentes:");
      for (const t of o.toquesRecentes) L.push(`  ${hora(t.t)} fase=${fmt(t.r.fase)} contexto=${fmt(t.r.contexto)} relógio=${fmt(t.r.relogio)} rms=${fmt(t.r.rms)} geração=${fmt(t.r.geracao)} música=${fmt(t.r.musicaAgendada)}`);
    }
    L.push("");
  }

  L.push("== ÁUDIO DO SISTEMA ANDROID (última leitura; volume de mídia, mudo, rota, reproduções ativas) ==");
  L.push(...linhasDoSistema(e.sistemaAgora ?? null, "  "));
  if (e.sistemaAgora?.eventos.length) {
    L.push(`  eventos do Android (últimos ${Math.min(40, e.sistemaAgora.eventos.length)}):`);
    for (const ev of e.sistemaAgora.eventos.slice(-40)) L.push(`    ${Object.entries(ev).map(([k, v]) => `${k}=${fmt(v)}`).join(" ")}`);
  }
  L.push("");

  L.push(`== TROCAS DE CONTEXTO (últimas ${e.trocas.length}) ==`);
  for (const t of e.trocas) {
    const r = (g: RetratoGuardado | null) => (g ? `${g.r.contexto ?? "—"}/relógio ${fmt(g.r.relogio)}/rms ${fmt(g.r.rms)}/geração ${fmt(g.r.geracao)}` : "—");
    L.push(`  ${hora(t.antes.t)} antes ${r(t.antes)} → ${t.falhou ? "FALHOU" : "depois"} ${r(t.depois)} → 1s ${r(t.umSegundoDepois)}`);
  }
  L.push("");

  L.push(`== PULSOS (a cada ~10 s; últimos ${Math.min(MAX_PULSOS, pulsos.length)}) ==`);
  for (const p of pulsos.slice(-MAX_PULSOS)) L.push(linhaDaFita(p));
  L.push("");

  const eventos = fita.filter((r) => r.evento !== "pulso");
  L.push(`== HISTÓRICO (últimos ${Math.min(MAX_LINHAS_HISTORICO, eventos.length)} de ${eventos.length} eventos na fita; mais recente por último) ==`);
  for (const r of eventos.slice(-MAX_LINHAS_HISTORICO)) L.push(linhaDaFita(r));

  let texto = limparDadosSensiveis(L.join("\n"));
  if (texto.length > MAX_RELATORIO) texto = `${texto.slice(0, MAX_RELATORIO)}\n…(cortado no limite de ${MAX_RELATORIO} caracteres)`;
  return texto;
}

/**
 * Cinto de segurança: o relatório é montado só com números e estados do áudio, mas, se algum dia algo
 * com cara de identidade entrar na fita, sai daqui riscado.
 */
export function limparDadosSensiveis(texto: string): string {
  return texto
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id removido]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail removido]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token removido]")
    .replace(/\bsb_(?:publishable|secret)_[\w-]+/gi, "[chave removida]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip removido]")
    .replace(/\b(?:wss?|https?):\/\/[^\s]+/gi, "[endereço removido]");
}

// ───────────────────────── exportar: copiar, compartilhar, ou o texto na tela ─────────────────────────

export type ResultadoDaCopia = "copiado" | "copiado-alternativo" | "falhou";
export type ResultadoDoCompartilhar = "compartilhado" | "cancelado" | "indisponivel" | "falhou";

interface NavegadorParaExportar {
  clipboard?: { writeText(t: string): Promise<void> };
  share?: (d: { title?: string; text?: string }) => Promise<void>;
}
interface DocumentoParaExportar {
  body: { appendChild(n: unknown): unknown; removeChild(n: unknown): unknown } | null;
  createElement(tag: "textarea"): { value: string; setAttribute(k: string, v: string): void; style: Record<string, string>; select(): void };
  execCommand?(cmd: string): boolean;
}

/** Copiar: a API moderna (com prazo — há WebView que nunca responde), depois o caminho antigo. */
export async function copiarTexto(texto: string, nav: NavegadorParaExportar | undefined, doc: DocumentoParaExportar | undefined, prazoMs = 1500): Promise<ResultadoDaCopia> {
  try {
    if (nav?.clipboard?.writeText) {
      const ok = await Promise.race([
        nav.clipboard.writeText(texto).then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), prazoMs)),
      ]);
      if (ok) return "copiado";
    }
  } catch { /* WebView sem permissão: tenta o caminho antigo */ }
  try {
    if (!doc?.body || typeof doc.execCommand !== "function") return "falhou";
    const ta = doc.createElement("textarea");
    ta.value = texto;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand("copy");
    doc.body.removeChild(ta);
    return ok ? "copiado-alternativo" : "falhou";
  } catch {
    return "falhou";
  }
}

export const podeCompartilhar = (nav: NavegadorParaExportar | undefined): boolean => typeof nav?.share === "function";

/** Compartilhar pela folha nativa (quando a WebView oferece). Cancelar não é erro. */
export async function compartilharTexto(texto: string, nav: NavegadorParaExportar | undefined): Promise<ResultadoDoCompartilhar> {
  if (!podeCompartilhar(nav)) return "indisponivel";
  try {
    await nav!.share!({ title: "KING — diagnóstico de áudio", text: texto });
    return "compartilhado";
  } catch (e) {
    return e instanceof Error && e.name === "AbortError" ? "cancelado" : "falhou";
  }
}
