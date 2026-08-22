// Definição do servidor autoritativo do KING (Fase 2 — bootstrap).
//
// Fica separado de `index.ts` de propósito: aqui o servidor é apenas DEFINIDO, e é isso que os
// testes recebem (`boot(servidor)`). Quem abre a porta é o `index.ts`. Assim o mesmo servidor
// que roda em produção é o que os testes exercitam, sem duplicar configuração.
import { defineRoom, defineServer } from "colyseus";
import { KingRoom } from "./rooms/KingRoom.js";

/** Nome da sala no matchmaking. */
export const SALA_KING = "king";

/** Porta local de desenvolvimento (padrão do Colyseus). */
export const PORTA_PADRAO = 2567;

export const servidor = defineServer({
  rooms: {
    [SALA_KING]: defineRoom(KingRoom),
  },
});
