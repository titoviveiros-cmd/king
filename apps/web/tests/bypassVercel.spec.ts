/**
 * A ENTRADA DO T5 NUM PREVIEW PROTEGIDO — construída certo, e sem cabeçalho global.
 *
 * Não abre navegador nem rede: prova a função pura que monta a primeira URL e a regra de que o
 * segredo de bypass nunca vira cabeçalho do contexto inteiro (o que atingiria, cross-origin, o
 * servidor do jogo). Roda na CI, uma vez.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PARAM_BYPASS, PARAM_COOKIE, semSegredo, urlDeEntrada } from "./helpers/bypassVercel.js";

const BASE = "https://king-exemplo-tito-viveiros-games.vercel.app";
/** Com os caracteres que quebram uma query montada à mão: `&`, `=`, `+`, `/`, `?`, espaço. */
const SEGREDO = "aB3+/c=d&e?f g";

test.describe("T5 — primeira navegação num Preview protegido", () => {
  test.beforeEach(({}, ti) => { test.skip(ti.project.name !== "800x360", "roda uma vez"); });

  test("com segredo: raiz do Preview, segredo ÍNTEGRO na query e pedido de cookie", () => {
    const u = new URL(urlDeEntrada(BASE, SEGREDO));
    expect(u.origin).toBe(BASE);
    expect(u.pathname).toBe("/");
    // Lido de volta pela própria URL: se a codificação estivesse errada, o valor chegaria cortado.
    expect(u.searchParams.get(PARAM_BYPASS)).toBe(SEGREDO);
    expect(u.searchParams.get(PARAM_COOKIE)).toBe("true");
    expect([...u.searchParams.keys()].sort()).toEqual([PARAM_BYPASS, PARAM_COOKIE].sort());
  });

  test("barra final e espaços na base não mudam a URL", () => {
    expect(urlDeEntrada(`  ${BASE}//  `, SEGREDO)).toBe(urlDeEntrada(BASE, SEGREDO));
  });

  test("sem segredo (ou só espaços): só a raiz, nenhum parâmetro de bypass", () => {
    for (const s of [undefined, "", "   "]) {
      const u = new URL(urlDeEntrada(BASE, s));
      expect(u.toString()).toBe(`${BASE}/`);
      expect(u.search).toBe("");
    }
  });

  test("o sanitizador tira o segredo cru e codificado de uma mensagem de erro", () => {
    const url = urlDeEntrada(BASE, SEGREDO);
    const mensagem = `page.goto: net::ERR_ABORTED at ${url} — segredo cru: ${SEGREDO}`;
    const limpa = semSegredo(mensagem, SEGREDO);
    expect(limpa).not.toContain(SEGREDO);
    expect(limpa).not.toContain(encodeURIComponent(SEGREDO));
    expect(limpa).not.toContain(new URL(url).searchParams.toString().split("&").find((p) => p.startsWith(PARAM_BYPASS))!.split("=")[1]);
    expect(limpa).toContain("***");
  });

  test("o T5 não usa cabeçalho global de bypass, e navega pela URL de entrada", () => {
    const fonte = readFileSync(new URL("./identidadePreview.spec.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(fonte, "extraHTTPHeaders atingiria o servidor do jogo, cross-origin").not.toContain("extraHTTPHeaders");
    expect(fonte, "o segredo não pode virar cabeçalho").not.toMatch(/["']x-vercel-protection-bypass["']\s*:/);
    expect(fonte, "a primeira navegação precisa usar urlDeEntrada").toContain("urlDeEntrada(");
  });
});
