// Rodada 8: o monitor contínuo mede POR JANELA, sempre pela diferença começo → fim (o playbackStats do
// Chromium é acumulado desde que o contexto nasceu).
import { describe, expect, it } from "vitest";
import { criarMonitor, diferenca, lerEstatisticas, resumoEmCampos } from "./monitorDeAudio.js";

/** Um relógio de mentira controlado pelo teste: tempo real, currentTime e estatísticas acumuladas. */
function mundo() {
  let agora = 0;
  let fila: { em: number; fn: () => void }[] = [];
  const ctx = { state: "running", currentTime: 0, playbackStats: { underrunEvents: 0, underrunDuration: 0, totalDuration: 0 } as Record<string, number> };
  let vis = true;
  let atual: typeof ctx | null = ctx;
  return {
    ctx,
    trocar(novo: typeof ctx | null) { atual = novo; },
    esconder(v: boolean) { vis = !v; },
    /** Avança `ms` de tempo real com o contexto rendendo `razao` e `ev` underruns por segundo. */
    andar(ms: number, razao = 1, ev = 0) {
      const fim = agora + ms;
      while (true) {
        fila.sort((a, b) => a.em - b.em);
        const prox = fila[0];
        const ate = prox && prox.em <= fim ? prox.em : fim;
        const dt = (ate - agora) / 1000;
        if (atual) {
          atual.currentTime += dt * razao;
          const st = atual.playbackStats as Record<string, number> | undefined;
          if (st) {
            st.underrunEvents += dt * ev;
            st.underrunDuration += dt * (1 - razao);
            st.totalDuration += dt;
          }
        }
        agora = ate;
        if (!prox || prox.em > fim) break;
        fila = fila.slice(1);
        prox.fn();
      }
    },
    opcoes: () => ({
      contexto: () => atual,
      perfil: () => "leve",
      visivel: () => vis,
      agora: () => agora,
      agendar: (fn: () => void, ms: number) => { const h = { em: agora + ms, fn }; fila.push(h); return h; },
      cancelar: (h: unknown) => { fila = fila.filter((x) => x !== h); },
    }),
  };
}

describe("monitor contínuo do relógio (rodada 8)", () => {
  it("underruns POR JANELA = diferença começo → fim; nunca o acumulado de antes do monitor", () => {
    const w = mundo();
    w.ctx.playbackStats.underrunEvents = 1_000; // o contexto já vinha acumulando antes do monitor
    w.ctx.playbackStats.totalDuration = 300;
    const m = criarMonitor(w.opcoes());
    m.iniciar();
    w.andar(5_000, 1, 0);
    w.andar(5_000, 0.5, 4);
    const [a, b] = m.janelas();
    expect(a!.razao).toBe(1);
    expect(a!.underrunEventos, "a 1ª janela não herda os 1.000 de antes").toBe(0);
    expect(b!.razao).toBe(0.5);
    expect(b!.underrunEventos).toBe(20);
    expect(b!.underrunSegundos).toBe(2.5);
    expect(b!.totalSegundos).toBe(5);
    const r = m.resumo();
    expect(r.porPerfil.leve).toMatchObject({ janelas: 2, razaoMin: 0.5, razaoMedia: 0.75, abaixoDe095: 1, underrunEventos: 20, underrunSegundos: 2.5 });
    expect(resumoEmCampos(r)["leve.fracaoUnderrun"]).toBe(0.25);
  });

  it("troca de contexto no meio: a janela não vale (razão nula, sem underrun) e a próxima parte da base nova", () => {
    const w = mundo();
    const m = criarMonitor(w.opcoes());
    m.iniciar();
    w.andar(5_000);
    const novo = { state: "running", currentTime: 0, playbackStats: { underrunEvents: 0, underrunDuration: 0, totalDuration: 0 } as Record<string, number> };
    w.trocar(novo);
    w.andar(5_000);
    w.andar(5_000, 0.9, 0);
    const [, troca, depois] = m.janelas();
    expect(troca).toMatchObject({ contextoNovo: true, razao: null, underrunEventos: null });
    expect(depois).toMatchObject({ contextoNovo: false, razao: 0.9 });
    expect(m.resumo().trocasDeContexto).toBe(1);
  });

  it("janela com a página escondida é marcada e fica fora da média", () => {
    const w = mundo();
    const m = criarMonitor(w.opcoes());
    m.iniciar();
    w.andar(5_000, 1);
    w.esconder(true);
    w.andar(5_000, 0.1);
    w.esconder(false);
    w.andar(5_000, 1);
    w.andar(5_000, 1);
    const r = m.resumo();
    expect(r.emFundo).toBe(2); // a janela escondida e a que começou escondida
    expect(r.porPerfil.leve!.razaoMin).toBe(1);
  });

  it("sem playbackStats (WebView que não expõe): só a razão, underrun nulo — nada inventado", () => {
    const w = mundo();
    delete (w.ctx as { playbackStats?: unknown }).playbackStats;
    const m = criarMonitor(w.opcoes());
    m.iniciar();
    w.andar(5_000, 0.8);
    expect(m.janelas()[0]).toMatchObject({ razao: 0.8, underrunEventos: null, underrunSegundos: null });
    expect(lerEstatisticas(null)).toEqual({});
    expect(diferenca({ a: 5 }, {}, "a")).toBeNull();
  });

  it("parar desliga o agendamento; o anel guarda no máximo `max` janelas", () => {
    const w = mundo();
    const m = criarMonitor({ ...w.opcoes(), max: 3 });
    m.iniciar();
    w.andar(25_000);
    expect(m.janelas()).toHaveLength(3);
    m.parar();
    expect(m.resumo().ligado).toBe(false);
    w.andar(20_000);
    expect(m.janelas()).toHaveLength(3);
  });
});
