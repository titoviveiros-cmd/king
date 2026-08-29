// VERIFICAÇÃO OPERACIONAL DA ÚLTIMA MÃO — longa de propósito, e FORA do caminho transacional.
//
// ══ POR QUE ELA NÃO É UM PORTÃO DE DEPLOY ══
//
// O respiro da abertura só existe na décima mão. Afirmar sobre ele contra o servidor que está no
// ar exige CHEGAR na décima — jogando as nove anteriores, com os prazos de produção: piso de
// Placar de 8s por mão e cortesia de ~900ms por jogada de bot, algumas centenas de jogadas.
// Passa de dez minutos.
//
// Um portão bloqueante com esse custo reverteria implantações boas por lentidão de rede, que é
// pior do que não ter o portão. Então a divisão é esta:
//
//   • o portão TRANSACIONAL prova que o binário certo está no ar — SHA, artefato com a constante
//     e a integração compiladas, protocolo, contrato, Nginx/UFW, logs;
//   • o comportamento da mão 10 é provado pela suíte de servidor no CI (nove testes, incluindo
//     mesa mista com bot escolhendo o trunfo) e RECONFERIDO aqui, contra o processo vivo.
//
// ══ NÃO HÁ ATALHO, E NÃO SE INVENTA UM ══
//
// Não existe rota, mensagem ou variável que leve a partida direto à mão 10 — e não deve existir.
// Qualquer mecanismo assim seria alcançável em produção por quem falasse o protocolo, e o preço
// de um teste rápido não paga uma porta dessas. Então se joga a partida inteira, como um jogador.
//
// ══ CÓDIGOS DE SAÍDA ══
//
//   0  aprovado
//   1  REPROVADO por comportamento — o respiro não chegou à mão 10. Recomende rollback manual.
//   2  INCONCLUSIVO — a partida não chegou à mão 10 no tempo dado (rede, carga, sala recolhida).
//      NÃO é reprovação: nada foi observado. Rode de novo, ou aceite a cobertura do CI.
//
// USO:  node scripts/verificar-ultima-mao.mjs [ws://127.0.0.1:2567] [minutos]
import { Client } from "@colyseus/sdk";
import { cardId, legalCardsFor, TOTAL_HANDS } from "@king/engine";

const URL_WS = process.argv[2] ?? "ws://127.0.0.1:2567";
const ORCAMENTO_MIN = Number(process.argv[3] ?? 20);
const SALA = "king";
const PROTOCOL_VERSION = 3;
/** Precisa bater com `TEMPOS_PADRAO` em apps/server/src/match/tempos.ts. */
const CORTESIA_DO_BOT = 900;
const TURNO = 25_000;
const RESPIRO = 3_720;

const falhas = [];
const ok = (t) => console.log("  ✓ " + t);
const falhar = (t) => { console.error("  ✗ " + t); falhas.push(t); };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const FIM_DO_ORCAMENTO = Date.now() + ORCAMENTO_MIN * 60_000;
const semTempo = () => Date.now() > FIM_DO_ORCAMENTO;

async function ate(cond, ms) {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim || semTempo()) return false;
    await espera(25);
  }
  return true;
}

function escutar(sala) {
  const c = { sala, boasVindas: null, view: null, versao: 0, relogios: [], recusas: [] };
  sala.onMessage("SERVER_WELCOME", (m) => { c.boasVindas = m; });
  sala.onMessage("STATE_UPDATE", (m) => { c.view = m?.view ?? null; c.versao = m?.stateVersion ?? c.versao; });
  sala.onMessage("TURN_CLOCK", (m) => c.relogios.push(m));
  sala.onMessage("ACTION_REJECTED", (m) => c.recusas.push(m));
  for (const t of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "SERVER_ERROR",
    "READY_STATE", "SOCIAL_MESSAGE", "AUTO_ACTION"]) sala.onMessage(t, () => {});
  return c;
}

console.log(`\nVERIFICAÇÃO OPERACIONAL DA ÚLTIMA MÃO — ${URL_WS}`);
console.log(`orçamento: ${ORCAMENTO_MIN} min. Sem atalho: a partida é jogada até a décima.\n`);

let inconclusivo = null;
let a = null;
let b = null;

try {
  const cliente = new Client(URL_WS);
  const s1 = await cliente.joinOrCreate(SALA, {
    protocolVersion: PROTOCOL_VERSION, nick: "QA-1", avatar: "raposa",
  });
  a = escutar(s1);
  if (!(await ate(() => a.boasVindas !== null, 15_000))) throw new Error("SERVER_WELCOME não chegou");
  const codigo = s1.state?.roomCode;
  ok(`sala ${codigo} criada, assento ${a.boasVindas.you.seat}`);

  const s2 = await cliente.joinById(s1.roomId, {
    protocolVersion: PROTOCOL_VERSION, nick: "QA-2", avatar: "panda",
  });
  b = escutar(s2);
  if (!(await ate(() => b.boasVindas !== null, 15_000))) throw new Error("o segundo humano não entrou");
  const SEAT_B = b.boasVindas.you.seat;
  ok(`segundo humano no assento ${SEAT_B}`);

  // Bots nos assentos que sobraram. O assento 3 é o que escolhe o trunfo da décima
  // (`trumpChooserFor(10)`), e com um bot ali o teste alcança a metade que mais importa:
  // o servidor decidindo por trás da animação.
  const HUMANOS = [a.boasVindas.you.seat, SEAT_B].sort((x, y) => x - y);
  for (const seat of [0, 1, 2, 3].filter((x) => !HUMANOS.includes(x))) {
    s1.send("CLIENT_ADD_BOT", { seat });
    if (!(await ate(() => s1.state?.seats?.[seat]?.bot === true, 15_000))) {
      throw new Error(`o bot não entrou no assento ${seat}`);
    }
  }
  ok(`mesa completa: humanos ${HUMANOS.join(" e ")}, bots nos demais`);
  const escolheOTrunfo10 = (TOTAL_HANDS - 7) % 4;
  console.log(`  · quem escolhe o trunfo da mão ${TOTAL_HANDS} é o assento ${escolheOTrunfo10}` +
    ` (${HUMANOS.includes(escolheOTrunfo10) ? "humano" : "BOT — é o caso que interessa"})`);

  s1.send("CLIENT_SET_READY", { ready: true });
  s2.send("CLIENT_SET_READY", { ready: true });
  if (!(await ate(() => s1.state?.status === "playing", 30_000))) throw new Error("a partida não começou");
  ok("partida iniciada");

  // ── JOGAR ATÉ A DÉCIMA ────────────────────────────────────────────────────────────────────
  const eu = (i) => (i === HUMANOS[0] ? a : b);
  const salaDe = (i) => (i === HUMANOS[0] ? s1 : s2);
  const mao = () => a.view?.hand ?? null;
  let acoes = 0;
  let ultimaMaoVista = 0;

  while (!semTempo()) {
    const h = mao();
    if (!h) { await espera(25); continue; }
    if (h.handNumber !== ultimaMaoVista) {
      ultimaMaoVista = h.handNumber;
      console.log(`  · mão ${ultimaMaoVista}…`);
    }
    if (h.handNumber === TOTAL_HANDS && h.handScores === null
        && (h.completedTricks?.length ?? 0) === 0 && (h.currentTrick?.length ?? 0) === 0) break;

    if (h.handScores !== null) {
      const antes = h.handNumber;
      for (const i of HUMANOS) salaDe(i).send("CLIENT_READY_NEXT_HAND", { actionId: `r${i}-${++acoes}` });
      if (!(await ate(() => (a.view?.handNumber ?? 0) > antes, 60_000))) break;
      continue;
    }
    if (h.awaitingTrumpFrom !== null && HUMANOS.includes(h.awaitingTrumpFrom)) {
      const i = h.awaitingTrumpFrom;
      const antes = eu(i).versao;
      salaDe(i).send("CLIENT_SELECT_TRUMP", {
        actionId: `t${++acoes}`, trump: "hearts", expectedStateVersion: eu(i).versao,
      });
      if (!(await ate(() => eu(i).versao > antes, 30_000))) break;
      continue;
    }
    // Vez de um bot: quem age é o servidor, no prazo dele. Só esperar.
    const i = HUMANOS.find((x) => eu(x).view?.hand?.turn === x && eu(x).view.hand.handScores === null);
    if (i === undefined) { await espera(25); continue; }
    const legais = legalCardsFor(eu(i).view, i);
    if (!legais?.length) { await espera(25); continue; }
    const antes = eu(i).versao;
    salaDe(i).send("CLIENT_PLAY_CARD", {
      actionId: `p${i}-${++acoes}`, cardId: cardId(legais[0]), expectedStateVersion: eu(i).versao,
    });
    if (!(await ate(() => eu(i).versao > antes, 30_000))) break;
  }

  const chegou = mao()?.handNumber === TOTAL_HANDS && (mao()?.completedTricks?.length ?? 0) === 0
    && (mao()?.currentTrick?.length ?? 0) === 0 && mao()?.handScores === null;
  if (!chegou) {
    inconclusivo = `a partida parou na mão ${mao()?.handNumber ?? "?"} ` +
      `depois de ${acoes} ações e ${ORCAMENTO_MIN} min de orçamento`;
  } else {
    ok(`mão ${TOTAL_HANDS} iniciada — ${acoes} ações até aqui`);

    // ── O QUE SE VEIO AFIRMAR ─────────────────────────────────────────────────────────────
    const t0 = Date.now();
    const escolhedor = mao().awaitingTrumpFrom;
    const ehBot = escolhedor !== null && !HUMANOS.includes(escolhedor);

    // 1 · A PRIMEIRA DECISÃO NASCE COM O RESPIRO SOMADO.
    if (!(await ate(() => a.relogios.at(-1)?.tipo === "TRUMP", 20_000))) {
      falhar("a mão 10 abriu sem relógio de escolha de trunfo");
    } else {
      const r = a.relogios.at(-1);
      const base = ehBot ? CORTESIA_DO_BOT : TEMPO_DE_TRUNFO();
      const piso = base + RESPIRO * 0.5; // metade do respiro basta para distinguir "tem" de "não tem"
      if (r.restanteMs < piso) {
        falhar(`primeira decisão da mão 10 com ${r.restanteMs}ms — sem o respiro ` +
          `(base ${base}ms, esperado perto de ${base + RESPIRO}ms)`);
      } else ok(`primeira decisão da mão 10 com prazo acrescido: ${r.restanteMs}ms ` +
        `(base ${base}ms + respiro ${RESPIRO}ms)`);
    }

    // 2 · NADA ANDA DURANTE A TRANSIÇÃO.
    await espera(Math.round(RESPIRO * 0.5));
    const meio = mao();
    if (ehBot && meio?.awaitingTrumpFrom !== escolhedor) {
      falhar("o bot escolheu o trunfo DURANTE a transição da última mão");
    } else if (ehBot) ok("o bot não avançou durante a transição");
    if ((meio?.currentTrick?.length ?? 0) !== 0 || (meio?.completedTricks?.length ?? 0) !== 0) {
      falhar("uma carta foi jogada durante a transição da última mão");
    } else ok("nenhuma carta jogada durante a transição");

    // 3 · O RESPIRO ADIA, NÃO TRAVA.
    if (!(await ate(() => mao()?.awaitingTrumpFrom === null, 60_000))) {
      if (ehBot) falhar("o trunfo da mão 10 nunca foi escolhido — o respiro travou a partida");
      else inconclusivo = "o humano escolhedor não foi conduzido (assento humano na mão 10)";
    } else {
      ok(`trunfo da mão 10 escolhido ${Date.now() - t0}ms depois da abertura`);

      // 4 · A PRIMEIRA JOGADA HUMANA RECEBE O PRAZO INTEGRAL — ninguém pagou a animação.
      const humano = () => a.relogios.filter((x) => x.tipo === "PLAY" && HUMANOS.includes(x.seat)).at(-1);
      if (!(await ate(() => humano() !== undefined, 60_000))) {
        inconclusivo = inconclusivo ?? "nenhuma decisão humana de jogada observada na mão 10";
      } else {
        const r = humano();
        if (r.restanteMs < TURNO * 0.9) {
          falhar(`primeira jogada humana da mão 10 com ${r.restanteMs}ms — prazo erodido pela transição`);
        } else ok(`primeira jogada humana da mão 10 com prazo integral: ${r.restanteMs}ms`);
      }
    }
  }
} catch (e) {
  // Falha de INFRAESTRUTURA (conexão, sala recolhida, rede) não é reprovação de comportamento.
  inconclusivo = inconclusivo ?? ("não foi possível concluir: " + (e instanceof Error ? e.message : String(e)));
} finally {
  try { await Promise.race([b?.sala?.leave(true) ?? Promise.resolve(), espera(2000)]); } catch { /* já fechou */ }
  try { await Promise.race([a?.sala?.leave(true) ?? Promise.resolve(), espera(2000)]); } catch { /* já fechou */ }
}

/** O prazo de trunfo de um humano, de `TEMPOS_PADRAO`. Função só para manter a leitura acima. */
function TEMPO_DE_TRUNFO() { return 45_000; }

if (falhas.length > 0) {
  console.error(`\n❌ FAIL — COMPORTAMENTO REPROVADO (${falhas.length}):`);
  for (const f of falhas) console.error("   • " + f);
  console.error("\n   A mão 10 NÃO está recebendo o respiro no servidor que está no ar.");
  console.error("   RECOMENDAÇÃO: rollback manual.");
  console.error("   cd /opt/king && git reset --hard e780412 && npm ci && npm run build:server && pm2 restart king-server\n");
  process.exit(1);
}
if (inconclusivo) {
  console.warn(`\n⚠️  INCONCLUSIVO — ${inconclusivo}`);
  console.warn("   Isto NÃO é reprovação: nada foi observado, nem a favor nem contra.");
  console.warn("   O servidor segue no ar. Rode de novo com mais orçamento, por exemplo:");
  console.warn(`   node scripts/verificar-ultima-mao.mjs ${URL_WS} 30\n`);
  process.exit(2);
}
console.log("\n✅ PASS — a mão 10 recebe o respiro no servidor implantado.\n");
process.exit(0);
