// CÓDIGO DA SALA PRIVADA.
//
// O código É o `roomId` do Colyseus. Isso evita uma segunda tabela de mapeamento (código → sala)
// que precisaria ser mantida em sincronia, e faz `joinById(codigo)` funcionar nativamente: o
// próprio matchmaking do framework resolve a entrada. `Room.roomId` é declaradamente substituível
// durante o `onCreate`.
//
// O código é sempre gerado pelo SERVIDOR. Um cliente que pudesse escolhê-lo poderia sequestrar
// um código ainda não usado e esperar que alguém entrasse por engano.

/**
 * Alfabeto sem glifos que se confundem quando alguém lê um código em voz alta ou digita do
 * outro lado da mesa: fora `I`, `L`, `O`, `0` e `1`. Sobram 31 símbolos.
 */
export const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TAMANHO_CODIGO = 5;

/** 31^5 ≈ 28,6 milhões de combinações — folga enorme para o número de salas simultâneas. */
export const ESPACO_DE_CODIGOS = Math.pow(ALFABETO.length, TAMANHO_CODIGO);

/** Códigos ocupados por salas vivas neste processo. */
const emUso = new Set<string>();

/** Gera UM código. Puro em relação ao `rnd` recebido — é o que torna a colisão testável. */
export function gerarCodigo(rnd: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) {
    s += ALFABETO[Math.floor(rnd() * ALFABETO.length) % ALFABETO.length];
  }
  return s;
}

/**
 * Normaliza o que o jogador digitou: maiúsculas e sem separadores. É o que torna o código
 * insensível a caixa — "k7f2m" e "K7-F2M" chegam ao mesmo lugar.
 * Glifos ambíguos não precisam de tradução porque **não existem** no alfabeto.
 */
export function normalizarCodigo(bruto: string): string {
  return (bruto ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Um código só é válido se tiver o tamanho certo e usar apenas o alfabeto. */
export function codigoValido(codigo: string): boolean {
  if (codigo.length !== TAMANHO_CODIGO) return false;
  for (const c of codigo) if (!ALFABETO.includes(c)) return false;
  return true;
}

/**
 * Reserva um código livre. Em colisão, tenta de novo — com 28,6 milhões de combinações e um
 * punhado de salas vivas, a probabilidade de precisar de uma segunda tentativa é desprezível,
 * mas o retry existe porque "desprezível" não é "impossível".
 */
export function reservarCodigo(rnd: () => number = Math.random, tentativas = 100): string {
  for (let i = 0; i < tentativas; i++) {
    const c = gerarCodigo(rnd);
    if (!emUso.has(c)) {
      emUso.add(c);
      return c;
    }
  }
  throw new Error("não foi possível reservar um código de sala livre");
}

/** Devolve o código ao pool quando a sala morre. */
export function liberarCodigo(codigo: string): void {
  emUso.delete(codigo);
}

export const codigoOcupado = (codigo: string): boolean => emUso.has(codigo);
export const totalEmUso = (): number => emUso.size;
