// MODO MULTIPLAYER — carregado SOB DEMANDA.
//
// Este arquivo é o único caminho de execução que chega ao `@colyseus/sdk`, e por isso vive
// separado: o `App` o importa com `lazy()`, e quem só quer jogar contra os bots não baixa uma
// linha do cliente de rede. Sem essa separação o bundle inicial cresceria ~127 kB (~41 kB gzip)
// para todo mundo — inclusive para quem nunca vai abrir uma sala.
import { useCallback, useEffect, useRef } from "react";
import { useKingOnline } from "./game/useKingOnline.js";
import { Mesa, type MesaMultiplayer } from "./ui/Mesa.js";
import { Sala } from "./ui/Sala.js";
import { useBotaoVoltar } from "./ui/useBotaoVoltar.js";
import type { Entrada } from "./modos.js";

export default function ModoOnline({
  entrada, onOpenAudio, onSair,
}: {
  entrada: Entrada;
  onOpenAudio: () => void;
  onSair: () => void;
}) {
  const g = useKingOnline();
  const disparado = useRef(false);

  const { criarSala, entrarNaSala, voltarParaSala } = g;
  useEffect(() => {
    // A entrada é disparada UMA vez: em React 18 estrito o efeito roda duas vezes, e abrir duas
    // salas por um clique deixaria a primeira órfã até o TTL do servidor.
    if (disparado.current) return;
    disparado.current = true;
    if (entrada.tipo === "criar") criarSala(entrada.nick);
    else if (entrada.tipo === "entrar") entrarNaSala(entrada.codigo, entrada.nick);
    else voltarParaSala();
  }, [entrada, criarSala, entrarNaSala, voltarParaSala]);

  const { sairDaSala } = g;
  const sair = useCallback(() => { sairDaSala(); onSair(); }, [sairDaSala, onSair]);
  useBotaoVoltar(g.screen === "mesa", sair);

  if (g.screen !== "mesa" || !g.game) {
    return (
      <Sala
        sala={g.sala}
        conexao={g.conexao}
        erro={g.erro}
        eu={g.humanSeat}
        souAnfitriao={g.souAnfitriao}
        onPronto={g.definirPronto}
        onAdicionarBot={g.adicionarBot}
        onRemoverBot={g.removerBot}
        onSair={sair}
        onOpenAudio={onOpenAudio}
      />
    );
  }

  const mp: MesaMultiplayer = {
    eu: g.game.humanSeat,
    sala: g.sala,
    conexao: g.conexao,
    relogio: g.relogio,
    prontos: g.prontos,
    recusa: g.recusa,
    emVoo: g.game.cartaEmVoo(),
    aguardando: g.game.aguardandoServidor(),
    pediProximaMao: g.game.pediProximaMao(),
  };

  return (
    <Mesa
      game={g.game}
      reviewing={g.reviewing}
      shake={g.shake}
      castigo={g.castigo}
      onPlay={g.playCard}
      onChooseTrump={g.chooseTrump}
      onAdvance={g.advanceHand}
      onHome={sair}
      // No multiplayer não existe "nova partida" local: a saída é sempre sair da sala.
      onRestart={sair}
      onOpenAudio={onOpenAudio}
      mp={mp}
    />
  );
}
