// VERIFICAÇÃO DE IMPLANTAÇÃO — fala com o servidor que está NO AR e confere o contrato.
//
// Diferente do smoke: o smoke prova que o artefato compilado SOBE. Este prova que o processo
// que está atendendo agora é a versão certa — conectando de verdade, criando uma sala e olhando
// o que o servidor devolve. É o portão do deploy: se qualquer verificação falhar, o script sai
// com código diferente de zero e o bloco de deploy faz rollback.
//
//   node scripts/verificar-implantacao.mjs [ws://127.0.0.1:2567]
//
// Roda pelo LOOPBACK de propósito: prova o processo, não a cadeia TLS/Nginx (que tem gate
// próprio). Nada aqui escreve no disco nem deixa sala pendurada — as salas criadas são
// abandonadas ao sair e o Colyseus as recolhe.
import { Client } from "@colyseus/sdk";

const URL_WS = process.argv[2] ?? "ws://127.0.0.1:2567";
const SALA = "king";
const PROTOCOL_VERSION = 1;

/** Precisa bater com apps/server/src/rooms/identidade.ts. */
const AVATARES = ["coroa", "rei", "dama", "valete", "espadas", "copas", "ouros", "paus"];
/** Uma amostra de apps/server/src/rooms/social.ts — basta uma etiqueta válida e uma inválida. */
const MENSAGEM_VALIDA = "boa";

const falhas = [];
const ok = (t) => console.log("  ✓ " + t);
const falhar = (t) => { console.error("  ✗ " + t); falhas.push(t); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function ate(cond, ms, rotulo) {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) return false;
    await espera(25);
  }
  return true;
}

console.log(`\nVERIFICAÇÃO DE IMPLANTAÇÃO — ${URL_WS}\n`);

let sala = null;
try {
  const cliente = new Client(URL_WS);

  // ── 1. handshake ──────────────────────────────────────────────────────────────────────────
  let boasVindas = null;
  const recusas = [];
  sala = await cliente.create(SALA, { protocolVersion: PROTOCOL_VERSION, nick: "Verificador", avatar: "espadas" });
  sala.onMessage("SERVER_WELCOME", (m) => { boasVindas = m; });
  sala.onMessage("ACTION_REJECTED", (m) => recusas.push(m));
  for (const t of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "SERVER_ERROR",
    "STATE_UPDATE", "READY_STATE", "TURN_CLOCK", "AUTO_ACTION", "SOCIAL_MESSAGE"]) sala.onMessage(t, () => {});

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
  } else if (meu.avatar !== "espadas") {
    falhar(`avatar devolvido "${meu.avatar}" — enviamos "espadas"`);
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

  // ── 6. nenhum dado privado no estado sincronizado ─────────────────────────────────────────
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
  try {
    await Promise.race([sala?.leave(true) ?? Promise.resolve(), espera(2000)]);
  } catch { /* já fechou */ }
}

if (falhas.length > 0) {
  console.error(`\n❌ IMPLANTAÇÃO REPROVADA — ${falhas.length} verificação(ões) falharam:`);
  for (const f of falhas) console.error("   • " + f);
  process.exit(1);
}
console.log("\n✅ IMPLANTAÇÃO APROVADA — servidor no ar com o contrato esperado.\n");
process.exit(0);
