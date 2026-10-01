#!/usr/bin/env node
// MUTAÇÃO DAS PROTEÇÕES DA SEQUÊNCIA (Fase 6A) — web e servidor. As do BANCO moram em
// `scripts/testar-progresso-sql.mjs --provas`, que roda no `npm test` e na CI.
//
// Para cada mutação: aplica a mudança no código, roda os testes, EXIGE que falhem, e restaura o
// arquivo (sempre — inclusive se o processo for interrompido). Uma mutação que sobrevive (testes
// verdes com a proteção quebrada) derruba o runner com código 1.
//
//   node scripts/mutar-sequencia.mjs          → mutações cobradas pelos testes unitários (rápido)
//   node scripts/mutar-sequencia.mjs --e2e    → também as de LAYOUT, cobradas pelo Playwright
//
// Com --e2e, os builds de e2e são refeitos a cada mutação e, no fim, refeitos LIMPOS: um build
// esquecido com a última mutação dentro mediria o código errado na próxima rodada.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(RAIZ, "apps", "web");
const SERVIDOR = join(RAIZ, "apps", "server");
const W = (f) => join(WEB, "src", f);
const COM_E2E = process.argv.includes("--e2e");

const UNIT = { cwd: WEB, cmd: "npx vitest run src/auth/progresso.test.ts src/game/xpDaPartida.test.ts src/ui/progresso.test.tsx src/ui/fimxpPiorCaso.test.tsx" };
const SERV = { cwd: SERVIDOR, cmd: "npx vitest run src/progresso/resultado.test.ts" };
const E2E_PLACAR = { cwd: WEB, cmd: `npm run build:e2e && npx playwright test tests/placarFinal.spec.ts -g "XP e a sequência" --project=667x375 --project=740x360` };
const E2E_HOME = { cwd: WEB, cmd: `npm run build:e2e-progresso && npx playwright test -c playwright.progresso.config.ts -g "com a sequência" --project=667x375 --project=740x360` };

/** [descrição, arquivo, trecho original, trecho mutante, quem tem de falhar] */
const MUTACOES = [
  // ── o Placar Final: só a partida que qualificou o dia ──
  ["Placar finge avanço: a 2ª partida do dia mostra a sequência", W("game/xpDaPartida.ts"),
    "s.partida !== matchId.toLowerCase() || ", "", UNIT],
  ["Placar mostra 'Sequência: 0 dias'", W("game/xpDaPartida.ts"), " || s.atual < 1) return null;", ") return null;", UNIT],

  // ── o texto: convite, nunca cobrança; e nunca sugerir que solo conta ──
  ["convite sem 'online' (sugere que partida contra os bots conta)", W("ui/Progresso.tsx"),
    `"Comece hoje: jogue online"`, `"Comece hoje: jogue"`, UNIT],
  ["texto punitivo no estado zero", W("ui/Progresso.tsx"),
    `"Comece hoje: jogue online"`, `"Você perdeu a sequência — jogue online"`, UNIT],
  ["recorde igual à atual repetido no card", W("ui/Progresso.tsx"), "s.recorde > s.atual && ", "", UNIT],

  // ── o cliente só LÊ: sem relógio, sem armazenamento, sem evento ──
  ["cliente decai a sequência pelo PRÓPRIO relógio", W("auth/progresso.ts"),
    "return { atual, recorde, hoje, partida: partida === null ? null : partida.toLowerCase() };",
    "return { atual: Date.now() > 1.85e12 ? 0 : atual, recorde, hoje, partida: partida === null ? null : partida.toLowerCase() };", UNIT],
  ["sequência guardada no aparelho (uma sequência local paralela)", W("ui/Progresso.tsx"),
    "  const s = p.sequencia;\n",
    "  const s = p.sequencia;\n  try { localStorage.setItem(\"king:sequencia\", JSON.stringify(s)); } catch { /* */ }\n", UNIT],
  ["evento de analytics de sequência", W("ui/Progresso.tsx"),
    "  const s = p.sequencia;\n",
    "  const s = p.sequencia;\n  if (s?.hoje) (globalThis as unknown as { analytics?: { track(e: string, p: object): void } }).analytics?.track(\"streak_incremented\", {});\n", UNIT],

  // ── a leitura: banco velho, dado estranho ──
  ["sequência incoerente aceita (recorde < atual)", W("auth/progresso.ts"), "|| recorde < atual ", "", UNIT],
  ["sem a migração, o cliente inventa uma sequência zerada", W("auth/progresso.ts"),
    "...(sequencia ? { sequencia } : {})", "sequencia: sequencia ?? { atual: 0, recorde: 0, hoje: false, partida: null }", UNIT],
  ["leitura pede as colunas novas pelo nome (o rollout passa a depender da ordem)", W("auth/progresso.ts"),
    `.select("*").maybeSingle<LinhaDoMeuProgresso>()`,
    `.select("xp_total, nivel, xp_no_nivel, xp_do_nivel, sequencia_atual, sequencia_recorde, sequencia_hoje, sequencia_partida").maybeSingle<LinhaDoMeuProgresso>()`, UNIT],
  ["fixture do Playwright desatualizado (o layout mediria um componente que não existe)", W("ui/Progresso.tsx"),
    "{seq !== null && <span className=\"fimxp-seq\">🔥 Sequência: {dias(seq)}</span>}",
    "{seq !== null && <span className=\"fimxp-seq\">🔥 Sequência de jogo: {dias(seq)} seguidos</span>}", UNIT],

  // ── o servidor: partida solo nunca chega ao crédito ──
  ["servidor credita partida SOLO (1 humano + 3 bots)", join(SERVIDOR, "src", "progresso", "resultado.ts"),
    "if (humanos.length < 2) return null;", "if (humanos.length < 1) return null;", SERV],
];

// DEFEITOS REAIS, não ajustes. As primeiras versões (letter-spacing de 1,4em/1,5em; fonte 2,6×
// com entrelinha 1,6) "sobreviveram": as capturas mostraram que o layout ABSORVIA a mudança — a
// linha quebrava e cabia, a pílula alargava dentro do teto, a grade recentralizava e o texto
// grande cabia. Não havia defeito para pegar. Estas produzem estouro medido (conferido em captura).
const MUTACOES_E2E = [
  ["[e2e] a linha da sequência no Placar estoura a coluna pela direita", W("ui/theme.css"),
    ".fimxp-seq{font-size:calc(var(--ui)*.66);font-weight:800;letter-spacing:.02em;",
    ".fimxp-seq{font-size:calc(var(--ui)*.66);font-weight:800;letter-spacing:4em;", E2E_PLACAR],
  ["[e2e] a linha da sequência no Placar empurra a coluna para fora da tela", W("ui/theme.css"),
    ".fimxp-seq{font-size:calc(var(--ui)*.66);",
    ".fimxp-seq{display:block;line-height:4;font-size:calc(var(--ui)*2.6);", E2E_PLACAR],
  ["[e2e] o card da Home CRESCE com a sequência", W("ui/theme.css"),
    ".pg-lado{display:flex;flex-direction:column;align-items:flex-start;gap:2px;",
    ".pg-lado{display:flex;flex-direction:column;align-items:flex-start;gap:14px;", E2E_HOME],
  ["[e2e] a pilha lateral vaza da pílula", W("ui/theme.css"),
    ".pg-recorde{font-size:calc(var(--ui)*.52);font-weight:700;letter-spacing:.03em;",
    ".pg-recorde{font-size:calc(var(--ui)*.52);font-weight:700;letter-spacing:4em;", E2E_HOME],
];

const lista = COM_E2E ? [...MUTACOES, ...MUTACOES_E2E] : MUTACOES;
const originais = new Map();
function restaurarTudo() {
  for (const [arquivo, conteudo] of originais) writeFileSync(arquivo, conteudo);
}
process.on("SIGINT", () => { restaurarTudo(); process.exit(130); });
process.on("SIGTERM", () => { restaurarTudo(); process.exit(143); });

function rodar({ cwd, cmd }) {
  try {
    execSync(cmd, { cwd, stdio: "pipe", timeout: 15 * 60_000 });
    return true; // verde
  } catch {
    return false; // vermelho
  }
}

console.log("Linha de base: os testes precisam estar VERDES antes de mutar.");
if (!rodar(UNIT) || !rodar(SERV)) { console.error("❌ testes unitários vermelhos sem mutação — nada a medir"); process.exit(1); }
if (COM_E2E && (!rodar(E2E_PLACAR) || !rodar(E2E_HOME))) { console.error("❌ e2e vermelho sem mutação — nada a medir"); process.exit(1); }

const resultados = [];
try {
  for (const [descricao, arquivo, de, para, alvo] of lista) {
    const original = readFileSync(arquivo, "utf8");
    originais.set(arquivo, original);
    const normalizado = original.replace(/\r\n/g, "\n");
    if (normalizado.split(de).length !== 2) {
      resultados.push([descricao, "TRECHO NÃO ENCONTRADO (ou repetido)"]);
      originais.delete(arquivo);
      continue;
    }
    writeFileSync(arquivo, normalizado.replace(de, para));
    const verde = rodar(alvo);
    writeFileSync(arquivo, original);
    originais.delete(arquivo);
    resultados.push([descricao, verde ? "SOBREVIVEU ❌" : "morta ✅"]);
    console.log(`${verde ? "❌ SOBREVIVEU" : "✅ morta    "}  ${descricao}`);
  }
} finally {
  restaurarTudo();
  if (COM_E2E) {
    console.log("Refazendo os builds de e2e LIMPOS…");
    execSync("npm run build:e2e && npm run build:e2e-progresso", { cwd: WEB, stdio: "pipe" });
  }
}

const vivas = resultados.filter(([, r]) => r !== "morta ✅");
console.log(`\n${resultados.length - vivas.length}/${resultados.length} mutações mortas.`);
if (vivas.length) {
  for (const [d, r] of vivas) console.log(`  ${r}  ${d}`);
  process.exit(1);
}
console.log("✅ APROVADO — toda proteção da sequência tem teste que fica vermelho sem ela.");
