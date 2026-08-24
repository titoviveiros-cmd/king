// A TELA DO TUTORIAL — render estático (Node puro, sem jsdom), como o resto da UI do projeto.
//
// O que dá para afirmar por render é a estrutura de cada estado, e é justamente onde as promessas
// de produto vivem: a mesa é a de verdade, o Rei fala uma linha, o progresso aparece e a saída
// está sempre à mão.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, type HTMLElement } from "node-html-parser";
import { Tutorial } from "./Tutorial.js";
import { ROTEIRO, TOTAL_DE_PASSOS } from "./roteiro.js";
import { PROGRESSO_ZERO, type ArmazenamentoDoTutorial, type ProgressoDoTutorial } from "./persistencia.js";

const noop = () => {};

/** Armazenamento de mentira: guarda em memória e deixa o teste espiar o que foi gravado. */
function memoria(inicial: ProgressoDoTutorial = PROGRESSO_ZERO) {
  let atual = { ...inicial };
  const gravados: ProgressoDoTutorial[] = [];
  const arm: ArmazenamentoDoTutorial = {
    ler: () => ({ ...atual }),
    gravar: (p) => { atual = { ...p }; gravados.push({ ...p }); },
  };
  return { arm, gravados, get atual() { return atual; } };
}

function render(passoInicial = 0, arm?: ArmazenamentoDoTutorial): HTMLElement {
  return parse(renderToStaticMarkup(
    <Tutorial onSair={noop} onOpenAudio={noop} armazenamento={arm ?? memoria().arm} passoInicial={passoInicial} />,
  ));
}

describe("a mesa é a de verdade", () => {
  it("desenha o leque, o HUD e os jogadores — não uma maquete", () => {
    const root = render(0);
    expect(root.querySelectorAll(".youtag").length).toBe(1);
    expect(root.querySelectorAll(".opp").length).toBe(3);
    expect(root.querySelector(".hud")).not.toBeNull();
    expect(root.querySelectorAll(".card").length).toBeGreaterThan(0);
  });

  it("na primeira cena já há cartas na mesa — o aluno cai no meio de uma vaza", () => {
    const root = render(0);
    expect(root.querySelectorAll(".trick .slot").length).toBeGreaterThan(0);
  });
});

describe("o Rei orienta sem dominar", () => {
  it("fala exatamente uma linha, e é a do passo", () => {
    const root = render(0);
    const falas = root.querySelectorAll(".rei-fala");
    expect(falas).toHaveLength(1);
    expect(falas[0].text.trim()).toBe(ROTEIRO[0].fala);
  });

  it("o que ele diz é anunciado por leitor de tela", () => {
    const root = render(0);
    expect(root.querySelector(".rei")?.getAttribute("role")).toBe("status");
    expect(root.querySelector(".rei")?.getAttribute("aria-live")).toBe("polite");
  });

  it("em cada passo do roteiro ele diz a fala daquele passo", () => {
    for (let i = 0; i < TOTAL_DE_PASSOS; i++) {
      expect(render(i).querySelector(".rei-fala")?.text.trim(), `passo ${i}`).toBe(ROTEIRO[i].fala);
    }
  });
});

describe("progresso e saída", () => {
  it("mostra em que passo está, de quantos", () => {
    const root = render(4);
    expect(root.querySelector(".tut-passo")?.text.trim()).toBe(`5/${TOTAL_DE_PASSOS}`);
    expect(root.querySelector(".tut-passo")?.getAttribute("aria-label"))
      .toBe(`Passo 5 de ${TOTAL_DE_PASSOS}`);
  });

  it("PULAR está sempre na tela — ninguém é obrigado", () => {
    for (const i of [0, 7, TOTAL_DE_PASSOS - 1]) {
      expect(render(i).querySelector(".tut-pular")?.text.trim(), `passo ${i}`).toBe("Pular");
    }
  });

  it("a confirmação de saída não aparece antes de ser pedida", () => {
    expect(render(0).querySelectorAll(".tut-confirma")).toHaveLength(0);
  });
});

describe("o botão de avançar segue a natureza do passo", () => {
  it("passo de leitura já mostra Continuar", () => {
    const leitura = ROTEIRO.findIndex((p) => p.acao === "toque");
    expect(render(leitura).querySelector(".tut-ok")?.text.trim()).toBe("Continuar");
  });

  it("passo de AÇÃO não mostra Continuar antes de agir — senão dava para pular a lição", () => {
    const acao = ROTEIRO.findIndex((p) => p.acao === "jogar");
    expect(render(acao).querySelectorAll(".tut-ok")).toHaveLength(0);
  });

  it("no último passo o botão convida a jogar, não a continuar", () => {
    expect(render(TOTAL_DE_PASSOS - 1).querySelector(".tut-ok")?.text.trim()).toBe("Jogar!");
  });
});

describe("persistência ao abrir", () => {
  it("abrir já marca INICIADO — quem abriu uma vez não recebe o tutorial de novo sozinho", () => {
    const m = memoria();
    render(0, m.arm);
    expect(m.atual.iniciado).toBe(true);
  });

  it("retoma no passo salvo", () => {
    const m = memoria({ iniciado: true, concluido: false, passo: 9 });
    const root = parse(renderToStaticMarkup(
      <Tutorial onSair={noop} onOpenAudio={noop} armazenamento={m.arm} />,
    ));
    expect(root.querySelector(".tut-passo")?.text.trim()).toBe(`10/${TOTAL_DE_PASSOS}`);
  });

  it("passo salvo fora da faixa não abre tela branca", () => {
    const m = memoria({ iniciado: true, concluido: false, passo: 999 });
    const root = parse(renderToStaticMarkup(
      <Tutorial onSair={noop} onOpenAudio={noop} armazenamento={m.arm} />,
    ));
    expect(root.querySelector(".rei-fala")?.text.trim()).toBe(ROTEIRO[TOTAL_DE_PASSOS - 1].fala);
  });
});
