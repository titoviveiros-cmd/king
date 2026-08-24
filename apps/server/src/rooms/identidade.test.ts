// IDENTIDADE — avatar validado e nome de bot atribuído pelo servidor.
//
// Testes puros: nada de sala, nada de rede. O que está em jogo aqui é uma regra só, e ela é
// severa — o cliente NÃO escreve no estado público. Ele sugere; quem decide é este módulo.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVATAR_PADRAO, AVATARES, avatarDeBot, avatarValido, NOMES_DE_BOT, nomeDeBotLivre } from "./identidade.js";

describe("avatar: conjunto fechado", () => {
  it("aceita cada um dos avatares da lista, exatamente como veio", () => {
    for (const a of AVATARES) expect(avatarValido(a)).toBe(a);
  });

  it("qualquer coisa fora da lista vira o padrão — o cliente não injeta texto no estado público", () => {
    for (const lixo of [
      "", "  ", "leaoX", "LEAO", "sapo ", "tigre", "<img src=x onerror=alert(1)>",
      "https://exemplo.com/foto.png", "../../etc/passwd", "a".repeat(5000),
      undefined, null, 7, true, {}, [], { toString: () => "coroa" },
    ]) {
      expect(avatarValido(lixo)).toBe(AVATAR_PADRAO);
    }
  });

  it("o padrão é um avatar de verdade, nunca vazio: o assento não fica com buraco", () => {
    expect(AVATARES).toContain(AVATAR_PADRAO);
    expect(AVATAR_PADRAO.length).toBeGreaterThan(0);
  });

  it("a lista não tem repetidos", () => {
    expect(new Set(AVATARES).size).toBe(AVATARES.length);
  });

  it("a coleção oficial tem os oito bichos aprovados — com Sapo, sem Tigre", () => {
    expect([...AVATARES]).toEqual(
      ["leao", "coruja", "raposa", "macaco", "panda", "tucano", "capivara", "sapo"],
    );
    expect(AVATARES).toHaveLength(8);
    expect(AVATARES as readonly string[]).toContain("sapo");
    expect(AVATARES as readonly string[]).not.toContain("tigre");
  });

  it("o avatar do bot é DETERMINÍSTICO pelo assento e sempre válido", () => {
    for (const seat of [0, 1, 2, 3]) {
      expect(avatarDeBot(seat)).toBe(avatarDeBot(seat));
      expect(AVATARES).toContain(avatarDeBot(seat));
    }
    // quatro assentos, quatro desenhos: dois bots na mesma mesa não ficam idênticos
    expect(new Set([0, 1, 2, 3].map((s) => avatarDeBot(s))).size).toBe(4);
  });

  it("o bot NÃO copia um avatar que alguém na mesa já escolheu", () => {
    // aconteceu de verdade num teste contra a VPS: a Raiza escolheu a Dama e o bot do assento 2
    // nasceu Dama também. Dois desenhos iguais na mesma mesa, distinguíveis só pela cor.
    const preferido = avatarDeBot(2);
    const outro = avatarDeBot(2, [preferido]);
    expect(outro).not.toBe(preferido);
    expect(AVATARES).toContain(outro);
  });

  it("com a mesa inteira ocupada, ainda devolve um avatar válido em vez de explodir", () => {
    expect(AVATARES).toContain(avatarDeBot(1, [...AVATARES]));
  });

  it("sem colisão, o determinismo continua valendo", () => {
    expect(avatarDeBot(3, ["coroa", "rei"])).toBe(avatarDeBot(3));
  });
});

describe("nome de bot: quem batiza é o servidor", () => {
  it("mesa vazia devolve um nome da lista", () => {
    expect(NOMES_DE_BOT as readonly string[]).toContain(nomeDeBotLivre([]));
  });

  it("não repete um nome que já está na mesa — nem de bot, nem de humano", () => {
    const quase = NOMES_DE_BOT.slice(0, NOMES_DE_BOT.length - 1);
    expect(nomeDeBotLivre(quase)).toBe(NOMES_DE_BOT[NOMES_DE_BOT.length - 1]);

    // um humano chamado "Reizinho" também bloqueia o nome: a confusão seria a mesma
    const semReizinho = nomeDeBotLivre(["Reizinho"], () => 0);
    expect(semReizinho).not.toBe("Reizinho");
  });

  it("ignora caixa e espaço ao comparar — 'reizinho ' já é 'Reizinho'", () => {
    expect(nomeDeBotLivre(["  REIZINHO "], () => 0)).not.toBe("Reizinho");
  });

  it("lista esgotada gera sufixo em vez de repetir: ambíguo é pior que feio", () => {
    const nome = nomeDeBotLivre([...NOMES_DE_BOT]);
    expect(NOMES_DE_BOT as readonly string[]).not.toContain(nome);
    expect(nome).toMatch(/ \d+$/);
  });

  it("três chamadas seguidas numa mesma mesa dão três nomes distintos", () => {
    const mesa: string[] = ["Tito"];
    for (let i = 0; i < 3; i++) mesa.push(nomeDeBotLivre(mesa));
    expect(new Set(mesa).size).toBe(mesa.length);
  });

  it("sorteio nas pontas nunca sai da lista", () => {
    for (const r of [0, 0.5, 0.999999, 1]) {
      expect(NOMES_DE_BOT as readonly string[]).toContain(nomeDeBotLivre([], () => r));
    }
  });

  it("a lista não tem repetidos", () => {
    expect(new Set(NOMES_DE_BOT).size).toBe(NOMES_DE_BOT.length);
  });
});

// O cliente desenha os avatares a partir da MESMA lista de etiquetas. Se uma das duas mudar
// sozinha, um jogador veria a coroa onde o outro vê a dama — e nenhum teste de sala pegaria
// isso, porque o servidor continuaria mandando uma etiqueta perfeitamente válida.
describe("contrato com o cliente", () => {
  it("a lista de avatares do web é idêntica à do servidor, na mesma ordem", () => {
    const caminho = fileURLToPath(new URL("../../../web/src/ui/avatares.ts", import.meta.url));
    const fonte = readFileSync(caminho, "utf8");
    const bloco = /export const AVATARES = \[([^\]]*)\]/.exec(fonte);
    expect(bloco, "AVATARES não encontrado em apps/web/src/ui/avatares.ts").not.toBeNull();
    const doWeb = [...bloco![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(doWeb).toEqual([...AVATARES]);

    const padrao = /export const AVATAR_PADRAO: Avatar = "([^"]+)"/.exec(fonte);
    expect(padrao![1]).toBe(AVATAR_PADRAO);
  });
});
