// SEMENTES DO TORNEIO — tudo que o torneio sorteia sai de UMA semente.
//
// É isso que torna o torneio auditável: com a semente e as escolhas do humano na mesa dele, a
// chave inteira se refaz igual — o sorteio das mesas, os baralhos de cada partida e as jogadas
// dos bots (o Bot Normal é determinístico). E é o que permite à persistência guardar só o mínimo
// e REFAZER o resto para conferir (ver `persistencia.ts`).
//
// A mistura é o finalizador do MurmurHash3: barato, sem estado e espalha bem bits vizinhos — a
// semente da mesa 0 e a da mesa 1 não podem gerar baralhos parecidos.

/** Mistura de 32 bits (finalizador do MurmurHash3). Determinística e sem estado. */
export function misturar(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Combina a semente com rótulos numéricos, em ordem (a ordem importa: (1,2) ≠ (2,1)). */
export function derivar(semente: number, ...rotulos: number[]): number {
  let h = misturar(semente ^ 0x4b494e47); // "KING"
  for (const r of rotulos) h = misturar((h ^ Math.imul(r + 1, 0x9e3779b1)) >>> 0);
  return h >>> 0;
}

/** Rótulos fixos de cada uso — duas finalidades nunca compartilham a mesma sequência. */
export const USO = { sorteio: 1, mesa: 2, desempate: 3, nomes: 4 } as const;
