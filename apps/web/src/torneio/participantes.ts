// OS PARTICIPANTES — quem joga o torneio e onde cada um senta na primeira fase.
//
// Tudo sai da semente do torneio e do avatar que o humano escolheu. Nada aqui é guardado: a
// persistência refaz esta lista a partir dessas duas coisas, e é por isso que um save adulterado
// não consegue trocar o nome ou o bicho de ninguém.
import { createRng, shuffle } from "@king/engine";
import { AVATARES, type Avatar } from "../ui/avatares.js";
import { NOMES_DE_BOT, NOME_DO_HUMANO } from "../game/adversarios.js";
import type { Formato } from "./formatos.js";
import { ASSENTOS_POR_MESA } from "./formatos.js";
import { derivar, USO } from "./sementes.js";

export interface Participante {
  /** Índice estável no torneio. O humano é sempre o 0. */
  id: number;
  nome: string;
  avatar: Avatar;
  humano: boolean;
}

/**
 * Os nomes de bot do torneio: os oito da mesa (mesmo elenco do multiplayer) e mais vinte e três
 * próprios do torneio, para a Copa ter 31 adversários sem repetir ninguém.
 *
 * Mesma regra dos nomes da mesa: dar cara ao oponente sem fingir que ele é gente — a interface
 * continua marcando cada um como bot. Todos cabem em 14 caracteres, o limite do apelido.
 */
export const NOMES_DO_TORNEIO: readonly string[] = [
  ...NOMES_DE_BOT,
  "Duquesa",
  "Barão de Paus",
  "Capitã Copas",
  "Lorde Espadas",
  "Vaza Certa",
  "Mestre Corte",
  "Tia Rainha",
  "Conde Trinca",
  "Sete Belo",
  "Marquesa",
  "Ás Calado",
  "Bispo do Blefe",
  "Lady Trunfo",
  "Cartola",
  "Seu Valete",
  "Joia Real",
  "Príncipe Ouros",
  "Corte Fino",
  "Dona Sorte",
  "Mão de Seda",
  "Rei Posto",
  "Naipe Novo",
  "Barulhento",
];

/**
 * Os participantes, já na ORDEM DO SORTEIO: os índices 0–3 formam a mesa 0 da primeira fase, 4–7
 * a mesa 1, e assim por diante. O `id` do humano é sempre 0; onde ele cai na chave é o sorteio que
 * decide.
 *
 * OS AVATARES SÃO DISTINTOS DENTRO DE CADA MESA INICIAL. Oito bichos para 32 pessoas obrigam a
 * repetir na chave, mas nunca na mesma mesa: os bots recebem, na ordem do sorteio, os sete bichos
 * que o humano NÃO escolheu, em ciclo. Quatro consecutivos de um ciclo de sete nunca se repetem, e
 * a mesa do humano tem três bots consecutivos mais o bicho dele, que está fora do ciclo.
 */
export function sortearParticipantes(formato: Formato, semente: number, avatarDoHumano: Avatar): {
  participantes: Participante[];
  /** `ordem[k]` = id de quem ocupa a posição k do sorteio. */
  ordem: number[];
} {
  const n = formato.participantes;
  const nomes = shuffle(NOMES_DO_TORNEIO, createRng(derivar(semente, USO.nomes))).slice(0, n - 1);
  const ordem = shuffle(Array.from({ length: n }, (_, i) => i), createRng(derivar(semente, USO.sorteio)));
  const ciclo = AVATARES.filter((a) => a !== avatarDoHumano);

  const participantes: Participante[] = [{ id: 0, nome: NOME_DO_HUMANO, avatar: avatarDoHumano, humano: true }];
  // O k-ésimo bot NA ORDEM DO SORTEIO recebe ciclo[k % 7]: é o que mantém a mesa sem bicho repetido.
  let k = 0;
  const avatarDoId = new Map<number, Avatar>();
  for (const id of ordem) {
    if (id === 0) continue;
    avatarDoId.set(id, ciclo[k % ciclo.length]);
    k++;
  }
  for (let id = 1; id < n; id++) {
    participantes.push({ id, nome: nomes[id - 1], avatar: avatarDoId.get(id)!, humano: false });
  }
  return { participantes, ordem };
}

/** As mesas da primeira fase: grupos de quatro, na ordem do sorteio. */
export function mesasIniciais(ordem: readonly number[]): number[][] {
  const mesas: number[][] = [];
  for (let i = 0; i < ordem.length; i += ASSENTOS_POR_MESA) mesas.push(ordem.slice(i, i + ASSENTOS_POR_MESA));
  return mesas;
}
