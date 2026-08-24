// APRENDA KING — a tela.
//
// A Mesa é a MESMA do jogo: mesmos naipes, mesmo leque, mesmo HUD, mesmo Placar. O tutorial é uma
// camada por cima — o Rei falando embaixo e um botão de avançar. Quem aprende aqui não precisa
// reaprender nada depois, porque não existe "versão de treino" da tela.
//
// Duas garantias de produto, as duas visíveis no código abaixo:
//   1. NINGUÉM FICA PRESO — jogada fora do alvo didático não repete o passo. O Rei explica o que
//      aconteceu e o botão de avançar aparece do mesmo jeito.
//   2. NINGUÉM É OBRIGADO — "Pular" está sempre na tela, a uma confirmação curta de distância.
import { useCallback, useMemo, useRef, useState } from "react";
import { cardId, type Card, type Trump } from "@king/engine";
import { Mesa } from "../ui/Mesa.js";
import { Rei, type HumorDoRei } from "../ui/Rei.js";
import { sfxTap, sfxCardPlay, sfxTrickGood, sfxPenalty } from "../audio/sounds.js";
import { PartidaDeTreino } from "./partidaDeTreino.js";
import { cenaEm, passoEm, TOTAL_DE_PASSOS, type Passo } from "./roteiro.js";
import { armazenamentoLocal, type ArmazenamentoDoTutorial } from "./persistencia.js";
import { analytics } from "../analytics/analytics.js";

export function Tutorial({
  onSair, onOpenAudio, armazenamento = armazenamentoLocal, passoInicial,
}: {
  /** Chamado ao concluir OU ao pular. A tela de origem decide para onde ir. */
  onSair: (concluido: boolean) => void;
  onOpenAudio: () => void;
  /** Injetável para teste. Em produção é o `localStorage`. */
  armazenamento?: ArmazenamentoDoTutorial;
  /** Retomada. Ausente = de onde o progresso salvo parou. */
  passoInicial?: number;
}) {
  const [indice, setIndice] = useState(() => {
    const salvo = passoInicial ?? armazenamento.ler().passo;
    return Math.min(Math.max(salvo, 0), TOTAL_DE_PASSOS - 1);
  });
  const [resposta, setResposta] = useState<{ texto: string; humor: HumorDoRei } | null>(null);
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  const [, forcarRedesenho] = useState(0);

  const passo: Passo = passoEm(indice);
  const cena = cenaEm(indice);

  // A partida é recriada quando — e só quando — o roteiro troca de cena.
  const cenaMontada = useRef<string>("");
  const partida = useRef<PartidaDeTreino | null>(null);
  if (cenaMontada.current !== cena || partida.current === null) {
    partida.current = new PartidaDeTreino(cena);
    cenaMontada.current = cena;
  }
  const jogo = partida.current;

  // O tutorial começou de verdade: registra uma vez só, na primeira montagem.
  const anunciado = useRef(false);
  if (!anunciado.current) {
    anunciado.current = true;
    armazenamento.gravar({ ...armazenamento.ler(), iniciado: true, passo: indice });
    analytics.track("tutorial_started", { passo: indice });
  }

  const salvar = useCallback((i: number, concluido: boolean) => {
    armazenamento.gravar({ iniciado: true, concluido, passo: concluido ? 0 : i });
  }, [armazenamento]);

  const avancar = useCallback(() => {
    sfxTap();
    setResposta(null);
    const proximo = indice + 1;
    if (proximo >= TOTAL_DE_PASSOS) {
      salvar(0, true);
      analytics.track("tutorial_completed", {});
      onSair(true);
      return;
    }
    setIndice(proximo);
    salvar(proximo, false);
  }, [indice, onSair, salvar]);

  const sair = useCallback(() => {
    // Pular NÃO é concluir. O progresso fica salvo para quem voltar depois.
    salvar(indice, false);
    onSair(false);
  }, [indice, onSair, salvar]);

  /** Compara a jogada com o alvo DIDÁTICO. Errar aqui nunca impede de seguir. */
  const responder = useCallback((acertou: boolean) => {
    const texto = acertou ? passo.acerto : passo.erro;
    if (acertou) sfxTrickGood(); else if (passo.erro) sfxPenalty();
    setResposta(texto ? { texto, humor: acertou ? "acerto" : "erro" } : null);
  }, [passo]);

  const aoJogar = useCallback((carta: Card) => {
    if (passo.acao !== "jogar" || resposta) return;
    const alvo = passo.alvo?.(jogo.estado()) ?? [];
    const acertou = alvo.length === 0 || alvo.some((c) => cardId(c) === cardId(carta));
    sfxCardPlay();
    jogo.jogar(carta);
    forcarRedesenho((n) => n + 1);
    responder(acertou);
  }, [jogo, passo, resposta, responder]);

  const aoEscolherTrunfo = useCallback((trunfo: Trump) => {
    if (passo.acao !== "trunfo" || resposta) return;
    jogo.escolherTrunfo(trunfo);
    forcarRedesenho((n) => n + 1);
    responder(trunfo === passo.trunfoAlvo);
  }, [jogo, passo, resposta, responder]);

  // O botão de avançar aparece quando o passo é de leitura, ou depois que a ação foi feita.
  const podeAvancar = passo.acao === "toque" || resposta !== null;
  const fala = resposta?.texto ?? passo.fala;
  const humor = resposta?.humor ?? "fala";
  const ultimo = indice === TOTAL_DE_PASSOS - 1;

  const nada = useMemo(() => () => {}, []);

  return (
    <div className="tut">
      <Mesa
        game={jogo}
        reviewing={false}
        shake={0}
        castigo={null}
        onPlay={aoJogar}
        onChooseTrump={aoEscolherTrunfo}
        onAdvance={nada}
        onHome={() => setConfirmandoSaida(true)}
        onRestart={nada}
        onOpenAudio={onOpenAudio}
      />

      {/* TODA a cromagem do tutorial vive nesta faixa, alinhada à direita.
          Não é estética: medido em 667×375, a barra no topo-esquerdo caía exatamente sobre o HUD
          do contrato — o mesmo HUD que o passo 3 manda o jogador olhar — e a fala do Rei
          encostava no card do jogador local. Um lugar só, à direita, resolve os dois. */}
      <div className="tut-guia">
        <div className="tut-barra">
          <span className="tut-passo" aria-label={`Passo ${indice + 1} de ${TOTAL_DE_PASSOS}`}>
            {indice + 1}/{TOTAL_DE_PASSOS}
          </span>
          <span className="tut-trilho" aria-hidden>
            <i style={{ width: `${((indice + 1) / TOTAL_DE_PASSOS) * 100}%` }} />
          </span>
          <button className="tut-pular" onClick={() => { sfxTap(); setConfirmandoSaida(true); }}>
            Pular
          </button>
        </div>
        <div className="tut-linha">
          <Rei fala={fala} humor={humor} />
          {podeAvancar && (
            <button className="btn gold tut-ok" autoFocus onClick={avancar}>
              {ultimo ? "Jogar!" : "Continuar"}
            </button>
          )}
        </div>
      </div>

      {confirmandoSaida && (
        <div className="tut-confirma" role="dialog" aria-modal="true" aria-label="Sair do tutorial">
          <p>Sair do tutorial? Você pode voltar depois pela tela inicial.</p>
          <div className="row">
            <button className="btn ghost" onClick={() => { sfxTap(); setConfirmandoSaida(false); }}>
              Continuar aprendendo
            </button>
            <button className="btn violet" onClick={sair}>Sair</button>
          </div>
        </div>
      )}
    </div>
  );
}
