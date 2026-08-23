// PONTO ÚNICO DE ENTRADA DO PROTOCOLO NO CLIENTE.
//
// Todo o app importa o contrato daqui — nunca do servidor diretamente. Se um dia o protocolo
// virar um pacote próprio (`packages/protocol`), só este arquivo muda.
//
// O módulo de protocolo é PURO: tipos, a constante de versão e dois helpers de envio. Ele não
// importa Colyseus nem nada do servidor, então consumi-lo no browser não arrasta servidor para
// dentro do bundle. O alias `@king/protocol` está em vite.config, vitest.config e tsconfig.
export { PROTOCOL_VERSION, CODIGO } from "@king/protocol";

export type {
  // handshake e identidade
  OpcoesDeEntrada, BoasVindas, EventoDeJogador, ConexaoDeJogador, Falha, Codigo,
  // gameplay
  IntencaoBase, JogarCarta, EscolherTrunfo, ProntoParaProximaMao, DefinirPronto, GerirBot,
  AtualizacaoDeEstado, AcaoRecusada, EstadoDeConsenso, Causa, StatusDaSala,
  // relógio e assistência
  RelogioDaDecisao, AcaoAutomatica, TipoDeDecisao, FaseDoRelogio,
  // mapas por direção
  ClienteParaServidor, ServidorParaCliente, MensagemDoCliente, MensagemDoServidor,
} from "@king/protocol";
