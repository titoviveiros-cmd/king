// CREDENCIAL DE RETORNO — o que permite voltar ao MESMO assento depois de recarregar a página.
//
// Formato entregue pelo servidor: `roomCode:token`. É segredo do dono: chega só no
// `SERVER_WELCOME` de quem entrou, nunca é difundida e nunca entra no estado sincronizado.
//
// Ela ROTACIONA a cada retorno — o servidor manda uma nova no `SERVER_WELCOME` da reconexão.
// Por isso `guardar` é chamado sempre que um `SERVER_WELCOME` chega, e não só no primeiro.
//
// Nível de segurança: credencial *bearer* de MVP. Quem tiver a string, tem o assento. É coerente
// com o estágio do produto (sala privada entre amigos, código de 5 caracteres) e está registrado
// como dívida — não como descuido.
import { CHAVE_RECUPERACAO } from "./constantes.js";

/** `localStorage` pode lançar (Safari privado, storage cheio). Nunca derrubar o jogo por isso. */
function cofre(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function guardarRecuperacao(token: string): void {
  try { cofre()?.setItem(CHAVE_RECUPERACAO, token); } catch { /* sem persistência: só perde o retorno automático */ }
}

export function lerRecuperacao(): string | null {
  try {
    const v = cofre()?.getItem(CHAVE_RECUPERACAO);
    return v && v.includes(":") ? v : null;
  } catch {
    return null;
  }
}

export function esquecerRecuperacao(): void {
  try { cofre()?.removeItem(CHAVE_RECUPERACAO); } catch { /* idem */ }
}

/** O código da sala embutido na credencial — usado para oferecer "voltar para a sala ABCDE". */
export function codigoDaRecuperacao(token: string): string {
  return token.split(":")[0] ?? "";
}
