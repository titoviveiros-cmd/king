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
import type { PreparoDaHome } from "./ui/Home.js";
import { leitorDeProgressoConfigurado } from "./auth/progresso.js";

export default function ModoOnline({
  entrada, onOpenAudio, onSair,
}: {
  entrada: Entrada;
  onOpenAudio: () => void;
  /** Sair do online. Com `retorno`, a Home abre o painel pronto (entrada que falhou). */
  onSair: (retorno?: PreparoDaHome) => void;
}) {
  const g = useKingOnline();
  const disparado = useRef(false);

  const { criarSala, entrarNaSala, voltarParaSala } = g;
  useEffect(() => {
    // A entrada é disparada UMA vez: em React 18 estrito o efeito roda duas vezes, e abrir duas
    // salas por um clique deixaria a primeira órfã até o TTL do servidor.
    if (disparado.current) return;
    disparado.current = true;
    if (entrada.tipo === "criar") criarSala(entrada.nick, entrada.avatar);
    else if (entrada.tipo === "entrar") entrarNaSala(entrada.codigo, entrada.nick, entrada.avatar);
    else voltarParaSala();
  }, [entrada, criarSala, entrarNaSala, voltarParaSala]);

  const { sairDaSala } = g;
  const sair = useCallback(() => { sairDaSala(); onSair(); }, [sairDaSala, onSair]);

  // A ENTRADA QUE FALHOU VOLTA PARA O PAINEL. Sala cheia, encerrada ou inexistente: em vez de um
  // lobby vazio dizendo "Sem conexão", a pessoa volta para a Home com o painel aberto, o apelido e o
  // código mantidos e o motivo escrito — corrige o código ou tenta de novo, sem redigitar nada.
  // Só a ENTRADA (nunca chegou a ter sala): queda no meio do lobby continua tratada lá.
  // NÃO passa por `sairDaSala`: ele esquece a recuperação, que vale para TODAS as abas — o
  // anfitrião que toca o próprio link no mesmo celular (4004) perderia o "Voltar para a minha
  // sala" da partida de verdade. Entrada que falhou não abriu sessão: não há o que fechar.
  const falhou = entrada.tipo === "entrar" && !g.sala && g.conexao === "erro" && !!g.erro;
  useEffect(() => {
    if (!falhou || entrada.tipo !== "entrar") return;
    onSair({ codigo: entrada.codigo, nick: entrada.nick, aviso: g.erro ?? undefined });
  }, [falhou, entrada, g.erro, onSair]);
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
        onEscolherMesa={g.definirTemaDaMesa}
        onEscolherAvatar={g.definirAvatar}
        recusa={g.recusa}
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
    mensagens: g.mensagens,
    onEnviarMensagem: g.enviarMensagem,
    onCancelarProximaMao: g.cancelarProximaMao,
    // O id que o SERVIDOR deu a esta partida, e o leitor só-leitura: é o que o Placar Final usa
    // para perguntar ao banco quanto ela rendeu. O leitor é o mesmo objeto a cada render.
    matchId: g.game.matchId,
    progresso: leitorDeProgressoConfigurado(),
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
      suspender={g.suspender}
      mp={mp}
    />
  );
}
