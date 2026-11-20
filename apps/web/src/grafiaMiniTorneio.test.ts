/**
 * GRAFIA OFICIAL: "mini-torneio" — e nenhuma outra em texto que o jogador vê.
 *
 *   mini-torneio (meio de frase) · Mini-torneio (início, botão, título) · MINI-TORNEIO (caixa alta)
 *   mini-torneios (plural)
 *
 * Proibidas: a palavra colada ou separada por espaço, em qualquer caixa. A regex abaixo pega as
 * duas (com ou sem espaço entre "mini" e "torneio") e, por construção, NÃO pega a grafia com
 * hífen — o hífen não é espaço.
 *
 * O QUE É VARRIDO: os LITERAIS — strings, templates e texto JSX — de todo `.ts`/`.tsx` do app
 * (`src/`, inclusive testes, que validam texto) e das specs de E2E (`tests/`, `tests-nativo/`), e o
 * texto cru dos arquivos que viram tela ou loja: `index.html`, as páginas de `public/`, o manifest,
 * a configuração do Capacitor e os recursos do Android. Comentários de código NÃO contam (não são
 * vistos pelo jogador) — mas foram corrigidos também.
 *
 * Identificadores técnicos (nome de arquivo, de branch) podem manter a grafia antiga. Se um deles
 * precisar aparecer num literal, entra na LISTA_DE_EXCECOES — pequena, comentada, um a um.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const GRAFIA_ANTIGA = /mini\s*torneio/gi;

/**
 * Exceções: identificadores técnicos que NUNCA aparecem para o jogador. Cada entrada é o trecho
 * EXATO tolerado. Hoje nenhum deles está num literal; ficam aqui para que, se precisarem entrar,
 * entrem por esta porta e não por um afrouxamento da regex.
 */
const LISTA_DE_EXCECOES: readonly string[] = [
  "minitorneio.spec", // nome do arquivo do E2E (tests/minitorneio.spec.ts) — nome de arquivo, não texto
  "feat/minitorneio", // nome da branch do PR #17 — referência de git, não texto
];

const RAIZ = fileURLToPath(new URL("..", import.meta.url)); // apps/web

function arquivos(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome.startsWith("dist") || nome === "test-results") continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) saida.push(...arquivos(p, ext));
    else if (ext.test(nome)) saida.push(p);
  }
  return saida;
}

/** Ocorrências da grafia antiga num texto, já descontadas as exceções. */
export function ocorrencias(texto: string): string[] {
  let limpo = texto;
  for (const e of LISTA_DE_EXCECOES) limpo = limpo.split(e).join("");
  return limpo.match(GRAFIA_ANTIGA) ?? [];
}

/** Os literais de um arquivo TS/TSX: strings, templates e texto JSX. Comentários ficam de fora. */
export function literais(fonte: string, nome = "x.tsx"): Array<{ linha: number; texto: string }> {
  const sf = ts.createSourceFile(nome, fonte, ts.ScriptTarget.Latest, true,
    nome.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const saida: Array<{ linha: number; texto: string }> = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isJsxText(n)) {
      saida.push({ linha: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, texto: n.text });
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return saida;
}

describe("o detector da grafia antiga (prova de que ele enxerga o que deve)", () => {
  it("reprova as grafias antigas em string, template e JSX; aprova a oficial; ignora comentário", () => {
    const ruim = [
      ["const a = \"Mini", "torneio\";"].join(""),
      ["const b = `MINI", "TORNEIO ${x}`;"].join(""),
      ["const c = <b>Jogar mini ", "torneio</b>;"].join(""),
      ["const d = <i aria-label=\"mini", "torneio\" />;"].join(""),
    ];
    for (const fonte of ruim) {
      expect(literais(fonte).flatMap((l) => ocorrencias(l.texto)), fonte).toHaveLength(1);
    }
    const bom = "// comentário com Mini" + "torneio\nconst a = <b title=\"Mini-torneio\">Jogar mini-torneio · MINI-TORNEIO · mini-torneios</b>;";
    expect(literais(bom).flatMap((l) => ocorrencias(l.texto))).toEqual([]);
  });
});

describe("grafia oficial \"mini-torneio\" em todo texto visível do app", () => {
  it("nenhum literal de .ts/.tsx (app, testes e E2E) usa a grafia antiga", () => {
    const fontes = [
      ...arquivos(join(RAIZ, "src"), /\.tsx?$/),
      ...arquivos(join(RAIZ, "tests"), /\.tsx?$/),
      ...arquivos(join(RAIZ, "tests-nativo"), /\.tsx?$/),
      join(RAIZ, "capacitor.config.ts"),
    ];
    expect(fontes.length).toBeGreaterThan(50); // a varredura não pode passar por estar vazia
    const achados: string[] = [];
    for (const f of fontes) {
      for (const l of literais(readFileSync(f, "utf8"), f)) {
        for (const o of ocorrencias(l.texto)) achados.push(`${relative(RAIZ, f).split(sep).join("/")}:${l.linha} → "${o}"`);
      }
    }
    expect(achados, "use mini-torneio / Mini-torneio / MINI-TORNEIO / mini-torneios").toEqual([]);
  });

  it("nem index.html, páginas públicas, manifest e recursos do Android", () => {
    const crus = [
      join(RAIZ, "index.html"),
      ...arquivos(join(RAIZ, "public"), /\.(html|webmanifest|json|txt)$/),
      ...arquivos(join(RAIZ, "recursos-nativos"), /\.(xml|json|txt|md)$/),
    ];
    expect(crus.length).toBeGreaterThan(1);
    const achados = crus.flatMap((f) => ocorrencias(readFileSync(f, "utf8")).map((o) => `${relative(RAIZ, f)} → "${o}"`));
    expect(achados).toEqual([]);
  });
});
