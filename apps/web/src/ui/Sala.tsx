// SALA PRIVADA — a antessala do multiplayer.
//
// A regra oficial do lobby (Fase 5) é: **4 jogadores presentes + 4 prontos → o servidor inicia**.
// O anfitrião NÃO tem autoridade especial, e por isso NÃO existe botão "Iniciar" para ninguém:
// ele só participa da regra, como os outros três.
//
// O estado desenhado aqui é o `Schema` que o Colyseus sincroniza sozinho — assentos, apelidos,
// quem está conectado, quem está pronto. Nenhuma mensagem nova foi inventada para esta tela.
import { useState } from "react";
import { AudioButton } from "./AudioPanel.js";
import { FullscreenButton } from "./FullscreenButton.js";
import { sfxTap } from "../audio/sounds.js";
import type { EstadoDaSalaLido } from "../net/clienteKing.js";
import type { EstadoDaConexao } from "../game/useKingOnline.js";

const LUGARES = [0, 1, 2, 3];

export function Sala({
  sala, conexao, erro, eu, onPronto, onSair, onOpenAudio,
}: {
  sala: EstadoDaSalaLido | null;
  conexao: EstadoDaConexao;
  erro: string | null;
  eu: number | null;
  onPronto: (pronto: boolean) => void;
  onSair: () => void;
  onOpenAudio: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const assentos = sala?.seats ?? [];
  const ocupados = assentos.filter((a) => a.playerId !== "").length;
  const meu = eu === null ? undefined : assentos[eu];
  const pronto = !!meu?.ready;
  const codigo = sala?.roomCode ?? "";

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
          <span className="sl-hint">Quem for jogar usa este código para entrar.</span>
        </div>
      ) : (
        <div className="sl-codigo"><span className="sl-lb">{rotuloDaConexao(conexao)}</span></div>
      )}

      <div className="sl-lugares">
        {LUGARES.map((i) => {
          const a = assentos[i];
          const vazio = !a || a.playerId === "";
          return (
            <div key={i} className={`sl-lugar s${i}${vazio ? " vago" : ""}${a?.ready ? " pronto" : ""}${a && !vazio && !a.connected ? " ausente" : ""}${i === eu ? " voce" : ""}`}>
              <span className="sl-av">{vazio ? "+" : a.nick[0]}</span>
              <span className="sl-nome">{vazio ? "Aguardando…" : a.nick}{i === eu && <i> (você)</i>}</span>
              <span className="sl-estado">
                {vazio ? "vago" : !a.connected ? "desconectado" : a.ready ? "pronto ✓" : "escolhendo"}
              </span>
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

      <div className="foot">
        {ocupados < 4
          ? `${ocupados} de 4 jogadores na sala · a partida começa quando os quatro estiverem prontos`
          : "Quatro na mesa · a partida começa quando os quatro estiverem prontos"}
      </div>
    </div>
  );
}

function rotuloDaConexao(c: EstadoDaConexao): string {
  if (c === "conectando") return "Conectando…";
  if (c === "reconectando") return "Reconectando…";
  if (c === "encerrada") return "Sala encerrada";
  if (c === "erro") return "Sem conexão";
  return "Sala";
}
