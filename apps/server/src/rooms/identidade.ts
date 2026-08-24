// IDENTIDADE DOS PARTICIPANTES — avatar e nome de bot.
//
// As duas coisas têm a mesma natureza e por isso moram juntas: são **atribuídas ou validadas
// pelo servidor** e vivem no estado sincronizado, para que todos os clientes vejam exatamente o
// mesmo. Um avatar sorteado no frontend apareceria diferente em cada aparelho; um nome de bot
// sorteado no frontend faria o Tito ver "Reizinho" onde a Raiza vê "Mão Fria".

// ═══════════════════════════════ AVATARES ═══════════════════════════════
//
// O avatar é um IDENTIFICADOR de conjunto fechado, nunca uma URL nem um dado livre do cliente.
// Conjunto fechado significa: o cliente não consegue injetar texto arbitrário no estado público
// que todos os outros vão renderizar. O que o cliente manda é uma etiqueta; o que o servidor
// aceita é só o que está nesta lista.
//
// ⚠ A ARTE AINDA NÃO EXISTE. Estes oito são a arquitetura e a DIREÇÃO proposta, com um glifo
// provisório cada um. A coleção definitiva depende de validação — ver a entrega da Fase Social.
export const AVATARES = [
  "coroa",     // a coroa do KING — o avatar padrão da casa
  "rei",       // o rei que ninguém quer
  "dama",      // a dama, bucha das negativas
  "valete",    // o valete
  "espadas",
  "copas",
  "ouros",
  "paus",
] as const;

export type Avatar = (typeof AVATARES)[number];

/** Quem entra sem escolher fica com a coroa. Nunca `""` — o estado público não tem buraco. */
export const AVATAR_PADRAO: Avatar = "coroa";

/**
 * Aceita só o que está no conjunto. Qualquer outra coisa — texto livre, número, objeto, HTML —
 * vira o padrão em silêncio, porque avatar inválido é erro de cliente e não vale derrubar a
 * entrada de alguém na sala por causa disso.
 */
export function avatarValido(bruto: unknown): Avatar {
  return typeof bruto === "string" && (AVATARES as readonly string[]).includes(bruto)
    ? (bruto as Avatar)
    : AVATAR_PADRAO;
}

// ═══════════════════════════════ NOMES DE BOT ═══════════════════════════════
//
// Uma mesa com "BOT NORMAL" e "BOT NORMAL" não é uma mesa, é uma planilha. O nome dá cara ao
// oponente sem fingir que ele é gente: a interface continua marcando o assento como bot, e o
// nome é claramente de personagem, não de pessoa.
//
// A dificuldade continua sendo NORMAL e só. O nome é identidade, não nível.
export const NOMES_DE_BOT = [
  "Reizinho",       // o Rei que ninguém quer, no diminutivo de quem já levou -160
  "Dama de Ferro",  // a mão das Damas
  "Valete Folgado", // joga como quem não está nem aí — e às vezes está certo
  "Baralhado",      // baralho + atrapalhado
  "Mão Fria",       // "mão" é a mão de cartas E o sangue-frio
  "Fura-Vaza",      // quem entra na vaza que era sua
  "Seu Trunfo",     // o "seu" de mesa de família
  "Zé do Naipe",    // o sujeito que sempre tem o naipe que falta
] as const;

/**
 * Escolhe um nome que ainda não esteja na mesa.
 *
 * `ocupados` são os apelidos já sentados — inclusive de humanos, porque duas "Mão Fria" na mesma
 * mesa confundiria igual, venha o nome de onde vier. Se a lista se esgotar (não acontece com 8
 * nomes e 3 bots, mas o código não pode depender disso), cai num sufixo numérico em vez de
 * repetir: "Reizinho 2" é feio, dois "Reizinho" é ambíguo, e ambíguo é pior.
 */
export function nomeDeBotLivre(ocupados: readonly string[], rnd: () => number = Math.random): string {
  const usados = new Set(ocupados.map((n) => n.trim().toLowerCase()));
  const livres = NOMES_DE_BOT.filter((n) => !usados.has(n.toLowerCase()));
  if (livres.length > 0) return livres[Math.floor(rnd() * livres.length) % livres.length];

  for (let i = 2; i < 100; i++) {
    for (const base of NOMES_DE_BOT) {
      const tentativa = `${base} ${i}`;
      if (!usados.has(tentativa.toLowerCase())) return tentativa;
    }
  }
  return "Bot";
}

/** Avatar do bot: determinístico pelo assento, para não sortear duas coisas ao mesmo tempo. */
export function avatarDeBot(seat: number): Avatar {
  return AVATARES[((seat % AVATARES.length) + AVATARES.length) % AVATARES.length];
}
