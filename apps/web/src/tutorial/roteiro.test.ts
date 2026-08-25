// O ROTEIRO CUMPRE A PROMESSA DE PRODUTO.
//
// A promessa é uma lista: dezesseis conceitos, ensinados jogando, em 2 a 4 minutos, sem prender
// ninguém. Cada teste aqui cobra um pedaço dessa frase.
import { describe, expect, it } from "vitest";
import { cardId } from "@king/engine";
import { CONCEITOS, ROTEIRO, TOTAL_DE_PASSOS, cenaEm, passoEm } from "./roteiro.js";
import { CENAS, legaisDoAluno, montarCena, type CenaId } from "./cenas.js";
import { PartidaDeTreino } from "./partidaDeTreino.js";

/**
 * A cena como ela estará QUANDO o passo `i` chegar — e não como nasce.
 *
 * A diferença importa: na cena positiva o tutorial primeiro escolhe o trunfo e só depois pede a
 * vaza. Testar o alvo de "+25" no estado recém-montado media um momento que o jogador nunca vê,
 * e foi assim que este teste encontrou um alvo vazio.
 */
function comCenaPronta(i: number): PartidaDeTreino {
  const jogo = new PartidaDeTreino(cenaEm(i));
  const passo = ROTEIRO[i];
  const espera = jogo.estado().hand?.awaitingTrumpFrom;
  if (passo.acao !== "trunfo" && espera === 0) {
    const trunfo = ROTEIRO.find((p) => p.acao === "trunfo")?.trunfoAlvo ?? "spades";
    jogo.escolherTrunfo(trunfo);
  }
  return jogo;
}

describe("os dezesseis conceitos", () => {
  it("todos são ensinados, exatamente uma vez cada", () => {
    expect(ROTEIRO.map((p) => p.id)).toEqual([...CONCEITOS]);
  });

  it("nenhum passo fica sem fala", () => {
    for (const p of ROTEIRO) expect(p.fala.trim().length, p.id).toBeGreaterThan(0);
  });

  it("a fala é CURTA — o Rei orienta, não domina a tela", () => {
    for (const p of ROTEIRO) expect(p.fala.length, `${p.id}: ${p.fala}`).toBeLessThanOrEqual(120);
  });

  it("nenhuma fala usa vocabulário interno do projeto", () => {
    for (const p of [...ROTEIRO]) {
      expect(p.fala, p.id).not.toMatch(/fase \d|milestone|MVP|assento \d|seat|bot normal/i);
    }
  });

  // TRAVESSÃO É RECURSO DE REDAÇÃO, e numa faixa de tutorial ele vira ruído: quebra a leitura,
  // come largura que não sobra e é a marca registrada de texto escrito por máquina. Vale para
  // toda a microcopy do roteiro, não só para a fala.
  it("nenhum texto do roteiro usa travessão", () => {
    for (const p of ROTEIRO) {
      const partes: [string, string | undefined][] =
        [["fala", p.fala], ["acerto", p.acerto], ["erro", p.erro]];
      for (const [onde, t] of partes) {
        if (t) expect(t, `${p.id}.${onde}: ${t}`).not.toMatch(/[—–]/);
      }
    }
  });

  // O ERRO QUE ESTA AUDITORIA VEIO CORRIGIR: o roteiro dizia "cinco perigos" e pulava a mão 5.
  it("as seis mãos negativas aparecem, na ordem, e nenhuma é pulada", () => {
    const maos = ROTEIRO.map((p) => p.id).filter((id) => /^mao-\d$/.test(id));
    expect(maos).toEqual(["mao-1", "mao-2", "mao-3", "mao-4", "mao-5", "mao-6"]);
  });

  it("nenhuma fala diz que os perigos são cinco", () => {
    for (const p of ROTEIRO) expect(p.fala, p.id).not.toMatch(/cinco perigos|5 perigos/i);
  });

  // A regra oficial: nas quatro positivas a escolha RODA entre os quatro jogadores. Dizer
  // "agora você escolhe o trunfo" como regra geral seria ensinar errado.
  it("a fase positiva é apresentada como rotação entre jogadores, e cita Sem Trunfo", () => {
    const p = ROTEIRO.find((x) => x.id === "positivas")!;
    expect(p.fala).toMatch(/4 mãos positivas/);
    expect(p.fala).toMatch(/um jogador diferente/i);
    expect(p.fala).toMatch(/Sem Trunfo/);
  });

  it("o passo do trunfo contextualiza a vez do aluno sem virar regra geral", () => {
    const p = ROTEIRO.find((x) => x.id === "trunfo")!;
    expect(p.fala).toMatch(/nesta mão/i);
    expect(p.fala).toMatch(/Sem Trunfo/);
  });
});

describe("ensina JOGANDO, não lendo", () => {
  it("toda MECÂNICA é aprendida fazendo, não lendo", () => {
    // A régua certa não é a proporção de passos, é ESTA lista. Servir, negar, escapar do Rei,
    // escolher trunfo e ganhar vaza são as cinco coisas que a pessoa vai FAZER a partida inteira,
    // e nenhuma delas pode ser ensinada com um botão "próximo".
    const mecanicas = ["servir", "negar", "mao-5", "trunfo", "mais-25"];
    for (const id of mecanicas) {
      const p = ROTEIRO.find((x) => x.id === id)!;
      expect(p.acao, id).not.toBe("toque");
    }
    // o resto é contexto (objetivo, valores das cartas, quem vence) — isso se lê em uma linha
    const lendo = ROTEIRO.filter((p) => p.acao === "toque").map((p) => p.id);
    expect(lendo).not.toContain("servir");
    expect(lendo).not.toContain("mais-25");
  });

  it("cada uma das quatro cenas é realmente usada", () => {
    const usadas = new Set(ROTEIRO.map((p) => p.cena).filter(Boolean));
    expect([...usadas].sort()).toEqual(Object.keys(CENAS).sort());
  });

  it("o primeiro passo monta uma cena — a mesa nunca abre vazia", () => {
    expect(ROTEIRO[0].cena).toBeTruthy();
  });

  it("cabe em 2 a 4 minutos: dezesseis passos, nenhuma partida inteira", () => {
    expect(TOTAL_DE_PASSOS).toBeGreaterThanOrEqual(12);
    expect(TOTAL_DE_PASSOS).toBeLessThanOrEqual(20);
  });
});

describe("todo alvo didático existe na mesa daquele momento", () => {
  // Se um alvo devolvesse carta que o motor não aceita, o tutorial pediria o impossível.
  const passosComAlvo = ROTEIRO.map((p, i) => ({ p, i })).filter(({ p }) => p.alvo);

  it.each(passosComAlvo.map(({ p, i }) => [p.id, i] as const))(
    "passo %s: o alvo é subconjunto do que o motor permite",
    (_id, i) => {
      const passo = ROTEIRO[i];
      const jogo = comCenaPronta(i);
      const alvo = passo.alvo!(jogo.estado());
      const legais = legaisDoAluno(jogo.estado()).map(cardId);
      expect(alvo.length).toBeGreaterThan(0);
      for (const c of alvo) expect(legais).toContain(cardId(c));
    },
  );

  it("o passo do trunfo pede um naipe que o aluno realmente tem", () => {
    const passo = ROTEIRO.find((p) => p.acao === "trunfo")!;
    const i = ROTEIRO.indexOf(passo);
    const m = montarCena(cenaEm(i));
    expect(m.hand!.hands[0].some((c) => c.suit === passo.trunfoAlvo)).toBe(true);
  });
});

describe("ninguém fica preso", () => {
  it("todo passo de ação tem resposta para o ACERTO", () => {
    for (const p of ROTEIRO.filter((x) => x.acao !== "toque")) {
      expect(p.acerto, p.id).toBeTruthy();
    }
  });

  it("todo passo com alvo tem resposta para o ERRO — errar explica, não trava", () => {
    // O passo "negar" é a exceção declarada: qualquer carta é uma lição válida ali.
    for (const p of ROTEIRO.filter((x) => x.acao !== "toque" && x.id !== "negar")) {
      expect(p.erro, p.id).toBeTruthy();
    }
  });
});

describe("navegação do roteiro", () => {
  it("passoEm satura nas pontas em vez de devolver undefined", () => {
    expect(passoEm(-5)).toBe(ROTEIRO[0]);
    expect(passoEm(0)).toBe(ROTEIRO[0]);
    expect(passoEm(999)).toBe(ROTEIRO[TOTAL_DE_PASSOS - 1]);
    expect(passoEm(NaN)).toBe(ROTEIRO[0]);
  });

  it("cenaEm devolve a última cena declarada até ali", () => {
    for (let i = 0; i < TOTAL_DE_PASSOS; i++) {
      const c = cenaEm(i) as CenaId;
      expect(Object.keys(CENAS)).toContain(c);
    }
    expect(cenaEm(0)).toBe("servir");
    expect(cenaEm(TOTAL_DE_PASSOS - 1)).toBe("positiva");
  });

  it("um índice salvo de um roteiro maior não abre tela branca", () => {
    expect(cenaEm(999)).toBe("positiva");
    expect(passoEm(999).fala.length).toBeGreaterThan(0);
  });
});
