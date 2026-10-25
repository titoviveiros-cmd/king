// O QUE MUDOU DECIDE SE A CI PRECISA DO PLAYWRIGHT — e a dúvida sempre roda.
//
// O e2e só é dispensado quando TODOS os arquivos alterados são documentação: `docs/**` ou um
// `.md` fora de `public/` e de `src/` (nenhum código do app lê Markdown; o único teste que lê um
// `.md` é de unidade, e o job rápido roda sempre). Qualquer outra coisa — código, lockfile,
// workflow, config, script, asset — roda a suíte inteira.
//
// Fail-closed: em `main`, sem lista de arquivos (base desconhecida, diff que falhou, push que
// cria a branch) ou com qualquer arquivo fora da regra, a resposta é "roda".

const DOCUMENTACAO = [
  /^docs\//,
  /^(?!.*(?:^|\/)(?:public|src)\/).*\.md$/i,
];

export function ehDocumentacao(arquivo) {
  return DOCUMENTACAO.some((r) => r.test(arquivo));
}

/**
 * @param {{ ref: string, arquivos: string[] | null }} entrada
 * @returns {{ e2e: boolean, motivo: string }}
 */
export function precisaDeE2E({ ref, arquivos }) {
  if (ref === "refs/heads/main") return { e2e: true, motivo: "main recebe o portão inteiro" };
  if (!Array.isArray(arquivos)) return { e2e: true, motivo: "sem base para comparar: roda tudo" };
  if (arquivos.length === 0) return { e2e: true, motivo: "nenhum arquivo listado: roda tudo" };
  const codigo = arquivos.filter((a) => !ehDocumentacao(a));
  if (codigo.length) return { e2e: true, motivo: `${codigo.length} arquivo(s) fora da documentação, ex.: ${codigo[0]}` };
  return { e2e: false, motivo: `só documentação (${arquivos.length} arquivo(s))` };
}
