// Ponto de entrada do servidor do KING. Sobe a instância definida em `app.ts` e escuta.
//
// A PORTA vem do ambiente quando ele a fornece. Provedores de hospedagem — Colyseus Cloud
// inclusive — escolhem a porta e a injetam em `PORT`; um servidor que ignora essa variável sobe
// numa porta que ninguém está escutando e aparenta estar "no ar" sem receber uma conexão sequer.
// Sem `PORT` definida, o comportamento local continua exatamente o mesmo de antes: 2567.
//
// A IDENTIDADE É RESOLVIDA ANTES DE ESCUTAR. O arquivo persistente (`/etc/king/server.env`) é lido
// aqui, pelo próprio processo — e não pela shell que o (re)iniciou —, e o modo é decidido já no
// boot. Configuração incoerente derruba a subida com o código 78 (EX_CONFIG), em vez de deixar o
// servidor no ar num modo que ninguém declarou. Ver `config/ambiente.ts`.
import { PORTA_PADRAO, servidor } from "./app.js";
import { verificadorEmUso } from "./auth/identidade.js";
import { ConfiguracaoInvalida, prepararIdentidade } from "./config/ambiente.js";

const SAIDA_CONFIGURACAO_INVALIDA = 78;

try {
  const { resumo } = prepararIdentidade(process.env);
  // Resolve e guarda o verificador AGORA: um erro aqui derruba o boot, e não a primeira entrada.
  verificadorEmUso();
  console.log(`[king] ${resumo}`);
} catch (e) {
  if (e instanceof ConfiguracaoInvalida) {
    console.error(`[king] configuração de identidade inválida: ${e.message}`);
    process.exit(SAIDA_CONFIGURACAO_INVALIDA);
  }
  throw e;
}

const porta = Number(process.env.PORT) || PORTA_PADRAO;

servidor.listen(porta);
