// IDENTIDADE — avatar validado e nome de bot atribuído pelo servidor.
//
// Testes puros: nada de sala, nada de rede. O que está em jogo aqui é uma regra só, e ela é
// severa — o cliente NÃO escreve no estado público. Ele sugere; quem decide é este módulo.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AVATAR_PADRAO, AVATARES, avatarDeBot, avatarLivre, avatarValido, NOMES_DE_BOT, nomeDeBotLivre,
} from "./identidade.js";

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
      ["leao", "coruja", "raposa", "macaco", "panda", "tucano", "unicornio", "sapo"],
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

/**
 * A COLEÇÃO DEPOIS DA TROCA — capivara fora, unicórnio dentro, macaco de volta.
 *
 * O critério da remoção não foi o nome e sim a POSIÇÃO: o avatar imediatamente à esquerda do sapo
 * no seletor, que desenha esta lista na ordem em que ela está escrita. Era a capivara, e ela
 * parecia um mico porque capivara não tem emoji no Unicode: o marcador provisório era 🦫, o
 * castor, que ao lado do 🐵 do macaco lia-se como um segundo primata menor.
 */
describe("a coleção depois da troca", () => {
  it("são exatamente oito, e o número não muda em silêncio", () => {
    expect(AVATARES).toHaveLength(8);
    expect(new Set(AVATARES).size).toBe(8);
  });

  it("o macaco está de volta e a capivara saiu", () => {
    expect(AVATARES as readonly string[]).toContain("macaco");
    expect(AVATARES as readonly string[]).toContain("unicornio");
    expect(AVATARES as readonly string[]).not.toContain("capivara");
  });

  it("quem está à esquerda do sapo é o unicórnio", () => {
    const i = AVATARES.indexOf("sapo");
    expect(AVATARES[i - 1]).toBe("unicornio");
  });

  it("o servidor RECUSA a etiqueta aposentada — conjunto fechado é conjunto fechado", () => {
    // A tradução de `capivara` para `unicornio` é do cliente. Aqui, quem manda uma etiqueta que
    // não existe recebe o padrão, como qualquer outro valor desconhecido.
    expect(avatarValido("capivara")).toBe(AVATAR_PADRAO);
    expect(avatarValido("mico")).toBe(AVATAR_PADRAO);
  });

  it("macaco e unicórnio são aceitos normalmente", () => {
    expect(avatarValido("macaco")).toBe("macaco");
    expect(avatarValido("unicornio")).toBe("unicornio");
  });
});

describe("avatar de bot", () => {
  it("qualquer assento recebe um avatar VÁLIDO", () => {
    for (let seat = 0; seat < 8; seat++) {
      expect(AVATARES as readonly string[]).toContain(avatarDeBot(seat));
    }
  });

  it("nunca recebe a etiqueta removida", () => {
    for (let seat = 0; seat < 8; seat++) {
      expect(avatarDeBot(seat)).not.toBe("capivara");
    }
  });

  it("macaco e unicórnio podem ser sorteados como qualquer outro", () => {
    const todos = new Set<string>();
    for (let seat = 0; seat < AVATARES.length; seat++) todos.add(avatarDeBot(seat));
    expect(todos.has("macaco")).toBe(true);
    expect(todos.has("unicornio")).toBe(true);
  });

  it("com a mesa quase cheia, ainda devolve algo válido em vez de repetir por acidente", () => {
    const ocupados = ["leao", "coruja", "raposa", "macaco", "panda", "tucano", "unicornio"];
    const escolhido = avatarDeBot(0, ocupados);
    expect(AVATARES as readonly string[]).toContain(escolhido);
    expect(escolhido).toBe("sapo");
  });
});

/**
 * A ALOCAÇÃO SEM COLISÃO.
 *
 * Numa mesa, cada bicho é de uma pessoa só. O lobby de cada aparelho já desabilita o que está em
 * uso, mas essa checagem roda antes do envio, sobre uma foto da sala que pode ter envelhecido no
 * caminho — dois humanos podem pedir o Unicórnio no mesmo instante sem que nenhum dos dois saiba
 * do outro. Quem arbitra é quem vê os dois pedidos em ordem, e é esta função.
 */
describe("avatar livre: um bicho por assento", () => {
  it("o pedido passa inteiro quando ninguém o ocupa", () => {
    for (const a of AVATARES) expect(avatarLivre(a, [])).toBe(a);
  });

  it("pedido ocupado vira o próximo LIVRE, nunca o padrão nem o ocupado", () => {
    const escolhido = avatarLivre("leao", ["leao"]);
    expect(escolhido).not.toBe("leao");
    expect(AVATARES).toContain(escolhido!);
  });

  it("com a mesa quase cheia, entrega o único que sobrou", () => {
    const ocupados = AVATARES.slice(0, AVATARES.length - 1);
    const sobrou = AVATARES[AVATARES.length - 1];
    expect(avatarLivre(ocupados[0], ocupados)).toBe(sobrou);
  });

  it("sem alternativa, não inventa duplicado — devolve ausência", () => {
    // Não acontece numa mesa de quatro com oito bichos, e é justamente por isso que precisa de
    // teste: a função não pode depender dessa aritmética continuar verdadeira para ser correta.
    expect(avatarLivre("leao", [...AVATARES])).toBeNull();
  });

  it("etiqueta inválida é normalizada ANTES de procurar lugar", () => {
    // Lixo vira o padrão, e o padrão entra na mesma disputa de ocupação que qualquer outro.
    expect(avatarLivre("<script>", [])).toBe(AVATAR_PADRAO);
    expect(avatarLivre("<script>", [AVATAR_PADRAO])).not.toBe(AVATAR_PADRAO);
  });

  it("quatro entradas em sequência produzem quatro bichos diferentes", () => {
    const mesa: string[] = [];
    for (let i = 0; i < 4; i++) {
      // todo mundo pedindo o MESMO: o pior caso, e o que o lobby não consegue evitar sozinho
      mesa.push(avatarLivre("unicornio", mesa)!);
    }
    expect(new Set(mesa).size).toBe(4);
    expect(mesa[0]).toBe("unicornio");
  });
});
