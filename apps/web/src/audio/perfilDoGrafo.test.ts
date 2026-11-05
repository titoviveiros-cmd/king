// Rodada 8: o perfil leve do grafo (Android) tem que ser o MESMO som com menos processamento — e o
// original (iPhone, computador) tem que continuar idêntico ao de sempre.
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERFIS, REVERB_LEVE, compensacaoDoReverbLeve, gerarImpulso, perfilPadrao, tocaGanza, tocaNotaDoViolao } from "./perfilDoGrafo.js";

/** Contexto mínimo: buffers de verdade (Float32Array por canal). */
function contexto(sampleRate: number) {
  return {
    sampleRate,
    createBuffer(canais: number, len: number) {
      const dados = Array.from({ length: canais }, () => new Float32Array(len));
      return { numberOfChannels: canais, length: len, getChannelData: (c: number) => dados[c]! };
    },
  } as unknown as BaseAudioContext;
}

/** Sorteio reproduzível (o ruído do impulso vem de Math.random). */
function sorteio(semente = 7) {
  let s = semente;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

/** O impulso como ele era ANTES da rodada 8 (cópia literal do código antigo do engine.ts). */
function impulsoAntigo(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const pre = t < 0.012 ? t / 0.012 : 1;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * pre;
    }
  }
  return buf;
}

afterEach(() => { vi.restoreAllMocks(); });

describe("perfil do grafo (rodada 8)", () => {
  it("sem opções, o impulso é EXATAMENTE o de sempre (iPhone e computador não mudam)", () => {
    const ctx = contexto(4000);
    vi.spyOn(Math, "random").mockImplementation(sorteio());
    const velho = impulsoAntigo(ctx, 2.4, 2.6);
    vi.spyOn(Math, "random").mockImplementation(sorteio());
    const novo = gerarImpulso(ctx, 2.4, 2.6);
    expect(novo.numberOfChannels).toBe(2);
    for (const ch of [0, 1]) expect(Array.from(novo.getChannelData(ch))).toEqual(Array.from(velho.getChannelData(ch)));
  });

  it("o leve é o COMEÇO mono do MESMO envelope: amostra a amostra igual ao canal 0 do original até o fim suave", () => {
    const taxa = 4000;
    const ctx = contexto(taxa);
    vi.spyOn(Math, "random").mockImplementation(sorteio(3));
    const original = gerarImpulso(ctx, 2.4, 2.6).getChannelData(0);
    vi.spyOn(Math, "random").mockImplementation(sorteio(3));
    const leve = gerarImpulso(ctx, 2.4, 2.6, REVERB_LEVE);
    expect(leve.numberOfChannels).toBe(1);
    const len = Math.floor(taxa * REVERB_LEVE.segundos);
    expect(leve.length).toBe(len);
    const d = leve.getChannelData(0);
    const fim = Math.floor(taxa * REVERB_LEVE.fimSuave);
    for (let i = 0; i < len - fim; i++) expect(d[i]).toBe(original[i]);
    // o fim suave só abaixa (nunca inverte nem estoura) e termina em zero
    for (let i = len - fim; i < len; i++) expect(Math.abs(d[i]!)).toBeLessThanOrEqual(Math.abs(original[i]!) + 1e-12);
    expect(Math.abs(d[len - 1]!)).toBe(0);
  });

  it("o corte de 1,2 s guarda ≥ 98% da energia do envelope (a cauda cortada é a parte quase inaudível)", () => {
    const taxa = 48000;
    const lenT = Math.floor(taxa * 2.4);
    const lenC = Math.floor(taxa * REVERB_LEVE.segundos);
    let total = 0;
    let corte = 0;
    for (let i = 0; i < lenT; i++) {
      const t = i / lenT;
      const e = Math.pow(1 - t, 2.6) * (t < 0.012 ? t / 0.012 : 1);
      total += e * e;
      if (i < lenC) corte += e * e;
    }
    expect(corte / total).toBeGreaterThanOrEqual(0.98);
  });

  it("compensação do molhado: devolve o volume que a normalização do ConvolverNode tiraria (≈ √2 para metade do impulso)", () => {
    const k = compensacaoDoReverbLeve(48000);
    expect(k).toBeGreaterThan(1.38);
    expect(k).toBeLessThan(1.42);
    expect(Math.abs(compensacaoDoReverbLeve(44100) - k)).toBeLessThan(0.002);
  });

  it("produção: leve a 24 kHz só no Android; o original no resto; B e D nunca viram padrão", () => {
    expect(perfilPadrao(true)).toBe(PERFIS["leve-24k"]);
    expect(PERFIS["leve-24k"]).toMatchObject({ reverb: "mono-curto", enviosCompartilhados: true, polifoniaReduzida: false, taxa: 24000 });
    expect(perfilPadrao(false)).toBe(PERFIS.original);
    expect(PERFIS.leve).toMatchObject({ reverb: "mono-curto", enviosCompartilhados: true, polifoniaReduzida: false, taxa: null });
    expect(PERFIS.original).toMatchObject({ reverb: "estereo", enviosCompartilhados: false, polifoniaReduzida: false, taxa: null });
  });

  it("a música só fica mais leve na variante D (e só ela): violão sem a tônica, ganzá nos tempos", () => {
    for (const p of [PERFIS.original, PERFIS.leve, PERFIS["leve-24k"], PERFIS["sem-reverb"]]) {
      expect([0, 1, 2, 3].filter((i) => tocaNotaDoViolao(p, i))).toHaveLength(4);
      expect([0, 2, 4, 6, 8, 10, 12, 14].filter((i) => tocaGanza(p, i))).toHaveLength(8);
    }
    const d = PERFIS["leve-polifonia"];
    expect([0, 1, 2, 3].filter((i) => tocaNotaDoViolao(d, i))).toEqual([1, 2, 3]);
    expect([0, 2, 4, 6, 8, 10, 12, 14].filter((i) => tocaGanza(d, i))).toEqual([0, 4, 8, 12]);
  });
});
