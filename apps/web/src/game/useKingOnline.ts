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
import { agoraMonotonico } from "./monotonico.js";
import { audio } from "../audio/engine.js";
import { sfxSocial, sfxTap, sfxTrump } from "../audio/sounds.js";
import { analytics } from "../analytics/analytics.js";
import { provedorConfigurado } from "../auth/identidade.js";
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
  /**
   * Leitura MONOTÔNICA de quando a mensagem chegou. O cliente conta a partir daqui, entre
   * mensagens, e nunca compara carimbos de hora com o servidor: a conta é de duração, então um
   * relógio local errado não muda o restante calculado. Ver `monotonico.ts`.
   */
  recebidoEm: number;
}

export interface AutoAcaoRecebida extends AcaoAutomatica {
  nonce: number;
}

export function useKingOnline(abridor?: AbridorDeSessao) {
  const ap = useApresentacao();
  const { bump, afterPlay, emLeitura, emPausa, suspender, limpar } = ap;

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
  /**
   * O provedor de identidade — `null` quando esta publicação não tem um configurado.
   *
   * Resolvido UMA vez e passado ao abridor, e não consultado a cada entrada: o custo de decidir
   * se há provedor é de arranque, e o de conseguir o token é de cada entrada (dentro do próprio
   * abridor, que já é assíncrono).
   */
  const identidade = useMemo(() => provedorConfigurado(), []);
  const abrir = useMemo<AbridorDeSessao | null>(
    () => abridor ?? (servidor.ok ? abridorColyseus(servidor.url, identidade) : null),
    [abridor, servidor, identidade],
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
      // Pausa de apresentação: a leitura da vaza que fechou, ou o anúncio da última mão por cima
      // da Mesa. A fila NÃO é descartada — ela REPRESA. O que o servidor mandar durante o anúncio
      // é apresentado depois dele, na ordem, em vez de acontecer atrás do véu.
      if (emPausa()) { bump(); return; }

      // O RITMO É PARA QUEM ESTÁ EM DIA, NÃO PARA QUEM ESTÁ ATRASADO.
      //
      // A cadência de `botPasso` existe para a mesa ter andamento legível — sem ela, as jogadas
      // dos bots apareceriam todas no mesmo quadro. Só que ela era aplicada igual em duas
      // situações diferentes: com a fila vazia (onde é ritmo) e com a fila cheia (onde vira
      // atraso). Depois de cada pausa de leitura da vaza a fila represa um ou dois passos, e eles
      // escoavam a 520ms cada — foi o segundo de diferença que um teste com dois aparelhos
      // encontrou, com o mais lento sempre atrás.
      //
      // Estando atrasado, consome DOIS por tique. O andamento normal não muda em nada, porque com
      // a fila em um item só o comportamento é idêntico ao de antes; o que muda é a recuperação,
      // que deixa de ser tão lenta quanto o ritmo que ela precisa alcançar.
      const quantos = fila.current.length > 1 ? 2 : 1;
      for (let i = 0; i < quantos; i++) {
        const passo = proximoPasso(fila.current, LIMITE_DA_FILA);
        if (!passo.proxima) break;
        fila.current = passo.resto;
        // Atrasou demais (aba em segundo plano, rede engasgada): vai direto para o presente.
        if (passo.colapsou) limpar();
        aplicar(passo.proxima);
      }
    }, TEMPOS.botPasso);
    return () => clearInterval(id);
  }, [screen, aplicar, bump, emPausa, limpar, relogio]);

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

    s.ao("TURN_CLOCK", (c) => setRelogio({ ...c, recebidoEm: agoraMonotonico() }));

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

  /**
   * Escolhe a mesa. Só o anfitrião, e quem confere isso é o SERVIDOR.
   *
   * O cliente não aplica localmente: manda a etiqueta e espera o estado sincronizado voltar. É o
   * que garante que os quatro aparelhos trocam de mesa no mesmo instante, e é também o que faz um
   * cliente modificado não conseguir nada — a mensagem de quem não é anfitrião é recusada.
   */
  const definirTemaDaMesa = useCallback((theme: string) => {
    sessao.current?.enviar("CLIENT_SET_TABLE_THEME", { theme });
  }, []);

  /**
   * Troca o avatar do próprio assento, dentro da sala.
   *
   * Nada é aplicado localmente: manda a etiqueta e espera o estado sincronizado voltar. Aplicar
   * antes da confirmação daria, num empate de escolha, meio segundo em que o aparelho mostra um
   * bicho que a mesa não tem — e o desempate é justamente o caso que este caminho existe para
   * tratar. Se o servidor recusar, o estado nunca muda e a recusa chega pelo canal de erro.
   */
  const definirAvatar = useCallback((avatar: string) => {
    sessao.current?.enviar("CLIENT_SET_AVATAR", { avatar });
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

  /** Desfaz o voto. Mesma natureza do de cima: é um pedido, e quem decide é o servidor. */
  const cancelarProximaMao = useCallback(() => {
    partida.current?.cancelarProximaMao();
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
    playCard, chooseTrump, advanceHand, cancelarProximaMao, goHome,
    suspender,

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
    definirTemaDaMesa,
    definirAvatar,
  };
}

/**
 * A frase que o jogador lê quando a entrada falha. Exportada para poder ser testada: é a única
 * parte da falha que ele vê, e uma frase errada é um defeito tão real quanto um estado errado.
 */
export function mensagemDeFalha(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/not found|does not exist|404/i.test(m)) return "Sala não encontrada. Confira o código.";
  if (/full|4002/i.test(m)) return "Essa sala já tem quatro jogadores.";
  // Os dois lados do mesmo desencontro cabem numa frase só: o app e o servidor não falam a
  // mesma versão. Dizer "recarregue a página" seria um palpite — quando quem está velho é o
  // servidor, recarregar não muda nada, e mandar alguém repetir um gesto inútil é pior que
  // dizer que ainda não dá.
  if (/4001|protocol/i.test(m)) {
    return "Esta versão do jogo e o servidor não são compatíveis. Tente de novo mais tarde.";
  }
  // Servidor com identidade obrigatória, aplicativo que não sabe mandar credencial. Quase
  // sempre é uma versão anterior à fase de identidade — dizer "entre de novo" mandaria a
  // pessoa repetir um gesto que nunca vai funcionar. O que resolve é atualizar.
  if (/4005/.test(m)) {
    return "Atualize o jogo para continuar jogando online. Esta versão não consegue entrar neste servidor.";
  }
    // A mesma conta já está nesta mesa noutro aparelho. É a única falha desta lista em que o
  // jogador tem um gesto claro a fazer, então a frase diz qual é — cair no genérico aqui
  // deixaria alguém tentando de novo o que nunca vai dar certo.
  if (/4004/.test(m)) {
    return "Você já está nesta mesa em outro aparelho. Feche o jogo lá ou use Voltar para a partida.";
  }
  // Credencial recusada. NÃO se diz o motivo técnico: o jogador não pode fazer nada com
  // "assinatura inválida", e o detalhe só ajudaria quem estivesse testando forjar token.
  if (/4003/.test(m)) {
    return "Não foi possível confirmar sua identidade. Entre novamente para continuar.";
  }
  return "Não foi possível conectar ao servidor.";
}
