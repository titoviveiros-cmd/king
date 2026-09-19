// SERVIDOR ISOLADO — o artefato compilado, numa porta separada, com o modo de identidade ESCOLHIDO AQUI.
//
// ══ POR QUE ISOLAR ══
//
// O boot do servidor lê a declaração de identidade de `/etc/king/server.env` quando ela existe
// (ver apps/server/src/config/ambiente.ts). Na VPS em `permanent`, um smoke que herdasse isso
// entraria sem token, receberia 4005 e reprovaria o deploy — não por defeito do artefato, mas por
// contaminação do ambiente de produção. O smoke e o contrato pré-restart provam o ARTEFATO
// executável, não a integração com o emissor; por isso rodam num modo escolhido aqui.
//
// O isolamento é feito pelo mecanismo do próprio servidor: `KING_ENV_FILE` aponta para um arquivo
// temporário — o de produção nunca é lido —, e as chaves de identidade da shell são removidas.
// O arquivo temporário é apagado ao parar e também na saída do processo, inclusive em falha.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHAVES_DE_IDENTIDADE = ["KING_IDENTITY_MODE", "SUPABASE_URL", "SUPABASE_JWT_AUDIENCE", "KING_ENV_FILE", "pm_id"];
const ENTRADA = fileURLToPath(new URL("../../apps/server/dist/index.js", import.meta.url));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cria o arquivo temporário e devolve como montar o ambiente e conferir que o servidor o usou. */
export function prepararIsolamento({ modo = "legacy", supabaseUrl } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "king-isolado-"));
  const arquivo = join(dir, "server.env");
  writeFileSync(arquivo, `KING_IDENTITY_MODE=${modo}\n${supabaseUrl ? `SUPABASE_URL=${supabaseUrl}\n` : ""}`);
  let limpo = false;
  const limpar = () => {
    if (limpo) return;
    limpo = true;
    rmSync(dir, { recursive: true, force: true });
  };
  process.on("exit", limpar);
  return {
    arquivo,
    limpar,
    /** O ambiente do processo filho: sem nenhuma chave de identidade da shell, com o arquivo temporário. */
    ambiente(porta) {
      const e = { ...process.env };
      for (const k of CHAVES_DE_IDENTIDADE) delete e[k];
      e.KING_ENV_FILE = arquivo;
      e.PORT = String(porta);
      return e;
    },
    /** O boot declarou o modo escolhido E disse que leu o arquivo temporário — e não outro. */
    confere(saida) {
      return saida.includes(`identity mode: ${modo}`) && saida.includes(`env file: loaded (${arquivo})`);
    },
  };
}

/** Sobe o artefato isolado e espera a porta responder (ou o processo morrer). */
export async function subirServidorIsolado({ porta, modo = "legacy", supabaseUrl }) {
  const iso = prepararIsolamento({ modo, supabaseUrl });
  const filho = spawn(process.execPath, [ENTRADA], { stdio: ["ignore", "pipe", "pipe"], env: iso.ambiente(porta) });
  let saida = "";
  let morreu = false;
  let codigo = null;
  filho.stdout.on("data", (d) => { saida += d; });
  filho.stderr.on("data", (d) => { saida += d; });
  filho.on("exit", (c) => { morreu = true; codigo = c; });
  for (let i = 0; i < 100 && !morreu; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${porta}`, { signal: AbortSignal.timeout(500) })).status > 0) break;
    } catch { /* subindo */ }
    await dormir(150);
  }
  return {
    porta,
    url: `ws://127.0.0.1:${porta}`,
    arquivo: iso.arquivo,
    get saida() { return saida; },
    get morreu() { return morreu; },
    get codigo() { return codigo; },
    get isolado() { return iso.confere(saida); },
    async parar() {
      if (!morreu) {
        filho.kill();
        for (let i = 0; i < 30 && !morreu; i++) await dormir(100);
      }
      iso.limpar();
    },
  };
}
