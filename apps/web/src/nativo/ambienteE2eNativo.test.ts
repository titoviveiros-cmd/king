// O BUILD DO TESTE NATIVO NÃO CONHECE A PRODUCTION. O `.env.e2e-nativo` é versionado e roda na CI:
// se um dia apontar para um Supabase ou servidor de verdade, cada execução criaria convidado e sala
// reais. Aqui se prova o contrário pelo próprio arquivo — identidade num projeto que não existe,
// servidor na máquina, nenhuma chave que não seja publicável e fictícia.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ENV = Object.fromEntries(
  readFileSync(fileURLToPath(new URL("../../.env.e2e-nativo", import.meta.url)), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

describe(".env.e2e-nativo: só endereços fictícios ou locais", () => {
  it("identidade no projeto Supabase FICTÍCIO que o teste intercepta", () => {
    expect(ENV.VITE_SUPABASE_URL).toBe("https://abcdefghijklmnopqrst.supabase.co");
    const teste = readFileSync(fileURLToPath(new URL("../../tests-nativo/multiplayerNativo.spec.ts", import.meta.url)), "utf8");
    expect(teste, "o teste intercepta exatamente esse endereço").toContain(`const SUPABASE = "${ENV.VITE_SUPABASE_URL}";`);
  });

  it("chave publicável e declaradamente fictícia — nunca secreta nem service_role", () => {
    expect(ENV.VITE_SUPABASE_PUBLISHABLE_KEY).toMatch(/^sb_publishable_ficticia_/);
    expect(Object.keys(ENV).join(" ")).not.toMatch(/SECRET|SERVICE_ROLE|ANON_KEY/);
  });

  it("servidor multiplayer na própria máquina, e tráfego marcado como teste", () => {
    expect(new URL(ENV.VITE_KING_SERVER_URL).hostname).toBe("localhost");
    expect(ENV.VITE_KING_TRAFEGO).toBe("test");
  });

  it("nenhuma outra variável (nada de analytics, Google ou ambiente de produção)", () => {
    expect(Object.keys(ENV).sort()).toEqual(["VITE_KING_SERVER_URL", "VITE_KING_TRAFEGO", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_URL"]);
  });
});
