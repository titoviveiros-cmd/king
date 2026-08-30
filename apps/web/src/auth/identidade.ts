// A IDENTIDADE DO LADO DO CLIENTE — que APRESENTA credencial, e nunca declara quem é.
//
// ══ A DIVISÃO DE TRABALHO ══
//
// Este arquivo tem uma responsabilidade só: conseguir um `access_token` válido, ou admitir que não
// há nenhum. Ele não decide quem é o jogador — quem decide é o servidor, conferindo a assinatura
// contra a chave pública do emissor (ver `apps/server/src/auth/identidade.ts`). Aqui não existe
// `playerId`, de propósito: um `playerId` que o cliente calculasse seria uma segunda verdade, e
// duas verdades sobre quem alguém é acabam divergindo.
//
// ══ POR QUE UMA PORTA, E NÃO O SDK DIRETO ══
//
// `ProvedorDeIdentidade` é uma interface de uma função. Com ela, o `clienteKing` depende de "algo
// que sabe devolver um token", e não do Supabase — o que mantém a rede testável sem rede, deixa o
// modo com bots inteiramente livre de provedor, e faz de trocar de provedor uma troca de
// adaptador em vez de uma cirurgia.
//
// ══ POR QUE NADA DISTO É OBRIGATÓRIO ══
//
// Sem `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`, `identidadeConfigurada()` devolve
// `null` e o KING joga exatamente como sempre jogou: identidade efêmera, sorteada pelo servidor e
// morta com a sala.
//
// ATENÇÃO À ASSIMETRIA. Um servidor SEM provedor atende um cliente COM credencial — ele apenas
// ignora o token. O contrário NÃO vale: um servidor COM provedor configurado EXIGE credencial
// válida (MODO B), e um cliente sem ela é recusado com o código 4005. Publicar o servidor com
// `SUPABASE_URL` antes de publicar o cliente que sabe mandar token tranca todo mundo do lado de
// fora — a ordem correta é cliente primeiro, variável do servidor por último.

/**
 * Quem sabe conseguir uma credencial. Uma função, não um objeto de sessão: a única pergunta que o
 * resto do aplicativo faz é "tem token agora?".
 */
export interface ProvedorDeIdentidade {
  /**
   * O `access_token` da sessão atual, criando uma sessão de convidado se ainda não houver.
   *
   * NUNCA LANÇA. Devolve `undefined` quando não conseguiu, e quem decide o que fazer com isso é
   * o servidor: sem provedor configurado ele sorteia um id como sempre fez; com provedor
   * configurado ele recusa a entrada. Lançar aqui seria pior nos dois casos — transformaria uma
   * indisponibilidade do provedor numa exceção não tratada no meio de entrar numa sala.
   */
  token(): Promise<string | undefined>;
}

export interface AmbienteDeIdentidade {
  /** `import.meta.env.VITE_SUPABASE_URL` */
  url?: string;
  /**
   * `VITE_SUPABASE_PUBLISHABLE_KEY`, ou `VITE_SUPABASE_ANON_KEY` para quem já configurou.
   *
   * OS DOIS NOMES SÃO ACEITOS, e não por indecisão. O Supabase renomeou a chave de cliente de
   * `anon` para `publishable` (`sb_publishable_...`), e um projeto novo mostra o nome novo no
   * painel. Aceitar só o antigo obrigaria a traduzir mentalmente o que está na tela — o tipo de
   * atrito que produz uma variável vazia e um diagnóstico de meia hora. Aceitar só o novo
   * quebraria qualquer ambiente já configurado. O formato da chave não é validado: quem decide
   * se ela vale é o Supabase, e adivinhar prefixo aqui só criaria uma recusa nossa para uma
   * chave legítima de amanhã.
   *
   * PÚBLICA POR DESENHO, e é por isso que pode viver no pacote. Ela identifica o projeto e não
   * autoriza nada sozinha — quem autoriza é a RLS do banco, avaliada no servidor a cada consulta.
   * A chave que de fato dá poder é a `service_role`, e ela não entra em Vite, em APK nem em
   * repositório: só existe no ambiente do servidor.
   */
  anonKey?: string;
}

export type ResultadoDaIdentidade =
  | { configurado: true; url: string; anonKey: string }
  | { configurado: false; motivo: string };

/**
 * Puro, para poder ser testado sem `import.meta`, sem rede e sem provedor — o mesmo desenho de
 * `resolverServidor` em `net/servidor.ts`.
 */
export function resolverIdentidade(env: AmbienteDeIdentidade): ResultadoDaIdentidade {
  const url = env.url?.trim().replace(/\/+$/, "");
  const anonKey = env.anonKey?.trim();
  if (!url || !anonKey) {
    return {
      configurado: false,
      motivo:
        "Identidade permanente indisponível nesta publicação: VITE_SUPABASE_URL e " +
        "VITE_SUPABASE_PUBLISHABLE_KEY não estão configuradas. O jogo funciona normalmente, " +
        "com identidade válida apenas durante cada sala.",
    };
  }
  // Um `https://` é exigido porque o token viaja nele. Aceitar `http://` aqui deixaria a
  // credencial em texto claro na rede de quem estiver no mesmo Wi-Fi.
  if (!/^https:\/\//i.test(url)) {
    return { configurado: false, motivo: "VITE_SUPABASE_URL precisa ser https://" };
  }
  return { configurado: true, url, anonKey };
}

/** Leitura do ambiente real do Vite. */
export function identidadeConfigurada(): ResultadoDaIdentidade {
  const env = import.meta.env as {
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_PUBLISHABLE_KEY?: string;
    VITE_SUPABASE_ANON_KEY?: string;
  };
  return resolverIdentidade({
    url: env.VITE_SUPABASE_URL,
    anonKey: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY,
  });
}

/**
 * O ADAPTADOR SUPABASE.
 *
 * O `import` é DINÂMICO por dois motivos, e os dois importam. O primeiro é peso: quem só joga
 * contra bots nunca baixa o SDK do provedor. O segundo é isolamento — uma falha ao carregar o
 * módulo vira um `undefined` tratado aqui dentro, e não uma tela branca no arranque.
 *
 * A sessão é guardada pelo próprio SDK em `localStorage` e renovada por ele; por isso `token()`
 * chama `getSession()` toda vez em vez de guardar o valor. Um token vencido em cache seria pior
 * que nenhum: seria recusado na porta, e a recusa é em voz alta.
 */
export function identidadeSupabase(cfg: { url: string; anonKey: string }): ProvedorDeIdentidade {
  let clientePromise: Promise<{ auth: SupabaseAuth } | null> | null = null;

  const cliente = () => {
    clientePromise ??= import("@supabase/supabase-js")
      .then(({ createClient }) => createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      }) as unknown as { auth: SupabaseAuth })
      .catch(() => null);
    return clientePromise;
  };

  return {
    async token() {
      try {
        const c = await cliente();
        if (!c) return undefined;
        const atual = await c.auth.getSession();
        const token = atual.data.session?.access_token;
        if (token) return token;
        // Ninguém logado ainda: entra como CONVIDADO. É uma conta de verdade, sem cadastro —
        // e é ela que, mais tarde, o jogador vincula ao Google sem perder o que já é dele.
        const novo = await c.auth.signInAnonymously();
        return novo.data.session?.access_token ?? undefined;
      } catch {
        return undefined; // provedor indisponível ≠ jogador impedido de jogar
      }
    },
  };
}

/** O pedaço do SDK que este arquivo usa. Escrito à mão para o tipo não vazar para o resto. */
interface SupabaseAuth {
  getSession(): Promise<{ data: { session: { access_token: string } | null } }>;
  signInAnonymously(): Promise<{ data: { session: { access_token: string } | null } }>;
}

/** O provedor real, ou `null` quando esta publicação não tem identidade configurada. */
export function provedorConfigurado(): ProvedorDeIdentidade | null {
  const r = identidadeConfigurada();
  return r.configurado ? identidadeSupabase(r) : null;
}
