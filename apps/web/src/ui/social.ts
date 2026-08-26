// MENSAGENS SOCIAIS — o texto.
//
// O servidor só conhece as ETIQUETAS (`apps/server/src/rooms/social.ts`); as frases vivem aqui.
// Essa separação é o que garante que nenhuma palavra escrita por um jogador chega à tela de
// outro: o que trafega é `"doeu"`, e cada cliente desenha a frase da sua própria tabela.
//
// TOM. É mesa de amigos, não arena. A régua de cada frase foi: você diria isso em voz alta para
// alguém sentado do seu lado, e a pessoa riria? Provocação sim, humilhação não. Nada que acuse
// de trapaça, nada que ataque a pessoa em vez da jogada — e nenhuma frase que fique cruel quando
// quem levou o Rei já estiver perdendo de 300.

export type CategoriaSocial = "elogio" | "provocacao" | "rei" | "positiva" | "final" | "cortesia";

export interface FraseSocial {
  id: string;
  texto: string;
  categoria: CategoriaSocial;
}

export const MENSAGENS: readonly FraseSocial[] = [
  { id: "boa",            texto: "Boa!",                    categoria: "elogio" },
  { id: "mandou-bem",     texto: "Mandou bem!",             categoria: "elogio" },
  { id: "bonita",         texto: "Essa foi bonita.",        categoria: "elogio" },

  { id: "quase",          texto: "Quase!",                  categoria: "provocacao" },
  { id: "doeu",           texto: "Essa doeu 😅",            categoria: "provocacao" },
  { id: "presente",       texto: "Valeu pelo presente!",    categoria: "provocacao" },
  { id: "sem-querer",     texto: "Foi sem querer 😇",       categoria: "provocacao" },

  { id: "achou-o-rei",    texto: "Achou o Rei! 👑",         categoria: "rei" },
  { id: "coroado",        texto: "Coroado!",                categoria: "rei" },
  { id: "com-carinho",    texto: "−160 com carinho 😈",     categoria: "rei" },

  { id: "agora-comecou",  texto: "Agora começou!",          categoria: "positiva" },
  { id: "segura-essa",    texto: "Segura essa!",            categoria: "positiva" },
  { id: "ainda-da-jogo",  texto: "Ainda dá jogo.",          categoria: "positiva" },

  { id: "revanche",       texto: "Revanche?",               categoria: "final" },
  { id: "por-pouco",      texto: "Foi por pouco!",          categoria: "final" },
  { id: "mesa-minha",     texto: "Essa mesa é minha 👑",    categoria: "final" },

  { id: "ja-volto",       texto: "Já volto!",               categoria: "cortesia" },
  { id: "desculpa",       texto: "Desculpa a demora!",      categoria: "cortesia" },
];

const POR_ID = new Map(MENSAGENS.map((m) => [m.id, m]));

/** `null` para etiqueta desconhecida: a tela ignora em vez de desenhar um balão vazio. */
export function fraseDe(id: string | undefined): FraseSocial | null {
  return POR_ID.get(id ?? "") ?? null;
}

export const ROTULO_DA_CATEGORIA: Record<CategoriaSocial, string> = {
  elogio: "Elogio",
  provocacao: "Provocação",
  rei: "O Rei",
  positiva: "Fase positiva",
  final: "Fim de partida",
  cortesia: "Cortesia",
};

/**
 * As poucas que aparecem de cara.
 *
 * Seis, e não dezoito: o painel abre no meio de uma partida com relógio correndo, e ler uma
 * lista longa custa a vez. As seis mudam com o momento — no fim da partida ninguém quer dizer
 * "segura essa", quer dizer "revanche?".
 */
export function atalhosDe(status: MomentoSocial): FraseSocial[] {
  return ATALHOS[status].map((id) => POR_ID.get(id)!).filter(Boolean);
}

/**
 * Os três momentos em que se fala à mesa.
 *
 * `placar` entrou depois de uma partida real: entre as mãos existe a única PAUSA do KING, todo
 * mundo olhando a mesma tela ao mesmo tempo, e era justamente ali que não dava para dizer nada.
 * O momento pede frases próprias, porque no intervalo ninguém comenta uma jogada que já passou:
 * comenta o resultado da mão e o que vem pela frente.
 */
export type MomentoSocial = "playing" | "placar" | "finished";

const ATALHOS: Record<MomentoSocial, string[]> = {
  playing: ["boa", "mandou-bem", "quase", "doeu", "segura-essa", "ja-volto"],
  placar: ["boa", "doeu", "achou-o-rei", "agora-comecou", "ainda-da-jogo", "revanche"],
  finished: ["revanche", "por-pouco", "mesa-minha", "boa", "quase", "coroado"],
};

/** Todas, agrupadas — o painel expandido. Preserva a ordem declarada acima. */
export function porCategoria(): { categoria: CategoriaSocial; frases: FraseSocial[] }[] {
  const ordem: CategoriaSocial[] = ["elogio", "provocacao", "rei", "positiva", "final", "cortesia"];
  return ordem.map((categoria) => ({
    categoria,
    frases: MENSAGENS.filter((m) => m.categoria === categoria),
  }));
}
