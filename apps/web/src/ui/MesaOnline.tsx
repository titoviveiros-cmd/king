// CROMO DO MULTIPLAYER — o pouco que a Mesa precisa mostrar A MAIS quando há gente do outro lado.
//
// Tudo aqui é ADITIVO: no modo local a prop `mp` não existe e nenhum destes componentes é
// montado. A Mesa, o leque, o HUD, o Placar e o Placar Final continuam exatamente como foram
// aprovados — a integração adapta DADOS, não redesenha o produto.
//
// São quatro informações que só existem online, e nenhuma delas é opcional para quem joga:
//   1. quanto tempo resta para a decisão (o relógio é do servidor);
//   2. que a conexão caiu e está voltando;
//   3. que o servidor está jogando por alguém que se ausentou;
//   4. quem já confirmou a próxima mão.
//
// A quinta é social e não é informação de jogo: as mensagens rápidas entre os quatro.
import { useEffect, useRef, useState } from "react";
import type { Seat } from "@king/engine";
import { deveAlertar, lerRelogio } from "./relogio.js";
import { sfxTap, sfxSocial, sfxTempoAcabando } from "../audio/sounds.js";
import { atalhosDe, fraseDe, porCategoria, ROTULO_DA_CATEGORIA } from "./social.js";
import type { AssentoLido, EstadoDaSalaLido } from "../net/clienteKing.js";
import type { EstadoDaConexao, RelogioRecebido } from "../game/useKingOnline.js";

/** O contexto multiplayer que a Mesa e o Placar recebem. Ausente = modo local. */
export interface MesaMultiplayer {
  eu: Seat;
  sala: EstadoDaSalaLido | null;
  conexao: EstadoDaConexao;
  relogio: RelogioRecebido | null;
  /** Assentos que já pediram a próxima mão (último `READY_STATE`). */
  prontos: Seat[];
  recusa: { mensagem: string; nonce: number } | null;
  /** `cardId` da carta aguardando confirmação do servidor. */
  emVoo: string | null;
  /** Há intenção em voo: o leque não aceita um segundo toque. */
  aguardando: boolean;
  pediProximaMao: boolean;
  /** Mensagem social em cartaz por assento. Efêmera: não é estado de jogo, não sobrevive à queda. */
  mensagens: Partial<Record<Seat, { id: string; nonce: number }>>;
  onEnviarMensagem: (id: string) => void;
}

/**
 * "O servidor está jogando por este assento agora."
 *
 * Linguagem deliberadamente NÃO punitiva: quem caiu não fez nada de errado, e o objetivo é só
 * explicar por que aquele lugar agiu sem ninguém tocar em nada.
 */
export function SeloDeAssistencia({ assento }: { assento?: AssentoLido }) {
  if (!assento?.assisted) return null;
  return <span className="assist" title="O servidor está jogando por este assento">Assistência</span>;
}

/**
 * Selo de BOT. Enquanto o bot se chamava "BOT NORMAL" o próprio nome já avisava; com nome
 * próprio, o aviso passa a ser este. Ninguém deve descobrir que jogou contra a máquina depois
 * da partida.
 */
export function SeloDeBot({ assento }: { assento?: AssentoLido }) {
  if (!assento?.bot) return null;
  return <span className="robo" title="Jogador controlado pelo servidor">Bot</span>;
}

/**
 * Relógio da decisão. O servidor manda `restanteMs` no início e a cada mudança de fase; entre as
 * mensagens o cliente conta sozinho. Nunca há contador local próprio — dessincronizaria. E o
 * prazo continua sendo do servidor: quem age por estouro é ele, não esta tela.
 *
 * Só aparece em PLAY e TRUMP. O prazo do READY é assunto do Placar, que já mostra o consenso.
 *
 * ESTADO CRÍTICO — últimos 10 segundos. O aviso NÃO depende de um sentido só:
 *   cor   (vermelho + pulso discreto)
 *   TEXTO ("Seu tempo está acabando") — quem não distingue a cor, lê
 *   som   (uma vez, na virada 11 → 10) — quem não olha a tela, ouve
 * O som respeita o toggle de efeitos automaticamente, porque `audio.tone` sai cedo quando eles
 * estão desligados. Quem joga sem áudio continua tendo cor e texto.
 */
export function ChipDoRelogio({ relogio, eu }: { relogio: RelogioRecebido | null; eu: Seat }) {
  const leitura = lerRelogio(relogio, eu, Date.now());
  const jaAvisado = useRef(0);

  useEffect(() => {
    if (!deveAlertar(leitura, jaAvisado.current)) return;
    jaAvisado.current = leitura!.prazoEm;
    sfxTempoAcabando();
  });

  if (!leitura?.visivel) return null;
  const critico = leitura.estado === "critico";
  return (
    <div
      className={`mprelogio ${leitura.estado}${leitura.meu ? " meu" : ""}`}
      role="timer"
      aria-live={critico && leitura.meu ? "assertive" : "off"}
    >
      <b>{leitura.segundos}s</b>
      {critico && leitura.meu && <i>Seu tempo está acabando</i>}
    </div>
  );
}

const TEXTO_DA_CONEXAO: Partial<Record<EstadoDaConexao, string>> = {
  reconectando: "Reconectando…",
  encerrada: "A sala foi encerrada.",
  erro: "Sem conexão com o servidor.",
};

/** Faixa fina no alto. Só existe quando algo está errado — em jogo normal não ocupa nada. */
export function FaixaDaConexao({ conexao, codigo }: { conexao: EstadoDaConexao; codigo: string }) {
  const texto = TEXTO_DA_CONEXAO[conexao];
  if (!texto) return null;
  return (
    <div className={`mpconexao ${conexao}`} role="status">
      {texto}
      {codigo && conexao === "reconectando" && <b> Sala {codigo}</b>}
    </div>
  );
}

/**
 * O servidor recusou a intenção. A carta nunca chegou a sair da mão, então não há nada a desfazer
 * visualmente — falta só dizer por quê, com a mensagem curta que o próprio servidor mandou.
 */
export function AvisoDeRecusa({ recusa }: { recusa: { mensagem: string; nonce: number } | null }) {
  if (!recusa) return null;
  return <div className="mprecusa" key={recusa.nonce} role="alert">{recusa.mensagem}</div>;
}

/**
 * O "Continuar" do Placar no multiplayer.
 *
 * A mão só vira com os QUATRO — e ainda assim só depois do piso de leitura de 8s, que é do
 * servidor. Sem isto o jogador ficaria olhando uma tela parada sem saber se travou ou se está
 * esperando alguém. O Placar continua sendo Placar: resultado, ranking e próximo contrato
 * permanecem intactos; isto entra apenas no lugar do botão.
 */
export function ConsensoDaProximaMao({
  mp, players, onAdvance,
}: {
  mp: MesaMultiplayer;
  players: string[];
  onAdvance: () => void;
}) {
  const assentos = mp.sala?.seats ?? [];
  const faltam = players
    .map((nome, s) => ({ nome, s: s as Seat }))
    .filter(({ s }) => !mp.prontos.includes(s));

  return (
    <div className="pl-consenso">
      <div className="pl-prontos" aria-label="Quem já confirmou a próxima mão">
        {players.map((nome, i) => {
          const s = i as Seat;
          const ok = mp.prontos.includes(s);
          const ausente = assentos[i] && !assentos[i].connected;
          return (
            <span
              key={i}
              className={`pl-pronto s${i}${ok ? " ok" : ""}${ausente ? " ausente" : ""}`}
              title={`${nome}${ok ? " · pronto" : " · aguardando"}`}
            >
              {nome[0]}
            </span>
          );
        })}
      </div>
      {mp.pediProximaMao ? (
        <span className="pl-aguardando" role="status">
          Pronto · {faltam.length === 0
            ? "começando…"
            : faltam.length === 1
              ? `aguardando ${faltam[0].nome}`
              : `aguardando ${faltam.length} jogadores`}
        </span>
      ) : (
        <button className="btn gold" autoFocus onClick={onAdvance}>Próxima mão ▸</button>
      )}
    </div>
  );
}

// ══════════════════════ SOCIAL ══════════════════════

/**
 * O balão de quem falou. Fica ao lado do avatar do REMETENTE, e não num painel central: numa
 * mesa de quatro, "quem disse" é metade da graça.
 *
 * `key={nonce}` de propósito — repetir a mesma frase remonta o elemento e a animação toca de
 * novo. Sem isso, mandar "Boa!" duas vezes seguidas pareceria um clique perdido.
 */
export function BalaoSocial({ mensagem }: { mensagem?: { id: string; nonce: number } }) {
  const frase = fraseDe(mensagem?.id);
  if (!frase) return null;
  return (
    <span key={mensagem!.nonce} className="balao" role="status">{frase.texto}</span>
  );
}

/**
 * O botão de falar e o painel.
 *
 * Discreto de propósito: fechado, é um botão junto dos controles do topo, e nada mais.
 *
 * Aberto, é MODAL — com véu e tudo. Em landscape de celular não existe canto livre: o leque
 * ocupa a metade de baixo e os cards dos jogadores as bordas. Medido em 852×393, qualquer painel
 * com dezoito frases encosta no leque. Em vez de fingir que cabe, o painel assume que está por
 * cima: escurece a mesa, fecha ao tocar fora e some assim que a frase é escolhida. Ler cartas e
 * escolher frase são coisas que ninguém faz ao mesmo tempo.
 *
 * O que NUNCA cobre carta é o que fica permanente — o botão e os balões.
 *
 * Não existe campo de texto. Não é limitação de implementação: é a decisão de produto.
 */
export function BotaoSocial({ status, onEnviar }: {
  status: "playing" | "finished";
  onEnviar: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [tudo, setTudo] = useState(false);

  const mandar = (id: string) => {
    sfxSocial();
    onEnviar(id);
    setAberto(false);
    setTudo(false);
  };

  return (
    <>
      <button
        className={`soc${aberto ? " on" : ""}`}
        aria-label="Mensagens rápidas"
        aria-expanded={aberto}
        onClick={() => { sfxTap(); setAberto((v) => !v); setTudo(false); }}
      >
        💬
      </button>

      {aberto && <div className="socscrim" onClick={() => setAberto(false)} aria-hidden />}
      {aberto && (
        <div className="socpanel" role="dialog" aria-modal="true" aria-label="Mensagens rápidas">
          {tudo ? (
            porCategoria().map(({ categoria, frases }) => (
              <div key={categoria} className="socgrupo">
                <span className="soclb">{ROTULO_DA_CATEGORIA[categoria]}</span>
                <div className="socfrases">
                  {frases.map((f) => (
                    <button key={f.id} className="socbtn" onClick={() => mandar(f.id)}>{f.texto}</button>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="socfrases">
              {atalhosDe(status).map((f) => (
                <button key={f.id} className="socbtn" onClick={() => mandar(f.id)}>{f.texto}</button>
              ))}
            </div>
          )}
          <div className="socpe">
            <button className="socmais" onClick={() => { sfxTap(); setTudo((v) => !v); }}>
              {tudo ? "menos" : "mais mensagens"}
            </button>
            <button className="socmais" onClick={() => { sfxTap(); setAberto(false); }}>fechar</button>
          </div>
        </div>
      )}
    </>
  );
}
