// MENSAGENS SOCIAIS — comunicação rápida, de conjunto fechado.
//
// NÃO existe chat livre, e não é por preguiça: é a decisão de produto. Numa mesa de quatro
// pessoas jogando contra amigos, texto livre traz moderação, denúncia, bloqueio, retenção de
// conteúdo e um problema de classificação etária nas lojas — tudo isso para entregar algo que
// oito frases prontas já entregam. O que o jogador manda é uma ETIQUETA; o texto vive no
// cliente, e o servidor nunca transporta uma palavra escrita por ninguém.
//
// Consequência de segurança: não há como injetar conteúdo ofensivo, link, HTML ou dado pessoal
// numa mensagem que aparece na tela dos outros três. O pior que um cliente modificado consegue
// é mandar uma frase da lista fora de hora — e o limitador abaixo trata disso.

/**
 * As etiquetas válidas. Espelha `MENSAGENS` de `apps/web/src/ui/social.ts`, que guarda o texto.
 * Um teste de contrato falha se as duas listas divergirem.
 */
export const MENSAGENS_SOCIAIS = [
  // elogio
  "boa", "mandou-bem", "bonita",
  // provocação
  "quase", "doeu", "presente", "sem-querer",
  // o Rei
  "achou-o-rei", "coroado", "com-carinho",
  // fase positiva
  "agora-comecou", "segura-essa", "ainda-da-jogo",
  // fim de partida
  "revanche", "por-pouco", "mesa-minha",
  // cortesia — as duas únicas que servem para combinar algo, e por isso não podem faltar
  "ja-volto", "desculpa",
] as const;

export type MensagemSocial = (typeof MENSAGENS_SOCIAIS)[number];

export function mensagemValida(bruto: unknown): bruto is MensagemSocial {
  return typeof bruto === "string" && (MENSAGENS_SOCIAIS as readonly string[]).includes(bruto);
}

// ───────────────────────── ANTI-SPAM ─────────────────────────
//
// Três limites, cada um contra um abuso diferente:
//
//   COOLDOWN     — impede a metralhadora. Um toque a cada 3s já é mais rápido do que qualquer
//                  pessoa quer ler.
//   JANELA/MAX   — impede a rajada espaçada, que passaria pelo cooldown: quatro mensagens em
//                  quinze segundos é o teto de uma pessoa animada; a quinta é assédio.
//   DURACAO      — o balão some sozinho. Uma mensagem por jogador de cada vez, sempre a última:
//                  ninguém empilha frases na tela de quem está tentando jogar.
//
// Nenhum destes números toca no relógio da decisão nem em qualquer regra. Uma mensagem recusada
// não custa turno, não altera estado e não gera efeito nenhum além da recusa a quem enviou.

export const COOLDOWN_MS = 3_000;
export const JANELA_MS = 15_000;
export const MAX_NA_JANELA = 4;
/** Quanto tempo o balão fica na tela dos outros. */
export const DURACAO_MS = 4_000;

export type VeredictoSocial =
  | { ok: true }
  | { ok: false; code: "INVALID_PAYLOAD" | "RATE_LIMITED"; message: string };

/**
 * Guarda o ritmo de cada assento. Vive na sala, não no cliente — limite conferido no cliente é
 * sugestão, e a sugestão é justamente o que um cliente modificado ignora.
 */
export class RitmoSocial {
  readonly #historico = new Map<number, number[]>();

  /** Registra o envio se ele for permitido. Chamar UMA vez por mensagem. */
  permitir(seat: number, agora: number): VeredictoSocial {
    const envios = (this.#historico.get(seat) ?? []).filter((t) => agora - t < JANELA_MS);

    const ultimo = envios[envios.length - 1];
    if (ultimo !== undefined && agora - ultimo < COOLDOWN_MS) {
      return { ok: false, code: "RATE_LIMITED", message: "Calma — espere um instante" };
    }
    if (envios.length >= MAX_NA_JANELA) {
      return { ok: false, code: "RATE_LIMITED", message: "Muitas mensagens seguidas" };
    }

    envios.push(agora);
    this.#historico.set(seat, envios);
    return { ok: true };
  }

  /** O assento foi liberado; o histórico dele não deve punir quem sentar depois. */
  esquecer(seat: number): void {
    this.#historico.delete(seat);
  }
}
