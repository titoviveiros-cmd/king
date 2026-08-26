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
// A COLEÇÃO OFICIAL — oito rostos de bicho, aprovada em 24/08/2026. Mesmo princípio do Verbete,
// personagens próprios do KING: irmãos, não gêmeos.
//
// ⚠ A ARTE FINAL AINDA NÃO EXISTE. Estas são as ETIQUETAS, que é o que o servidor precisa saber;
// o desenho vive no cliente e hoje é provisório. Trocar o desenho depois não toca aqui.
export const AVATARES = [
  "leao",     // O Soberano — a juba é a coroa; o padrão da casa
  "coruja",   // A Paciente — espera doze vazas para dar o bote
  "raposa",   // A Calculista — conta cartas e sorri quando você erra
  "unicornio",// O Sonhador — joga pelo espetáculo, não pelo placar
  "panda",    // O Tranquilo — leva -160 e ri
  "tucano",   // O Anunciador — fala primeiro, pensa depois
  "capivara", // A Imperturbável — ganha sem levantar a sobrancelha
  "sapo",     // O Malandro — a ponte com o Verbete, em interpretação própria
] as const;

export type Avatar = (typeof AVATARES)[number];

// ═══════════════════════════════ TEMA DA MESA ═══════════════════════════════
//
// Mesma disciplina do avatar, e pelo mesmo motivo: é uma ETIQUETA de conjunto fechado, nunca um
// valor livre. O que o cliente manda é o nome do tema; o que o servidor aceita é o que está aqui.
// O desenho vive no cliente — trocar a cor não toca neste arquivo.
//
// É configuração de SALA, não de jogador: todo mundo joga na mesma mesa, então quem escolhe é o
// anfitrião e o valor é sincronizado como qualquer outro estado público.
export const TEMAS_DA_MESA = [
  "imperial", // Noite Imperial — o roxo aprovado, o padrão da casa
  "verde",    // Verde de Cartas — mesa clássica de baralho, na paleta do KING
] as const;

export type TemaDaMesa = (typeof TEMAS_DA_MESA)[number];

export const TEMA_PADRAO: TemaDaMesa = "imperial";

/** Nunca falha: etiqueta desconhecida cai no padrão, do mesmo jeito que o avatar. */
export const temaValido = (id: unknown): TemaDaMesa =>
  typeof id === "string" && (TEMAS_DA_MESA as readonly string[]).includes(id)
    ? (id as TemaDaMesa)
    : TEMA_PADRAO;

/** Quem entra sem escolher fica com o Leão. Nunca `""` — o estado público não tem buraco. */
export const AVATAR_PADRAO: Avatar = "leao";

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
  "Sr. Trunfo",     // o tratamento de mesa de família, por extenso
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

/**
 * Avatar do bot.
 *
 * A base é DETERMINÍSTICA pelo assento — não faz sentido sortear duas coisas ao mesmo tempo, e
 * assento fixo garante que dois bots nunca nasçam iguais entre si.
 *
 * Mas o assento não sabe o que os humanos escolheram. Num teste real contra a VPS, a Raiza
 * escolheu a Dama e o bot do assento 2 recebeu a Dama também: dois desenhos idênticos na mesma
 * mesa, distinguíveis só pela cor. Com glifos isso é feio; com os rostos de bicho seria confusão
 * de verdade. Então o determinismo cede quando há colisão, e só então.
 */
export function avatarDeBot(seat: number, ocupados: readonly string[] = []): Avatar {
  const preferido = AVATARES[((seat % AVATARES.length) + AVATARES.length) % AVATARES.length];
  const usados = new Set(ocupados);
  if (!usados.has(preferido)) return preferido;
  return AVATARES.find((a) => !usados.has(a)) ?? preferido;
}
