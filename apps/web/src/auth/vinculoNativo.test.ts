// O VÍNCULO NO APP NATIVO — Google e Apple por ID token, sobre o MESMO convidado.
//
// A porta é uma dublê determinística (sem rede, sem Google, sem Apple): o que se prova aqui é a
// POLÍTICA de identidade — quem é exigido, o que nunca é chamado, o que acontece em cada desfecho.
// Os erros de verdade que importam: o jogador desistir, o Google/Apple já ser de outro jogador, o
// provedor falhar, e qualquer coisa que pudesse criar um usuário paralelo.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IdentidadeVinculada, PortaDeAutenticacao } from "./clienteSupabase.js";
import { criarConta, type ArmazenamentoSimples, type ProvedorVinculavel } from "./conta.js";
import { ehAppNativo, gerarNonce, type FonteDeCredencialNativa, type ResultadoDaCredencial } from "./credencialNativa.js";

const GUEST = "11111111-2222-3333-4444-555555555555";
const OUTRO = "99999999-8888-7777-6666-555555555555";

interface Opcoes {
  semSessao?: boolean;
  identidades?: IdentidadeVinculada[];
  erroNoVinculo?: { code?: string; message?: string };
  usuarioQueVolta?: string;
  naoAparece?: boolean;
}

function portaFalsa(o: Opcoes = {}) {
  const chamadas: string[] = [];
  const vinculos: Record<string, unknown>[] = [];
  let identidades = o.identidades ?? [{ provider: "anonymous", user_id: GUEST }];
  const porta = {
    chamadas,
    vinculos,
    async getSession() {
      chamadas.push("getSession");
      return { data: { session: o.semSessao ? null : { access_token: "jwt-do-convidado", user: { id: GUEST } } } };
    },
    async signInAnonymously() {
      chamadas.push("signInAnonymously");
      return { data: { session: { access_token: "novo", user: { id: OUTRO } } } };
    },
    async getUserIdentities() {
      chamadas.push("getUserIdentities");
      return { data: { identities: identidades }, error: null };
    },
    async linkIdentity(c: Record<string, unknown>) {
      chamadas.push(`linkIdentity:${String(c.provider)}`);
      vinculos.push(c);
      if (o.erroNoVinculo) return { data: null, error: o.erroNoVinculo };
      if (!o.naoAparece) identidades = [...identidades, { provider: String(c.provider), user_id: GUEST }];
      const id = o.usuarioQueVolta ?? GUEST;
      return { data: { session: { access_token: "jwt-depois", user: { id } }, user: { id } }, error: null };
    },
    async exchangeCodeForSession() {
      chamadas.push("exchangeCodeForSession");
      return { data: null, error: { message: "não usado aqui" } };
    },
  };
  return porta;
}

function armazenamentoEspiao() {
  const gravados: string[] = [];
  const mapa = new Map<string, string>();
  const a: ArmazenamentoSimples = {
    getItem: (k) => mapa.get(k) ?? null,
    setItem: (k, v) => { gravados.push(`${k}=${v}`); mapa.set(k, v); },
    removeItem: (k) => { mapa.delete(k); },
  };
  return { a, gravados };
}

function montar(porta: ReturnType<typeof portaFalsa>, o: { nativo?: boolean; url?: string } = {}) {
  const { a, gravados } = armazenamentoEspiao();
  let url = o.url ?? "https://localhost/";
  const conta = criarConta({
    porta: async () => porta as unknown as PortaDeAutenticacao,
    armazenamento: () => a,
    urlAtual: () => url,
    trocarUrl: (nova) => { url = new URL(nova, url).toString(); },
    nativo: () => o.nativo ?? true,
  });
  return { conta, gravados, url: () => url, armazenamento: a };
}

/** A tela do Google/Apple, de mentira: registra o hash do nonce recebido e devolve o pedido. */
function fonteFalsa(resposta: ResultadoDaCredencial) {
  const pedidos: { provedor: string; hash: string }[] = [];
  const fonte: FonteDeCredencialNativa = {
    async obter(provedor, hash) { pedidos.push({ provedor, hash }); return resposta; },
  };
  return { fonte, pedidos };
}
const credencial = (idToken = "id-token-de-mentira"): ResultadoDaCredencial => ({ tipo: "credencial", credencial: { idToken } });
const nonceFixo = async () => ({ bruto: "nonce-bruto", hash: createHash("sha256").update("nonce-bruto").digest("hex") });
const PROIBIDOS = ["signInAnonymously", "signInWithOAuth", "signInWithIdToken", "exchangeCodeForSession"];

describe("vínculo no app: o MESMO convidado ganha o Google ou a Apple", () => {
  for (const provedor of ["google", "apple"] as ProvedorVinculavel[]) {
    it(`${provedor}: linkIdentity com o ID token e o nonce BRUTO; o provedor recebe o HASH; o usuário não muda`, async () => {
      const porta = portaFalsa();
      const { conta, gravados } = montar(porta);
      const { fonte, pedidos } = fonteFalsa(credencial());
      const r = await conta.vincularNoApp(provedor, fonte, nonceFixo);
      expect(r).toEqual({ ok: true, jaVinculado: false, userId: GUEST });
      expect(pedidos).toEqual([{ provedor, hash: createHash("sha256").update("nonce-bruto").digest("hex") }]);
      expect(porta.vinculos).toEqual([{ provider: provedor, token: "id-token-de-mentira", nonce: "nonce-bruto" }]);
      expect(porta.chamadas.filter((c) => PROIBIDOS.some((p) => c.startsWith(p))), "criou ou trocou usuário").toEqual([]);
      expect(gravados, "guardou alguma coisa (token?) no aparelho").toEqual([]);
    });
  }

  it("o access token vai junto quando o provedor o entrega (ID token com at_hash)", async () => {
    const porta = portaFalsa();
    const { conta } = montar(porta);
    const { fonte } = fonteFalsa({ tipo: "credencial", credencial: { idToken: "id", accessToken: "at" } });
    await conta.vincularNoApp("google", fonte, nonceFixo);
    expect(porta.vinculos[0]).toMatchObject({ token: "id", access_token: "at" });
  });
});

describe("os desfechos que não são vínculo — o convidado segue o mesmo", () => {
  it("cancelado: o jogador fechou a tela; nada é chamado no Supabase", async () => {
    const porta = portaFalsa();
    const { conta } = montar(porta);
    const r = await conta.vincularNoApp("google", fonteFalsa({ tipo: "cancelado" }).fonte, nonceFixo);
    expect(r).toEqual({ ok: false, motivo: "cancelado" });
    expect(porta.chamadas.some((c) => c.startsWith("linkIdentity"))).toBe(false);
  });

  it("conta já ligada a OUTRO jogador: identidade-de-outra-conta, sem fundir e sem trocar de usuário", async () => {
    const porta = portaFalsa({ erroNoVinculo: { code: "identity_already_exists", message: "Identity is already linked to another user" } });
    const { conta } = montar(porta);
    const r = await conta.vincularNoApp("apple", fonteFalsa(credencial()).fonte, nonceFixo);
    expect(r).toEqual({ ok: false, motivo: "identidade-de-outra-conta" });
    expect(porta.chamadas.filter((c) => PROIBIDOS.some((p) => c.startsWith(p)))).toEqual([]);
  });

  it("o plugin falhou: provedor-recusou, sem chamar o Supabase", async () => {
    const porta = portaFalsa();
    const { conta } = montar(porta);
    const r = await conta.vincularNoApp("google", fonteFalsa({ tipo: "erro" }).fonte, nonceFixo);
    expect(r).toEqual({ ok: false, motivo: "provedor-recusou" });
    expect(porta.chamadas.some((c) => c.startsWith("linkIdentity"))).toBe(false);
  });

  it("o Supabase recusou o token (nonce errado, audiência errada): provedor-recusou", async () => {
    const porta = portaFalsa({ erroNoVinculo: { code: "bad_jwt", message: "nonce mismatch" } });
    const { conta } = montar(porta);
    const r = await conta.vincularNoApp("google", fonteFalsa(credencial()).fonte, nonceFixo);
    expect(r).toEqual({ ok: false, motivo: "provedor-recusou" });
  });

  // FASE 9 (red team): no APARELHO NOVO, "Continuar com a Apple/Google" tem de funcionar — é o
  // primeiro toque do revisor da App Store. O convidado nasce DEPOIS da credencial (cancelar não cria
  // ninguém) e é a ELE que o login se liga. A regra antiga ("sem convidado, nem abre") mudou aqui.
  for (const provedor of ["google", "apple"] as ProvedorVinculavel[]) {
    it(`${provedor}, aparelho NOVO (sem sessão nenhuma): o convidado nasce depois da credencial e recebe o vínculo`, async () => {
      let sessaoAtual: { access_token: string; user: { id: string } } | null = null;
      const porta = portaFalsa();
      porta.getSession = async () => { porta.chamadas.push("getSession"); return { data: { session: sessaoAtual } }; };
      porta.signInAnonymously = async () => {
        porta.chamadas.push("signInAnonymously");
        sessaoAtual = { access_token: "jwt-novo", user: { id: GUEST } };
        return { data: { session: sessaoAtual } };
      };
      const { conta } = montar(porta);
      const { fonte, pedidos } = fonteFalsa(credencial());
      const r = await conta.vincularNoApp(provedor, fonte, nonceFixo);
      expect(r).toEqual({ ok: true, jaVinculado: false, userId: GUEST });
      expect(pedidos).toHaveLength(1);
      const ordem = porta.chamadas.filter((c) => c === "signInAnonymously" || c.startsWith("linkIdentity"));
      expect(ordem).toEqual(["signInAnonymously", `linkIdentity:${provedor}`]);
    });
  }

  it("aparelho NOVO e o jogador CANCELA na tela do provedor: ninguém é criado", async () => {
    const porta = portaFalsa({ semSessao: true });
    const { conta } = montar(porta);
    const r = await conta.vincularNoApp("apple", fonteFalsa({ tipo: "cancelado" }).fonte, nonceFixo);
    expect(r).toEqual({ ok: false, motivo: "cancelado" });
    expect(porta.chamadas).not.toContain("signInAnonymously");
  });

  it("sessão GUARDADA mas ilegível agora (renovação falhando): nem abre o provedor, e NUNCA cria convidado por cima", async () => {
    const porta = portaFalsa();
    porta.getSession = async () => { porta.chamadas.push("getSession"); return { data: { session: null }, error: { message: "Failed to fetch" } }; };
    const { conta } = montar(porta);
    const { fonte, pedidos } = fonteFalsa(credencial());
    const r = await conta.vincularNoApp("google", fonte, nonceFixo);
    expect(r).toEqual({ ok: false, motivo: "sessao-indisponivel" });
    expect(pedidos, "abriu o provedor com a sessão ilegível").toEqual([]);
    expect(porta.chamadas).not.toContain("signInAnonymously");
  });

  it("já vinculado: responde sem abrir a tela do provedor de novo", async () => {
    const porta = portaFalsa({ identidades: [{ provider: "anonymous", user_id: GUEST }, { provider: "google", user_id: GUEST }] });
    const { conta } = montar(porta);
    const { fonte, pedidos } = fonteFalsa(credencial());
    const r = await conta.vincularNoApp("google", fonte, nonceFixo);
    expect(r).toEqual({ ok: true, jaVinculado: true, userId: GUEST });
    expect(pedidos).toEqual([]);
  });

  it("voltou OUTRO usuário: troca-de-usuario (não se aceita)", async () => {
    const porta = portaFalsa({ usuarioQueVolta: OUTRO });
    const { conta } = montar(porta);
    const r = await conta.vincularNoApp("google", fonteFalsa(credencial()).fonte, nonceFixo);
    expect(r).toEqual({ ok: false, motivo: "troca-de-usuario" });
  });

  it("o Supabase disse ok mas a identidade não aparece: nao-vinculado", async () => {
    const porta = portaFalsa({ naoAparece: true });
    const { conta } = montar(porta);
    const r = await conta.vincularNoApp("apple", fonteFalsa(credencial()).fonte, nonceFixo);
    expect(r).toEqual({ ok: false, motivo: "nao-vinculado" });
  });

  it("plugin nativo ainda não instalado: indisponivel", async () => {
    const porta = portaFalsa();
    const { conta } = montar(porta);
    expect(await conta.vincularNoApp("google", null, nonceFixo)).toEqual({ ok: false, motivo: "indisponivel" });
    expect(porta.chamadas).toEqual([]);
  });
});

/** Um ID token de mentira com o `nonce` dado no payload (a assinatura não importa aqui). */
const jwtCom = (nonce: string) => `cab.${Buffer.from(JSON.stringify({ nonce, aud: "cliente" })).toString("base64url")}.ass`;
const hashDe = (s: string) => createHash("sha256").update(s).digest("hex");

describe("o que o red team achou na Fase 8", () => {
  it("token EM CACHE com o nonce de outro pedido: nem vai ao Supabase; esquece e pede de novo, UMA vez", async () => {
    const porta = portaFalsa();
    const { conta } = montar(porta);
    let n = 0;
    const nonces = ["a", "b", "c"];
    const esquecidos: string[] = [];
    const fonte: FonteDeCredencialNativa = {
      async obter(_p, hash) {
        n++;
        // 1ª vez: o SDK devolve o token velho (nonce de outro pedido); 2ª: um novo, com o hash certo
        return { tipo: "credencial", credencial: { idToken: jwtCom(n === 1 ? hashDe("velho") : hash) } };
      },
      async esquecer(p) { esquecidos.push(p); },
    };
    const r = await conta.vincularNoApp("google", fonte, async () => { const b = nonces.shift()!; return { bruto: b, hash: hashDe(b) }; });
    expect(r).toEqual({ ok: true, jaVinculado: false, userId: GUEST });
    expect(esquecidos).toEqual(["google"]);
    expect(porta.vinculos).toHaveLength(1);
    expect(porta.vinculos[0]).toMatchObject({ nonce: "b" });
  });

  it("nonce errado duas vezes: provedor-recusou, e o Supabase nunca recebe o token", async () => {
    const porta = portaFalsa();
    const { conta } = montar(porta);
    const fonte: FonteDeCredencialNativa = {
      async obter() { return { tipo: "credencial", credencial: { idToken: jwtCom(hashDe("velho")) } }; },
      async esquecer() {},
    };
    expect(await conta.vincularNoApp("google", fonte, nonceFixo)).toEqual({ ok: false, motivo: "provedor-recusou" });
    expect(porta.chamadas.some((c) => c.startsWith("linkIdentity"))).toBe(false);
  });

  it("toque duplo: o Supabase diz 'já vinculada', mas é DESTE jogador — vira sucesso, não 'outro jogador'", async () => {
    const porta = portaFalsa({ erroNoVinculo: { code: "identity_already_exists", message: "Identity is already linked" } });
    const original = porta.getUserIdentities;
    let leituras = 0;
    porta.getUserIdentities = async () => {
      leituras++;
      // leituras 1 e 2 = conferências ANTES do vínculo; a 3ª vem DEPOIS do erro, quando a corrida
      // (o outro toque) já tinha vinculado ESTE convidado
      return leituras >= 3
        ? { data: { identities: [{ provider: "anonymous", user_id: GUEST }, { provider: "google", user_id: GUEST }] }, error: null }
        : original();
    };
    const { conta } = montar(porta);
    expect(await conta.vincularNoApp("google", fonteFalsa(credencial()).fonte, nonceFixo)).toEqual({ ok: true, jaVinculado: true, userId: GUEST });
  });

  it("web: o erro do Google apaga a transação gravada (sem lixo para um retorno futuro)", async () => {
    const porta = portaFalsa();
    const url = "https://playkingcards.com.br/?conta=google&error=access_denied";
    const m = montar(porta, { nativo: false, url });
    m.armazenamento.setItem("king:vinculo", JSON.stringify({ expectedUserId: GUEST, provider: "google", criadoEm: Date.now() }));
    expect(await m.conta.concluirRetornoOAuth()).toEqual({ tipo: "erro", motivo: "provedor-recusou" });
    expect(m.armazenamento.getItem("king:vinculo"), "a transação sobreviveu ao erro").toBeNull();
  });

  it("web: 'já vinculada' do PRÓPRIO jogador (toque duplo) volta como vinculado", async () => {
    const porta = portaFalsa({ identidades: [{ provider: "anonymous", user_id: GUEST }, { provider: "google", user_id: GUEST }] });
    const url = "https://playkingcards.com.br/?conta=google&error=server_error&error_code=identity_already_exists";
    const m = montar(porta, { nativo: false, url });
    expect(await m.conta.concluirRetornoOAuth()).toEqual({ tipo: "vinculado", userId: GUEST });
  });
});

describe("web × app", () => {
  it("no app, o OAuth por redirecionamento da web NÃO roda (o Google o recusa em WebView)", async () => {
    const porta = portaFalsa();
    const { conta } = montar(porta, { nativo: true });
    expect(await conta.vincularGoogle()).toEqual({ ok: false, motivo: "indisponivel" });
    expect(porta.chamadas).toEqual([]);
  });

  it("na web, o retorno com identity_already_exists vira identidade-de-outra-conta, e a URL sai limpa", async () => {
    const porta = portaFalsa();
    const url = "https://playkingcards.com.br/?conta=google&error=server_error&error_code=identity_already_exists&error_description=x";
    const m = montar(porta, { nativo: false, url });
    expect(await m.conta.concluirRetornoOAuth()).toEqual({ tipo: "erro", motivo: "identidade-de-outra-conta" });
    expect(m.url()).toBe("https://playkingcards.com.br/");
  });

  it("ehAppNativo lê a ponte do Capacitor, e nunca quebra", () => {
    expect(ehAppNativo({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    expect(ehAppNativo({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
    expect(ehAppNativo({})).toBe(false);
    expect(ehAppNativo({ Capacitor: { isNativePlatform: () => { throw new Error("ponte quebrada"); } } })).toBe(false);
  });
});

describe("o nonce", () => {
  it("bruto aleatório de 32 bytes; o hash é o SHA-256 dele; dois pedidos nunca repetem", async () => {
    const a = await gerarNonce();
    const b = await gerarNonce();
    expect(a.bruto).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(createHash("sha256").update(a.bruto).digest("hex"));
    expect(b.bruto).not.toBe(a.bruto);
  });
});
