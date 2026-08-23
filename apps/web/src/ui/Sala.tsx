// SALA PRIVADA — a antessala do multiplayer.
//
// A mesa tem sempre QUATRO assentos, mas não exige quatro pessoas. As composições oficiais são
// 4 humanos, 3 humanos + 1 bot e 2 humanos + 2 bots. Um humano só não inicia: sala privada com
// uma pessoa é o modo local com passos a mais, e esse já existe sem servidor nenhum.
//
// A regra de início (Fase 5, atualizada): **4 assentos ocupados + pelo menos 2 humanos + todos
// os humanos prontos**. O anfitrião NÃO inicia a partida — ele só monta a composição. Por isso
// não existe botão "Iniciar" para ninguém.
//
// Os botões de bot aparecem só para o anfitrião, mas isso é APRESENTAÇÃO: quem autoriza é o
// servidor, que recusa a mensagem de qualquer outro. Ver `#autorizarGestaoDeBot` na KingRoom.
//
// O estado desenhado aqui é o `Schema` que o Colyseus sincroniza sozinho — assentos, apelidos,
// quem está conectado, quem é bot, quem é anfitrião, quem está pronto.
import { useState } from "react";
import type { Seat } from "@king/engine";
import { AudioButton } from "./AudioPanel.js";
import { FullscreenButton } from "./FullscreenButton.js";
import { sfxTap } from "../audio/sounds.js";
import type { EstadoDaSalaLido } from "../net/clienteKing.js";
import type { EstadoDaConexao } from "../game/useKingOnline.js";

const LUGARES: Seat[] = [0, 1, 2, 3];

/** Piso oficial de humanos numa mesa multiplayer privada. Espelha `MIN_HUMANOS` do servidor. */
const MIN_HUMANOS = 2;

export function Sala({
  sala, conexao, erro, eu, souAnfitriao, onPronto, onAdicionarBot, onRemoverBot, onSair, onOpenAudio,
}: {
  sala: EstadoDaSalaLido | null;
  conexao: EstadoDaConexao;
  erro: string | null;
  eu: Seat | null;
  souAnfitriao: boolean;
  onPronto: (pronto: boolean) => void;
  onAdicionarBot: (seat: Seat) => void;
  onRemoverBot: (seat: Seat) => void;
  onSair: () => void;
  onOpenAudio: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const assentos = sala?.seats ?? [];
  const ocupados = assentos.filter((a) => a.playerId !== "").length;
  const humanos = assentos.filter((a) => a.playerId !== "" && !a.bot).length;
  const meu = eu === null ? undefined : assentos[eu];
  const pronto = !!meu?.ready;
  const codigo = sala?.roomCode ?? "";
  const podeMexer = souAnfitriao && conexao === "conectado";

  const copiar = () => {
    sfxTap();
    void navigator.clipboard?.writeText(codigo).then(
      () => { setCopiado(true); window.setTimeout(() => setCopiado(false), 1800); },
      () => { /* sem área de transferência: o código está na tela, dá para ditar */ },
    );
  };

  return (
    <div className="home sala">
      <div className="kw">KING</div>

      {codigo ? (
        <div className="sl-codigo">
          <span className="sl-lb">Código da sala</span>
          <button className="sl-cod" onClick={copiar} title="Copiar o código">
            {codigo}
            <i>{copiado ? "copiado ✓" : "copiar"}</i>
          </button>
          <span className="sl-hint">Quem for jogar digita estes 4 números para entrar.</span>
        </div>
      ) : (
        <div className="sl-codigo"><span className="sl-lb">{rotuloDaConexao(conexao)}</span></div>
      )}

      <div className="sl-lugares">
        {LUGARES.map((i) => {
          const a = assentos[i];
          const vazio = !a || a.playerId === "";
          const bot = !!a?.bot;
          return (
            <div
              key={i}
              className={`sl-lugar s${i}${vazio ? " vago" : ""}${bot ? " robo" : ""}${a?.ready && !bot ? " pronto" : ""}${a && !vazio && !bot && !a.connected ? " ausente" : ""}${i === eu ? " voce" : ""}`}
            >
              <span className="sl-av">{vazio ? "+" : bot ? "🤖" : a.nick[0]}</span>
              <span className="sl-nome">
                {vazio ? "Aguardando…" : a.nick}
                {i === eu && <i> (você)</i>}
                {a?.host && !bot && <i> · anfitrião</i>}
              </span>

              {/* Composição: só o anfitrião, e só antes de a partida começar. */}
              {vazio && podeMexer && (
                <button className="sl-bot add" onClick={() => onAdicionarBot(i)}>+ Bot</button>
              )}
              {bot && podeMexer && (
                <button className="sl-bot rem" onClick={() => onRemoverBot(i)}>Remover</button>
              )}
              {!vazio && !(bot && podeMexer) && (
                <span className="sl-estado">
                  {bot ? "pronto ✓" : !a.connected ? "desconectado" : a.ready ? "pronto ✓" : "escolhendo"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {erro && <div className="sl-erro" role="alert">{erro}</div>}

      <div className="row">
        <button
          className={`btn ${pronto ? "violet" : "gold"}`}
          disabled={!meu || conexao === "erro" || conexao === "encerrada"}
          onClick={() => onPronto(!pronto)}
        >
          {pronto ? "✓ Pronto — cancelar" : "Estou pronto"}
        </button>
        <button className="btn ghost" onClick={onSair}>Sair</button>
        <FullscreenButton />
        <AudioButton onOpen={onOpenAudio} />
      </div>

      <div className="foot">{rodape(ocupados, humanos, souAnfitriao)}</div>
    </div>
  );
}

/**
 * Diz em uma linha o que falta para começar. É o que evita o jogador olhar uma tela parada sem
 * entender por quê — a diferença entre "travou" e "falta o Vitor marcar pronto".
 */
function rodape(ocupados: number, humanos: number, anfitriao: boolean): string {
  if (ocupados < 4) {
    const faltam = 4 - ocupados;
    const dica = anfitriao ? " — ou complete com bots" : "";
    return `${ocupados} de 4 lugares ocupados · faltam ${faltam}${dica}`;
  }
  if (humanos < MIN_HUMANOS) {
    return `A mesa precisa de pelo menos ${MIN_HUMANOS} pessoas — troque um bot por alguém para começar`;
  }
  return "Quatro na mesa · a partida começa quando todos os humanos estiverem prontos";
}

function rotuloDaConexao(c: EstadoDaConexao): string {
  if (c === "conectando") return "Conectando…";
  if (c === "reconectando") return "Reconectando…";
  if (c === "encerrada") return "Sala encerrada";
  if (c === "erro") return "Sem conexão";
  return "Sala";
}
