// VERIFICAÇÃO DE IMPLANTAÇÃO — fala com o servidor que está NO AR e confere o contrato.
//
// Diferente do smoke: o smoke prova que o artefato compilado SOBE. Este prova que o processo
// que está atendendo agora é a versão certa — conectando de verdade, criando uma sala e olhando
// o que o servidor devolve. É o portão do deploy: se qualquer verificação falhar, o script sai
// com código diferente de zero e o bloco de deploy faz rollback.
//
//   node scripts/verificar-implantacao.mjs [ws://127.0.0.1:2567] [--modo=legacy|permanent]
//
// Roda pelo LOOPBACK de propósito: prova o processo, não a cadeia TLS/Nginx (que tem gate
// próprio). Nada aqui escreve no disco nem deixa sala pendurada — as salas criadas são
// abandonadas ao sair e o Colyseus as recolhe.
//
// ══ OS DOIS MODOS — e o modo é DECLARADO por quem chama, nunca deduzido do servidor ══
//
// Deduzir o modo pelo comportamento faria um servidor rebaixado em silêncio para legacy passar
// como "legacy aprovado". Quem chama diz o que o processo DEVERIA ser, e o script cobra isso.
//
//   legacy (padrão) — o contrato completo: duas pessoas na mesma sala, sem credencial.
//   permanent       — sem credencial real, não se finge provar uma entrada válida. Prova-se, no
//                     processo que está no ar: health; SEM token → exatamente 4005; token com
//                     formato de JWT e assinatura inválida → exatamente 4003; nenhuma das duas
//                     vira entrada com playerId sorteado; e o processo continua vivo depois. O
//                     lado positivo (JWT real entra) é do T4 real pós-deploy
//                     (`verificar-modo-b-real.mjs --server-url=…`).
import { Client } from "@colyseus/sdk";
import { randomBytes, randomUUID } from "node:crypto";

const ARGS = process.argv.slice(2);
const URL_WS = ARGS.find((a) => !a.startsWith("--")) ?? "ws://127.0.0.1:2567";
const MODO = ARGS.find((a) => a.startsWith("--modo="))?.slice("--modo=".length) ?? "legacy";
const SALA = "king";
const PROTOCOL_VERSION = 3;
/** Precisam bater com `CODIGO` em apps/server/src/protocol/index.ts (conferido pelo teste dos portões). */
const CREDENCIAL_AUSENTE = 4005;
const IDENTIDADE_RECUSADA = 4003;

/** Precisa bater com apps/server/src/rooms/identidade.ts. */
const AVATARES = ["leao", "coruja", "raposa", "macaco", "panda", "tucano", "unicornio", "sapo"];
/** Precisa bater com `TEMAS_DA_MESA`. O padrão não serve de prova: só o outro exige o handler. */
const TEMA_NAO_PADRAO = "verde";
/** Uma amostra de apps/server/src/rooms/social.ts — basta uma etiqueta válida e uma inválida. */
const MENSAGEM_VALIDA = "boa";

const falhas = [];
/** Tudo o que sai por `ok`/`falhar` — para o portão F poder afirmar que nenhuma credencial saiu. */
const impressas = [];
const ok = (t) => { impressas.push(t); console.log("  ✓ " + t); };
const falhar = (t) => { impressas.push(t); console.error("  ✗ " + t); falhas.push(t); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function ate(cond, ms, rotulo) {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) return false;
    await espera(25);
  }
  return true;
}

/**
 * Uma conexão instrumentada: guarda o que o servidor manda, para se poder afirmar sobre isso.
 *
 * Existe porque a segunda metade desta verificação precisa de DOIS clientes na mesma sala. Um
 * cliente só prova que os handlers existem; ele não prova que duas pessoas conseguem sentar,
 * escolher bichos diferentes, começar a partida e se ouvir — que é o que quebrou em produção e
 * o que nenhum portão olhava.
 */
function escutar(sala) {
  const c = { sala, boasVindas: null, recusas: [], sociais: [], prontos: null };
  sala.onMessage("SERVER_WELCOME", (m) => { c.boasVindas = m; });
  sala.onMessage("ACTION_REJECTED", (m) => c.recusas.push(m));
  sala.onMessage("SOCIAL_MESSAGE", (m) => c.sociais.push(m));
  sala.onMessage("READY_STATE", (m) => { c.prontos = m?.ready ?? null; });
  for (const t of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "SERVER_ERROR",
    "STATE_UPDATE", "TURN_CLOCK", "AUTO_ACTION"]) sala.onMessage(t, () => {});
  return c;
}

/** Os assentos como o cliente os vê, já em array simples. */
const assentosDe = (c) => [...(c.sala.state?.seats ?? [])];
/** O avatar de um assento, na visão daquele cliente. */
const avatarNo = (c, i) => assentosDe(c)[i]?.avatar;

/**
 * O resumo e o código de saída — o mesmo para os dois modos.
 *
 * A ESPERA ANTES DO `exit` NÃO É DE TESTE: é de ENCERRAMENTO. No Windows, `process.exit` chamado
 * enquanto uma conexão WebSocket recusada ainda está fechando aborta o processo dentro do libuv
 * (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, src\win\async.c) e troca o código de
 * saída por 0xC0000409 — medido: 3 em 3 execuções, inclusive na versão anterior deste script. Um
 * portão cujo código de saída é sorteado pelo sistema não é portão. Dar ao laço de eventos tempo de
 * terminar os fechamentos deixa o código ser o que o script decidiu.
 */
async function concluir() {
  const codigo = falhas.length > 0 ? 1 : 0;
  if (codigo) {
    console.error(`\n❌ IMPLANTAÇÃO REPROVADA — ${falhas.length} verificação(ões) falharam:`);
    for (const f of falhas) console.error("   • " + f);
  } else {
    console.log(MODO === "permanent"
      ? "\n✅ IMPLANTAÇÃO APROVADA (identidade permanent) — portões de MODO B no processo no ar. Entrada com JWT válido: T4 real pós-deploy.\n"
      : "\n✅ IMPLANTAÇÃO APROVADA — servidor no ar com o contrato esperado.\n");
  }
  await espera(300);
  process.exit(codigo);
}

/** Tenta entrar. Devolve se entrou (e com que playerId) ou o código da recusa. Nunca imprime o token. */
async function tentarEntrar(token) {
  const cliente = new Client(URL_WS);
  try {
    const s = await cliente.create(SALA, {
      protocolVersion: PROTOCOL_VERSION, nick: "Verificador", avatar: "raposa", ...(token ? { accessToken: token } : {}),
    });
    let playerId = null;
    s.onMessage("SERVER_WELCOME", (m) => { playerId = m?.you?.playerId ?? "?"; });
    for (const t of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "SERVER_ERROR", "STATE_UPDATE",
      "READY_STATE", "TURN_CLOCK", "AUTO_ACTION", "ACTION_REJECTED", "SOCIAL_MESSAGE"]) s.onMessage(t, () => {});
    await ate(() => playerId !== null, 5000);
    await Promise.race([s.leave(true).catch(() => {}), espera(2000)]);
    return { entrou: true, playerId };
  } catch (e) {
    return { entrou: false, codigo: e?.code };
  }
}

/**
 * Um token com FORMATO de JWT e assinatura inválida: cabeçalho ES256 com um `kid` que nenhum JWKS
 * tem, corpo plausível, assinatura aleatória. Não é credencial de ninguém e não vale nada — é
 * exatamente o que o MODO B precisa recusar com 4003.
 */
function tokenForjado() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const agora = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "ES256", typ: "JWT", kid: "verificacao-king-sem-chave" })}.${b64({
    sub: randomUUID(), aud: "authenticated", role: "authenticated", is_anonymous: true, iat: agora, exp: agora + 300,
  })}.${randomBytes(64).toString("base64url")}`;
}

async function verificarModoPermanente() {
  console.log(`\nVERIFICAÇÃO DE IMPLANTAÇÃO — ${URL_WS} — identidade PERMANENT\n`);
  const URL_HTTP = URL_WS.replace(/^ws/, "http");
  const saude = async (rotulo) => {
    try {
      const r = await fetch(URL_HTTP, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) falhar(`${rotulo}: health HTTP ${r.status}`);
      else ok(`${rotulo}: health HTTP ${r.status}`);
    } catch (e) {
      falhar(`${rotulo}: health não respondeu (${e instanceof Error ? e.name : "erro"})`);
    }
  };

  await saude("A. processo no ar");

  const semToken = await tentarEntrar(undefined);
  if (semToken.entrou) {
    falhar("B. entrada SEM token foi ACEITA — o processo no ar não está em MODO B");
  } else if (semToken.codigo !== CREDENCIAL_AUSENTE) {
    falhar(`B. entrada sem token recusada com ${semToken.codigo}, esperado exatamente ${CREDENCIAL_AUSENTE}`);
  } else ok(`B. sem token: recusado com ${CREDENCIAL_AUSENTE}`);

  const forjado = tokenForjado();
  const invalido = await tentarEntrar(forjado);
  if (invalido.entrou) {
    falhar("C. token com assinatura inválida foi ACEITO");
  } else if (invalido.codigo !== IDENTIDADE_RECUSADA) {
    falhar(`C. token inválido recusado com ${invalido.codigo}, esperado exatamente ${IDENTIDADE_RECUSADA}`);
  } else ok(`C. token inválido: recusado com ${IDENTIDADE_RECUSADA}`);

  if (semToken.entrou || invalido.entrou) falhar("D. houve entrada com playerId sorteado — fallback proibido em MODO B");
  else ok("D. nenhuma recusa virou entrada com playerId sorteado");

  await saude("E. processo continua vivo depois das recusas");

  // F. Nada do que este script escreveu carrega o token usado na prova.
  if (impressas.some((l) => l.includes(forjado) || l.includes(forjado.split(".")[2]))) {
    falhar("F. o token da prova apareceu na saída");
  } else ok("F. nenhuma credencial na saída");

  // G. O modo EFETIVO do processo é conferido pelo deploy, nos logs do PM2
  // (`conferir-modo-efetivo.mjs permanent`): daqui não se lê o log do processo.
  console.log("  · G. modo efetivo: conferido pelo deploy no log do processo (conferir-modo-efetivo.mjs)");
}

if (MODO !== "legacy" && MODO !== "permanent") {
  console.error("  ✗ --modo precisa ser legacy ou permanent");
  process.exit(1);
}
if (MODO === "permanent") {
  await verificarModoPermanente();
  await concluir();
}

console.log(`\nVERIFICAÇÃO DE IMPLANTAÇÃO — ${URL_WS}\n`);

let sala = null;
let segunda = null;
try {
  // ── 0. o processo está DE PÉ e servindo HTTP ──────────────────────────────────────────────
  //
  // Antes de qualquer coisa de jogo: a porta responde? É o mesmo `curl` que o bloco de deploy já
  // fazia, mas aqui ele entra no relatório — um portão que só sabe falar WebSocket não consegue
  // distinguir "o servidor recusou" de "não havia servidor".
  const URL_HTTP = URL_WS.replace(/^ws/, "http");
  try {
    const r = await fetch(URL_HTTP, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) falhar(`health check HTTP ${r.status} em ${URL_HTTP}`);
    else ok(`health check HTTP ${r.status}`);
  } catch (e) {
    falhar(`health check não respondeu: ${e instanceof Error ? e.message : String(e)}`);
  }

  const cliente = new Client(URL_WS);

  // ── 1. handshake ──────────────────────────────────────────────────────────────────────────
  let boasVindas = null;
  const recusas = [];
  const sociaisDoPrimeiro = [];
  sala = await cliente.create(SALA, { protocolVersion: PROTOCOL_VERSION, nick: "Verificador", avatar: "raposa" });
  sala.onMessage("SERVER_WELCOME", (m) => { boasVindas = m; });
  sala.onMessage("ACTION_REJECTED", (m) => recusas.push(m));
  sala.onMessage("SOCIAL_MESSAGE", (m) => sociaisDoPrimeiro.push(m));
  for (const t of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "SERVER_ERROR",
    "STATE_UPDATE", "READY_STATE", "TURN_CLOCK", "AUTO_ACTION"]) sala.onMessage(t, () => {});

  if (!(await ate(() => boasVindas !== null, 10_000))) falhar("SERVER_WELCOME não chegou em 10s");
  else ok("handshake completo");

  if (boasVindas?.protocolVersion !== PROTOCOL_VERSION) {
    falhar(`protocolVersion ${boasVindas?.protocolVersion} — esperado ${PROTOCOL_VERSION}`);
  } else ok(`protocolo ${PROTOCOL_VERSION}`);

  // ── 2. código de sala com 4 DÍGITOS ───────────────────────────────────────────────────────
  const codigo = boasVindas?.roomCode ?? "";
  if (!/^\d{4}$/.test(codigo)) falhar(`roomCode "${codigo}" não é de 4 dígitos`);
  else ok(`código de sala com 4 dígitos (${codigo})`);

  // ── 3. AVATAR no estado sincronizado ──────────────────────────────────────────────────────
  if (!(await ate(() => (sala.state?.seats?.length ?? 0) === 4, 10_000))) {
    falhar("estado da sala não sincronizou 4 assentos");
  } else ok("estado da sala sincronizado (4 assentos)");

  const meu = sala.state?.seats?.[0];
  if (meu?.avatar === undefined) {
    falhar("campo `avatar` AUSENTE no assento — o servidor é anterior à identidade sincronizada");
  } else if (meu.avatar !== "raposa") {
    falhar(`avatar devolvido "${meu.avatar}" — enviamos "raposa"`);
  } else ok("avatar presente e preservado no estado autoritativo");

  // ── 4. NOME DE BOT vindo do servidor ──────────────────────────────────────────────────────
  sala.send("CLIENT_ADD_BOT", { seat: 1 });
  if (!(await ate(() => sala.state?.seats?.[1]?.bot === true, 10_000))) {
    falhar("o bot não entrou no assento 1");
  } else {
    const bot = sala.state.seats[1];
    ok(`bot no assento 1 (${bot.nick})`);
    if (!bot.nick || bot.nick === "BOT NORMAL") {
      falhar(`nome do bot "${bot.nick}" — o servidor é anterior aos nomes autoritativos`);
    } else ok("nome do bot atribuído pelo servidor");
    if (!AVATARES.includes(bot.avatar)) falhar(`avatar do bot "${bot.avatar}" fora do conjunto`);
    else ok("avatar do bot dentro do conjunto fechado");
  }

  // ── 5. MENSAGEM SOCIAL reconhecida ────────────────────────────────────────────────────────
  //
  // A sala está no LOBBY, então a resposta CERTA é a recusa `WRONG_PHASE`. É justamente isso que
  // prova o handler: um servidor sem ele não responde nada. `INVALID_PAYLOAD` para etiqueta
  // desconhecida prova o conjunto fechado.
  recusas.length = 0;
  sala.send("CLIENT_SOCIAL_MESSAGE", { messageId: MENSAGEM_VALIDA });
  if (!(await ate(() => recusas.length > 0, 8000))) {
    falhar("CLIENT_SOCIAL_MESSAGE caiu no vazio — o servidor não conhece mensagens sociais");
  } else if (recusas[0].code !== "WRONG_PHASE") {
    falhar(`mensagem social no lobby respondeu "${recusas[0].code}" — esperado WRONG_PHASE`);
  } else ok("handler de mensagem social presente (recusa correta no lobby)");

  recusas.length = 0;
  sala.send("CLIENT_SOCIAL_MESSAGE", { messageId: "isto-nao-existe" });
  if (!(await ate(() => recusas.length > 0, 8000))) falhar("etiqueta desconhecida não foi recusada");
  else if (recusas[0].code !== "INVALID_PAYLOAD") {
    falhar(`etiqueta desconhecida respondeu "${recusas[0].code}" — esperado INVALID_PAYLOAD`);
  } else ok("conjunto fechado de mensagens em vigor");

  // ── 6. AS MENSAGENS QUE O SERVIDOR PRECISA CONHECER ───────────────────────────────────────
  //
  // ESTE BLOCO EXISTE POR CAUSA DE UM DEFEITO REAL. Um frontend novo foi ao ar contra um servidor
  // que não conhecia `CLIENT_SET_TABLE_THEME`. Em produção o Colyseus responde a mensagem sem
  // handler com `client.leave(WITH_ERROR)`: ele EXPULSA quem enviou. O anfitrião escolhia a mesa
  // verde e era desconectado do próprio lobby; a partida nunca começava, e nada nos logs dizia
  // "mensagem desconhecida" de forma legível.
  //
  // O portão passa a provar, uma a uma, que cada mensagem do contrato TEM dono do outro lado. A
  // prova de vida é a mesma das sociais: uma resposta — qualquer resposta endereçada — só existe
  // se houver handler. Silêncio reprova.

  recusas.length = 0;
  sala.send("CLIENT_SET_TABLE_THEME", { theme: TEMA_NAO_PADRAO });
  if (!(await ate(() => sala.state?.tableTheme === TEMA_NAO_PADRAO || recusas.length > 0, 8000))) {
    falhar("CLIENT_SET_TABLE_THEME caiu no vazio — o servidor é anterior ao tema da mesa");
  } else if (sala.state?.tableTheme !== TEMA_NAO_PADRAO) {
    falhar(`tema não aplicado (respondeu "${recusas[0]?.code}") — somos o anfitrião da sala`);
  } else ok("handler do tema da mesa presente e aplicado");

  recusas.length = 0;
  sala.send("CLIENT_SET_TABLE_THEME", { theme: "arco-iris" });
  if (!(await ate(() => recusas.length > 0, 8000))) falhar("tema desconhecido não foi recusado");
  else if (recusas[0].code !== "INVALID_PAYLOAD") {
    falhar(`tema desconhecido respondeu "${recusas[0].code}" — esperado INVALID_PAYLOAD`);
  } else ok("conjunto fechado de temas em vigor");

  // O UNICÓRNIO É O CANÁRIO DA IDENTIDADE. Ele foi o último avatar a entrar no catálogo, e foi
  // exatamente ele que apareceu como Leão num teste real: o servidor no ar não conhecia a
  // etiqueta e `avatarValido` a trocou pelo padrão, em silêncio, do jeito que um conjunto fechado
  // deve mesmo tratar lixo. Se este servidor devolver "leao" aqui, ele é velho.
  recusas.length = 0;
  sala.send("CLIENT_SET_AVATAR", { avatar: "unicornio" });
  if (!(await ate(() => sala.state?.seats?.[0]?.avatar === "unicornio" || recusas.length > 0, 8000))) {
    falhar("CLIENT_SET_AVATAR caiu no vazio — o servidor é anterior à troca de avatar na sala");
  } else if (sala.state?.seats?.[0]?.avatar !== "unicornio") {
    falhar(`unicórnio recusado ("${recusas[0]?.code}") — nenhum outro assento humano o ocupa`);
  } else ok("catálogo com unicórnio e troca de avatar em vigor");

  // `ready:false` foi acrescentado a uma mensagem que JÁ EXISTIA, então o servidor velho não
  // expulsa ninguém: ele simplesmente ignora o campo e o "desmarcar" não desmarca nada. Sem
  // partida em curso a resposta certa é a recusa da autoridade — e recusa é resposta.
  recusas.length = 0;
  sala.send("CLIENT_READY_NEXT_HAND", { actionId: "verificacao", ready: false });
  if (!(await ate(() => recusas.length > 0, 8000))) {
    falhar("CLIENT_READY_NEXT_HAND com ready:false caiu no vazio");
  } else ok(`ready reversível reconhecido (recusa "${recusas[0].code}" fora de partida)`);

  // ── 7. DUAS PESSOAS NA MESMA SALA ─────────────────────────────────────────────────────────
  //
  // Até aqui tudo foi provado com UM cliente: os handlers existem e respondem. O que derrubou a
  // produção, porém, não foi um handler ausente em abstrato — foi um anfitrião sendo desconectado
  // do próprio lobby, uma segunda pessoa aparecendo com o bicho errado, e uma partida que não
  // começava. Nada disso é visível de uma conexão só.
  //
  // A sala já existe e já tem: o assento 0 com unicórnio, a mesa VERDE aplicada e um bot no
  // assento 1. É exatamente o cenário do defeito. Daqui em diante ele é levado até o fim.

  const clienteB = new Client(URL_WS);
  segunda = await clienteB.joinById(codigo, {
    protocolVersion: PROTOCOL_VERSION, nick: "Verificadora", avatar: "unicornio",
  });
  const b = escutar(segunda);
  const a = { sala, recusas, sociais: sociaisDoPrimeiro };

  if (!(await ate(() => b.boasVindas !== null, 10_000))) {
    falhar("o SEGUNDO humano não recebeu SERVER_WELCOME — ninguém entra nesta sala");
  } else ok(`segundo humano sentado (assento ${b.boasVindas.you.seat})`);

  const assentoB = b.boasVindas?.you?.seat ?? 2;
  // O SINAL DE QUE SINCRONIZOU É O ASSENTO ESTAR OCUPADO, não o avatar existir: desde a
  // identidade pendente, avatar vazio é um estado legítimo, e esperá-lo preenchido era esperar
  // por algo que a regra nova promete NÃO acontecer.
  if (!(await ate(() => assentosDe(b).length === 4 && assentosDe(b)[assentoB]?.playerId, 10_000))) {
    falhar("o estado da sala não sincronizou para o segundo cliente");
  } else ok("os dois clientes veem a mesma sala");

  // IDENTIDADE PENDENTE. Ela pediu o unicórnio, que o assento 0 já tem. Entrar não pode ser
  // recusado por causa de um desenho — mas escolher POR ela também não. O assento fica vazio até
  // ela decidir, e vazio é o único valor que não parece uma escolha.
  const bichoDela = avatarNo(b, assentoB);
  if (bichoDela === "unicornio") {
    falhar("DOIS humanos com unicórnio — a exclusividade não vale na entrada");
  } else if (bichoDela !== "") {
    falhar(`o servidor escolheu "${bichoDela}" pela pessoa em vez de deixar pendente`);
  } else ok("identidade pendente: o servidor não escolheu um substituto");

  // E PENDENTE NÃO FICA PRONTA. Enquanto não escolher, ela não pode dizer "pode começar por mim".
  b.recusas.length = 0;
  segunda.send("CLIENT_SET_READY", { ready: true });
  if (!(await ate(() => b.recusas.length > 0, 8000))) {
    falhar("pronto com identidade pendente não foi recusado");
  } else if (b.recusas.at(-1).code !== "AVATAR_PENDING") {
    falhar(`pronto pendente respondeu "${b.recusas.at(-1).code}" — esperado AVATAR_PENDING`);
  } else ok("quem não escolheu avatar não consegue ficar pronto");

  // E A MESA NÃO COMEÇA ENQUANTO HOUVER PENDENTE — nem com o anfitrião pronto e a mesa cheia.
  // Este é o portão que impede uma partida nascer com um assento sem dono de verdade.
  sala.send("CLIENT_ADD_BOT", { seat: 3 });
  if (!(await ate(() => assentosDe(a).filter((x) => x.playerId !== "").length === 4, 10_000))) {
    falhar("a mesa não completou quatro lugares");
  } else ok("mesa completa: 2 humanos + 2 bots");

  sala.send("CLIENT_SET_READY", { ready: true });
  await espera(600);
  if (sala.state?.status !== "lobby") {
    falhar("a partida COMEÇOU com um humano ainda sem avatar escolhido");
  } else ok("a partida não começa enquanto houver identidade pendente");

  // EXCLUSIVIDADE NA TROCA. Agora ela pede explicitamente o bicho do outro: aqui a resposta certa
  // é RECUSAR, não substituir em silêncio.
  b.recusas.length = 0;
  segunda.send("CLIENT_SET_AVATAR", { avatar: "unicornio" });
  if (!(await ate(() => b.recusas.length > 0 || avatarNo(b, assentoB) === "unicornio", 8000))) {
    falhar("pedir um avatar ocupado não teve resposta nenhuma");
  } else if (avatarNo(b, assentoB) === "unicornio") {
    falhar("o segundo humano ASSUMIU o unicórnio do primeiro");
  } else if (b.recusas.at(-1).code !== "AVATAR_TAKEN") {
    falhar(`avatar ocupado respondeu "${b.recusas.at(-1).code}" — esperado AVATAR_TAKEN`);
  } else ok("exclusividade na troca: avatar ocupado é recusado com AVATAR_TAKEN");

  // E TROCAR PARA UM LIVRE VALE, com o outro aparelho enxergando.
  const livre = AVATARES.find((x) => !assentosDe(b).map((s) => s.avatar).includes(x));
  b.recusas.length = 0;
  segunda.send("CLIENT_SET_AVATAR", { avatar: livre });
  if (!(await ate(() => avatarNo(b, assentoB) === livre && avatarNo(a, assentoB) === livre, 8000))) {
    falhar(`a troca para "${livre}" não chegou aos dois clientes`);
  } else ok(`escolha consciente aceita e propagada aos dois aparelhos ("${livre}")`);

  // READY É TOGGLE, e os dois aparelhos precisam concordar em cada passo.
  const prontoNoOutro = () => assentosDe(b)[0]?.ready === true;
  sala.send("CLIENT_SET_READY", { ready: true });
  if (!(await ate(prontoNoOutro, 8000))) falhar("marcar pronto não chegou ao outro cliente");
  else {
    sala.send("CLIENT_SET_READY", { ready: false });
    if (!(await ate(() => assentosDe(b)[0]?.ready === false, 8000))) {
      falhar("DESMARCAR pronto não chegou ao outro cliente — o toggle não volta");
    } else {
      sala.send("CLIENT_SET_READY", { ready: true });
      if (!(await ate(prontoNoOutro, 8000))) falhar("remarcar pronto não chegou ao outro cliente");
      else ok("ready sincronizado nos dois sentidos (não pronto → pronto → não pronto → pronto)");
    }
  }

  // E A PARTIDA COMEÇA — com a mesa VERDE aplicada, que é o cenário exato da regressão.
  segunda.send("CLIENT_SET_READY", { ready: true });
  if (!(await ate(() => sala.state?.status === "playing", 20_000))) {
    falhar(`a partida NÃO começou (status "${sala.state?.status}") com a mesa ${TEMA_NAO_PADRAO}`);
  } else if (sala.state?.tableTheme !== TEMA_NAO_PADRAO) {
    falhar(`a partida começou, mas a mesa virou "${sala.state?.tableTheme}"`);
  } else ok(`partida iniciada com a mesa ${TEMA_NAO_PADRAO}`);

  if (!(await ate(() => segunda.state?.status === "playing", 10_000))) {
    falhar("o segundo cliente não viu a partida começar");
  } else ok("os dois clientes entraram na partida");

  // SOCIAL ENTRE CLIENTES. Agora que há partida, a mensagem é aceita — e o teste é que ela chega
  // ao OUTRO aparelho, não só de volta a quem mandou.
  a.sociais.length = 0;
  b.sociais.length = 0;
  sala.send("CLIENT_SOCIAL_MESSAGE", { messageId: MENSAGEM_VALIDA });
  // UMA DIFUSÃO, DUAS CONEXÕES — E UM PRAZO SÓ PARA AS DUAS.
  //
  // A versão anterior esperava a mensagem no OUTRO aparelho e, no instante seguinte, cobrava o
  // eco de quem mandou. São sockets independentes: nada garante a ordem entre eles. Quando o eco
  // do remetente atrasava alguns milissegundos, o portão reprovava um servidor correto — e
  // reprovou, em duas de cada três execuções contra a VPS. O prazo agora é um só e vale para os
  // dois; o que se exige continua sendo o mesmo, inclusive que a difusão seja a MESMA nos dois.
  const chegouNosDois = await ate(() => a.sociais.length > 0 && b.sociais.length > 0, 10_000);
  const ecoDoRemetente = a.sociais.at(-1);
  const noOutroAparelho = b.sociais.at(-1);
  if (!chegouNosDois) {
    falhar(
      "a mensagem social não chegou aos dois clientes em 10s " +
      `(remetente: ${a.sociais.length}, outro aparelho: ${b.sociais.length})`,
    );
  } else if (noOutroAparelho.seat !== 0 || noOutroAparelho.messageId !== MENSAGEM_VALIDA) {
    falhar("a mensagem social chegou com autor ou etiqueta errados");
  } else if (ecoDoRemetente.seat !== noOutroAparelho.seat
    || ecoDoRemetente.messageId !== noOutroAparelho.messageId) {
    falhar("os dois clientes receberam difusões diferentes — não é a mesma mensagem");
  } else ok("mensagem social difundida para os dois clientes, com o autor certo");

  // ── 8. nenhum dado privado no estado sincronizado ─────────────────────────────────────────
  const bruto = JSON.stringify(sala.state?.toJSON?.() ?? sala.state ?? {});
  if (/"hands"|"deck"|"seed"|"recoveryToken"/.test(bruto)) {
    falhar("o estado sincronizado contém campo privado — VAZAMENTO");
  } else ok("estado sincronizado sem mão, baralho, semente ou credencial");
} catch (e) {
  falhar("exceção: " + (e instanceof Error ? e.message : String(e)));
} finally {
  // Sair com CORTESIA, mas com prazo. Um `leave` que não responde deixaria o processo pendurado
  // e o Node sairia com um código próprio — e este script é um PORTÃO de deploy: quem lê o
  // `$?` precisa de 0 ou 1, nunca de "13, porque um await não resolveu".
  // Os DOIS saem, e o segundo primeiro: enquanto houver humano na sala ela não é recolhida, e
  // esta verificação deixa uma partida de verdade em curso atrás de si.
  try {
    await Promise.race([segunda?.leave(true) ?? Promise.resolve(), espera(2000)]);
  } catch { /* já fechou */ }
  try {
    await Promise.race([sala?.leave(true) ?? Promise.resolve(), espera(2000)]);
  } catch { /* já fechou */ }
}

await concluir();
