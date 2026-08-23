/**
 * A REGRA DOS DOIS RELÓGIOS — o comportamento que quebra na mão de gente real.
 *
 * O caso concreto: o jogador tira o iPhone do bolso depois de dois minutos com a aba em segundo
 * plano. O `requestAnimationFrame` estava congelado, o servidor não esperou ninguém, e vinte
 * atualizações chegam de uma vez. Encenar as vinte faria o jogo parecer travado enquanto
 * "recupera" um passado que ninguém precisa ver.
 */
import { describe, it, expect } from "vitest";
import { ehSalto, proximoPasso } from "./filaDeApresentacao.js";
import type { Causa } from "../net/protocolo.js";

const LIMITE = 2;

describe("ehSalto", () => {
  it("ressincronizações e início de partida NUNCA entram na fila", () => {
    for (const c of ["RESYNC", "RECONNECTED", "MATCH_STARTED"] as Causa[]) {
      expect(ehSalto(c), `${c} deveria ser salto`).toBe(true);
    }
  });

  it("o que é jogo encenado passa pela fila", () => {
    for (const c of ["CARD_PLAYED", "TRUMP_SELECTED", "HAND_ADVANCED"] as Causa[]) {
      expect(ehSalto(c), `${c} deveria ser encenado`).toBe(false);
    }
  });
});

describe("proximoPasso", () => {
  it("fila vazia não faz nada", () => {
    expect(proximoPasso([], LIMITE)).toEqual({ proxima: null, colapsou: false, resto: [] });
  });

  it("dentro do limite, encena uma de cada vez e na ORDEM", () => {
    let fila = ["a", "b"];
    const vistas: string[] = [];
    for (let i = 0; i < 2; i++) {
      const p = proximoPasso(fila, LIMITE);
      expect(p.colapsou).toBe(false);
      vistas.push(p.proxima!);
      fila = p.resto;
    }
    expect(vistas).toEqual(["a", "b"]);
    expect(fila).toEqual([]);
  });

  it("acima do limite COLAPSA para a mais recente e descarta o resto", () => {
    const p = proximoPasso(["a", "b", "c", "d"], LIMITE);
    expect(p).toEqual({ proxima: "d", colapsou: true, resto: [] });
  });

  it("a avalanche de quem volta do segundo plano se resolve em UM passo", () => {
    const avalanche = Array.from({ length: 20 }, (_, i) => i);
    const p = proximoPasso(avalanche, LIMITE);
    expect(p.proxima).toBe(19); // o presente, não o passado
    expect(p.resto).toEqual([]);
    expect(proximoPasso(p.resto, LIMITE).proxima).toBeNull();
  });

  it("nunca anda para trás nem pula uma atualização sem colapsar", () => {
    // com a fila sempre dentro do limite, TODAS as atualizações são vistas, em ordem
    let fila: number[] = [];
    const vistas: number[] = [];
    for (let chegada = 0; chegada < 30; chegada++) {
      fila = [...fila, chegada];
      const p = proximoPasso(fila, LIMITE);
      if (p.proxima !== null) vistas.push(p.proxima);
      fila = p.resto;
    }
    expect(vistas).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });

  it("não muta a fila recebida", () => {
    const original = ["a", "b"];
    proximoPasso(original, LIMITE);
    expect(original).toEqual(["a", "b"]);
  });
});
