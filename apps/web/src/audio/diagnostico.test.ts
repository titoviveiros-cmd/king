// O diagnóstico do áudio é do APK DEBUG de QA: desligado em todo build normal, e quando ligado só
// guarda números e estados do áudio, numa fita de tamanho fixo, sem rede.
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_FITA, MAX_TEXTO, criarDiagnostico, diagAudio } from "./diagnostico.js";

afterEach(() => { vi.unstubAllGlobals(); });

describe("diagnóstico do áudio (só APK DEBUG)", () => {
  it("fora do build de QA está DESLIGADO: não registra nem expõe nada", () => {
    const win: Record<string, unknown> = {};
    vi.stubGlobal("window", win);
    expect(diagAudio.ligado).toBe(false);
    diagAudio.registrar("pulso", { fase: "ativo" });
    diagAudio.expor({ estado: () => 1 });
    expect(win.__kingAudio).toBeUndefined();
  });

  it("ligado: cada linha sai com o prefixo [KING-AUDIO] e a fita guarda no máximo 600", () => {
    const win: Record<string, unknown> = {};
    vi.stubGlobal("window", win);
    const linhas: string[] = [];
    const d = criarDiagnostico((l) => linhas.push(l));
    for (let i = 0; i < 700; i++) d.registrar("pulso", { n: i });
    expect(linhas[0]).toMatch(/^\[KING-AUDIO\] \{"t":"[^"]+","ms":\d+,"evento":"pulso","n":0\}$/);
    d.expor({ estado: () => "ok" });
    const api = win.__kingAudio as { fita: () => { n: number }[]; estado: () => string };
    const fita = api.fita();
    expect(fita).toHaveLength(600);
    expect(fita[0]!.n).toBe(100);
    expect(api.estado()).toBe("ok");
  });

  it("o motor só manda números e estados do áudio — nada de token, id ou apelido", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const fonte = readFileSync(fileURLToPath(new URL("./engine.ts", import.meta.url)), "utf8");
    const chamadas = fonte.match(/diagAudio\.registrar\([^;]*\);/gs) ?? [];
    expect(chamadas.length).toBeGreaterThan(8);
    for (const c of chamadas) expect(c).not.toMatch(/token|playerId|apelido|nick|email|sessao|session/i);
    expect(fonte).not.toMatch(/fetch\(|sendBeacon|XMLHttpRequest/);
  });

  it("memória limitada (rodada 5): texto cortado, só valores simples, a contagem não perde nada com o anel", () => {
    const d = criarDiagnostico(() => {});
    const longo = "x".repeat(5000);
    for (let i = 0; i < 1000; i++) d.registrar(`ev${i % 200}`, { texto: longo, n: i, obj: {} as never, lista: [1, 2] as never });
    const fita = d.fita();
    expect(fita).toHaveLength(MAX_FITA);
    for (const r of fita) {
      expect(String(r.texto).length).toBeLessThanOrEqual(MAX_TEXTO + 1);
      expect(r).not.toHaveProperty("obj");
      expect(r).not.toHaveProperty("lista");
      expect(typeof r.ms).toBe("number");
    }
    // nomes de evento distintos têm teto (120); os já contados continuam contando
    const c = d.contagens();
    expect(Object.keys(c).length).toBeLessThanOrEqual(120);
    expect(c.ev0).toBe(5);
    // a fita devolvida é cópia: mexer nela não mexe na do aparelho
    fita[0]!.evento = "adulterado";
    expect(d.fita()[0]!.evento).not.toBe("adulterado");
  });

  it("desligado (build normal): fita e contagens vazias, sem console", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    diagAudio.registrar("pulso", { n: 1 });
    expect(diagAudio.fita()).toEqual([]);
    expect(diagAudio.contagens()).toEqual({});
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
