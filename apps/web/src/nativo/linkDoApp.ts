// O CONVITE QUE ABRE O APP — App Links (Android) e Universal Links (iOS).
//
// Com o domínio associado (assetlinks.json / apple-app-site-association — ver
// scripts/gerar-well-known.mjs), tocar em `https://playkingcards.com.br/?sala=1234` abre o KING em vez
// do navegador, e o sistema entrega o endereço inteiro ao app: na abertura (`getLaunchUrl`) ou, com o
// app já aberto, pelo evento `appUrlOpen` (`@capacitor/app`).
//
// AS MESMAS REGRAS DO CONVITE NA WEB (`net/convite.ts`):
//   • só a origem pública oficial passa — outro domínio, http, esquema próprio, usuário/senha
//     embutidos ou porta: ignorados, em silêncio;
//   • o resultado é, no máximo, um CÓDIGO para o campo da Home — NUNCA a entrada na sala: abrir um
//     link não é sentar numa mesa, o toque continua sendo de quem foi convidado;
//   • o endereço e o código não vão para lugar nenhum além disso (nem log, nem analytics).
import { conviteDoLinkDoApp, type Convite } from "../net/convite.js";

/** O que o KING usa do `@capacitor/app`. Uma porta, para o teste trocar por uma dublê. */
export interface PortaDoApp {
  getLaunchUrl(): Promise<{ url?: string } | undefined | null>;
  addListener(evento: "appUrlOpen", ouvinte: (e: { url?: string }) => void): Promise<{ remove(): Promise<void> }>;
}

let conviteDoArranque: Convite | null = null;
let urlDoArranque: string | null = null;
const ouvintes = new Set<(c: Convite) => void>();

/** O convite que ABRIU o app (lido uma vez: quem pega, consome). */
export function conviteDoArranqueDoApp(): Convite | null {
  const c = conviteDoArranque;
  conviteDoArranque = null;
  return c;
}

/**
 * Avisa quem estiver na tela quando um convite chega com o app já aberto. Devolve o cancelamento.
 *
 * O ARRANQUE NÃO ESPERA PARA SEMPRE pelo endereço de abertura (ver `iniciarAppNativo`): se ele
 * chegar depois de a tela já ter lido `conviteDoArranqueDoApp`, quem se inscrever recebe-o aqui —
 * em qualquer ordem, o convite de abertura é entregue uma vez, e nunca se perde.
 */
export function aoConviteDoApp(ouvinte: (c: Convite) => void): () => void {
  ouvintes.add(ouvinte);
  entregarPendente();
  return () => { ouvintes.delete(ouvinte); };
}

function entregarPendente(): void {
  if (!conviteDoArranque || ouvintes.size === 0) return;
  const c = conviteDoArranque;
  conviteDoArranque = null;
  for (const o of ouvintes) o(c);
}

/** Liga o app aos links. Nunca lança: sem links, o app abre normalmente. */
export async function ouvirLinksDoApp(app: PortaDoApp): Promise<void> {
  try {
    const inicio = await app.getLaunchUrl();
    const url = typeof inicio?.url === "string" ? inicio.url : null;
    if (url) {
      urlDoArranque = url;
      conviteDoArranque = conviteDoLinkDoApp(url);
      entregarPendente();
    }
  } catch { /* sem endereço de abertura */ }
  try {
    await app.addListener("appUrlOpen", (e) => {
      const url = typeof e?.url === "string" ? e.url : null;
      if (!url) return;
      // No Android, o evento da abertura fica RETIDO até haver ouvinte: é o mesmo link que
      // `getLaunchUrl` já entregou. Uma vez só.
      if (url === urlDoArranque) { urlDoArranque = null; return; }
      const convite = conviteDoLinkDoApp(url);
      if (!convite) return;
      for (const o of ouvintes) o(convite);
    });
  } catch { /* sem o plugin: o convite por link simplesmente não abre o app */ }
}

/** Só para teste. */
export function esquecerLinksDoApp(): void {
  conviteDoArranque = null;
  urlDoArranque = null;
  ouvintes.clear();
}
