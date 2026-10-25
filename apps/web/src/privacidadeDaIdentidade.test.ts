// PRIVACIDADE DA IDENTIDADE (Fase 9) — o que o código de conta, login nativo e links NUNCA faz.
//
// Os módulos que tocam token, e-mail, nome, código de sala, código de convite ou credencial do
// Google/Apple são os de `auth/`, `nativo/` e o painel "Conta". Este teste lê o código-fonte deles
// e proíbe as duas saídas por onde esses dados vazariam sem ninguém ver: a medição de uso
// (analytics) e o console. E confere que o GeoIP do PostHog continua desligado.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("./", import.meta.url);
const fontes = (pasta: string) =>
  readdirSync(new URL(pasta, SRC))
    .filter((n) => /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n))
    .map((n) => ({ nome: `${pasta}${n}`, texto: readFileSync(new URL(`${pasta}${n}`, SRC), "utf8") }));

const SENSIVEIS = [...fontes("auth/"), ...fontes("nativo/"), { nome: "ui/PainelConta.tsx", texto: readFileSync(new URL("ui/PainelConta.tsx", SRC), "utf8") }];

describe("os módulos de identidade não falam com a medição nem com o console", () => {
  it("cobre os arquivos certos (sem lista vazia passando verde)", () => {
    const nomes = SENSIVEIS.map((f) => f.nome);
    for (const esperado of ["auth/conta.ts", "auth/recuperacaoDeConta.ts", "auth/exclusaoDeConta.ts", "auth/sessaoNativa.ts", "nativo/loginSocial.ts", "nativo/linkDoApp.ts"]) {
      expect(nomes, esperado).toContain(esperado);
    }
  });

  it("nenhum importa o analytics", () => {
    for (const f of SENSIVEIS) expect(f.texto, f.nome).not.toMatch(/from\s+["'][^"']*analytics[^"']*["']/);
  });

  it("nenhum escreve no console (token, e-mail ou código num log de aparelho é vazamento)", () => {
    for (const f of SENSIVEIS) expect(f.texto, f.nome).not.toMatch(/\bconsole\.(log|info|warn|error|debug)\s*\(/);
  });
});

describe("o GeoIP continua desligado", () => {
  it("$geoip_disable = true em todo evento", () => {
    expect(readFileSync(new URL("analytics/posthogSdk.ts", SRC), "utf8")).toMatch(/\$geoip_disable\s*=\s*true/);
  });
});
