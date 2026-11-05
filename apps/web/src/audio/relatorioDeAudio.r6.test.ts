// RODADA 6 (04/11/2026) — cada falha com o SEU retrato (A1/A2/A3).
//
// Defeito da rodada 5, visto no relatório real do Android: a sessão guardava UM retrato de abertura do
// painel (A1) e o copiava para TODA falha registrada depois — a falha #2, #3… herdava o A1 da #1, e um
// 🔊 aberto minutos antes (com o som ainda bom) virava "estado durante a falha". Agora:
//  - o A1 é CONSUMIDO pela 1ª falha registrada depois daquela abertura do 🔊;
//  - A1 velho demais (painel aberto há mais de 2 min) não é associado;
//  - o "depois do painel" chega na falha certa mesmo se ela foi registrada antes de 1,2 s;
//  - o mesmo retrato de toque não serve de A2 a duas falhas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarDiagnostico, carimbar, type Retrato, type RetratoGuardado } from "./diagnostico.js";
import type { ResultadoDoTeste, SondaDoMotor, TrocaRegistrada } from "./engine.js";
import { criarSessaoDeDiagnostico, estadoDaFalha, ambienteDoAparelho } from "./relatorioDeAudio.js";

const BASE: Retrato = {
  fase: "ativo", contexto: "running", relogio: 10, geracao: 1, rms: 0.02, musicaAgendada: true,
  prefMusica: true, volMusica: 1, prefEfeitos: true, volEfeitos: 1, ganhoMaster: 0.9, ganhoMusica: 0.3, ganhoEfeitos: 1,
};

function sonda() {
  let atual: Retrato = { ...BASE };
  const toques: RetratoGuardado[] = [];
  const s: SondaDoMotor & { mudar(r: Partial<Retrato>): void; tocarDedo(): void } = {
    mudar(r) { atual = { ...atual, ...r }; },
    tocarDedo() { toques.push(carimbar("antes-do-toque", { ...atual })); if (toques.length > 6) toques.shift(); },
    retrato: () => ({ ...atual }),
    antesDoToque: () => toques.slice(),
    trocas: (): TrocaRegistrada[] => [],
    async tocarTeste(qual): Promise<ResultadoDoTeste> { return { qual, tocou: true, motivo: null, antes: { ...atual }, durante: { ...atual } }; },
    async tomDireto(): Promise<ResultadoDoTeste> { return { qual: "direto", tocou: true, motivo: null, antes: { ...atual }, durante: { ...atual } }; },
    recuperar() { atual = { ...atual, geracao: Number(atual.geracao) + 1 }; },
  };
  return s;
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }); });
afterEach(() => { vi.useRealTimers(); });

describe("rodada 6 — cada falha com o seu próprio retrato", () => {
  it("falha #2 sem novo toque no 🔊 NÃO herda o A1 da falha #1", () => {
    const s = sonda();
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s });
    s.mudar({ geracao: 3, rms: 0 });
    s.tocarDedo();
    sess.aoAbrirPainelDeSom();
    vi.advanceTimersByTime(3000);
    s.tocarDedo();
    const o1 = sess.registrarFalha();
    expect(o1.abertura?.r).toMatchObject({ geracao: 3 });
    s.mudar({ geracao: 7 });
    vi.advanceTimersByTime(20_000);
    s.tocarDedo();
    const o2 = sess.registrarFalha();
    expect(o2.abertura, "falha #2 reaproveitou o A1 da falha #1").toBeNull();
    expect(estadoDaFalha(o2)?.r).toMatchObject({ geracao: 7 });
  });

  it("cada falha precedida do seu toque no 🔊 tem o SEU A1", () => {
    const s = sonda();
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s });
    s.mudar({ geracao: 2 }); s.tocarDedo(); sess.aoAbrirPainelDeSom();
    vi.advanceTimersByTime(2500); s.tocarDedo();
    const o1 = sess.registrarFalha();
    vi.advanceTimersByTime(60_000);
    s.mudar({ geracao: 5 }); s.tocarDedo(); sess.aoAbrirPainelDeSom();
    vi.advanceTimersByTime(2500); s.tocarDedo();
    const o2 = sess.registrarFalha();
    expect(o1.abertura?.r.geracao).toBe(2);
    expect(o2.abertura?.r.geracao).toBe(5);
  });

  it("🔊 aberto há mais de 2 min (som ainda bom) não vira o estado DURANTE a falha", () => {
    const s = sonda();
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s });
    s.mudar({ rms: 0.05, geracao: 1 }); s.tocarDedo(); sess.aoAbrirPainelDeSom();
    vi.advanceTimersByTime(180_000);
    s.mudar({ rms: 0, geracao: 1, fase: "ativo" }); s.tocarDedo();
    const o = sess.registrarFalha();
    expect(o.abertura, "A1 de 3 min atrás associado à falha").toBeNull();
    expect(o.aberturaDescartada).toMatch(/há 180 s/);
  });

  it("falha registrada antes de 1,2 s do 🔊: o 'depois do painel' chega NA falha", async () => {
    const s = sonda();
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s });
    s.tocarDedo(); sess.aoAbrirPainelDeSom();
    vi.advanceTimersByTime(400); s.tocarDedo();
    const o = sess.registrarFalha();
    expect(o.depoisDoPainel).toBeNull();
    s.mudar({ geracao: 9 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(sess.ocorrencias()[0].depoisDoPainel?.r.geracao).toBe(9);
  });

  it("o mesmo retrato de toque não é A2 de duas falhas (registro repetido sem novo toque)", () => {
    const s = sonda();
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s });
    s.tocarDedo();
    const o1 = sess.registrarFalha();
    vi.advanceTimersByTime(300);
    const o2 = sess.registrarFalha();
    expect(o1.antesDoRegistro).not.toBeNull();
    expect(o2.antesDoRegistro).toBeNull();
  });

  it("o relatório diz, por falha, de onde veio o A1 (ou por que não há)", () => {
    const s = sonda();
    const sess = criarSessaoDeDiagnostico({ diag: criarDiagnostico(() => {}), sonda: () => s });
    s.tocarDedo(); sess.aoAbrirPainelDeSom();
    vi.advanceTimersByTime(2500); s.tocarDedo(); sess.registrarFalha();
    vi.advanceTimersByTime(5000); s.tocarDedo(); sess.registrarFalha();
    const txt = sess.relatorio(ambienteDoAparelho({}));
    expect(txt).toMatch(/FALHA #2[\s\S]*A1 antes do toque no 🔊: não houve — o 🔊 não foi aberto de novo depois da falha #1/);
  });
});
