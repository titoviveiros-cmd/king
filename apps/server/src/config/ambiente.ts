// A CONFIGURAÇÃO DE IDENTIDADE DO SERVIDOR — declarada, persistente e à prova de shell.
//
// ══ O RISCO QUE ESTE ARQUIVO EXISTE PARA FECHAR ══
//
// O modo de identidade era DERIVADO de `SUPABASE_URL` estar no ambiente do processo. Na VPS esse
// ambiente vem de onde o PM2 o pegou: `pm2 restart king-server --update-env` relê o ambiente da
// SHELL que executou o comando. Uma shell nova, um deploy, um rollback ou um `pm2 resurrect` depois
// de um reboot sem a variável — e o servidor voltava ao MODO A em silêncio, aceitando qualquer um
// sem credencial num jogo que já tinha prometido identidade permanente.
//
// ══ O QUE MUDA ══
//
//   1. O MODO É DECLARADO: `KING_IDENTITY_MODE=legacy` ou `KING_IDENTITY_MODE=permanent`.
//   2. A declaração de produção mora num ARQUIVO fora do Git (`/etc/king/server.env`), que o
//      PRÓPRIO SERVIDOR lê no boot. Não importa como o processo foi (re)iniciado: o arquivo é lido
//      de novo, e para as chaves de identidade ele é a única fonte — nada da shell sobrevive.
//   3. FAIL CLOSED: `permanent` sem `SUPABASE_URL` válida é erro de configuração, e o processo não
//      sobe. Sob PM2 o arquivo é OBRIGATÓRIO. Nenhum caminho cai para `legacy` sozinho.
//   4. SEM CONFIGURAÇÃO NENHUMA (máquina local, CI, e2e), o comportamento é o de sempre.
//
// O servidor continua sem precisar de `service_role`, JWT secret ou chave privada: ele só confere
// assinaturas com a chave PÚBLICA do emissor. O arquivo recusa qualquer chave com cara de segredo.
import { existsSync, readFileSync } from "node:fs";

/** Onde a declaração de produção mora. Fora do repositório: sobrevive a reset, checkout e reboot. */
export const ARQUIVO_DE_AMBIENTE_PADRAO = "/etc/king/server.env";

/** As ÚNICAS chaves que o arquivo pode conter — e sobre as quais ele é a única fonte. */
export const CHAVES_DO_ARQUIVO = ["KING_IDENTITY_MODE", "SUPABASE_URL", "SUPABASE_JWT_AUDIENCE"] as const;

/** Nada disto pertence a este processo. Se aparecer no arquivo, é engano — e perigoso. */
const PROIBIDAS = /SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|SENHA/i;

export class ConfiguracaoInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ConfiguracaoInvalida";
  }
}

export type Ambiente = Record<string, string | undefined>;

/**
 * Lê o arquivo `CHAVE=valor`. Aceita comentário (`#`), linha vazia, `export ` na frente, aspas
 * em volta do valor, BOM e CRLF. Recusa linha malformada, chave repetida, chave fora da lista e
 * chave com cara de segredo — um arquivo que não faz o que parece fazer é pior que nenhum.
 *
 * As mensagens de erro citam a CHAVE e a LINHA, nunca o valor.
 */
export function lerArquivoDeAmbiente(texto: string): Record<string, string> {
  const saida: Record<string, string> = {};
  texto.replace(/^﻿/, "").split(/\r?\n/).forEach((bruta, i) => {
    const linha = bruta.trim();
    if (!linha || linha.startsWith("#")) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(linha);
    if (!m) throw new ConfiguracaoInvalida(`linha ${i + 1} do arquivo de ambiente não está no formato CHAVE=valor`);
    const chave = m[1];
    if (PROIBIDAS.test(chave)) {
      throw new ConfiguracaoInvalida(
        `o arquivo de ambiente não pode conter ${chave}: o servidor só confere assinaturas com a chave pública`,
      );
    }
    if (!(CHAVES_DO_ARQUIVO as readonly string[]).includes(chave)) {
      throw new ConfiguracaoInvalida(`chave não suportada no arquivo de ambiente: ${chave}`);
    }
    if (chave in saida) throw new ConfiguracaoInvalida(`chave repetida no arquivo de ambiente: ${chave}`);
    let valor = m[2].trim();
    if (valor.length >= 2 && ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'")))) {
      valor = valor.slice(1, -1);
    }
    saida[chave] = valor;
  });
  return saida;
}

export interface OrigemDoAmbiente {
  arquivo: string;
  carregado: boolean;
  exigido: boolean;
}

export interface SistemaDeArquivos {
  existe(caminho: string): boolean;
  ler(caminho: string): string;
}

const DISCO: SistemaDeArquivos = { existe: existsSync, ler: (p) => readFileSync(p, "utf8") };

/**
 * O AMBIENTE EFETIVO: o do processo, com as chaves de identidade tiradas do arquivo quando ele existe.
 *
 * QUANDO O ARQUIVO É OBRIGATÓRIO:
 *   · `KING_ENV_FILE` apontou para ele — quem aponta um caminho quer aquele arquivo;
 *   · o processo roda sob PM2. O PM2 injeta `pm_id` em todo processo que gerencia, venha o
 *     restart de onde vier; é um marcador que não depende da shell nem do que foi salvo.
 * Fora desses dois casos (máquina local, CI, e2e) a ausência do arquivo é o normal.
 *
 * QUANDO O ARQUIVO EXISTE, ELE É A FONTE — e precisa declarar o modo. As três chaves de identidade
 * da shell são DESCARTADAS antes de aplicar as do arquivo: uma `SUPABASE_URL` esquecida numa shell
 * não pode reativar nada, e uma ausente não pode desativar nada.
 */
export function carregarAmbiente(
  env: Ambiente, fs: SistemaDeArquivos = DISCO,
): { env: Ambiente; origem: OrigemDoAmbiente } {
  const apontado = env.KING_ENV_FILE?.trim();
  const arquivo = apontado || ARQUIVO_DE_AMBIENTE_PADRAO;
  const exigido = !!apontado || env.pm_id !== undefined;

  if (!fs.existe(arquivo)) {
    if (exigido) throw new ConfiguracaoInvalida(`arquivo de ambiente ausente: ${arquivo}`);
    return { env: { ...env }, origem: { arquivo, carregado: false, exigido } };
  }

  const doArquivo = lerArquivoDeAmbiente(fs.ler(arquivo));
  if (!doArquivo.KING_IDENTITY_MODE?.trim()) {
    throw new ConfiguracaoInvalida(`o arquivo de ambiente precisa declarar KING_IDENTITY_MODE (${arquivo})`);
  }
  const efetivo: Ambiente = { ...env };
  for (const chave of CHAVES_DO_ARQUIVO) delete efetivo[chave];
  Object.assign(efetivo, doArquivo);
  return { env: efetivo, origem: { arquivo, carregado: true, exigido } };
}

export type ModoDeIdentidade =
  | { modo: "legacy"; declarado: boolean }
  | { modo: "permanent"; declarado: boolean; url: string; audience: string };

const PLATEIA_PADRAO = "authenticated";

/** Só a origem do projeto, e só por HTTPS — `http://` apenas no loopback, para prova local. */
function validarUrl(bruta: string): string {
  let u: URL;
  try {
    u = new URL(bruta);
  } catch {
    throw new ConfiguracaoInvalida("SUPABASE_URL inválida: não é uma URL");
  }
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  if (!(u.protocol === "https:" || (u.protocol === "http:" && loopback))) {
    throw new ConfiguracaoInvalida("SUPABASE_URL inválida: precisa ser https://");
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) {
    throw new ConfiguracaoInvalida("SUPABASE_URL inválida: use só a origem do projeto (https://<ref>.supabase.co)");
  }
  return u.origin;
}

/**
 * O MODO, A PARTIR DO AMBIENTE EFETIVO. Nunca cai para `legacy` por falta de algo.
 *
 *   KING_IDENTITY_MODE   SUPABASE_URL      resultado
 *   (ausente)            (ausente/vazia)   legacy — local, CI e a VPS de hoje
 *   (ausente)            válida            permanent — o comportamento HISTÓRICO, preservado
 *   legacy               qualquer          legacy — o rollback não exige apagar a URL
 *   permanent            válida            permanent
 *   permanent            ausente/inválida  ERRO
 *   outro valor          qualquer          ERRO
 *
 * Por que o histórico (URL sem modo = permanent) foi preservado, e não transformado em erro:
 * nenhum ambiente real depende dele hoje, mas os testes e o T1 dependem, e a produção passa a
 * exigir a declaração explícita de outro jeito — o arquivo precisa declarar o modo, e o portão do
 * deploy recusa arquivo sem ele. Exigir o modo aqui também não fecharia risco novo: URL presente
 * nunca vira `legacy` em silêncio.
 */
export function resolverModoDeIdentidade(env: Ambiente): ModoDeIdentidade {
  const modo = env.KING_IDENTITY_MODE?.trim();
  const url = env.SUPABASE_URL?.trim() ?? "";
  const audience = env.SUPABASE_JWT_AUDIENCE?.trim() || PLATEIA_PADRAO;

  if (!modo) {
    if (!url) return { modo: "legacy", declarado: false };
    return { modo: "permanent", declarado: false, url: validarUrl(url), audience };
  }
  if (modo === "legacy") return { modo: "legacy", declarado: true };
  if (modo === "permanent") {
    if (!url) throw new ConfiguracaoInvalida("KING_IDENTITY_MODE=permanent exige SUPABASE_URL");
    return { modo: "permanent", declarado: true, url: validarUrl(url), audience };
  }
  throw new ConfiguracaoInvalida("KING_IDENTITY_MODE inválido: use legacy ou permanent");
}

/** Uma linha para log: o modo e se há URL — nunca o valor dela, nem nada mais do ambiente. */
export function resumoSeguro(m: ModoDeIdentidade, env: Ambiente, origem?: OrigemDoAmbiente): string {
  const url = m.modo === "permanent" ? "configured" : env.SUPABASE_URL?.trim() ? "ignored (legacy)" : "absent";
  const arquivo = !origem ? "" : origem.carregado ? ` · env file: loaded (${origem.arquivo})` : " · env file: absent";
  return `identity mode: ${m.modo}${m.declarado ? "" : " (not declared)"} · SUPABASE_URL: ${url}${arquivo}`;
}

/**
 * O que o BOOT faz: carrega o arquivo, resolve o modo e escreve de volta no ambiente do processo
 * SÓ as chaves de identidade — inclusive APAGANDO as que o arquivo não tem. Assim o que roda é
 * exatamente o que foi validado. Lança `ConfiguracaoInvalida` em qualquer incoerência.
 */
export function prepararIdentidade(
  alvo: Ambiente, fs: SistemaDeArquivos = DISCO,
): { modo: ModoDeIdentidade; origem: OrigemDoAmbiente; resumo: string } {
  const { env, origem } = carregarAmbiente(alvo, fs);
  const modo = resolverModoDeIdentidade(env);
  for (const chave of CHAVES_DO_ARQUIVO) {
    if (env[chave] === undefined) delete alvo[chave];
    else alvo[chave] = env[chave];
  }
  return { modo, origem, resumo: resumoSeguro(modo, env, origem) };
}
