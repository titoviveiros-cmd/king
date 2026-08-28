import { useState } from "react";
import { AudioButton } from "./AudioPanel.js";
import { FullscreenButton } from "./FullscreenButton.js";
import { sfxTap } from "../audio/sounds.js";
import { AVATARES, desenhoDoAvatar, type Avatar } from "./avatares.js";

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

export interface TutorialDaHome {
  /** Abre APRENDA KING. Sempre disponível — quem já concluiu pode rever quando quiser. */
  onAbrir: () => void;
  /** Já concluiu alguma vez? Muda o rótulo: "Aprenda" convida, "Rever" não insiste. */
  concluido: boolean;
}

export interface OnlineDaHome {
  /** `null` quando o multiplayer está disponível; texto explicativo quando não está. */
  indisponivel: string | null;
  podeVoltar: boolean;
  onCriar: (nick: string, avatar: Avatar) => void;
  onEntrar: (codigo: string, nick: string, avatar: Avatar) => void;
  onVoltar: () => void;
}

export function Home({
  onStart, onOpenAudio, online, tutorial,
}: {
  onStart: (avatar: Avatar) => void;
  onOpenAudio: () => void;
  /** Ausente = build sem multiplayer. A Home continua a de sempre. */
  online?: OnlineDaHome;
  tutorial?: TutorialDaHome;
}) {
  const [painel, setPainel] = useState(false);
  const [nick, setNick] = useState("");
  const [codigo, setCodigo] = useState("");
  /**
   * NENHUM AVATAR VEM ESCOLHIDO, e a escolha é pedida quando faz falta.
   *
   * Antes, a Home abria com o último avatar já marcado (lido do `localStorage`) e o fluxo seguia
   * com ele. Parecia conveniência; na prática o jogo escolhia por quem chegava, e criar uma sala
   * levava essa decisão silenciosa junto.
   *
   * Agora: `null` até haver um toque. Quem pede uma ação que precisa de identidade — jogar solo,
   * criar sala, entrar numa sala — abre o seletor primeiro, e a ação continua sozinha assim que a
   * escolha acontece. A Home não vira ficha de cadastro para quem só quer jogar rápido: o seletor
   * só aparece quando é necessário, e uma vez por passagem pela Home.
   *
   * A escolha morre ao voltar para cá — este estado é da montagem atual do componente. Dentro da
   * partida ou da sala ela vale normalmente, e "Jogar novamente" a conserva porque não passa por
   * aqui: é continuação da mesma experiência.
   */
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  /** A ação que espera a escolha. `null` = seletor fechado. */
  const [pedindoAvatar, setPedindoAvatar] = useState<((a: Avatar) => void) | null>(null);

  /**
   * Executa `acao` — pedindo o avatar antes, se ainda não houver um.
   *
   * O seletor não é um passo separado que a pessoa precisa lembrar de cumprir: ele é a primeira
   * metade da ação que ela já pediu, e a segunda metade acontece sozinha na sequência.
   */
  const comAvatar = (acao: (a: Avatar) => void) => {
    if (avatar) { acao(avatar); return; }
    setPedindoAvatar(() => acao);
  };

  const nome = nick.trim() || "Jogador";

  return (
    <div className="home">
      <div className="kw">KING</div>
      <div className="tg">Fuja do <b>King</b>. Domine a mesa.</div>
      <div className="row">
        <button className="btn gold" autoFocus onClick={() => { sfxTap(); comAvatar(onStart); }}>
          ▶ Jogar agora
        </button>
        {online && (
          <button className="btn violet" onClick={() => { sfxTap(); setPainel((v) => !v); }}>
            Jogar com amigos
          </button>
        )}
        <FullscreenButton />
        <AudioButton onOpen={onOpenAudio} />
      </div>

      {/* APRENDA KING fica FORA da fileira principal e em tom discreto: quem já sabe jogar não
          deve tropeçar nele toda vez que abre o app, e quem não sabe precisa achá-lo sem
          procurar. Ele abre sozinho na primeira utilização; aqui é só o caminho de volta. */}
      {tutorial && (
        <button className="hm-tutorial" onClick={() => { sfxTap(); tutorial.onAbrir(); }}>
          {tutorial.concluido ? "Rever como se joga" : "Aprenda KING"}
        </button>
      )}

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
            <button
              className="btn violet wide"
              onClick={() => { sfxTap(); comAvatar((a) => online.onCriar(nome, a)); }}
            >
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
              onClick={() => { sfxTap(); comAvatar((a) => online.onEntrar(codigo, nome, a)); }}
            >
              Entrar na sala
            </button>
          </div>
        )
      )}

      {/* O SELETOR SOB DEMANDA.
          Ele não fica na tela esperando ser notado: aparece quando uma ação precisa de
          identidade, e some assim que a escolha acontece — levando a ação junto. Nenhum bicho
          nasce marcado, e é isso que separa "escolher" de "aceitar o que já estava lá". */}
      {pedindoAvatar && (
        <>
          <div className="hm-avscrim" onClick={() => setPedindoAvatar(null)} aria-hidden />
          <div className="hm-avdialogo" role="dialog" aria-label="Escolha o seu avatar">
            <span className="hm-avtitulo">Escolha o seu avatar</span>
            <div className="hm-avatares" role="radiogroup" aria-label="Escolha o seu avatar">
              {AVATARES.map((id) => {
                const d = desenhoDoAvatar(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={false}
                    aria-label={d.rotulo}
                    title={`${d.rotulo} — ${d.persona}`}
                    className="hm-av"
                    onClick={() => {
                      sfxTap();
                      const acao = pedindoAvatar;
                      setAvatar(id);
                      setPedindoAvatar(null);
                      acao(id);
                    }}
                  >
                    {d.glifo}
                  </button>
                );
              })}
            </div>
            <button className="hm-avcancela" onClick={() => { sfxTap(); setPedindoAvatar(null); }}>
              agora não
            </button>
          </div>
        </>
      )}

      <div className="foot">1 jogador + 3 bots · 4 jogadores · 10 mãos · base jogável (motor real)</div>
    </div>
  );
}
