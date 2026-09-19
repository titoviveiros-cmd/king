// O CONTRATO COMPLETO NO ARTEFATO NOVO — isolado, em legacy, ANTES do restart.
//
// ══ POR QUE ISTO EXISTE ══
//
// O contrato de implantação (`verificar-implantacao.mjs`, modo legacy) prova duas pessoas na
// mesma sala: handlers, avatares, bots, temas, pronto, partida e social. Em MODO B o processo no
// ar só aceita credencial, e o deploy não tem — nem deve ter — credencial real. Sem isto, com a VPS
// em permanent, o contrato deixaria de rodar em qualquer lugar do deploy.
//
// Então ele roda AQUI: contra o artefato recém-compilado, numa porta separada, em legacy e com
// arquivo temporário (nunca /etc/king/server.env). O processo vivo não é tocado e continua no
// modo em que está. Depois do restart, o processo real passa pelos portões de MODO B e pela
// conferência do modo efetivo.
//
// USO: node scripts/verificar-artefato-isolado.mjs [porta=2598]
// SAÍDA: 0 contrato aprovado · 1 reprovado, ou o artefato não subiu isolado.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { subirServidorIsolado } from "./lib/servidor-isolado.mjs";

const PORTA = Number(process.argv[2] ?? 2598);
const CONTRATO = fileURLToPath(new URL("./verificar-implantacao.mjs", import.meta.url));

const s = await subirServidorIsolado({ porta: PORTA, modo: "legacy" });
let codigo = 1;
try {
  if (s.morreu) {
    console.error(`  xx o artefato não subiu (saiu com ${s.codigo})`);
  } else if (!s.isolado) {
    console.error("  xx o artefato não subiu isolado em legacy com o arquivo temporário");
  } else {
    console.log(`  ok artefato novo isolado em legacy na porta ${PORTA} (arquivo temporário)`);
    const r = spawnSync(process.execPath, [CONTRATO, s.url, "--modo=legacy"], { stdio: "inherit" });
    codigo = r.status === 0 ? 0 : 1;
  }
} finally {
  await s.parar();
}
process.exit(codigo);
