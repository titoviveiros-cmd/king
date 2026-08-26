/**
 * A MESA LOCAL, e o contrato que a mantém honesta.
 *
 * Os nomes de bot vivem em dois lugares: aqui, no cliente, e em
 * `apps/server/src/rooms/identidade.ts`, no servidor. Não é duplicação por descuido — o cliente não
 * depende do pacote do servidor, e não vai passar a depender por causa de oito strings. O que
 * sustenta a cópia é este arquivo: se uma das listas mudar sozinha, o teste cai.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVATARES } from "../ui/avatares.js";
import {
  MESA_LOCAL, NOMES_DA_MESA_LOCAL, NOMES_DE_BOT, NOME_DO_HUMANO, avatarLocalDoAssento,
} from "./adversarios.js";

/** A lista do servidor, lida do fonte. Comparar por texto é o que torna a cópia verificável. */
function nomesDoServidor(): string[] {
  const caminho = fileURLToPath(
    new URL("../../../../apps/server/src/rooms/identidade.ts", import.meta.url),
  );
  const fonte = readFileSync(caminho, "utf8");
  const bloco = /export const NOMES_DE_BOT = \[([\s\S]*?)\] as const;/.exec(fonte);
  if (!bloco) throw new Error("NOMES_DE_BOT não encontrado no servidor");
  // Os comentários saem ANTES da extração: uma das linhas explica o trocadilho usando aspas
  // ("mão" é a mão de cartas E o sangue-frio), e sem isto ela entraria na lista como um nono nome.
  const semComentarios = bloco[1].replace(/\/\/[^\n]*/g, "");
  return [...semComentarios.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("os nomes de bot são os mesmos dos dois lados", () => {
  it("cliente e servidor declaram a MESMA lista, na mesma ordem", () => {
    expect([...NOMES_DE_BOT]).toEqual(nomesDoServidor());
  });

  it("são oito, sem repetição", () => {
    expect(NOMES_DE_BOT).toHaveLength(8);
    expect(new Set(NOMES_DE_BOT).size).toBe(8);
  });

  it("o bot renomeado continua sendo Sr. Trunfo", () => {
    expect(NOMES_DE_BOT as readonly string[]).toContain("Sr. Trunfo");
    expect(NOMES_DE_BOT as readonly string[]).not.toContain("Seu Trunfo");
  });
});

describe("a mesa local", () => {
  it("tem quatro assentos: você e três adversários", () => {
    expect(MESA_LOCAL).toHaveLength(4);
    expect(MESA_LOCAL[0].nome).toBe(NOME_DO_HUMANO);
    expect(NOMES_DA_MESA_LOCAL).toEqual(MESA_LOCAL.map((a) => a.nome));
  });

  it("os três adversários saem da lista canônica, e não de nomes inventados", () => {
    for (const a of MESA_LOCAL.slice(1)) {
      expect(NOMES_DE_BOT as readonly string[], `${a.nome} não é um bot do KING`).toContain(a.nome);
    }
  });

  it("nenhum nome de fase antiga sobreviveu", () => {
    // Bia, Léo e Nara vêm de antes de os bots terem nome de personagem.
    for (const antigo of ["Bia", "Léo", "Nara"]) {
      expect(NOMES_DA_MESA_LOCAL, `${antigo} ainda está na mesa`).not.toContain(antigo);
    }
  });

  it("todo avatar da mesa existe na coleção", () => {
    for (const a of MESA_LOCAL) {
      expect(AVATARES as readonly string[], `${a.nome}: avatar inválido`).toContain(a.avatar);
    }
  });

  it("os quatro avatares são DIFERENTES — é o que impede quatro cards com o mesmo bicho", () => {
    expect(new Set(MESA_LOCAL.map((a) => a.avatar)).size).toBe(4);
  });

  it("`avatarLocalDoAssento` responde pelos quatro e cala fora da faixa", () => {
    for (let s = 0; s < 4; s++) expect(avatarLocalDoAssento(s)).toBe(MESA_LOCAL[s].avatar);
    // "não sei" tem de continuar sendo `undefined`, e não um padrão silencioso.
    expect(avatarLocalDoAssento(4)).toBeUndefined();
    expect(avatarLocalDoAssento(-1)).toBeUndefined();
  });
});
