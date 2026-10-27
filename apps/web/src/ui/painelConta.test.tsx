// O PAINEL "CONTA" E A ENTRADA DELE NA HOME (Fase 9) — o que a tela escreve em cada estado.
//
// Renderização estática, como os outros testes de componente: a mecânica (vincular, recuperar,
// excluir) está provada em `auth/*.test.ts`, e o clique real, no e2e `tests-progresso/conta.spec.ts`.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import { ALTURA_UTIL_DA_EXCLUSAO, PainelConta } from "./PainelConta.js";
import { Home } from "./Home.js";
import type { ContaDaHome, ServicosDaConta } from "../auth/useConta.js";

const noop = () => {};
const recuperacao = { provedores: ["apple", "google"] as ("apple" | "google")[], recuperar: async () => ({ tipo: "ja-e-esta" as const }) };
const exclusao = { excluir: async () => ({ tipo: "sem-conta" as const }) };

function painel(conta: ContaDaHome | null, servicos: ServicosDaConta) {
  return parse(renderToStaticMarkup(<PainelConta conta={conta} servicos={servicos} onFechar={noop} onRecomecar={noop} />));
}

describe("o painel Conta", () => {
  it("a tela de exclusão se compacta pela altura ÚTIL — e, com o item a mais da Apple, antes", () => {
    // sem bordas de segurança, 342 = a janela de 360px menos o respiro (2 × 9px): o ponto já aprovado
    expect(ALTURA_UTIL_DA_EXCLUSAO.normal).toBe(342);
    // a conta Apple no app tem um item a mais: uma linha da lista (11,52px × 1,4 ≈ 16px) — nenhum build
    // de e2e liga o vínculo, então é aqui que o limiar dela fica guardado
    expect(ALTURA_UTIL_DA_EXCLUSAO.comApple - ALTURA_UTIL_DA_EXCLUSAO.normal).toBeGreaterThanOrEqual(16);
  });

  it("convidado no iPhone: Apple PRIMEIRO, depois Google; 'Já tenho uma conta'; 'Excluir conta'", () => {
    const dom = painel({ estado: "guest", aviso: null, onVincular: noop, provedores: ["apple", "google"], nativo: true }, { recuperacao, exclusao });
    expect(dom.querySelector("h2")!.text).toBe("Conta");
    expect(dom.querySelector(".sub")!.text).toBe("Você joga como convidado neste aparelho.");
    const provedores = dom.querySelectorAll(".pc-prov").map((b) => b.text.trim());
    expect(provedores).toHaveLength(2);
    expect(provedores[0]).toMatch(/Continuar com a Apple$/);
    expect(provedores[1]).toBe("Continuar com o Google");
    expect(dom.querySelectorAll(".pc-prov")[0].classList.contains("apple")).toBe(true);
    expect(dom.querySelector(".pc-link")!.text.trim()).toBe("Já tenho uma conta");
    expect(dom.querySelector(".pc-perigo")!.text.trim()).toBe("Excluir conta");
    expect(dom.querySelector("[role=dialog]")!.getAttribute("aria-modal")).toBe("true");
  });

  it("vinculada: vira estado — nada de botão de salvar — e a exclusão continua ali", () => {
    const dom = painel({ estado: "apple", aviso: null, onVincular: noop, provedores: ["apple"], nativo: true }, { recuperacao, exclusao });
    expect(dom.querySelector(".sub")!.text).toBe("Seu progresso está salvo com a Apple.");
    expect(dom.querySelectorAll(".pc-prov")).toHaveLength(0);
    expect(dom.querySelector(".pc-perigo")).not.toBeNull();
  });

  it("web sem vínculo ligado: só o status e a exclusão — sem 'Já tenho uma conta'", () => {
    const dom = painel(null, { recuperacao: null, exclusao });
    expect(dom.querySelectorAll(".pc-prov")).toHaveLength(0);
    expect(dom.text).not.toMatch(/já tenho uma conta/i);
    expect(dom.querySelector(".pc-perigo")).not.toBeNull();
  });

  it("nenhum verbo de 'entrar' para vincular: salvar é a mesma conta", () => {
    const dom = painel({ estado: "guest", aviso: null, onVincular: noop, provedores: ["google"], nativo: true }, { recuperacao: null, exclusao });
    expect(dom.querySelector(".pc-secao h3")!.text).toBe("Salvar progresso");
    expect(dom.querySelector(".pc-secao")!.text).not.toMatch(/entrar/i);
  });
});

describe("a entrada do painel na Home", () => {
  const home = (conta?: ContaDaHome, onAbrirConta?: () => void) =>
    parse(renderToStaticMarkup(<Home onStart={noop} onOpenAudio={noop} conta={conta} onAbrirConta={onAbrirConta} />));

  it("com o painel oferecido, o botão Conta fica no topo, ao lado do som", () => {
    const dom = home(undefined, noop);
    const botao = dom.querySelector(".contabtn")!;
    expect(botao.getAttribute("aria-label")).toBe("Conta");
  });

  it("sem painel (nada a gerenciar), a Home é a de sempre", () => {
    expect(home(undefined, undefined).querySelectorAll(".contabtn")).toHaveLength(0);
  });

  it("no app, o atalho da Home é 'Salvar progresso' (o provedor se escolhe no painel; no iPhone, Apple primeiro)", () => {
    const dom = home({ estado: "guest", aviso: null, onVincular: noop, provedores: ["apple", "google"], nativo: true }, noop);
    expect(dom.querySelector(".hm-conta-btn")!.text.trim()).toBe("Salvar progresso");
    expect(dom.text).not.toMatch(/com google/i);
  });

  it("vinculada com Apple: 'Apple conectada'", () => {
    const dom = home({ estado: "apple", aviso: null, onVincular: noop, nativo: true }, noop);
    expect(dom.querySelector(".hm-conta-ok")!.text.trim()).toBe("Apple conectada");
  });
});
