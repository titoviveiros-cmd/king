// O QUE A HOME DIZ SOBRE A CONTA — e o que ela se recusa a dizer.
//
// A tela tem uma responsabilidade pequena e uma armadilha grande. A pequena: mostrar o convite
// certo para cada estado. A grande: o VERBO. "Entrar com Google" prometeria trocar de usuário, e
// quem chega aqui já tem conta — o convidado do Supabase é uma conta de verdade, com o progresso
// e a identidade de mesa dele. O botão salva o que já existe; não entra em lugar nenhum.
//
// Renderização estática, como os outros testes de componente do projeto: o que se mede é o que a
// Home ESCREVE em cada estado, não o clique — a mecânica do clique está em `auth/conta.test.ts`.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import { Home } from "./Home.js";
import type { ContaDaHome } from "../auth/useConta.js";

const noop = () => {};

function render(conta?: ContaDaHome) {
  return parse(renderToStaticMarkup(
    <Home onStart={noop} onOpenAudio={noop} conta={conta} />,
  ));
}

describe("a conta na Home", () => {
  it("sem vínculo configurado, a Home é a de sempre — nem botão, nem aviso", () => {
    const dom = render(undefined);
    expect(dom.querySelectorAll(".hm-conta")).toHaveLength(0);
    expect(dom.text).not.toMatch(/google/i);
  });

  it("convidado: convida a SALVAR, e nunca a entrar", () => {
    const dom = render({ estado: "guest", aviso: null, onVincular: noop });
    const botao = dom.querySelector(".hm-conta-btn")!;
    expect(botao.text.trim()).toBe("Salvar progresso com Google");
    expect(botao.text, "'entrar' prometeria trocar de usuário").not.toMatch(/entrar/i);
    expect(botao.getAttribute("disabled")).toBeFalsy();
  });

  it("vinculado: vira estado, não ação — e o botão some", () => {
    const dom = render({ estado: "google", aviso: null, onVincular: noop });
    expect(dom.querySelector(".hm-conta-ok")!.text.trim()).toBe("Google conectado");
    expect(dom.querySelectorAll(".hm-conta-btn")).toHaveLength(0);
  });

  it("em curso: o botão continua visível, desabilitado, sem prometer conclusão", () => {
    const dom = render({ estado: "processando", aviso: null, onVincular: noop });
    const botao = dom.querySelector(".hm-conta-btn")!;
    expect(botao.text.trim()).toBe("Conectando…");
    expect(botao.getAttribute("disabled")).toBeDefined();
  });

  it("o aviso é neutro e anunciado, e nunca carrega identificador", () => {
    const aviso = "A conta que voltou do Google não é a mesma. Nada foi alterado.";
    const dom = render({ estado: "guest", aviso, onVincular: noop });
    const p = dom.querySelector(".hm-conta-aviso")!;
    expect(p.text.trim()).toBe(aviso);
    expect(p.getAttribute("role")).toBe("status");
    expect(p.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("a Home continua jogável em qualquer estado da conta — o jogo não depende de conta", () => {
    for (const estado of ["guest", "google", "processando", "erro"] as const) {
      const dom = render({ estado, aviso: null, onVincular: noop });
      expect(dom.text, `estado ${estado}`).toContain("Jogar agora");
    }
  });
});
