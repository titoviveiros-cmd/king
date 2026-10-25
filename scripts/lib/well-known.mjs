// OS ARQUIVOS DE DOMÍNIO ASSOCIADO — o que prova ao Android e ao iOS que o app é dono do convite.
//
//   /.well-known/assetlinks.json            (Android App Links — Digital Asset Links)
//   /.well-known/apple-app-site-association (iOS Universal Links — sem extensão, JSON)
//
// Puro: recebe os dois valores que só existem fora do repositório (a impressão digital SHA-256 do
// certificado de assinatura da Play e o Team ID da Apple) e devolve o conteúdo. Recusa valor de
// modelo ("TROCAR…") e formato errado — publicar um arquivo inválido quebraria a verificação em
// silêncio, e o link voltaria a abrir o navegador sem ninguém saber por quê.

export const PACOTE_ANDROID = "br.com.playkingcards.king";
export const BUNDLE_IOS = "br.com.playkingcards.king";

const SHA256 = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;
const TEAM_ID = /^[A-Z0-9]{10}$/;

/** Normaliza e confere as impressões digitais (vírgula entre várias: upload + Play App Signing). */
export function impressoesDigitais(bruto) {
  const lista = String(bruto ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (lista.length === 0) throw new Error("KING_ANDROID_SHA256 ausente (Play Console → Integridade do app → Assinatura de apps)");
  for (const s of lista) {
    if (!SHA256.test(s)) throw new Error(`impressão digital SHA-256 inválida: "${s.slice(0, 20)}…" (esperado AA:BB:… com 32 bytes)`);
  }
  return [...new Set(lista)];
}

export function teamIdDaApple(bruto) {
  const t = String(bruto ?? "").trim().toUpperCase();
  if (!TEAM_ID.test(t)) throw new Error("KING_APPLE_TEAM_ID ausente ou inválido (10 letras/números — Apple Developer → Membership)");
  return t;
}

/** O assetlinks.json: só este pacote, só `handle_all_urls`, só as impressões dadas. */
export function assetLinks(impressoes) {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: PACOTE_ANDROID, sha256_cert_fingerprints: impressoes },
    },
  ];
}

/**
 * O apple-app-site-association: SÓ a raiz com `?sala=` de quatro caracteres. Qualquer outra página
 * do site (privacidade, exclusão de conta) continua abrindo no navegador.
 */
export function appleAppSiteAssociation(teamId) {
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${BUNDLE_IOS}`],
          components: [
            { "/": "/", "?": { sala: "????" }, comment: "Só o convite: a raiz com ?sala= de quatro caracteres. O app confere os dígitos e nunca entra sozinho." },
          ],
        },
      ],
    },
  };
}

/** Os dois arquivos, prontos para gravar em apps/web/public/.well-known/. */
export function arquivosDeDominio({ sha256, teamId }) {
  const impressoes = impressoesDigitais(sha256);
  const time = teamIdDaApple(teamId);
  return {
    "assetlinks.json": JSON.stringify(assetLinks(impressoes), null, 2) + "\n",
    "apple-app-site-association": JSON.stringify(appleAppSiteAssociation(time), null, 2) + "\n",
  };
}
