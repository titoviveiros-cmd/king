// QUE TIPO DE FALHA O BANCO DEVOLVEU — e o que ela autoriza o serviço a fazer.
//
// As assinaturas vêm do que foi MEDIDO contra o Supabase real na homologação da Fase 4C:
//
//   • `28P01` — "password authentication failed for user …". Credencial errada ou ainda não
//     propagada. Tentar de novo não conserta, e cada tentativa conta para o disjuntor do pooler.
//   • `XX000 · (ECIRCUITBREAKER) too many authentication failures, new connections are temporarily
//     blocked` — o disjuntor do Supavisor aberto. Bloqueia o projeto INTEIRO a partir do nosso IP,
//     inclusive o papel `postgres`, por alguns minutos (medido: ~5 min).
//
// Tudo o mais — rede caída, timeout, reset — é TRANSITÓRIO e segue o retry controlado que já existia.
// A classificação é deliberadamente estreita: transformar qualquer erro em "abre o disjuntor"
// suspenderia o progresso por nada; transformar qualquer erro em "tenta de novo" martelaria o pooler.

export type ClasseDeFalha = "autenticacao" | "disjuntor" | "transitoria";

export function classificarFalha(e: unknown): ClasseDeFalha {
  const codigo = (e as { code?: unknown } | null)?.code;
  const mensagem = String((e as { message?: unknown } | null)?.message ?? "");
  if (codigo === "28P01") return "autenticacao";
  if (mensagem.includes("ECIRCUITBREAKER")) return "disjuntor";
  return "transitoria";
}

/** O que se pode logar de uma falha: o código e a classe. Nunca a mensagem inteira. */
export function resumoSeguro(e: unknown): string {
  const codigo = (e as { code?: unknown } | null)?.code;
  return `${typeof codigo === "string" ? codigo : (e as Error)?.name ?? "erro"}/${classificarFalha(e)}`;
}
