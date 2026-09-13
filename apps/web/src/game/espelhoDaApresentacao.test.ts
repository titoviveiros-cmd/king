// O SERVIDOR ESPELHA A FILA DO CLIENTE — e as duas não podem se separar em silêncio.
//
// O prazo autoritativo soma o tempo em que a decisão ainda não está na tela. Para saber esse
// tempo, o servidor roda um ESPELHO da fila do cliente (apps/server/src/match/pausaDaVaza.ts). Se
// um lado mudar e o outro não, o prazo volta a ser inflado ou erodido sem nenhum teste de servidor
// perceber — cada suíte estaria coerente consigo mesma.
//
// Por isso este teste importa os dois lados. A referência é montada SÓ com as funções reais do
// cliente (`proximoPasso`, `quantosPorTique`, `instanteDaProximaApresentacao`, `LIMITE_DA_FILA`),
// reproduzindo o dreno do hook: tenta a cada chegada, e senão no instante agendado.
import { describe, expect, it } from "vitest";
import {
  instanteDaProximaApresentacao, LIMITE_DA_FILA, proximoPasso, quantosPorTique,
} from "./filaDeApresentacao.js";
import {
  instanteDaApresentacao, LIMITE_DA_FILA_DO_CLIENTE, publicarNoEspelho, espelhoVazio,
  type ItemDaFila,
} from "../../../server/src/match/pausaDaVaza.js";
import { TEMPOS } from "./timings.js";

interface Chegada extends ItemDaFila { id: number }

/** A fila do cliente, com as funções do cliente: quando cada chegada fica visível. */
function referenciaDoCliente(chegadas: readonly Chegada[], passo: number): Map<number, number> {
  const vistos = new Map<number, number>();
  const pendentes = [...chegadas];
  let fila: Chegada[] = [];
  let ultimaEm: number | null = null;
  let pausaAte = 0;
  let timer: number | null = null;

  const drenar = (t: number) => {
    timer = null;
    for (;;) {
      if (fila.length === 0) return;
      // `emPausa()` no hook: espera o fim da leitura.
      if (t < pausaAte) { timer = pausaAte; return; }
      const quando = instanteDaProximaApresentacao({ agora: t, ultimaEm, pausaAte, passo });
      if (quando > t) { timer = quando; return; }
      const quantos = quantosPorTique(fila, () => true);
      for (let i = 0; i < quantos; i++) {
        const p = proximoPasso(fila, LIMITE_DA_FILA);
        if (!p.proxima) break;
        fila = p.resto;
        if (p.colapsou) pausaAte = 0; // `limpar()`
        const u = p.proxima;
        vistos.set(u.id, t);
        if (u.viraMao) pausaAte = 0; // HAND_ADVANCED → `limpar()`
        if (u.pausa > 0) pausaAte = t + u.pausa; // `afterPlay` da carta que fecha
      }
      ultimaEm = t;
    }
  };

  while (pendentes.length > 0 || timer !== null) {
    if (pendentes.length > 0 && (timer === null || pendentes[0].chegada <= timer)) {
      const u = pendentes.shift()!;
      fila.push(u);
      drenar(u.chegada);
    } else {
      drenar(timer!);
    }
  }
  return vistos;
}

/** Gerador determinístico: a mesma grade em toda execução, e reprodutível por semente. */
function mulberry32(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uma sequência de publicações com o que o jogo produz: rajadas, bots, pausas e mão virando. */
function sequencia(rnd: () => number, n: number): (Chegada & { t: number })[] {
  const out: (Chegada & { t: number })[] = [];
  let t = 0;
  for (let id = 0; id < n; id++) {
    const r = rnd();
    t += r < 0.3 ? Math.floor(rnd() * 30) // rajada: jogadas quase simultâneas
      : r < 0.55 ? 100 + Math.floor(rnd() * 500) // humano rápido
      : r < 0.8 ? 900 // bot de produção
      : 1500 + Math.floor(rnd() * 4000); // humano pensando
    const q = rnd();
    const pausa = q < 0.7 ? 0 : q < 0.85 ? TEMPOS.leituraDaVaza : q < 0.93 ? TEMPOS.leituraDaVazaCastigo
      : q < 0.97 ? TEMPOS.leituraDaVazaKing : TEMPOS.fimDeMao;
    out.push({ id, t, chegada: t, pausa, viraMao: rnd() < 0.03 });
  }
  return out;
}

describe("o espelho do servidor é a fila do cliente", () => {
  it("o limite de colapso é o mesmo nos dois lados", () => {
    expect(LIMITE_DA_FILA_DO_CLIENTE).toBe(LIMITE_DA_FILA);
  });

  it("a regra do instante é a mesma em toda a grade", () => {
    const passo = TEMPOS.botPasso;
    const divergencias: string[] = [];
    for (let agora = 0; agora <= 6000; agora += 130) {
      for (const ultimaEm of [null, 0, agora - passo - 1, agora - passo, agora - 1, agora, agora + 700]) {
        for (const pausaAte of [0, agora - 1, agora, agora + 1, agora + 1150, agora + 3400]) {
          const p = { agora, ultimaEm, pausaAte, passo };
          const cliente = instanteDaProximaApresentacao(p);
          const servidor = instanteDaApresentacao(p);
          if (cliente !== servidor) divergencias.push(`${JSON.stringify(p)} → cliente ${cliente}, servidor ${servidor}`);
        }
      }
    }
    expect(divergencias, divergencias.slice(0, 5).join("\n")).toEqual([]);
  });

  it("em 400 sequências com rajadas, pausas e colapso, cada atualização fica visível no mesmo instante", () => {
    const rnd = mulberry32(20260913);
    const passo = TEMPOS.botPasso;
    const divergencias: string[] = [];
    let colapsos = 0;
    for (let s = 0; s < 400; s++) {
      const seq = sequencia(rnd, 40);
      let espelho = espelhoVazio();
      for (let k = 0; k < seq.length; k++) {
        const r = publicarNoEspelho(espelho, seq[k], passo);
        espelho = r.espelho;
        // A referência vê só o que já chegou: o servidor decide o prazo sem conhecer o futuro.
        const vistos = referenciaDoCliente(seq.slice(0, k + 1), passo);
        if (vistos.size < k + 1) colapsos++;
        const cliente = vistos.get(seq[k].id);
        if (cliente !== r.visivelEm) {
          divergencias.push(`sequência ${s}, item ${k}: cliente ${cliente}, servidor ${r.visivelEm}`);
        }
      }
    }
    // A grade precisa ter exercitado o colapso, senão não provou a parte que quebrou.
    expect(colapsos, "nenhuma sequência colapsou — a grade não cobre o colapso").toBeGreaterThan(0);
    expect(divergencias, divergencias.slice(0, 5).join("\n")).toEqual([]);
  });
});
