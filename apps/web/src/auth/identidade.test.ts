// A PONTA DO CLIENTE NA IDENTIDADE — o que dá para provar sem provedor, e é mais do que parece.
//
// ══ O QUE ESTE ARQUIVO COBRE, E O QUE NÃO ══
//
// Não cobre o Supabase. Um teste que finge o SDK do provedor prova que o fingimento funciona, e
// esse caminho só vira verdade quando houver projeto de verdade para apontar. O que ele cobre é
// tudo o que fica ENTRE o provedor e a porta da sala — e é aí que moram os enganos que somem sem
// deixar rastro:
//
//   • `accessToken: undefined` explícito viaja como campo presente e vazio, e o servidor precisa
//     do campo AUSENTE para tratar a entrada como sem credencial;
//   • uma publicação mal configurada (sem chave, ou com `http://`) precisa degradar para o KING
//     de sempre, e não travar o multiplayer;
//   • um provedor que LANÇA não pode impedir alguém de entrar na sala.
//
// Cada um destes já foi, em algum projeto, o defeito que só apareceu em produção.
import { describe, expect, it } from "vitest";
import { provedorConfigurado, resolverIdentidade } from "./identidade.js";
import { credencialPara, opcoesDeEntrada } from "../net/clienteKing.js";
import { mensagemDeFalha } from "../game/useKingOnline.js";

describe("a publicação decide se há identidade permanente", () => {
  it("sem URL e sem chave, não há provedor — e isso não é erro, é o KING de sempre", () => {
    const r = resolverIdentidade({});
    expect(r.configurado).toBe(false);
    if (!r.configurado) expect(r.motivo).toContain("funciona normalmente");
  });

  it("URL sem chave não vira meio-configurado", () => {
    expect(resolverIdentidade({ url: "https://abc.supabase.co" }).configurado).toBe(false);
    expect(resolverIdentidade({ anonKey: "chave" }).configurado).toBe(false);
  });

  it("recusa http:// — o token viaja nessa URL", () => {
    const r = resolverIdentidade({ url: "http://abc.supabase.co", anonKey: "chave" });
    expect(r.configurado).toBe(false);
  });

  it("com os dois, configura — e a barra final não vira parte da URL", () => {
    const r = resolverIdentidade({ url: "https://abc.supabase.co/", anonKey: "  chave  " });
    expect(r).toEqual({ configurado: true, url: "https://abc.supabase.co", anonKey: "chave" });
  });
});

describe("a credencial vai nas opções — ou o campo não existe", () => {
  const pedido = { nick: "Tito", avatar: "coruja" };

  it("com token, o campo vai", () => {
    expect(opcoesDeEntrada(pedido, "tok").accessToken).toBe("tok");
  });

  it("sem token, o campo NÃO existe — não basta ser undefined", () => {
    expect("accessToken" in opcoesDeEntrada(pedido)).toBe(false);
    expect("accessToken" in opcoesDeEntrada(pedido, "")).toBe(false);
  });

  it("o resto das opções não muda por causa da identidade", () => {
    const semToken = opcoesDeEntrada(pedido);
    const comToken = opcoesDeEntrada(pedido, "tok");
    expect(comToken.nick).toBe(semToken.nick);
    expect(comToken.avatar).toBe(semToken.avatar);
    expect(comToken.protocolVersion).toBe(semToken.protocolVersion);
  });
});

/**
 * IDENTIDADE QUEBRADA ≠ JOGADOR IMPEDIDO DE JOGAR.
 *
 * O multiplayer do KING existia antes da identidade e precisa continuar existindo sem ela. Um
 * provedor fora do ar que derrubasse a entrada na sala transformaria uma camada aditiva no ponto
 * único de falha de tudo.
 */
describe("nenhuma falha de identidade impede entrar na sala", () => {
  it("sem provedor nenhum, não há credencial e não há erro", async () => {
    expect(await credencialPara(null)).toBeUndefined();
    expect(await credencialPara(undefined)).toBeUndefined();
  });

  it("provedor que LANÇA vira ausência de credencial, não exceção", async () => {
    const explosivo = { token: () => Promise.reject(new Error("provedor fora do ar")) };
    await expect(credencialPara(explosivo)).resolves.toBeUndefined();
  });

  it("provedor que devolve vazio também vira ausência", async () => {
    expect(await credencialPara({ token: async () => "" })).toBeUndefined();
  });

  it("provedor que funciona devolve o token", async () => {
    expect(await credencialPara({ token: async () => "tok" })).toBe("tok");
  });
});

/**
 * A FRASE QUE O JOGADOR LÊ QUANDO A PORTA SE FECHA.
 *
 * Os dois códigos novos caíam no genérico "Não foi possível conectar ao servidor" — e num deles
 * o jogador tem um gesto claro a fazer. Uma frase que não deixa agir é um defeito com a mesma
 * gravidade de um estado errado: só custa mais caro, porque ele tenta de novo o que nunca vai dar.
 */
describe("a recusa vira frase, não código", () => {
  const falha = (m: string) => mensagemDeFalha(new Error(m));

  it("4004 diz o que fazer — é a única desta lista com gesto possível", () => {
    expect(falha("code 4004")).toContain("outro aparelho");
  });

  it("4003 não expõe o motivo técnico da recusa", () => {
    const f = falha("code 4003");
    expect(f).toContain("identidade");
    expect(f).not.toMatch(/assinatura|token|jwt|expirado|emissor/i);
  });

  it("os códigos antigos continuam com as frases antigas", () => {
    expect(falha("code 4002")).toContain("quatro jogadores");
    expect(falha("code 4001")).toContain("não são compatíveis");
    expect(falha("room not found")).toContain("Confira o código");
  });

  it("o que não se reconhece continua caindo no genérico", () => {
    expect(falha("ECONNRESET")).toBe("Não foi possível conectar ao servidor.");
  });
});

/**
 * A GARANTIA DE QUE O BUILD DE HOJE NÃO MUDOU DE COMPORTAMENTO.
 *
 * Sem variável configurada não existe provedor, e sem provedor o `import()` dinâmico do SDK do
 * Supabase nunca acontece: o pedaço fica no pacote sem jamais ser baixado, e a entrada na sala
 * segue sem `accessToken`, exatamente como antes desta fase. É a asserção que separa "aditivo"
 * de "aditivo até a primeira publicação".
 */
describe("sem configuração, o provedor não existe", () => {
  it("provedorConfigurado() é null quando o ambiente não tem as variáveis", () => {
    expect(provedorConfigurado()).toBeNull();
  });
});

describe("4005 fala de atualizar, não de identidade", () => {
  it("aplicativo antigo contra servidor que exige credencial", () => {
    const f = mensagemDeFalha(new Error("code 4005"));
    expect(f).toContain("Atualize");
    // NÃO pode virar a frase de 4003: mandar entrar de novo é mandar repetir o que não funciona.
    expect(f).not.toContain("Entre novamente");
  });
});

/**
 * OS DOIS NOMES DA MESMA CHAVE.
 *
 * O painel de um projeto Supabase novo diz `publishable`; ambientes já configurados dizem
 * `anon`. Aceitar só um dos dois produz o pior diagnóstico possível — variável preenchida na
 * tela, vazia no código, e nenhuma mensagem de erro em lugar nenhum.
 */
describe("a chave publicável tem dois nomes aceitos", () => {
  const url = "https://abc.supabase.co";
  it("o nome moderno configura", () => {
    expect(resolverIdentidade({ url, anonKey: "sb_publishable_abc123" }).configurado).toBe(true);
  });
  it("o formato da chave NÃO é validado — quem decide se ela vale é o Supabase", () => {
    expect(resolverIdentidade({ url, anonKey: "eyJhbGciOiJIUzI1NiJ9.legado" }).configurado)
      .toBe(true);
  });
});
