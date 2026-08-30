// IDENTIDADE DE QUEM SENTA À MESA — validada pelo servidor, nunca declarada pelo cliente.
//
// ══ O QUE MUDOU, E POR QUÊ ══
//
// Até aqui o KING identificava CONEXÕES, não pessoas. Ao entrar numa sala o servidor sorteava um
// `playerId` novo com `generateId()`, e ele morria junto com a sala. Nome e avatar chegavam do
// cliente sem nenhuma prova de posse: quem falasse o protocolo entrava com o nome que quisesse.
// Serviu para uma sala privada entre amigos com código de quatro dígitos, e não serve para nada
// que precise LEMBRAR de alguém — progresso, estatística, conquista, cosmético.
//
// A identidade agora vem de fora, assinada, e o servidor só a aceita depois de conferir a
// assinatura. O princípio é curto:
//
//     o cliente pode APRESENTAR uma credencial;
//     o cliente NUNCA pode DECLARAR quem é.
//
// ══ POR QUE JWKS, E NÃO UM SEGREDO COMPARTILHADO ══
//
// A verificação usa a chave PÚBLICA do emissor, buscada no endpoint JWKS e trocada sozinha quando
// ele rotaciona. A alternativa — um segredo simétrico compartilhado entre o emissor e este
// processo — obrigaria a guardar aqui uma chave capaz de ASSINAR tokens, e não só de conferi-los.
// Um vazamento de leitura viraria vazamento de emissão: qualquer um poderia forjar a identidade
// de qualquer jogador. Com chave pública, o pior caso de um vazamento é alguém conseguir
// verificar tokens, que é o que este arquivo já faz de graça.
//
// Nada de verificação artesanal. `jose` é a biblioteca madura do ecossistema e trata as partes
// que costumam ser feitas errado à mão: `alg` confundível, `none`, cache de JWKS, tolerância de
// relógio, tempo constante.
//
// ══ PROVEDOR-NEUTRO DE PROPÓSITO ══
//
// O KING vai aceitar convidado, Google e, quando houver conta Apple, Apple. Todos chegam pelo
// MESMO emissor (o Supabase), e o que distingue é o claim — não o caminho de código. Assim o
// servidor não precisa saber quantos provedores existem, e acrescentar um não mexe aqui.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/** Como a pessoa provou quem é. `guest` é a sessão anônima: identidade real, sem conta. */
export type Provedor = "guest" | "google" | "apple" | "desconhecido";

export interface IdentidadeVerificada {
  /**
   * O `playerId` canônico — e ele é o `sub` do token, sem intermediários.
   *
   * Um segundo UUID próprio seria uma tabela de tradução a mais para manter em sincronia, com um
   * modo de falha silencioso (as duas se desencontram) e nenhum ganho: o `sub` já é imutável, já
   * é único e já é emitido por quem tem autoridade para isso.
   */
  playerId: string;
  provedor: Provedor;
  /** `true` quando a sessão é anônima — quem ainda não vinculou conta nenhuma. */
  convidado: boolean;
  /** Quando o token expira, em segundos desde a época. Só para diagnóstico. */
  expiraEm: number;
}

export interface ConfigDeIdentidade {
  /**
   * O emissor esperado, exatamente como aparece no claim `iss`.
   * Ex.: `https://<projeto>.supabase.co/auth/v1`
   */
  issuer: string;
  /** De onde vêm as chaves públicas. Normalmente `<issuer>/.well-known/jwks.json`. */
  jwks: URL;
  /** O `aud` esperado. O Supabase emite `authenticated` para sessão de usuário. */
  audience?: string;
}

/**
 * O motivo de uma recusa. Existe para o teste poder afirmar POR QUE algo foi recusado — um teste
 * que só sabe "deu erro" passa igual quando a implementação recusa tudo, inclusive o que devia
 * aceitar.
 */
export type MotivoDaRecusa =
  | "sem-token"
  | "assinatura-invalida"
  | "expirado"
  | "emissor-errado"
  | "algoritmo-inaceitavel"
  | "sem-subject";

export class IdentidadeRecusada extends Error {
  constructor(readonly motivo: MotivoDaRecusa, detalhe?: string) {
    super(`identidade recusada: ${motivo}${detalhe ? ` (${detalhe})` : ""}`);
    this.name = "IdentidadeRecusada";
  }
}

/**
 * SÓ ASSIMÉTRICO, E A LISTA É FECHADA.
 *
 * Deixar a lista aberta é o caminho clássico do ataque de confusão de algoritmo: um token forjado
 * chega dizendo `alg: HS256` e a verificação tenta usar a chave pública como se fosse segredo
 * simétrico — a chave pública, que qualquer um consegue. `jose` recusa por padrão, e a lista
 * explícita deixa a intenção escrita em vez de depender do padrão continuar sendo esse.
 */
const ALGORITMOS = ["ES256", "RS256"] as const;

/** Tolerância de relógio. Dois servidores nunca concordam ao milissegundo. */
const FOLGA_DE_RELOGIO = "30s";

/**
 * Descobre o provedor a partir dos claims. O Supabase marca sessão anônima com `is_anonymous` e
 * registra a origem em `app_metadata.provider`.
 */
export function provedorDe(claims: JWTPayload): { provedor: Provedor; convidado: boolean } {
  const anonimo = claims.is_anonymous === true;
  if (anonimo) return { provedor: "guest", convidado: true };
  const meta = claims.app_metadata as { provider?: string } | undefined;
  const bruto = meta?.provider;
  if (bruto === "google") return { provedor: "google", convidado: false };
  if (bruto === "apple") return { provedor: "apple", convidado: false };
  return { provedor: "desconhecido", convidado: false };
}

/**
 * O verificador. Guarda o conjunto de chaves entre chamadas — `createRemoteJWKSet` faz cache e
 * rebusca sozinho quando aparece um `kid` desconhecido, que é o que torna a rotação de chaves do
 * emissor transparente para este processo.
 */
export class VerificadorDeIdentidade {
  readonly #jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly cfg: ConfigDeIdentidade) {
    this.#jwks = createRemoteJWKSet(cfg.jwks);
  }

  async verificar(token: string | undefined): Promise<IdentidadeVerificada> {
    if (!token || token.trim() === "") throw new IdentidadeRecusada("sem-token");

    let claims: JWTPayload;
    try {
      const { payload } = await jwtVerify(token, this.#jwks, {
        issuer: this.cfg.issuer,
        audience: this.cfg.audience,
        algorithms: [...ALGORITMOS],
        clockTolerance: FOLGA_DE_RELOGIO,
      });
      claims = payload;
    } catch (e) {
      throw new IdentidadeRecusada(motivoDoErro(e), (e as Error)?.message);
    }

    // `sub` é o `playerId`. Sem ele o token pode estar perfeitamente assinado e não dizer de QUEM
    // é — que é a única coisa que se veio perguntar.
    const sub = typeof claims.sub === "string" ? claims.sub.trim() : "";
    if (!sub) throw new IdentidadeRecusada("sem-subject");

    const { provedor, convidado } = provedorDe(claims);
    return { playerId: sub, provedor, convidado, expiraEm: claims.exp ?? 0 };
  }
}

/**
 * Traduz o erro da biblioteca para o vocabulário deste módulo, sem vazar detalhe interno.
 *
 * PELO CÓDIGO E PELO CLAIM, NÃO POR SUBSTRING. A primeira versão procurava "exp" na mensagem — e
 * a tripwire a pegou classificando emissor errado como token expirado, porque `jose` diz
 * `unexpected "iss" claim value` e "unexpected" contém "exp". Casar pedaço de mensagem em inglês
 * é frágil por natureza: muda com a versão da biblioteca e cria falsos positivos como este.
 * `jose` expõe `code` e, na falha de claim, o `claim` que falhou. É neles que dá para confiar.
 */
function motivoDoErro(e: unknown): MotivoDaRecusa {
  const erro = e as { code?: string; claim?: string };
  if (erro?.code === "ERR_JWT_EXPIRED") return "expirado";
  if (erro?.code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    if (erro.claim === "iss") return "emissor-errado";
    if (erro.claim === "exp") return "expirado";
    return "assinatura-invalida";
  }
  if (erro?.code === "ERR_JOSE_ALG_NOT_ALLOWED") return "algoritmo-inaceitavel";
  return "assinatura-invalida";
}

/**
 * O VERIFICADOR EM USO — resolvido do ambiente na primeira pergunta, e substituível em teste.
 *
 * Ler o ambiente uma vez e guardar num `const` de módulo tornava o caminho da identidade
 * PERMANENTE impossível de exercitar: a sala captura o valor no `import`, muito antes de um
 * teste conseguir dizer qual emissor usar. E um caminho que não dá para testar é um caminho que
 * chega ao aparelho do jogador sem nunca ter rodado.
 *
 * O padrão é o mesmo de `match/tempos.ts`, já usado no projeto: uma leitura preguiçosa, um
 * ponto de configuração e uma restauração. Em produção ninguém chama os dois últimos, e o
 * comportamento é idêntico ao do `const`.
 */
let atual: VerificadorDeIdentidade | null | undefined;

export function verificadorEmUso(): VerificadorDeIdentidade | null {
  if (atual === undefined) atual = verificadorDoAmbiente();
  return atual;
}

/** SÓ PARA TESTE. Instala um verificador — ou `null` para simular ambiente sem provedor. */
export function configurarVerificador(v: VerificadorDeIdentidade | null): void { atual = v; }

/** SÓ PARA TESTE. Devolve a resolução ao ambiente. */
export function restaurarVerificador(): void { atual = undefined; }

/**
 * Monta o verificador a partir do ambiente, ou devolve `null` quando a identidade não está
 * configurada.
 *
 * `null` NÃO é falha: é o modo em que o KING roda hoje, com identidade efêmera por sala. A fase
 * de identidade permanente é aditiva — um servidor sem `SUPABASE_URL` continua atendendo
 * exatamente como antes, e é isso que permite implantar o código antes de existir projeto
 * Supabase, e testar tudo o que não depende dele.
 */
export function verificadorDoAmbiente(
  env: Record<string, string | undefined> = process.env,
): VerificadorDeIdentidade | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  if (!url) return null;
  const issuer = `${url}/auth/v1`;
  return new VerificadorDeIdentidade({
    issuer,
    jwks: new URL(`${issuer}/.well-known/jwks.json`),
    audience: env.SUPABASE_JWT_AUDIENCE?.trim() || "authenticated",
  });
}
