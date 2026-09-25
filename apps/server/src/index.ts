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
import { ConfiguracaoDeProgressoInvalida, lerConfiguracaoDeProgresso } from "./progresso/config.js";
import { OutboxDeProgresso } from "./progresso/outbox.js";
import { repositorioPg } from "./progresso/repositorio.js";
import { ServicoDeProgresso, configurarProgresso } from "./progresso/servico.js";

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

// O PROGRESSO É RESOLVIDO DO MESMO JEITO, EM ARQUIVO PRÓPRIO (`/etc/king/progress.env`). Ausente,
// o progresso fica desligado e o jogo segue igual. Presente e incoerente, derruba o boot com 78.
// Ver `progresso/config.ts`.
try {
  const progresso = lerConfiguracaoDeProgresso(process.env);
  if (progresso.modo === "database") {
    const servico = new ServicoDeProgresso(
      new OutboxDeProgresso(progresso.outbox),
      repositorioPg({ connectionString: progresso.url }),
    );
    configurarProgresso(servico);
    console.log("[king] progress mode: database");
    // Pendências de um boot anterior. Não segura a subida: o jogo não espera o banco.
    void servico.reprocessar().then(
      (b) => console.log(`[king] progresso reprocessado: ${b.entregues} entregue(s), ${b.pendentes} pendente(s), ${b.corrompidas.length} ilegível(is)`),
      (e) => console.error(`[king] reprocessamento do progresso falhou: ${(e as Error)?.name ?? "erro"}`),
    );
  } else {
    console.log(`[king] progress mode: disabled (${progresso.motivo})`);
  }
} catch (e) {
  if (e instanceof ConfiguracaoDeProgressoInvalida) {
    console.error(`[king] configuração de progresso inválida: ${e.message}`);
    process.exit(SAIDA_CONFIGURACAO_INVALIDA);
  }
  throw e;
}

const porta = Number(process.env.PORT) || PORTA_PADRAO;

servidor.listen(porta);
