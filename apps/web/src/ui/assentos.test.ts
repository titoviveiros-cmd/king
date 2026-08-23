/**
 * ROTAÇÃO DA MESA — a única adaptação estrutural de layout que o multiplayer exigiu.
 *
 * A garantia mais importante deste arquivo é a de NÃO-REGRESSÃO: com `eu === 0` a rotação tem de
 * reproduzir exatamente o mapa fixo que a Mesa usava antes (`{0:"b",1:"l",2:"t",3:"r"}` e
 * adversários `[1,2,3]`). Se isso quebrar, o modo local/bots já validado no aparelho muda de
 * lugar — e é justamente o que não pode acontecer.
 */
import { describe, it, expect } from "vitest";
import type { Seat } from "@king/engine";
import { adversariosDe, slotDe } from "./assentos.js";

const SEATS: Seat[] = [0, 1, 2, 3];

/** O mapa que existia em Mesa.tsx antes da Fase 8. */
const MAPA_HISTORICO: Record<Seat, string> = { 0: "b", 1: "l", 2: "t", 3: "r" };

describe("rotação de assentos", () => {
  it("com eu=0 reproduz exatamente o mapa histórico da Mesa", () => {
    for (const s of SEATS) expect(slotDe(s, 0)).toBe(MAPA_HISTORICO[s]);
    expect(adversariosDe(0)).toEqual([1, 2, 3]);
  });

  it("você fica SEMPRE embaixo, qualquer que seja o assento do servidor", () => {
    for (const eu of SEATS) expect(slotDe(eu, eu)).toBe("b");
  });

  it("os três adversários ocupam esquerda, topo e direita, sem repetir", () => {
    for (const eu of SEATS) {
      const opp = adversariosDe(eu);
      expect(opp).toHaveLength(3);
      expect(new Set(opp).size).toBe(3);
      expect(opp).not.toContain(eu);
      expect(opp.map((s) => slotDe(s, eu))).toEqual(["l", "t", "r"]);
    }
  });

  it("preserva a ordem de jogo: o slot é a distância horária até você", () => {
    for (const eu of SEATS) {
      // quem joga logo depois de você está SEMPRE à sua esquerda — é a ordem da mesa real
      expect(slotDe(((eu + 1) % 4) as Seat, eu)).toBe("l");
      expect(slotDe(((eu + 2) % 4) as Seat, eu)).toBe("t");
      expect(slotDe(((eu + 3) % 4) as Seat, eu)).toBe("r");
    }
  });

  it("cada assento ocupa um slot distinto para qualquer observador", () => {
    for (const eu of SEATS) {
      expect(new Set(SEATS.map((s) => slotDe(s, eu))).size).toBe(4);
    }
  });
});
