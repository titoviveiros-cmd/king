/**
 * O CONVITE POR LINK — `https://playkingcards.com.br/?sala=1234`.
 *
 * Quem abre o link cai na Home com o painel "Jogar com amigos" aberto e o código preenchido, e só
 * entra na sala com o toque em "Entrar na sala". Abrir um link NUNCA é entrar numa mesa: o gesto
 * continua sendo de quem foi convidado.
 *
 * O CÓDIGO É A CHAVE DA SALA. Ele vive só onde precisa — no campo da Home e na conexão com o
 * servidor — e nunca chega ao analytics. Por isso `capturarConvite` lê e APAGA o parâmetro da barra
 * de endereço antes de qualquer outra coisa ler a URL (ver `main.tsx`: ele roda antes de
 * `iniciarAnalytics`). O filtro de saída do PostHog já derruba URL e referrer; a limpeza é a
 * segunda barreira, e a que vale também para quem copia o endereço da barra depois.
 */

export const PARAMETRO_DO_CONVITE = "sala";

/**
 * A origem PÚBLICA, fixa — e não `location.origin`. No app nativo a origem é `localhost`, e um
 * convite para `localhost` não abre no celular de ninguém. É a mesma origem das metatags da prévia.
 */
export const ORIGEM_DO_CONVITE = "https://playkingcards.com.br";

/** O contrato do código: QUATRO DÍGITOS, sempre string (`0315` não é `315`). O mesmo do servidor. */
const FORMATO_DO_CODIGO = /^\d{4}$/;

export type Convite = { codigo: string } | { invalido: true };

/**
 * O convite que uma query string traz. `null` = não há convite; `{ invalido }` = havia o parâmetro,
 * mas não é um código de sala (letra, tamanho errado, endereço, repetido). Nada além de quatro
 * dígitos passa: o parâmetro nunca vira URL, redirecionamento nem texto na tela.
 */
export function lerConvite(search: string): Convite | null {
  let q: URLSearchParams;
  try { q = new URLSearchParams(search); } catch { return null; }
  if (!q.has(PARAMETRO_DO_CONVITE)) return null;
  const valores = q.getAll(PARAMETRO_DO_CONVITE);
  const valor = (valores[0] ?? "").trim();
  return valores.length === 1 && FORMATO_DO_CODIGO.test(valor) ? { codigo: valor } : { invalido: true };
}

/**
 * O CONVITE QUE ABRE O APP — App Link (Android) ou Universal Link (iOS): o sistema entrega o
 * endereço inteiro. Só a origem pública oficial passa (`https://playkingcards.com.br`, sem usuário
 * nem senha embutidos); esquema próprio, http, outro domínio ou um parecido (`…com.br.outro.com`)
 * não. O resultado é o MESMO de `lerConvite`: no máximo um código para o campo da Home — nunca uma
 * entrada na sala. (A ligação com o sistema, `appUrlOpen`, entra junto com a associação do domínio;
 * ver docs/KING-MOBILE-RC.md.)
 */
export function conviteDoLinkDoApp(url: string): Convite | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const oficial = new URL(ORIGEM_DO_CONVITE);
  if (u.protocol !== oficial.protocol || u.host !== oficial.host || u.username || u.password) return null;
  return lerConvite(u.search);
}

/** O mesmo endereço sem o parâmetro do convite — os demais parâmetros e o fragmento ficam. */
export function enderecoSemConvite(href: string): string {
  const u = new URL(href);
  u.searchParams.delete(PARAMETRO_DO_CONVITE);
  return `${u.pathname}${u.search}${u.hash}`;
}

/** O pedaço do navegador que a captura usa — recebido, para poder ser testado sem navegador. */
export interface JanelaDoConvite {
  location: { search: string; href: string };
  history: { state: unknown; replaceState(data: unknown, unused: string, url?: string | null): void };
}

/**
 * Lê o convite e APAGA o parâmetro da barra, sem recarregar e sem criar entrada no histórico
 * (`replaceState`): voltar não traz o link de volta, e recarregar abre a Home de sempre.
 *
 * Chamada UMA vez, antes de tudo. Nunca lança: link estranho não derruba a Home.
 */
export function capturarConvite(
  janela: JanelaDoConvite | undefined = typeof window === "undefined" ? undefined : window,
): Convite | null {
  if (!janela) return null;
  let convite: Convite | null;
  try { convite = lerConvite(janela.location.search); } catch { return null; }
  if (!convite) return null;
  try {
    janela.history.replaceState(janela.history.state, "", enderecoSemConvite(janela.location.href));
  } catch { /* sem histórico editável: o filtro de saída do analytics continua derrubando a URL */ }
  return convite;
}

/** O link que o anfitrião manda. `null` para o que não é código de sala. */
export function linkDoConvite(codigo: string): string | null {
  return FORMATO_DO_CODIGO.test(codigo) ? `${ORIGEM_DO_CONVITE}/?${PARAMETRO_DO_CONVITE}=${codigo}` : null;
}

/**
 * O texto do convite. Na folha de compartilhar ele vai SEM o link (o link segue no campo `url`, e
 * o WhatsApp juntaria os dois, repetindo o endereço); copiado, vai inteiro. Sem travessão: é texto
 * que chega ao grupo.
 */
export const CHAMADA_DO_CONVITE = "Vem jogar KING comigo 👑\nEntre na minha sala:";
export const textoDoConvite = (link: string) => `${CHAMADA_DO_CONVITE}\n${link}`;

/** Os dois caminhos de mandar o convite, recebidos — para poder testar sem navegador. */
export interface MeiosDeEnvio {
  compartilhar?: (dados: { title: string; text: string; url: string }) => Promise<void>;
  copiar?: (texto: string) => Promise<void>;
}

/** Como o envio terminou. `null` = a pessoa desistiu da folha de compartilhar (não é erro). */
export type EnvioDoConvite =
  | { ok: true; via: "folha" | "copia"; texto: string }
  | { ok: false; texto: string }
  | null;

const desistiu = (e: unknown) => typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError";

/**
 * Manda o convite: folha de compartilhar quando existe; senão — ou se ela recusar por outro
 * motivo que não a desistência —, copia o texto inteiro. Falhou tudo: o código está na tela, e o
 * retorno pede para ditá-lo. Nunca lança: o lobby continua de pé.
 */
export async function enviarConvite(link: string, meios: MeiosDeEnvio): Promise<EnvioDoConvite> {
  if (meios.compartilhar) {
    try {
      await meios.compartilhar({ title: "KING", text: CHAMADA_DO_CONVITE, url: link });
      return { ok: true, via: "folha", texto: "Enviado ✓" };
    } catch (e) {
      if (desistiu(e)) return null;
    }
  }
  try {
    if (!meios.copiar) throw new Error("sem área de transferência");
    await meios.copiar(textoDoConvite(link));
    return { ok: true, via: "copia", texto: "Copiado ✓" };
  } catch {
    return { ok: false, texto: "Dite o código" };
  }
}
