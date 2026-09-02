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
import {
  AVATAR_PADRAO, AVATARES, TEMA_PADRAO, TEMAS_DA_MESA, avatarDeBot, avatarValido, nomeDeBotLivre,
} from "./identidade.js";
import { DURACAO_MS, RitmoSocial, mensagemValida } from "./social.js";
import { ArraySchema, schema } from "@colyseus/schema";
import { TOTAL_HANDS, type Seat } from "@king/engine";
import { AutoridadeDaPartida, type Resultado } from "../match/autoridade.js";
import { TEMPOS } from "../match/tempos.js";
import { pausaDaLeitura, respiroDaLeitura } from "../match/pausaDaVaza.js";
import { IdentidadeRecusada, verificadorEmUso, type IdentidadeVerificada } from "../auth/identidade.js";
import {
  CODIGO, PROTOCOL_VERSION, difundir, enviar,
  type Causa, type DefinirAvatar, type DefinirPronto, type DefinirTemaDaMesa, type EnviarMensagemSocial,
  type EscolherTrunfo,
  type FaseDoRelogio, type GerirBot, type JogarCarta, type OpcoesDeEntrada, type ProntoParaProximaMao,
  type StatusDaSala, type TipoDeDecisao,
} from "../protocol/index.js";

/** KING é sempre 4 assentos. Não é configurável — é regra do jogo. */
export const ASSENTOS = 4;

/**
 * Mínimo de HUMANOS numa mesa multiplayer privada.
 *
 * A mesa tem sempre 4 assentos, mas não exige 4 pessoas: bots completam. O piso é DOIS — com um
 * humano só, a sala privada não seria multiplayer, seria o modo local com passos extras. Quem
 * quer jogar sozinho contra bots usa "Jogar agora", que não passa por servidor nenhum.
 */
export const MIN_HUMANOS = 2;

/** Prefixo do identificador sintético de um assento de bot. Nunca colide com `generateId()`. */
const PREFIXO_BOT = "bot:";

/**
 * A dificuldade do bot. Só existe NORMAL, e é o que foi validado em partida humana completa.
 *
 * O tipo existe agora, com um valor só, porque acrescentar `"facil" | "dificil"` depois é
 * mudar uma linha — enquanto trocar um campo booleano por um enum quando já há salas no ar é
 * mudança de protocolo. Custa nada hoje e evita uma migração amanhã. **Nenhum algoritmo de
 * dificuldade foi escrito**: o Bot Normal segue exatamente como estava.
 */
export type DificuldadeDoBot = "normal";
export const DIFICULDADE_PADRAO: DificuldadeDoBot = "normal";

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
  /** Assento ocupado por BOT NORMAL. Público: o lobby e a Mesa mostram quem é bot. */
  bot: "boolean",
  /** Anfitrião da sala — o único que adiciona e remove bots. */
  host: "boolean",
  /**
   * Avatar do participante. Público de propósito: é identidade, e identidade tem de ser a MESMA
   * em todos os aparelhos. Sempre um valor do conjunto fechado, nunca texto livre do cliente.
   */
  avatar: "string",
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
  /**
   * Cosmético da mesa, escolhido pelo ANFITRIÃO e válido para a sala inteira.
   *
   * Está no estado sincronizado, e não no cliente, por uma razão de produto: todo mundo joga na
   * MESMA mesa. Se cada aparelho guardasse a própria preferência, duas pessoas na mesma partida
   * veriam mesas diferentes, e a mesa deixaria de ser um lugar comum.
   */
  tableTheme: "string",
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
  /**
   * O `playerId` acima veio de uma credencial verificada, ou foi sorteado para esta sala?
   *
   * Os dois são identificadores válidos e o jogo trata os dois igual — a diferença é o que
   * SOBREVIVE. O permanente é o mesmo em outra sala, outro dia, outro aparelho; o sorteado morre
   * com a sala. Guardar a distinção aqui é o que vai permitir, quando o progresso existir, saber
   * de quem gravar e de quem não há o que gravar.
   */
  identidadePermanente: boolean;
}

type ClienteDoKing = Client<{ userData: DadosDaConexao }>;

/**
 * Lê `client.auth` como identidade — ou como ausência dela.
 *
 * `onAuth` devolve `true` quando aprova sem saber de quem se trata, e um objeto quando sabe. Ler
 * pela FORMA (tem `playerId`?), e não pela verdade do valor, é o que impede o `true` de virar
 * uma identidade vazia com `playerId` indefinido.
 */
function identidadeDe(auth: unknown): IdentidadeVerificada | null {
  if (!auth || typeof auth !== "object") return null;
  const c = auth as Partial<IdentidadeVerificada>;
  return typeof c.playerId === "string" && c.playerId !== "" ? (c as IdentidadeVerificada) : null;
}

const ASSENTO_VAZIO = "";
/**
 * O avatar de quem ainda não escolheu.
 *
 * String vazia porque é a ausência de escolha, e não uma escolha a mais: qualquer etiqueta real
 * aqui apareceria na tela como um bicho selecionado, que é exatamente a mentira que se quer
 * evitar. O cliente reconhece o vazio e desenha um estado neutro.
 */
const AVATAR_PENDENTE = "";

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

  /**
   * ══ A APRESENTAÇÃO DA VAZA QUE FECHOU ══
   *
   * Quando uma vaza fecha, a mesa PARA para todo mundo ler o que aconteceu — 1150ms numa vaza
   * comum, 3400ms no Rei de Copas. O servidor não para junto, e é isso que estava certo: parar
   * somaria espera sobre uma espera que o jogador já vê.
   *
   * O que estava errado era COBRAR esse tempo do próximo jogador. O prazo dele começava com a
   * mesa parada, e ele recebia 23s de um prazo de 25s sem ter feito nada.
   *
   * Estes três campos são a memória do que a apresentação ainda deve: quando a vaza fechou,
   * quanto tempo a mesa fica parada, e quantos passos o servidor produziu DURANTE a parada —
   * cada um deles ainda vai entrar na mesa um de cada vez, ao ritmo da cadência.
   */
  #vazaFechouEm: number | null = null;
  #pausaDaVazaMs = 0;
  #represados = 0;
  /** Quantas vazas o motor já fechou nesta mão. A SUBIDA é o gatilho. */
  #vazasFechadas = 0;
  /** Quando a mão corrente COMEÇOU, e qual é ela — origem do respiro da última mão. */
  #maoComecouEm = 0;
  #maoEmCurso = 0;
  /** Sala sem nenhuma conexão viva: se ninguém voltar, ela morre. */
  #timerOrfa: { clear(): void } | null = null;

  /**
   * ANFITRIÃO — o `playerId` de quem manda nos bots. É o primeiro humano a entrar.
   *
   * Ele NÃO tem autoridade sobre a partida: não inicia, não decide regra, não escolhe semente.
   * A única coisa que lhe pertence é a composição da mesa antes do começo, e mesmo isso o
   * servidor confere a cada pedido.
   */
  #host: string | null = null;
  /** Ritmo das mensagens sociais, por assento. Conferido AQUI — no cliente seria sugestão. */
  readonly #ritmoSocial = new RitmoSocial();

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
    estado.tableTheme = TEMA_PADRAO;
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
      // PRONTO EXIGE IDENTIDADE. Ficar pronto é dizer "pode começar por mim", e quem ainda não
      // escolheu o próprio bicho não tem o que dizer. Esconder o botão no cliente é apresentação;
      // recusar aqui é a regra.
      if (this.state.seats[dados.seat].avatar === AVATAR_PENDENTE) {
        return this.#recusar(client, "", "AVATAR_PENDING", "Escolha um avatar para continuar");
      }
      this.state.seats[dados.seat].ready = !!msg?.ready;
      this.#iniciarSePronto();
    });

    // ── composição da mesa: só o ANFITRIÃO, e só antes de começar ────────────────────────────
    // A verificação é do servidor. Esconder o botão de quem não é anfitrião é apresentação;
    // recusar a mensagem é autorização. Um cliente modificado manda a mensagem do mesmo jeito.

    this.onMessage("CLIENT_ADD_BOT", (client: ClienteDoKing, msg: GerirBot) => {
      const erro = this.#autorizarGestaoDeBot(client, msg);
      if (erro) return;
      const seat = msg.seat as Seat;
      const a = this.state.seats[seat];
      if (a.playerId !== ASSENTO_VAZIO) {
        return this.#recusar(client, "", "SEAT_TAKEN", "Esse lugar já está ocupado");
      }
      a.playerId = PREFIXO_BOT + seat;
      // O NOME É DO SERVIDOR. Sorteado no frontend, cada cliente veria um nome diferente para o
      // mesmo bot. Aqui ele entra no estado sincronizado e chega igual a todo mundo.
      a.nick = nomeDeBotLivre(this.state.seats.map((x) => x.nick).filter(Boolean));
      a.avatar = avatarDeBot(seat, this.state.seats.filter((x) => x.playerId !== ASSENTO_VAZIO).map((x) => x.avatar));
      a.connected = true;
      a.bot = true;
      // Bot não clica em "estou pronto": ele já nasce pronto. Ver a regra de início.
      a.ready = true;
      a.assisted = false;
      difundir(this, "PLAYER_JOINED", { seat, playerId: a.playerId, nick: a.nick });
      this.#iniciarSePronto();
    });

    this.onMessage("CLIENT_REMOVE_BOT", (client: ClienteDoKing, msg: GerirBot) => {
      const erro = this.#autorizarGestaoDeBot(client, msg);
      if (erro) return;
      const seat = msg.seat as Seat;
      const a = this.state.seats[seat];
      if (!a.bot) {
        return this.#recusar(client, "", "NOT_A_BOT", "Esse lugar não é de um bot");
      }
      const evento = { seat, playerId: a.playerId, nick: a.nick };
      this.#esvaziarAssento(a);
      difundir(this, "PLAYER_LEFT", evento);
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

    // ── cosmético da sala ─────────────────────────────────────────────────────────────────────
    //
    // Autorização é do SERVIDOR. Esconder o seletor de quem não é anfitrião é apresentação; recusar
    // a mensagem é autorização, e um cliente modificado manda a mensagem do mesmo jeito.
    //
    // Vale em qualquer fase, inclusive com a partida em curso: é cosmético, não toca no estado da
    // partida, não mexe no relógio e não gera ação de gameplay. Trocar a cor da mesa no meio de uma
    // mão é inofensivo, e proibir seria uma restrição sem razão.
    this.onMessage("CLIENT_SET_TABLE_THEME", (client: ClienteDoKing, msg: DefinirTemaDaMesa) => {
      const dados = client.userData;
      if (!dados) return this.#recusar(client, "", "NOT_IN_ROOM", "Você não está sentado");
      if (!this.state.seats[dados.seat]?.host) {
        return this.#recusar(client, "", "NOT_HOST", "Só o anfitrião escolhe a mesa");
      }
      const tema = msg?.theme;
      if (!(TEMAS_DA_MESA as readonly string[]).includes(tema ?? "")) {
        return this.#recusar(client, "", "INVALID_PAYLOAD", "Tema desconhecido");
      }
      this.state.tableTheme = tema as string;
    });

    // ── avatar: um por mesa ───────────────────────────────────────────────────────────────────
    //
    // A regra é do SERVIDOR, e não podia ser de outro lugar. O lobby de cada aparelho desabilita o
    // que já está em uso, mas ele desabilita com a foto da sala que TEM — e entre a foto e a
    // mensagem chegando aqui cabe a escolha de outra pessoa. A checagem do cliente evita o toque
    // inútil; esta evita a mesa com dois unicórnios.
    //
    // Recusa em vez de substituir. Se o avatar pedido não está disponível, o assento fica com o que
    // já tinha e quem pediu recebe `AVATAR_TAKEN` — trocar em silêncio por outro bicho responderia
    // uma pergunta que ninguém fez.
    this.onMessage("CLIENT_SET_AVATAR", (client: ClienteDoKing, msg: DefinirAvatar) => {
      const dados = client.userData;
      if (!dados) return this.#recusar(client, "", "NOT_IN_ROOM", "Você não está sentado");
      if (this.state.status !== "lobby") {
        return this.#recusar(client, "", "WRONG_PHASE", "A partida já começou");
      }
      const pedido = msg?.avatar;
      if (!(AVATARES as readonly string[]).includes(pedido ?? "")) {
        return this.#recusar(client, "", "INVALID_PAYLOAD", "Avatar desconhecido");
      }
      const assento = this.state.seats[dados.seat];
      if (assento.avatar === pedido) return; // já é o dele; nada a fazer e nada a recusar
      if (this.#avataresEmUso(dados.seat).includes(pedido as string)) {
        return this.#recusar(client, "", "AVATAR_TAKEN", "Esse avatar já está em uso na mesa");
      }
      assento.avatar = pedido as string;
    });

    // ── mensagens sociais ─────────────────────────────────────────────────────────────────────
    //
    // O que este bloco NÃO faz é a parte importante: não toca no estado da partida, não mexe no
    // relógio da decisão, não adia o timeout e não gera ação de gameplay nenhuma. Uma mensagem
    // social é ruído amistoso difundido por cima de um jogo que continua exatamente igual.

    this.onMessage("CLIENT_SOCIAL_MESSAGE", (client: ClienteDoKing, msg: EnviarMensagemSocial) => {
      const dados = client.userData;
      if (!dados) return this.#recusar(client, "", "NOT_IN_ROOM", "Você não está sentado");

      // A ORDEM importa: "isto é uma mensagem?" antes de "é hora de falar?".
      //
      // Etiqueta desconhecida é RECUSADA, não substituída por um padrão — avatar tem padrão
      // porque todo assento precisa de um; mensagem não: quem mandou lixo simplesmente não
      // falou. E validar primeiro dá o diagnóstico certo em qualquer fase, o que é justamente
      // o que permite ao verificador de implantação provar, do lobby, que o conjunto fechado
      // existe naquele servidor.
      const id = msg?.messageId;
      if (!mensagemValida(id)) {
        return this.#recusar(client, "", "INVALID_PAYLOAD", "Mensagem desconhecida");
      }
      if (this.state.status === "lobby") {
        return this.#recusar(client, "", "WRONG_PHASE", "A partida ainda não começou");
      }
      const veredicto = this.#ritmoSocial.permitir(dados.seat, Date.now());
      if (!veredicto.ok) return this.#recusar(client, "", veredicto.code, veredicto.message);

      difundir(this, "SOCIAL_MESSAGE", { seat: dados.seat, messageId: id, duracaoMs: DURACAO_MS });
    });
  }

  /**
   * Os avatares dos OUTROS assentos ocupados — humanos e bots.
   *
   * Bots entram na conta de propósito: `avatarDeBot` já desviava de colisão na hora de nascer, e
   * seria estranho que um humano pudesse depois assumir o bicho do bot ao lado. A mesa tem quatro
   * lugares e o catálogo tem oito bichos; não falta espaço para todo mundo ser diferente.
   */
  #avataresEmUso(exceto: Seat): string[] {
    return this.state.seats
      .filter((a, s) => s !== exceto && a.playerId !== ASSENTO_VAZIO)
      .map((a) => a.avatar);
  }

/**
   * Autorização da gestão de bots. Devolve `true` se RECUSOU (e já respondeu ao cliente).
   */
  #autorizarGestaoDeBot(client: ClienteDoKing, msg: GerirBot): boolean {
    const dados = client.userData;
    if (!dados) { this.#recusar(client, "", "NOT_IN_ROOM", "Você não está sentado"); return true; }
    if (this.state.status !== "lobby") {
      this.#recusar(client, "", "WRONG_PHASE", "A partida já começou");
      return true;
    }
    if (dados.playerId !== this.#host) {
      this.#recusar(client, "", "NOT_HOST", "Só quem criou a sala pode mexer nos bots");
      return true;
    }
    const seat = msg?.seat;
    if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 0 || seat >= ASSENTOS) {
      this.#recusar(client, "", "INVALID_PAYLOAD", "Assento inválido");
      return true;
    }
    return false;
  }

  /** Quantos assentos são de gente de verdade. */
  #humanos(): number {
    return this.state.seats.filter((a) => a.playerId !== ASSENTO_VAZIO && !a.bot).length;
  }

  /**
   * Início automático. A regra oficial da mesa:
   *
   *   • os QUATRO assentos ocupados (por humano ou bot);
   *   • pelo menos DOIS humanos;
   *   • todos os HUMANOS prontos — bots não marcam nada, já nascem prontos.
   *
   * Idempotente por construção: `autoridade.iniciar` recusa a segunda chamada, e o `status`
   * deixa de ser "lobby" na primeira.
   */
  /**
   * Alguém sentado, humano, e ainda sem avatar confirmado.
   *
   * Bot nunca entra nesta conta: o avatar dele é do servidor e nasce resolvido.
   */
  #identidadePendente(): boolean {
    return this.state.seats.some(
      (a) => a.playerId !== ASSENTO_VAZIO && !a.bot && a.avatar === AVATAR_PENDENTE,
    );
  }

  #iniciarSePronto(): void {
    if (this.state.status !== "lobby") return;
    if (this.state.seats.some((a) => a.playerId === ASSENTO_VAZIO)) return;
    if (this.#humanos() < MIN_HUMANOS) return;
    if (this.state.seats.some((a) => !a.bot && !a.ready)) return;
    // NINGUÉM COMEÇA COM UM ASSENTO SEM DONO DE VERDADE. A partida distribui cartas para quatro
    // identidades; começar com uma delas em branco produziria um jogador que a mesa não sabe
    // nomear. O anfitrião também não escapa disso: a regra é do servidor, não do botão.
    if (this.#identidadePendente()) return;

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

  /**
   * O servidor decide por este assento AGORA?
   *
   * Dois casos, com naturezas diferentes e o mesmo tratamento no relógio:
   *   • BOT — decide sempre, por definição;
   *   • humano ausente em assistência contínua — decide enquanto ele não voltar.
   *
   * Nos dois, o prazo é a cortesia curta em vez do prazo humano: ninguém precisa esperar 25s
   * por quem não vai pensar. E os dois passam pelo MESMO caminho de uma jogada humana, com a
   * mesma visão redigida — não existe bot privilegiado.
   */
  #assistido(seat: Seat): boolean {
    const a = this.state.seats[seat];
    return a.bot || (a.assisted && !a.connected);
  }

  /**
   * O RESPIRO DA ABERTURA DA ÚLTIMA MÃO — quanto ainda falta dele, em ms.
   *
   * A décima mão começa e o cliente cobre a Mesa com o anúncio "ÚLTIMA MÃO": durante ele nada da
   * mão nova é apresentado, e nada pode ser jogado. O servidor não sabe do anúncio; sabe que a
   * primeira decisão da última mão cai numa janela em que ninguém está olhando para a mesa.
   *
   * Sem isto, os dois lados perdem: quem escolhe o trunfo perderia do próprio prazo o tempo do
   * anúncio, e um bot escolheria por trás dele (cortesia de 900ms contra ~3,7s de animação) — a
   * mesa reapareceria com a mão já em curso. Nenhum dos dois se conserta no cliente, porque o
   * prazo é autoritativo e o bot é o servidor.
   *
   * DECAI SOZINHO, medido a partir do início da mão: não é um bônus somado a cada decisão. Se a
   * escolha do trunfo consumir o respiro inteiro, a primeira jogada não ganha nada — o total
   * nunca passa da duração do anúncio, que é o limite pedido.
   */
  #respiroDaAbertura(handNumber: number): number {
    if (handNumber !== TOTAL_HANDS || this.#maoComecouEm === 0) return 0;
    return Math.max(0, this.#maoComecouEm + TEMPOS.aberturaDaUltimaMao - Date.now());
  }

  /** Qual decisão a partida espera agora, e por quanto tempo. */
  #decisaoPendente(): { tipo: TipoDeDecisao; seat: Seat | null; prazo: number } | null {
    if (this.state.status !== "playing") return null;
    const m = this.autoridade.estadoAutoritativo();
    if (!m || m.finished || !m.hand) return null;
    const h = m.hand;
    const respiro = this.#respiroDaAbertura(h.handNumber);

    if (h.awaitingTrumpFrom !== null) {
      const seat = h.awaitingTrumpFrom;
      const base = this.#assistido(seat) ? TEMPOS.cortesiaDoBot : TEMPOS.trunfo;
      return { tipo: "TRUMP", seat, prazo: base + respiro };
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
    if (this.#assistido(seat)) return { tipo: "PLAY", seat, prazo: TEMPOS.cortesiaDoBot + respiro };
    // primeira jogada da mão: 13 cartas novas e um contrato novo para ler
    const primeira = h.completedTricks.length === 0 && h.currentTrick.length === 0;
    /**
     * O RESPIRO DA LEITURA É SÓ PARA HUMANO, e isso não é exceção: o bot não olha para a mesa.
     * Dar respiro a ele apenas atrasaria a próxima carta, deixando o jogo mais lento sem
     * devolver tempo a ninguém.
     */
    const leitura = respiroDaLeitura(
      Date.now(), this.#vazaFechouEm, this.#pausaDaVazaMs, this.#represados,
    );
    return {
      tipo: "PLAY", seat,
      prazo: TEMPOS.turno + (primeira ? TEMPOS.primeiraJogadaExtra : 0) + respiro + leitura,
    };
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
    // instante em que a mão COMEÇOU: origem do respiro de abertura da última mão. Marcado pela
    // TROCA do número da mão, e não pela ausência de `handScores` — senão cada publicação da
    // mesma mão reiniciaria a contagem e o respiro nunca acabaria.
    if (m?.hand && m.hand.handNumber !== this.#maoEmCurso) {
      this.#maoEmCurso = m.hand.handNumber;
      this.#maoComecouEm = Date.now();
    }
    // A VAZA QUE FECHOU: origem do respiro de leitura. O gatilho é a SUBIDA do número de vazas
    // completas — não a causa da publicação, que se repete para os quatro clientes.
    const fechadas = m?.hand?.completedTricks.length ?? 0;
    if (fechadas > this.#vazasFechadas) {
      this.#vazasFechadas = fechadas;
      this.#vazaFechouEm = Date.now();
      this.#pausaDaVazaMs = pausaDaLeitura(m);
      // A carta que FECHOU a vaza é apresentada antes da pausa: ela não está represada.
      this.#represados = 0;
    } else if (fechadas < this.#vazasFechadas) {
      // Mão nova: não há dívida herdada da mão anterior.
      this.#vazasFechadas = fechadas;
      this.#vazaFechouEm = null;
      this.#pausaDaVazaMs = 0;
      this.#represados = 0;
    } else if (
      this.#vazaFechouEm !== null && (causa === "CARD_PLAYED" || causa === "TRUMP_SELECTED")
      && Date.now() < this.#vazaFechouEm + this.#pausaDaVazaMs
    ) {
      // Produzido ENQUANTO a mesa estava parada: ainda vai precisar do seu instante para entrar.
      this.#represados++;
    }
    for (const c of this.clients) this.#publicarPara(c as ClienteDoKing, causa);
    this.#reagendar();
    // A mão pode ter acabado agora: os bots entram no consenso na hora, sem esperar prazo.
    if (this.#prontosDosBots()) this.#tentarAvancar();
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
  /**
   * A CREDENCIAL É CONFERIDA ANTES DE ALGUÉM SENTAR.
   *
   * Vive aqui, e não no `onJoin`, por uma razão concreta: verificar assinatura exige buscar a
   * chave pública do emissor, que é assíncrono, e `onJoin` é síncrono. `onAuth` é o único ponto do
   * ciclo em que dá para recusar alguém ANTES de existir assento, estado ou difusão.
   *
   * DOIS MODOS, E O AMBIENTE DECIDE QUAL — não o cliente.
   *
   *   MODO A — sem `SUPABASE_URL`: `true` para todo mundo. É o KING publicado hoje, com
   *            identidade sorteada por sala. Token enviado por um cliente novo é IGNORADO, e
   *            não recusado: não há com o que conferi-lo, e recusar por precaução trancaria a
   *            porta durante a janela em que o servidor novo já está no ar e o provedor ainda
   *            não foi configurado.
   *
   *   MODO B — com `SUPABASE_URL`: credencial válida é OBRIGATÓRIA para humano. Sem token
   *            (4005) e token que não confere (4003) são as duas recusas, com códigos
   *            separados porque pedem frases diferentes ao jogador.
   *
   * POR QUE O MODO B NÃO ADMITE MEIO-TERMO. A primeira versão desta fase deixava entrar sem
   * credencial mesmo com provedor configurado. Parecia gentileza e era um buraco: bastava não
   * mandar token para jogar como ninguém num servidor que anuncia identidade permanente, e
   * duas classes de jogador conviveriam na mesma mesa sem nada no protocolo dizendo isso.
   * Degradar em silêncio é pior que recusar: quem mandou credencial adulterada entraria assim
   * mesmo, como outra pessoa, sem nunca saber — nem o dono da conta saberia que alguém tentou.
   *
   * `true`, E NÃO `null`, NO MODO A. No Colyseus, `onAuth` que devolve valor falsy REPROVA a
   * entrada. A primeira versão devolvia `null` e derrubou 129 testes de sala de uma vez, todos
   * falando de prazos e vazas e nenhum dizendo "a porta está trancada". O valor de retorno
   * significa "pode entrar", não "quem é".
   *
   * A RECONEXÃO NÃO PASSA POR AQUI. Em `@colyseus/core`, o ramo de retorno por `recoveryToken`
   * é anterior à chamada de `onAuth` (ver `Room.ts`, `_onJoin`). É o que faz o MODO B não
   * quebrar quem caiu — e é também o que obriga a tratar o `recoveryToken` pelo que ele é: uma
   * credencial ao portador com alcance de UMA sala, que não prova identidade fora dela.
   */
  async onAuth(
    _client: ClienteDoKing, options?: Partial<OpcoesDeEntrada>,
  ): Promise<IdentidadeVerificada | true> {
    const verificador = verificadorEmUso();
    if (!verificador) return true;
    try {
      // `verificar(undefined)` já recusa com o motivo `sem-token`: a ausência de credencial é
      // uma recusa como outra qualquer, e não um caso especial tratado antes da verificação.
      return await verificador.verificar(options?.accessToken);
    } catch (e) {
      const motivo = e instanceof IdentidadeRecusada ? e.motivo : "assinatura-invalida";
      // O MOTIVO VAI, O TOKEN NÃO. Registrar a credencial inteira num log a transformaria numa
      // chave em texto claro dentro de um arquivo que muita gente lê.
      throw new ServerError(
        motivo === "sem-token" ? CODIGO.CREDENCIAL_AUSENTE : CODIGO.IDENTIDADE_RECUSADA,
        `Identidade recusada: ${motivo}`,
      );
    }
  }

  onJoin(client: ClienteDoKing, options?: Partial<OpcoesDeEntrada>): void {
    const versao = options?.protocolVersion ?? PROTOCOL_VERSION;
    if (versao !== PROTOCOL_VERSION) {
      throw new ServerError(
        CODIGO.PROTOCOLO_INCOMPATIVEL,
        `Protocolo incompatível: cliente ${versao}, servidor ${PROTOCOL_VERSION}`,
      );
    }

    const identidade = identidadeDe(client.auth);

    /**
     * UMA IDENTIDADE PERMANENTE, UM ASSENTO POR MESA.
     *
     * A trava vale só para identidade verificada, e isso não é uma exceção: para quem entra sem
     * credencial o `playerId` é sorteado e a colisão é impossível, então a verificação seria um
     * `if` que nunca dá verdadeiro. Guardar na identidade permanente deixa escrito que o risco
     * nasceu com ela.
     */
    if (identidade && this.#conexaoAtiva.has(identidade.playerId)) {
      throw new ServerError(
        CODIGO.JA_ESTA_NA_MESA,
        "Esta conta já está nesta mesa — para continuar noutro aparelho, reconecte.",
      );
    }

    const seat = this.primeiroAssentoLivre();
    if (seat === null) {
      // Rede de segurança: o `maxClients` já barra o 5º antes de chegar aqui.
      throw new ServerError(CODIGO.SALA_CHEIA, "A sala já tem quatro jogadores");
    }

    /**
     * O `playerId` VEM DO CLAIM VERIFICADO, ou é sorteado.
     *
     * `client.auth` é o que o `onAuth` acima devolveu — já conferido contra a chave pública do
     * emissor. Nunca é algo que o cliente escreveu: a única coisa que ele envia é o token, e um
     * token adulterado nem chega aqui.
     *
     * Sem identidade verificada, cai no comportamento de sempre: um identificador aleatório que
     * vale enquanto a sala existir. É o KING que está no ar hoje, e ele continua funcionando.
     */
    const dados: DadosDaConexao = {
      playerId: identidade?.playerId ?? generateId(),
      sessionToken: generateId(),
      seat,
      identidadePermanente: identidade !== null,
    };
    client.userData = dados;
    this.#sessoes.set(client.sessionId, dados);
    this.#conexaoAtiva.set(dados.playerId, client);
    this.#timerOrfa?.clear();
    this.#timerOrfa = null;

    // O PRIMEIRO humano a entrar é o anfitrião. Se o anfitrião anterior saiu, o assento fica
    // órfão de dono e o próximo a chegar assume — senão ninguém poderia mexer nos bots.
    if (this.#host === null) this.#host = dados.playerId;

    const nick = options?.nick?.trim() || `Jogador ${seat + 1}`;
    const assento = this.state.seats[seat];
    assento.playerId = dados.playerId;
    assento.nick = nick;
    assento.connected = true;
    assento.ready = false;
    assento.bot = false;
    assento.host = dados.playerId === this.#host;
    // O AVATAR PEDIDO — OU NENHUM.
    //
    // Antes, um pedido ocupado virava "o próximo livre" e a pessoa entrava com um bicho que não
    // escolheu. Parecia gentil e não era: quem salvou o Sapo no aparelho entrava como Coruja sem
    // ter pedido, e a única forma de perceber era reparar no próprio card. O avatar é identidade,
    // e identidade não se atribui em silêncio.
    //
    // Agora, ocupado significa PENDENTE: o assento fica com `AVATAR_PENDENTE` (string vazia), o
    // cliente é avisado, e a pessoa escolhe conscientemente. Enquanto isso ela senta, vê a sala e
    // conversa — só não fica pronta nem deixa a partida começar. Ver `#identidadePendente`.
    const pedido = avatarValido(options?.avatar);
    const ocupado = this.#avataresEmUso(seat).includes(pedido);
    assento.avatar = ocupado ? AVATAR_PENDENTE : pedido;

    enviar(client, "SERVER_WELCOME", {
      protocolVersion: PROTOCOL_VERSION,
      roomCode: this.state.roomCode,
      roomId: this.roomId,
      you: {
        playerId: dados.playerId,
        sessionToken: dados.sessionToken,
        seat,
        recoveryToken: this.#credencial(client),
        identidadePermanente: dados.identidadePermanente,
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
    this.#esvaziarAssento(assento);
    for (const [sid, d] of this.#sessoes) if (d.playerId === dados.playerId) this.#sessoes.delete(sid);
    this.#conexaoAtiva.delete(dados.playerId);
    if (this.#host === dados.playerId) this.#passarAnfitriao();
    difundir(this, "PLAYER_LEFT", evento);
  }

  /** Zera um assento. Campo a campo, NUNCA `Object.assign` de outra instância de Schema. */
  #esvaziarAssento(assento: AssentoPublico): void {
    assento.playerId = ASSENTO_VAZIO;
    assento.nick = "";
    assento.connected = false;
    assento.ready = false;
    assento.assisted = false;
    assento.bot = false;
    assento.host = false;
    assento.avatar = AVATAR_PADRAO;
    // o histórico de mensagens não pode punir quem sentar aqui depois
    this.#ritmoSocial.esquecer(assento.seat);
  }

  /**
   * O anfitrião saiu. Passa o posto ao próximo HUMANO sentado — sem isso, uma sala com bots
   * ficaria sem ninguém autorizado a mexer na composição, e travada para sempre no lobby.
   */
  #passarAnfitriao(): void {
    this.#host = null;
    for (const a of this.state.seats) a.host = false;
    const proximo = this.state.seats.find((a) => a.playerId !== ASSENTO_VAZIO && !a.bot);
    if (!proximo) return;
    this.#host = proximo.playerId;
    proximo.host = true;
  }

  /**
   * Bots não pedem a próxima mão — eles já estão prontos assim que a mão acaba.
   * Devolve `true` se marcou alguém, para quem chamou saber se vale tentar avançar.
   */
  #prontosDosBots(): boolean {
    const m = this.autoridade.estadoAutoritativo();
    if (!m?.hand || m.hand.handScores === null) return false;
    let mudou = false;
    for (const a of this.state.seats) {
      if (!a.bot || a.ready) continue;
      const r = this.autoridade.marcarPronto(a.seat as Seat, a.playerId, {
        actionId: "bot:ready:" + a.seat + ":" + m.hand.handNumber,
      });
      if (r.ok) mudou = true;
    }
    if (!mudou) return false;
    this.#refletirProntos(this.autoridade.prontos);
    difundir(this, "READY_STATE", { handNumber: m.hand.handNumber, ready: this.autoridade.prontos });
    return true;
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
  a.bot = false;
  a.host = false;
  a.avatar = AVATAR_PADRAO;
  return a;
}
