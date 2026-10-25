// SMOKE DA FUNÇÃO `excluir-conta` (Fase 9, passo F do rollout) — a lógica pura, testada em
// scripts/ops/smoke-exclusao.test.mjs; a linha de comando está em scripts/smoke-excluir-conta.mjs.
//
// Duas partes, de propósito separadas:
//   • SEM CRIAR NADA (sempre): preflight do CORS, método errado, sem credencial e credencial forjada.
//   • COM CONVIDADO DESCARTÁVEL (só com autorização explícita): nasce um convidado anônimo — o que
//     também prova de novo o passo C (o gancho deixa convidado nascer) —, a função recusa sem a
//     confirmação, exclui de verdade, e a repetição responde "ja-excluida". O id sai no fim para a
//     conferência da lápide no SQL Editor.

export const ORIGEM_DO_APP = "https://playkingcards.com.br";

/**
 * @param {{ url: string, chave: string, rede: typeof fetch, criarDescartavel: boolean }} o
 * @returns {Promise<{ passos: { nome: string, ok: boolean, detalhe: string }[], idDescartavel: string | null }>}
 */
export async function smokeExclusao({ url, chave, rede, criarDescartavel }) {
  const base = url.replace(/\/+$/, "");
  const funcao = `${base}/functions/v1/excluir-conta`;
  const passos = [];
  const passo = (nome, ok, detalhe) => passos.push({ nome, ok: !!ok, detalhe });
  const corpo = async (r) => { try { return await r.json(); } catch { return null; } };

  const pre = await rede(funcao, { method: "OPTIONS", headers: { origin: ORIGEM_DO_APP, "access-control-request-method": "POST" } });
  passo("preflight do app (204 + CORS da origem oficial)", pre.status === 204 && pre.headers.get("access-control-allow-origin") === ORIGEM_DO_APP,
    `${pre.status} ${pre.headers.get("access-control-allow-origin")}`);
  const estranho = await rede(funcao, { method: "OPTIONS", headers: { origin: "https://exemplo-malicioso.test", "access-control-request-method": "POST" } });
  passo("preflight de origem estranha (sem CORS)", !estranho.headers.get("access-control-allow-origin"), `${estranho.status} ${estranho.headers.get("access-control-allow-origin")}`);
  const get = await rede(funcao, { method: "GET", headers: { apikey: chave } });
  passo("GET recusado (405)", get.status === 405, String(get.status));
  const semToken = await rede(funcao, { method: "POST", headers: { apikey: chave, "content-type": "application/json" }, body: JSON.stringify({ confirmacao: "EXCLUIR" }) });
  passo("sem credencial (401)", semToken.status === 401, `${semToken.status} ${JSON.stringify(await corpo(semToken))}`);
  const forjado = await rede(funcao, {
    method: "POST",
    headers: { apikey: chave, authorization: "Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEifQ.AAAA", "content-type": "application/json" },
    body: JSON.stringify({ confirmacao: "EXCLUIR" }),
  });
  passo("credencial forjada (401)", forjado.status === 401, `${forjado.status} ${JSON.stringify(await corpo(forjado))}`);

  if (!criarDescartavel) return { passos, idDescartavel: null };

  const cadastro = await rede(`${base}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: chave, "content-type": "application/json" },
    body: JSON.stringify({ data: {} }),
  });
  const sessao = await corpo(cadastro);
  const token = sessao?.access_token;
  const id = sessao?.user?.id ?? null;
  passo("convidado descartável nasce (o gancho deixa)", cadastro.ok && !!token && sessao?.user?.is_anonymous === true, `${cadastro.status}`);
  if (!token) return { passos, idDescartavel: id };

  const pedir = (b) => rede(funcao, {
    method: "POST",
    headers: { apikey: chave, authorization: `Bearer ${token}`, "content-type": "application/json", origin: ORIGEM_DO_APP },
    body: JSON.stringify(b),
  });
  const semConfirmacao = await pedir({});
  passo("sem a palavra EXCLUIR, nada é apagado (400)", semConfirmacao.status === 400, `${semConfirmacao.status} ${JSON.stringify(await corpo(semConfirmacao))}`);
  const exclui = await pedir({ confirmacao: "EXCLUIR" });
  const r1 = await corpo(exclui);
  passo("exclusão real (200 excluida)", exclui.status === 200 && r1?.estado === "excluida", `${exclui.status} ${JSON.stringify(r1)}`);
  const repete = await pedir({ confirmacao: "EXCLUIR" });
  const r2 = await corpo(repete);
  passo("repetição idempotente (200 ja-excluida)", repete.status === 200 && r2?.estado === "ja-excluida", `${repete.status} ${JSON.stringify(r2)}`);
  return { passos, idDescartavel: id };
}
