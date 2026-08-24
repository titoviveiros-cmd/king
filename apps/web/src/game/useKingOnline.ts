// MODO MULTIPLAYER — o hook irmão de `useKingGame`.
//
// Devolve a MESMA forma que o modo local (`game`, `reviewing`, `shake`, `castigo`, `playCard`,
// `chooseTrump`, `advanceHand`), mais o que só existe online: sala, assentos, relógio do
// servidor, consenso da próxima mão, estado da conexão. A Mesa consome os campos comuns e não
// sabe qual dos dois hooks a está alimentando.
//
// ═════════════════ O PROBLEMA CENTRAL DESTE ARQUIVO: DOIS RELÓGIOS ═════════════════
//
// No modo local a apresentação MANDA no jogo: enquanto a mesa está parada mostrando a vaza, os
// bots não jogam. Online isso se inverte — o servidor já resolveu tudo e o `STATE_UPDATE` chega
// no instante seguinte, sem esperar animação nenhuma.
//
// A regra adotada é: **a apresentação pode atrasar, nunca adiantar, e nunca bloqueia o envio.**
//   • as atualizações entram numa fila e são consumidas no ritmo já aprovado;
//   • se a fila cresce demais (aba em segundo plano no iPhone é o caso clássico), ela COLAPSA
//     para o estado mais recente em vez de encenar vinte animações atrasadas;
//   • RESYNC, RECONNECTED e MATCH_STARTED nunca entram na fila: são salto imediato;
//   • `reviewing` é só cosmético aqui — jogar continua liberado enquanto a mesa "descansa",
//     senão o relógio do servidor correria contra uma UI travada.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Card, Seat, Trump } from "@king/engine";
import { PartidaRemota } from "./partidaRemota.js";
import { useApresentacao } from "./useApresentacao.js";
import { ehSalto, proximoPasso } from "./filaDeApresentacao.js";
import { useSonsDeTransicao } from "./useSonsDeTransicao.js";
import { TEMPOS } from "./timings.js";
import { audio } from "../audio/engine.js";
import { sfxSocial, sfxTap, sfxTrump } from "../audio/sounds.js";
import { analytics } from "../analytics/analytics.js";
import { abridorColyseus, type AbridorDeSessao, type EstadoDaSalaLido, type SessaoKing } from "../net/clienteKing.js";
import { servidorConfigurado } from "../net/servidor.js";
import { esquecerRecuperacao, guardarRecuperacao, lerRecuperacao } from "../net/recuperacao.js";
import type { AcaoAutomatica, AtualizacaoDeEstado, RelogioDaDecisao } from "../net/protocolo.js";

/** Quantas atualizações podem ficar represadas antes de a fila colapsar para a mais recente. */
const LIMITE_DA_FILA = 2;

export type EstadoDaConexao =
  | "ocioso"        // nem tentou
  | "conectando"
  | "conectado"
  | "reconectando"  // caiu; o SDK está tentando voltar sozinho
  | "encerrada"     // saiu, ou a sala morreu
  | "erro";

export interface RelogioRecebido extends RelogioDaDecisao {
  /** `Date.now()` de quando chegou — o cliente conta a partir daqui, entre mensagens. */
  recebidoEm: number;
}

export interface AutoAcaoRecebida extends AcaoAutomatica {
  nonce: number;
}

export function useKingOnline(abridor?: AbridorDeSessao) {
  const ap = useApresentacao();
  const { bump, afterPlay, emLeitura, limpar } = ap;

  const sessao = useRef<SessaoKing | null>(null);
  const partida = useRef<PartidaRemota | null>(null);
  const fila = useRef<AtualizacaoDeEstado[]>([]);
  const assento = useRef<Seat | null>(null);

  const [screen, setScreen] = useState<"home" | "sala" | "mesa">("home");
  const [conexao, setConexao] = useState<EstadoDaConexao>("ocioso");
  const [sala, setSala] = useState<EstadoDaSalaLido | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [relogio, setRelogio] = useState<RelogioRecebido | null>(null);
  const [prontos, setProntos] = useState<Seat[]>([]);
  const [autoAcao, setAutoAcao] = useState<AutoAcaoRecebida | null>(null);
  const [recusa, setRecusa] = useState<{ mensagem: string; nonce: number } | null>(null);
  /**
   * Mensagens sociais em cartaz, por assento. Efêmeras de propósito: nada disso é estado de
   * jogo — não entra no `Schema`, não sobrevive à queda e não vira histórico. Quem chegou
   * depois não vê o que foi dito, como numa mesa de verdade.
   */
  const [mensagens, setMensagens] = useState<Partial<Record<Seat, { id: string; nonce: number }>>>({});

  const servidor = useMemo(() => servidorConfigurado(), []);
  const abrir = useMemo<AbridorDeSessao | null>(
    () => abridor ?? (servidor.ok ? abridorColyseus(servidor.url) : null),
    [abridor, servidor],
  );

  // ─────────────────────────── aplicação do estado autoritativo ───────────────────────────

  /** Aplica UMA atualização e encena o que ela merece. */
  const aplicar = useCallback((u: AtualizacaoDeEstado) => {
    const p = partida.current;
    if (!p || !p.aplicar(u)) return;
    switch (u.cause) {
      case "CARD_PLAYED":
        afterPlay(p);
        break;
      case "TRUMP_SELECTED":
        sfxTrump();
        break;
      case "HAND_ADVANCED":
      case "MATCH_STARTED":
      case "RESYNC":
      case "RECONNECTED":
        // salto: nada de encenar o que já passou
        limpar();
        break;
    }
    bump();
  }, [afterPlay, bump, limpar]);

  /** Salto imediato para o estado mais recente — descarta o que estava represado. */
  const saltarPara = useCallback((u: AtualizacaoDeEstado) => {
    fila.current = [];
    limpar();
    aplicar(u);
  }, [aplicar, limpar]);

  // Consome a fila no ritmo da apresentação. Mesmo passo do modo local: a mesa tem o mesmo
  // andamento nos dois modos, e é isso que faz o online "parecer" o KING que já foi validado.
  useEffect(() => {
    if (screen !== "mesa") return;
    const id = setInterval(() => {
      if (relogio) bump(); // contagem regressiva viva na tela
      if (emLeitura()) { bump(); return; }
      const passo = proximoPasso(fila.current, LIMITE_DA_FILA);
      if (!passo.proxima) return;
      fila.current = passo.resto;
      // Atrasou demais (aba em segundo plano, rede engasgada): vai direto para o presente.
      if (passo.colapsou) limpar();
      aplicar(passo.proxima);
    }, TEMPOS.botPasso);
    return () => clearInterval(id);
  }, [screen, aplicar, bump, emLeitura, limpar, relogio]);

  useSonsDeTransicao(partida.current, screen === "mesa");

  // ─────────────────────────── assinatura das mensagens do servidor ───────────────────────────

  const assinar = useCallback((s: SessaoKing) => {
    s.aoMudarEstado((e) => {
      setSala(e);
      if (e.status !== "lobby") setScreen("mesa");
    });

    s.ao("SERVER_WELCOME", (w) => {
      assento.current = w.you.seat;
      // A credencial ROTACIONA a cada retorno: guardar sempre, não só na primeira vez.
      guardarRecuperacao(w.you.recoveryToken);
      setConexao("conectado");
      setErro(null);
      setSala(s.estado());
      bump();
    });

    s.ao("STATE_UPDATE", (u) => {
      const eu = assento.current;
      if (eu === null) return;
      if (!partida.current) {
        analytics.track("match_started", { modo: "online" });
        partida.current = new PartidaRemota(u, eu, (tipo, payload) => s.enviar(tipo, payload));
        setScreen("mesa");
        // A mesa não pode nascer no meio de uma animação: a primeira visão é sempre um salto.
        fila.current = [];
        limpar();
        bump();
        return;
      }
      if (ehSalto(u.cause)) saltarPara(u);
      else fila.current.push(u);
    });

    s.ao("ACTION_REJECTED", (r) => {
      partida.current?.recusar(r.actionId);
      // A carta nunca saiu da mão (otimismo visual limitado): não há nada a desfazer, só a
      // travação a soltar e a explicação a dar.
      setRecusa({ mensagem: r.message, nonce: Date.now() });
      bump();
    });

    s.ao("READY_STATE", (r) => {
      setProntos(r.ready.slice());
      partida.current?.refletirProntos(r.ready);
      bump();
    });

    s.ao("TURN_CLOCK", (c) => setRelogio({ ...c, recebidoEm: Date.now() }));

    s.ao("AUTO_ACTION", (a) => {
      setAutoAcao({ ...a, nonce: Date.now() });
      bump();
    });

    s.ao("SOCIAL_MESSAGE", (m) => {
      const nonce = Date.now();
      setMensagens((atual) => ({ ...atual, [m.seat]: { id: m.messageId, nonce } }));
      sfxSocial();
      // Some sozinha. O prazo vem do SERVIDOR para as quatro telas concordarem, e a remoção só
      // vale se ninguém tiver falado por cima nesse meio-tempo.
      window.setTimeout(() => {
        setMensagens((atual) => (atual[m.seat]?.nonce === nonce
          ? { ...atual, [m.seat]: undefined }
          : atual));
      }, m.duracaoMs);
    });

    s.ao("PLAYER_CONNECTION", () => { setSala(s.estado()); bump(); });
    s.ao("PLAYER_JOINED", () => { setSala(s.estado()); bump(); });
    s.ao("PLAYER_LEFT", () => { setSala(s.estado()); bump(); });
    s.ao("SERVER_ERROR", (f) => { setErro(f.message); setConexao("erro"); });

    s.aoCair(() => { setConexao("reconectando"); analytics.track("disconnect", { modo: "online" }); });
    s.aoVoltar(() => { setConexao("conectado"); analytics.track("reconnect", { modo: "online" }); });
    s.aoSair(() => { setConexao("encerrada"); sessao.current = null; });
    s.aoErro((_codigo, motivo) => { setErro(motivo ?? "Erro de conexão"); setConexao("erro"); });
  }, [bump, limpar, saltarPara]);

  // ─────────────────────────── abertura e encerramento da sessão ───────────────────────────

  const limparSessao = useCallback(() => {
    sessao.current?.sair();
    sessao.current = null;
    partida.current = null;
    assento.current = null;
    fila.current = [];
    setSala(null);
    setProntos([]);
    setRelogio(null);
    setAutoAcao(null);
    limpar();
  }, [limpar]);

  const conectar = useCallback(async (pedido: Parameters<AbridorDeSessao>[0]) => {
    if (!abrir) {
      setErro(servidor.ok ? "Multiplayer indisponível" : servidor.motivo);
      setConexao("erro");
      return;
    }
    audio.unlock(); // gesto real do usuário: é aqui que o iOS libera o áudio
    setErro(null);
    setConexao("conectando");
    setScreen("sala");
    try {
      const s = await abrir(pedido);
      sessao.current = s;
      assinar(s);
      setSala(s.estado());
      setConexao("conectado");
      bump();
    } catch (e) {
      // Um retorno recusado quase sempre significa sala encerrada: a credencial já não vale.
      if (pedido.tipo === "voltar") esquecerRecuperacao();
      setErro(mensagemDeFalha(e));
      setConexao("erro");
      setScreen("home");
    }
  }, [abrir, assinar, bump, servidor]);

  const criarSala = useCallback((nick: string, avatar: string) => {
    // Nem o apelido nem o avatar viajam para a medição: um identifica pessoa, o outro é escolha
    // estética que não muda o funil. O que se quer saber é quantas salas nascem.
    analytics.track("room_created", {});
    void conectar({ tipo: "criar", nick, avatar });
  }, [conectar]);
  const entrarNaSala = useCallback((codigo: string, nick: string, avatar: string) => {
    // O CÓDIGO NÃO É EVENTO: quatro dígitos são a chave de entrar na partida privada de outras
    // pessoas. Só o fato de alguém ter entrado é métrica.
    analytics.track("room_joined", {});
    void conectar({ tipo: "entrar", codigo: codigo.trim().toUpperCase(), nick, avatar });
  }, [conectar]);
  const voltarParaSala = useCallback(() => {
    const token = lerRecuperacao();
    if (token) void conectar({ tipo: "voltar", recoveryToken: token });
  }, [conectar]);

  /**
   * Manda uma mensagem. Vai só a ETIQUETA — o servidor valida contra o conjunto fechado e aplica
   * o limitador. O cliente não decide se pode: pede.
   */
  const enviarMensagem = useCallback((id: string) => {
    // A etiqueta pode ir: é de conjunto fechado e não é texto de ninguém.
    analytics.track("social_message_sent", { mensagem: id });
    sessao.current?.enviar("CLIENT_SOCIAL_MESSAGE", { messageId: id });
  }, []);

  const sairDaSala = useCallback(() => {
    sfxTap();
    limparSessao();
    esquecerRecuperacao();
    setConexao("ocioso");
    setScreen("home");
  }, [limparSessao]);

  // A sala morre com o componente: sem isto, sair da aba deixaria o assento preso até o TTL.
  useEffect(() => () => { sessao.current?.sair(); }, []);

  // ─────────────────────────── ações da Mesa ───────────────────────────

  const definirPronto = useCallback((pronto: boolean) => {
    sfxTap();
    sessao.current?.enviar("CLIENT_SET_READY", { ready: pronto });
  }, []);

  /**
   * Composição da mesa — só o anfitrião, e só antes de começar.
   *
   * A interface esconde os botões de quem não é anfitrião, mas isso é apresentação: quem
   * autoriza é o servidor, que recusa a mensagem de qualquer outro. Ver `#autorizarGestaoDeBot`.
   */
  const adicionarBot = useCallback((seat: Seat) => {
    sfxTap();
    sessao.current?.enviar("CLIENT_ADD_BOT", { seat });
  }, []);
  const removerBot = useCallback((seat: Seat) => {
    sfxTap();
    sessao.current?.enviar("CLIENT_REMOVE_BOT", { seat });
  }, []);

  const playCard = useCallback((card: Card) => {
    partida.current?.playHuman(card);
    bump();
  }, [bump]);

  const chooseTrump = useCallback((t: Trump) => {
    partida.current?.chooseTrumpHuman(t);
    bump();
  }, [bump]);

  /**
   * "Continuar" do Placar: no online é um VOTO. O Placar CONTINUA na tela — mostrando que você
   * confirmou e quem falta — até o servidor mandar HAND_ADVANCED. Quem vira a mão é ele.
   */
  const advanceHand = useCallback(() => {
    partida.current?.advanceHand();
    bump();
  }, [bump]);

  const goHome = useCallback(() => sairDaSala(), [sairDaSala]);

  return {
    // ---- forma comum com o modo local ----
    game: partida.current as PartidaRemota | null,
    screen,
    reviewing: emLeitura(),
    shake: ap.shake,
    castigo: ap.castigo,
    playCard, chooseTrump, advanceHand, goHome,

    // ---- só multiplayer ----
    sala,
    conexao,
    erro,
    relogio,
    prontos,
    autoAcao,
    recusa,
    mensagens,
    enviarMensagem,
    humanSeat: assento.current,
    servidor,
    podeVoltar: lerRecuperacao() !== null,
    /** Sou o anfitrião desta sala? Vem do estado sincronizado, não de suposição do cliente. */
    souAnfitriao: assento.current !== null && !!sala?.seats[assento.current]?.host,
    criarSala, entrarNaSala, voltarParaSala, sairDaSala, definirPronto, adicionarBot, removerBot,
  };
}

function mensagemDeFalha(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/not found|does not exist|404/i.test(m)) return "Sala não encontrada. Confira o código.";
  if (/full|4002/i.test(m)) return "Essa sala já tem quatro jogadores.";
  if (/4001|protocol/i.test(m)) return "Seu app está desatualizado. Recarregue a página.";
  return "Não foi possível conectar ao servidor.";
}
