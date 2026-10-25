// "JÁ TENHO UMA CONTA" — entrar numa conta KING que já existe, sem nunca criar outra.
//
// ══ O PROBLEMA ══
//
// Quem troca de aparelho, reinstala o app ou limpa os dados volta como convidado NOVO. Se tinha
// vinculado Google ou Apple, a conta antiga existe — e é ela que o jogador quer de volta. "Vincular
// conta" não serve: aquilo pendura a identidade no convidado ATUAL, e o Supabase recusaria (a
// identidade já é de outro usuário). O caminho é ENTRAR na conta antiga. Mas "entrar" com Google ou
// Apple, no Supabase, CRIA um usuário quando a identidade não existe — e uma conta paralela, vazia,
// é exatamente o que esta fase existe para impedir.
//
// ══ A REGRA ══
//
//   1. A tentativa acontece num cliente ISOLADO, sem persistência (`portaIsolada`): a sessão
//      guardada no aparelho — a do convidado — não é tocada até o fim.
//   2. Uma identidade que não pertence a jogador nenhum é RECUSADA no servidor pelo gancho
//      "conta só nasce como convidado" (supabase/migrations/20261025120000_…). Defesa em
//      profundidade: se a conta que voltou NASCEU naquele instante com aquela identidade, ela é
//      desfeita (excluída, com o próprio token) e nunca adotada.
//   3. A conta que voltou é a mesma deste aparelho? Nada a trocar.
//   4. O convidado tem progresso (ou não deu para conferir)? O jogador CONFIRMA antes. Cancelar
//      revoga a sessão nova e deixa tudo como estava.
//   5. Só então a sessão principal é trocada — e só vale se a troca for conferida.
//
// Falha ou cancelamento NUNCA apagam o convidado. Google e Apple seguem a mesma política.
import type { PortaDeAutenticacao, PortaIsolada, SessaoSupabase, UsuarioSupabase } from "./clienteSupabase.js";
import { nonceDoIdToken, type FonteDeCredencialNativa, type ProvedorNativo } from "./credencialNativa.js";

export type MotivoDaRecuperacao =
  | "indisponivel"
  | "cancelado"
  /** Nenhuma conta KING tem esse Google/Apple. Nada foi criado; o convidado segue. */
  | "conta-nao-encontrada"
  | "provedor-recusou"
  | "erro-de-rede"
  /** Já há uma tentativa em curso (toque duplo). Silencioso na tela. */
  | "em-andamento";

/** O que o jogador perderia neste aparelho, para a tela de confirmação. `null` = não deu para conferir. */
export interface ProgressoEmJogo { nivel: number; xpTotal: number }

export type ResultadoDaRecuperacao =
  | { tipo: "recuperada"; userId: string }
  | { tipo: "ja-e-esta" }
  | {
      tipo: "confirmar";
      /** O progresso deste aparelho, ou `null` quando não deu para ler (pede confirmação do mesmo jeito). */
      progresso: ProgressoEmJogo | null;
      /** A conta atual já está vinculada (volta depois pelo login) ou é um convidado (fica para trás). */
      atualVinculada: boolean;
      confirmar(): Promise<ResultadoDaRecuperacao>;
      cancelar(): Promise<void>;
    }
  | { tipo: "falhou"; motivo: MotivoDaRecuperacao };

export interface DependenciasDaRecuperacao {
  principal: () => Promise<PortaDeAutenticacao | null>;
  /** Um cliente isolado NOVO a cada chamada. */
  isolada: () => Promise<PortaIsolada | null>;
  fonte: () => FonteDeCredencialNativa | null;
  novoNonce: () => Promise<{ bruto: string; hash: string }>;
  /** O progresso da sessão PRINCIPAL (o convidado atual), ou `null` se não deu para ler. */
  progressoAtual: () => Promise<ProgressoEmJogo | null>;
  /** Exclui a conta dona deste token (a que nasceu por engano). `true` se ficou excluída. */
  desfazerContaRecemCriada: (accessToken: string) => Promise<boolean>;
  /** O que pertencia ao jogador anterior e não vale para o novo (ex.: "voltar para a minha sala"). */
  esquecerJogadorAnterior?: () => void;
}

/**
 * Quanto tempo entre o nascimento do usuário e o da identidade ainda é "nasceram juntos". Um
 * usuário criado por `signInWithIdToken` nasce na MESMA transação da identidade (diferença de
 * milissegundos); um convidado que vinculou depois tem, no mínimo, o tempo de abrir a tela do
 * provedor e escolher a conta.
 */
export const NASCERAM_JUNTOS_MS = 1500;

/** A conta que voltou nasceu AGORA, já com esta identidade? (Então não é uma conta KING.) */
export function nasceuComEstaIdentidade(usuario: UsuarioSupabase | null | undefined, provedor: ProvedorNativo): boolean {
  if (!usuario?.created_at) return false;
  const identidade = (usuario.identities ?? []).find((i) => i.provider === provedor);
  if (!identidade?.created_at) return false;
  const u = Date.parse(usuario.created_at);
  const i = Date.parse(identidade.created_at);
  return Number.isFinite(u) && Number.isFinite(i) && Math.abs(i - u) < NASCERAM_JUNTOS_MS;
}

/** A recusa do gancho do servidor (403 com a mensagem do KING). */
const recusaDoGancho = (e: { message?: string; status?: number } | null): boolean =>
  !!e && (e.status === 403 || e.status === 422 || e.status === 400) && /KING/.test(e.message ?? "");
const erroDeRede = (e: { status?: number; name?: string } | null): boolean =>
  !!e && (e.status === 0 || e.name === "AuthRetryableFetchError" || (e.status ?? 0) >= 500);

export function criarRecuperacao(d: DependenciasDaRecuperacao) {
  let emCurso = false;

  async function recuperar(provedor: ProvedorNativo): Promise<ResultadoDaRecuperacao> {
    if (emCurso) return { tipo: "falhou", motivo: "em-andamento" };
    emCurso = true;
    try {
      return await tentar(provedor);
    } finally {
      emCurso = false;
    }
  }

  async function tentar(provedor: ProvedorNativo): Promise<ResultadoDaRecuperacao> {
    const fonte = d.fonte();
    if (!fonte || !(fonte.provedores ?? []).includes(provedor)) return { tipo: "falhou", motivo: "indisponivel" };
    let principal: PortaDeAutenticacao | null = null;
    try { principal = await d.principal(); } catch { principal = null; }
    if (!principal) return { tipo: "falhou", motivo: "indisponivel" };

    // QUEM É O JOGADOR AGORA. Uma renovação falhando (rede) não é "sem jogador": é "agora não".
    let atual: SessaoSupabase | null = null;
    try {
      const r = await principal.getSession();
      if (r.error) return { tipo: "falhou", motivo: "erro-de-rede" };
      atual = r.data.session;
    } catch {
      return { tipo: "falhou", motivo: "erro-de-rede" };
    }
    const atualId = atual?.user?.id ?? null;

    // A CREDENCIAL, com nonce (até duas tentativas, se o SDK nativo devolver um token de outro pedido).
    let credencial: { idToken: string; accessToken?: string } | null = null;
    let nonceBruto = "";
    for (let tentativa = 0; tentativa < 2 && !credencial; tentativa++) {
      const nonce = await d.novoNonce();
      const r = await fonte.obter(provedor, nonce.hash);
      if (r.tipo === "cancelado") return { tipo: "falhou", motivo: "cancelado" };
      if (r.tipo === "erro" || !r.credencial.idToken) return { tipo: "falhou", motivo: "provedor-recusou" };
      const noToken = nonceDoIdToken(r.credencial.idToken);
      if (noToken !== undefined && noToken !== nonce.hash) { await fonte.esquecer?.(provedor); continue; }
      credencial = r.credencial;
      nonceBruto = nonce.bruto;
    }
    if (!credencial) return { tipo: "falhou", motivo: "provedor-recusou" };

    // A TENTATIVA, NO CLIENTE ISOLADO. A sessão do aparelho não é tocada.
    const isolada = await d.isolada().catch(() => null);
    if (!isolada) return { tipo: "falhou", motivo: "indisponivel" };
    let sessao: SessaoSupabase | null = null;
    let usuario: UsuarioSupabase | null = null;
    try {
      const { data, error } = await isolada.signInWithIdToken({
        provider: provedor,
        token: credencial.idToken,
        nonce: nonceBruto,
        ...(credencial.accessToken ? { access_token: credencial.accessToken } : {}),
      });
      if (error) {
        if (recusaDoGancho(error)) return { tipo: "falhou", motivo: "conta-nao-encontrada" };
        return { tipo: "falhou", motivo: erroDeRede(error) ? "erro-de-rede" : "provedor-recusou" };
      }
      sessao = data?.session ?? null;
      usuario = data?.user ?? data?.session?.user ?? null;
    } catch {
      return { tipo: "falhou", motivo: "erro-de-rede" };
    }
    const novoId = usuario?.id;
    if (!sessao?.access_token || !sessao.refresh_token || !novoId) return { tipo: "falhou", motivo: "provedor-recusou" };

    // A CONTA NASCEU AGORA COM ESTA IDENTIDADE → não é conta KING (o gancho do servidor devia ter
    // recusado). Desfaz com o próprio token dela e responde "não encontrada". Nunca é adotada.
    if (nasceuComEstaIdentidade(usuario, provedor)) {
      await d.desfazerContaRecemCriada(sessao.access_token).catch(() => false);
      return { tipo: "falhou", motivo: "conta-nao-encontrada" };
    }

    const descartar = async () => { await isolada.signOut({ scope: "local" }).catch(() => undefined); };

    // A MESMA CONTA DESTE APARELHO: nada a trocar. A sessão extra que acabou de nascer é revogada.
    if (atualId && novoId === atualId) {
      await descartar();
      return { tipo: "ja-e-esta" };
    }

    const trocar = async (): Promise<ResultadoDaRecuperacao> => {
      try {
        const { error } = await principal!.setSession({ access_token: sessao!.access_token, refresh_token: sessao!.refresh_token! });
        if (error) { await descartar(); return { tipo: "falhou", motivo: erroDeRede(error as never) ? "erro-de-rede" : "provedor-recusou" }; }
        // A PROVA da troca é a sessão que o cliente principal devolve agora, não o que se pediu.
        const conferida = (await principal!.getSession()).data.session?.user?.id;
        if (conferida !== novoId) return { tipo: "falhou", motivo: "provedor-recusou" };
      } catch {
        await descartar();
        return { tipo: "falhou", motivo: "erro-de-rede" };
      }
      try { d.esquecerJogadorAnterior?.(); } catch { /* segue: a conta já é a nova */ }
      return { tipo: "recuperada", userId: novoId };
    };

    // SEM convidado neste aparelho: não há o que perder — troca direto.
    if (!atualId) return await trocar();

    // COM convidado: só troca sem perguntar quando se SABE que não há progresso.
    let progresso: ProgressoEmJogo | null = null;
    try { progresso = await d.progressoAtual(); } catch { progresso = null; }
    let atualVinculada = false;
    try {
      const { data } = await principal.getUserIdentities();
      atualVinculada = (data?.identities ?? []).some((i) => i.provider === "google" || i.provider === "apple");
    } catch { atualVinculada = false; }
    if (progresso && progresso.xpTotal === 0 && !atualVinculada) return await trocar();

    let decidido = false;
    return {
      tipo: "confirmar",
      progresso,
      atualVinculada,
      async confirmar() {
        if (decidido) return { tipo: "falhou", motivo: "em-andamento" };
        decidido = true;
        return await trocar();
      },
      async cancelar() {
        if (decidido) return;
        decidido = true;
        await descartar();
      },
    };
  }

  return { recuperar };
}

export type RecuperacaoDeConta = ReturnType<typeof criarRecuperacao>;
