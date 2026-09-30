#!/usr/bin/env node
// MUTAÇÃO DAS PROTEÇÕES DO ANALYTICS — um teste só vale se fica VERMELHO quando a proteção some.
//
// Para cada mutação: aplica a mudança no código, roda os testes, EXIGE que falhem, e restaura o
// arquivo (sempre — inclusive se o processo for interrompido). Uma mutação que sobrevive (testes
// verdes com a proteção quebrada) derruba o runner com código 1.
//
//   node scripts/mutar-analytics.mjs          → mutações cobradas pelos testes unitários (rápido)
//   node scripts/mutar-analytics.mjs --e2e    → também as cobradas pelo e2e com o SDK de verdade
//
// Com --e2e, o build `dist-e2e-analytics` é refeito a cada mutação e, no fim, refeito LIMPO: um
// build esquecido com a última mutação dentro mediria o código errado na próxima rodada.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const WEB = join(RAIZ, "apps", "web");
const A = (f) => join(WEB, "src", "analytics", f);
const PAGINA = join(WEB, "public", "privacidade.html");
const COM_E2E = process.argv.includes("--e2e");

const UNIT = "npx vitest run src/analytics";
const PRIV = "npx vitest run src/ui/privacidade.test.ts";
const e2e = (filtro) => `npm run build:e2e-analytics && npx playwright test -c playwright.analytics.config.ts -g "${filtro}"`;

/** [descrição, arquivo, trecho original, trecho mutante, comando que tem de falhar] */
const MUTACOES = [
  // ── o núcleo: esquema e lista proibida ──
  ["lista proibida desligada", A("analytics.ts"), "return PROIBIDAS.has(k) || RADICAIS_PROIBIDOS.some((r) => k.includes(r));", "return false;", UNIT],
  ["chave fora do esquema passa", A("analytics.ts"), `    if (!regra) {
      aviso(`, `    if (!regra) {
      limpo[chave] = valor as ValorSimples;
      aviso(`, UNIT],
  ["AS DUAS barreiras desligadas (nick, roomCode, playerId, userId, email, token, URL)", A("analytics.ts"), `  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (chaveProibida(chave)) {`, `  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") { limpo[chave] = valor; continue; }
    if (chaveProibida(chave)) {`, UNIT],
  ["rótulo com cara de id passa (código de sala, uuid)", A("analytics.ts"), "return pareceIdentificador(valor) ? undefined : valor;", "return valor;", UNIT],
  ["rótulo sem conferir formato (URL, espaço, maiúscula)", A("analytics.ts"), "if (!FORMATO_DE_ROTULO.test(valor)) return undefined;", "", UNIT],
  ["posição fora de 1..4 passa", A("analytics.ts"), "valor >= regra.min && valor <= regra.max", "true", UNIT],
  ["evento fora do conjunto sai", A("analytics.ts"), `      if (!ehEvento(evento)) {
        aviso(`, `      if (false) {
        aviso(`, UNIT],
  ["adaptador que lança derruba o jogo", A("analytics.ts"), `    } catch (e) {
      aviso(\`analytics: adaptador`, `    } catch (e) {
      throw e;
      aviso(\`analytics: adaptador`, UNIT],

  // ── o before_send: a barreira dentro do SDK ──
  ["before_send deixa sair evento que não é do KING", A("posthogSdk.ts"), "if (!ev || !ehEvento(ev.event)) return null;", "if (!ev) return null;", UNIT],
  ["before_send mantém URL/referrer do SDK", A("posthogSdk.ts"), "const propriedades: Record<string, unknown> = {};", "const propriedades: Record<string, unknown> = { ...original };", UNIT],
  ["before_send mantém $set/$set_once", A("posthogSdk.ts"), "return { uuid: ev.uuid, event: ev.event, properties: propriedades, timestamp: ev.timestamp };", "return { ...ev, properties: propriedades };", UNIT],
  ["before_send não força perfil de pessoa desligado", A("posthogSdk.ts"), "propriedades.$process_person_profile = false;", "", UNIT],
  ["GeoIP religado (a linha que o desliga some)", A("posthogSdk.ts"), "    propriedades.$geoip_disable = true;\n", "", UNIT],
  ["GeoIP negociável pelo evento ($geoip_disable:false passaria)", A("posthogSdk.ts"), "    propriedades.$geoip_disable = true;", "    propriedades.$geoip_disable = original.$geoip_disable ?? true;", UNIT],

  // ── a configuração do SDK ──
  ["autocapture ligado", A("posthogSdk.ts"), "    autocapture: false,", "    autocapture: true,", UNIT],
  ["pageview automático ligado", A("posthogSdk.ts"), "    capture_pageview: false,", "    capture_pageview: true,", UNIT],
  ["gravação de sessão ligada", A("posthogSdk.ts"), "    disable_session_recording: true,", "    disable_session_recording: false,", UNIT],
  ["surveys ligados", A("posthogSdk.ts"), "    disable_surveys: true,", "    disable_surveys: false,", UNIT],
  ["/flags (e config remota) ligado", A("posthogSdk.ts"), "    advanced_disable_flags: true,", "    advanced_disable_flags: false,", UNIT],
  ["script externo liberado", A("posthogSdk.ts"), "    disable_external_dependency_loading: true,", "    disable_external_dependency_loading: false,", UNIT],
  ["persistência com cookie", A("posthogSdk.ts"), `    persistence: "localStorage",`, `    persistence: "localStorage+cookie",`, UNIT],
  ["perfil de pessoa sempre", A("posthogSdk.ts"), `    person_profiles: "identified_only",`, `    person_profiles: "always",`, UNIT],
  ["before_send removido da configuração", A("posthogSdk.ts"), "    before_send: filtrarEventoDoPostHog,\n", "", UNIT],

  // ── o adaptador e a inicialização ──
  ["chave pessoal (phx_) aceita", A("posthog.ts"), "if (!/^phc_[A-Za-z0-9_-]{20,80}$/.test(k)) return null;", "if (!/^ph[cx]_[A-Za-z0-9_-]{20,80}$/.test(k)) return null;", UNIT],
  ["host sem https aceito", A("posthog.ts"), `if (url.protocol !== "https:" || url.username`, `if (url.username`, UNIT],
  ["SDK que falha propaga o erro", A("posthog.ts"), `      .catch(() => {
        desistiu = true;`, `      .catch((e) => {
        throw e;
        desistiu = true;`, UNIT],
  ["fila sem teto", A("posthog.ts"), "if (fila.length < limite) fila.push([evento, payload]);", "fila.push([evento, payload]);", UNIT],
  ["SDK carregado a cada evento (init repetido)", A("posthog.ts"), "carregando ??= Promise.resolve()", "carregando = Promise.resolve()", UNIT],
  ["sem configuração, carrega o SDK mesmo assim", A("iniciar.ts"), "if (cfg) analytics.usar(criarAdaptadorPostHog({ ...cfg, carregar: o.carregar }));",
    `analytics.usar(criarAdaptadorPostHog({ chave: env.VITE_POSTHOG_KEY ?? "", host: env.VITE_POSTHOG_HOST ?? "", carregar: o.carregar }));`, UNIT],
  ["app_open repetido na mesma página", A("iniciar.ts"), "  if (aberturaAnunciada) return;\n", "", UNIT],
  ["primeiro toque sobrescrito a cada abertura", A("iniciar.ts"), "if (!m.primeiroToque) m = mem.atualizar(", "m = mem.atualizar(", UNIT],

  // ── contexto e aquisição ──
  ["Preview/desenvolvimento conta como tráfego real", A("contexto.ts"), `  if (s.ambiente !== "production") return "test";
`, "", UNIT],
  ["navegador automatizado conta como real", A("contexto.ts"), "if (s.webdriver === true || s.marcado === true", "if (s.marcado === true", UNIT],
  ["build de e2e conta como real", A("contexto.ts"), `if (declarado === "test" || declarado === "teste") return "test";`, "", UNIT],
  ["build sem ambiente vira produção", A("contexto.ts"), `  return "development";\n}`, `  return "production";\n}`, UNIT],
  ["origem longa é cortada em vez de descartada", A("aquisicao.ts"), "if (s.length === 0 || s.length > MAX_ORIGEM) return undefined;", "if (s.length === 0) return undefined;", UNIT],
  ["referrer sai com caminho e query", A("aquisicao.ts"), "const host = semWww(url.hostname.toLowerCase());", "const host = semWww(url.hostname.toLowerCase()) + url.pathname + url.search;", UNIT],
  ["utm_term (a busca digitada) entra", A("aquisicao.ts"), `const CAMPOS_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;`,
    `const CAMPOS_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;`, UNIT],

  // ── partidas ──
  ["partida online contada de novo no reload", A("partida.ts"), `    if (p.partidaId && !mem.marcarPartida("inicios", p.partidaId)) return;\n`, "", UNIT],
  ["fim de partida online contado de novo", A("partida.ts"), `    if (p.partidaId && !mem.marcarPartida("fins", p.partidaId)) return;\n`, "", UNIT],
  ["first_match_started a cada partida", A("partida.ts"), "      mem.atualizar((m) => ({ ...m, primeiraPartida: true }));\n", "", UNIT],

  // ── a página pública de privacidade ──
  ["página não diz que o IP é descartado", PAGINA, "Descarte do endereço IP ligado (<em>Discard client IP data</em>)", "Endereço IP", PRIV],
  ["página carrega script de terceiro", PAGINA, "</head>", `<script src="https://us-assets.i.posthog.com/static/array.js"></script>
</head>`, PRIV],
  ["página promete prazo de retenção não definido", PAGINA, "  <h2>Mudanças nesta página</h2>", `  <p>Os eventos são guardados por 90 dias.</p>
  <h2>Mudanças nesta página</h2>`, PRIV],
  ["página volta a afirmar localização aproximada", PAGINA, "o IP não é guardado.</li>", "o IP não é guardado. O PostHog estima uma localização aproximada.</li>", PRIV],
  ["página some com a declaração de GeoIP desligado", PAGINA, "nenhuma cidade, nenhum estado, nenhum", "cidade, estado,", PRIV],
  ["página promete teto de 12 meses (\"mantidos por até 12 meses\")", PAGINA, "  <h2>Mudanças nesta página</h2>", `  <p>Os eventos analíticos são mantidos por até 12 meses.</p>
  <h2>Mudanças nesta página</h2>`, PRIV],
  // retenção factual (opção 2): 12 meses é JANELA DE CONSULTA, não teto de exclusão
  ["A. retenção: \"janela de consulta\" vira \"retenção máxima\"", PAGINA, `cuja janela de
  consulta dos eventos é de até 12 meses`, `cuja retenção
  máxima dos eventos é de até 12 meses`, PRIV],
  ["B. retenção: some a ressalva de armazenamento por período superior", PAGINA, `o PostHog pode manter esses dados
  armazenados por período superior, conforme sua própria infraestrutura e políticas de retenção, e
  o KING`, "o KING", PRIV],
  ["C. retenção: página afirma exclusão automática em 12 meses", PAGINA, "  <p><strong>Se você não quiser ser medido:</strong>", `  <p>Os eventos são excluídos automaticamente após 12 meses.</p>
  <p><strong>Se você não quiser ser medido:</strong>`, PRIV],
  ["página esquece o e-mail na lista do que nunca é enviado", PAGINA, `      <li>e-mail</li>
`, "", PRIV],
  ["página sem o contato do responsável", PAGINA, '<a href="mailto:titoviveiros@gmail.com">titoviveiros@gmail.com</a>', "o responsável", PRIV],
  ["Home sem o link de privacidade", join(WEB, "src", "ui", "Home.tsx"), '<a className="hm-privacidade" href="/privacidade.html">Privacidade</a>', "Privacidade", PRIV],
  ["reescrita /privacidade removida", join(RAIZ, "vercel.json"), `    {
      "source": "/privacidade",
      "destination": "/privacidade.html"
    },
`, "", PRIV],

  // ── pontos de captura ──
  ["room_created antes de a sala existir", join(WEB, "src", "game", "useKingOnline.ts"), `    void conectar({ tipo: "criar", nick, avatar });`, `    analytics.track("room_created", {});\n    void conectar({ tipo: "criar", nick, avatar });`, UNIT],
  ["invite_code_copied mesmo sem copiar", join(WEB, "src", "ui", "Sala.tsx"), `    sfxTap();\n    void navigator.clipboard?.writeText(codigo)`, `    sfxTap();\n    analytics.track("invite_code_copied", {});\n    void navigator.clipboard?.writeText(codigo)`, UNIT],
];

const MUTACOES_E2E = [
  ["[e2e] before_send removido: URL e referrer sairiam", A("posthogSdk.ts"), "    before_send: filtrarEventoDoPostHog,\n", "", e2e("a abertura")],
  ["[e2e] máscara de parâmetros removida: apelido/e-mail gravados no aparelho", A("posthogSdk.ts"), "    custom_personal_data_properties: PARAMETROS_MASCARADOS,\n", "", e2e("a abertura")],
  ["[e2e] GeoIP religado: o evento sairia sem $geoip_disable", A("posthogSdk.ts"), "    propriedades.$geoip_disable = true;\n", "", e2e("a abertura")],
  ["[e2e] /flags ligado: pedido extra ao PostHog", A("posthogSdk.ts"), "    advanced_disable_flags: true,", "    advanced_disable_flags: false,", e2e("a abertura")],
  ["[e2e] ambiente e build de e2e ignorados: sairia como tráfego real", A("contexto.ts"), `  if (s.ambiente !== "production") return "test";
  const declarado = s.declarado?.trim().toLowerCase();
  if (declarado === "test" || declarado === "teste") return "test";`, `  const declarado = s.declarado?.trim().toLowerCase();`, e2e("a abertura")],
  ["[e2e] reload online conta a partida de novo", A("partida.ts"), `    if (p.partidaId && !mem.marcarPartida("inicios", p.partidaId)) return;\n`, "", e2e("online")],
];

const lista = COM_E2E ? [...MUTACOES, ...MUTACOES_E2E] : MUTACOES;
const originais = new Map();
function restaurarTudo() {
  for (const [arquivo, conteudo] of originais) writeFileSync(arquivo, conteudo);
}
process.on("SIGINT", () => { restaurarTudo(); process.exit(130); });
process.on("SIGTERM", () => { restaurarTudo(); process.exit(143); });

function rodar(cmd) {
  try {
    execSync(cmd, { cwd: WEB, stdio: "pipe", timeout: 15 * 60_000 });
    return true; // verde
  } catch {
    return false; // vermelho
  }
}

console.log(`Linha de base: os testes precisam estar VERDES antes de mutar.`);
if (!rodar(UNIT) || !rodar(PRIV)) { console.error("❌ testes unitários vermelhos sem mutação — nada a medir"); process.exit(1); }
if (COM_E2E && !rodar(e2e("a abertura|online"))) { console.error("❌ e2e vermelho sem mutação — nada a medir"); process.exit(1); }

const resultados = [];
try {
  for (const [descricao, arquivo, de, para, cmd] of lista) {
    const original = readFileSync(arquivo, "utf8");
    originais.set(arquivo, original);
    const normalizado = original.replace(/\r\n/g, "\n");
    if (!normalizado.includes(de)) {
      resultados.push([descricao, "TRECHO NÃO ENCONTRADO"]);
      continue;
    }
    writeFileSync(arquivo, normalizado.replace(de, para));
    const verde = rodar(cmd);
    writeFileSync(arquivo, original);
    originais.delete(arquivo);
    resultados.push([descricao, verde ? "SOBREVIVEU ❌" : "morta ✅"]);
    console.log(`${verde ? "❌ SOBREVIVEU" : "✅ morta    "}  ${descricao}`);
  }
} finally {
  restaurarTudo();
  if (COM_E2E) {
    console.log("Refazendo dist-e2e-analytics LIMPO…");
    execSync("npm run build:e2e-analytics", { cwd: WEB, stdio: "pipe" });
  }
}

const vivas = resultados.filter(([, r]) => r !== "morta ✅");
console.log(`\n${resultados.length - vivas.length}/${resultados.length} mutações mortas.`);
if (vivas.length) {
  for (const [d, r] of vivas) console.log(`  ${r}  ${d}`);
  process.exit(1);
}
console.log("✅ APROVADO — toda proteção crítica tem teste que fica vermelho sem ela.");
