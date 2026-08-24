import { useState } from "react";
import { AudioButton } from "./AudioPanel.js";
import { FullscreenButton } from "./FullscreenButton.js";
import { sfxTap } from "../audio/sounds.js";
import { AVATARES, avatarLembrado, desenhoDoAvatar, lembrarAvatar, type Avatar } from "./avatares.js";

/**
 * O código da sala tem QUATRO DÍGITOS e é sempre string.
 *
 * Descartamos tudo que não é dígito em vez de traduzir: quem colar "03 15" ou "0-3-1-5" entra,
 * e quem digitar letra simplesmente não vê o caractere aparecer. Em nenhum momento o valor passa
 * por `Number` — `0315` viraria `315` e o jogador receberia "sala não encontrada" digitando
 * exatamente o código que está na tela do amigo.
 */
const SOMENTE_DIGITOS = /\D/g;
const TAMANHO_CODIGO = 4;

export interface OnlineDaHome {
  /** `null` quando o multiplayer está disponível; texto explicativo quando não está. */
  indisponivel: string | null;
  podeVoltar: boolean;
  onCriar: (nick: string, avatar: Avatar) => void;
  onEntrar: (codigo: string, nick: string, avatar: Avatar) => void;
  onVoltar: () => void;
}

export function Home({
  onStart, onOpenAudio, online,
}: {
  onStart: () => void;
  onOpenAudio: () => void;
  /** Ausente = build sem multiplayer. A Home continua a de sempre. */
  online?: OnlineDaHome;
}) {
  const [painel, setPainel] = useState(false);
  const [nick, setNick] = useState("");
  const [codigo, setCodigo] = useState("");
  // A escolha anterior volta pré-selecionada. É conveniência local e nada mais: quem manda no
  // avatar que os outros veem é o servidor, que revalida a etiqueta na entrada.
  const [avatar, setAvatar] = useState<Avatar>(avatarLembrado);

  const nome = nick.trim() || "Jogador";

  return (
    <div className="home">
      <div className="kw">KING</div>
      <div className="tg">Fuja do <b>King</b>. Domine a mesa.</div>
      <div className="row">
        <button className="btn gold" autoFocus onClick={onStart}>▶ Jogar agora</button>
        {online && (
          <button className="btn violet" onClick={() => { sfxTap(); setPainel((v) => !v); }}>
            Jogar com amigos
          </button>
        )}
        <FullscreenButton />
        <AudioButton onOpen={onOpenAudio} />
      </div>

      {online && painel && (
        online.indisponivel ? (
          <div className="hm-online"><p className="hm-aviso" role="status">{online.indisponivel}</p></div>
        ) : (
          <div className="hm-online">
            {online.podeVoltar && (
              <button className="btn gold wide" onClick={() => { sfxTap(); online.onVoltar(); }}>
                ↩ Voltar para a minha sala
              </button>
            )}
            <label className="hm-campo">
              <span>Seu apelido</span>
              <input
                value={nick}
                onChange={(e) => setNick(e.target.value.slice(0, 14))}
                placeholder="Como aparecer na mesa"
                maxLength={14}
              />
            </label>
            <fieldset className="hm-avatares">
              <legend>Seu avatar</legend>
              {AVATARES.map((id) => {
                const d = desenhoDoAvatar(id);
                return (
                  <button
                    key={id}
                    type="button"
                    className={`hm-av${id === avatar ? " escolhido" : ""}`}
                    aria-pressed={id === avatar}
                    aria-label={d.rotulo}
                    title={`${d.rotulo} — ${d.persona}`}
                    onClick={() => { sfxTap(); setAvatar(id); lembrarAvatar(id); }}
                  >
                    {d.glifo}
                  </button>
                );
              })}
            </fieldset>
            <button className="btn violet wide" onClick={() => { sfxTap(); online.onCriar(nome, avatar); }}>
              Criar uma sala
            </button>
            <div className="hm-ou">ou</div>
            <label className="hm-campo">
              <span>Código da sala</span>
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(SOMENTE_DIGITOS, "").slice(0, TAMANHO_CODIGO))}
                placeholder="0000"
                inputMode="numeric"
                autoComplete="one-time-code"
                spellCheck={false}
              />
            </label>
            <button
              className="btn gold wide"
              disabled={codigo.length < TAMANHO_CODIGO}
              onClick={() => { sfxTap(); online.onEntrar(codigo, nome, avatar); }}
            >
              Entrar na sala
            </button>
          </div>
        )
      )}

      <div className="foot">1 jogador + 3 bots · 4 jogadores · 10 mãos · base jogável (motor real)</div>
    </div>
  );
}
