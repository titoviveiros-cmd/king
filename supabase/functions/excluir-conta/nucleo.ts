// A EXCLUSÃO DE CONTA — o lado do servidor (Supabase Edge Function `excluir-conta`).
//
// ══ POR QUE AQUI, E NÃO NO SERVIDOR DO JOGO ══
//
// Excluir um usuário exige a chave de SERVIÇO do Supabase, e o servidor Colyseus foi desenhado para
// nunca ter uma (ver apps/server/.env.example: um vazamento de leitura viraria vazamento de emissão).
// A Edge Function roda dentro do projeto do Supabase, que injeta a chave no ambiente dela; a chave
// nunca vai para o app, para o repositório nem para o servidor do jogo.
//
// ══ O QUE ELA FAZ, NA ORDEM ══
//
//   1. Confere o JWT de quem chama (JWKS do próprio projeto) — só se exclui o `sub` do token: ninguém
//      exclui a conta de outro. Convidado (anônimo) também exclui: é uma conta de verdade.
//   2. Exige a confirmação explícita no corpo (`"EXCLUIR"`): uma chamada acidental não apaga nada.
//   3. Lê o usuário pela API de administração. Já não existe → "ja-excluida" (idempotente: o
//      segundo toque, ou a repetição de uma resposta perdida, não é erro).
//   4. Se há Apple vinculada: troca o código novo que o app trouxe e REVOGA (diretriz 5.1.1(v)).
//      Falhar aqui não impede a exclusão — o jogador recebe o caminho manual nos Ajustes.
//   5. Apaga o usuário de verdade (`should_soft_delete: false`). A cascata do banco leva o perfil,
//      o progresso e o histórico de XP (players → progresso, xp_eventos); o registro das partidas
//      (`king_private.partidas`) não tem identidade de jogador nenhuma e fica.
//
// Nada de token, e-mail ou id vai para o log: só o desfecho.
//
// Puro (fetch e WebCrypto injetáveis): roda no Deno e é testado no Node.
import { revogarApple, type ConfiguracaoApple, type ResultadoDaRevogacao } from "./apple.ts";

export interface ConfiguracaoDaExclusao {
  /** SUPABASE_URL, injetada pelo Supabase. */
  supabaseUrl: string;
  /** SUPABASE_SERVICE_ROLE_KEY, injetada pelo Supabase. Só existe no ambiente da função. */
  chaveDeServico: string;
  /** Origens que podem chamar do navegador (CORS). A autenticação é o JWT; o CORS só ajuda o navegador. */
  origens: readonly string[];
  apple: ConfiguracaoApple | null;
}

export interface DependenciasDaExclusao {
  /** O `sub` de um JWT válido deste projeto, ou `null`. */
  verificarToken(token: string): Promise<{ sub: string } | null>;
  rede: typeof fetch;
  agora(): number;
  /** Log sem dado pessoal: só o desfecho. */
  registrar?(evento: string): void;
}

export type EstadoDaExclusao = "excluida" | "ja-excluida";
export type RevogacaoApple = ResultadoDaRevogacao | "nao-se-aplica";

/** A confirmação que o app manda. Uma chamada sem ela não exclui nada. */
export const CONFIRMACAO = "EXCLUIR";

/** O app (web, Android, iPhone). Preview/desenvolvimento entram por KING_ORIGENS_EXTRAS. */
export const ORIGENS_PADRAO = ["https://playkingcards.com.br", "https://localhost", "capacitor://localhost"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_DO_CORPO = 8 * 1024;

interface IdentidadeDoAdmin {
  provider?: unknown;
  provider_id?: unknown;
  id?: unknown;
  identity_data?: { sub?: unknown } | null;
}

/**
 * O VERIFICADOR DO JWT, com `jose` injetado (no Deno, `npm:jose`; no teste, o do Node). Mesmos
 * parâmetros do servidor do jogo: emissor do projeto, `aud` authenticated, ES256/RS256.
 */
export function criarVerificador(
  jose: {
    createRemoteJWKSet(url: URL): unknown;
    jwtVerify(token: string, chaves: never, opcoes: Record<string, unknown>): Promise<{ payload: { sub?: unknown } }>;
  },
  supabaseUrl: string,
  chaves?: unknown,
): (token: string) => Promise<{ sub: string } | null> {
  const emissor = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  const jwks = chaves ?? jose.createRemoteJWKSet(new URL(`${emissor}/.well-known/jwks.json`));
  return async (token) => {
    try {
      const { payload } = await jose.jwtVerify(token, jwks as never, {
        issuer: emissor,
        audience: "authenticated",
        algorithms: ["ES256", "RS256"],
        clockTolerance: 30,
      });
      return typeof payload.sub === "string" && UUID.test(payload.sub) ? { sub: payload.sub } : null;
    } catch {
      return null;
    }
  };
}

const subDaIdentidade = (i: IdentidadeDoAdmin): string | null => {
  for (const v of [i.identity_data?.sub, i.provider_id, i.id]) if (typeof v === "string" && v) return v;
  return null;
};

export function criarExclusao(cfg: ConfiguracaoDaExclusao, d: DependenciasDaExclusao): (pedido: Request) => Promise<Response> {
  const base = cfg.supabaseUrl.replace(/\/+$/, "");
  const admin = { apikey: cfg.chaveDeServico, authorization: `Bearer ${cfg.chaveDeServico}` };

  return async (pedido) => {
    const origem = pedido.headers.get("origin");
    const cors: Record<string, string> = {
      vary: "Origin",
      ...(origem && cfg.origens.includes(origem)
        ? {
            "access-control-allow-origin": origem,
            "access-control-allow-methods": "POST, OPTIONS",
            "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
            "access-control-max-age": "600",
          }
        : {}),
    };
    const responder = (status: number, corpo?: Record<string, unknown>) =>
      new Response(corpo ? JSON.stringify(corpo) : null, {
        status,
        headers: { ...cors, ...(corpo ? { "content-type": "application/json; charset=utf-8" } : {}), "cache-control": "no-store" },
      });

    if (pedido.method === "OPTIONS") return responder(204);
    if (pedido.method !== "POST") return responder(405, { erro: "metodo" });

    // 1. QUEM É: só o próprio dono da sessão, pelo JWT assinado pelo projeto.
    const cabecalho = pedido.headers.get("authorization") ?? "";
    const token = /^Bearer\s+(\S+)$/i.exec(cabecalho)?.[1];
    if (!token) return responder(401, { erro: "sem-credencial" });
    const quem = await d.verificarToken(token);
    if (!quem || !UUID.test(quem.sub)) return responder(401, { erro: "credencial-invalida" });

    // 2. A CONFIRMAÇÃO, no corpo.
    let corpo: { confirmacao?: unknown; apple?: { codigo?: unknown } | null } = {};
    try {
      const texto = await pedido.text();
      if (texto.length > LIMITE_DO_CORPO) return responder(413, { erro: "corpo-grande" });
      corpo = texto ? JSON.parse(texto) : {};
    } catch {
      return responder(400, { erro: "corpo-invalido" });
    }
    if (!corpo || typeof corpo !== "object" || corpo.confirmacao !== CONFIRMACAO) return responder(400, { erro: "sem-confirmacao" });
    const codigoApple = typeof corpo.apple?.codigo === "string" && corpo.apple.codigo.length <= 1024 ? corpo.apple.codigo : null;

    const enderecoDoUsuario = `${base}/auth/v1/admin/users/${encodeURIComponent(quem.sub)}`;

    // 3. O ESTADO ATUAL. Já não existe → idempotente.
    let identidades: IdentidadeDoAdmin[] = [];
    try {
      const r = await d.rede(enderecoDoUsuario, { headers: admin });
      if (r.status === 404) {
        d.registrar?.("exclusao: ja-excluida");
        return responder(200, { estado: "ja-excluida" satisfies EstadoDaExclusao, apple: "nao-se-aplica" satisfies RevogacaoApple });
      }
      if (!r.ok) { d.registrar?.(`exclusao: leitura falhou (${r.status})`); return responder(502, { erro: "indisponivel" }); }
      const usuario = (await r.json()) as { identities?: unknown };
      identidades = Array.isArray(usuario.identities) ? (usuario.identities as IdentidadeDoAdmin[]) : [];
    } catch {
      d.registrar?.("exclusao: leitura falhou (rede)");
      return responder(502, { erro: "indisponivel" });
    }

    // 4. APPLE: revoga ANTES de apagar. Se a exclusão falhar depois, a conta segue inteira e o
    //    jogador repete; se a revogação falhar, a exclusão segue (e o app mostra o caminho manual).
    const apple = identidades.find((i) => i.provider === "apple");
    const subApple = apple ? subDaIdentidade(apple) : null;
    const revogacao: RevogacaoApple = apple && subApple
      ? await revogarApple(cfg.apple, codigoApple, subApple, d.rede, d.agora())
      : apple ? "falhou" : "nao-se-aplica";

    // 5. APAGA DE VERDADE. A cascata do banco leva perfil, progresso e XP.
    try {
      const r = await d.rede(enderecoDoUsuario, {
        method: "DELETE",
        headers: { ...admin, "content-type": "application/json" },
        body: JSON.stringify({ should_soft_delete: false }),
      });
      if (r.status === 404) {
        d.registrar?.(`exclusao: ja-excluida (apple=${revogacao})`);
        return responder(200, { estado: "ja-excluida" satisfies EstadoDaExclusao, apple: revogacao });
      }
      if (!r.ok) {
        d.registrar?.(`exclusao: falhou (${r.status}, apple=${revogacao})`);
        return responder(502, { erro: "falha-ao-excluir", apple: revogacao });
      }
    } catch {
      d.registrar?.(`exclusao: falhou (rede, apple=${revogacao})`);
      return responder(502, { erro: "falha-ao-excluir", apple: revogacao });
    }
    d.registrar?.(`exclusao: ok (apple=${revogacao})`);
    return responder(200, { estado: "excluida" satisfies EstadoDaExclusao, apple: revogacao });
  };
}

/** A configuração da Apple a partir do ambiente da função — `null` se faltar qualquer peça. */
export function configuracaoApple(env: (nome: string) => string | undefined): ConfiguracaoApple | null {
  const teamId = env("KING_APPLE_TEAM_ID")?.trim();
  const keyId = env("KING_APPLE_KEY_ID")?.trim();
  const clientId = env("KING_APPLE_CLIENT_ID")?.trim();
  const chavePrivada = env("KING_APPLE_PRIVATE_KEY")?.trim();
  return teamId && keyId && clientId && chavePrivada ? { teamId, keyId, clientId, chavePrivada } : null;
}

/** As origens do CORS: as do app, mais as de KING_ORIGENS_EXTRAS (vírgula), só https://. */
export function origensPermitidas(extras: string | undefined): string[] {
  const adicionais = (extras ?? "").split(",").map((s) => s.trim()).filter((s) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s));
  return [...ORIGENS_PADRAO, ...adicionais];
}
