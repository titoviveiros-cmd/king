// A PARTIDA DO HUMANO NO TORNEIO — a mesa solo de sempre, com a mesa que a chave sorteou.
//
// É um `KingGame` comum: mesmo motor, mesmos bots, mesma Mesa. Muda só quem senta (nomes e bichos
// da chave) e a semente (a da mesa do torneio, e não uma aleatória). Recomeçar a partida usa a
// MESMA semente: o baralho é o mesmo, e nenhum resultado depende de quantas vezes se tentou.
//
// Nunca conta para recorde: `recordes: false`. O Top 3 Solo é das partidas avulsas da Home; o
// torneio tem a própria chave como placar. E não há XP — XP só existe no multiplayer, creditado
// pelo servidor, e esta partida nunca sai do aparelho.
import type { Seat } from "@king/engine";
import { KingGame } from "../game/kingGame.js";
import { fatosDoEstadoDaLeitura } from "./fatos.js";
import type { FatosDaMesa } from "./desempate.js";
import { nomesDaMesa, participante, type MesaDoTorneio, type Torneio } from "./orquestrador.js";

export class PartidaDoTorneio extends KingGame {
  readonly mesaId: string;
  readonly #avatares: string[];

  constructor(t: Torneio, mesa: MesaDoTorneio) {
    super(nomesDaMesa(t, mesa), mesa.semente, 0, t.maoInicial, t.avatar, { recordes: false });
    this.mesaId = mesa.id;
    this.#avatares = mesa.assentos.map((id) => participante(t, id).avatar);
  }

  /** Os bichos da chave, e não os da mesa local fixa: na Copa cada mesa tem a sua gente. */
  override avatarDoAssento(seat: Seat): string | undefined {
    return this.#avatares[seat];
  }

  /** Os fatos da partida terminada — os mesmos números que o Placar Final mostra. */
  fatos(): FatosDaMesa | null {
    return this.finished() ? fatosDoEstadoDaLeitura(this) : null;
  }
}
