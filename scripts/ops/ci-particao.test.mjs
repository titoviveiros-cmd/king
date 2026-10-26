// A PARTIÇÃO DO PLAYWRIGHT NA CI — cada teste em exatamente um shard, e nenhum shard esquecido.
//
// Com `--shard`, o Playwright não reprova uma seleção vazia, e nada reprova um shard que deixou de
// existir: se a matriz do workflow perdesse o "4/6", um sexto da suíte sumiria com a CI verde.
// Este teste lê a matriz de .github/workflows/ci.yml e exige, por grupo, os índices 1..N completos
// e sem repetição, e que os dois grupos sejam complementares (a mesma tag, com e sem inversão).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RAIZ = new URL("../../", import.meta.url);
const ler = (p) => readFileSync(new URL(p, RAIZ), "utf8");
const TAG = "@aparelho-real";

function shardsDaMatriz() {
  const grupos = new Map();
  for (const m of ler(".github/workflows/ci.yml").matchAll(/playwright: "([^"]*)"/g)) {
    const args = m[1];
    const s = args.match(/--shard=(\d+)\/(\d+)/);
    assert.ok(s, `entrada da matriz sem --shard: ${args}`);
    const filtro = args.replace(s[0], "").trim();
    const g = grupos.get(filtro) ?? { total: +s[2], indices: [] };
    assert.equal(+s[2], g.total, `${filtro}: totais diferentes no mesmo grupo`);
    g.indices.push(+s[1]);
    grupos.set(filtro, g);
  }
  return grupos;
}

test("cada grupo da matriz cobre os shards 1..N, sem buraco e sem repetição", () => {
  const grupos = shardsDaMatriz();
  assert.ok(grupos.size > 0, "nenhuma entrada de Playwright na matriz");
  for (const [filtro, { total, indices }] of grupos) {
    assert.deepEqual([...indices].sort((a, b) => a - b), Array.from({ length: total }, (_, i) => i + 1), filtro);
  }
});

test("os grupos são complementares: a mesma tag, com e sem inversão, e mais nada", () => {
  assert.deepEqual([...shardsDaMatriz().keys()].sort(), [`--grep ${TAG}`, `--grep-invert ${TAG}`]);
});

test("a tag da CI é a que a spec do aparelho real declara, e o config prende a spec a um projeto que existe", () => {
  assert.ok(ler("apps/web/tests/androidReal.spec.ts").includes(`{ tag: "${TAG}" }`), "androidReal.spec.ts perdeu a tag");
  const config = ler("apps/web/playwright.config.ts");
  const aparelho = config.match(/const APARELHO_REAL = "(\d+)x(\d+)"/);
  assert.ok(aparelho, "playwright.config.ts não declara APARELHO_REAL");
  assert.ok(config.includes(`{ w: ${aparelho[1]}, h: ${aparelho[2]} }`), `APARELHO_REAL=${aparelho[1]}x${aparelho[2]} não é um dos viewports`);
});
