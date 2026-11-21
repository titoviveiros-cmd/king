// PARÂMETROS DE QA DO TORNEIO — os mesmos da mesa solo (`?seed=` e `?mao=`, ver useKingGame).
//
//   ?seed=N  fixa a semente do TORNEIO: o sorteio, as mesas de bots e o baralho da sua mesa.
//   ?mao=10  a SUA partida em cada fase começa na mão 10 (as de bots jogam as 10 mãos sempre).
//
// Qualquer um deles marca o torneio como de teste, e a tela diz isso. Nenhum torneio concede XP,
// recorde ou conquista — mas um torneio de QA também não pode PARECER legítimo: o selo fica
// visível em todas as telas dele.
export interface QaDoTorneio {
  semente: number | null;
  maoInicial: number | null;
}

export function qaDaUrl(busca: string = globalThis.location?.search ?? ""): QaDoTorneio {
  const p = new URLSearchParams(busca);
  const s = p.get("seed");
  const m = p.get("mao");
  const semente = s !== null && s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) >>> 0 : null;
  const n = m === null ? NaN : Number(m);
  return { semente, maoInicial: Number.isInteger(n) && n >= 1 && n <= 10 ? n : null };
}

/** Semente para um torneio de verdade. `crypto` quando houver; não precisa ser segredo, só variar. */
export function sementeNova(): number {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0];
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}
