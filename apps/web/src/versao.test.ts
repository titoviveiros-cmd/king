/**
 * A VERSÃO NA HOME — UMA fonte, nenhum número à mão.
 *
 * O rótulo é puro e testado aqui; a ligação com o build (o pacote mostrar a versão do package.json
 * da raiz) é provada no navegador, em `tests/versaoNaHome.spec.ts`. Este arquivo trava a ORIGEM: o
 * Vite e o Android (`versionName`) leem o MESMO package.json, e nenhum componente escreve número.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { rotuloDaVersao } from "./versao.js";

const raiz = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const web = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const versaoDaRaiz = (JSON.parse(readFileSync(raiz("package.json"), "utf8")) as { version: string }).version;

describe("rótulo da versão", () => {
  it("semver vira 'v' + versão", () => {
    expect(rotuloDaVersao("0.1.0")).toBe("v0.1.0");
    expect(rotuloDaVersao("0.1.1")).toBe("v0.1.1");
    expect(rotuloDaVersao("1.2.3-rc.1")).toBe("v1.2.3-rc.1");
  });

  it("sem versão válida, nada aparece — não se inventa número", () => {
    for (const v of [undefined, null, "", "  ", "dev", "1.0", "v1.0.0", "1.0.0 beta"]) {
      expect(rotuloDaVersao(v as string | undefined), String(v)).toBeNull();
    }
  });

  it("a versão do projeto é um semver que vira rótulo", () => {
    expect(rotuloDaVersao(versaoDaRaiz)).toBe(`v${versaoDaRaiz}`);
  });
});

describe("fonte única da versão", () => {
  it("o Vite copia a versão do package.json da RAIZ para o pacote", () => {
    const cfg = readFileSync(web("vite.config.ts"), "utf8");
    expect(cfg).toMatch(/new URL\("\.\.\/\.\.\/package\.json", import\.meta\.url\)/);
    expect(cfg).toMatch(/__KING_VERSAO__:\s*JSON\.stringify\(VERSAO\)/);
  });

  it("o Android carimba o versionName do MESMO arquivo, e o validador reprova divergência", () => {
    const preparar = readFileSync(raiz("scripts/preparar-mobile.mjs"), "utf8");
    expect(preparar).toMatch(/new URL\("\.\.\/package\.json", import\.meta\.url\)/);
    expect(preparar).toMatch(/versionName "\$\{VERSAO\}"/);
    const validar = readFileSync(raiz("scripts/validar-mobile.mjs"), "utf8");
    expect(validar).toMatch(/versionName !== versaoDoProjeto/);
  });

  it("nenhum arquivo do app escreve a versão à mão", () => {
    const achados: string[] = [];
    const varrer = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) { varrer(p); continue; }
        if (!/\.(tsx?|css)$/.test(nome) || /\.test\.tsx?$/.test(nome)) continue;
        const texto = readFileSync(p, "utf8");
        if (texto.includes(`"${versaoDaRaiz}"`) || texto.includes(`v${versaoDaRaiz}`)) achados.push(p);
      }
    };
    varrer(web("src"));
    expect(achados).toEqual([]);
  });
});
