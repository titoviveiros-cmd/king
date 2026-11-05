/**
 * O PAINEL "DIAGNÓSTICO DE ÁUDIO" (APK DEBUG, rodada 5): existe só com a chave de build, tem os botões
 * pedidos e, onde a WebView não compartilha, oferece o texto na tela em vez de um botão morto.
 * (Que o build normal não carrega nada disso é conferido no pacote gerado — ver o relatório da rodada.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parse } from "node-html-parser";
import { AudioPanel } from "./AudioPanel.js";
import { PainelDiagnosticoDeAudio } from "./DiagnosticoDeAudio.js";
import { criarDiagnostico } from "../audio/diagnostico.js";
import { ambienteDoAparelho, criarSessaoDeDiagnostico } from "../audio/relatorioDeAudio.js";
import type { ResultadoDiferencial } from "../audio/testesDiferenciais.js";

const noop = () => {};
const botoes = (html: string) => parse(html).querySelectorAll("button").map((b) => b.text.trim());
const sessao = () => criarSessaoDeDiagnostico({ diag: criarDiagnostico(noop), sonda: () => null });

describe("o painel de diagnóstico só existe no APK DEBUG", () => {
  it("sem a chave de build (testes = build normal): o painel de som NÃO tem 'Diagnóstico de áudio'", () => {
    const html = renderToStaticMarkup(<AudioPanel onClose={noop} />);
    expect(html).toContain("Som e vibração");
    expect(html).not.toContain("Diagnóstico de áudio");
  });

  it("o painel de som só desenha o botão atrás da constante de build", () => {
    const fonte = readFileSync(new URL("./AudioPanel.tsx", import.meta.url), "utf8");
    expect(fonte).toMatch(/\{DIAG_LIGADO && <BotaoDiagnosticoDeAudio \/>\}/);
    expect(fonte).toMatch(/if \(DIAG_LIGADO\) aoAbrirPainelDeSom\(\); audio\.reativar\(\)/);
  });
});

describe("o painel", () => {
  const amb = () => ambienteDoAparelho({});

  it("com compartilhar: Registrar falha, Testar música, Testar efeito, Tentar recuperar, Copiar e Compartilhar", () => {
    const html = renderToStaticMarkup(
      <PainelDiagnosticoDeAudio onClose={noop} sessao={sessao()} ambiente={amb} nav={{ share: () => Promise.resolve() }} doc={undefined} />,
    );
    const b = botoes(html);
    for (const nome of ["Registrar falha de som", "Testar música", "Testar efeito", "Tentar recuperar", "Copiar diagnóstico", "Compartilhar diagnóstico", "Fechar"]) {
      expect(b, nome).toContain(nome);
    }
  });

  it("sem compartilhar (WebView comum): nada de botão morto — 'Mostrar texto' no lugar", () => {
    const html = renderToStaticMarkup(
      <PainelDiagnosticoDeAudio onClose={noop} sessao={sessao()} ambiente={amb} nav={{}} doc={undefined} />,
    );
    const b = botoes(html);
    expect(b).not.toContain("Compartilhar diagnóstico");
    expect(b).toContain("Mostrar texto");
    expect(b).toContain("Copiar diagnóstico");
  });

  it("estilos inline: nenhuma regra de CSS de diagnóstico no tema (nada sobra no build normal)", () => {
    const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/\.diag[\w-]*[\s,{]|diagn[óo]stico de [áa]udio/i);
  });
});

describe("rodada 6: testes por camada no painel", () => {
  it("botões A, A′, B, C e Ler áudio do sistema, além de Testar música/efeito (D)", () => {
    const html = renderToStaticMarkup(
      <PainelDiagnosticoDeAudio onClose={noop} sessao={sessao()} ambiente={() => ambienteDoAparelho({})} nav={{}} doc={undefined} />,
    );
    const b = botoes(html);
    for (const nome of ["A · Web Audio isolado", "A′ · Direto no motor", "B · Áudio HTML5", "C · Android nativo", "Ler áudio do sistema", "Testar música", "Testar efeito"]) {
      expect(b, nome).toContain(nome);
    }
  });

  it("o plugin nativo é embrulhado num objeto comum (sem o 'then' do Proxy do Capacitor) e só existe no Android", () => {
    const fonte = readFileSync(new URL("./DiagnosticoDeAudio.tsx", import.meta.url), "utf8");
    expect(fonte).toMatch(/const embrulho: PluginDeAudioNativo = \{ estado: \(\) => p\.estado\(\), tocarTom: \(o\) => p\.tocarTom\(o\) \}/);
    expect(fonte).toMatch(/getPlatform\(\) !== "android" \|\| !Capacitor\.isPluginAvailable\("DiagAudioNativo"\)/);
  });
});

describe("rodada 7: experimentos do contexto do KING no painel", () => {
  it("botões R (relógios), I1, I2, Restaurar motor, Escada e Encerrar escada", () => {
    const html = renderToStaticMarkup(
      <PainelDiagnosticoDeAudio onClose={noop} sessao={sessao()} ambiente={() => ambienteDoAparelho({})} nav={{}} doc={undefined} />,
    );
    const b = botoes(html);
    for (const nome of ["R · Medir relógios (60 s)", "I1 · Parar música + A′", "I2 · Isolar grafo + A′", "Restaurar motor", "Escada: próximo degrau (E1)", "Encerrar escada"]) {
      expect(b, nome).toContain(nome);
    }
  });
});

describe("rodada 8: variantes do grafo e a pergunta no topo", () => {
  it("botões das variantes A–E e o Perfil automático (a correção)", () => {
    const html = renderToStaticMarkup(
      <PainelDiagnosticoDeAudio onClose={noop} sessao={sessao()} ambiente={() => ambienteDoAparelho({})} nav={{}} doc={undefined} />,
    );
    const b = botoes(html);
    for (const nome of ["A · original", "B · sem convolução", "C · leve", "D · leve + polifonia reduzida", "E · leve a 24 kHz = a CORREÇÃO do Android", "Perfil automático (a correção)"]) {
      expect(b, nome).toContain(nome);
    }
    expect(parse(html).querySelector("[data-testid=diag-monitor]")?.text).toMatch(/Perfil do grafo: .*monitor: /);
  });

  it("teste à espera do \"ouviu?\": a pergunta e Ouvi/Não ouvi ficam FIXOS NO TOPO, antes de todos os botões de teste, com o nome do teste", async () => {
    const s = criarSessaoDeDiagnostico({
      diag: criarDiagnostico(noop), sonda: () => null,
      diferenciais: { executar: async (letra): Promise<ResultadoDiferencial> => ({ letra, mecanismo: "x", aceitou: true, erro: null, tecnico: {} }), sistema: async () => null },
    });
    s.registrarFalha();
    await s.testarDiferencial("I1");
    const i2 = await s.testarDiferencial("I2");
    const html = renderToStaticMarkup(<PainelDiagnosticoDeAudio onClose={noop} sessao={s} ambiente={() => ambienteDoAparelho({})} nav={{}} doc={undefined} />);
    const raiz = parse(html);
    const topo = raiz.querySelector("[data-testid=diag-topo]");
    expect(topo, "o bloco fixo do topo existe").not.toBeNull();
    expect(topo!.getAttribute("style")).toMatch(/position:s*sticky/);
    expect(topo!.querySelectorAll("button").map((x) => x.text.trim())).toEqual(["Ouvi", "Não ouvi"]);
    expect(topo!.text).toContain("Responder #2 I2");
    const ordem = botoes(html);
    expect(ordem.indexOf("Ouvi"), "a resposta vem ANTES do 1º botão de teste").toBeLessThan(ordem.indexOf("Registrar falha de som"));
    // respondida a mais recente, a anterior que ficou sem resposta aparece para ser respondida depois
    s.responder(i2, true);
    const html2 = renderToStaticMarkup(<PainelDiagnosticoDeAudio onClose={noop} sessao={s} ambiente={() => ambienteDoAparelho({})} nav={{}} doc={undefined} />);
    expect(parse(html2).querySelector("[data-testid=diag-topo]")!.text).toContain("Responder #1 I1");
  });
});
