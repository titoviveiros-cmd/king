// SMOKE TEST DO SERVIDOR COMPILADO.
//
// Existe por causa de um defeito real: a suíte inteira ficava verde, o TypeScript compilava sem
// um aviso, e `node apps/server/dist/index.js` não subia — porque o pacote `@king/engine`
// apontava para código-fonte `.ts`, que Vite e Vitest resolvem e o Node não.
//
// Testes de unidade nunca pegariam isso: eles rodam dentro do Vitest, que tem alias próprio para
// o fonte. A única prova de que o servidor publicável funciona é EXECUTAR o JavaScript compilado
// como um processo de verdade e falar com ele pela rede. É o que este script faz:
//
//   1. confirma que `@king/engine` resolve para `dist/`, e não para `src/`
//   2. sobe `node apps/server/dist/index.js` como processo separado
//   3. espera a porta responder
//   4. conecta um cliente REAL, cria uma sala e confere o handshake
//   5. sai da sala e encerra o processo de forma limpa
//
// Roda igual na máquina e no CI: `npm run smoke:server`.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";

const RAIZ = new URL("../", import.meta.url);
const ENTRADA = fileURLToPath(new URL("apps/server/dist/index.js", RAIZ));
// Porta deliberadamente DIFERENTE da padrão do projeto: assim o teste também prova que o
// servidor honra a variável `PORT`, que é como todo provedor de hospedagem escolhe onde ele
// escuta. Se o entrypoint voltar a fixar 2567, este teste falha — que é o que se quer.
const PORTA = Number(process.env.SMOKE_PORT ?? 2599);
const URL_HTTP = `http://127.0.0.1:${PORTA}`;
const URL_WS = `ws://127.0.0.1:${PORTA}`;
/**
 * A VERSÃO DO PROTOCOLO VEM DO ARTEFATO, NÃO DESTE ARQUIVO.
 *
 * Estava fixada em 1, e ficou desatualizada no primeiro bump — o CI reprovou com
 * "Protocolo incompatível: cliente 1, servidor 2", que é exatamente a mensagem certa para o
 * problema errado. Um smoke que carrega a própria cópia da constante não testa o servidor: testa
 * se alguém lembrou de editar dois arquivos.
 *
 * Aqui ela é lida do MESMO `dist/` que acabou de ser construído e que o processo sob teste está
 * executando. Se um dia o número divergir entre cliente e servidor, quem acusa é o teste do
 * protocolo, não este.
 */
const { PROTOCOL_VERSION } = await import(
  new URL("apps/server/dist/protocol/index.js", RAIZ).href
);

const passos = [];
const ok = (t) => { passos.push("  ✓ " + t); console.log("  ✓ " + t); };
const falhar = (t) => { console.error("  ✗ " + t); throw new Error(t); };
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────── 1. o motor é resolvido pelo ARTEFATO, não pelo fonte ───────────────

const resolvido = await import.meta.resolve("@king/engine", new URL("apps/server/dist/index.js", RAIZ));
if (resolvido.includes("/src/") || resolvido.endsWith(".ts")) {
  falhar(`@king/engine resolve para código-fonte TypeScript (${resolvido}) — o Node compilado não carrega isso`);
}
if (!resolvido.endsWith("dist/index.js")) {
  falhar(`@king/engine resolveu para um lugar inesperado: ${resolvido}`);
}
ok(`@king/engine resolve para o artefato compilado (${resolvido.split("/packages/")[1]})`);

// ─────────────── 2. sobe o processo ───────────────

const servidor = spawn(process.execPath, [ENTRADA], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, PORT: String(PORTA) },
});

let saida = "";
servidor.stdout.on("data", (d) => { saida += d; });
servidor.stderr.on("data", (d) => { saida += d; });

// ATENÇÃO: `exit` entrega `code = null` quando o processo morre por SINAL — que é exatamente o
// caso de um encerramento pedido por nós. Usar o código como sentinela de "ainda vivo" faz o
// script concluir que o processo resistiu quando ele já tinha morrido. O sentinela é booleano.
let encerrado = false;
let comoMorreu = "";
servidor.on("exit", (code, signal) => {
  encerrado = true;
  comoMorreu = signal ? "sinal " + signal : "código " + code;
});

async function esperarMorrer(decimos) {
  for (let i = 0; i < decimos && !encerrado; i++) await dormir(100);
  return encerrado;
}

async function encerrar(codigo) {
  if (!encerrado) {
    servidor.kill();
    if (!(await esperarMorrer(50))) servidor.kill("SIGKILL");
  }
  process.exit(codigo);
}

try {
  // ─────────────── 3. a porta responde ───────────────

  let respondeu = false;
  for (let i = 0; i < 100; i++) {
    if (encerrado) falhar(`o processo morreu antes de escutar (${comoMorreu})\n${saida}`);
    try {
      const r = await fetch(URL_HTTP, { signal: AbortSignal.timeout(1000) });
      if (r.status > 0) { respondeu = true; break; }
    } catch { /* ainda subindo */ }
    await dormir(200);
  }
  if (!respondeu) falhar(`a porta ${PORTA} não respondeu em 20s\n${saida}`);
  ok(`processo no ar e porta ${PORTA} respondendo`);

  // ─────────────── 4. um cliente REAL cria uma sala ───────────────

  const client = new Client(URL_WS);
  const sala = await client.create("king", { protocolVersion: PROTOCOL_VERSION, nick: "smoke" });

  const boasVindas = await new Promise((resolve, reject) => {
    const prazo = setTimeout(() => reject(new Error("SERVER_WELCOME não chegou em 10s")), 10_000);
    sala.onMessage("SERVER_WELCOME", (w) => { clearTimeout(prazo); resolve(w); });
    for (const m of ["PLAYER_JOINED", "PLAYER_LEFT", "PLAYER_CONNECTION", "SERVER_ERROR", "STATE_UPDATE",
      "ACTION_REJECTED", "READY_STATE", "TURN_CLOCK", "AUTO_ACTION"]) sala.onMessage(m, () => {});
  });

  if (boasVindas.protocolVersion !== PROTOCOL_VERSION) falhar(`protocolo inesperado: ${boasVindas.protocolVersion}`);
  if (!/^\d{4}$/.test(boasVindas.roomCode)) falhar(`roomCode fora do formato (esperado 4 digitos): ${boasVindas.roomCode}`);
  if (boasVindas.roomCode !== sala.roomId) falhar("o roomCode deveria ser o próprio roomId");
  if (boasVindas.you.seat !== 0) falhar(`o primeiro a entrar deveria receber o assento 0, recebeu ${boasVindas.you.seat}`);
  if (!boasVindas.you.recoveryToken.startsWith(boasVindas.roomCode + ":")) falhar("recoveryToken fora do formato roomCode:token");
  ok(`sala criada e handshake completo (código ${boasVindas.roomCode}, assento ${boasVindas.you.seat})`);

  // o estado sincronizado chegou decodificado — prova que o Schema do servidor compilado funciona
  await dormir(300);
  const assentos = sala.state?.seats;
  const quantos = assentos?.length ?? (assentos ? [...assentos].length : 0);
  if (quantos !== 4) falhar(`o estado da sala deveria ter 4 assentos, tem ${quantos}`);
  ok("estado da sala sincronizado (4 assentos)");

  // ─────────────── 5. saída limpa ───────────────

  await sala.leave(true);
  ok("cliente saiu da sala");

  servidor.kill();
  if (!(await esperarMorrer(50))) falhar("o processo não encerrou depois do sinal");
  ok(`processo encerrado de forma limpa (${comoMorreu})`);

  console.log(`\nSMOKE TEST DO SERVIDOR COMPILADO: ${passos.length} verificações, todas OK.`);
  await encerrar(0);
} catch (e) {
  console.error("\nSMOKE TEST FALHOU:", e instanceof Error ? e.message : e);
  if (saida) console.error("--- saída do servidor ---\n" + saida);
  await encerrar(1);
}
