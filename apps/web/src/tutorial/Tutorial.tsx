// APRENDA KING — a tela.
//
// A Mesa é a MESMA do jogo: mesmos naipes, mesmo leque, mesmo HUD, mesmo Placar. O tutorial é uma
// camada por cima — o Rei falando embaixo e a navegação. Quem aprende aqui não precisa reaprender
// nada depois, porque não existe "versão de treino" da tela.
//
// TRÊS GARANTIAS DE PRODUTO, as três visíveis no código abaixo:
//
//   1. NINGUÉM FICA PRESO — jogada fora do alvo didático não repete o passo. O Rei explica o que
//      aconteceu e a navegação segue.
//   2. NINGUÉM É OBRIGADO — "Pular" está sempre na tela, a uma confirmação curta de distância.
//   3. NADA PARECE TRAVADO — e esta é a mais recente. Num teste em iPhone real a pessoa achou que
//      o tutorial tinha congelado, quando ele só estava esperando uma carta. Passo de AÇÃO agora
//      se anuncia: "SUA VEZ", com o que fazer, e o botão de avançar não fica lá parado fingindo
//      que é a saída.
import { useCallback, useMemo, useRef, useState } from "react";
import { cardId, type Card, type Trump } from "@king/engine";
import { Mesa } from "../ui/Mesa.js";
import { Rei, type HumorDoRei } from "../ui/Rei.js";
import { sfxTap, sfxCardPlay, sfxTrickGood, sfxPenalty } from "../audio/sounds.js";
import { PartidaDeTreino } from "./partidaDeTreino.js";
import { cenaEm, passoEm, TOTAL_DE_PASSOS, type Passo } from "./roteiro.js";
import { armazenamentoLocal, type ArmazenamentoDoTutorial } from "./persistencia.js";
import { analytics } from "../analytics/analytics.js";

/** O que o passo pede agora, em uma linha. Curto porque divide a tela com a fala do Rei. */
const PEDIDO: Record<Exclude<Passo["acao"], "toque">, string> = {
  jogar: "Toque numa carta acesa",
  trunfo: "Escolha um naipe",
};

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

  /**
   * Passos de AÇÃO já cumpridos.
   *
   * É o que permite VOLTAR sem mentir. Uma jogada é irreversível no motor — desfazê-la
   * artificialmente duplicaria carta, repetiria penalidade e faria a cena divergir do Game
   * Engine. Então voltar não desfaz nada: leva de volta à EXPLICAÇÃO, com a cena como está. E
   * quando o passo revisitado é uma ação que já foi feita, ele deixa de pedir a ação e volta a
   * ser leitura — porque pedir de novo o que já aconteceu seria justamente o pedido impossível.
   */
  const cumpridos = useRef<Set<number>>(new Set());

  const passo: Passo = passoEm(indice);
  const cena = cenaEm(indice);

  // A partida é recriada quando — e só quando — o roteiro troca de cena. Voltar para uma cena
  // anterior a remonta do zero: é uma cena determinística, não uma partida a preservar.
  const cenaMontada = useRef<string>("");
  const partida = useRef<PartidaDeTreino | null>(null);
  if (cenaMontada.current !== cena || partida.current === null) {
    partida.current = new PartidaDeTreino(cena);
    cenaMontada.current = cena;
    // Cena remontada: o que foi cumprido dentro dela deixou de valer.
    for (const i of [...cumpridos.current]) if (cenaEm(i) === cena) cumpridos.current.delete(i);
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

  const voltar = useCallback(() => {
    if (indice === 0) return;
    sfxTap();
    setResposta(null);
    const anterior = indice - 1;
    setIndice(anterior);
    salvar(anterior, false);
  }, [indice, salvar]);

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

  // Um passo de ação só pede a ação UMA vez. Depois de cumprido, revisitá-lo é leitura.
  const jaCumprido = cumpridos.current.has(indice);
  const esperandoAcao = passo.acao !== "toque" && !jaCumprido && resposta === null;

  const aoJogar = useCallback((carta: Card) => {
    if (passo.acao !== "jogar" || !esperandoAcao) return;
    const alvo = passo.alvo?.(jogo.estado()) ?? [];
    const acertou = alvo.length === 0 || alvo.some((c) => cardId(c) === cardId(carta));
    sfxCardPlay();
    jogo.jogar(carta);
    cumpridos.current.add(indice);
    forcarRedesenho((n) => n + 1);
    responder(acertou);
  }, [esperandoAcao, indice, jogo, passo, responder]);

  const aoEscolherTrunfo = useCallback((trunfo: Trump) => {
    if (passo.acao !== "trunfo" || !esperandoAcao) return;
    jogo.escolherTrunfo(trunfo);
    cumpridos.current.add(indice);
    forcarRedesenho((n) => n + 1);
    responder(trunfo === passo.trunfoAlvo);
  }, [esperandoAcao, indice, jogo, passo, responder]);

  const fala = resposta?.texto ?? passo.fala;
  const humor = resposta?.humor ?? "fala";
  const ultimo = indice === TOTAL_DE_PASSOS - 1;

  const nada = useMemo(() => () => {}, []);

  return (
    <div className={`tut${esperandoAcao ? " agindo" : ""}`}>
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

          <div className="tut-nav">
            <button
              className="btn ghost tut-voltar"
              onClick={voltar}
              disabled={indice === 0}
              aria-label="Voltar para a instrução anterior"
            >
              Voltar
            </button>

            {/* ESTADO DE AÇÃO × ESTADO DE LEITURA.
                Quando falta uma ação, "Avançar" NÃO some — sumir deixaria a tela sem nenhuma
                pista do que fazer, que é exatamente a queixa. Ele fica desabilitado e cede o
                lugar visual para o pedido, que diz o que a pessoa precisa tocar. */}
            {esperandoAcao ? (
              <span className="tut-acao" role="status" aria-live="assertive">
                <b>SUA VEZ</b>
                <i>{PEDIDO[passo.acao as Exclude<Passo["acao"], "toque">]}</i>
              </span>
            ) : (
              <button className="btn gold tut-ok" autoFocus onClick={avancar}>
                {ultimo ? "Jogar!" : "Avançar"}
              </button>
            )}
          </div>
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
