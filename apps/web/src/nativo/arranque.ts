// O ARRANQUE DO APP NATIVO — o que precisa existir antes da primeira tela, e só dentro do app.
//
// Na web nada aqui roda, e os plugins nem são baixados: todo `import` de plugin é dinâmico, e só
// acontece depois de `ehAppNativo()` confirmar que há uma ponte nativa.
//
// No app, a SESSÃO vai para o cofre do sistema antes de o cliente do Supabase nascer (ver
// `auth/sessaoNativa.ts`): o cliente espera a promessa registrada aqui, então nenhuma leitura cai
// no lugar errado, nem com a primeira tela já desenhada.
import { registrarArmazenamentoDaSessao } from "../auth/clienteSupabase.js";
import { ehAppNativo, plataformaNativa, registrarFonteNativa } from "../auth/credencialNativa.js";
import { identidadeConfigurada } from "../auth/identidade.js";
import { chaveDaSessao } from "../auth/progresso.js";
import {
  armazenamentoNoCofre,
  armazenamentoSoNaMemoria,
  migrarSessaoDoWebView,
  limparSessaoDoCofre,
  prepararCofre,
  registrarLimpezaDoCofre,
  sincronizarMarcador,
  type ArmazenamentoDaSessao,
  type CofreDoSistema,
  type LocalSimples,
} from "../auth/sessaoNativa.js";

export interface DependenciasDaSessaoNativa {
  nativo: () => boolean;
  /** A URL do Supabase desta publicação, ou `null` sem identidade configurada. */
  urlDaIdentidade: () => string | null;
  carregarCofre: () => Promise<CofreDoSistema>;
  local: () => LocalSimples | null;
}

/**
 * O PLUGIN NUNCA SAI CRU DE UMA FUNÇÃO `async` — defeito do AAB 0.1.0 (vc1), "Conectando…" eterno.
 *
 * O plugin do Capacitor é um Proxy que responde a QUALQUER propriedade com um método nativo,
 * inclusive `then`. Devolvido por uma função `async` (ou por um `.then`), o JavaScript o toma por
 * promessa e chama `plugin.then(ok, falha)`; no Android não existe método nativo "then", a chamada
 * é rejeitada por dentro e `ok` nunca é chamado. O cofre nunca ficava pronto, o cliente do Supabase
 * nunca nascia, o token nunca chegava e "Criar sala" esperava para sempre. Na web nada disso roda.
 *
 * Por isso o plugin é embrulhado num objeto COMUM, só com os métodos que o KING usa: um objeto sem
 * `then` não vira promessa por acidente. Provado com o `@capacitor/core` real em
 * `cofreNativo.test.ts`.
 */
export function cofreDoPlugin(plugin: CofreDoSistema): CofreDoSistema {
  return {
    setKeyPrefix: (prefixo) => plugin.setKeyPrefix(prefixo),
    setSynchronize: (sincronizar) => plugin.setSynchronize(sincronizar),
    setDefaultKeychainAccess: (acesso) => plugin.setDefaultKeychainAccess(acesso),
    getItem: (chave) => plugin.getItem(chave),
    setItem: (chave, valor) => plugin.setItem(chave, valor),
    removeItem: (chave) => plugin.removeItem(chave),
    clear: () => plugin.clear(),
  };
}

export async function carregarCofreDoPlugin(): Promise<CofreDoSistema> {
  const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
  return cofreDoPlugin(SecureStorage as unknown as CofreDoSistema);
}

const dependenciasReais: DependenciasDaSessaoNativa = {
  nativo: () => ehAppNativo(),
  urlDaIdentidade: () => {
    const r = identidadeConfigurada();
    return r.configurado ? r.url : null;
  },
  carregarCofre: carregarCofreDoPlugin,
  local: () => { try { return globalThis.localStorage ?? null; } catch { return null; } },
};

/**
 * Prepara o cofre, migra a sessão de um build anterior, acende o marcador e registra onde a
 * sessão vive. Se o cofre não abrir, a sessão fica só na memória desta execução — nunca em texto
 * puro. Devolve quando o armazenamento está decidido.
 */
export async function prepararSessaoNativa(d: DependenciasDaSessaoNativa = dependenciasReais): Promise<void> {
  if (!d.nativo()) return;
  const url = d.urlDaIdentidade();
  const chave = url ? chaveDaSessao(url) : null;
  if (!chave) return;
  const local = d.local();
  const pronto: Promise<ArmazenamentoDaSessao> = (async () => {
    try {
      const cofre = await d.carregarCofre();
      await prepararCofre(cofre);
      // O cofre abriu mas recusou a sessão antiga: esta execução segue com ELA, na memória (o
      // cofre vazio faria nascer outro convidado, e no próximo arranque a cópia antiga sumiria).
      if ((await migrarSessaoDoWebView(cofre, chave, local)) === "falhou") {
        let antiga: string | null = null;
        try { antiga = local?.getItem(chave) ?? null; } catch { antiga = null; }
        return armazenamentoSoNaMemoria(antiga ? { chave, valor: antiga } : null);
      }
      await sincronizarMarcador(cofre, chave, local);
      registrarLimpezaDoCofre(() => limparSessaoDoCofre(cofre, chave, local));
      return armazenamentoNoCofre(cofre, chave, local);
    } catch {
      let antiga: string | null = null;
      try { antiga = local?.getItem(chave) ?? null; } catch { antiga = null; }
      return armazenamentoSoNaMemoria(antiga ? { chave, valor: antiga } : null);
    }
  })();
  registrarArmazenamentoDaSessao(pronto);
  await pronto;
}

/**
 * O LOGIN NATIVO: o plugin é inicializado com os client IDs do build e a fonte se registra. Sem
 * provedor disponível (ex.: Android sem client ID do Google), nada se registra e a conta não aparece.
 */
export async function prepararLoginNativo(): Promise<void> {
  const plataforma = plataformaNativa();
  if (!plataforma) return;
  const [{ SocialLogin }, { criarFonteDeLoginSocial, configuracaoDoAmbiente }] = await Promise.all([
    import("@capgo/capacitor-social-login"),
    import("./loginSocial.js"),
  ]);
  const fonte = await criarFonteDeLoginSocial(
    SocialLogin as unknown as import("./loginSocial.js").PluginDeLoginSocial,
    configuracaoDoAmbiente(plataforma),
  );
  registrarFonteNativa(fonte);
}

/** Os LINKS DO APP (convites): o endereço que abriu o app e os que chegarem com ele aberto. */
export async function prepararLinksDoApp(): Promise<void> {
  if (!ehAppNativo()) return;
  const [{ App }, { ouvirLinksDoApp }] = await Promise.all([import("@capacitor/app"), import("./linkDoApp.js")]);
  await ouvirLinksDoApp(App as unknown as import("./linkDoApp.js").PortaDoApp);
}

/**
 * O arranque inteiro. Nunca lança e nunca segura a primeira tela por mais de `limiteMs`: o que
 * não ficou pronto a tempo continua sendo esperado por quem depende dele (o cliente do Supabase
 * espera o armazenamento), não pela tela.
 */
export async function iniciarAppNativo(limiteMs = 1500): Promise<void> {
  if (!ehAppNativo()) return;
  const tarefas = Promise.allSettled([prepararSessaoNativa(), prepararLoginNativo(), prepararLinksDoApp()]);
  await Promise.race([tarefas, new Promise((r) => setTimeout(r, limiteMs))]);
}
