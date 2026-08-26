// O RELÓGIO QUE O CLIENTE PODE USAR — e por que não é o `Date.now()`.
//
// A autoridade do tempo é o SERVIDOR, e a arquitetura já respeita isso: ele manda `restanteMs`,
// uma DURAÇÃO, e o cliente só conta a partir de quando a mensagem chegou. Nada aqui decide quando
// o prazo acaba; quem derruba a jogada por estouro é o servidor, sempre.
//
// A escolha de contar duração em vez de comparar carimbos de tempo é o que torna o KING imune a
// relógio local errado: um aparelho cinco segundos adiantado calcula exatamente o mesmo restante
// que um aparelho certo, porque a conta é `agora - recebidoEm` e o erro está nos dois lados.
//
// SOBRA UM CASO, e é este arquivo que fecha: `Date.now()` NÃO É MONOTÔNICO. Ele salta quando o
// sistema sincroniza por NTP, quando a pessoa corrige a hora na mão, quando o aparelho volta de
// suspensão com a hora reajustada. Um salto de dois segundos no meio de um turno faz o contador
// pular na tela, e um salto para trás o faz voltar. `performance.now()` mede desde o carregamento
// da página e nenhum ajuste de hora o move.
//
// Não é sincronização de relógio, e não precisa ser: não há NTP aqui, não há offset estimado, não
// há correção de drift. Só se trocou uma régua que se mexe por uma que não se mexe.

/**
 * Milissegundos desde o início da página, imunes a ajuste de hora do sistema.
 *
 * Cai para `Date.now()` onde `performance` não existe (ambiente de teste minimalista, motor
 * antigo). O fallback é pior, e é justamente por isso que ele é fallback.
 */
export function agoraMonotonico(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}
