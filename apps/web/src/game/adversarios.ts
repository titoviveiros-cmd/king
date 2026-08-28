// OS ADVERSÁRIOS DO MODO LOCAL — nome e avatar, de uma fonte só.
//
// ══ POR QUE ESTE ARQUIVO EXISTE ══
//
// O multiplayer já resolvia identidade direito: o servidor sorteia nome e avatar de conjuntos
// fechados (`apps/server/src/rooms/identidade.ts`) e sincroniza, então os quatro aparelhos veem os
// mesmos quatro jogadores.
//
// O modo local e o tutorial ficaram para trás. Os dois traziam `["Você", "Bia", "Léo", "Nara"]`
// escrito à mão, de uma fase do projeto anterior aos nomes de personagem, e nenhum dos dois
// atribuía avatar nenhum — os cards caíam na inicial do nome, e o mini perfil, que resolve avatar
// por etiqueta, recebia `undefined` e desenhava o Leão para os quatro.
//
// ══ ESPELHO, NÃO SEGUNDA VERDADE ══
//
// Os nomes abaixo são os mesmos de `NOMES_DE_BOT` no servidor, e o teste de contrato compara as
// duas listas caractere a caractere. Não dá para importar do servidor: o cliente não depende do
// pacote do servidor, e não vai passar a depender por causa de oito strings. O que sustenta a
// cópia é o teste, não a boa vontade.
//
// A mesa local é DETERMINÍSTICA de propósito: sempre os mesmos três adversários, com os mesmos
// avatares. Não é limitação — é o que faz duas partidas seguidas terem a mesma cara, e o que
// torna o tutorial reproduzível.
import { AVATARES, type Avatar } from "../ui/avatares.js";

/** Como o jogador humano se chama quando não há apelido: é a Mesa dele. */
export const NOME_DO_HUMANO = "Você";

/**
 * Os nomes de bot do KING. Espelha `NOMES_DE_BOT` de `apps/server/src/rooms/identidade.ts`.
 *
 * Uma mesa com "BOT 1" e "BOT 2" não é uma mesa, é uma planilha. O nome dá cara ao oponente sem
 * fingir que ele é gente: a interface continua marcando o assento como bot.
 */
export const NOMES_DE_BOT = [
  "Reizinho",
  "Dama de Ferro",
  "Valete Folgado",
  "Baralhado",
  "Mão Fria",
  "Fura-Vaza",
  "Sr. Trunfo",
  "Zé do Naipe",
] as const;

export interface Adversario {
  nome: string;
  avatar: Avatar;
}

/**
 * A mesa local: você no assento 0 e três adversários fixos.
 *
 * Os avatares são escolhidos para serem DIFERENTES entre si e fáceis de distinguir de relance —
 * é a mesma exigência que o multiplayer resolve evitando colisão. Quatro cards com o mesmo bicho
 * seria o defeito que esta rodada veio corrigir, agora por outro caminho.
 */
export const MESA_LOCAL: readonly Adversario[] = [
  { nome: NOME_DO_HUMANO, avatar: "leao" },
  { nome: "Dama de Ferro", avatar: "coruja" },
  { nome: "Sr. Trunfo", avatar: "raposa" },
  { nome: "Fura-Vaza", avatar: "sapo" },
];

/** Só os nomes, na ordem dos assentos — é o que `KingGame` e `PartidaDeTreino` pedem. */
export const NOMES_DA_MESA_LOCAL: string[] = MESA_LOCAL.map((a) => a.nome);

/** O avatar de um assento da mesa local. `undefined` fora da faixa, nunca um padrão silencioso. */
export function avatarLocalDoAssento(seat: number): Avatar | undefined {
  return MESA_LOCAL[seat]?.avatar;
}

/**
 * O avatar de um BOT da mesa local, sabendo o que o humano escolheu.
 *
 * A mesa local sempre teve identidade fixa — os mesmos quatro bichos, toda partida. Isso deixou
 * de bastar quando o jogador passou a escolher o dele: escolher o Sapo colocava duas rãs na mesa,
 * porque o "Fura-Vaza" já era o Sapo. Dois desenhos iguais, distinguíveis só pela cor do assento.
 *
 * A regra é a mesma do servidor (`avatarDeBot`): o determinismo cede quando há colisão, e só
 * então. O bot atingido recebe o primeiro bicho livre do catálogo, na ordem — nada de sorteio,
 * para a mesa continuar reproduzível.
 */
export function avatarDeBotLocal(seat: number, avatarDoHumano?: string): Avatar | undefined {
  const meu = MESA_LOCAL[seat]?.avatar;
  if (!meu || !avatarDoHumano || meu !== avatarDoHumano) return meu;
  const ocupados = new Set<string>([avatarDoHumano, ...MESA_LOCAL.map((a) => a.avatar)]);
  ocupados.delete(meu);
  return AVATARES.find((a) => !ocupados.has(a)) ?? meu;
}

/** Guarda de tipo usada pelos testes: toda etiqueta daqui existe na coleção. */
export const todosOsAvataresSaoValidos = (): boolean =>
  MESA_LOCAL.every((a) => (AVATARES as readonly string[]).includes(a.avatar));
