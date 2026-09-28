// A ESTRUTURA — o que não se prova chamando função, prova-se lendo o código.
//
//   • o SDK só entra por UM arquivo, e só por import dinâmico (fora do pacote inicial);
//   • nenhum arquivo do app chama identify/alias/group/setPersonProperties;
//   • todo `track` do app usa um evento do conjunto fechado;
//   • cada ponto de captura está no lugar que responde a pergunta certa (sala criada DEPOIS de
//     abrir, cópia DEPOIS de copiar, partida online com o id para deduplicar…);
//   • o analytics não depende de Supabase: o modo local mede sem identidade nenhuma.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVENTOS } from "./analytics.js";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const ler = (rel: string) => readFileSync(join(SRC, rel), "utf8").replace(/\r\n/g, "\n");

function arquivosDoApp(dir = SRC): string[] {
  const r: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) r.push(...arquivosDoApp(p));
    else if (/\.(ts|tsx)$/.test(nome) && !/\.test\.(ts|tsx)$/.test(nome)) r.push(relative(SRC, p).replace(/\\/g, "/"));
  }
  return r;
}
const APP = arquivosDoApp();

describe("o SDK fica numa caixa", () => {
  it("só analytics/posthogSdk.ts importa posthog-js", () => {
    const quem = APP.filter((f) => /from\s+"posthog-js|import\("posthog-js/.test(ler(f)));
    expect(quem).toEqual(["analytics/posthogSdk.ts"]);
  });

  it("e posthogSdk.ts só entra por import DINÂMICO — fora do pacote inicial", () => {
    const estaticos = APP.filter((f) => /^import\s+(?!type\b)[^;]*from\s+"\.\/posthogSdk\.js"/m.test(ler(f)));
    expect(estaticos).toEqual([]);
    const dinamicos = APP.filter((f) => ler(f).includes('import("./posthogSdk.js")'));
    expect(dinamicos).toEqual(["analytics/posthog.ts"]);
  });

  it("a variante é a slim no-external, sem nenhuma extensão de coleta passada a ela", () => {
    const f = ler("analytics/posthogSdk.ts");
    expect(f).toMatch(/from "posthog-js\/dist\/module\.slim\.no-external\.js";/);
    expect(f).not.toMatch(/__extensionClasses/);
    expect(f).not.toMatch(/posthog-js\/dist\/extension|posthog-js\/extensions/);
  });

  it("nenhum arquivo do app identifica pessoa", () => {
    for (const f of APP) {
      const s = ler(f);
      for (const proibido of [/\.identify\(/, /\.alias\(/, /setPersonProperties/, /\.group\(/, /\.register(_once)?\(/, /\$set_once\s*:/]) {
        expect(proibido.test(s), `${f} ${proibido}`).toBe(false);
      }
    }
  });
});

describe("todo track usa o conjunto fechado", () => {
  it("cada analytics.track(\"…\") do app é um evento conhecido", () => {
    const usados = new Set<string>();
    for (const f of APP) for (const m of ler(f).matchAll(/analytics\.track\(\s*"([a-z_$]+)"/g)) usados.add(m[1]);
    for (const e of usados) expect(EVENTOS as readonly string[], e).toContain(e);
  });

  it("todo evento do conjunto é disparado por algum lugar do app (nenhum declarado à toa)", () => {
    const tudo = APP.map(ler).join("\n");
    for (const e of EVENTOS) {
      const direto = new RegExp(`analytics\\.track\\(\\s*"${e}"`).test(tudo);
      const porFuncao = e === "match_started" || e === "first_match_started" || e === "match_finished";
      expect(direto || porFuncao, e).toBe(true);
    }
  });
});

describe("cada ponto de captura no lugar certo", () => {
  it("a abertura: iniciarAnalytics antes do render, anunciarAbertura no App", () => {
    const main = ler("main.tsx");
    expect(main.indexOf("iniciarAnalytics();")).toBeGreaterThan(-1);
    expect(main.indexOf("iniciarAnalytics();")).toBeLessThan(main.indexOf(".render("));
    expect(ler("App.tsx")).toMatch(/useEffect\(\(\) => \{ anunciarAbertura\(\); \}, \[\]\)/);
  });

  it("partida local anuncia com modo local, 1 humano e 3 bots", () => {
    expect(ler("game/useKingGame.ts")).toMatch(/anunciarInicioDePartida\(\{ modo: "local", humanos: 1, bots: 3 \}\)/);
  });

  it("partida online anuncia com o id da partida, para deduplicar reload", () => {
    const f = ler("game/useKingOnline.ts");
    expect(f).toMatch(/anunciarInicioDePartida\(\{ modo: "online", \.\.\.contarAssentos\(s\.estado\(\)\?\.seats\), partidaId: u\.matchId \}\)/);
  });

  it("sala criada/entrada só DEPOIS de abrir de verdade (falha não conta)", () => {
    const f = ler("game/useKingOnline.ts");
    const abrir = f.indexOf("const s = await abrir(pedido);");
    expect(abrir).toBeGreaterThan(-1);
    for (const e of ["room_created", "room_joined"]) {
      const i = f.indexOf(`analytics.track("${e}"`);
      expect(i, e).toBeGreaterThan(abrir);
      expect(f.indexOf(`analytics.track("${e}"`, i + 1), `${e} só uma vez`).toBe(-1);
      expect(i, `${e} antes do catch`).toBeLessThan(f.indexOf("} catch (e) {", abrir));
    }
  });

  it("o fim de partida sai do Placar com modo, posição, empate e o id online", () => {
    expect(ler("ui/PlacarFinal.tsx")).toMatch(/anunciarFimDePartida\(\{ modo, posicao: minhaPosicao, empate: meuEmpate, partidaId: mp\?\.matchId \}\)/);
  });

  it("result_shared só depois de compartilhar ou copiar de fato — nunca com o texto", () => {
    const f = ler("ui/PlacarFinal.tsx");
    expect(f).toMatch(/await navigator\.share\(\{ title: "KING", text: texto \}\);\n\s*analytics\.track\("result_shared", \{ method: "native_share" \}\);/);
    expect(f.match(/await navigator\.clipboard\.writeText\(texto\);\n\s*analytics\.track\("result_shared", \{ method: "clipboard" \}\);/g)).toHaveLength(2);
    expect(f).not.toMatch(/result_shared"[^)]*texto/);
  });

  it("invite_code_copied só no sucesso da cópia, e sem o código", () => {
    const f = ler("ui/Sala.tsx");
    const escrever = f.indexOf("navigator.clipboard?.writeText(codigo).then(");
    const track = f.indexOf('analytics.track("invite_code_copied", {})');
    expect(escrever).toBeGreaterThan(-1);
    expect(track).toBeGreaterThan(escrever);
  });
});

describe("independência", () => {
  it("o analytics não importa identidade nem Supabase: o modo local mede sem conta", () => {
    for (const f of APP.filter((x) => x.startsWith("analytics/"))) {
      expect(ler(f), f).not.toMatch(/from "\.\.\/auth\/|supabase/);
    }
  });

  it("nenhum console fora do aviso de DEV e do adaptador de console", () => {
    for (const f of APP.filter((x) => x.startsWith("analytics/"))) {
      const usos = [...ler(f).matchAll(/console\.(log|warn|info|error|debug)/g)].length;
      expect(usos, f).toBeLessThanOrEqual(f === "analytics/analytics.ts" ? 2 : 0);
    }
    expect(ler("analytics/analytics.ts")).toMatch(/import\.meta\.env\?\.DEV\) \{\n\s*\/\/ eslint-disable-next-line no-console\n\s*console\.warn/);
  });
});
