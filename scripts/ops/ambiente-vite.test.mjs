// A VARIÁVEL DO BUILD LIDA COMO O VITE LÊ (Fase 9, red team) — o esquema de URL do Google no iPhone
// sai do mesmo valor que entra no pacote; um client ID só no .env.local não pode passar despercebido.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { variavelDoBuild } from "../lib/ambiente-vite.mjs";

test("precedência do Vite: .env < .env.local < .env.production < .env.production.local < ambiente", () => {
  const d = mkdtempSync(join(tmpdir(), "king-vite-env-"));
  const pasta = pathToFileURL(d + "/");
  const antes = process.env.KING_TESTE_X;
  delete process.env.KING_TESTE_X;
  try {
    writeFileSync(join(d, ".env"), "KING_TESTE_X=do-env\nKING_TESTE_Y=y\n");
    assert.equal(variavelDoBuild("KING_TESTE_X", pasta), "do-env");
    writeFileSync(join(d, ".env.local"), "KING_TESTE_X='do-local'\n");
    assert.equal(variavelDoBuild("KING_TESTE_X", pasta), "do-local");
    writeFileSync(join(d, ".env.production"), "KING_TESTE_X=do-modo\n");
    assert.equal(variavelDoBuild("KING_TESTE_X", pasta), "do-modo");
    writeFileSync(join(d, ".env.production.local"), 'export KING_TESTE_X="do-modo-local"\n');
    assert.equal(variavelDoBuild("KING_TESTE_X", pasta), "do-modo-local");
    process.env.KING_TESTE_X = "do-processo";
    assert.equal(variavelDoBuild("KING_TESTE_X", pasta), "do-processo");
    assert.equal(variavelDoBuild("KING_TESTE_Y", pasta), "y");
    assert.equal(variavelDoBuild("KING_TESTE_NAO_EXISTE", pasta), undefined);
  } finally {
    if (antes === undefined) delete process.env.KING_TESTE_X; else process.env.KING_TESTE_X = antes;
    rmSync(d, { recursive: true, force: true });
  }
});
