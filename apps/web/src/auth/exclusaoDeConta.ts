// EXCLUIR A CONTA — o lado do app (Configurações/Conta → Excluir conta).
//
// Exigência das duas lojas: a App Store (diretriz 5.1.1(v)) quer a exclusão DENTRO do app; a Google
// Play quer o caminho no app e uma página na web (ver public/excluir-conta.html). Vale para o
// convidado também: ele é uma conta de verdade, com progresso guardado no servidor.
//
// ══ A ORDEM ══
//
//   1. Há sessão? Sem sessão, não há conta neste aparelho — nada a excluir no servidor.
//   2. Conta com Apple, no iPhone: o jogador passa pela tela da Apple de novo. Isso é parte da
//      confirmação forte E traz o código novo que deixa o servidor REVOGAR o acesso ao Apple ID.
//      Cancelar ali cancela a exclusão.
//   3. O servidor (Edge Function `excluir-conta`) exclui — idempotente: repetir não é erro.
//   4. SÓ DEPOIS da resposta positiva o aparelho é limpo: sessão revogada e apagada (cofre,
//      marcador, cópias antigas), "voltar para a minha sala", transação de vínculo. Falhou no
//      servidor? Nada é limpo: a conta continua inteira e o jogador tenta de novo.
//
// Nenhum token sai daqui para outro lugar que não o próprio projeto do Supabase.
import type { PortaDeAutenticacao } from "./clienteSupabase.js";
import type { FonteDeCredencialNativa } from "./credencialNativa.js";

/** O que o servidor diz da Apple. "nao-se-aplica" = a conta não tinha Apple. */
export type RevogacaoApple = "revogada" | "sem-codigo" | "outra-conta" | "falhou" | "nao-configurada" | "nao-se-aplica";

export type ResultadoDaExclusao =
  | { tipo: "excluida"; apple: RevogacaoApple }
  /** Este aparelho não tem conta (nunca entrou online, ou já saiu). */
  | { tipo: "sem-conta" }
  /** O jogador fechou a tela da Apple: a exclusão não aconteceu. */
  | { tipo: "cancelada" }
  | { tipo: "falhou"; motivo: "indisponivel" | "rede" | "servidor" | "sessao-invalida" | "em-andamento" };

export interface DependenciasDaExclusao {
  principal: () => Promise<PortaDeAutenticacao | null>;
  /** `<SUPABASE_URL>/functions/v1/excluir-conta`, ou `null` sem identidade configurada. */
  endereco: string | null;
  /** A chave PÚBLICA do projeto (o gateway das funções a pede no `apikey`). */
  chavePublica: string;
  rede: typeof fetch;
  /** A fonte nativa, quando há (é ela que reabre a tela da Apple). */
  fonte: () => FonteDeCredencialNativa | null;
  novoNonce: () => Promise<{ bruto: string; hash: string }>;
  /** Limpa o aparelho depois da exclusão confirmada pelo servidor. */
  limparAparelho: () => Promise<void>;
}

export const CONFIRMACAO_DA_EXCLUSAO = "EXCLUIR";

const REVOGACOES = new Set<RevogacaoApple>(["revogada", "sem-codigo", "outra-conta", "falhou", "nao-configurada", "nao-se-aplica"]);

export function criarExclusaoDeConta(d: DependenciasDaExclusao) {
  let emCurso = false;

  async function excluir(): Promise<ResultadoDaExclusao> {
    if (emCurso) return { tipo: "falhou", motivo: "em-andamento" };
    emCurso = true;
    try {
      return await executar();
    } finally {
      emCurso = false;
    }
  }

  async function executar(): Promise<ResultadoDaExclusao> {
    if (!d.endereco) return { tipo: "falhou", motivo: "indisponivel" };
    let porta: PortaDeAutenticacao | null = null;
    try { porta = await d.principal(); } catch { porta = null; }
    if (!porta) return { tipo: "falhou", motivo: "indisponivel" };

    let token: string | undefined;
    try {
      const r = await porta.getSession();
      if (r.error) return { tipo: "falhou", motivo: "rede" };
      token = r.data.session?.access_token;
    } catch {
      return { tipo: "falhou", motivo: "rede" };
    }
    if (!token) {
      await d.limparAparelho().catch(() => undefined);
      return { tipo: "sem-conta" };
    }

    // APPLE NO IPHONE: o código novo para a revogação vem de passar pela tela da Apple de novo.
    let codigoApple: string | undefined;
    try {
      const { data } = await porta.getUserIdentities();
      const temApple = (data?.identities ?? []).some((i) => i.provider === "apple");
      const fonte = d.fonte();
      if (temApple && fonte && (fonte.provedores ?? []).includes("apple")) {
        const nonce = await d.novoNonce();
        const r = await fonte.obter("apple", nonce.hash);
        if (r.tipo === "cancelado") return { tipo: "cancelada" };
        if (r.tipo === "credencial") codigoApple = r.credencial.codigoDeAutorizacao;
        // erro na Apple: a exclusão segue sem revogar; o servidor responde "sem-codigo" e a tela
        // mostra o caminho manual (Ajustes → ID Apple → Iniciar sessão com a Apple).
      }
    } catch { /* sem identidades legíveis: segue sem Apple */ }

    let resposta: Response;
    try {
      resposta = await d.rede(d.endereco, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, apikey: d.chavePublica, "content-type": "application/json" },
        body: JSON.stringify({ confirmacao: CONFIRMACAO_DA_EXCLUSAO, ...(codigoApple ? { apple: { codigo: codigoApple } } : {}) }),
      });
    } catch {
      return { tipo: "falhou", motivo: "rede" };
    }
    if (resposta.status === 401) return { tipo: "falhou", motivo: "sessao-invalida" };
    if (!resposta.ok) return { tipo: "falhou", motivo: resposta.status >= 500 ? "rede" : "servidor" };
    let corpo: { estado?: unknown; apple?: unknown } = {};
    try { corpo = await resposta.json(); } catch { return { tipo: "falhou", motivo: "servidor" }; }
    if (corpo.estado !== "excluida" && corpo.estado !== "ja-excluida") return { tipo: "falhou", motivo: "servidor" };

    // O SERVIDOR CONFIRMOU: agora, e só agora, o aparelho esquece a conta.
    await d.limparAparelho().catch(() => undefined);
    const apple = REVOGACOES.has(corpo.apple as RevogacaoApple) ? (corpo.apple as RevogacaoApple) : "nao-se-aplica";
    return { tipo: "excluida", apple };
  }

  return { excluir };
}

export type ExclusaoDeConta = ReturnType<typeof criarExclusaoDeConta>;
