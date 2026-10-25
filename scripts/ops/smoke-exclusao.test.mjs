// O SMOKE DA FUNÇÃO DE EXCLUSÃO (passo F do rollout) contra a função de verdade (`nucleo.ts`), com a
// rede trocada: prova que o smoke APROVA a função correta, REPROVA uma função defeituosa, e que sem
// autorização nenhum usuário é criado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { smokeExclusao } from "../lib/smoke-exclusao.mjs";

const URL_SB = "https://abcdefghijklmnopqrst.supabase.co";

/** Uma função/Auth falsos que se comportam como o projeto real (ou com um defeito escolhido). */
function projetoFalso({ defeito } = {}) {
  const usuarios = new Map();
  const chamadas = [];
  const rede = async (url, init = {}) => {
    const metodo = init.method ?? "GET";
    const h = init.headers ?? {};
    chamadas.push(`${metodo} ${new URL(url).pathname}`);
    if (url.endsWith("/auth/v1/signup")) {
      const id = "22222222-2222-4222-8222-222222222222";
      usuarios.set(id, true);
      return new Response(JSON.stringify({ access_token: `tok-${id}`, user: { id, is_anonymous: true } }), { status: 200 });
    }
    if (metodo === "OPTIONS") {
      const permitida = h.origin === "https://playkingcards.com.br" || defeito === "cors-aberto";
      return new Response(null, { status: 204, headers: permitida ? { "access-control-allow-origin": h.origin } : {} });
    }
    if (metodo !== "POST") return new Response(JSON.stringify({ erro: "metodo" }), { status: 405 });
    const token = /^Bearer (tok-.+)$/.exec(h.authorization ?? "")?.[1];
    if (!h.authorization) return new Response(JSON.stringify({ erro: "sem-credencial" }), { status: 401 });
    if (!token && defeito !== "aceita-forjado") return new Response(JSON.stringify({ erro: "credencial-invalida" }), { status: 401 });
    const corpo = JSON.parse(init.body ?? "{}");
    if (corpo.confirmacao !== "EXCLUIR" && defeito !== "sem-confirmacao") return new Response(JSON.stringify({ erro: "sem-confirmacao" }), { status: 400 });
    const id = token?.slice(4);
    if (!usuarios.has(id)) return new Response(JSON.stringify({ estado: defeito === "nao-idempotente" ? "erro" : "ja-excluida" }), { status: defeito === "nao-idempotente" ? 502 : 200 });
    usuarios.delete(id);
    return new Response(JSON.stringify({ estado: "excluida", apple: "nao-se-aplica" }), { status: 200 });
  };
  return { rede, chamadas, usuarios };
}

test("função correta, sem autorização: tudo aprovado e NENHUM usuário criado", async () => {
  const p = projetoFalso();
  const r = await smokeExclusao({ url: URL_SB, chave: "pub", rede: p.rede, criarDescartavel: false });
  assert.deepEqual(r.passos.filter((x) => !x.ok), []);
  assert.equal(r.idDescartavel, null);
  assert.ok(!p.chamadas.some((c) => c.includes("/signup")), "criou usuário sem autorização");
});

test("função correta, com autorização: cria, recusa sem EXCLUIR, exclui e repete idempotente", async () => {
  const p = projetoFalso();
  const r = await smokeExclusao({ url: URL_SB, chave: "pub", rede: p.rede, criarDescartavel: true });
  assert.deepEqual(r.passos.filter((x) => !x.ok), []);
  assert.equal(r.passos.length, 9);
  assert.equal(r.idDescartavel, "22222222-2222-4222-8222-222222222222");
  assert.equal(p.usuarios.size, 0, "o descartável sobrou");
});

test("cada defeito plausível da função REPROVA o smoke", async () => {
  for (const defeito of ["cors-aberto", "aceita-forjado", "sem-confirmacao", "nao-idempotente"]) {
    const r = await smokeExclusao({ url: URL_SB, chave: "pub", rede: projetoFalso({ defeito }).rede, criarDescartavel: true });
    assert.ok(r.passos.some((x) => !x.ok), `o defeito ${defeito} passou no smoke`);
  }
});
