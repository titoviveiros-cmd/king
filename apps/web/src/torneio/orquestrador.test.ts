/**
 * O ORQUESTRADOR — a chave, os classificados, o desempate, a vitória e a eliminação.
 *
 * Tudo determinístico: as mesas de bots são PARTIDAS REAIS do motor (Bot Normal nos quatro
 * assentos), e a do humano, quando o teste não dita o resultado, é jogada pelo mesmo bot no lugar
 * dele. Nada aqui inventa pontuação, exceto onde o teste diz explicitamente que está ditando fatos
 * — e mesmo esses fatos passam pela validação de checksums do motor.
 */
import { describe, it, expect } from "vitest";
import { AVATARES, type Avatar } from "../ui/avatares.js";
import { FORMATOS } from "./formatos.js";
import { NOMES_DO_TORNEIO } from "./participantes.js";
import { classificar, numeroDoSorteio, type FatosDaMesa } from "./desempate.js";
import { jogarMesaDeBots } from "./simulacao.js";
import {
  avancarFase, campeao, caminhoDoHumano, criarTorneio, faseAtual, faseDaEliminacao, fatosValidos,
  ID_DO_HUMANO, mesasDaFase, nomesDaMesa, registrarResultado, situacao, temHumano, type Torneio,
} from "./orquestrador.js";

/** Joga o torneio inteiro; a mesa do humano recebe `fatosDoHumano` (ou é jogada pelo bot). */
function jogarTudo(t0: Torneio, fatosDoHumano?: (fase: number) => FatosDaMesa): Torneio {
  let t = t0;
  for (let guarda = 0; guarda < 100; guarda++) {
    const s = situacao(t);
    if (s.tipo === "encerrado") return t;
    if (s.tipo === "simular") {
      for (const m of s.mesas) t = registrarResultado(t, m.id, jogarMesaDeBots(nomesDaMesa(t, m), m.semente));
    } else if (s.tipo === "jogar") {
      const f = fatosDoHumano?.(s.mesa.fase) ?? jogarMesaDeBots(nomesDaMesa(t, s.mesa), s.mesa.semente);
      t = registrarResultado(t, s.mesa.id, f);
    } else {
      t = avancarFase(t);
    }
  }
  throw new Error("o torneio não terminou");
}

/** Fatos VÁLIDOS de partida inteira em que o assento `vencedor` faz tudo e o resto perde. */
function fatosComVencedor(vencedor: number, segundo: number): FatosDaMesa {
  const pontos = [0, 0, 0, 0];
  const negativas = [0, 0, 0, 0];
  const ilesas = [0, 0, 0, 0];
  // vencedor: 0 nas negativas e as 52 vazas positivas (+1300). Os outros dividem −1300.
  const perdedores = [0, 1, 2, 3].filter((s) => s !== vencedor);
  const cargas = new Map<number, number>();
  for (const s of perdedores) cargas.set(s, s === segundo ? -300 : -500);
  for (const s of [0, 1, 2, 3]) {
    if (s === vencedor) { negativas[s] = 0; pontos[s] = 1300; ilesas[s] = 6; }
    else { negativas[s] = cargas.get(s)!; pontos[s] = negativas[s]; }
  }
  return { pontos, negativas, ilesas };
}

describe("os nomes do torneio", () => {
  it("31 bots, todos diferentes, todos cabendo em 14 caracteres", () => {
    expect(NOMES_DO_TORNEIO.length).toBeGreaterThanOrEqual(31);
    expect(new Set(NOMES_DO_TORNEIO).size).toBe(NOMES_DO_TORNEIO.length);
    for (const n of NOMES_DO_TORNEIO) expect(n.length, n).toBeLessThanOrEqual(14);
    expect(NOMES_DO_TORNEIO).not.toContain("Você");
  });
});

describe.each([
  ["mini16", 16, 4, 3],
  ["copa32", 32, 8, 4],
] as const)("a chave %s", (formato, n, mesasIniciais, partidasNoCaminho) => {
  it(`${n} participantes em ${mesasIniciais} mesas de 4, humano uma vez e sempre no assento 0`, () => {
    for (let semente = 1; semente <= 30; semente++) {
      const t = criarTorneio(formato, semente, "raposa");
      expect(t.participantes).toHaveLength(n);
      const f0 = mesasDaFase(t, 0);
      expect(f0).toHaveLength(mesasIniciais);
      const ids = f0.flatMap((m) => m.assentos);
      expect(new Set(ids).size).toBe(n);
      const minhas = f0.filter(temHumano);
      expect(minhas).toHaveLength(1);
      expect(minhas[0].assentos[0]).toBe(ID_DO_HUMANO);
      expect(t.participantes[ID_DO_HUMANO]).toMatchObject({ humano: true, avatar: "raposa", nome: "Você" });
    }
  });

  it("nenhuma mesa inicial repete bicho — para qualquer avatar do humano", () => {
    for (const av of AVATARES) {
      for (let semente = 0; semente < 12; semente++) {
        const t = criarTorneio(formato, semente * 7919, av as Avatar);
        for (const m of mesasDaFase(t, 0)) {
          const bichos = m.assentos.map((id) => t.participantes[id].avatar);
          expect(new Set(bichos).size, `${av} semente ${semente} ${m.id}`).toBe(4);
        }
      }
    }
  });

  it(`o torneio inteiro roda com partidas reais: ${FORMATOS[formato].fases.length} fases, 2 classificados por mesa, um campeão`, () => {
    const t = jogarTudo(criarTorneio(formato, 2026, "leao"));
    expect(faseAtual(t)).toBe(FORMATOS[formato].fases.length - 1);
    for (let f = 1; f <= faseAtual(t); f++) {
      const anteriores = mesasDaFase(t, f - 1);
      for (const m of mesasDaFase(t, f)) {
        const a = anteriores[2 * m.indice].resultado!.classificacao.ordem;
        const b = anteriores[2 * m.indice + 1].resultado!.classificacao.ordem;
        // exatamente os 2 primeiros de cada mesa alimentadora — nem mais, nem menos
        expect(new Set(m.assentos)).toEqual(new Set([a[0], a[1], b[0], b[1]]));
      }
    }
    expect(campeao(t)).not.toBeNull();
    expect(mesasDaFase(t, faseAtual(t))).toHaveLength(1);
    const caminho = caminhoDoHumano(t);
    const eliminado = faseDaEliminacao(t);
    expect(caminho.length).toBe(eliminado === null ? partidasNoCaminho : eliminado + 1);
  });

  it("vitória: o humano que vence todas as mesas é o campeão, em exatamente " + partidasNoCaminho + " partidas", () => {
    const t = jogarTudo(criarTorneio(formato, 77, "sapo"), () => fatosComVencedor(0, 1));
    expect(campeao(t)).toBe(ID_DO_HUMANO);
    expect(faseDaEliminacao(t)).toBeNull();
    expect(caminhoDoHumano(t)).toHaveLength(partidasNoCaminho);
  });

  it("eliminação: o humano em 3º sai na primeira fase, e o torneio termina sem ele", () => {
    const t = jogarTudo(criarTorneio(formato, 78, "panda"), () => fatosComVencedor(1, 2));
    expect(faseDaEliminacao(t)).toBe(0);
    expect(caminhoDoHumano(t)).toHaveLength(1);
    expect(campeao(t)).not.toBe(ID_DO_HUMANO);
    expect(campeao(t)).not.toBeNull();
  });
});

describe("determinismo", () => {
  it("mesma semente → mesmo torneio, mesa a mesa", () => {
    const a = jogarTudo(criarTorneio("copa32", 99, "coruja"));
    const b = jogarTudo(criarTorneio("copa32", 99, "coruja"));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("semente diferente → sorteio diferente", () => {
    const a = criarTorneio("mini16", 1, "leao").mesas.map((m) => m.assentos.join());
    const b = criarTorneio("mini16", 2, "leao").mesas.map((m) => m.assentos.join());
    expect(b).not.toEqual(a);
  });
});

describe("registro de resultado", () => {
  it("é idempotente: a mesma mesa registrada duas vezes não muda nada", () => {
    const t0 = criarTorneio("mini16", 5, "leao");
    const m = mesasDaFase(t0, 0)[0];
    const f = jogarMesaDeBots(nomesDaMesa(t0, m), m.semente);
    const t1 = registrarResultado(t0, m.id, f);
    const t2 = registrarResultado(t1, m.id, fatosComVencedor(3, 2));
    expect(t2).toBe(t1);
    expect(t2.mesas.filter((x) => x.resultado)).toHaveLength(1);
    expect(t0.mesas.every((x) => !x.resultado), "o torneio anterior não é mutado").toBe(true);
  });

  it("recusa mesa desconhecida e fatos que não fecham com as regras", () => {
    const t = criarTorneio("mini16", 5, "leao");
    const id = mesasDaFase(t, 0)[0].id;
    expect(() => registrarResultado(t, "f9m9", fatosComVencedor(0, 1))).toThrow();
    const roubado = fatosComVencedor(0, 1);
    roubado.pontos[0] += 25; // vitória fabricada: a soma deixa de ser 0
    expect(() => registrarResultado(t, id, roubado)).toThrow();
    expect(() => registrarResultado(t, id, { pontos: [0, 0, 0], negativas: [0, 0, 0], ilesas: [0, 0, 0] } as FatosDaMesa)).toThrow();
  });

  it("não avança a fase com mesa pendente", () => {
    const t = criarTorneio("mini16", 5, "leao");
    expect(avancarFase(t)).toBe(t);
  });

  it("a ordem da experiência: primeiro os bots, depois o humano, depois a fase seguinte", () => {
    let t = criarTorneio("mini16", 11, "leao");
    const s1 = situacao(t);
    expect(s1.tipo).toBe("simular");
    if (s1.tipo === "simular") {
      expect(s1.mesas).toHaveLength(3);
      for (const m of s1.mesas) t = registrarResultado(t, m.id, jogarMesaDeBots(nomesDaMesa(t, m), m.semente));
    }
    const s2 = situacao(t);
    expect(s2.tipo).toBe("jogar");
    if (s2.tipo === "jogar") t = registrarResultado(t, s2.mesa.id, fatosComVencedor(0, 1));
    expect(situacao(t)).toEqual({ tipo: "avancar", proximaFase: 1 });
  });
});

describe("validação dos fatos (checksums oficiais)", () => {
  it("toda partida real de bots passa; a partida da mão 10 de QA também", () => {
    for (let s = 0; s < 10; s++) expect(fatosValidos(jogarMesaDeBots(["a", "b", "c", "d"], s * 31), 1)).toBe(true);
    expect(fatosValidos({ pontos: [325, 0, 0, 0], negativas: [0, 0, 0, 0], ilesas: [0, 0, 0, 0] }, 10)).toBe(true);
    expect(fatosValidos({ pontos: [325, 0, 0, 0], negativas: [0, 0, 0, 0], ilesas: [0, 0, 0, 0] }, 1)).toBe(false);
  });
});

describe("o desempate do torneio", () => {
  const ids = [10, 11, 12, 13];
  const base = (): FatosDaMesa => ({ pontos: [100, 100, -50, -150], negativas: [-200, -300, -350, -450], ilesas: [2, 1, 1, 0] });

  it("1) pontuação total decide quando não há empate", () => {
    const f: FatosDaMesa = { pontos: [-150, 300, 0, -150], negativas: [-400, -300, -200, -400], ilesas: [0, 1, 2, 0] };
    const c = classificar(ids, f, 1);
    expect(c.ordem.slice(0, 2)).toEqual([11, 12]);
  });

  it("2) empate no total → perdeu menos nas negativas", () => {
    const c = classificar(ids, base(), 1);
    expect(c.ordem.slice(0, 2)).toEqual([10, 11]);
    expect(c.desempates).toEqual([{ acima: 10, abaixo: 11, criterio: "negativas" }]);
  });

  it("3) empate no total e nas negativas → mais negativas ilesas", () => {
    const f = base();
    f.negativas[1] = -200;
    f.ilesas = [1, 3, 1, 0];
    const c = classificar(ids, f, 1);
    expect(c.ordem.slice(0, 2)).toEqual([11, 10]);
    expect(c.desempates[0]).toEqual({ acima: 11, abaixo: 10, criterio: "ilesas" });
  });

  it("4) empate em tudo → sorteio pela semente: determinístico e independente da ordem dos assentos", () => {
    const f: FatosDaMesa = { pontos: [0, 0, 0, 0], negativas: [-325, -325, -325, -325], ilesas: [1, 1, 1, 1] };
    const a = classificar(ids, f, 4242);
    const esperado = ids.slice().sort((x, y) => numeroDoSorteio(4242, x) - numeroDoSorteio(4242, y));
    expect(a.ordem).toEqual(esperado);
    expect(a.desempates.every((d) => d.criterio === "sorteio")).toBe(true);
    expect(classificar([13, 12, 11, 10], f, 4242).ordem).toEqual(a.ordem);
    expect(classificar(ids, f, 4243).ordem, "outra mesa, outro sorteio (com estas sementes)").not.toEqual(a.ordem);
  });

  it("não altera o ranking oficial: a classificação é derivada, os fatos ficam intocados", () => {
    const f = base();
    const copia = JSON.stringify(f);
    classificar(ids, f, 1);
    expect(JSON.stringify(f)).toBe(copia);
  });
});
