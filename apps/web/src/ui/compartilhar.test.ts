// O TEXTO DE COMPARTILHAR — o único pedaço do KING que sai do aparelho por vontade da pessoa.
//
// Por isso a suíte é mais dura aqui do que em qualquer outra microcopy: o que estes testes
// protegem não é estilo, é a promessa de que a mensagem diz a verdade e não vaza nada.
//
//   • cada posição tem a sua mensagem, e o campeão não é o padrão;
//   • a estatística de destaque só aparece quando o motor pode derivá-la;
//   • nenhum identificador interno, token ou código de sala atravessa;
//   • cabe numa prévia de WhatsApp;
//   • nenhum travessão, que é a marca registrada de texto de máquina.
import { describe, expect, it } from "vitest";
import { createMatch, matchStats, rankings, type MatchState, type Seat } from "@king/engine";
import { destaqueReal, textoDoCompartilhamento, type DadosDoCompartilhamento } from "./compartilhar.js";

const JOGADORES = ["Tito", "Bia", "Léo", "Nara"];

/** Uma classificação forjada, com posições explícitas. Não inventa regra: só arruma a vitrine. */
function finaisCom(scores: number[]) {
  const ordenado = scores
    .map((score, seat) => ({ seat: seat as Seat, player: JOGADORES[seat], score }))
    .sort((a, b) => b.score - a.score);
  return ordenado.map((r, i) => ({
    ...r,
    position: i > 0 && ordenado[i - 1].score === r.score ? i : i + 1,
    tied: ordenado.some((o, j) => j !== i && o.score === r.score),
  }));
}

/** Estatísticas zeradas: nenhum destaque é derivável, então nenhum deve aparecer. */
function statsVazias() {
  const m: MatchState = createMatch(JOGADORES, 7);
  const s = matchStats(m);
  return s;
}

function dados(parcial: Partial<DadosDoCompartilhamento> = {}): DadosDoCompartilhamento {
  return {
    finais: finaisCom([185, 40, -60, -165]),
    eu: 0,
    players: JOGADORES,
    stats: statsVazias(),
    empate: false,
    ...parcial,
  };
}

describe("cada posição recebe a sua mensagem", () => {
  const posicoes: [Seat, string][] = [[0, "🥇"], [1, "🥈"], [2, "🥉"], [3, "🎲"]];

  it.each(posicoes)("assento %i abre com a medalha da posição dele", (eu, medalha) => {
    const t = textoDoCompartilhamento(dados({ eu }));
    expect(t).toContain(medalha);
    expect(t).toContain(JOGADORES[eu]);
  });

  it("as quatro mensagens são DIFERENTES entre si", () => {
    const textos = posicoes.map(([eu]) => textoDoCompartilhamento(dados({ eu })));
    expect(new Set(textos).size).toBe(4);
  });

  it("o último lugar não recebe a mensagem de campeão, nem leva humilhação", () => {
    const t = textoDoCompartilhamento(dados({ eu: 3 }));
    expect(t).not.toMatch(/CAMPEÃO/);
    // a manchete do quarto aponta para a próxima partida, não para o fracasso
    expect(t).toMatch(/PRÓXIMA/);
  });

  it("empate na liderança não diz que alguém venceu", () => {
    const t = textoDoCompartilhamento(dados({
      finais: finaisCom([120, 120, -100, -140]), eu: 0, empate: true,
    }));
    expect(t).not.toMatch(/venceu/i);
    expect(t).toContain("DIVIDIRAM O TOPO");
    expect(t).toContain("Bia");
  });

  it("o placar real da mesa aparece, com o sinal certo", () => {
    const t = textoDoCompartilhamento(dados());
    expect(t).toContain("🥇 Tito\n+185");
    expect(t).toContain("4️⃣ Nara\n−165");
  });

  // A DIFERENÇA QUE FAZ A MENSAGEM FUNCIONAR NO CELULAR.
  // Numa linha só, o WhatsApp quebra onde couber e o placar vira um parágrafo de números.
  it("o placar é VERTICAL: um jogador por linha, saldo embaixo do nome", () => {
    const linhas = textoDoCompartilhamento(dados()).split("\n");
    for (const nome of ["Tito", "Bia", "Léo", "Nara"]) {
      const i = linhas.findIndex((l) => l.includes(nome) && /[🥇🥈🥉4]/u.test(l));
      expect(i, `${nome} não tem linha própria no placar`).toBeGreaterThan(-1);
      expect(linhas[i + 1], `o saldo de ${nome} não vem logo abaixo`).toMatch(/^[+−]\d+$/);
    }
  });

  it("tem cabeçalho de placar e fecho de partida", () => {
    const t = textoDoCompartilhamento(dados());
    expect(t).toContain("📊 PLACAR FINAL");
    expect(t).toContain("🎴 10 mãos. 4 jogadores.");
  });

  // Texto que sai do aparelho não pode depender de caractere exótico: o que atravessa WhatsApp,
  // Telegram e SMS são emoji comuns, quebra de linha e pontuação.
  it("só usa caracteres que qualquer app de mensagem carrega", () => {
    const t = textoDoCompartilhamento(dados({ eu: 0, stats: { ...statsVazias(), margin: 20 } }));
    expect(t, "caractere de controle").not.toMatch(new RegExp("[\u0000-\u0008\u000B-\u001F\u007F]"));
    expect(t, "caractere de largura zero").not.toMatch(new RegExp("[\u200B-\u200D\uFEFF]"));
    expect(t, "tabulação").not.toMatch(new RegExp("\t"));
  });

  it("o saldo de quem compartilha é o dele, não o do campeão", () => {
    expect(textoDoCompartilhamento(dados({ eu: 2 }))).toContain("🔥 −60 pontos");
  });
});

describe("estatística só quando é verdade", () => {
  it("partida sem histórico não produz destaque nenhum", () => {
    expect(destaqueReal(dados())).toBeNull();
  });

  it("levar o Rei e vencer mesmo assim é o destaque mais raro", () => {
    const s = { ...statsVazias(), kingTaker: 0 as Seat };
    expect(destaqueReal(dados({ stats: s, eu: 0 }))).toContain("Levou o Rei de Copas e venceu");
  });

  it("escapar do Rei só é dito quando o Rei teve dono, e não foi você", () => {
    const comDono = { ...statsVazias(), kingTaker: 2 as Seat };
    expect(destaqueReal(dados({ stats: comDono, eu: 0 }))).toBe("👑 Escapou do Rei de Copas");
    // sem dono, a mão 5 não foi jogada: não há o que dizer
    expect(destaqueReal(dados({ stats: statsVazias(), eu: 0 }))).toBeNull();
  });

  it("decisão apertada usa a margem real do motor", () => {
    const s = { ...statsVazias(), margin: 25 };
    expect(destaqueReal(dados({ stats: s }))).toBe("🔥 Decidida por 25 pontos");
  });

  it("margem larga NÃO vira decisão apertada", () => {
    const s = { ...statsVazias(), margin: 145 };
    expect(destaqueReal(dados({ stats: s }))).toBeNull();
  });

  it("nunca mais de uma estatística na mensagem", () => {
    const s = { ...statsVazias(), kingTaker: 2 as Seat, margin: 20 };
    const t = textoDoCompartilhamento(dados({ stats: s }));
    const emojis = ["👑 Escapou", "🔥 Decidida", "🛡️ Passou", "⚔️"];
    expect(emojis.filter((e) => t.includes(e))).toHaveLength(1);
  });
});

describe("nada que não seja da mesa atravessa", () => {
  const t = () => textoDoCompartilhamento(dados({ stats: { ...statsVazias(), margin: 20 } }));

  it("nenhum identificador interno, token ou código de sala", () => {
    for (const proibido of [/playerId/i, /sessionToken/i, /recovery/i, /roomId/i, /\broomCode\b/i,
      /sala \d{4}/i, /seed/i, /assento \d/i]) {
      expect(t(), `vazou: ${proibido}`).not.toMatch(proibido);
    }
  });

  it("nenhuma carta, mão ou informação privada de ninguém", () => {
    // O texto fala de RESULTADO. Mão de jogador é segredo do dono, inclusive depois do fim.
    expect(t()).not.toMatch(/♠|♥|♦|♣/);
  });

  it("nenhum número que não venha do resultado real", () => {
    // Só podem aparecer: saldos, posições, a margem e o "10 mãos".
    const numeros = [...t().matchAll(/-?\d+/g)].map((m) => Math.abs(Number(m[0])));
    for (const n of numeros) {
      expect([185, 40, 60, 165, 10, 1, 2, 3, 4, 20], `número inesperado: ${n}`).toContain(n);
    }
  });
});

describe("forma da mensagem", () => {
  it("cabe numa prévia de WhatsApp", () => {
    for (const eu of [0, 1, 2, 3] as Seat[]) {
      const t = textoDoCompartilhamento(dados({ eu, stats: { ...statsVazias(), margin: 20 } }));
      // O placar vertical custa linhas, e vale: o teto é a prévia do WhatsApp, não a contagem.
      expect(t.length, `posição ${eu + 1}: ${t.length} caracteres`).toBeLessThanOrEqual(420);
      expect(t.split("\n").length, `posição ${eu + 1}`).toBeLessThanOrEqual(26);
    }
  });

  it("sem travessão, em nenhuma posição", () => {
    for (const eu of [0, 1, 2, 3] as Seat[]) {
      expect(textoDoCompartilhamento(dados({ eu }))).not.toMatch(/[—–]/);
    }
  });

  it("abre com a marca e fecha convidando outra partida", () => {
    const t = textoDoCompartilhamento(dados({ eu: 1 }));
    expect(t.startsWith("👑 KING")).toBe(true);
    expect(t.trimEnd().endsWith("essa é minha.")).toBe(true);
  });

  it("o nome de quem compartilha aparece na manchete e na linha dele do placar", () => {
    const t = textoDoCompartilhamento(dados({ eu: 0 }));
    // A manchete usa MAIÚSCULAS e o placar usa o nome como a pessoa escreveu: são ocorrências
    // diferentes de propósito, e nenhuma delas é repetição da outra.
    expect(t).toContain("🏆 TITO É O CAMPEÃO!");
    expect(t).toContain("🥇 Tito");
    expect(t.split("Tito").length - 1).toBe(1); // só a do placar preserva a caixa original
  });
});

describe("o placar vem do motor, não de um vetor à mão", () => {
  it("uma partida real produz mensagem coerente com os rankings", () => {
    const m = createMatch(JOGADORES, 42);
    const finais = rankings(m);
    const t = textoDoCompartilhamento({
      finais, eu: 0, players: JOGADORES, stats: matchStats(m), empate: false,
    });
    for (const r of finais) expect(t).toContain(JOGADORES[r.seat]);
  });
});
