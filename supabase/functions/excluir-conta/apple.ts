// SIGN IN WITH APPLE — a REVOGAÇÃO que a exclusão de conta exige (App Store, diretriz 5.1.1(v)).
//
// Conferido na documentação oficial (Sign in with Apple REST API, 25/10/2026):
//   • POST https://appleid.apple.com/auth/token — troca o código de autorização (uso único, válido
//     por 5 minutos) por tokens: client_id, client_secret, code, grant_type=authorization_code. O
//     `redirect_uri` só vai se o pedido original teve um (o app nativo não tem).
//   • POST https://appleid.apple.com/auth/revoke — client_id, client_secret, token e
//     token_type_hint (refresh_token | access_token). 200 sem corpo: revogado, ou já era inválido.
//   • client_secret: JWT ES256 assinado com a chave privada do Sign in with Apple (.p8);
//     cabeçalho `kid` = Key ID; `iss` = Team ID; `sub` = client_id; `aud` = https://appleid.apple.com.
//
// O KING NÃO GUARDA token nenhum da Apple. Na exclusão, o app pede um código NOVO ao jogador
// (a própria tela da Apple é parte da confirmação forte), e este arquivo o troca e revoga na hora.
//
// Puro: só `fetch` e WebCrypto — roda igual no Deno (Edge Function) e no Node (testes).

export interface ConfiguracaoApple {
  teamId: string;
  keyId: string;
  /** O App ID do app (bundle identifier) — o MESMO client_id da autorização. */
  clientId: string;
  /** A chave .p8 (PKCS#8 em PEM). Segredo da função; nunca sai do servidor. */
  chavePrivada: string;
}

export type ResultadoDaRevogacao =
  | "revogada"
  /** A conta tinha Apple, mas nenhum código veio (exclusão feita fora do iPhone). */
  | "sem-codigo"
  /** O código era de OUTRO Apple ID (o jogador entrou com outra conta na tela da Apple). */
  | "outra-conta"
  /** A Apple recusou ou não respondeu. A exclusão segue; o jogador recebe o caminho manual. */
  | "falhou"
  /** Os segredos da Apple não estão configurados nesta função. */
  | "nao-configurada";

const APPLE = "https://appleid.apple.com";

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const json64 = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** O `client_secret`: um JWT ES256 de vida curta (5 minutos bastam para as duas chamadas). */
export async function segredoDoCliente(cfg: ConfiguracaoApple, agoraMs: number, cripto: Crypto = crypto): Promise<string> {
  const corpo = cfg.chavePrivada.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(corpo), (c) => c.charCodeAt(0));
  const chave = await cripto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Math.floor(agoraMs / 1000);
  const entrada = `${json64({ alg: "ES256", kid: cfg.keyId })}.${json64({
    iss: cfg.teamId, iat, exp: iat + 300, aud: APPLE, sub: cfg.clientId,
  })}`;
  // WebCrypto devolve a assinatura ECDSA em r||s (64 bytes) — exatamente o formato do JWS ES256.
  const assinatura = await cripto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, chave, new TextEncoder().encode(entrada));
  return `${entrada}.${b64url(new Uint8Array(assinatura))}`;
}

/** O `sub` dentro de um id_token que veio DIRETO da Apple por TLS (servidor a servidor). */
function subDoIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const parte = idToken.split(".")[1] ?? "";
    const b64 = parte.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parte.length / 4) * 4, "=");
    const sub = (JSON.parse(atob(b64)) as { sub?: unknown }).sub;
    return typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

/**
 * TROCA E REVOGA. `subEsperado` é o `sub` da identidade Apple vinculada à conta que está sendo
 * excluída: um código de outro Apple ID não revoga nada (seria revogar a conta de outra pessoa).
 */
export async function revogarApple(
  cfg: ConfiguracaoApple | null,
  codigo: string | null | undefined,
  subEsperado: string,
  rede: typeof fetch,
  agoraMs: number,
): Promise<ResultadoDaRevogacao> {
  if (!cfg) return "nao-configurada";
  if (!codigo) return "sem-codigo";
  try {
    const segredo = await segredoDoCliente(cfg, agoraMs);
    const troca = await rede(`${APPLE}/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: segredo, code: codigo, grant_type: "authorization_code" }),
    });
    if (!troca.ok) return "falhou";
    const tokens = (await troca.json()) as { refresh_token?: unknown; access_token?: unknown; id_token?: unknown };
    if (subDoIdToken(tokens.id_token) !== subEsperado) return "outra-conta";
    const [token, dica] = typeof tokens.refresh_token === "string"
      ? [tokens.refresh_token, "refresh_token"]
      : typeof tokens.access_token === "string" ? [tokens.access_token, "access_token"] : [null, null];
    if (!token || !dica) return "falhou";
    const revogacao = await rede(`${APPLE}/auth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: segredo, token, token_type_hint: dica }),
    });
    return revogacao.ok ? "revogada" : "falhou";
  } catch {
    return "falhou";
  }
}
