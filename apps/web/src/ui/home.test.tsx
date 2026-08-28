/**
 * A HOME — a parte que virou identidade.
 *
 * Render estático (Node puro, sem jsdom): o que dá para afirmar por render é o que aparece antes
 * de qualquer clique. O painel de amigos abre por estado interno, então a ORDEM da entrada e a
 * passagem do avatar adiante são conferidas na fonte — é pouco, mas pega exatamente a regressão
 * que interessa: alguém remover o argumento e nada quebrar.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parse, type HTMLElement } from "node-html-parser";
import { Home, type OnlineDaHome } from "./Home.js";
import { AVATAR_PADRAO, AVATARES, desenhoDoAvatar } from "./avatares.js";

const noop = () => {};
const FONTE = readFileSync(new URL("./Home.tsx", import.meta.url), "utf8");

function render(online?: Partial<OnlineDaHome>): HTMLElement {
  const props: OnlineDaHome | undefined = online && {
    indisponivel: null, podeVoltar: false, onCriar: noop, onEntrar: noop, onVoltar: noop, ...online,
  };
  return parse(renderToStaticMarkup(<Home onStart={noop} onOpenAudio={noop} online={props} />));
}

describe("a Home antes do painel abrir", () => {
  it("build local não ganhou nada: sem convite, sem seletor", () => {
    const root = render();
    expect(root.text).not.toContain("Jogar com amigos");
    expect(root.querySelectorAll(".hm-avatares")).toHaveLength(0);
  });

  it("com multiplayer o convite existe, e o seletor só vem quando o painel abre", () => {
    const root = render({});
    expect(root.text).toContain("Jogar com amigos");
    expect(root.querySelectorAll(".hm-online")).toHaveLength(0);
    expect(root.querySelectorAll(".hm-avatares")).toHaveLength(0);
  });
});

/**
 * O AVATAR NÃO VEM ESCOLHIDO, E É PEDIDO QUANDO FAZ FALTA.
 *
 * A Home abria com o último avatar já marcado, lido do `localStorage`. Parecia conveniência; na
 * prática o jogo escolhia por quem chegava, e criar uma sala levava essa decisão silenciosa junto.
 * Agora nasce `null`, e as ações que precisam de identidade abrem o seletor antes de seguir.
 */
describe("o fluxo de entrada", () => {
  it("nenhum avatar nasce escolhido", () => {
    expect(FONTE).toContain("useState<Avatar | null>(null)");
    expect(FONTE, "a pré-seleção por localStorage voltou").not.toContain("avatarLembrado");
  });

  it("nada de avatar é gravado nem lido do armazenamento local", () => {
    // Só a parte EXECUTÁVEL: os comentários citam `localStorage` de propósito, para explicar por
    // que ele saiu. Um teste que lesse a prosa junto proibiria contar a própria história.
    const codigo = FONTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toContain("lembrarAvatar");
    expect(codigo).not.toContain("localStorage");
  });

  it("as três portas passam pelo pedido de avatar antes de seguir", () => {
    // Jogar solo, criar sala e entrar numa sala: todas precisam de identidade, e nenhuma
    // continua sem ela. `comAvatar` é o único caminho.
    expect(FONTE).toContain("comAvatar(onStart)");
    expect(FONTE).toContain("comAvatar((a) => online.onCriar(nome, a))");
    expect(FONTE).toContain("comAvatar((a) => online.onEntrar(codigo, nome, a))");
  });

  it("a ação pedida continua sozinha depois da escolha", () => {
    // O seletor não é um passo que a pessoa precisa lembrar de cumprir: ele é a primeira metade
    // do que ela já pediu. Se o `acao(id)` sumir, o toque vira um beco sem saída.
    expect(FONTE).toContain("acao(id)");
  });
});

describe("a coleção oferecida", () => {
  it("são oito, e o padrão está entre elas", () => {
    expect(AVATARES).toHaveLength(8);
    expect(AVATARES as readonly string[]).toContain(AVATAR_PADRAO);
  });

  it("cada uma tem rótulo próprio — o seletor não é oito símbolos mudos", () => {
    for (const a of AVATARES) expect(desenhoDoAvatar(a).rotulo).toMatch(/\S/);
    expect(new Set(AVATARES.map((a) => desenhoDoAvatar(a).rotulo)).size).toBe(AVATARES.length);
  });
});
