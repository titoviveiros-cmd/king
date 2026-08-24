// Como se entra no multiplayer. Fica num módulo próprio para o `App` poder falar do modo
// online sem importá-lo — é o que permite carregar o cliente de rede sob demanda.
export type Entrada =
  | { tipo: "criar"; nick: string; avatar: string }
  | { tipo: "entrar"; codigo: string; nick: string; avatar: string }
  | { tipo: "voltar" };
