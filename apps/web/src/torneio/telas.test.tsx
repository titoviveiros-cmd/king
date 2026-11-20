/**
 * AS TELAS DO TORNEIO lidas PARADAS — render estático, sem jsdom, sem animação.
 *
 * O que se afirma aqui é o que a pessoa entende sem som e sem movimento: o texto de quem passou,
 * o critério do desempate, o título do campeão, os papéis e rótulos para leitor de tela. E a Home
 * com a terceira porta.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import { Home } from "../ui/Home.js";
import { Chave } from "./Chave.js";
import { Celebracao } from "./Celebracao.js";
import { FORMATOS } from "./formatos.js";
import { TelaClassificacao, TelaConfronto, TelaEliminado, TelaEscolha, TelaFim } from "./telas.js";
import { jogarMesaDeBots } from "./simulacao.js";
import {
  avancarFase, campeao, criarTorneio, nomesDaMesa, registrarResultado, situacao, ID_DO_HUMANO, type Torneio,
} from "./orquestrador.js";
import type { FatosDaMesa } from "./desempate.js";

const noop = () => {};
const html = (el: JSX.Element) => parse(renderToStaticMarkup(el));

function ateJogar(t0: Torneio): Torneio {
  let t = t0;
  for (;;) {
    const s = situacao(t);
    if (s.tipo === "simular") for (const m of s.mesas) t = registrarResultado(t, m.id, jogarMesaDeBots(nomesDaMesa(t, m), m.semente));
    else if (s.tipo === "avancar") t = avancarFase(t);
    else return t;
  }
}

/** Empate no total entre o humano (assento 0) e o assento 1, decidido pelas negativas. */
const EMPATE: FatosDaMesa = { pontos: [100, 100, -50, -150], negativas: [-200, -300, -350, -450], ilesas: [2, 1, 1, 0] };

describe("a Home com o mini-torneio", () => {
  it("três modalidades, e o torneio pede o avatar como as outras portas", () => {
    const root = html(<Home onStart={noop} onOpenAudio={noop} online={{ indisponivel: null, podeVoltar: false, onCriar: noop, onEntrar: noop, onVoltar: noop }} torneio={{ onAbrir: noop, podeContinuar: false, onContinuar: noop }} />);
    const rotulos = root.querySelectorAll(".row .btn").map((b) => b.text.trim());
    expect(rotulos).toEqual(["▶ Jogar agora", "Jogar com amigos", "Jogar mini-torneio"]);
    expect(root.text).not.toContain("Continuar mini-torneio");
    expect(readFileSync(new URL("../ui/Home.tsx", import.meta.url), "utf8")).toContain("comAvatar(torneio.onAbrir)");
  });

  it("o botão do torneio NÃO é `.btn.gold`: o seletor das specs da Mesa continua único", () => {
    const root = html(<Home onStart={noop} onOpenAudio={noop} torneio={{ onAbrir: noop, podeContinuar: true, onContinuar: noop }} />);
    expect(root.querySelectorAll(".btn.gold")).toHaveLength(1);
    expect(root.text).toContain("↩ Continuar mini-torneio");
  });

  it("sem a prop, a Home é a de sempre", () => {
    expect(html(<Home onStart={noop} onOpenAudio={noop} />).text).not.toMatch(/torneio/i);
  });
});

describe("telas", () => {
  it("escolha: dois formatos, com rótulo que diz o tamanho e o caminho", () => {
    const root = html(<TelaEscolha onEscolher={noop} onSair={noop} />);
    const formatos = root.querySelectorAll(".tn-formato");
    expect(formatos.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Mini-torneio: 16 participantes, 3 partidas até o título",
      "Copa Completa: 32 participantes, 4 partidas até o título",
    ]);
    expect(formatos.every((b) => b.tagName === "BUTTON")).toBe(true);
  });

  it("chave: região rotulada, caminho do jogador marcado e vagas a definir", () => {
    const t = criarTorneio("copa32", 5, "leao");
    const root = html(<Chave torneio={t} />);
    expect(root.querySelector('[role="region"]')!.getAttribute("aria-label")).toBe("Chave da Copa Completa");
    expect(root.querySelectorAll(".tn-mesa:not(.tn-mesa-vaga)")).toHaveLength(8);
    expect(root.querySelectorAll(".tn-mesa-vaga")).toHaveLength(7);
    expect(root.querySelectorAll(".tn-meu-caminho")).toHaveLength(1);
    expect(root.querySelector(".tn-meu-caminho")!.getAttribute("aria-label")).toContain("a sua mesa");
  });

  it("confronto da FINAL vira GRANDE FINAL", () => {
    // humano vence tudo até a final
    const vence: FatosDaMesa = { pontos: [1300, -300, -500, -500], negativas: [0, -300, -500, -500], ilesas: [6, 0, 0, 0] };
    let t = ateJogar(criarTorneio("mini16", 3, "leao"));
    for (let i = 0; i < 2; i++) {
      const s = situacao(t);
      if (s.tipo !== "jogar") throw new Error("esperava jogar");
      t = ateJogar(registrarResultado(t, s.mesa.id, vence));
    }
    const s = situacao(t);
    if (s.tipo !== "jogar") throw new Error("esperava a final");
    const root = html(<TelaConfronto torneio={t} mesa={s.mesa} onJogar={noop} onChave={noop} onSair={noop} />);
    expect(root.querySelector("h1")!.text).toBe("GRANDE FINAL");
    expect(root.text).toContain("Quem terminar em 1º é o campeão.");
  });

  it("classificação: o desempate aparece em texto, com o critério e os números", () => {
    let t = ateJogar(criarTorneio("mini16", 9, "leao"));
    const s = situacao(t);
    if (s.tipo !== "jogar") throw new Error("esperava jogar");
    t = registrarResultado(t, s.mesa.id, EMPATE);
    const mesa = t.mesas.find((m) => m.id === s.mesa.id)!;
    const root = html(<TelaClassificacao torneio={t} mesa={mesa} onContinuar={noop} onSair={noop} />);
    const nota = root.querySelector('[role="note"]')!;
    expect(nota.text).toContain("Empate em 100 pts:");
    expect(nota.text).toContain("Você ficou à frente de");
    expect(nota.text).toContain("perdeu menos nas mãos negativas (-200 × -300)");
    expect(nota.text).toContain("1) Pontuação total da partida");
    expect(root.querySelector('[role="status"]')!.text).toBe("Você terminou em 1º e avança.");
    expect(root.querySelectorAll(".tn-tabela li")).toHaveLength(4);
    expect(root.querySelectorAll(".tn-tabela .tn-passou")).toHaveLength(2);
  });

  it("eliminação e fim: legíveis sem animação, com o campeão nomeado", () => {
    const perde: FatosDaMesa = { pontos: [-500, 1300, -300, -500], negativas: [-500, 0, -300, -500], ilesas: [0, 6, 0, 0] };
    let t = ateJogar(criarTorneio("mini16", 12, "coruja"));
    const s = situacao(t);
    if (s.tipo !== "jogar") throw new Error("esperava jogar");
    t = registrarResultado(t, s.mesa.id, perde);
    const el = html(<TelaEliminado torneio={t} onVerResto={noop} onNovo={noop} onSair={noop} />);
    expect(el.querySelector('[role="status"]')!.text).toMatch(/Terminou em [34]º em Mesa \d\./);
    expect(el.querySelector('[aria-label="O seu caminho"]')).not.toBeNull();
    while (campeao(t) === null) t = ateJogar(avancarFase(t));
    const c = campeao(t)!;
    const fim = html(<TelaFim torneio={t} campeaoId={c} onNovo={noop} onChave={noop} onSair={noop} />);
    expect(fim.querySelector("h1")!.text).toBe(`Campeão: ${t.participantes[c].nome}`);
    expect(fim.text).toMatch(/Você parou nas Mesas iniciais \([34]º\)\./);
  });

  it("fim do campeão humano usa o título do formato", () => {
    const vence: FatosDaMesa = { pontos: [1300, -300, -500, -500], negativas: [0, -300, -500, -500], ilesas: [6, 0, 0, 0] };
    let t = ateJogar(criarTorneio("copa32", 3, "leao"));
    while (campeao(t) === null) {
      const s = situacao(t);
      if (s.tipo !== "jogar") throw new Error("esperava jogar");
      t = ateJogar(registrarResultado(t, s.mesa.id, vence));
    }
    expect(campeao(t)).toBe(ID_DO_HUMANO);
    const fim = html(<TelaFim torneio={t} campeaoId={ID_DO_HUMANO} onNovo={noop} onChave={noop} onSair={noop} />);
    const h1 = fim.querySelector("h1")!;
    expect(h1.text).toBe("Campeão da Copa!");
    expect(h1.classList.contains("tn-caixa-alta")).toBe(true); // a caixa alta é só CSS
    expect(fim.querySelector(".tn-vitoria")!.text).toBe("Você venceu a Copa Completa!");
    expect(fim.querySelectorAll(".tn-acoes button").map((b) => b.text)).toEqual(["Começar outro mini-torneio", "Ver a chave", "Home"]);
  });
});

describe("a celebração", () => {
  it("diz tudo em texto desde o primeiro quadro: título, frase, nome, bicho, e como sair", () => {
    const f = FORMATOS.mini16;
    const root = html(<Celebracao titulo={f.tituloDoCampeao} frase={f.fraseDaVitoria} nome="Você" avatar="sapo" onFim={noop} />);
    const d = root.querySelector('[role="dialog"]')!;
    expect(d.getAttribute("aria-label")).toBe("Campeão do mini-torneio!");
    expect(root.querySelector('[role="status"]')!.text).toBe("Campeão do mini-torneio!");
    expect(root.querySelector(".tn-celebra-titulo")!.classList.contains("tn-caixa-alta")).toBe(true);
    expect(root.querySelector(".tn-celebra-frase")!.text).toBe("Você venceu o mini-torneio!");
    expect(root.querySelector(".tn-coroa")).not.toBeNull();
    expect(root.querySelector(".tn-campeao-av")!.text).toBe("🐸");
    expect(root.text).toContain("Você");
    expect(root.text).toContain("Sapo");
    expect(root.text).toContain("toque para continuar");
  });

  it("partículas determinísticas (sem Math.random) e desligadas no movimento reduzido", () => {
    const fonte = readFileSync(new URL("./Celebracao.tsx", import.meta.url), "utf8");
    expect(fonte.replace(/\/\/.*$/gm, "")).not.toContain("Math.random");
    const a = renderToStaticMarkup(<Celebracao titulo="X" nome="Y" avatar="leao" onFim={noop} />);
    const b = renderToStaticMarkup(<Celebracao titulo="X" nome="Y" avatar="leao" onFim={noop} />);
    expect(a).toBe(b);
    const css = readFileSync(new URL("./torneio.css", import.meta.url), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\{[^}]*animation:none !important/);
    expect(css).toMatch(/\.tn-particulas,\.tn-brilho\{display:none;\}/);
  });
});

describe("o som da celebração", () => {
  it("é o motivo da coroa, UMA vez na montagem, e passa pelo motor que obedece às preferências", () => {
    const fonte = readFileSync(new URL("./Celebracao.tsx", import.meta.url), "utf8");
    expect(fonte).toContain("useEffect(() => { sfxVictory(); }, []);");
    expect(fonte.split("sfxVictory()").length - 1).toBe(1);
    // o motor de áudio cala efeitos e vibração conforme as preferências da pessoa
    const motor = readFileSync(new URL("../audio/engine.ts", import.meta.url), "utf8");
    expect(motor).toContain("if (!this.prefs.sfx) return;");
    expect(motor).toContain("if (!this.prefs.haptics) return;");
  });
});

describe("o torneio não toca no que é oficial", () => {
  it("sem rede, sem XP, sem recorde, sem analytics novo", () => {
    const arquivos = ["orquestrador.ts", "persistencia.ts", "executor.ts", "simulacao.ts", "partidaDoTorneio.ts", "ModoTorneio.tsx", "telas.tsx"];
    for (const a of arquivos) {
      const f = readFileSync(new URL(`./${a}`, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
      expect(f, a).not.toMatch(/supabase|colyseus|fetch\(|analytics|registrarSolo|posthog/i);
    }
    expect(readFileSync(new URL("./partidaDoTorneio.ts", import.meta.url), "utf8")).toContain("{ recordes: false }");
  });
});
