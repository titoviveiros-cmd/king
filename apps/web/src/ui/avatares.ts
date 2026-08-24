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
//   2. DOIS NÃO TÊM EMOJI: tucano e capivara não existem no conjunto Unicode. Estão com o
//      substituto mais próximo (papagaio e castor) e ficam visivelmente errados de propósito —
//      é um lembrete de que isto é andaime.
//
// Quando a arte chegar, muda este arquivo e nada mais: nem o protocolo, nem o servidor, nem os
// testes de contrato.

/** As oito etiquetas. Espelha `AVATARES` de `apps/server/src/rooms/identidade.ts`. */
export const AVATARES = [
  "leao", "coruja", "raposa", "macaco", "panda", "tucano", "capivara", "sapo",
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
  capivara: { glifo: "🦫", rotulo: "Capivara", persona: "A Imperturbável", aproximado: true },
  sapo:     { glifo: "🐸", rotulo: "Sapo",     persona: "O Malandro" },
};

/** Nunca falha: etiqueta desconhecida cai no padrão, do mesmo jeito que o servidor faz. */
export function desenhoDoAvatar(id: string | undefined): Desenho {
  return DESENHOS[(id ?? "") as Avatar] ?? DESENHOS[AVATAR_PADRAO];
}

export const avatarValido = (id: unknown): Avatar =>
  typeof id === "string" && (AVATARES as readonly string[]).includes(id) ? (id as Avatar) : AVATAR_PADRAO;

/** Onde a última escolha do jogador é lembrada. Conveniência local — NUNCA a fonte da verdade. */
const CHAVE = "king:avatar";

export function lembrarAvatar(id: Avatar): void {
  try { localStorage?.setItem(CHAVE, id); } catch { /* sem persistência: só não lembra */ }
}

export function avatarLembrado(): Avatar {
  try { return avatarValido(localStorage?.getItem(CHAVE)); } catch { return AVATAR_PADRAO; }
}
