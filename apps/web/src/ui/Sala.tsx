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
import { useEffect, useState } from "react";
import type { Seat } from "@king/engine";
import { AudioButton } from "./AudioPanel.js";
import { FullscreenButton } from "./FullscreenButton.js";
import { sfxTap } from "../audio/sounds.js";
import type { AssentoLido, EstadoDaSalaLido } from "../net/clienteKing.js";
import type { EstadoDaConexao } from "../game/useKingOnline.js";
import { AVATARES, desenhoDoAvatar } from "./avatares.js";

/**
 * As mesas disponíveis. Espelha `TEMAS_DA_MESA` do servidor, que é quem valida.
 *
 * O NOME é do produto, não da cor: "Noite Imperial" e "Verde de Cartas" pertencem ao KING, e é
 * assim que a escolha aparece para quem está na sala. O desenho de cada uma vive no `theme.css`,
 * em tokens — nenhum componente sabe qual mesa está no ar.
 */
const MESAS = [
  { id: "imperial", nome: "Noite Imperial" },
  { id: "verde", nome: "Verde de Cartas" },
] as const;

const LUGARES: Seat[] = [0, 1, 2, 3];

/** Piso oficial de humanos numa mesa multiplayer privada. Espelha `MIN_HUMANOS` do servidor. */
const MIN_HUMANOS = 2;

export function Sala({
  sala, conexao, erro, eu, souAnfitriao, onPronto, onEscolherMesa, onEscolherAvatar, recusa,
  onAdicionarBot, onRemoverBot, onSair, onOpenAudio,
}: {
  sala: EstadoDaSalaLido | null;
  conexao: EstadoDaConexao;
  erro: string | null;
  eu: Seat | null;
  souAnfitriao: boolean;
  onPronto: (pronto: boolean) => void;
  /** Cosmético da sala. Só o anfitrião; o servidor recusa de qualquer outro. */
  onEscolherMesa: (tema: string) => void;
  /** Troca o avatar do próprio assento. Quem arbitra a exclusividade é o servidor. */
  onEscolherAvatar: (avatar: string) => void;
  /**
   * A última recusa do servidor.
   *
   * Ela existia e só chegava à Mesa. No lobby, quem perdesse a disputa por um avatar não via
   * nada: o círculo simplesmente não mudava, e a pessoa ficava sem saber se o toque não pegou ou
   * se alguém foi mais rápido. `AVATAR_TAKEN` tem uma frase; ela precisa aparecer onde a escolha
   * acontece.
   */
  recusa?: { mensagem: string; nonce: number } | null;
  onAdicionarBot: (seat: Seat) => void;
  onRemoverBot: (seat: Seat) => void;
  onSair: () => void;
  onOpenAudio: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [abrindoAvatar, setAbrindoAvatar] = useState(false);
  const assentos = sala?.seats ?? [];
  const ocupados = assentos.filter((a) => a.playerId !== "").length;
  const humanos = assentos.filter((a) => a.playerId !== "" && !a.bot).length;
  const meu = eu === null ? undefined : assentos[eu];
  const pronto = !!meu?.ready;
  const codigo = sala?.roomCode ?? "";
  const podeMexer = souAnfitriao && conexao === "conectado";
  const temaAtual = sala?.tableTheme ?? "imperial";

  /**
   * Os bichos que os OUTROS lugares já ocupam.
   *
   * A escolha da Home acontece antes de saber quem está na sala; é aqui, com a mesa à vista, que
   * ela pode ser refeita com informação. O que este conjunto produz é apenas o `disabled` e o
   * rótulo "Em uso" — apresentação. Quem recusa de verdade é o servidor, porque entre esta lista e
   * a mensagem chegando lá cabe a escolha de outra pessoa.
   */
  const emUso = avataresEmUso(assentos, eu);
  /**
   * IDENTIDADE PENDENTE — o servidor não escolheu por mim.
   *
   * Entrar pedindo um bicho que outra pessoa já usa não derruba ninguém na porta, mas também não
   * vira "toma esse outro". O assento fica com o avatar VAZIO até haver uma escolha consciente, e
   * é isso que este booleano lê. Ele não é um estado local que o cliente inventa: é o que o
   * estado sincronizado da sala está dizendo.
   */
  const pendente = !!meu && !meu.bot && meu.avatar === "";
  // O seletor ABRE SOZINHO quando falta escolher. Avisar sem oferecer o caminho seria deixar a
  // pessoa procurando onde resolver o que acabou de ser dito que está pendente.
  useEffect(() => { if (pendente) setAbrindoAvatar(true); }, [pendente]);

  const [recusaVisivel, setRecusaVisivel] = useState<string | null>(null);
  useEffect(() => { setRecusaVisivel(recusa?.mensagem ?? null); }, [recusa?.nonce, recusa?.mensagem]);
  useEffect(() => { setRecusaVisivel(null); }, [meu?.avatar]);

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
              className={`sl-lugar s${i}${vazio ? " vago" : ""}${bot ? " robo" : ""}${a?.ready && !bot ? " pronto" : ""}${a && !vazio && !bot && !a.connected ? " ausente" : ""}${i === eu ? " voce" : ""}${!vazio && !bot && a.avatar === "" ? " pendente" : ""}`}
            >
              {/* O PRÓPRIO CÍRCULO É O BOTÃO. Ele já está na tela, já mostra o bicho atual e
                  já pertence a quem vai trocar — não precisa de faixa nova.

                  A primeira versão deste seletor era uma fileira dos oito acima da linha de
                  ações. Custou ~38px de altura e derrubou o quarto lugar para fora da tela a
                  667x375, quebrando a promessa central desta tela: ver a mesa inteira. O mesmo
                  erro que o seletor de mesa já tinha cometido, e pelo mesmo motivo. */}
              {i === eu && !vazio && !bot ? (
                <button
                  className={`sl-av-troca${abrindoAvatar ? " on" : ""}`}
                  onClick={() => { sfxTap(); setAbrindoAvatar((v) => !v); }}
                  disabled={conexao !== "conectado"}
                  aria-expanded={abrindoAvatar}
                  aria-label="Trocar o seu avatar"
                  title="Trocar o seu avatar"
                >
                  <Insignia vazio={false} bot={false} avatar={a?.avatar} />
                  <i aria-hidden>✎</i>
                </button>
              ) : (
                <Insignia vazio={vazio} bot={bot} avatar={a?.avatar} />
              )}
              <span className="sl-nome">
                {vazio ? "Aguardando…" : a.nick}
                {/* O bot ganhou nome próprio; a etiqueta é o que impede alguém de achar que é gente. */}
                {bot && <i> · bot</i>}
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
        {/* O SELETOR, SOBRE A LISTA E NÃO ANTES DELA.
            Ele é sobreposto de propósito: assim não existe estado da tela em que a mesa fique
            mais curta por causa dele. Os oito continuam na grade mesmo ocupados — sumir com um
            reposicionaria os outros no instante em que um dedo já está a caminho, e o toque
            cairia em outro bicho. */}
        {abrindoAvatar && meu && (
          <>
            <div className="sl-avscrim" onClick={() => setAbrindoAvatar(false)} aria-hidden />
            <SeletorDeAvatar
              atual={meu.avatar}
              emUso={emUso}
              travado={conexao !== "conectado"}
              onEscolher={(id) => { sfxTap(); onEscolherAvatar(id); setAbrindoAvatar(false); }}
            />
          </>
        )}
      </div>

      {/* O AVISO, com o motivo e o que fazer. Ele fica acima da linha de ações, no caminho do
          olho de quem acabou de sentar, e some sozinho quando a escolha é aceita pelo servidor. */}
      {pendente && (
        <div className="sl-pendente" role="alert">
          Este avatar já está em uso. Escolha outro para continuar.
        </div>
      )}
      {/* A recusa some sozinha assim que o avatar do assento muda: ela falava do pedido anterior,
          e um aviso que sobrevive ao próprio motivo vira ruído. */}
      {recusaVisivel && (
        <div className="sl-pendente recusa" role="alert">{recusaVisivel}</div>
      )}

      {erro && <div className="sl-erro" role="alert">{erro}</div>}

      <div className="row">
        {/* A MESA DA SALA.
            Aparece para todo mundo, porque saber em que mesa se vai jogar é do grupo; só o anfitrião
            consegue mexer, e quem garante isso é o servidor — o `disabled` aqui é apresentação, não
            autorização. Quem não é anfitrião lê a escolha e vê de quem ela é. */}
        <div className="sl-mesa">
          <span className="sl-mesa-lb">Mesa</span>
          <div className="sl-mesa-ops" role="radiogroup" aria-label="Cor da mesa">
            {MESAS.map((m) => {
              const escolhida = temaAtual === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={escolhida}
                  className={`sl-mesa-op ${m.id}${escolhida ? " on" : ""}`}
                  disabled={!podeMexer}
                  onClick={() => { sfxTap(); onEscolherMesa(m.id); }}
                  title={m.nome}
                >
                  <i aria-hidden />
                  <span>{m.nome}</span>
                </button>
              );
            })}
          </div>
          {!souAnfitriao && <span className="sl-mesa-nota">quem escolhe é o anfitrião</span>}
        </div>

        {/* SEM AVATAR, SEM PRONTO. O `disabled` aqui é apresentação — quem recusa de verdade é o
            servidor, com `AVATAR_PENDING` —, mas oferecer um botão que vai ser recusado é pior
            que não oferecer. O rótulo diz o que falta, em vez de só ficar cinza. */}
        <button
          className={`btn ${pronto ? "violet" : "gold"}`}
          disabled={!meu || pendente || conexao === "erro" || conexao === "encerrada"}
          onClick={() => onPronto(!pronto)}
        >
          {pendente ? "Escolha um avatar" : pronto ? "✓ Pronto — cancelar" : "Estou pronto"}
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
 * OS OITO BICHOS, com o que já está em uso apagado.
 *
 * Componente próprio porque ele é o objeto do contrato desta rodada — "avatar ocupado continua
 * visível, indisponível e não clicável" — e um contrato que só existe atrás de um clique não pode
 * ser verificado por quem renderiza a tela sem clicar.
 *
 * O que está aqui é APRESENTAÇÃO. Quem recusa de verdade é o servidor: entre esta grade e a
 * mensagem chegando lá cabe a escolha de outra pessoa, e essa corrida tem teste no servidor.
 */
export function SeletorDeAvatar({ atual, emUso, travado, onEscolher }: {
  atual: string | undefined;
  /** Os bichos dos OUTROS assentos ocupados — humanos e bots. */
  emUso: ReadonlySet<string>;
  /** Sem conexão não se escolhe nada: a troca é uma mensagem, não um estado local. */
  travado?: boolean;
  onEscolher: (avatar: string) => void;
}) {
  return (
    <div className="sl-avpainel" role="dialog" aria-label="Escolha o seu avatar">
      <span className="sl-mesa-lb">Seu avatar</span>
      <div className="sl-avops" role="radiogroup" aria-label="Escolha o seu avatar">
        {AVATARES.map((id) => {
          const d = desenhoDoAvatar(id);
          const ocupado = emUso.has(id);
          const meuAtual = atual === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={meuAtual}
              aria-label={ocupado ? `${d.rotulo} — em uso` : d.rotulo}
              className={`sl-avop${meuAtual ? " on" : ""}${ocupado ? " emuso" : ""}`}
              disabled={ocupado || !!travado}
              title={ocupado ? `${d.rotulo} — em uso` : `${d.rotulo} — ${d.persona}`}
              onClick={() => onEscolher(id)}
            >
              <i aria-hidden>{d.glifo}</i>
              {ocupado && <b>Em uso</b>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Os bichos que os OUTROS lugares ocupam, a partir do estado da sala.
 *
 * Exportada junto com o seletor: a regra "o meu próprio bicho não me bloqueia" mora aqui, e ela é
 * fácil de errar de novo em qualquer tela que precise da mesma lista.
 */
export function avataresEmUso(assentos: readonly AssentoLido[], eu: Seat | null): Set<string> {
  return new Set(assentos.filter((a, s) => a.playerId !== "" && s !== eu).map((a) => a.avatar));
}

/**
 * O círculo do lugar. Cor pelo assento, desenho pelo avatar autoritativo — e o robô continua
 * com cara de robô, porque agora ele tem nome de gente.
 */
function Insignia({ vazio, bot, avatar }: { vazio: boolean; bot: boolean; avatar?: string }) {
  if (vazio) return <span className="sl-av" aria-label="lugar vago">+</span>;
  if (bot) return <span className="sl-av" aria-label="bot">🤖</span>;
  // PENDENTE NÃO É UM BICHO. Desenhar o padrão aqui mostraria um animal com cara de escolhido, que
  // é exatamente o que a regra nova existe para evitar. Interrogação: neutra e sem dono.
  if (!avatar) return <span className="sl-av pendente" aria-label="avatar ainda não escolhido">?</span>;
  const d = desenhoDoAvatar(avatar);
  return <span className="sl-av" aria-label={d.rotulo}>{d.glifo}</span>;
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
