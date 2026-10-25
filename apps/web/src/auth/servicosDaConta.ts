// OS SERVIÇOS DA CONTA, montados com as peças reais — "Já tenho uma conta" e "Excluir conta".
//
// Fica num arquivo à parte para não amarrar `identidade.ts` a progresso, rede e cofre: aqui se
// juntam a porta compartilhada, o cliente isolado, a fonte nativa, o leitor de progresso e a função
// de exclusão. Quem está fora de `auth/` recebe só as operações, nunca o cliente do SDK.
import { portaDeAutenticacao, portaIsolada, sairDeProposito } from "./clienteSupabase.js";
import { ehAppNativo, fonteNativa, gerarNonce } from "./credencialNativa.js";
import { CHAVE_DA_TRANSACAO } from "./conta.js";
import { CONFIRMACAO_DA_EXCLUSAO, criarExclusaoDeConta, type ExclusaoDeConta } from "./exclusaoDeConta.js";
import { identidadeConfigurada, provedoresDaConta, vinculoDeContaLigado } from "./identidade.js";
import { chaveDaSessao, leitorDeProgressoConfigurado } from "./progresso.js";
import { criarRecuperacao, type RecuperacaoDeConta } from "./recuperacaoDeConta.js";
import { limparCofreRegistrado, marcadorDeSessao } from "./sessaoNativa.js";
import { esquecerRecuperacao } from "../net/recuperacao.js";

/** Onde a função de exclusão mora: no próprio projeto do Supabase. */
export const enderecoDaExclusao = (url: string): string => `${url.replace(/\/+$/, "")}/functions/v1/excluir-conta`;

const local = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/**
 * HÁ CONTA NESTE APARELHO? Leitura síncrona, sem criar ninguém: a sessão do SDK no localStorage
 * (web) ou o marcador do cofre (app). Sem conta, a Home nem oferece o painel na web.
 */
export function haContaNesteAparelho(): boolean {
  const r = identidadeConfigurada();
  if (!r.configurado) return false;
  const chave = chaveDaSessao(r.url);
  const l = local();
  try { return !!(chave && l?.getItem(chave)) || marcadorDeSessao(l); } catch { return false; }
}

/** Exclui a conta dona deste token — usado só para desfazer uma conta que nasceu por engano. */
async function excluirContaDoToken(url: string, chavePublica: string, token: string): Promise<boolean> {
  try {
    const r = await fetch(enderecoDaExclusao(url), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, apikey: chavePublica, "content-type": "application/json" },
      body: JSON.stringify({ confirmacao: CONFIRMACAO_DA_EXCLUSAO }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** A EXCLUSÃO, sempre que houver identidade configurada (convidado também é conta). */
export function exclusaoConfigurada(): ExclusaoDeConta | null {
  const r = identidadeConfigurada();
  if (!r.configurado) return null;
  return criarExclusaoDeConta({
    principal: () => portaDeAutenticacao(r),
    endereco: enderecoDaExclusao(r.url),
    chavePublica: r.anonKey,
    rede: (...a) => fetch(...a),
    fonte: () => fonteNativa(),
    novoNonce: () => gerarNonce(),
    async limparAparelho() {
      // A sessão local é revogada e apagada (para conta já excluída, o servidor responde 401/403/404,
      // e o SDK apaga a sessão mesmo assim). Depois, o cofre inteiro do KING e as sobras.
      // De propósito: esta saída não é "sessão perdida" (não deixa o aviso para a próxima abertura).
      try {
        const porta = await portaDeAutenticacao(r);
        if (porta) await sairDeProposito(() => porta.signOut({ scope: "local" }));
      } catch { /* segue */ }
      await limparCofreRegistrado();
      const l = local();
      const chave = chaveDaSessao(r.url);
      try {
        if (chave) for (const k of [chave, `${chave}-user`, `${chave}-code-verifier`]) l?.removeItem(k);
        l?.removeItem(CHAVE_DA_TRANSACAO);
      } catch { /* sem localStorage */ }
      esquecerRecuperacao();
    },
  });
}

/** "JÁ TENHO UMA CONTA": só no app, com o vínculo ligado e um provedor nativo disponível. */
export function recuperacaoConfigurada(): RecuperacaoDeConta | null {
  const r = identidadeConfigurada();
  if (!r.configurado || !vinculoDeContaLigado() || !ehAppNativo() || provedoresDaConta().length === 0) return null;
  return criarRecuperacao({
    principal: () => portaDeAutenticacao(r),
    isolada: () => portaIsolada(r),
    fonte: () => fonteNativa(),
    novoNonce: () => gerarNonce(),
    progressoAtual: async () => {
      const p = await leitorDeProgressoConfigurado()?.meuProgresso();
      return p ? { nivel: p.nivel, xpTotal: p.xpTotal } : null;
    },
    desfazerContaRecemCriada: (token) => excluirContaDoToken(r.url, r.anonKey, token),
    esquecerJogadorAnterior: () => esquecerRecuperacao(),
  });
}
