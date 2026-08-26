// MINI PERFIL — quem é a pessoa do outro lado da mesa.
//
// ══ O QUE EXISTE HOJE, E O QUE NÃO EXISTE ══
//
// Esta tela foi construída depois de uma auditoria do que o KING realmente guarda. O resultado,
// escrito aqui para ninguém precisar refazê-la:
//
//   REAL, e portanto exibido:
//     • apelido e avatar          — estado autoritativo da sala, o mesmo em todos os aparelhos
//     • cor de identidade         — pertence ao ASSENTO, e é a mesma da Mesa e do Placar
//     • situação                  — anfitrião, bot, desconectado, jogando pelo servidor
//     • saldo na partida          — `liveScores()`, do motor
//     • estatísticas da partida   — `matchStats()`: negativas ilesas, melhor mão, vazas positivas,
//                                   e quem levou o Rei de Copas
//
//   NÃO EXISTE, e portanto NÃO é exibido:
//     • XP, nível, partidas jogadas, vitórias, histórico entre partidas.
//       Não há conta, não há perfil persistido, não há banco. O `playerId` do protocolo é um
//       identificador OPACO por conexão, criado para a reconexão funcionar, e some quando a sala
//       morre. Desenhar uma barra de XP vazia aqui seria prometer o que o jogo não entrega, que
//       é a mesma dívida visível que já saiu do Placar Final por decisão anterior.
//
// Quando a camada de progressão existir de verdade, ela entra por `ProgressoDoJogador` abaixo, e
// só então a seção aparece. O componente está pronto para receber; o que ele não faz é fingir.
//
// ══ NADA TÉCNICO ATRAVESSA ══
// `playerId`, `sessionToken`, credencial de retorno, código da sala e `roomId` não entram nesta
// tela em hipótese nenhuma. O teste cobra.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { Seat } from "@king/engine";
import type { LeituraDaPartida } from "../game/leituraDaPartida.js";
import type { AssentoLido } from "../net/clienteKing.js";
import { desenhoDoAvatar } from "./avatares.js";
import { fmtSigned } from "./contractText.js";
import { sfxTap } from "../audio/sounds.js";

/**
 * A camada de progressão, quando existir.
 *
 * Deliberadamente opcional e deliberadamente ausente hoje: enquanto ninguém passar este objeto,
 * a seção não é desenhada. É o contrato que permite ligar XP depois sem tocar no resto da tela.
 */
export interface ProgressoDoJogador {
  nivel: number;
  xp: number;
  xpDoProximoNivel: number;
  partidas: number;
  vitorias: number;
}

/** Uma linha de estatística. Só entra na tela quando tem valor de verdade. */
interface Linha {
  rotulo: string;
  valor: string;
}

export function PerfilJogador({
  game, assento, sala, progresso, onFechar,
}: {
  game: LeituraDaPartida;
  /** De quem é o perfil. */
  assento: Seat;
  /** Estado da sala, quando multiplayer. Ausente = partida local contra bots. */
  sala?: AssentoLido[] | null;
  /** Progressão real. Ausente enquanto a camada não existir. */
  progresso?: ProgressoDoJogador;
  onFechar: () => void;
}) {
  const fechar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    fechar.current?.focus();
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onFechar(); }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const sair = () => { sfxTap(); onFechar(); };

  const nome = game.players()[assento];
  const doAssento = sala?.find((a) => a.seat === assento) ?? null;
  /**
   * O AVATAR VEM DO ASSENTO PEDIDO, e a ordem de autoridade é a mesma da Mesa.
   *
   * Aqui morava um bug funcional: a resolução olhava só o estado da sala. No modo local não existe
   * sala, então `doAssento` era `null` para os quatro, `desenhoDoAvatar(undefined)` caía no padrão
   * e os quatro cards abriam o Leão — inclusive o do próprio jogador. O card mostrava gente
   * diferente e o perfil mostrava sempre o mesmo bicho.
   *
   * A correção não é um fallback melhor: é perguntar a quem sabe. A partida local conhece a
   * identidade dos seus quatro assentos, e agora ela responde.
   */
  const avatar = desenhoDoAvatar(doAssento?.avatar ?? game.avatarDoAssento(assento));
  const eu = assento === game.humanSeat;

  const stats = game.stats();
  const meu = stats.perSeat[assento];
  const saldo = game.liveScores()[assento];

  // SÓ O QUE A PARTIDA JÁ PRODUZIU. Antes da primeira mão fechada não há estatística: mostrar
  // zeros nesse momento seria dizer "jogou mal" a quem ainda não jogou.
  const linhas: Linha[] = [];
  if (meu.negativeHands > 0) {
    linhas.push({ rotulo: "Negativas ilesas", valor: `${meu.cleanNegatives} de ${meu.negativeHands}` });
  }
  if (meu.bestHand) {
    linhas.push({ rotulo: "Melhor mão", valor: `${fmtSigned(meu.bestHand.score)} na Mão ${meu.bestHand.handNumber}` });
  }
  if (meu.positiveTricks > 0) {
    linhas.push({ rotulo: "Vazas nas positivas", valor: String(meu.positiveTricks) });
  }
  if (stats.kingTaker === assento) {
    linhas.push({ rotulo: "Rei de Copas", valor: "levou os −160" });
  }

  const situacao = doAssento?.bot
    ? "Bot"
    : doAssento && !doAssento.connected
      ? "Desconectado"
      : doAssento?.assisted
        ? "O servidor está jogando por ele"
        : doAssento?.host
          ? "Anfitrião da sala"
          : null;

  const painel = (
    <div className="pf-scrim" onClick={sair}>
      <div
        className="pf"
        role="dialog"
        aria-modal="true"
        aria-label={`Perfil de ${nome}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={fechar} className="pf-x" onClick={sair} aria-label="Fechar o perfil">✕</button>

        <div className="pf-topo">
          <span className={`pf-av s${assento}`} aria-label={avatar.rotulo}>{avatar.glifo}</span>
          <div className="pf-id">
            <b>{nome}{eu && <i className="pf-voce">você</i>}</b>
            {situacao && <span className="pf-situacao">{situacao}</span>}
          </div>
          <span className={`pf-saldo ${saldo > 0 ? "pos" : saldo < 0 ? "neg" : ""}`}>
            {fmtSigned(saldo)}
            <i>nesta partida</i>
          </span>
        </div>

        {linhas.length > 0 ? (
          <ul className="pf-linhas">
            {linhas.map((l) => (
              <li key={l.rotulo}><span>{l.rotulo}</span><b>{l.valor}</b></li>
            ))}
          </ul>
        ) : (
          <p className="pf-vazio">As estatísticas aparecem quando a primeira mão fechar.</p>
        )}

        {/* A seção de progressão só existe quando houver progressão. Ver o cabeçalho. */}
        {progresso && (
          <div className="pf-progresso">
            <div className="pf-nivel">
              <b>Nível {progresso.nivel}</b>
              <span>{progresso.xp} / {progresso.xpDoProximoNivel} XP</span>
            </div>
            <span className="pf-barra" aria-hidden>
              <i style={{ width: `${Math.min(100, (progresso.xp / progresso.xpDoProximoNivel) * 100)}%` }} />
            </span>
            <div className="pf-hist">
              <span>{progresso.partidas} partidas</span>
              <span>{progresso.vitorias} vitórias</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document === "undefined" ? painel : createPortal(painel, document.body);
}
