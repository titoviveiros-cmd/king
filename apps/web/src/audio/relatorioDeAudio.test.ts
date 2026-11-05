// O RELATÓRIO DO "DIAGNÓSTICO DE ÁUDIO" (APK DEBUG, rodada 5 — sem cabo USB).
//
// O que este arquivo trava:
//  - "Registrar falha" GUARDA o estado defeituoso e não repara nada (nenhum som, nenhuma troca);
//  - A (durante a falha), B (sons de teste + "ouviu?") e C (depois da recuperação) saem separados;
//  - os indícios H1–H8 leem os números certos e nunca afirmam a causa física pelo analisador;
//  - memória limitada; nada de identidade no texto; exportar funciona sem clipboard, sem
//    compartilhar e sem rede.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { criarDiagnostico, carimbar, type Retrato, type RetratoGuardado } from "./diagnostico.js";
import type { ResultadoDoTeste, SondaDoMotor, TrocaRegistrada } from "./engine.js";
import {
  MAX_OCORRENCIAS, MAX_RELATORIO, MAX_TESTES, ambienteDoAparelho, compartilharTexto, copiarTexto,
  criarSessaoDeDiagnostico, indicios, limparDadosSensiveis, type AmbienteDoRelatorio,
} from "./relatorioDeAudio.js";

const SAUDAVEL: Retrato = {
  fase: "ativo", contexto: "running", relogio: 120.5, andouDesdeVigia: 2.0, paredeDesdeVigiaMs: 2000, taxa: 48000,
  latBase: 0.01, latSaida: 0.04, saidaCtx: 120.4, saidaIdadeMs: 12, idadeContextoMs: 300000, geracao: 3,
  musicaAgendada: true, compassoHaMs: 900, musicaDesdeMs: 200000,
  prefMusica: true, volMusica: 0.5, prefEfeitos: true, volEfeitos: 0.8, prefVibracao: true,
  ganhoMaster: 0.9, ganhoMusica: 0.17, ganhoEfeitos: 0.8,
  analisador: true, rms: 0.02, pico: 0.1, sinalNaN: false, analisadorProvado: true, vozes: 12,
  zumbi: false, condenado: null, naoConfiavel: false, gestoArmado: false, recuperando: false,
  trocaBloqueada: false, falhasDoGesto: 0, visivel: true, foco: true,
};

/** Sonda falsa: conta tudo o que se chama nela (a ordem importa). */
function sondaFalsa(estado: Retrato = SAUDAVEL) {
  const chamadas: string[] = [];
  let atual: Retrato = { ...estado };
  const toques: RetratoGuardado[] = [];
  const s: SondaDoMotor & { chamadas: string[]; mudar(r: Partial<Retrato>): void; tocarDedo(): void } = {
    chamadas,
    mudar(r) { atual = { ...atual, ...r }; },
    tocarDedo() { toques.push(carimbar("antes-do-toque", { ...atual })); },
    retrato() { chamadas.push("retrato"); return { ...atual }; },
    antesDoToque() { chamadas.push("antesDoToque"); return toques.slice(); },
    trocas(): TrocaRegistrada[] { return []; },
    async tocarTeste(qual): Promise<ResultadoDoTeste> {
      chamadas.push(`tocarTeste:${qual}`);
      return { qual, tocou: true, motivo: null, antes: { ...atual }, durante: { ...atual, rms: 0.03 } };
    },
    async tomDireto(): Promise<ResultadoDoTeste> { chamadas.push("tomDireto"); return { qual: "direto", tocou: true, motivo: null, antes: { ...atual }, durante: { ...atual } }; },
    recuperar() { chamadas.push("recuperar"); atual = { ...atual, geracao: Number(atual.geracao) + 1, contexto: "running", fase: "ativo" }; },
  };
  return s;
}

const AMB: AmbienteDoRelatorio = ambienteDoAparelho({
  nav: { userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.6723.102 Mobile Safari/537.36", onLine: true, hardwareConcurrency: 8 },
  tela: { width: 915, height: 412 }, dpr: 2.625, nativo: true, versao: "0.1.0", build: "b98a5ff+r5",
});
const semEspera = () => Promise.resolve();

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("A. registrar a falha guarda o estado ANTES de qualquer reparo", () => {
  it("Registrar falha só LÊ: nada de som, nada de recuperar; o estado defeituoso fica no relatório", () => {
    const s = sondaFalsa({ ...SAUDAVEL, contexto: "suspended", fase: "esperando-gesto" });
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s, esperar: semEspera });
    const o = sess.registrarFalha();
    expect(s.chamadas.filter((c) => c !== "retrato" && c !== "antesDoToque"), "registrar falha chamou reparo/som").toEqual([]);
    expect(o.noRegistro).toMatchObject({ contexto: "suspended", fase: "esperando-gesto" });
    expect(o.recuperacao).toBeNull();
    expect(o.testes).toEqual([]);
  });

  it("A1 = o retrato do pointerdown do toque no 🔊 (antes do reparo do 🔊); A2 = antes do toque em Registrar", () => {
    const s = sondaFalsa({ ...SAUDAVEL, contexto: "running", rms: 0, geracao: 3, condenado: "mudo" });
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s, esperar: semEspera });
    s.tocarDedo(); // pointerdown no 🔊: o motor ainda é o defeituoso
    sess.aoAbrirPainelDeSom();
    s.mudar({ geracao: 4, condenado: null, rms: 0.02 }); // o 🔊 trocou o contexto (reativar)
    vi.advanceTimersByTime(3000);
    s.tocarDedo(); // pointerdown em "Registrar falha"
    const o = sess.registrarFalha();
    expect(o.abertura?.r).toMatchObject({ geracao: 3, condenado: "mudo", rms: 0 });
    expect(o.antesDoRegistro?.r).toMatchObject({ geracao: 4 });
    expect(o.noRegistro).toMatchObject({ geracao: 4 });
  });

  it("toque antigo (> 2 s) não vira A1: sem retrato do toque, o 🔊 retrata o motor na hora — ainda antes do reparo", () => {
    const s = sondaFalsa();
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s, esperar: semEspera });
    s.tocarDedo();
    vi.advanceTimersByTime(5000);
    sess.aoAbrirPainelDeSom();
    const o = sess.registrarFalha();
    expect(o.abertura?.rotulo).toBe("ao-abrir-o-painel");
  });
});

describe("B e C. testes e recuperação, separados", () => {
  it("teste antes da recuperação, recuperação com antes/depois, teste depois — cada um no seu lugar", async () => {
    const s = sondaFalsa({ ...SAUDAVEL, geracao: 3 });
    const diag = criarDiagnostico(() => {});
    const sess = criarSessaoDeDiagnostico({ diag, sonda: () => s, esperar: semEspera });
    sess.registrarFalha();
    const t1 = await sess.testar("musica");
    sess.responder(t1, false);
    await sess.recuperar();
    const t2 = await sess.testar("efeito");
    sess.responder(t2, true);
    const o = sess.ocorrencias()[0]!;
    expect(t1.momento).toBe("antes-da-recuperacao");
    expect(t2.momento).toBe("depois-da-recuperacao");
    expect(o.recuperacao?.antes.geracao).toBe(3);
    expect(o.recuperacao?.depois?.geracao).toBe(4);
    // a ordem: o retrato do "antes" foi tirado ANTES de recuperar
    const i = s.chamadas.indexOf("recuperar");
    expect(s.chamadas.slice(0, i)).toContain("retrato");
    const txt = sess.relatorio(AMB);
    const a = txt.indexOf("A. ESTADO CAPTURADO DURANTE A FALHA");
    const b = txt.indexOf("B. SONS DE TESTE");
    const c = txt.indexOf("C. DEPOIS DA TENTATIVA DE RECUPERAÇÃO");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(txt).toContain("OUVIU: NÃO");
    expect(txt).toContain("OUVIU: SIM");
    expect(diag.contagens()["teste-respondido"]).toBe(2);
  });

  it("testar sem ter registrado a falha registra uma (o estado antes do teste não se perde)", async () => {
    const s = sondaFalsa();
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s, esperar: semEspera });
    await sess.testar("efeito");
    expect(sess.ocorrencias()).toHaveLength(1);
    expect(s.chamadas.indexOf("retrato")).toBeLessThan(s.chamadas.indexOf("tocarTeste:efeito"));
  });

  it("sem motor (antes do 1º som): nada quebra, e o relatório diz que não há retrato", async () => {
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => null, esperar: semEspera });
    sess.aoAbrirPainelDeSom();
    const o = sess.registrarFalha();
    const t = await sess.testar("musica");
    await sess.recuperar();
    expect(o.noRegistro).toBeNull();
    expect(t.resultado).toMatchObject({ tocou: false, motivo: "sem-motor" });
    expect(sess.relatorio(AMB)).toContain("(sem retrato)");
  });
});

describe("indícios H1–H8 (não são causa comprovada)", () => {
  const diagCom = (ev: [string, Record<string, string | number>][] = []) => {
    const d = criarDiagnostico(() => {});
    for (const [e, dados] of ev) d.registrar(e, dados);
    return d;
  };
  const ocorrencia = (r: Retrato, extra: Partial<ReturnType<ReturnType<typeof criarSessaoDeDiagnostico>["registrarFalha"]>> = {}) => {
    const sess = criarSessaoDeDiagnostico({ diag: diagCom(), sonda: () => sondaFalsa(r), esperar: semEspera });
    return { ...sess.registrarFalha(), ...extra };
  };
  const sinal = (lista: ReturnType<typeof indicios>, h: string) => lista.find((i) => i.h === h)?.sinal;

  it("motor saudável: H1–H4 'não'", () => {
    const l = indicios(ocorrencia(SAUDAVEL), diagCom());
    expect([sinal(l, "H1"), sinal(l, "H2"), sinal(l, "H3"), sinal(l, "H4")]).toEqual(["não", "não", "não", "não"]);
  });

  it("H1 suspenso · H2 relógio parado · H3 sem agendador · H4 ganho zero", () => {
    expect(sinal(indicios(ocorrencia({ ...SAUDAVEL, contexto: "suspended" }), diagCom()), "H1")).toBe("sim");
    expect(sinal(indicios(ocorrencia({ ...SAUDAVEL, andouDesdeVigia: 0, paredeDesdeVigiaMs: 2000 }), diagCom()), "H2")).toBe("sim");
    expect(sinal(indicios(ocorrencia({ ...SAUDAVEL, musicaAgendada: false }), diagCom()), "H3")).toBe("sim");
    expect(sinal(indicios(ocorrencia({ ...SAUDAVEL, compassoHaMs: 9000 }), diagCom()), "H3")).toBe("sim");
    expect(sinal(indicios(ocorrencia({ ...SAUDAVEL, ganhoMusica: 0 }), diagCom()), "H4")).toBe("sim");
    // volume escolhido = 0 não é defeito
    expect(sinal(indicios(ocorrencia({ ...SAUDAVEL, volMusica: 0, ganhoMusica: 0 }), diagCom()), "H4")).toBe("não");
  });

  it("H5 só como 'compatível': sinal no grafo + 'não ouvi' — o texto diz que não comprova", async () => {
    const s = sondaFalsa();
    const sess = criarSessaoDeDiagnostico({ diag: diagCom(), sonda: () => s, esperar: semEspera });
    sess.registrarFalha();
    sess.responder(await sess.testar("musica"), false);
    const h5 = indicios(sess.ocorrencias()[0]!, diagCom()).find((i) => i.h === "H5")!;
    expect(h5.sinal).toBe("sim");
    expect(h5.porque).toMatch(/não comprova/);
  });

  it("H6 troca que falhou · H7 evento de ciclo de vida no minuto anterior · H8 acúmulo", () => {
    const d6 = diagCom([["reconstruir", {}], ["reconstruir-falhou", {}]]);
    expect(sinal(indicios(ocorrencia(SAUDAVEL), d6), "H6")).toBe("sim");
    const d7 = diagCom([["ev-pause", {}], ["fundo", {}], ["volta", {}]]);
    expect(sinal(indicios(ocorrencia(SAUDAVEL), d7), "H7")).toBe("sim");
    const d8 = diagCom([["contexto-novo", {}], ["contexto-novo", {}], ["contexto-novo", {}], ["contexto-novo", {}]]);
    expect(sinal(indicios(ocorrencia(SAUDAVEL), d8), "H8")).toBe("sim");
    expect(sinal(indicios(ocorrencia({ ...SAUDAVEL, vozes: 400 }), diagCom()), "H8")).toBe("sim");
  });
});

describe("relatório: legível, completo, limitado e sem identidade", () => {
  it("cabeçalho com versão, build, Android e WebView — sem modelo do aparelho nem agente completo", () => {
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => sondaFalsa(), esperar: semEspera });
    const txt = sess.relatorio(AMB);
    expect(txt).toContain("Versão: 0.1.0 · build DEBUG: b98a5ff+r5");
    expect(txt).toContain("Android 14 · Chromium 130 (WebView)");
    expect(txt).toMatch(/NÃO prova que o alto-falante/);
    for (const proibido of ["SM-A546E", "UP1A", "6723.102", "Mozilla"]) expect(txt).not.toContain(proibido);
  });

  it("nada de identidade: id, e-mail, token, chave, IP e endereço do servidor saem riscados; o que está no aparelho nem é lido", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => JSON.stringify({ nick: "Tito", token: "eyJhbGciOi.eyJzdWIiOiJ4.assinatura", sala: "0840" }),
      setItem() {}, removeItem() {},
    });
    const diag = criarDiagnostico(() => {});
    diag.registrar("estranho", {
      id: "0f8fad5b-d9cb-469f-a165-70867728950e", email: "alguem@example.com", tk: "eyJhbGciOi.eyJzdWIiOiJ4.assinatura",
      k: "sb_publishable_abc123", ip: "192.168.0.10", url: "wss://server.playkingcards.com.br",
    });
    const sess = criarSessaoDeDiagnostico({ diag, sonda: () => sondaFalsa(), esperar: semEspera });
    sess.registrarFalha();
    const txt = sess.relatorio(AMB);
    for (const proibido of ["0f8fad5b", "alguem@example.com", "eyJhbGciOi", "sb_publishable", "192.168.0.10", "playkingcards", "Tito", "0840"]) {
      expect(txt, proibido).not.toContain(proibido);
    }
    expect(limparDadosSensiveis("relógio=123.456 versão 0.1.0")).toBe("relógio=123.456 versão 0.1.0");
  });

  it("memória limitada: 5 falhas guardadas, 12 testes por falha, texto com teto mesmo com a fita cheia", async () => {
    const diag = criarDiagnostico(() => {});
    for (let i = 0; i < 2000; i++) diag.registrar(i % 3 ? "gesto" : "pulso", { a: "y".repeat(500), n: i, rms: 0.01 });
    const sess = criarSessaoDeDiagnostico({ diag, sonda: () => sondaFalsa(), esperar: semEspera });
    for (let i = 0; i < 8; i++) sess.registrarFalha();
    for (let i = 0; i < 20; i++) await sess.testar("efeito");
    const oc = sess.ocorrencias();
    expect(oc).toHaveLength(MAX_OCORRENCIAS);
    expect(oc.map((o) => o.n)).toEqual([4, 5, 6, 7, 8]);
    expect(oc[oc.length - 1]!.testes).toHaveLength(MAX_TESTES);
    const txt = sess.relatorio(AMB);
    expect(txt.length).toBeLessThanOrEqual(MAX_RELATORIO + 80);
    expect(txt).toContain("== HISTÓRICO (últimos 220");
    expect(txt).toContain("== PULSOS (a cada ~10 s; últimos 15)");
  });
});

describe("exportar: copiar, compartilhar ou texto na tela — sempre por ação da pessoa", () => {
  const docFalso = (copia: boolean | "erro") => {
    const filhos: unknown[] = [];
    return {
      filhos,
      body: { appendChild: (n: unknown) => filhos.push(n), removeChild: () => filhos.pop() },
      createElement: () => ({ value: "", setAttribute() {}, style: {} as Record<string, string>, select() {} }),
      execCommand: () => { if (copia === "erro") throw new Error("SecurityError"); return copia; },
    };
  };

  it("clipboard funciona → copiado", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    expect(await copiarTexto("abc", { clipboard: { writeText } }, docFalso(false))).toBe("copiado");
    expect(writeText).toHaveBeenCalledWith("abc");
  });

  it("clipboard recusado (WebView) → caminho antigo (execCommand) → copiado-alternativo; sem sobrar elemento na página", async () => {
    const d = docFalso(true);
    const r = await copiarTexto("abc", { clipboard: { writeText: () => Promise.reject(new Error("NotAllowedError")) } }, d);
    expect(r).toBe("copiado-alternativo");
    expect(d.filhos).toHaveLength(0);
  });

  it("clipboard que nunca responde → prazo → caminho antigo", async () => {
    const p = copiarTexto("abc", { clipboard: { writeText: () => new Promise<void>(() => {}) } }, docFalso(true), 1500);
    await vi.advanceTimersByTimeAsync(1600);
    expect(await p).toBe("copiado-alternativo");
  });

  it("nenhum dos dois → falhou (o painel mostra o texto selecionável)", async () => {
    expect(await copiarTexto("abc", { clipboard: { writeText: () => Promise.reject(new Error("x")) } }, docFalso(false))).toBe("falhou");
    expect(await copiarTexto("abc", undefined, docFalso("erro"))).toBe("falhou");
    expect(await copiarTexto("abc", {}, undefined)).toBe("falhou");
  });

  it("compartilhar: indisponível, ok, cancelado (não é erro) e falha", async () => {
    expect(await compartilharTexto("abc", {})).toBe("indisponivel");
    expect(await compartilharTexto("abc", undefined)).toBe("indisponivel");
    const share = vi.fn(() => Promise.resolve());
    expect(await compartilharTexto("abc", { share })).toBe("compartilhado");
    expect(share).toHaveBeenCalledWith({ title: "KING — diagnóstico de áudio", text: "abc" });
    const abort = Object.assign(new Error("cancelou"), { name: "AbortError" });
    expect(await compartilharTexto("abc", { share: () => Promise.reject(abort) })).toBe("cancelado");
    expect(await compartilharTexto("abc", { share: () => Promise.reject(new Error("NotAllowedError")) })).toBe("falhou");
  });
});

describe("sem conexão: nada vai para a rede, e tudo funciona offline", () => {
  it("fluxo inteiro (registrar, testar, recuperar, relatório, copiar) com a rede proibida", async () => {
    const rede = vi.fn(() => { throw new Error("rede proibida no diagnóstico"); });
    vi.stubGlobal("fetch", rede);
    vi.stubGlobal("XMLHttpRequest", rede);
    vi.stubGlobal("WebSocket", rede);
    const nav = { onLine: false, sendBeacon: rede, clipboard: { writeText: () => Promise.resolve() } };
    const amb = ambienteDoAparelho({ nav: { ...nav, userAgent: "Mozilla/5.0 (Linux; Android 14; wv) Chrome/130.0 Mobile" } });
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => sondaFalsa(), esperar: semEspera });
    sess.aoAbrirPainelDeSom();
    sess.registrarFalha();
    sess.responder(await sess.testar("musica"), false);
    await sess.recuperar();
    const txt = sess.relatorio(amb);
    expect(await copiarTexto(txt, nav, undefined)).toBe("copiado");
    expect(rede).not.toHaveBeenCalled();
    expect(txt).toContain("online false");
  });

  it("o código do diagnóstico não tem nenhuma chamada de rede", () => {
    for (const arq of ["./relatorioDeAudio.ts", "./diagnostico.ts", "../ui/DiagnosticoDeAudio.tsx"]) {
      const fonte = readFileSync(fileURLToPath(new URL(arq, import.meta.url)), "utf8");
      expect(fonte, arq).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest|new WebSocket|navigator\.sendBeacon/);
    }
  });
});
