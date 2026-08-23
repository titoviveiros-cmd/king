// Constantes de rede do cliente. Ficam separadas para o módulo `servidor.ts` continuar puro e
// testável sem tocar em Colyseus.

/** Porta padrão do Colyseus em desenvolvimento — a mesma de `apps/server/src/app.ts`. */
export const PORTA_DEV_PADRAO = 2567;

/** Nome da sala no matchmaking — o mesmo de `SALA_KING` no servidor. */
export const SALA_KING = "king";

/** Onde a credencial de retorno é guardada entre recarregamentos da página. */
export const CHAVE_RECUPERACAO = "king:recovery";
