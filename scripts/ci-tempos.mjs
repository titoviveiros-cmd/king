// TEMPOS DE UMA EXECUÇÃO DA CI — o instrumento da otimização do Playwright.
//
// Uso: node scripts/ci-tempos.mjs <run-id> [--specs]
//
// Lê a execução pelo `gh` (já autenticado) e imprime, por job: a duração, a etapa do Playwright e
// o placar de cada suíte que rodou nele — agendados, passaram, pulados, flaky, falhas e retries.
// Com `--specs`, soma o tempo de worker por spec a partir das linhas do reporter `list`.
//
// Mede o que a CI registrou, não estima. O total vai do primeiro job que começou ao último que
// terminou, e cada contagem sai do log. As três CIs de referência da otimização (40224619955,
// 40199537383, 40148569663) foram lidas com ele, e é com ele que a CI nova se compara a elas.
// Não faz polling: lê uma execução que já terminou.
import { execFileSync } from "node:child_process";

const [runId, ...flags] = process.argv.slice(2);
if (!runId || !/^\d+$/.test(runId)) {
  console.error("uso: node scripts/ci-tempos.mjs <run-id> [--specs]");
  process.exit(2);
}
const comSpecs = flags.includes("--specs");

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 1 << 30 });
const ms = (a, b) => new Date(b).getTime() - new Date(a).getTime();
function fmt(t) {
  const s = Math.round(t / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h${String(m).padStart(2, "0")}m${String(r).padStart(2, "0")}s` : `${m}m${String(r).padStart(2, "0")}s`;
}
const SEGUNDOS = { ms: 0.001, s: 1, m: 60, h: 3600 };

/**
 * O placar de cada `playwright test` que rodou num log de job. Um job pode rodar mais de uma
 * suíte (progresso + analytics), então cada "Running N tests" abre um bloco novo.
 */
function lerSuites(log) {
  const suites = [];
  let atual = null;
  for (const bruta of log.split(/\r?\n/)) {
    const l = bruta.replace(/\x1b\[[0-9;]*m/g, "").replace(/^.*?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "");
    const ini = l.match(/^Running (\d+) tests? using (\d+) workers?/);
    if (ini) {
      atual = { agendados: +ini[1], workers: +ini[2], passou: 0, pulou: 0, flaky: 0, falhou: 0, retries: 0, duracao: "", specs: new Map() };
      suites.push(atual);
      continue;
    }
    if (!atual) continue;
    const fim = l.match(/^\s+(\d+) (passed|skipped|flaky|failed)(?: \(([^)]+)\))?\s*$/);
    if (fim) {
      const chave = { passed: "passou", skipped: "pulou", flaky: "flaky", failed: "falhou" }[fim[2]];
      atual[chave] = +fim[1];
      if (fim[3]) atual.duracao = fim[3];
      continue;
    }
    // Linha de resultado do reporter `list`: "✓  12 [800x360] › tests/x.spec.ts:10:3 › título (4.2s)"
    const r = l.match(/^\s+(✓|✘|-|×|±)\s+\d+\s+\[[^\]]+\]\s+›\s+(?:tests[^/]*\/)?([^:]+):\d+:\d+\s+›.*?(?:\((\d+(?:\.\d+)?)(ms|s|m|h)\))?\s*$/);
    if (r) {
      if (/\(retry #\d+\)/.test(l)) atual.retries++;
      if (r[3]) atual.specs.set(r[2], (atual.specs.get(r[2]) ?? 0) + Number(r[3]) * SEGUNDOS[r[4]]);
    }
  }
  return suites;
}

const run = JSON.parse(gh(["run", "view", runId, "--json", "jobs,createdAt,updatedAt,headSha,headBranch,conclusion,attempt,url"]));
const jobs = run.jobs.filter((j) => j.startedAt && j.completedAt && !j.startedAt.startsWith("0001"));
const inicio = jobs.map((j) => j.startedAt).sort()[0];
const termino = jobs.map((j) => j.completedAt).sort().at(-1);
console.log(`CI ${runId} · ${run.headBranch} @ ${run.headSha.slice(0, 7)} · ${run.conclusion} · tentativa ${run.attempt}`);
console.log(`${run.url}`);
console.log(`TOTAL (1º job começa → último termina): ${fmt(ms(inicio, termino))}   | criada → atualizada: ${fmt(ms(run.createdAt, run.updatedAt))}\n`);

const linhas = [];
const specs = new Map();
let execucoes = 0, flaky = 0, retries = 0, falhas = 0;
for (const j of [...jobs].sort((a, b) => ms(b.startedAt, b.completedAt) - ms(a.startedAt, a.completedAt))) {
  const etapaPw = (j.steps ?? []).filter((s) => /playwright/i.test(s.name) && !/navegador|install/i.test(s.name) && s.startedAt && s.completedAt);
  const tPw = etapaPw.reduce((a, s) => a + ms(s.startedAt, s.completedAt), 0);
  let suites = [];
  if (etapaPw.length) suites = lerSuites(gh(["api", "--allow-escape-sequences", `repos/{owner}/{repo}/actions/jobs/${j.databaseId}/logs`]));
  for (const s of suites) {
    execucoes += s.passou + s.falhou + s.flaky;
    flaky += s.flaky; retries += s.retries; falhas += s.falhou;
    for (const [k, v] of s.specs) specs.set(k, (specs.get(k) ?? 0) + v);
  }
  const placar = suites.map((s) => `${s.agendados} agend. → ${s.passou} ok, ${s.pulou} pul., ${s.flaky} flaky, ${s.falhou} falha, ${s.retries} retry (${s.duracao})`).join(" + ");
  linhas.push([j.name, j.conclusion, fmt(ms(j.startedAt, j.completedAt)), `+${fmt(ms(inicio, j.startedAt))}`, tPw ? fmt(tPw) : "—", placar || "—"]);
}
const cab = ["job", "resultado", "duração", "começou", "etapa Playwright", "suítes"];
const larg = cab.map((c, i) => Math.max(c.length, ...linhas.map((l) => String(l[i]).length)));
for (const l of [cab, ...linhas]) console.log(l.map((c, i) => (i === l.length - 1 ? c : String(c).padEnd(larg[i]))).join(" | "));
console.log(`\nexecuções Playwright efetivas (passaram + falharam + flaky): ${execucoes} | flaky: ${flaky} | retries: ${retries} | falhas: ${falhas}`);

if (comSpecs && specs.size) {
  const total = [...specs.values()].reduce((a, b) => a + b, 0);
  console.log(`\ntempo de worker por spec (reporter list): ${fmt(total * 1000)} no total`);
  for (const [k, v] of [...specs].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fmt(v * 1000).padStart(9)}  ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
  }
}
