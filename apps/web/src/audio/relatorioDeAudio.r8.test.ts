// RODADA 8 (04/11/2026) — o relatório traz as variantes do grafo (A–E) e o monitor contínuo do relógio.
import { describe, expect, it } from "vitest";
import { criarDiagnostico } from "./diagnostico.js";
import { ambienteDoAparelho, criarSessaoDeDiagnostico, leituraDaRodada8, type ExecutoresDiferenciais } from "./relatorioDeAudio.js";
import type { LetraDiferencial, ResultadoDiferencial } from "./testesDiferenciais.js";
import type { ResumoDoMonitor } from "./monitorDeAudio.js";

const noop = () => {};
/** Executores falsos: cada letra devolve o técnico pedido (o que o aparelho mediria). */
function executores(tecnicos: Partial<Record<LetraDiferencial, Record<string, number | string>>>): ExecutoresDiferenciais {
  return {
    executar: async (letra): Promise<ResultadoDiferencial> => ({ letra, mecanismo: `variante ${letra}`, aceitou: true, erro: null, tecnico: tecnicos[letra] ?? {} }),
    sistema: async () => null,
  };
}

describe("rodada 8: leitura das variantes", () => {
  it("cada variante com razão, pior janela, underruns (diferença), vozes e o 'ouviu normal?' — e se SUSTENTA", async () => {
    const s = criarSessaoDeDiagnostico({
      diag: criarDiagnostico(noop),
      sonda: () => null,
      diferenciais: executores({
        VA: { perfil: "original", razao: 0.4694, razaoMin: 0.41, "stats.underrunEvents": 1040, "stats.underrunDuration": 10.6, vozesMax: 31 },
        VC: { perfil: "leve", razao: 0.9991, razaoMin: 0.997, "stats.underrunEvents": 0, "stats.underrunDuration": 0, vozesMax: 31 },
        VB: { perfil: "sem-reverb", razao: 0.999, razaoMin: 0.99, vozesMax: 30 }, // sem playbackStats
        VD: { perfil: "leve-polifonia", razao: 0.995, razaoMin: 0.97, "stats.underrunEvents": 12, "stats.underrunDuration": 0.3, vozesMax: 22 },
      }),
    });
    s.registrarFalha();
    const a = await s.testarDiferencial("VA");
    s.responder(a, false);
    const c = await s.testarDiferencial("VC");
    s.responder(c, true);
    await s.testarDiferencial("VB");
    await s.testarDiferencial("VD");
    const o = s.ocorrencias()[0]!;
    const l = leituraDaRodada8(o);
    expect(l[0]).toMatch(/^VARIANTES .*razão ≥ 0\.98 e 0 underrun/);
    const linha = (x: string) => l.find((y) => y.trim().startsWith(x))!;
    expect(linha("VA original")).toMatch(/razão 0\.4694 \(pior janela 0\.41\) · underruns 1040 \/ 10\.6s · vozes máx 31 · ouviu normal: NÃO → relógio NÃO sustenta/);
    expect(linha("VC leve")).toMatch(/razão 0\.9991 .* underruns 0 \/ 0s .* ouviu normal: SIM → relógio SUSTENTA/);
    expect(linha("VB sem-reverb"), "sem playbackStats: não inventa underrun").toMatch(/underruns não exposto .* ouviu normal: sem resposta → relógio SUSTENTA/);
    expect(linha("VD leve-polifonia"), "relógio bom com underrun não sustenta").toMatch(/underruns 12 \/ 0\.3s .* → relógio NÃO sustenta/);
    // a ordem do pedido (A, B, C…), não a ordem em que foram feitas
    expect(l.slice(1).map((x) => x.trim().slice(0, 2))).toEqual(["VA", "VB", "VC", "VD"]);
  });

  it("o relatório inteiro traz a leitura das variantes na falha e o MONITOR por perfil, com as últimas janelas", async () => {
    const resumo: ResumoDoMonitor = {
      ligado: true, duracaoS: 600, janelas: 120, validas: 118, trocasDeContexto: 1, emFundo: 1,
      porPerfil: { leve: { janelas: 118, razaoMedia: 0.9994, razaoMin: 0.991, abaixoDe095: 0, underrunEventos: 0, underrunSegundos: 0, totalSegundos: 590 } },
      recentes: [{ s: 600, perfil: "leve", duracaoS: 5, razao: 0.9995, underrunEventos: 0, underrunSegundos: 0, totalSegundos: 5, visivel: true, contextoNovo: false, estado: "running" }],
    };
    const s = criarSessaoDeDiagnostico({
      diag: criarDiagnostico(noop), sonda: () => null,
      diferenciais: executores({ VC: { perfil: "leve", razao: 1, razaoMin: 0.99, "stats.underrunEvents": 0, vozesMax: 20 } }),
      monitor: () => resumo,
    });
    s.registrarFalha();
    await s.testarDiferencial("VC");
    const txt = s.relatorio(ambienteDoAparelho({}));
    expect(txt).toContain("== MONITOR CONTÍNUO DO RELÓGIO (rodada 8: razão e underruns por janela de ~5 s) ==");
    expect(txt).toMatch(/ligado · 600s · 120 janelas \(118 válidas, 1 em fundo, 1 trocas de contexto\)/);
    expect(txt).toMatch(/perfil leve: 118 janelas · razão média 0\.9994 · pior 0\.991 · abaixo de 0,95: 0 · underruns 0 \(0s; fração 0\)/);
    expect(txt).toMatch(/\+600s leve razão=0\.9995 underruns=0\/0s/);
    expect(txt).toMatch(/VC leve: razão 1 .* → relógio SUSTENTA/);
  });

  it("sem monitor (fora do APK DEBUG): a seção diz que não há — nada inventado", () => {
    const s = criarSessaoDeDiagnostico({ diag: criarDiagnostico(noop), sonda: () => null });
    expect(s.relatorio(ambienteDoAparelho({}))).toContain("(sem monitor — fora do APK DEBUG)");
  });
});
