// O MODO MINITORNEIO — liga o orquestrador puro, o executor das mesas de bots e a Mesa solo.
//
//   orquestrador (puro)  ←  fatos  ←  partidas reais (bots: executor · humano: Mesa solo)
//          ↓
//   persistência (checkpoint a cada resultado CONFIRMADO)
//
// O fluxo é uma máquina de telas simples. Quem decide o próximo passo é `situacao()` do
// orquestrador — esta camada só escolhe a tela que mostra esse passo.
//
// A PARTIDA DO HUMANO é a mesma mesa solo de sempre (`useKingGame` + `Mesa`), com a semente e os
// adversários da chave. O resultado volta ao orquestrador UMA vez: o registro é idempotente e é
// gravado no mesmo instante. A tela final do jogo solo (Placar Final) não aparece aqui: ela
// oferece "Jogar novamente", que no torneio seria refazer uma partida já decidida — a classificação
// da mesa toma o lugar dela.
import { useCallback, useEffect, useRef, useState } from "react";
import { useKingGame } from "../game/useKingGame.js";
import { Mesa } from "../ui/Mesa.js";
import { useBotaoVoltar } from "../ui/useBotaoVoltar.js";
import type { Avatar } from "../ui/avatares.js";
import { FORMATOS, type FormatoId } from "./formatos.js";
import {
  avancarFase, campeao, criarTorneio, faseAtual, faseDaEliminacao, mesaPorId, registrarResultado, situacao,
  ID_DO_HUMANO, type Torneio,
} from "./orquestrador.js";
import { simularPendentes } from "./executor.js";
import { apagarTorneio, gravarTorneio, lerTorneio } from "./persistencia.js";
import { PartidaDoTorneio } from "./partidaDoTorneio.js";
import { qaDaUrl, sementeNova } from "./qa.js";
import { Celebracao } from "./Celebracao.js";
import { nomeDaMesa } from "./Chave.js";
import {
  TelaApresentacao, TelaAvanco, TelaChave, TelaClassificacao, TelaConfronto, TelaEliminado, TelaEscolha, TelaFim,
  TelaPreparando,
} from "./telas.js";
import "./torneio.css";

type Tela =
  | { t: "escolha" }
  | { t: "apresentacao" }
  | { t: "chave" }
  | { t: "preparando" }
  | { t: "confronto" }
  | { t: "partida"; mesaId: string }
  | { t: "classificacao"; mesaId: string }
  | { t: "avanco"; fase: number }
  | { t: "eliminado" }
  | { t: "celebracao" }
  | { t: "fim" };

export const AVISO_DE_SAVE_DESCARTADO = "O torneio salvo estava danificado e foi descartado. Comece um novo.";

/** A tela que mostra o passo atual do torneio. Usada ao retomar e depois de cada etapa. */
function telaDoMomento(t: Torneio): Tela {
  const s = situacao(t);
  if (s.tipo === "encerrado") return { t: "fim" };
  if (faseDaEliminacao(t) !== null) return { t: "eliminado" };
  if (s.tipo === "simular") return { t: "preparando" };
  if (s.tipo === "jogar") return { t: "confronto" };
  return { t: "avanco", fase: s.proximaFase };
}

export default function ModoTorneio({
  continuar, avatar, onSair, onOpenAudio,
}: {
  /** `true` = "Continuar torneio" da Home; `false` = começar um novo (escolha do formato). */
  continuar: boolean;
  /** O bicho escolhido na Home para um torneio NOVO. Ao continuar, vale o do save. */
  avatar?: Avatar;
  onSair: () => void;
  onOpenAudio: () => void;
}) {
  const g = useKingGame();
  // A RETOMADA É LIDA NA MONTAGEM, antes do primeiro quadro: quem toca "Continuar torneio" nunca
  // vê a escolha de formato piscar antes da chave.
  const [inicio] = useState(() => (continuar ? lerTorneio() : null));
  const restaurado = inicio?.tipo === "ok" ? inicio.restaurado : null;
  const [torneio, setTorneio] = useState<Torneio | null>(() => restaurado?.torneio ?? null);
  const [tela, setTela] = useState<Tela>(() => (restaurado ? telaDoMomento(restaurado.torneio) : { t: "escolha" }));
  const [aviso, setAviso] = useState<string | null>(() => {
    if (inicio?.tipo === "corrompido") return AVISO_DE_SAVE_DESCARTADO;
    const id = restaurado?.partidaReiniciada;
    if (!restaurado || !id) return null;
    const m = mesaPorId(restaurado.torneio, id)!;
    return `A sua partida (${nomeDaMesa(restaurado.torneio, m)}) foi interrompida e recomeça do início, com o mesmo baralho.`;
  });
  const [progresso, setProgresso] = useState({ feitas: 0, total: 0 });

  // Ref espelho: os callbacks assíncronos do executor precisam do torneio de AGORA.
  const atual = useRef<Torneio | null>(restaurado?.torneio ?? null);
  const confirmar = useCallback((t: Torneio, emPartida: string | null = null) => {
    atual.current = t;
    setTorneio(t);
    gravarTorneio(t, emPartida);
  }, []);

  // O que a leitura pede para o armazenamento: save danificado sai; save íntegro é regravado sem o
  // "em partida" — já lido, ele virou o aviso acima, e a partida recomeça do zero.
  useEffect(() => {
    if (inicio?.tipo === "corrompido") apagarTorneio();
    else if (restaurado) gravarTorneio(restaurado.torneio, null);
  }, [inicio, restaurado]);

  const novo = useCallback((formato: FormatoId) => {
    const qa = qaDaUrl();
    const t = criarTorneio(formato, qa.semente ?? sementeNova(), avatar ?? "leao", {
      qa: qa.semente !== null || qa.maoInicial !== null,
      maoInicial: qa.maoInicial ?? 1,
    });
    setAviso(null);
    confirmar(t);
    setTela({ t: "apresentacao" });
  }, [avatar, confirmar]);

  const recomecar = useCallback(() => {
    apagarTorneio();
    atual.current = null;
    setTorneio(null);
    setAviso(null);
    setTela({ t: "escolha" });
  }, []);

  // ── as mesas de bots: em fatias, gravando cada mesa confirmada ──
  useEffect(() => {
    if (tela.t !== "preparando" || !atual.current) return;
    let cancelado = false;
    void (async () => {
      let t = atual.current!;
      for (;;) {
        const s = situacao(t);
        if (s.tipo === "simular") {
          const r = await simularPendentes(t, {
            aoProgresso: (feitas, total) => { if (!cancelado) setProgresso({ feitas, total }); },
            aoResultado: (x) => { if (!cancelado) confirmar(x); },
            cancelado: () => cancelado,
          });
          if (!r) return;
          t = r;
          continue;
        }
        // Eliminado e pedindo para ver o resto: as fases seguintes são todas de bots.
        if (s.tipo === "avancar" && faseDaEliminacao(t) !== null) {
          t = avancarFase(t);
          confirmar(t);
          continue;
        }
        break;
      }
      if (cancelado) return;
      const c = campeao(t);
      setTela(c === null ? telaDoMomento(t) : c === ID_DO_HUMANO ? { t: "celebracao" } : { t: "fim" });
    })();
    return () => { cancelado = true; };
  }, [tela, confirmar]);

  // ── a partida do humano ──
  const jogar = useCallback(() => {
    const t = atual.current;
    const s = t && situacao(t);
    if (!t || !s || s.tipo !== "jogar") return;
    const mesa = s.mesa;
    // O checkpoint diz "em partida" — se a página cair, a retomada sabe que esta mesa recomeça.
    gravarTorneio(t, mesa.id);
    g.start(undefined, () => new PartidaDoTorneio(t, mesa));
    setTela({ t: "partida", mesaId: mesa.id });
  }, [g]);

  const sairDaPartida = useCallback(() => {
    g.goHome();
    const t = atual.current;
    if (t) gravarTorneio(t, null);
    setAviso("Você saiu da partida. Ela recomeça do início, com o mesmo baralho, quando você voltar.");
    setTela({ t: "confronto" });
  }, [g]);

  useBotaoVoltar(tela.t === "partida", sairDaPartida);

  // O fim da partida: assim que a leitura da última vaza termina, os fatos vão para o
  // orquestrador — UMA vez (o registro é idempotente, e a mesa sai do estado "em partida").
  const jogo = g.game;
  const fimDaPartida = tela.t === "partida" && jogo instanceof PartidaDoTorneio
    && jogo.mesaId === tela.mesaId && jogo.phase() === "matchEnd" && !g.reviewing;
  useEffect(() => {
    if (!fimDaPartida || !(jogo instanceof PartidaDoTorneio)) return;
    const t = atual.current;
    const fatos = jogo.fatos();
    if (!t || !fatos) return;
    confirmar(registrarResultado(t, jogo.mesaId, fatos));
    setAviso(null);
    g.goHome();
    setTela({ t: "classificacao", mesaId: jogo.mesaId });
  }, [fimDaPartida, jogo, confirmar, g]);

  const depoisDaClassificacao = useCallback(() => {
    const t = atual.current;
    if (!t) return;
    const c = campeao(t);
    if (c !== null) { setTela(c === ID_DO_HUMANO ? { t: "celebracao" } : { t: "fim" }); return; }
    if (faseDaEliminacao(t) !== null) { setTela({ t: "eliminado" }); return; }
    const s = situacao(t);
    if (s.tipo === "avancar") {
      const t2 = avancarFase(t);
      confirmar(t2);
      setTela({ t: "avanco", fase: faseAtual(t2) });
      return;
    }
    setTela(telaDoMomento(t));
  }, [confirmar]);

  // O torneio acabou: o save sai (não há o que continuar). A tela final fica com o estado em memória.
  useEffect(() => {
    if (torneio && campeao(torneio) !== null) apagarTorneio();
  }, [torneio]);

  const sair = useCallback(() => { g.goHome(); onSair(); }, [g, onSair]);

  // ─────────────────────────── render ───────────────────────────
  if (tela.t === "partida") {
    if (!jogo || fimDaPartida) return <div className="tn" aria-busy="true" />;
    return (
      <Mesa
        game={jogo}
        reviewing={g.reviewing}
        shake={g.shake}
        castigo={g.castigo}
        onPlay={g.playCard}
        onChooseTrump={g.chooseTrump}
        onAdvance={g.advanceHand}
        onHome={sairDaPartida}
        // "Recomeçar" no placar entre mãos: a MESMA mesa, a mesma semente, do início.
        onRestart={jogar}
        onOpenAudio={onOpenAudio}
        suspender={g.suspender}
      />
    );
  }

  if (tela.t === "escolha" || !torneio) {
    return <TelaEscolha onEscolher={novo} onSair={sair} aviso={aviso} />;
  }

  const t = torneio;
  const irParaChave = () => setTela({ t: "chave" });

  switch (tela.t) {
    case "apresentacao":
      return <TelaApresentacao torneio={t} onComecar={irParaChave} onSair={sair} />;
    case "chave": {
      const s = situacao(t);
      const eliminado = faseDaEliminacao(t) !== null;
      const acao = s.tipo === "encerrado"
        ? { rotulo: "Ver o resultado", onClick: () => setTela({ t: "fim" }) }
        : eliminado
          ? { rotulo: "Voltar", onClick: () => setTela({ t: "eliminado" }) }
          : s.tipo === "jogar"
            ? { rotulo: "Ir para o meu confronto", onClick: () => setTela({ t: "confronto" }) }
            : s.tipo === "simular"
              ? { rotulo: "Jogar as outras mesas", onClick: () => setTela({ t: "preparando" }) }
              : { rotulo: "Continuar", onClick: depoisDaClassificacao };
      return <TelaChave torneio={t} aviso={aviso} acao={acao} onSair={sair} />;
    }
    case "preparando":
      return <TelaPreparando torneio={t} feitas={progresso.feitas} total={progresso.total} onSair={sair} />;
    case "confronto": {
      const s = situacao(t);
      if (s.tipo !== "jogar") return <TelaChave torneio={t} acao={null} onSair={sair} />;
      return <TelaConfronto torneio={t} mesa={s.mesa} aviso={aviso} onJogar={jogar} onChave={irParaChave} onSair={sair} />;
    }
    case "classificacao": {
      const m = mesaPorId(t, tela.mesaId);
      if (!m?.resultado) return <TelaChave torneio={t} acao={null} onSair={sair} />;
      return <TelaClassificacao torneio={t} mesa={m} onContinuar={depoisDaClassificacao} onSair={sair} />;
    }
    case "avanco":
      return <TelaAvanco torneio={t} fase={tela.fase} onContinuar={() => setTela(telaDoMomento(atual.current ?? t))} onSair={sair} />;
    case "eliminado":
      return (
        <TelaEliminado
          torneio={t}
          onVerResto={campeao(t) === null ? () => setTela({ t: "preparando" }) : null}
          onNovo={recomecar}
          onSair={sair}
        />
      );
    case "celebracao": {
      const c = campeao(t) ?? ID_DO_HUMANO;
      const p = t.participantes[c];
      return (
        <>
          <TelaFim torneio={t} campeaoId={c} onNovo={recomecar} onChave={irParaChave} onSair={sair} />
          <Celebracao titulo={FORMATOS[t.formato].tituloDoCampeao} nome={p.nome} avatar={p.avatar} onFim={() => setTela({ t: "fim" })} />
        </>
      );
    }
    case "fim": {
      const c = campeao(t);
      if (c === null) return <TelaChave torneio={t} acao={null} onSair={sair} />;
      return <TelaFim torneio={t} campeaoId={c} onNovo={recomecar} onChave={irParaChave} onSair={sair} />;
    }
  }
  return null;
}
