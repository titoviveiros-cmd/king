// AVATARES — a coleção oficial do KING e como ela é desenhada hoje.
//
// A COLEÇÃO está fechada e aprovada: oito rostos de bicho antropomorfizados, mesmo princípio do
// Verbete, personagens próprios do KING. As etiquetas são o contrato com o servidor
// (`apps/server/src/rooms/identidade.ts`) e não mudam quando a arte chegar.
//
// ⚠ O DESENHO ABAIXO É PROVISÓRIO E DELIBERADAMENTE NÃO É ARTE.
//
// São emoji do sistema, escolhidos como marcador temporário para a arquitetura ficar jogável e
// testável hoje. Eles têm dois defeitos conhecidos, e os dois são argumentos a favor da arte
// própria, não contra o placeholder:
//
//   1. RENDERIZAM DIFERENTE em cada sistema — o leão da Apple não é o leão do Android. Um sistema
//      de IDENTIDADE que muda de cara conforme o aparelho é justamente o que não pode existir, e
//      é por isso que a ilustração própria é obrigatória antes de publicar.
//   2. UM NÃO TEM EMOJI: tucano não existe no conjunto Unicode. Está com o substituto mais
//      próximo (papagaio) e fica visivelmente errado de propósito — é um lembrete de que isto é
//      andaime.
//
// E O SEGUNDO DEFEITO JÁ COBROU O PREÇO. A capivara também não tinha emoji e estava com 🦫, o
// castor. Ao lado do 🐵 do macaco, o placeholder criava uma duplicidade que não existia nas
// personas: dois primatas pequenos e marrons na mesma fileira. Ela saiu da coleção e deu lugar ao
// unicórnio, que tem glifo próprio e não se confunde com ninguém.
//
// Quando a arte chegar, muda este arquivo e nada mais: nem o protocolo, nem o servidor, nem os
// testes de contrato.

/** As oito etiquetas. Espelha `AVATARES` de `apps/server/src/rooms/identidade.ts`. */
export const AVATARES = [
  "leao", "coruja", "raposa", "macaco", "panda", "tucano", "unicornio", "sapo",
] as const;
export type Avatar = (typeof AVATARES)[number];

export const AVATAR_PADRAO: Avatar = "leao";

export interface Desenho {
  /** Marcador provisório. Ver o aviso no topo do arquivo. */
  glifo: string;
  /** Nome do bicho. Vai para `aria-label` — acessibilidade, não decoração. */
  rotulo: string;
  /** O personagem. Aparece no seletor e é o norte do brief de arte. */
  persona: string;
  /** `true` enquanto o emoji não for o bicho certo. Some quando a ilustração entrar. */
  aproximado?: boolean;
}

const DESENHOS: Record<Avatar, Desenho> = {
  leao:     { glifo: "🦁", rotulo: "Leão",     persona: "O Soberano" },
  coruja:   { glifo: "🦉", rotulo: "Coruja",   persona: "A Paciente" },
  raposa:   { glifo: "🦊", rotulo: "Raposa",   persona: "A Calculista" },
  macaco:   { glifo: "🐵", rotulo: "Macaco",   persona: "O Bagunceiro" },
  panda:    { glifo: "🐼", rotulo: "Panda",    persona: "O Tranquilo" },
  tucano:   { glifo: "🦜", rotulo: "Tucano",   persona: "O Anunciador", aproximado: true },
  unicornio:{ glifo: "🦄", rotulo: "Unicórnio", persona: "O Sonhador" },
  sapo:     { glifo: "🐸", rotulo: "Sapo",     persona: "O Malandro" },
};

/** Nunca falha: etiqueta desconhecida cai no padrão, do mesmo jeito que o servidor faz. */
export function desenhoDoAvatar(id: string | undefined): Desenho {
  return DESENHOS[(id ?? "") as Avatar] ?? DESENHOS[AVATAR_PADRAO];
}

/**
 * ETIQUETAS APOSENTADAS, e para onde elas vão.
 *
 * QUEM SAIU FOI A CAPIVARA, e vale registrar como ela foi identificada, porque o critério não era
 * o nome: o pedido era "o avatar imediatamente à esquerda do Sapo". No seletor, que desenha
 * `AVATARES` na ordem do array, esse lugar era o da capivara.
 *
 * E ela parecia um mico por um motivo concreto: capivara NÃO TEM emoji no Unicode. O marcador
 * provisório era 🦫, o castor — um mamífero pequeno, marrom e de cara redonda que, ao lado do
 * 🐵 do macaco quatro posições antes, lia-se como um segundo primata menor. A duplicidade era
 * visual, criada pelo placeholder, e não conceitual: as personas nunca foram parecidas.
 *
 * O MACACO FICA. Ele é a posição 4 da coleção e nunca foi o problema.
 *
 * A tabela abaixo é de MIGRAÇÃO, não de descarte: quem escolheu a capivara reabre o KING e
 * encontra o unicórnio selecionado, em vez de cair no leão padrão sem explicação. `mico` entra
 * como apelido do mesmo caso, porque é o nome pelo qual o bicho foi pedido.
 *
 * O que NÃO pode existir aqui é uma entrada para `macaco`: ele está na coleção, então
 * `avatarValido` o devolve intacto na primeira linha, sem nunca consultar este mapa.
 */
const APOSENTADOS: Record<string, Avatar> = {
  capivara: "unicornio",
  mico: "unicornio",
};

export const avatarValido = (id: unknown): Avatar => {
  if (typeof id !== "string") return AVATAR_PADRAO;
  if ((AVATARES as readonly string[]).includes(id)) return id as Avatar;
  return APOSENTADOS[id] ?? AVATAR_PADRAO;
};

/** Onde a última escolha do jogador é lembrada. Conveniência local — NUNCA a fonte da verdade. */
/**
 * ══ AQUI MORAVA A MEMÓRIA DO ÚLTIMO AVATAR ══
 *
 * `lembrarAvatar` gravava a escolha em `localStorage` e `avatarLembrado` a devolvia pré-selecionada
 * na Home. Era conveniência, e virou o contrário: quem abria o jogo encontrava um bicho já
 * marcado, como se ele tivesse escolhido — e ao criar uma sala levava essa escolha silenciosa
 * junto. Avatar é identidade; identidade que aparece sozinha não é escolha.
 *
 * A regra passou a ser: a escolha vale para o FLUXO ATUAL e morre ao voltar para a Home. Sem
 * leitura não há pré-seleção, e sem pré-seleção a escrita não serve a ninguém — guardar algo que
 * nunca é lido é a pior das combinações, porque parece intenção e não é.
 *
 * Quem quiser reintroduzir memória entre sessões precisa resolver antes o que ela significa na
 * tela: sugerir sem parecer decidido.
 */
