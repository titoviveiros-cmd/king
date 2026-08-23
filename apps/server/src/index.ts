// Ponto de entrada do servidor do KING. Sobe a instância definida em `app.ts` e escuta.
//
// A PORTA vem do ambiente quando ele a fornece. Provedores de hospedagem — Colyseus Cloud
// inclusive — escolhem a porta e a injetam em `PORT`; um servidor que ignora essa variável sobe
// numa porta que ninguém está escutando e aparenta estar "no ar" sem receber uma conexão sequer.
// Sem `PORT` definida, o comportamento local continua exatamente o mesmo de antes: 2567.
import { PORTA_PADRAO, servidor } from "./app.js";

const porta = Number(process.env.PORT) || PORTA_PADRAO;

servidor.listen(porta);
