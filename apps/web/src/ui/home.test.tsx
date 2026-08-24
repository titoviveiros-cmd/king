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

describe("o fluxo de entrada", () => {
  it("apelido → avatar → criar/entrar, nesta ordem", () => {
    const apelido = FONTE.indexOf("Seu apelido");
    const avatar = FONTE.indexOf("hm-avatares");
    const criar = FONTE.indexOf("Criar uma sala");
    expect(apelido).toBeGreaterThan(-1);
    expect(avatar).toBeGreaterThan(apelido);
    expect(criar).toBeGreaterThan(avatar);
  });

  it("as duas portas de entrada levam o avatar junto", () => {
    expect(FONTE).toContain("online.onCriar(nome, avatar)");
    expect(FONTE).toContain("online.onEntrar(codigo, nome, avatar)");
  });

  it("a escolha é lembrada localmente — e é só isso que o localStorage faz aqui", () => {
    expect(FONTE).toContain("lembrarAvatar(id)");
    expect(FONTE).toContain("useState<Avatar>(avatarLembrado)");
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
