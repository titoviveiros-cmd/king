// O XP VISÍVEL — Home e Placar Final. Só leitura, dado do banco, e nenhuma mentira de "0 XP".
//
// Renderização estática (Node, sem jsdom), como o resto da suíte: efeitos não rodam aqui, e é
// justamente isso que prova que NADA de XP aparece antes de um crédito real ter chegado. A busca
// assíncrona está provada em `game/xpDaPartida.test.ts`; a Home de verdade, com o SDK e a rede
// interceptada, no Playwright (`tests/progresso.spec.ts`).
import { describe, expect, it, vi } from "vitest";
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

  it("SEM sequência (banco sem a migração): o card é byte a byte o de antes", () => {
    const html = renderToStaticMarkup(<ProgressoNaHome progresso={P} />);
    expect(html).not.toMatch(/pg-lado|pg-seq|pg-recorde|🔥|Sequência|Recorde/);
    expect(html).toContain('</span><span class="pg-total">370 XP total</span></div>');
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

describe("Home — a sequência no card", () => {
  const PARTIDA = "33333333-3333-4333-8333-333333333333";
  const card = (sequencia: ProgressoDoJogador["sequencia"]) => parse(renderToStaticMarkup(<ProgressoNaHome progresso={{ ...P, sequencia }} />));
  const textos = (r: ReturnType<typeof card>) => ({
    seq: r.querySelector(".pg-seq")?.text ?? null,
    recorde: r.querySelector(".pg-recorde")?.text ?? null,
    hoje: r.querySelector(".pg-seq")?.classList.contains("hoje") ?? null,
  });

  it("sequência viva e recorde maior: as duas linhas, e o total continua lá", () => {
    const r = card({ atual: 3, recorde: 7, hoje: true, partida: PARTIDA });
    expect(textos(r)).toEqual({ seq: "🔥 Sequência 3 dias", recorde: "Recorde: 7 dias", hoje: true });
    expect(r.querySelector(".pg-lado .pg-total")!.text).toBe("370 XP total");
    expect(r.querySelector(".hm-progresso")!.getAttribute("aria-label"))
      .toBe("Nível 3: 120 de 200 XP neste nível, 370 XP no total; sequência de 3 dias, recorde de 7 dias");
  });

  it("singular, e recorde igual à atual não se repete", () => {
    expect(textos(card({ atual: 1, recorde: 1, hoje: true, partida: PARTIDA }))).toEqual({ seq: "🔥 Sequência 1 dia", recorde: null, hoje: true });
    expect(textos(card({ atual: 5, recorde: 5, hoje: false, partida: PARTIDA })).recorde).toBeNull();
  });

  it("viva mas ainda não jogou hoje: mesmo número, sem alarme — só o tom muda", () => {
    expect(textos(card({ atual: 4, recorde: 4, hoje: false, partida: PARTIDA }))).toEqual({ seq: "🔥 Sequência 4 dias", recorde: null, hoje: false });
  });

  it("estado ZERO (nunca qualificou): convite, e o convite diz ONLINE — partida contra os bots não conta", () => {
    const t = textos(card({ atual: 0, recorde: 0, hoje: false, partida: null }));
    expect(t).toEqual({ seq: "🔥 Comece hoje: jogue online", recorde: null, hoje: false });
  });

  it("depois de uma sequência que acabou: o mesmo convite, e o recorde guardado (sem '1 dia' de consolo)", () => {
    expect(textos(card({ atual: 0, recorde: 6, hoje: false, partida: PARTIDA }))).toEqual({ seq: "🔥 Comece hoje: jogue online", recorde: "Recorde: 6 dias", hoje: false });
    expect(textos(card({ atual: 0, recorde: 1, hoje: false, partida: PARTIDA })).recorde).toBeNull();
  });

  it("NENHUM texto punitivo e NENHUM convite que sugira que partida solo/contra bots conta", () => {
    const estados: NonNullable<ProgressoDoJogador["sequencia"]>[] = [
      { atual: 0, recorde: 0, hoje: false, partida: null }, { atual: 0, recorde: 9, hoje: false, partida: PARTIDA },
      { atual: 1, recorde: 1, hoje: true, partida: PARTIDA }, { atual: 2, recorde: 9, hoje: false, partida: PARTIDA },
    ];
    for (const s of estados) {
      const r = card(s);
      const visivel = r.text;
      const tudo = `${visivel} ${r.querySelector(".hm-progresso")!.getAttribute("aria-label")}`;
      expect(tudo, JSON.stringify(s)).not.toMatch(/perd|quebr|acab|zer(ou|ada)|não jog|ainda dá tempo|corra|últim|cuidado|!|bots?\b|sozinh|solo|local/i);
      // todo convite a jogar diz onde a partida conta
      if (/jogue/i.test(visivel)) expect(visivel).toMatch(/jogue online/i);
    }
  });

  it("RELÓGIO DO APARELHO ADULTERADO: o card desenha o mesmo — ele não olha a hora", () => {
    const s = { atual: 2, recorde: 5, hoje: true, partida: PARTIDA };
    const antes = renderToStaticMarkup(<ProgressoNaHome progresso={{ ...P, sequencia: s }} />);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2031-06-15T12:00:00Z"));
      expect(renderToStaticMarkup(<ProgressoNaHome progresso={{ ...P, sequencia: s }} />)).toBe(antes);
    } finally {
      vi.useRealTimers();
    }
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

  it("MODO LOCAL/SOLO: nenhuma sequência no fim — nem número, nem fogo, nem convite", () => {
    const r = parse(renderToStaticMarkup(<PlacarFinal game={partidaCompleta()} onRestart={noop} onHome={noop} />));
    expect(r.querySelector(".fimxp-seq")).toBeNull();
    expect(r.text).not.toMatch(/sequência|🔥|recorde/i);
  });

  it("esta partida qualificou o dia: '🔥 Sequência: N dias' na mesma linha do XP, e no rótulo acessível", () => {
    const PARTIDA = "33333333-3333-4333-8333-333333333333";
    const xp = { credito: { xpDelta: 150, posicao: 1 }, progresso: { ...P, sequencia: { atual: 3, recorde: 7, hoje: true, partida: PARTIDA } } };
    const r = parse(renderToStaticMarkup(<XpNoFim xp={xp} matchId={PARTIDA} />));
    expect(r.querySelector(".fimxp .fimxp-seq")!.text).toBe("🔥 Sequência: 3 dias");
    expect(r.querySelector(".fimxp")!.getAttribute("aria-label")).toBe("Você ganhou 150 XP nesta partida; sequência de 3 dias");
    const um = parse(renderToStaticMarkup(<XpNoFim xp={{ ...xp, progresso: { ...P, sequencia: { atual: 1, recorde: 7, hoje: true, partida: PARTIDA } } }} matchId={PARTIDA} />));
    expect(um.querySelector(".fimxp-seq")!.text).toBe("🔥 Sequência: 1 dia");
  });

  it("o dia JÁ tinha sido qualificado por outra partida: XP aparece, sequência NÃO — nenhum avanço fingido", () => {
    const xp = { credito: { xpDelta: 150, posicao: 1 }, progresso: { ...P, sequencia: { atual: 3, recorde: 7, hoje: true, partida: "44444444-4444-4444-8444-444444444444" } } };
    const r = parse(renderToStaticMarkup(<XpNoFim xp={xp} matchId="33333333-3333-4333-8333-333333333333" />));
    expect(r.querySelector(".fimxp-ganho")!.text).toBe("+150 XP");
    expect(r.querySelector(".fimxp-seq")).toBeNull();
    expect(r.text).not.toMatch(/sequência|🔥/i);
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
    expect(codigo.slice(inicio, fim)).toContain("{xp && <XpNoFim xp={xp} matchId={mp?.matchId} />}");
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

  it("a SEQUÊNCIA não tem relógio, armazenamento nem evento no cliente", () => {
    // O banco decide tudo: o cliente não conta dia, não guarda sequência no aparelho (o que seria
    // uma sequência "local" paralela) e não manda evento de sequência para o analytics.
    const arquivos = ["ui/Progresso.tsx", "game/xpDaPartida.ts", "auth/progresso.ts", "game/useMeuProgresso.ts"];
    for (const a of arquivos) {
      const t = semComentarios(readFileSync(join(RAIZ, a), "utf8"));
      expect(t, a).not.toMatch(/\bDate\b|performance\.now|Intl\.DateTimeFormat|getTimezoneOffset/);
      expect(t, a).not.toMatch(/(localStorage|sessionStorage)\??\.setItem|indexedDB/); // só a sessão do SDK é LIDA
      expect(t, a).not.toMatch(/analytics|track\(/);
    }
    const todos = fontes(RAIZ).map((f) => semComentarios(readFileSync(f, "utf8"))).join("\n");
    expect(todos).not.toMatch(/streak_(started|incremented|broken)|sequencia_(iniciada|avancou|quebrou)/i);
    expect(todos).not.toMatch(/["'`]king[:.]sequencia/i);
  });

  it("a varredura PEGA uma escrita de verdade (e não confunde com Set.delete)", () => {
    expect(ESCRITA_NO_BANCO.test('c.from("progresso").update({ xp_total: 1 }).eq("player_id", id)')).toBe(true);
    expect(ESCRITA_NO_BANCO.test('await c.from("xp_eventos")\n  .delete()')).toBe(true);
    expect(SEMPRE_PROIBIDO.test('c.rpc("creditar_partida", {})')).toBe(true);
    expect(ESCRITA_NO_BANCO.test("this.listeners.delete(fn); u.searchParams.delete(p);")).toBe(false);
  });
});
