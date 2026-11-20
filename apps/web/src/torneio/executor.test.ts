/**
 * O EXECUTOR — partidas reais de bots, em fatias, sem prender a thread.
 */
import { describe, it, expect } from "vitest";
import { createMatch, simulateMatch, createRng } from "@king/engine";
import { KingGame } from "../game/kingGame.js";
import { cederAoNavegador, simularPendentes } from "./executor.js";
import { fatosDoEstado, jogarMesaDeBots, partidaDeBots } from "./simulacao.js";
import { fatosDoEstadoDaLeitura } from "./fatos.js";
import { criarTorneio, nomesDaMesa, pendentesDeBots, situacao } from "./orquestrador.js";

describe("a simulação de uma mesa de bots", () => {
  it("é uma partida REAL: dez mãos, cada uma uma fatia, checksums oficiais", () => {
    const g = partidaDeBots(["A", "B", "C", "D"], 123);
    const maos: number[] = [];
    let r = g.next();
    while (!r.done) { maos.push(r.value); r = g.next(); }
    expect(maos).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.value.pontos.reduce((a, b) => a + b, 0)).toBe(0);
    expect(r.value.negativas.reduce((a, b) => a + b, 0)).toBe(-1300);
  });

  it("mesma semente → mesmo resultado; outra semente → outra partida", () => {
    const a = jogarMesaDeBots(["A", "B", "C", "D"], 555);
    expect(jogarMesaDeBots(["A", "B", "C", "D"], 555)).toEqual(a);
    expect(jogarMesaDeBots(["A", "B", "C", "D"], 556)).not.toEqual(a);
  });

  it("é o MESMO Bot Normal da mesa solo: o KingGame com bots nos 4 assentos dá os mesmos fatos", () => {
    // A mesa solo dá os passos de bot por `stepBotPlay`/`stepBotTrump`. Jogando o assento 0 pelo
    // mesmo bot (humanSeat fora da mesa não existe; usamos o passo do bot para todos), os fatos
    // têm de bater com a simulação sem tela.
    const nomes = ["A", "B", "C", "D"];
    const g = new KingGame(nomes, 9090, 0);
    for (let guarda = 0; guarda < 2000 && !g.finished(); guarda++) {
      const ph = g.phase();
      if (ph === "handEnd") { g.advanceHand(); continue; }
      if (ph === "trump") {
        // `stepBotTrump` serve qualquer assento que esteja escolhendo
        g.stepBotTrump();
        continue;
      }
      g.stepBotPlay();
    }
    expect(g.finished()).toBe(true);
    expect(fatosDoEstadoDaLeitura(g)).toEqual(jogarMesaDeBots(nomes, 9090));
  });

  it("os fatos lidos do estado batem com o que o motor guarda", () => {
    const m = createMatch(["A", "B", "C", "D"], 7);
    simulateMatch(m, createRng(7));
    const f = fatosDoEstado(m);
    expect(f.pontos).toEqual(m.cumulative);
    expect(f.negativas).toEqual(m.negatives);
  });
});

describe("o executor", () => {
  it("cede a vez a cada mão: 10 fatias por mesa, e uma gravação por mesa confirmada", async () => {
    const t = criarTorneio("mini16", 42, "leao");
    const pendentes = pendentesDeBots(t).length;
    let cedidas = 0;
    const gravados: number[] = [];
    const fim = await simularPendentes(t, {
      ceder: async () => { cedidas++; },
      aoResultado: (x) => gravados.push(x.mesas.filter((m) => m.resultado).length),
    });
    expect(pendentes).toBe(3);
    expect(cedidas).toBe(pendentes * 10);
    expect(gravados).toEqual([1, 2, 3]);
    expect(situacao(fim!).tipo).toBe("jogar");
  });

  it("o resultado é o mesmo da simulação direta (nada inventado no caminho)", async () => {
    const t = criarTorneio("copa32", 4, "sapo");
    const fim = (await simularPendentes(t, { ceder: async () => {} }))!;
    for (const m of pendentesDeBots(t)) {
      expect(fim.mesas.find((x) => x.id === m.id)!.resultado!.fatos).toEqual(jogarMesaDeBots(nomesDaMesa(t, m), m.semente));
    }
  });

  it("cancelado no meio: devolve null e só entrega mesas completas", async () => {
    const t = criarTorneio("mini16", 42, "leao");
    let n = 0;
    const entregues: number[] = [];
    const fim = await simularPendentes(t, {
      ceder: async () => { n++; },
      cancelado: () => n >= 15, // no meio da 2ª mesa
      aoResultado: (x) => entregues.push(x.mesas.filter((m) => m.resultado).length),
    });
    expect(fim).toBeNull();
    expect(entregues).toEqual([1]);
  });

  it("NÃO BLOQUEIA: um temporizador agendado antes roda enquanto as mesas ainda estão sendo jogadas", async () => {
    const t = criarTorneio("copa32", 8, "leao");
    let temporizadorRodou = false;
    let rodouAntesDoFim = false;
    setTimeout(() => { temporizadorRodou = true; }, 0);
    let maiorFatiaMs = 0;
    let ultimo = performance.now();
    await simularPendentes(t, {
      ceder: async () => {
        const agora = performance.now();
        maiorFatiaMs = Math.max(maiorFatiaMs, agora - ultimo);
        await cederAoNavegador();
        await new Promise((ok) => setTimeout(ok, 0));
        ultimo = performance.now();
      },
      aoProgresso: (feitas, total) => { if (feitas < total && temporizadorRodou) rodouAntesDoFim = true; },
    });
    expect(rodouAntesDoFim).toBe(true);
    // Uma fatia é UMA mão (52 jogadas). Folga larga de propósito: a máquina da CI é lenta, e o
    // que se prova aqui é a ordem de grandeza, não um número de benchmark.
    expect(maiorFatiaMs).toBeLessThan(250);
  });
});
