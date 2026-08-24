// AVATARES — apresentação da identidade escolhida.
//
// ⚠ ARTE PROVISÓRIA, DE PROPÓSITO.
//
// O projeto não tem nenhum asset de imagem hoje: até agora o "avatar" era a primeira letra do
// apelido num círculo colorido. Esta camada implementa a ARQUITETURA — id de conjunto fechado,
// validado no servidor, vivendo no estado sincronizado — e desenha cada um com um glifo do
// universo do KING enquanto a coleção definitiva não é aprovada.
//
// Os glifos abaixo NÃO são a arte final e não pretendem ser. São reconhecíveis, custam zero
// bytes de download e deixam a arquitetura testável e jogável hoje. Trocá-los por ilustração
// depois é mudar este arquivo e nada mais: nem o protocolo, nem o servidor, nem os testes.
//
// A ordem aqui é a ordem do seletor na Home.

/** Os oito do conjunto fechado. Espelha `AVATARES` de `apps/server/src/rooms/identidade.ts`. */
export const AVATARES = ["coroa", "rei", "dama", "valete", "espadas", "copas", "ouros", "paus"] as const;
export type Avatar = (typeof AVATARES)[number];

export const AVATAR_PADRAO: Avatar = "coroa";

interface Desenho {
  /** Glifo provisório. */
  glifo: string;
  /** Nome legível — vai para `aria-label` e para o seletor. Acessibilidade, não decoração. */
  rotulo: string;
  /** Naipe vermelho pinta diferente sobre o círculo do assento. */
  vermelho?: boolean;
}

const DESENHOS: Record<Avatar, Desenho> = {
  coroa:   { glifo: "♔", rotulo: "Coroa" },
  rei:     { glifo: "K", rotulo: "Rei" },
  dama:    { glifo: "Q", rotulo: "Dama" },
  valete:  { glifo: "J", rotulo: "Valete" },
  espadas: { glifo: "♠", rotulo: "Espadas" },
  copas:   { glifo: "♥", rotulo: "Copas", vermelho: true },
  ouros:   { glifo: "♦", rotulo: "Ouros", vermelho: true },
  paus:    { glifo: "♣", rotulo: "Paus" },
};

/** Nunca falha: id desconhecido cai no padrão, do mesmo jeito que o servidor faz. */
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
