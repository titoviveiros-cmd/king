// KingRoom — a sala autoritativa: lobby (Fase 2) + partida real governada pelo motor (Fase 3).
//
// ═══════════════════ A REGRA DE SEGURANÇA CENTRAL DESTE ARQUIVO ═══════════════════
//
// O Colyseus sincroniza automaticamente — e SÓ — o que estiver dentro do `Schema` passado a
// `setState()`. Qualquer outro campo da classe é um campo TypeScript comum: fica no processo do
// servidor e **nunca** é serializado para ninguém.
//
// Por isso a separação é física, não disciplinar:
//
//   this.state      → EstadoPublicoDaSala (Schema) → sincronizado: roomId, assentos, ready
//   this.autoridade → MatchState lá dentro         → campo privado comum: NUNCA sai daqui
//
// O `MatchState` carrega as mãos completas e a semente (que sozinha reconstrói o baralho inteiro
// — ver `playerView.ts`). Ele não pode estar dentro de um `Schema` em hipótese alguma. A ÚNICA
// saída de estado é `autoridade.visaoDe(seat)` → `redactFor`, enviada individualmente a cada
// cliente. Nunca há broadcast de uma visão comum.
//
// A Room é transporte e fan-out; a validação vive em `match/autoridade.ts`, pura e sem Colyseus;
// e a REGRA vive só em `@king/engine`. Nada de KING é reimplementado aqui.
import { CloseCode, Room, ServerError, generateId, type Client } from "colyseus";
import { liberarCodigo, reservarCodigo } from "./codigos.js";
import { ArraySchema, schema } from "@colyseus/schema";
import type { Seat } from "@king/engine";
import { AutoridadeDaPartida, type Resultado } from "../match/autoridade.js";
import { TEMPOS } from "../match/tempos.js";
import {
  CODIGO, PROTOCOL_VERSION, difundir, enviar,
  type Causa, type DefinirPronto, type EscolherTrunfo,
  type FaseDoRelogio, type JogarCarta, type OpcoesDeEntrada, type ProntoParaProximaMao,
  type StatusDaSala, type TipoDeDecisao,
} from "../protocol/index.js";

/** KING é sempre 4 assentos. Não é configurável — é regra do jogo. */
export const ASSENTOS = 4;

/**
 * Um assento, do ponto de vista PÚBLICO. Nada aqui é secreto: quem está sentado, com que apelido,
 * conectado e pronto. É o que o lobby precisa desenhar — e é o teto do que a sala sincroniza.
 */
export const AssentoPublico = schema({
  seat: "number",
  playerId: "string",
  nick: "string",
  connected: "boolean",
  ready: "boolean",
  /** O servidor está agindo por este assento? Informação pública — a Mesa precisa mostrar. */
  assisted: "boolean",
}, "AssentoPublico");
export type AssentoPublico = InstanceType<typeof AssentoPublico>;

/**
 * Estado PÚBLICO da sala — o único objeto que o Colyseus sincroniza.
 * Contém exclusivamente informação de lobby. Sem `MatchState`, sem mãos, sem baralho, sem semente.
 */
export const EstadoPublicoDaSala = schema({
  protocolVersion: "number",
  /** Código curto de compartilhamento — é também o `roomId`. */
  roomCode: "string",
  roomId: "string",
  /** lobby | playing | finished. Vagas são derivadas de `seats` — não duplico estado. */
  status: "string",
  seats: [AssentoPublico],
}, "EstadoPublicoDaSala");
export type EstadoPublicoDaSala = InstanceType<typeof EstadoPublicoDaSala>;

/**
 * Dados por conexão. Ficam em `client.userData`, que o Colyseus documenta como **não
 * sincronizado** com o cliente — é memória do servidor sobre aquela conexão.
 */
export interface DadosDaConexao {
  playerId: string;
  sessionToken: string;
  seat: Seat;
}

type ClienteDoKing = Client<{ userData: DadosDaConexao }>;

const ASSENTO_VAZIO = "";

export class KingRoom extends Room<{
  state: EstadoPublicoDaSala;
  client: ClienteDoKing;
}> {
  /** O 5º cliente é recusado pelo próprio matchmaking do framework. */
  maxClients = ASSENTOS;

  /**
   * SERVER-ONLY. Guarda o `MatchState` autoritativo (mãos completas + semente) num campo privado
   * de classe — **fora** do `Schema`, portanto jamais sincronizado. A única saída de estado é
   * `visaoDe(seat)`, que passa por `redactFor`.
   * NUNCA mover para dentro de um `Schema`.
   */
  private autoridade = new AutoridadeDaPartida();

  /**
   * SERVER-ONLY. Sessão lógica por conexão, guardada FORA do `Schema`.
   *
   * O `sessionId` do socket não é identidade: uma queda produz socket novo. A identidade estável
   * é o `playerId`, e o vínculo é reconstruído no retorno através do `recoveryToken`. Este mapa
   * é o que permite devolver o MESMO assento a quem volta.
   */
  #sessoes = new Map<string, DadosDaConexao>();

  /**
   * UMA identidade, UMA conexão ativa.
   *
   * O framework aceita reconectar com a credencial mesmo que o socket anterior ainda esteja de pé
   * — e não derruba o antigo. Sem esta trava, dois sockets representariam o mesmo assento.
   * A política é "a conexão nova vence": ao voltar, o socket anterior é encerrado, e qualquer
   * evento vindo dele passa a ser ignorado (ver a guarda em `onDrop`/`onLeave`).
   */
  #conexaoAtiva = new Map<string, ClienteDoKing>();

  /**
   * RELÓGIO AUTORITATIVO. O servidor é a única fonte de tempo; o cliente só representa.
   *
   * `#pendencia` descreve a decisão que a partida está esperando AGORA. Todo timer agendado
   * carrega o `id` e a `versao` do momento do agendamento — se qualquer um dos dois mudar, o
   * callback é inerte. É assim que timer velho nunca age sobre estado novo.
   */
  #pendencia: {
    id: number; tipo: TipoDeDecisao; seat: Seat | null; versao: number; deadlineEm: number;
  } | null = null;
  #timers: { clear(): void }[] = [];
  #decisaoSeq = 0;
  /** Quando a mão corrente terminou — origem dos prazos de auto-ready. */
  #maoTerminouEm = 0;
  /** Sala sem nenhuma conexão viva: se ninguém voltar, ela morre. */
  #timerOrfa: { clear(): void } | null = null;

  /** Há partida em curso? Só o BOOLEANO — nunca o estado. */
  partidaIniciada(): boolean {
    return this.autoridade.iniciada;
  }

  /** Acesso SERVER-ONLY para os testes e, adiante, para os bots. Nunca serializado. */
  autoridadeDaPartida(): AutoridadeDaPartida {
    return this.autoridade;
  }

  onCreate(): void {
    // O CÓDIGO É O roomId: `joinById(codigo)` passa a funcionar nativamente, sem uma segunda
    // tabela de mapeamento para manter em sincronia. Substituir o roomId no onCreate é suportado.
    const codigo = reservarCodigo();
    this.roomId = codigo;
    this.setMetadata({ roomCode: codigo });

    const estado = new EstadoPublicoDaSala();
    estado.protocolVersion = PROTOCOL_VERSION;
    estado.roomCode = codigo;
    estado.roomId = this.roomId;
    estado.status = "lobby" satisfies StatusDaSala;
    estado.seats = new ArraySchema<AssentoPublico>();
    for (let s = 0; s < ASSENTOS; s++) estado.seats.push(assentoVazio(s));
    this.setState(estado);

    // READY / UNREADY. É o ÚNICO gatilho de início: quando os quatro assentos estão ocupados e
    // os quatro estão prontos, o servidor inicia. Nenhum jogador — nem o anfitrião — decide a
    // regra; ele só participa dela.
    this.onMessage("CLIENT_SET_READY", (client: ClienteDoKing, msg: DefinirPronto) => {
      const dados = client.userData;
      if (!dados) return this.#recusar(client, "", "NOT_IN_ROOM", "Você não está sentado");
      if (this.state.status !== "lobby") {
        return this.#recusar(client, "", "WRONG_PHASE", "A partida já começou");
      }
      this.state.seats[dados.seat].ready = !!msg?.ready;
      this.#iniciarSePronto();
    });

    // ── gameplay (Fase 3) ─────────────────────────────────────────────────────
    // Todo handler segue o MESMO roteiro: o assento sai da SESSÃO (nunca do payload), a
    // autoridade valida e aplica pelo motor, e o resultado vira ou fan-out de visões
    // individuais, ou uma recusa endereçada a quem tentou.

    this.onMessage("CLIENT_PLAY_CARD", (client: ClienteDoKing, msg: JogarCarta) => {
      const dados = client.userData;
      if (!dados) return;
      const r = this.autoridade.jogarCarta(dados.seat, dados.playerId, msg);
      this.#responder(client, msg?.actionId ?? "", r, "CARD_PLAYED");
    });

    this.onMessage("CLIENT_SELECT_TRUMP", (client: ClienteDoKing, msg: EscolherTrunfo) => {
      const dados = client.userData;
      if (!dados) return;
      const r = this.autoridade.escolherTrunfo(dados.seat, dados.playerId, msg);
      this.#responder(client, msg?.actionId ?? "", r, "TRUMP_SELECTED");
    });

    this.onMessage("CLIENT_READY_NEXT_HAND", (client: ClienteDoKing, msg: ProntoParaProximaMao) => {
      const dados = client.userData;
      if (!dados) return;
      const r = this.autoridade.marcarPronto(dados.seat, dados.playerId, msg);
      if (!r.ok) return this.#recusar(client, msg?.actionId ?? "", r.code, r.message);
      this.#refletirProntos(r.prontos);
      difundir(this, "READY_STATE", {
        handNumber: this.autoridade.estadoAutoritativo()?.hand?.handNumber ?? 0,
        ready: r.prontos,
      });
      this.#tentarAvancar();
    });
  }

  /**
   * Início automático: quatro assentos ocupados E quatro prontos. Idempotente por construção —
   * `autoridade.iniciar` recusa a segunda chamada, e o `status` deixa de ser "lobby" na primeira.
   */
  #iniciarSePronto(): void {
    if (this.state.status !== "lobby") return;
    if (this.state.seats.some((a) => a.playerId === ASSENTO_VAZIO || !a.ready)) return;

    const nomes = this.state.seats.map((a) => a.nick);
    // A SEMENTE é do servidor. Nunca do cliente nem das opções da sala: quem escolhe a semente
    // escolhe a distribuição.
    const semente = Math.floor(Math.random() * 0xffffffff) >>> 0;
    const r = this.autoridade.iniciar(nomes, generateId(), semente);
    if (!r.ok) return;
    this.state.status = "playing" satisfies StatusDaSala;
    // O ready do LOBBY cumpriu o papel dele. Entre mãos a mesma flag passa a significar
    // "pedi a próxima mão" — deixá-la ligada faria o consenso nascer satisfeito.
    for (const a of this.state.seats) a.ready = false;
    this.#publicar("MATCH_STARTED");
  }

  // ══════════════════ RELÓGIO AUTORITATIVO E ASSISTÊNCIA ══════════════════

  /** Assistência contínua: assento sem ninguém do outro lado e já assistido ao menos uma vez. */
  #assistido(seat: Seat): boolean {
    const a = this.state.seats[seat];
    return a.assisted && !a.connected;
  }

  /** Qual decisão a partida espera agora, e por quanto tempo. */
  #decisaoPendente(): { tipo: TipoDeDecisao; seat: Seat | null; prazo: number } | null {
    if (this.state.status !== "playing") return null;
    const m = this.autoridade.estadoAutoritativo();
    if (!m || m.finished || !m.hand) return null;
    const h = m.hand;

    if (h.awaitingTrumpFrom !== null) {
      const seat = h.awaitingTrumpFrom;
      return { tipo: "TRUMP", seat, prazo: this.#assistido(seat) ? TEMPOS.cortesiaDoBot : TEMPOS.trunfo };
    }
    if (h.handScores !== null) {
      // READY é de todos: o prazo é o do assento que estoura primeiro.
      const base = this.#maoTerminouEm || Date.now();
      let menor = Infinity;
      for (const a of this.state.seats) {
        if (a.playerId === ASSENTO_VAZIO || a.ready) continue;
        const limite = a.connected ? TEMPOS.autoReadyConectado : TEMPOS.autoReadyDesconectado;
        menor = Math.min(menor, base + Math.max(TEMPOS.pisoDoPlacar, limite) - Date.now());
      }
      if (menor === Infinity) return null; // todos prontos: quem cuida é #tentarAvancar
      return { tipo: "READY", seat: null, prazo: Math.max(0, menor) };
    }
    if (h.turn === null) return null;
    const seat = h.turn;
    if (this.#assistido(seat)) return { tipo: "PLAY", seat, prazo: TEMPOS.cortesiaDoBot };
    // primeira jogada da mão: 13 cartas novas e um contrato novo para ler
    const primeira = h.completedTricks.length === 0 && h.currentTrick.length === 0;
    return { tipo: "PLAY", seat, prazo: TEMPOS.turno + (primeira ? TEMPOS.primeiraJogadaExtra : 0) };
  }

  /**
   * Reagenda o relógio. Chamado depois de TODA mutação autoritativa — e SÓ aí.
   *
   * Nunca é chamado por conexão ou desconexão: é o que garante a decisão D3 (uma queda não
   * reinicia, não pausa e não estende o prazo). Trocar de socket não muda nada aqui.
   */
  #reagendar(): void {
    for (const t of this.#timers) t.clear();
    this.#timers = [];
    this.#pendencia = null;

    const d = this.#decisaoPendente();
    if (!d) return;

    const id = ++this.#decisaoSeq;
    const versao = this.autoridade.stateVersion;
    this.#pendencia = { id, tipo: d.tipo, seat: d.seat, versao, deadlineEm: Date.now() + d.prazo };

    const agendar = (ms: number, fn: () => void) => {
      if (ms < 0) return;
      this.#timers.push(this.clock.setTimeout(() => {
        // GUARDA DE STALENESS: mesma decisão E mesma versão, senão o timer é inerte.
        if (!this.#pendencia || this.#pendencia.id !== id) return;
        if (this.autoridade.stateVersion !== versao) return;
        fn();
      }, ms));
    };

    if (d.prazo > TEMPOS.aviso) agendar(d.prazo - TEMPOS.aviso, () => this.#anunciarRelogio("WARNING"));
    if (d.prazo > TEMPOS.critico) agendar(d.prazo - TEMPOS.critico, () => this.#anunciarRelogio("CRITICAL"));
    agendar(d.prazo, () => this.#expirou());

    this.#anunciarRelogio(
      d.prazo <= TEMPOS.critico ? "CRITICAL" : d.prazo <= TEMPOS.aviso ? "WARNING" : "NORMAL",
    );
  }

  #anunciarRelogio(fase: FaseDoRelogio): void {
    const p = this.#pendencia;
    if (!p) return;
    difundir(this, "TURN_CLOCK", {
      tipo: p.tipo,
      seat: p.seat,
      fase,
      restanteMs: Math.max(0, p.deadlineEm - Date.now()),
    });
  }

  /** O prazo estourou. O servidor age — pelo MESMO caminho de uma ação humana. */
  #expirou(): void {
    const p = this.#pendencia;
    if (!p) return;

    if (p.tipo === "READY") return this.#autoReady();

    const seat = p.seat as Seat;
    const assento = this.state.seats[seat];
    const playerId = assento.playerId;
    if (!playerId) return;

    const acao = "auto:" + seat + ":" + p.versao;
    let r: Resultado;

    if (p.tipo === "PLAY") {
      const cardId = this.autoridade.cartaAutomatica(seat);
      if (!cardId) return;
      r = this.autoridade.jogarCarta(seat, playerId, { actionId: acao, cardId });
    } else {
      const trump = this.autoridade.trunfoAutomatico(seat);
      if (!trump) return;
      r = this.autoridade.escolherTrunfo(seat, playerId, { actionId: acao, trump });
    }
    if (!r.ok) return;

    // Assistência CONTÍNUA só quando o jogador está ausente. Um estouro isolado de quem está
    // conectado NÃO o coloca em modo bot: na próxima decisão ele recebe controle e prazo cheio.
    if (!assento.connected) assento.assisted = true;

    difundir(this, "AUTO_ACTION", { seat, tipo: p.tipo, assistido: assento.assisted });
    this.#publicar(p.tipo === "PLAY" ? "CARD_PLAYED" : "TRUMP_SELECTED");
  }

  /** Marca pronto quem já passou do próprio prazo, respeitando o piso do Placar. */
  #autoReady(): void {
    const base = this.#maoTerminouEm || Date.now();
    const agora = Date.now();
    for (const a of this.state.seats) {
      if (a.playerId === ASSENTO_VAZIO || a.ready) continue;
      const limite = a.connected ? TEMPOS.autoReadyConectado : TEMPOS.autoReadyDesconectado;
      if (agora + 1 < base + Math.max(TEMPOS.pisoDoPlacar, limite)) continue;
      const seat = a.seat as Seat;
      const r = this.autoridade.marcarPronto(seat, a.playerId, {
        actionId: "auto:ready:" + seat + ":" + base,
      });
      if (r.ok) difundir(this, "AUTO_ACTION", { seat, tipo: "READY", assistido: !a.connected });
    }
    this.#refletirProntos(this.autoridade.prontos);
    difundir(this, "READY_STATE", {
      handNumber: this.autoridade.estadoAutoritativo()?.hand?.handNumber ?? 0,
      ready: this.autoridade.prontos,
    });
    if (!this.#tentarAvancar()) this.#reagendar();
  }

  /**
   * Avança a mão se houver consenso E o piso de leitura do Placar já tiver passado.
   * O piso vale mesmo com os quatro prontos de imediato: o Placar entre-mãos precisa ser visto.
   */
  #tentarAvancar(): boolean {
    if (this.autoridade.prontos.length < 4) return false;
    const falta = this.#maoTerminouEm + TEMPOS.pisoDoPlacar - Date.now();
    if (falta > 0) {
      const id = ++this.#decisaoSeq;
      const versao = this.autoridade.stateVersion;
      this.#pendencia = { id, tipo: "READY", seat: null, versao, deadlineEm: Date.now() + falta };
      this.#timers.push(this.clock.setTimeout(() => {
        if (!this.#pendencia || this.#pendencia.id !== id) return;
        if (this.autoridade.stateVersion !== versao) return;
        this.#tentarAvancar();
      }, falta));
      return true;
    }
    const r = this.autoridade.avancarMao();
    if (!r.ok) return false;
    for (const a of this.state.seats) a.ready = false; // mão nova, consenso zerado
    this.#publicar("HAND_ADVANCED");
    return true;
  }

  /** Espelha no estado público quem já pediu a próxima mão. */
  #refletirProntos(prontos: Seat[]): void {
    for (const a of this.state.seats) a.ready = prontos.includes(a.seat as Seat);
  }

  /**
   * Resultado de uma intenção.
   *
   * IDEMPOTÊNCIA — política adotada: uma `actionId` repetida **não reexecuta nada**, e o servidor
   * reenvia o estado corrente SÓ para quem repetiu. Escolhi reenviar em vez de ignorar em silêncio
   * porque a causa quase sempre é resposta perdida na rede: reenviar faz o cliente convergir; o
   * silêncio o deixaria travado esperando.
   */
  #responder(client: ClienteDoKing, actionId: string, r: Resultado, causa: Causa): void {
    if (!r.ok) return this.#recusar(client, actionId, r.code, r.message);
    if (r.duplicada) return this.#publicarPara(client, "RESYNC");
    this.#publicar(causa);
  }

  #recusar(client: ClienteDoKing, actionId: string, code: string, message: string): void {
    enviar(client, "ACTION_REJECTED", {
      actionId,
      code,
      message, // humano e curto: NUNCA stack trace, nunca informação de outro assento
      stateVersion: this.autoridade.stateVersion,
    });
  }

  /** Fan-out: cada cliente recebe a SUA visão redigida. Nunca uma visão comum difundida. */
  #publicar(causa: Causa): void {
    const m = this.autoridade.estadoAutoritativo();
    // o fim da partida é do MOTOR; a sala só reflete
    if (m?.finished && this.state.status !== "finished") {
      this.state.status = "finished" satisfies StatusDaSala;
    }
    // instante em que a mão acabou: origem do piso do Placar e dos prazos de auto-ready
    if (m?.hand && m.hand.handScores !== null) {
      if (this.#maoTerminouEm === 0) this.#maoTerminouEm = Date.now();
    } else {
      this.#maoTerminouEm = 0;
    }
    for (const c of this.clients) this.#publicarPara(c as ClienteDoKing, causa);
    this.#reagendar();
  }

  #publicarPara(client: ClienteDoKing, causa: Causa): void {
    const dados = client.userData;
    if (!dados) return;
    const view = this.autoridade.visaoDe(dados.seat);
    if (view === null) return;
    enviar(client, "STATE_UPDATE", {
      matchId: this.autoridade.matchId,
      stateVersion: this.autoridade.stateVersion,
      view,
      cause: causa,
    });
  }

  /**
   * Handshake + atribuição de assento.
   *
   * A atribuição é DETERMINÍSTICA: sempre o menor índice livre. Quatro entradas em sequência numa
   * sala vazia produzem 0, 1, 2, 3 — sem sorteio, sem duplicidade, e reprodutível em teste.
   * Quando alguém sai, o assento volta a ser o menor livre e é reaproveitado.
   */
  onJoin(client: ClienteDoKing, options?: Partial<OpcoesDeEntrada>): void {
    const versao = options?.protocolVersion ?? PROTOCOL_VERSION;
    if (versao !== PROTOCOL_VERSION) {
      throw new ServerError(
        CODIGO.PROTOCOLO_INCOMPATIVEL,
        `Protocolo incompatível: cliente ${versao}, servidor ${PROTOCOL_VERSION}`,
      );
    }

    const seat = this.primeiroAssentoLivre();
    if (seat === null) {
      // Rede de segurança: o `maxClients` já barra o 5º antes de chegar aqui.
      throw new ServerError(CODIGO.SALA_CHEIA, "A sala já tem quatro jogadores");
    }

    const dados: DadosDaConexao = {
      playerId: generateId(),
      sessionToken: generateId(),
      seat,
    };
    client.userData = dados;
    this.#sessoes.set(client.sessionId, dados);
    this.#conexaoAtiva.set(dados.playerId, client);
    this.#timerOrfa?.clear();
    this.#timerOrfa = null;

    const nick = options?.nick?.trim() || `Jogador ${seat + 1}`;
    const assento = this.state.seats[seat];
    assento.playerId = dados.playerId;
    assento.nick = nick;
    assento.connected = true;
    assento.ready = false;

    enviar(client, "SERVER_WELCOME", {
      protocolVersion: PROTOCOL_VERSION,
      roomCode: this.state.roomCode,
      roomId: this.roomId,
      you: {
        playerId: dados.playerId,
        sessionToken: dados.sessionToken,
        seat,
        recoveryToken: this.#credencial(client),
      },
    });
    difundir(this, "PLAYER_JOINED", { seat, playerId: dados.playerId, nick }, { except: client });
  }

  /**
   * Queda de conexão (ou saída). O Colyseus chama `onDrop` na perda; `onLeave` só quando a saída
   * é DEFINITIVA — ou seja, quando a janela de reconexão termina.
   *
   * Regra adotada:
   *   • saída CONSENTIDA no lobby  → libera o assento na hora (comportamento da Fase 5)
   *   • qualquer outra queda       → o assento é RESERVADO e ninguém mais pode ocupá-lo
   *
   * Sem timeout nesta fase: quem cai durante a partida mantém o assento até voltar. Abandono
   * definitivo e takeover por bot são fase própria.
   */
  async onDrop(client: ClienteDoKing, code?: number): Promise<void> {
    const dados = client.userData;
    if (!dados) return;
    // Socket obsoleto (já substituído por uma conexão mais nova): não mexe em nada.
    if (this.#conexaoAtiva.get(dados.playerId) !== client) return;

    if (code === CloseCode.CONSENTED && this.state.status === "lobby") {
      this.#liberarAssento(dados);
      return;
    }

    this.state.seats[dados.seat].connected = false;
    difundir(this, "PLAYER_CONNECTION", { seat: dados.seat, connected: false });
    this.#armarTimerDeSalaOrfa();
    // Uma queda NÃO reagenda PLAY nem TRUMP: o prazo é do ESTADO, não da conexão — é o que
    // impede transformar "cair" em pedir tempo (decisão D3). O relógio de READY é a exceção
    // legítima: quem sumiu passa a ter o prazo CURTO, o que encurta a espera dos outros.
    if (this.#pendencia?.tipo === "READY") this.#reagendar();

    const espera = this.allowReconnection(client, "manual");

    // No LOBBY o assento é reservado por um prazo: ninguém está no meio de uma partida, e um
    // assento preso para sempre travaria a sala dos amigos. Em PARTIDA a reserva não expira —
    // o assento continua sendo do humano até o fim (decisão D1).
    let prazo: { clear(): void } | null = null;
    if (this.state.status === "lobby") {
      prazo = this.clock.setTimeout(
        () => espera.reject(new Error("prazo de reserva do lobby esgotado")),
        TEMPOS.lobbyReservaAposQueda,
      );
    }

    try {
      await espera;
      prazo?.clear();
    } catch {
      prazo?.clear();
      this.#liberarAssento(dados);
      this.#reagendar();
    }
  }

  /** Sala sem nenhuma conexão viva morre — senão reconexões pendentes a manteriam para sempre. */
  #armarTimerDeSalaOrfa(): void {
    this.#timerOrfa?.clear();
    this.#timerOrfa = null;
    if (this.clients.length > 0) return;
    this.#timerOrfa = this.clock.setTimeout(() => {
      if (this.clients.length === 0) void this.disconnect();
    }, TEMPOS.salaOrfa);
  }

  /**
   * O mesmo jogador voltou, num socket NOVO. A identidade não vem do socket: vem da sessão que
   * o `recoveryToken` reabriu. O assento é RESTAURADO, nunca escolhido pelo cliente.
   */
  onReconnect(client: ClienteDoKing): void {
    const dados = this.#sessoes.get(client.sessionId);
    if (!dados) return; // sessão desconhecida: o framework já teria recusado o token

    // A conexão NOVA vence. A ORDEM importa: registrar a nova PRIMEIRO faz a guarda de
    // `onDrop`/`onLeave` já enxergar o socket anterior como obsoleto — se fosse ao contrário,
    // fechá-lo dispararia a liberação do próprio assento que estamos restaurando.
    const anterior = this.#conexaoAtiva.get(dados.playerId);
    this.#conexaoAtiva.set(dados.playerId, client);
    if (anterior && anterior !== client && this.clients.includes(anterior)) {
      anterior.leave(CloseCode.CONSENTED);
    }

    client.userData = dados;
    this.#timerOrfa?.clear();
    this.#timerOrfa = null;
    const assento = this.state.seats[dados.seat];
    assento.connected = true;
    // O humano voltou: a assistência contínua termina AQUI. A próxima decisão é dele, com prazo
    // cheio. O que o bot já fez continua valendo — o estado autoritativo vence, sem rollback.
    assento.assisted = false;
    difundir(this, "PLAYER_CONNECTION", { seat: dados.seat, connected: true });
    if (this.#pendencia?.tipo === "READY") this.#reagendar();

    enviar(client, "SERVER_WELCOME", {
      protocolVersion: PROTOCOL_VERSION,
      roomCode: this.state.roomCode,
      roomId: this.roomId,
      you: { ...dados, recoveryToken: this.#credencial(client) },
    });
    // estado ATUAL, nunca o de antes da queda
    this.#publicarPara(client, "RECONNECTED");
  }

  /** Só é chamado quando a saída é definitiva. */
  onLeave(client: ClienteDoKing): void {
    const dados = client.userData;
    if (!dados) return;
    if (this.#conexaoAtiva.get(dados.playerId) !== client) return; // socket obsoleto
    this.#liberarAssento(dados);
  }

  #liberarAssento(dados: DadosDaConexao): void {
    const assento = this.state.seats[dados.seat];
    if (assento.playerId !== dados.playerId) return; // o assento já é de outra pessoa
    const evento = { seat: dados.seat, playerId: dados.playerId, nick: assento.nick };
    // Campo a campo, NUNCA `Object.assign` de outra instância de Schema.
    assento.playerId = ASSENTO_VAZIO;
    assento.nick = "";
    assento.connected = false;
    assento.ready = false;
    for (const [sid, d] of this.#sessoes) if (d.playerId === dados.playerId) this.#sessoes.delete(sid);
    this.#conexaoAtiva.delete(dados.playerId);
    difundir(this, "PLAYER_LEFT", evento);
  }

  /** `roomCode:token` — o formato que o SDK espera em `reconnect()`. */
  #credencial(client: ClienteDoKing): string {
    return `${this.roomId}:${(client as unknown as { reconnectionToken: string }).reconnectionToken}`;
  }

  onDispose(): void {
    // a sala morreu: nada de estado autoritativo sobrevivendo ao processo
    this.autoridade = new AutoridadeDaPartida();
    liberarCodigo(this.state?.roomCode ?? "");
  }

  /** Menor índice livre, ou `null` se os quatro estiverem ocupados. */
  private primeiroAssentoLivre(): Seat | null {
    for (let s = 0; s < ASSENTOS; s++) {
      if (this.state.seats[s].playerId === ASSENTO_VAZIO) return s as Seat;
    }
    return null;
  }
}

function assentoVazio(seat: number): AssentoPublico {
  const a = new AssentoPublico();
  a.seat = seat;
  a.playerId = ASSENTO_VAZIO;
  a.nick = "";
  a.connected = false;
  a.ready = false;
  a.assisted = false;
  return a;
}
