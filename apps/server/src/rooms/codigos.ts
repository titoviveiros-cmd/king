// CÓDIGO DA SALA PRIVADA.
//
// O código É o `roomId` do Colyseus. Isso evita uma segunda tabela de mapeamento (código → sala)
// que precisaria ser mantida em sincronia, e faz `joinById(codigo)` funcionar nativamente: o
// próprio matchmaking do framework resolve a entrada. `Room.roomId` é declaradamente substituível
// durante o `onCreate`.
//
// O código é sempre gerado pelo SERVIDOR. Um cliente que pudesse escolhê-lo poderia sequestrar
// um código ainda não usado e esperar que alguém entrasse por engano.
//
// ═══════════════ POR QUE QUATRO DÍGITOS, E POR QUE STRING ═══════════════
//
// Quatro dígitos é o padrão da família Verbete: cabe num teclado numérico, se dita em voz alta
// sem soletrar, e se digita com o polegar. São 10.000 combinações — muito menos que o alfabeto
// anterior, e mais que suficiente para o número de salas simultâneas deste estágio, desde que a
// colisão seja verificada contra as salas VIVAS (é o que `reservarCodigo` faz).
//
// O código é **string em toda a cadeia**, nunca número. `0315` convertido para `Number` vira
// `315`, e o zero à esquerda some — o jogador digitaria o código que está na tela do amigo e
// receberia "sala não encontrada". É por isso que não existe nenhum `Number()` neste caminho,
// nem aqui, nem no `recoveryToken`, nem no input do frontend.

/** Só dígitos. O código é lido em voz alta e digitado em teclado numérico. */
export const ALFABETO = "0123456789";
export const TAMANHO_CODIGO = 4;

/** 10^4 = 10.000 combinações. A colisão é resolvida por verificação, não por tamanho. */
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
 * Normaliza o que o jogador digitou: descarta tudo que não for dígito. Assim "03 15", "0315" e
 * "0-3-1-5" chegam ao mesmo lugar. **Não** converte para número em momento algum.
 */
export function normalizarCodigo(bruto: string): string {
  return (bruto ?? "").replace(/\D/g, "");
}

/** Um código só é válido se tiver exatamente 4 dígitos. */
export function codigoValido(codigo: string): boolean {
  if (typeof codigo !== "string") return false;
  if (codigo.length !== TAMANHO_CODIGO) return false;
  for (const c of codigo) if (!ALFABETO.includes(c)) return false;
  return true;
}

/**
 * Reserva um código livre. Em colisão, tenta de novo.
 *
 * Com 10.000 combinações a colisão deixa de ser desprezível como era antes: com 30 salas vivas a
 * chance de esbarrar numa já usada é de 0,3% por tentativa. Por isso o retry não é decorativo —
 * é o mecanismo. Cem tentativas cobrem folgadamente qualquer cenário deste estágio.
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
