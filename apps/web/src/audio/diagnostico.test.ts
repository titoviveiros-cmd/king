// O diagnóstico do áudio é do APK DEBUG de QA: desligado em todo build normal, e quando ligado só
// guarda números e estados do áudio, numa fita de tamanho fixo, sem rede.
import { afterEach, describe, expect, it, vi } from "vitest";
import { criarDiagnostico, diagAudio } from "./diagnostico.js";

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
    expect(linhas[0]).toMatch(/^\[KING-AUDIO\] \{"t":"[^"]+","evento":"pulso","n":0\}$/);
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
});
