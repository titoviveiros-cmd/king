// A CONTA DO JOGADOR — vincular, nunca trocar.
//
// ══ A REGRA QUE GOVERNA ESTE ARQUIVO ══
//
// O KING já autentica todo mundo: quem entra online vira um CONVIDADO de verdade no Supabase, e
// o `playerId` da mesa é o `sub` desse convidado. Ligar o Google aqui não é "fazer login" — é
// pendurar uma identidade Google NO MESMO usuário. O `auth.users.id` antes e depois tem de ser o
// mesmo, ou o jogador perderia tudo que é dele com um clique bem-intencionado.
//
// Por isso este arquivo NUNCA chama `signInWithOAuth`: aquilo é "entrar", e entrar com um Google
// que ainda não pertence ao convidado cria OUTRO usuário. A operação é `linkIdentity`, que exige
// sessão e prende a identidade nova ao usuário que já está lá.
//
// ══ O QUE ESTE ARQUIVO SE RECUSA A FAZER ══
//
//   • criar convidado durante o retorno do OAuth — ver `concluirRetornoOAuth`;
//   • aceitar um usuário diferente do que iniciou o vínculo (fecha, não conserta);
//   • declarar vínculo sem a identidade Google aparecer em `getUserIdentities`;
//   • guardar qualquer token, do Google ou do Supabase;
//   • mandar o jogador para uma URL que não seja deste mesmo site.
//
// ══ O QUE VAI PARA O ARMAZENAMENTO ══
//
// Uma linha, sem segredo nenhum: qual usuário iniciou, qual provedor, e quando. É ela que permite
// comparar o "antes" com o "depois" quando o navegador volta do Google — e é ela que falta quando
// alguém abre a URL de retorno por conta própria, caso em que o vínculo simplesmente não acontece.
import type { IdentidadeVinculada, PortaDeAutenticacao } from "./clienteSupabase.js";
import { nonceDoIdToken, type FonteDeCredencialNativa } from "./credencialNativa.js";

export type EstadoDaConta = "guest" | "google" | "apple" | "indisponivel" | "processando" | "erro";

/** Os provedores que podem ser PENDURADOS no convidado. Nenhum deles "entra" — todos vinculam. */
export type ProvedorVinculavel = "google" | "apple";

/** Por que o vínculo não aconteceu. A UI traduz isto para uma frase neutra. */
export type MotivoDaFalha =
  | "indisponivel"
  | "sem-sessao"
  | "sem-transacao"
  | "callback-invalido"
  | "troca-de-usuario"
  | "nao-vinculado"
  | "provedor-recusou"
  /** O jogador fechou a tela do Google/Apple. Nada mudou. */
  | "cancelado"
  /** Esse Google/Apple já pertence a OUTRO jogador do KING. Não se funde, não se troca: o convidado segue. */
  | "identidade-de-outra-conta"
  /** Há sessão guardada, mas ela não se lê agora (renovação falhando): "agora não", nunca "convidado novo". */
  | "sessao-indisponivel";

/** O ID token que o app nativo obteve, mais o nonce BRUTO cujo hash está dentro dele. */
export interface CredencialDeVinculo {
  idToken: string;
  nonce: string;
  accessToken?: string;
}

export type ResultadoDoVinculo =
  | { ok: true; jaVinculado: boolean; userId: string }
  | { ok: false; motivo: MotivoDaFalha };

export type ResultadoDoInicio =
  | { ok: true; jaVinculado: true }
  | { ok: true; jaVinculado: false; url: string | null }
  | { ok: false; motivo: MotivoDaFalha };

export type ResultadoDoRetorno =
  | { tipo: "nada" }
  | { tipo: "vinculado"; userId: string }
  | { tipo: "erro"; motivo: MotivoDaFalha };

/** Um armazenamento de chave-valor que pode não existir (aba anônima travada). */
export interface ArmazenamentoSimples {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

export interface DependenciasDaConta {
  /** A porta compartilhada, ou `null` quando esta publicação não tem identidade configurada. */
  porta: () => Promise<PortaDeAutenticacao | null>;
  armazenamento: () => ArmazenamentoSimples | null;
  /** A URL desta página agora. */
  urlAtual: () => string;
  /** Troca a URL da barra de endereços sem recarregar (limpeza do `code`). */
  trocarUrl: (nova: string) => void;
  /** Rodando dentro do app (Capacitor)? Lá o OAuth por redirecionamento não existe. */
  nativo?: () => boolean;
}

export const CHAVE_DA_TRANSACAO = "king:vinculo";
/** O marcador de retorno. Fica na query porque o SPA não precisa de rota nova para reconhecê-lo. */
export const PARAM_RETORNO = "conta";
const PROVEDOR = "google";

interface Transacao { expectedUserId: string; provider: string; criadoEm: number }

/** Diagnóstico nunca mostra id inteiro. */
export const mascarar = (id?: string | null): string =>
  id && id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : "∅";

/**
 * A URL DE RETORNO — deste site, sempre.
 *
 * Construída a partir da origem atual, e nunca de um parâmetro recebido. Um "para onde voltar"
 * vindo de fora é um redirecionamento aberto: bastaria alguém mandar o link certo para o retorno
 * do OAuth cair noutro domínio.
 */
/**
 * O caminho do RETORNO, fora da raiz (Fase 9): o App Link do Android cobre a raiz ("/", o convite) e,
 * com o app instalado, capturaria a volta do Google no Chrome — e o vínculo pela web quebraria. O SPA
 * serve qualquer caminho, e o retorno é reconhecido pelo marcador, não pelo caminho.
 */
export const CAMINHO_DO_RETORNO = "/vincular";

export function urlDeRetorno(origem: string): string {
  const u = new URL(origem);
  u.pathname = CAMINHO_DO_RETORNO;
  u.search = `?${PARAM_RETORNO}=${PROVEDOR}`;
  u.hash = "";
  return u.toString();
}

/** Um destino só é aceito se for deste mesmo site. Qualquer outro vira a Home. */
export function destinoInterno(pedido: string | null | undefined, origem: string): string {
  if (!pedido) return "/";
  try {
    const alvo = new URL(pedido, origem);
    return alvo.origin === new URL(origem).origin ? `${alvo.pathname}${alvo.search}${alvo.hash}` : "/";
  } catch {
    return "/";
  }
}

/** A mesma URL sem nada do OAuth — nem `code`, nem `sb_flow_id`, nem o marcador. */
export function urlLimpa(url: string): string {
  const u = new URL(url);
  for (const p of ["code", "sb_flow_id", "error", "error_code", "error_description", PARAM_RETORNO]) {
    u.searchParams.delete(p);
  }
  u.hash = "";
  // A volta do Google termina na Home: o caminho do retorno não fica na barra.
  if (u.pathname === CAMINHO_DO_RETORNO) u.pathname = "/";
  return `${u.pathname}${u.search}${u.hash}`;
}

const temProvedor = (identidades: IdentidadeVinculada[] | undefined, provedor: string, userId?: string): boolean =>
  (identidades ?? []).some((i) => i.provider === provedor && (!userId || !i.user_id || i.user_id === userId));
const temGoogle = (identidades: IdentidadeVinculada[] | undefined, userId?: string): boolean =>
  temProvedor(identidades, PROVEDOR, userId);

/** O Supabase avisa assim quando a identidade já pertence a outro usuário. */
const JA_PERTENCE_A_OUTRO = "identity_already_exists";

export function criarConta(d: DependenciasDaConta) {
  const lerTransacao = (): Transacao | null => {
    try {
      const bruto = d.armazenamento()?.getItem(CHAVE_DA_TRANSACAO);
      if (!bruto) return null;
      const t = JSON.parse(bruto) as Partial<Transacao>;
      return typeof t?.expectedUserId === "string" && t.expectedUserId.length > 0 && t.provider === PROVEDOR
        ? { expectedUserId: t.expectedUserId, provider: PROVEDOR, criadoEm: Number(t.criadoEm) || 0 }
        : null;
    } catch { return null; }
  };
  const apagarTransacao = () => { try { d.armazenamento()?.removeItem(CHAVE_DA_TRANSACAO); } catch { /* sem storage */ } };

  /**
   * O estado da conta, sem efeito nenhum.
   *
   * NÃO cria convidado: perguntar "quem sou eu?" não pode criar ninguém. Sem sessão, a resposta é
   * `guest` — é o que o jogador vira no instante em que entrar online, e a Home não muda por isso.
   */
  async function obterEstadoDaConta(): Promise<EstadoDaConta> {
    try {
      const porta = await d.porta();
      if (!porta) return "indisponivel";
      const sessao = (await porta.getSession()).data.session;
      const userId = sessao?.user?.id;
      if (!sessao || !userId) return "guest";
      const { data } = await porta.getUserIdentities();
      if (temGoogle(data?.identities, userId)) return "google";
      return temProvedor(data?.identities, "apple", userId) ? "apple" : "guest";
    } catch {
      return "erro";
    }
  }

  /**
   * Começa o vínculo. Quem segue daqui é o navegador: o SDK leva o jogador para o Google.
   *
   * A sessão é EXIGIDA, e a ausência dela é falha — jamais motivo para criar um convidado. Criar
   * um aqui seria o pior desfecho possível: o Google acabaria vinculado a um usuário recém-nascido
   * e o jogador voltaria dono de uma conta vazia, com a antiga órfã.
   */
  async function vincularGoogle(): Promise<ResultadoDoInicio> {
    // No APP isto não existe: o Google recusa OAuth em WebView embutido, e a origem do app
    // (`https://localhost` / `capacitor://localhost`) não é endereço de retorno. Lá o vínculo é
    // `vincularNoApp`, com o ID token do plugin nativo.
    if (d.nativo?.()) return { ok: false, motivo: "indisponivel" };
    let porta: PortaDeAutenticacao | null = null;
    try { porta = await d.porta(); } catch { return { ok: false, motivo: "indisponivel" }; }
    if (!porta) return { ok: false, motivo: "indisponivel" };
    try {
      const sessao = (await porta.getSession()).data.session;
      const userId = sessao?.user?.id;
      if (!sessao || !userId) return { ok: false, motivo: "sem-sessao" };

      const { data: identidades } = await porta.getUserIdentities();
      if (temGoogle(identidades?.identities, userId)) return { ok: true, jaVinculado: true };

      const transacao: Transacao = { expectedUserId: userId, provider: PROVEDOR, criadoEm: Date.now() };
      try { d.armazenamento()?.setItem(CHAVE_DA_TRANSACAO, JSON.stringify(transacao)); } catch { /* sem storage */ }

      const { data, error } = await porta.linkIdentity({
        provider: PROVEDOR,
        options: { redirectTo: urlDeRetorno(new URL(d.urlAtual()).origin) },
      });
      if (error) { apagarTransacao(); return { ok: false, motivo: "provedor-recusou" }; }
      return { ok: true, jaVinculado: false, url: data?.url ?? null };
    } catch {
      apagarTransacao();
      return { ok: false, motivo: "provedor-recusou" };
    }
  }

  /**
   * O RETORNO DO GOOGLE. O ponto mais perigoso da fase inteira, e por isso o mais fechado.
   *
   * Ordem: reconhecer que a URL é nossa → exigir a transação que ESTE navegador gravou → trocar o
   * código pela sessão → comparar o usuário que voltou com o que saiu → só então aceitar. Qualquer
   * desvio encerra sem vínculo, e a URL é limpa em todos os caminhos, inclusive nos de erro: um
   * `code` que sobrevive na barra de endereços é um retorno que alguém repete sem querer.
   */
  async function concluirRetornoOAuth(): Promise<ResultadoDoRetorno> {
    const url = d.urlAtual();
    let parametros: URLSearchParams;
    try { parametros = new URL(url).searchParams; } catch { return { tipo: "nada" }; }
    if (parametros.get(PARAM_RETORNO) !== PROVEDOR) return { tipo: "nada" };

    const encerrar = <T extends ResultadoDoRetorno>(r: T): T => {
      try { d.trocarUrl(urlLimpa(url)); } catch { /* histórico indisponível: segue */ }
      return r;
    };

    if (parametros.get("error")) {
      apagarTransacao();
      if (parametros.get("error_code") !== JA_PERTENCE_A_OUTRO) return encerrar({ tipo: "erro", motivo: "provedor-recusou" });
      // "já vinculada" pode ser deste MESMO jogador (toque duplo, corrida): a identidade decide.
      try {
        const porta = await d.porta();
        const sessao = porta ? (await porta.getSession()).data.session : null;
        const userId = sessao?.user?.id;
        if (porta && userId && temGoogle((await porta.getUserIdentities()).data?.identities, userId)) {
          return encerrar({ tipo: "vinculado", userId });
        }
      } catch { /* sem como conferir: cai no aviso abaixo */ }
      return encerrar({ tipo: "erro", motivo: "identidade-de-outra-conta" });
    }
    const codigo = parametros.get("code");
    if (!codigo) { apagarTransacao(); return encerrar({ tipo: "erro", motivo: "callback-invalido" }); }

    // A TRANSAÇÃO VEM PRIMEIRO. Sem ela não há "antes" com que comparar o "depois", e um vínculo
    // sem comparação é exatamente o que esta fase existe para impedir.
    const transacao = lerTransacao();
    if (!transacao) return encerrar({ tipo: "erro", motivo: "sem-transacao" });

    try {
      const porta = await d.porta();
      if (!porta) return encerrar({ tipo: "erro", motivo: "indisponivel" });

      const { data, error } = await porta.exchangeCodeForSession(codigo);
      if (error) { apagarTransacao(); return encerrar({ tipo: "erro", motivo: "callback-invalido" }); }
      const novoUserId = data?.session?.user?.id ?? data?.user?.id ?? undefined;
      if (!novoUserId) { apagarTransacao(); return encerrar({ tipo: "erro", motivo: "callback-invalido" }); }

      // A TRAVA. Usuário diferente do que iniciou = erro material. Não se conserta, não se funde,
      // não se copia progresso: fecha-se a porta e avisa-se.
      if (novoUserId !== transacao.expectedUserId) {
        apagarTransacao();
        return encerrar({ tipo: "erro", motivo: "troca-de-usuario" });
      }

      // A PROVA DO VÍNCULO é a identidade associada ao usuário, não o que o token diz de si.
      const { data: identidades } = await porta.getUserIdentities();
      if (!temGoogle(identidades?.identities, novoUserId)) {
        apagarTransacao();
        return encerrar({ tipo: "erro", motivo: "nao-vinculado" });
      }

      apagarTransacao();
      return encerrar({ tipo: "vinculado", userId: novoUserId });
    } catch {
      apagarTransacao();
      return encerrar({ tipo: "erro", motivo: "callback-invalido" });
    }
  }

  /**
   * O VÍNCULO POR CREDENCIAL — a camada comum de Google e Apple (`linkProvider`, conceitualmente).
   *
   * As mesmas travas do retorno da web, sem redirecionamento: a sessão do convidado é EXIGIDA (e
   * nunca criada aqui); a identidade nova entra por `linkIdentity` sobre ela; o usuário que volta
   * tem de ser o mesmo que saiu; e só a identidade em `getUserIdentities` prova o vínculo. Se o
   * Google/Apple já for de OUTRO jogador, nada se funde nem se troca — o convidado segue o mesmo.
   * Nenhum token é guardado: o ID token vai direto para o Supabase.
   */
  async function vincularComCredencial(provedor: ProvedorVinculavel, c: CredencialDeVinculo): Promise<ResultadoDoVinculo> {
    let porta: PortaDeAutenticacao | null = null;
    try { porta = await d.porta(); } catch { return { ok: false, motivo: "indisponivel" }; }
    if (!porta) return { ok: false, motivo: "indisponivel" };
    try {
      const sessao = (await porta.getSession()).data.session;
      const userId = sessao?.user?.id;
      if (!sessao || !userId) return { ok: false, motivo: "sem-sessao" };

      const { data: antes } = await porta.getUserIdentities();
      if (temProvedor(antes?.identities, provedor, userId)) return { ok: true, jaVinculado: true, userId };

      const { data, error } = await porta.linkIdentity({
        provider: provedor,
        token: c.idToken,
        nonce: c.nonce,
        ...(c.accessToken ? { access_token: c.accessToken } : {}),
      });
      if (error) {
        if (error.code !== JA_PERTENCE_A_OUTRO) return { ok: false, motivo: "provedor-recusou" };
        // "já vinculada" pode ser deste MESMO jogador (toque duplo, corrida): a identidade decide.
        const { data: agora } = await porta.getUserIdentities();
        return temProvedor(agora?.identities, provedor, userId)
          ? { ok: true, jaVinculado: true, userId }
          : { ok: false, motivo: "identidade-de-outra-conta" };
      }
      const depois = data?.session?.user?.id ?? data?.user?.id ?? undefined;
      if (depois && depois !== userId) return { ok: false, motivo: "troca-de-usuario" };

      const { data: identidades } = await porta.getUserIdentities();
      if (!temProvedor(identidades?.identities, provedor, userId)) return { ok: false, motivo: "nao-vinculado" };
      return { ok: true, jaVinculado: false, userId };
    } catch {
      return { ok: false, motivo: "provedor-recusou" };
    }
  }

  /**
   * O VÍNCULO NO APP: confere a sessão ANTES de abrir a tela do Google/Apple, gera o nonce, pede a
   * credencial ao plugin nativo e entrega à camada comum.
   *
   * APARELHO NOVO (Fase 9, red team): sem sessão NENHUMA guardada, o convidado nasce aqui — depois de
   * a credencial chegar, para um cancelamento não criar ninguém — e é a ELE que o login se liga. É a
   * mesma regra de `token()` ("entrar para jogar pode criar convidado"): sem isso, quem instala e toca
   * em "Continuar com a Apple" (o revisor da App Store, por exemplo) só veria um erro. Já uma sessão
   * GUARDADA que não se lê agora (renovação falhando) nunca vira convidado novo: é "agora não".
   */
  async function vincularNoApp(
    provedor: ProvedorVinculavel,
    fonte: FonteDeCredencialNativa | null,
    novoNonce: () => Promise<{ bruto: string; hash: string }>,
  ): Promise<ResultadoDoVinculo> {
    if (!fonte) return { ok: false, motivo: "indisponivel" };
    let porta: PortaDeAutenticacao | null = null;
    try { porta = await d.porta(); } catch { return { ok: false, motivo: "indisponivel" }; }
    if (!porta) return { ok: false, motivo: "indisponivel" };
    try {
      const atual = await porta.getSession();
      if (atual.error) return { ok: false, motivo: "sessao-indisponivel" };
      const sessao = atual.data.session;
      const userId = sessao?.user?.id;
      if (sessao && !userId) return { ok: false, motivo: "sem-sessao" };
      const aparelhoNovo = !sessao;
      if (userId) {
        const { data: ids } = await porta.getUserIdentities();
        if (temProvedor(ids?.identities, provedor, userId)) return { ok: true, jaVinculado: true, userId };
      }
      // Até duas tentativas: o SDK nativo pode devolver um token EM CACHE, de outro pedido, cujo
      // nonce não é o deste. Ele nem vai ao Supabase: esquece-se a credencial e pede-se de novo, uma vez.
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        const nonce = await novoNonce();
        const r = await fonte.obter(provedor, nonce.hash);
        if (r.tipo === "cancelado") return { ok: false, motivo: "cancelado" };
        if (r.tipo === "erro" || !r.credencial.idToken) return { ok: false, motivo: "provedor-recusou" };
        const noToken = nonceDoIdToken(r.credencial.idToken);
        if (noToken !== undefined && noToken !== nonce.hash) {
          await fonte.esquecer?.(provedor);
          continue;
        }
        if (aparelhoNovo) {
          const novo = await porta.signInAnonymously();
          if (!novo.data.session?.user?.id) return { ok: false, motivo: "indisponivel" };
        }
        return await vincularComCredencial(provedor, {
          idToken: r.credencial.idToken,
          nonce: nonce.bruto,
          ...(r.credencial.accessToken ? { accessToken: r.credencial.accessToken } : {}),
        });
      }
      return { ok: false, motivo: "provedor-recusou" };
    } catch {
      return { ok: false, motivo: "provedor-recusou" };
    }
  }

  return { obterEstadoDaConta, vincularGoogle, concluirRetornoOAuth, vincularComCredencial, vincularNoApp };
}

export type ContaDoJogador = ReturnType<typeof criarConta>;
