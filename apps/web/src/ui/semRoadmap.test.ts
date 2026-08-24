// NENHUM NOME DE ETAPA INTERNA PODE CHEGAR AO JOGADOR.
//
// Existe por causa de um caso real: o Placar Final dizia "XP e conquistas entram na Fase 7".
// "Fase 7" é vocabulário deste projeto — para quem baixou o jogo, lê-se como software inacabado,
// e numa loja de aplicativos isso é o tipo de detalhe que vira avaliação de uma estrela.
//
// A varredura olha só o TEXTO VISÍVEL: conteúdo entre tags e os atributos que o usuário lê ou
// ouve (`aria-label`, `title`, `placeholder`). Comentários de código ficam de fora de propósito —
// é lá que a conversa interna DEVE morar.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Vocabulário de bastidor. Cada um destes já vazou para alguma UI em algum projeto. */
const SUSPEITOS: [RegExp, string][] = [
  [/\bFase\s+\d+/i, "nome de etapa do projeto"],
  [/\bMilestone\b/i, "vocabulário de planejamento"],
  [/\bMVP\b/, "vocabulário de planejamento"],
  [/\bTODO\b|\bFIXME\b/, "marcador de código"],
  [/\bem breve\b/i, "promessa sem data"],
  [/\bbacklog\b/i, "vocabulário de planejamento"],
  [/\bpós-MVP\b/i, "vocabulário de planejamento"],
  [/\bV[12]\b/, "número de versão interna"],
];

const RAIZ = fileURLToPath(new URL("../", import.meta.url));

function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return fontes(p);
    return /\.tsx?$/.test(p) && !/\.test\./.test(p) ? [p] : [];
  });
}

/** Só o que o jogador lê. Comentários (`//`, `/* *​/`) são removidos antes. */
function textoVisivel(fonte: string): string[] {
  const limpo = fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
  const pedacos: string[] = [];
  for (const m of limpo.matchAll(/>([^<>{}]{3,})</g)) pedacos.push(m[1]);
  for (const m of limpo.matchAll(/(?:aria-label|title|placeholder)=\{?["'`]([^"'`]+)/g)) pedacos.push(m[1]);
  return pedacos.map((t) => t.trim()).filter(Boolean);
}

describe("a UI não fala a língua do projeto", () => {
  it("nenhum texto visível carrega nome de etapa, milestone ou marcador de código", () => {
    const achados: string[] = [];
    for (const f of fontes(RAIZ)) {
      const curto = f.slice(f.indexOf("src"));
      for (const t of textoVisivel(readFileSync(f, "utf8"))) {
        for (const [re, porque] of SUSPEITOS) {
          if (re.test(t)) achados.push(`${curto} → "${t.slice(0, 60)}" (${porque})`);
        }
      }
    }
    expect(achados, achados.join("\n")).toEqual([]);
  });

  it("o varredor realmente pega — senão passaria verde para sempre", () => {
    const falso = `<div aria-label="Progressão">XP e conquistas entram na Fase 7</div>`;
    const visivel = textoVisivel(falso);
    expect(visivel.some((t) => SUSPEITOS.some(([re]) => re.test(t)))).toBe(true);
  });

  it("comentário de código NÃO é acusado: é onde a conversa interna deve viver", () => {
    const comentado = `// XP e conquistas entram na Fase 7\n<div>Progressão</div>`;
    const visivel = textoVisivel(comentado);
    expect(visivel.some((t) => SUSPEITOS.some(([re]) => re.test(t)))).toBe(false);
  });
});
