// A SONDA DA ATIVAÇÃO — o boot do progresso rodado UMA vez, FORA do servidor, contra um arquivo de
// configuração explícito (o `progress.env.pendente` da VPS, antes de virar o ativo).
//
// Não é uma imitação do boot: é o boot. Mesmo parser (`lerConfiguracaoDeProgresso`), mesma CA,
// mesmo repositório (`repositorioPg`, pool com TLS verificado) e a MESMA lógica de sonda do
// `ServicoDeProgresso` — inclusive a confirmação única do 28P01, 30 s depois. Medido no Supabase
// real: logo depois de trocar a senha, o pooler recusa a credencial certa uma vez. Quem absorve essa
// recusa é a sonda, e o restart do servidor que vem depois já encontra o pooler atualizado.
//
// O que a sonda NUNCA faz: creditar, ler ou escrever o outbox da configuração (usa um outbox vazio
// e descartável), fazer a meia-abertura de 10 min do disjuntor (cancela o que sobrar agendado) e
// imprimir qualquer VALOR — nem URL, nem senha, nem host, nem CA. Só estado, código e tentativas.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfiguracaoDeProgressoInvalida, lerConfiguracaoDeProgresso, type LeitorDeArquivo } from "./config.js";
import { classificarFalha, resumoSeguro, type ClasseDeFalha } from "./falhas.js";
import { OutboxDeProgresso } from "./outbox.js";
import { repositorioPg, type RepositorioDeProgresso } from "./repositorio.js";
import { ServicoDeProgresso } from "./servico.js";

/** Uma saída por desfecho. 78 é o mesmo código do boot com configuração incoerente. */
export const SAIDA_DA_SONDA = {
  closed: 0,
  open_auth: 10,
  open_circuit: 11,
  transitoria: 12,
  config_invalida: 78,
} as const;
export type DesfechoDaSonda = keyof typeof SAIDA_DA_SONDA;

export interface ResultadoDaSonda {
  desfecho: DesfechoDaSonda;
  saida: number;
  /** Quantas vezes o banco foi procurado. Teto: 2 (a sonda e a confirmação do 28P01). */
  tentativas: number;
  /** Uma entrada por tentativa: `ok` ou `código/classe` — nunca a mensagem do banco. */
  codigos: string[];
  /** Só em configuração inválida: o motivo, que por construção não carrega valor. */
  motivo?: string;
}

export interface OpcoesDaSonda {
  /** Caminho do arquivo de progresso a sondar. */
  arquivo: string;
  disco?: LeitorDeArquivo;
  /** Para teste: a dublê do repositório. Em produção, `repositorioPg` com a URL e a CA lidas. */
  criarRepositorio?: (c: { url: string; ca: string }) => RepositorioDeProgresso;
  /** Para teste: o agendador. O padrão MANTÉM o processo vivo durante a espera. */
  agendar?: (fn: () => void, ms: number) => void;
}

/**
 * O agendador da sonda. Ao contrário do servidor (que usa `unref`, para não segurar o desligamento),
 * aqui o timer PRECISA segurar o processo: com `unref`, o Node sairia no meio dos 30 s da
 * confirmação, sem erro e sem resultado.
 */
export function criarAgendador() {
  const timers: NodeJS.Timeout[] = [];
  return {
    timers,
    agendar(fn: () => void, ms: number) { timers.push(setTimeout(fn, ms)); },
    /** O que sobrou (a meia-abertura de 10 min do disjuntor) não é assunto da sonda. */
    cancelarTudo() { for (const t of timers) clearTimeout(t); },
  };
}

export async function sondarProgresso(o: OpcoesDaSonda): Promise<ResultadoDaSonda> {
  const invalida = (motivo: string): ResultadoDaSonda =>
    ({ desfecho: "config_invalida", saida: SAIDA_DA_SONDA.config_invalida, tentativas: 0, codigos: [], motivo });

  let config: ReturnType<typeof lerConfiguracaoDeProgresso>;
  try {
    config = lerConfiguracaoDeProgresso({ KING_PROGRESS_ENV_FILE: o.arquivo }, o.disco);
  } catch (e) {
    if (e instanceof ConfiguracaoDeProgressoInvalida) return invalida(e.message);
    throw e;
  }
  if (config.modo !== "database") {
    return invalida(config.motivo === "KING_PROGRESS_MODE=disabled"
      ? "KING_PROGRESS_MODE=disabled: não há o que sondar"
      : "arquivo de progresso não encontrado");
  }

  const real = (o.criarRepositorio ?? ((c) => repositorioPg({ connectionString: c.url, ca: c.ca })))({ url: config.url, ca: config.ca });
  const codigos: string[] = [];
  let ultima: ClasseDeFalha | "ok" = "ok";
  // O repositório que o serviço enxerga: o real, contado. Crédito é impossível por construção.
  const repo: RepositorioDeProgresso = {
    async sondar() {
      try {
        await real.sondar();
        codigos.push("ok");
        ultima = "ok";
      } catch (e) {
        codigos.push(resumoSeguro(e));
        ultima = classificarFalha(e);
        throw e;
      }
    },
    async creditar() { throw new Error("a sonda nunca credita"); },
    encerrar: () => real.encerrar(),
  };

  const padrao = o.agendar ? null : criarAgendador();
  const outboxVazio = mkdtempSync(join(tmpdir(), "king-sonda-"));
  try {
    const servico = new ServicoDeProgresso(new OutboxDeProgresso(outboxVazio), repo, {
      esperas: [], esperar: async () => {}, log: () => {},
      agendar: o.agendar ?? padrao!.agendar,
    });
    const { estado } = await servico.iniciar();
    // O serviço trata erro transitório no boot como `closed` (o retry por crédito cuida do resto).
    // A sonda responde outra pergunta — "conectou?" — e ali a resposta é não.
    const desfecho: DesfechoDaSonda = estado === "open_auth" ? "open_auth"
      : estado === "open_circuit" ? "open_circuit"
      : estado === "closed" && ultima === "ok" ? "closed"
      : "transitoria";
    return { desfecho, saida: SAIDA_DA_SONDA[desfecho], tentativas: codigos.length, codigos };
  } finally {
    padrao?.cancelarTudo();
    await real.encerrar().catch(() => {});
    rmSync(outboxVazio, { recursive: true, force: true });
  }
}

/** O que a linha de comando imprime. Só estado, código seguro e tentativas. */
export function linhasDaSonda(r: ResultadoDaSonda): string[] {
  const linhas: string[] = [];
  if (r.motivo) linhas.push(`[sonda] configuração inválida: ${r.motivo}`);
  linhas.push(`[sonda] tentativas: ${r.tentativas}${r.codigos.length ? ` — ${r.codigos.join(" → ")}` : ""}`);
  linhas.push(`[sonda] estado final: ${r.desfecho} (saída ${r.saida})`);
  return linhas;
}
