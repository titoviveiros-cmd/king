// O XP VISÍVEL — Home e Placar Final. Só leitura, dado do banco, e nenhuma mentira de "0 XP".
//
// Renderização estática (Node, sem jsdom), como o resto da suíte: efeitos não rodam aqui, e é
// justamente isso que prova que NADA de XP aparece antes de um crédito real ter chegado. A busca
// assíncrona está provada em `game/xpDaPartida.test.ts`; a Home de verdade, com o SDK e a rede
// interceptada, no Playwright (`tests/progresso.spec.ts`).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import type { Seat } from "@king/engine";
import { KingGame } from "../game/kingGame.js";
import type { ProgressoDoJogador } from "../auth/progresso.js";
import { Home } from "./Home.js";
import { PlacarFinal } from "./PlacarFinal.js";
import type { MesaMultiplayer } from "./MesaOnline.js";
import { ProgressoNaHome, XpNoFim } from "./Progresso.js";

const noop = () => {};
const P: ProgressoDoJogador = { xpTotal: 370, nivel: 3, xpNoNivel: 120, xpDoNivel: 200 };
const semComentarios = (f: string) => f.replace(/\r\n/g, "\n").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("Home — o card do jogador", () => {
  const home = (progresso?: ProgressoDoJogador | null) => parse(renderToStaticMarkup(<Home onStart={noop} onOpenAudio={noop} progresso={progresso} />));

  it("com progresso real: nível, barra proporcional, XP no nível e total", () => {
    const r = home(P);
    const card = r.querySelector(".hm-progresso")!;
    expect(card).toBeTruthy();
    expect(card.querySelector(".pg-nivel b")!.text).toBe("3");
    expect(card.querySelector(".pg-numeros")!.text).toBe("120 / 200 XP");
    expect(card.querySelector(".pg-total")!.text).toBe("370 XP total");
    expect(card.querySelector(".pg-barra i")!.getAttribute("style")).toContain("width:60%");
    expect(card.getAttribute("aria-label")).toBe("Nível 3: 120 de 200 XP neste nível, 370 XP no total");
  });

  it("sem progresso (sem sessão, leitura falhou ou ainda não chegou): a Home de sempre, sem card", () => {
    for (const p of [undefined, null]) expect(home(p).querySelector(".hm-progresso")).toBeNull();
  });

  it("o card vem DEPOIS das ações de jogo — secundário a elas", () => {
    const html = renderToStaticMarkup(<Home onStart={noop} onOpenAudio={noop} progresso={P} />);
    expect(html.indexOf("Jogar agora")).toBeLessThan(html.indexOf("hm-progresso"));
  });

  it("a barra nunca passa de 100% nem fica negativa, mesmo com dado estranho", () => {
    const largura = (p: ProgressoDoJogador) =>
      parse(renderToStaticMarkup(<ProgressoNaHome progresso={p} />)).querySelector(".pg-barra i")!.getAttribute("style");
    expect(largura({ ...P, xpNoNivel: 500 })).toContain("width:100%");
    expect(largura({ ...P, xpDoNivel: 0 })).toContain("width:0%");
  });
});

/** Uma partida inteira pelo motor de verdade: é o que dá ao Placar Final o que desenhar. */
function partidaCompleta(): KingGame {
  const g = new KingGame(["Tito", "Raiza", "Léo", "Nara"], 42);
  for (let guarda = 0; guarda < 40_000 && g.phase() !== "matchEnd"; guarda++) {
    if (g.isHumanTurn()) g.playHuman(g.legalCards()[0]);
    else if (g.needsBotPlay()) g.stepBotPlay();
    else if (g.needsBotTrump()) g.stepBotTrump();
    else if (g.phase() === "trump") g.chooseTrumpHuman("hearts");
    else if (g.phase() === "handEnd") g.advanceHand();
    else break;
  }
  return g;
}
const mp = (extra: Partial<MesaMultiplayer> = {}): MesaMultiplayer => ({
  eu: 0 as Seat, sala: null, conexao: "online", relogio: null, prontos: [], recusa: null, emVoo: null,
  aguardando: false, pediProximaMao: false, mensagens: {}, onEnviarMensagem: noop, onCancelarProximaMao: noop, ...extra,
});

describe("Placar Final — o XP da partida", () => {
  it("o bloco mostra o crédito REAL e o nível relido", () => {
    const r = parse(renderToStaticMarkup(<XpNoFim xp={{ credito: { xpDelta: 115, posicao: 3 }, progresso: { xpTotal: 115, nivel: 2, xpNoNivel: 15, xpDoNivel: 150 } }} />));
    expect(r.querySelector(".fimxp-ganho")!.text).toBe("+115 XP");
    expect(r.querySelector(".fimxp-rotulo")!.text).toBe("Nível 2");
    expect(r.querySelector(".fimxp-num")!.text).toBe("15 / 150 XP");
  });

  it("crédito sem a releitura do progresso: só o '+N XP', sem nível inventado", () => {
    const r = parse(renderToStaticMarkup(<XpNoFim xp={{ credito: { xpDelta: 100, posicao: 4 }, progresso: null }} />));
    expect(r.querySelector(".fimxp-ganho")!.text).toBe("+100 XP");
    expect(r.querySelector(".fimxp-nivel")).toBeNull();
  });

  it("MODO LOCAL: nenhum XP no fim — nem bloco, nem busca", () => {
    const r = parse(renderToStaticMarkup(<PlacarFinal game={partidaCompleta()} onRestart={noop} onHome={noop} />));
    expect(r.querySelector(".fimxp")).toBeNull();
    expect(r.text).not.toMatch(/\bXP\b/);
  });

  it("MULTIPLAYER antes de o crédito chegar: nada de XP na tela — nunca um '0 XP' provisório", () => {
    const leitor = { meuProgresso: async () => null, creditoDaPartida: async () => null };
    const r = parse(renderToStaticMarkup(
      <PlacarFinal game={partidaCompleta()} onRestart={noop} onHome={noop} mp={mp({ matchId: "33333333-3333-4333-8333-333333333333", progresso: leitor })} />,
    ));
    expect(r.querySelector(".fimxp")).toBeNull();
    expect(r.text).not.toMatch(/0 XP|não ganhou/i);
  });

  it("a fiação: busca pelo matchId e leitor do `mp`, e o bloco só dentro de 'completo'", () => {
    const codigo = semComentarios(readFileSync(new URL("./PlacarFinal.tsx", import.meta.url), "utf8"));
    expect(codigo).toContain("xpParaExibir(useXpDaPartida(mp?.matchId, mp?.progresso))");
    // O fragmento EXATO de "completo" na coluna de dados: do `<>` ao `</>` que o fecha.
    const inicio = codigo.indexOf("{completo && (\n            <>");
    const fim = codigo.indexOf("</>", inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(codigo.slice(inicio, fim)).toContain("{xp && <XpNoFim xp={xp} />}");
    expect(codigo.match(/<XpNoFim/g)).toHaveLength(1); // um lugar só: re-render não duplica
  });

  it("o multiplayer entrega o matchId AUTORITATIVO da partida corrente e o leitor único", () => {
    const codigo = semComentarios(readFileSync(new URL("../ModoOnline.tsx", import.meta.url), "utf8"));
    expect(codigo).toContain("matchId: g.game.matchId");
    expect(codigo).toContain("progresso: leitorDeProgressoConfigurado()");
  });
});

describe("o cliente é SÓ LEITURA de progresso", () => {
  const RAIZ = fileURLToPath(new URL("..", import.meta.url));
  const fontes = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const c = join(dir, n);
    if (statSync(c).isDirectory()) return fontes(c);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [c] : [];
  });

  // Escrita do Supabase é `.from("tabela")…​.update(…)`: um `.delete` de `Set`, `Map` ou
  // `URLSearchParams` não é escrita no banco, e a varredura não pode tratá-lo como se fosse.
  const ESCRITA_NO_BANCO = /\.from\(\s*["'`][^"'`]+["'`]\s*\)(?:(?!\.from\()[\s\S]){0,400}?\.(insert|update|upsert|delete)\s*\(/;
  const SEMPRE_PROIBIDO = /\.(insert|upsert)\s*\(|\.rpc\s*\(|creditar_partida|service_role/;

  it("nenhum arquivo do app escreve em progresso, ledger ou chama a função de crédito", () => {
    const culpados = fontes(RAIZ).filter((f) => {
      const t = semComentarios(readFileSync(f, "utf8"));
      return ESCRITA_NO_BANCO.test(t) || SEMPRE_PROIBIDO.test(t);
    });
    expect(culpados).toEqual([]);
  });

  it("a varredura PEGA uma escrita de verdade (e não confunde com Set.delete)", () => {
    expect(ESCRITA_NO_BANCO.test('c.from("progresso").update({ xp_total: 1 }).eq("player_id", id)')).toBe(true);
    expect(ESCRITA_NO_BANCO.test('await c.from("xp_eventos")\n  .delete()')).toBe(true);
    expect(SEMPRE_PROIBIDO.test('c.rpc("creditar_partida", {})')).toBe(true);
    expect(ESCRITA_NO_BANCO.test("this.listeners.delete(fn); u.searchParams.delete(p);")).toBe(false);
  });
});
