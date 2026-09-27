// A CLASSIFICAÇÃO DAS FALHAS — com as assinaturas REAIS medidas no Supabase na Fase 4C.
import { describe, expect, it } from "vitest";
import { classificarFalha, resumoSeguro } from "./falhas.js";

const erro = (code: string, message: string) => Object.assign(new Error(message), { code });

describe("classificação estreita: só duas falhas abrem disjuntor", () => {
  it("28P01 (medido: senha recusada pelo pooler) → autenticação", () => {
    expect(classificarFalha(erro("28P01", 'password authentication failed for user "king_server"'))).toBe("autenticacao");
  });

  it("ECIRCUITBREAKER do Supavisor (medido: XX000) → disjuntor", () => {
    expect(classificarFalha(erro("XX000", "(ECIRCUITBREAKER) too many authentication failures, new connections are temporarily blocked"))).toBe("disjuntor");
  });

  it.each([
    ["ECONNRESET", "read ECONNRESET"],
    ["ECONNREFUSED", "connect ECONNREFUSED"],
    ["ETIMEDOUT", "timeout"],
    ["57P01", "terminating connection due to administrator command"],
    ["XX000", "Tenant or user not found"],
    ["40001", "could not serialize access"],
  ])("%s é transitório — segue o retry controlado", (code, message) => {
    expect(classificarFalha(erro(code, message))).toBe("transitoria");
  });

  it("erro sem código nem mensagem não quebra a classificação", () => {
    expect(classificarFalha(undefined)).toBe("transitoria");
    expect(classificarFalha(null)).toBe("transitoria");
    expect(classificarFalha("texto")).toBe("transitoria");
  });
});

describe("o resumo seguro não carrega a mensagem", () => {
  it("só código e classe — nunca URL, senha ou texto do banco", () => {
    const e = erro("28P01", "falhou em postgresql://king_server:SENHA@host/postgres");
    expect(resumoSeguro(e)).toBe("28P01/autenticacao");
    expect(resumoSeguro(e)).not.toContain("SENHA");
  });
});
