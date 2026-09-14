/**
 * A ENTRADA NUM PREVIEW PROTEGIDO DA VERCEL — só a primeira navegação carrega o segredo.
 *
 * ══ POR QUE NÃO UM CABEÇALHO GLOBAL ══
 *
 * A primeira versão do T5 punha `x-vercel-protection-bypass` em `extraHTTPHeaders`, que o
 * Playwright acrescenta a TODA requisição do contexto — inclusive às chamadas cross-origin para o
 * servidor do jogo (`server.playkingcards.com.br`). Um cabeçalho customizado numa requisição
 * cross-origin dispara preflight de CORS, e o teste reprovaria por um motivo que não é o que ele
 * mede. Pior: o segredo iria parar num servidor que não tem nada a ver com a Vercel.
 *
 * O caminho certo é o que a própria Vercel oferece: a PRIMEIRA navegação leva o segredo na query,
 * junto de `x-vercel-set-bypass-cookie=true`; a Vercel responde gravando um cookie do domínio do
 * Preview, e dali em diante é o cookie que abre a porta — só para aquele domínio.
 *
 * ══ O SEGREDO NUNCA SAI ══
 *
 * Ele vem só de variável de ambiente e não é impresso. Como a URL inicial o carrega, qualquer
 * erro da navegação poderia ecoá-lo — por isso `semSegredo` limpa a mensagem antes de relançar.
 */

export const PARAM_BYPASS = "x-vercel-protection-bypass";
export const PARAM_COOKIE = "x-vercel-set-bypass-cookie";

/** A URL da primeira navegação. Sem segredo, é só a raiz do Preview. */
export function urlDeEntrada(base: string, segredo?: string): string {
  const raiz = new URL(base.trim().replace(/\/+$/, "") + "/");
  const s = segredo?.trim();
  if (!s) return raiz.toString();
  raiz.searchParams.set(PARAM_BYPASS, s);
  raiz.searchParams.set(PARAM_COOKIE, "true");
  return raiz.toString();
}

/** Remove o segredo — cru e codificado — de qualquer texto que possa acabar num log. */
export function semSegredo(texto: string, segredo?: string): string {
  const s = segredo?.trim();
  if (!s) return texto;
  let limpo = texto;
  for (const forma of new Set([s, encodeURIComponent(s), new URLSearchParams({ x: s }).toString().slice(2)])) {
    limpo = limpo.split(forma).join("***");
  }
  return limpo;
}
