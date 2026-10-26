// QUEM ESTÁ NUMA SALA VIVA DESTE PROCESSO — para o expurgo das lápides (E-2) não tirar a de ninguém
// que ainda pode entrar num crédito.
//
// O token de identidade só é conferido na ENTRADA da sala. Quem cai no lobby volta para o mesmo
// assento sem token, e o lobby não tem prazo de vida: uma partida pode começar — e pedir crédito —
// muito depois de um dos jogadores ter excluído a conta (red team do desenho da E-2, achado 1). Por
// isso o expurgo lê, no MESMO trecho síncrono em que lê o outbox, todo id que alguma sala viva
// conhece, e protege todos.
//
// Quem entrar DEPOIS dessa leitura entra com um token válido naquele instante, e um token vale no
// máximo uma semana (teto do Supabase): se a conta foi excluída, a lápide ainda é jovem demais para
// o prazo de 30 dias.
type LeitorDaSala = () => Iterable<string>;

const salas = new Map<object, LeitorDaSala>();

/** A sala se anuncia ao nascer. O leitor é chamado na hora do retrato, nunca guardado em cópia. */
export function registrarSala(sala: object, jogadores: LeitorDaSala): void {
  salas.set(sala, jogadores);
}

export function esquecerSala(sala: object): void {
  salas.delete(sala);
}

/** Todo id que alguma sala viva conhece. Uma sala que falhar ao responder LANÇA: o expurgo adia. */
export function jogadoresEmSalasVivas(): string[] {
  const ids = new Set<string>();
  for (const ler of salas.values()) for (const id of ler()) ids.add(id);
  return [...ids];
}
