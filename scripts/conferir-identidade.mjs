// PORTÃO DE IDENTIDADE DO DEPLOY — roda ANTES do restart, contra o artefato recém-compilado.
//
// Percorre o MESMO caminho que o processo vai percorrer sob o PM2: o arquivo persistente é
// obrigatório, as chaves de identidade da shell são descartadas, e o modo é resolvido com as
// mesmas regras do servidor (a função é importada do `dist/`, não copiada).
//
// USO:
//   node scripts/conferir-identidade.mjs [/etc/king/server.env] [--conferir-jwks]
//
//   --conferir-jwks  no modo permanent, confere também que o JWKS PÚBLICO do projeto responde com
//                    ao menos uma chave ES256/RS256. É uma leitura pública; não cria usuário.
//
// SAÍDA: 0 coerente · 1 incoerente, ausente ou artefato sem o carregador — o deploy PARA.
//
// Nunca imprime valores: só o modo, se a URL está configurada e o caminho do arquivo.
const args = process.argv.slice(2);
const ARQUIVO = args.find((a) => !a.startsWith("--")) ?? "/etc/king/server.env";
const CONFERIR_JWKS = args.includes("--conferir-jwks");
const ALGORITMOS = new Set(["ES256", "RS256"]);

let mod;
try {
  mod = await import(new URL("../apps/server/dist/config/ambiente.js", import.meta.url).href);
} catch {
  console.error("  xx o artefato não tem config/ambiente.js — este código não carrega o arquivo persistente");
  process.exit(1);
}
const { prepararIdentidade, ConfiguracaoInvalida } = mod;

// O ambiente simulado do processo: nenhuma chave de identidade da shell, e o arquivo exigido.
const processo = { KING_ENV_FILE: ARQUIVO };
let r;
try {
  r = prepararIdentidade(processo);
} catch (e) {
  const motivo = e instanceof ConfiguracaoInvalida ? e.message : "erro inesperado ao ler a configuração";
  console.error(`  xx identidade incoerente: ${motivo}`);
  process.exit(1);
}
console.log(`  ok ${r.resumo}`);

if (CONFERIR_JWKS && r.modo.modo === "permanent") {
  try {
    const resp = await fetch(`${r.modo.url}/auth/v1/.well-known/jwks.json`, { signal: AbortSignal.timeout(10_000) });
    const corpo = resp.ok ? await resp.json() : { keys: [] };
    const aceitas = (corpo.keys ?? []).filter((k) => ALGORITMOS.has(k.alg));
    if (aceitas.length === 0) {
      console.error(`  xx JWKS sem chave ES256/RS256 (HTTP ${resp.status}) — o modo permanent recusaria todo token`);
      process.exit(1);
    }
    console.log(`  ok JWKS: ${aceitas.length} chave(s) ${[...new Set(aceitas.map((k) => k.alg))].join("/")}`);
  } catch (e) {
    console.error(`  xx JWKS não respondeu: ${e instanceof Error ? e.name : "erro"}`);
    process.exit(1);
  }
}
process.exit(0);
