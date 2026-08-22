// Ponto de entrada do servidor do KING. Sobe a instância definida em `app.ts` e escuta.
// Nesta fase o servidor não é implantado em lugar nenhum — só roda localmente (`npm run dev`).
import { PORTA_PADRAO, servidor } from "./app.js";

servidor.listen(PORTA_PADRAO);
