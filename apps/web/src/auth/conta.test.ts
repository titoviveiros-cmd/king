// VINCULAR NÃO PODE VIRAR TROCAR DE USUÁRIO.
//
// Este arquivo existe por causa de um desfecho específico, o pior possível desta fase: o jogador
// toca em "salvar progresso com Google", volta, e é OUTRA pessoa — conta nova, vazia, e a antiga
// órfã. Há três caminhos conhecidos para chegar lá, e cada um tem teste aqui:
//
//   1. usar `signInWithOAuth` (entrar) em vez de `linkIdentity` (vincular);
//   2. criar um convidado no meio do retorno, quando a sessão sumiu;
//   3. aceitar o usuário que voltou sem compará-lo com o que saiu.
//
// A porta do provedor é uma DUBLÊ: nada aqui toca rede, navegador ou Google. O que se prova é a
// decisão — a única coisa que este código tem para decidir.
import { beforeEach, describe, expect, it } from "vitest";
import {
  CHAVE_DA_TRANSACAO, criarConta, destinoInterno, mascarar, urlDeRetorno, urlLimpa,
  type ArmazenamentoSimples,
} from "./conta.js";
import type { IdentidadeVinculada, PortaDeAutenticacao, SessaoSupabase } from "./clienteSupabase.js";

const GUEST = "11111111-1111-1111-1111-111111111111";
const OUTRO = "99999999-9999-9999-9999-999999999999";
const ORIGEM = "https://playkingcards.com.br";

/** Um localStorage de mentira, que o teste inspeciona. */
function armazenamentoFalso(inicial: Record<string, string> = {}): ArmazenamentoSimples & { dados: Map<string, string> } {
  const dados = new Map(Object.entries(inicial));
  return {
    dados,
    getItem: (k) => dados.get(k) ?? null,
    setItem: (k, v) => { dados.set(k, v); },
    removeItem: (k) => { dados.delete(k); },
  };
}

interface Dublê extends PortaDeAutenticacao {
  chamadas: string[];
  anonimosCriados: number;
}

function portaFalsa(opcoes: {
  sessao?: SessaoSupabase | null;
  identidades?: IdentidadeVinculada[];
  trocaPara?: string;
  erroNaTroca?: boolean;
  erroNoLink?: boolean;
  identidadesDepois?: IdentidadeVinculada[];
} = {}): Dublê {
  const chamadas: string[] = [];
  let anonimosCriados = 0;
  let trocou = false;
  const sessao = opcoes.sessao === undefined
    ? { access_token: "token-de-mentira", user: { id: GUEST } }
    : opcoes.sessao;
  const d: Dublê = {
    chamadas,
    get anonimosCriados() { return anonimosCriados; },
    async getSession() { chamadas.push("getSession"); return { data: { session: sessao } }; },
    async signInAnonymously() {
      chamadas.push("signInAnonymously");
      anonimosCriados += 1;
      return { data: { session: { access_token: "token-novo", user: { id: OUTRO } } } };
    },
    async getUserIdentities() {
      chamadas.push("getUserIdentities");
      const lista = trocou && opcoes.identidadesDepois ? opcoes.identidadesDepois : opcoes.identidades ?? [];
      return { data: { identities: lista }, error: null };
    },
    async linkIdentity(c) {
      chamadas.push(`linkIdentity:${c.provider}:${c.options?.redirectTo ?? ""}`);
      if (opcoes.erroNoLink) return { data: null, error: { message: "recusado" } };
      return { data: { url: "https://accounts.example/oauth" }, error: null };
    },
    async exchangeCodeForSession(codigo) {
      chamadas.push(`exchangeCodeForSession:${codigo}`);
      if (opcoes.erroNaTroca) return { data: null, error: { message: "code inválido" } };
      trocou = true;
      const id = opcoes.trocaPara ?? GUEST;
      return { data: { session: { access_token: "token-depois", user: { id } }, user: { id } }, error: null };
    },
  };
  return d;
}

function montar(porta: PortaDeAutenticacao | null, url: string, armazenamento = armazenamentoFalso()) {
  let urlAtual = url;
  const conta = criarConta({
    porta: async () => porta,
    armazenamento: () => armazenamento,
    urlAtual: () => urlAtual,
    trocarUrl: (nova) => { urlAtual = new URL(nova, ORIGEM).toString(); },
  });
  return { conta, armazenamento, url: () => urlAtual };
}

const GOOGLE_DO_GUEST: IdentidadeVinculada[] = [
  { provider: "email", user_id: GUEST },
  { provider: "google", user_id: GUEST },
];

describe("o que a tela pergunta", () => {
  it("sem provedor configurado, a conta é indisponível — e nada é criado", async () => {
    const { conta } = montar(null, ORIGEM);
    expect(await conta.obterEstadoDaConta()).toBe("indisponivel");
  });

  it("com sessão e sem Google, é convidado", async () => {
    const porta = portaFalsa();
    const { conta } = montar(porta, ORIGEM);
    expect(await conta.obterEstadoDaConta()).toBe("guest");
    expect(porta.anonimosCriados, "perguntar quem sou eu não pode criar ninguém").toBe(0);
  });

  it("com identidade google no MESMO usuário, está vinculado", async () => {
    const { conta } = montar(portaFalsa({ identidades: GOOGLE_DO_GUEST }), ORIGEM);
    expect(await conta.obterEstadoDaConta()).toBe("google");
  });

  it("sem sessão, responde convidado sem criar sessão nenhuma", async () => {
    const porta = portaFalsa({ sessao: null });
    const { conta } = montar(porta, ORIGEM);
    expect(await conta.obterEstadoDaConta()).toBe("guest");
    expect(porta.anonimosCriados).toBe(0);
  });
});

describe("A/B — começar o vínculo é VINCULAR, não entrar", () => {
  it("usa linkIdentity com o provedor google", async () => {
    const porta = portaFalsa();
    const { conta } = montar(porta, ORIGEM);
    const r = await conta.vincularGoogle();
    expect(r.ok).toBe(true);
    expect(porta.chamadas.some((c) => c.startsWith("linkIdentity:google")), "não chamou linkIdentity").toBe(true);
  });

  it("a porta do KING não tem signInWithOAuth para ser chamado", () => {
    // A garantia é de TIPO, e está aqui escrita: `PortaDeAutenticacao` não declara o método de
    // entrar com OAuth. Trocar `linkIdentity` por `signInWithOAuth` não compila.
    const porta = portaFalsa() as unknown as Record<string, unknown>;
    expect(porta.signInWithOAuth).toBeUndefined();
  });

  it("grava a transação com o usuário atual, e sem nenhum segredo", async () => {
    const { conta, armazenamento } = montar(portaFalsa(), ORIGEM);
    await conta.vincularGoogle();
    const bruto = armazenamento.getItem(CHAVE_DA_TRANSACAO)!;
    expect(JSON.parse(bruto)).toMatchObject({ expectedUserId: GUEST, provider: "google" });
    expect(bruto).not.toContain("token");
  });

  it("J — o retorno é deste site, e é o mesmo que o SDK recebe", async () => {
    const porta = portaFalsa();
    const { conta } = montar(porta, `${ORIGEM}/?seed=7`);
    await conta.vincularGoogle();
    const chamada = porta.chamadas.find((c) => c.startsWith("linkIdentity:"))!;
    const redirect = chamada.split("linkIdentity:google:")[1];
    expect(new URL(redirect).origin).toBe(ORIGEM);
    expect(redirect).toBe(urlDeRetorno(ORIGEM));
  });

  it("K — um retorno de fora do site é recusado e vira a Home", () => {
    expect(destinoInterno("https://exemplo-malicioso.test/roubo", ORIGEM)).toBe("/");
    expect(destinoInterno("//exemplo-malicioso.test", ORIGEM)).toBe("/");
    expect(destinoInterno("/sala?x=1", ORIGEM)).toBe("/sala?x=1");
  });

  it("já vinculado não começa nada de novo", async () => {
    const porta = portaFalsa({ identidades: GOOGLE_DO_GUEST });
    const { conta } = montar(porta, ORIGEM);
    expect(await conta.vincularGoogle()).toEqual({ ok: true, jaVinculado: true });
    expect(porta.chamadas.some((c) => c.startsWith("linkIdentity"))).toBe(false);
  });

  it("C — sem sessão, o vínculo FALHA e nenhum convidado é criado", async () => {
    const porta = portaFalsa({ sessao: null });
    const { conta, armazenamento } = montar(porta, ORIGEM);
    expect(await conta.vincularGoogle()).toEqual({ ok: false, motivo: "sem-sessao" });
    expect(porta.anonimosCriados, "criar convidado aqui trocaria o dono da conta").toBe(0);
    expect(armazenamento.getItem(CHAVE_DA_TRANSACAO)).toBeNull();
  });

  it("provedor que recusa não deixa transação pendurada", async () => {
    const { conta, armazenamento } = montar(portaFalsa({ erroNoLink: true }), ORIGEM);
    expect(await conta.vincularGoogle()).toEqual({ ok: false, motivo: "provedor-recusou" });
    expect(armazenamento.getItem(CHAVE_DA_TRANSACAO)).toBeNull();
  });
});

describe("D/E/F/G — o retorno do Google", () => {
  const URL_RETORNO = `${ORIGEM}/?conta=google&code=abc123&sb_flow_id=flow-1`;
  const comTransacao = () => armazenamentoFalso({
    [CHAVE_DA_TRANSACAO]: JSON.stringify({ expectedUserId: GUEST, provider: "google", criadoEm: 1 }),
  });

  it("D+F — mesmo usuário e google entre as identidades: vinculado", async () => {
    const porta = portaFalsa({ identidades: [], identidadesDepois: GOOGLE_DO_GUEST });
    const { conta, armazenamento, url } = montar(porta, URL_RETORNO, comTransacao());
    expect(await conta.concluirRetornoOAuth()).toEqual({ tipo: "vinculado", userId: GUEST });
    expect(armazenamento.getItem(CHAVE_DA_TRANSACAO), "a transação tem de ser consumida").toBeNull();
    expect(url()).not.toContain("code=");
  });

  it("E — usuário diferente do que saiu: falha fechada, sem vínculo e sem conserto", async () => {
    const porta = portaFalsa({ trocaPara: OUTRO, identidadesDepois: [{ provider: "google", user_id: OUTRO }] });
    const { conta, armazenamento } = montar(porta, URL_RETORNO, comTransacao());
    expect(await conta.concluirRetornoOAuth()).toEqual({ tipo: "erro", motivo: "troca-de-usuario" });
    expect(armazenamento.getItem(CHAVE_DA_TRANSACAO)).toBeNull();
    expect(porta.anonimosCriados).toBe(0);
  });

  it("G — sem identidade google depois da troca, NÃO se declara vínculo", async () => {
    const porta = portaFalsa({ identidadesDepois: [{ provider: "email", user_id: GUEST }] });
    const { conta } = montar(porta, URL_RETORNO, comTransacao());
    expect(await conta.concluirRetornoOAuth()).toEqual({ tipo: "erro", motivo: "nao-vinculado" });
  });

  it("H — callback sem code é erro neutro, e a URL sai limpa", async () => {
    const { conta, url } = montar(portaFalsa(), `${ORIGEM}/?conta=google`, comTransacao());
    expect(await conta.concluirRetornoOAuth()).toEqual({ tipo: "erro", motivo: "callback-invalido" });
    expect(url()).not.toContain("conta=google");
  });

  it("código recusado pelo provedor é erro neutro", async () => {
    const { conta } = montar(portaFalsa({ erroNaTroca: true }), URL_RETORNO, comTransacao());
    expect(await conta.concluirRetornoOAuth()).toEqual({ tipo: "erro", motivo: "callback-invalido" });
  });

  it("o Google cancelado pelo jogador não quebra nada", async () => {
    const { conta } = montar(portaFalsa(), `${ORIGEM}/?conta=google&error=access_denied`, comTransacao());
    expect(await conta.concluirRetornoOAuth()).toEqual({ tipo: "erro", motivo: "provedor-recusou" });
  });

  it("C/12 — sem transação (sessão perdida, link aberto à mão), falha SEM criar convidado", async () => {
    const porta = portaFalsa({ sessao: null });
    const { conta } = montar(porta, URL_RETORNO, armazenamentoFalso());
    expect(await conta.concluirRetornoOAuth()).toEqual({ tipo: "erro", motivo: "sem-transacao" });
    expect(porta.anonimosCriados).toBe(0);
    expect(porta.chamadas.some((c) => c.startsWith("exchangeCodeForSession")), "nem trocou o código").toBe(false);
  });

  it("I — repetir o retorno é idempotente: o segundo não vincula nem estraga o primeiro", async () => {
    const porta = portaFalsa({ identidadesDepois: GOOGLE_DO_GUEST });
    const arm = comTransacao();
    const { conta } = montar(porta, URL_RETORNO, arm);
    expect(await conta.concluirRetornoOAuth()).toEqual({ tipo: "vinculado", userId: GUEST });
    // a URL já foi limpa; uma segunda passagem não reconhece retorno nenhum
    expect(await conta.concluirRetornoOAuth()).toEqual({ tipo: "nada" });
    // e mesmo forçando a MESMA URL de novo, sem transação, não há vínculo
    const outra = montar(porta, URL_RETORNO, armazenamentoFalso());
    expect(await outra.conta.concluirRetornoOAuth()).toEqual({ tipo: "erro", motivo: "sem-transacao" });
  });

  it("URL sem marcador não é assunto nosso — e nada é tocado", async () => {
    const porta = portaFalsa();
    const { conta, url } = montar(porta, `${ORIGEM}/?seed=3&code=nao-e-nosso`);
    expect(await conta.concluirRetornoOAuth()).toEqual({ tipo: "nada" });
    expect(url(), "não somos donos desta URL").toContain("code=nao-e-nosso");
    expect(porta.chamadas).toEqual([]);
  });

  it("provedor indisponível no retorno: erro, e a URL sai limpa mesmo assim", async () => {
    const { conta, url } = montar(null, URL_RETORNO, comTransacao());
    expect(await conta.concluirRetornoOAuth()).toEqual({ tipo: "erro", motivo: "indisponivel" });
    expect(url()).not.toContain("code=");
  });
});

describe("L — nada de segredo sobra", () => {
  it("a URL limpa não guarda code, flow id nem marcador", () => {
    const limpa = urlLimpa(`${ORIGEM}/?seed=9&conta=google&code=abc&sb_flow_id=f1#x`);
    expect(limpa).toBe("/?seed=9");
    expect(limpa).not.toContain("code");
    expect(limpa).not.toContain("sb_flow_id");
  });

  it("o armazenamento da transação não tem token nem código", async () => {
    const { conta, armazenamento } = montar(portaFalsa(), ORIGEM);
    await conta.vincularGoogle();
    const tudo = [...armazenamento.dados.values()].join(" ");
    for (const proibido of ["access_token", "refresh_token", "provider_token", "code_verifier", "token-de-mentira"]) {
      expect(tudo, `${proibido} não pode ser gravado por nós`).not.toContain(proibido);
    }
  });

  it("o diagnóstico só mostra id mascarado", () => {
    expect(mascarar(GUEST)).toBe("11111111…1111");
    expect(mascarar(GUEST)).not.toBe(GUEST);
    expect(mascarar(undefined)).toBe("∅");
  });
});

describe("M — jogar continua podendo criar convidado", () => {
  let criados = 0;
  beforeEach(() => { criados = 0; });

  it("o caminho de entrar na sala cria convidado quando não há sessão", async () => {
    // Espelha `identidadeSupabase.token()`: ali a conveniência é correta, e é só ali.
    const porta: PortaDeAutenticacao = {
      ...portaFalsa({ sessao: null }),
      async signInAnonymously() {
        criados += 1;
        return { data: { session: { access_token: "novo", user: { id: OUTRO } } } };
      },
    };
    const sessao = await porta.getSession();
    const token = sessao.data.session?.access_token ?? (await porta.signInAnonymously()).data.session?.access_token;
    expect(token).toBe("novo");
    expect(criados).toBe(1);
  });
});
