// A SESSÃO NO APP — no cofre do sistema, e não no WebView.
//
// ══ POR QUE SAIR DO localStorage ══
//
// No navegador, o SDK do Supabase guarda a sessão em `localStorage`, e isso basta. No app, o
// localStorage mora dentro do WebView (`app_webview/` no Android, os dados do WKWebView no iOS):
// texto puro, e — sem as regras de backup — copiado para outro aparelho, clonando a identidade
// (red team da Fase 8). A sessão do convidado É a conta dele: perdê-la é perder o progresso, e
// cloná-la derruba as duas cópias quando ambas renovarem o mesmo token.
//
// No app ela vai para o cofre do sistema (`@aparajita/capacitor-secure-storage`):
//   • iOS: Keychain com `afterFirstUnlockThisDeviceOnly` — não migra por backup nem para outro
//     aparelho, e continua legível com a tela travada depois do primeiro desbloqueio (a renovação
//     do token em segundo plano não quebra). Sem sincronia com o iCloud.
//   • Android: AES-GCM com a chave no Android Keystore, que nunca sai do aparelho; o arquivo cifrado
//     fica fora do backup e da transferência (ver `scripts/preparar-mobile.mjs`). Um arquivo
//     restaurado noutro aparelho não decifra — e vira "sem sessão", nunca uma identidade clonada.
//
// ══ O QUE CONTINUA NO localStorage ══
//
// Um MARCADOR sem segredo nenhum — "há sessão guardada" —, porque a Home precisa saber disso de
// forma SÍNCRONA para não criar convidado só para desenhar um zero (ver `progresso.ts`). O token
// nunca passa por ali.
//
// ══ SE O COFRE FALHAR ══
//
// A sessão fica SÓ NA MEMÓRIA, nesta execução. Cair para o localStorage traria de volta o token em
// texto puro; travar o jogo seria pior que perder a sessão no próximo arranque. Um cofre que falha
// sempre é defeito do pacote nativo, e `npm run mobile:validar` confere que o plugin está nele.

/** O formato que o SDK do Supabase aceita como `auth.storage` (métodos assíncronos). */
export interface ArmazenamentoDaSessao {
  getItem(chave: string): Promise<string | null>;
  setItem(chave: string, valor: string): Promise<void>;
  removeItem(chave: string): Promise<void>;
}

/** O que o KING usa do plugin do cofre. Uma porta, para o teste trocar por uma dublê. */
export interface CofreDoSistema {
  setKeyPrefix(prefixo: string): Promise<void>;
  setSynchronize(sincronizar: boolean): Promise<void>;
  setDefaultKeychainAccess(acesso: number): Promise<void>;
  getItem(chave: string): Promise<string | null>;
  setItem(chave: string, valor: string): Promise<void>;
  removeItem(chave: string): Promise<void>;
  clear(): Promise<void>;
}

/** O valor de `KeychainAccess.afterFirstUnlockThisDeviceOnly` no plugin. Fixado e conferido em teste. */
export const ACESSO_SO_DESTE_APARELHO = 3;

/** Prefixo das chaves do KING no cofre: isola do que qualquer outro plugin gravar lá. */
export const PREFIXO_DO_COFRE = "king_sessao_";

/** O marcador SÍNCRONO, sem segredo: só diz que há uma sessão no cofre. */
export const MARCADOR_DE_SESSAO = "king:sessao-no-cofre";

/** Um localStorage que pode não existir ou recusar acesso. */
export interface LocalSimples {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

const marcar = (local: LocalSimples | null, ha: boolean) => {
  try {
    if (ha) local?.setItem(MARCADOR_DE_SESSAO, "1");
    else local?.removeItem(MARCADOR_DE_SESSAO);
  } catch { /* sem localStorage: a Home só não mostra o progresso antes de entrar online */ }
};

/**
 * A RESERVA quando o cofre não abre: a sessão vive só nesta execução. `semente` é a sessão que um
 * build anterior deixou no localStorage — copiada para a memória, para que ESTA execução continue o
 * mesmo convidado; a cópia antiga fica onde estava, porque sem cofre não há para onde migrá-la.
 */
export function armazenamentoSoNaMemoria(semente?: { chave: string; valor: string } | null): ArmazenamentoDaSessao {
  const memoria = new Map<string, string>();
  if (semente) memoria.set(semente.chave, semente.valor);
  return {
    async getItem(chave) { return memoria.get(chave) ?? null; },
    async setItem(chave, valor) { memoria.set(chave, valor); },
    async removeItem(chave) { memoria.delete(chave); },
  };
}

/** Configura o cofre ANTES do primeiro uso: prefixo próprio, sem iCloud, só deste aparelho. */
export async function prepararCofre(cofre: CofreDoSistema): Promise<void> {
  await cofre.setKeyPrefix(PREFIXO_DO_COFRE);
  await cofre.setSynchronize(false);
  await cofre.setDefaultKeychainAccess(ACESSO_SO_DESTE_APARELHO);
}

/**
 * O ARMAZENAMENTO DA SESSÃO sobre o cofre.
 *
 * `chaveDaSessao` é a chave em que o SDK guarda a sessão (`sb-<ref>-auth-token`): é a escrita e a
 * remoção DELA que acendem e apagam o marcador. As outras chaves do SDK (verificador do PKCE,
 * usuário) passam pelo cofre do mesmo jeito, mas não dizem nada sobre haver sessão.
 */
export function armazenamentoNoCofre(
  cofre: CofreDoSistema,
  chaveDaSessao: string,
  local: LocalSimples | null,
): ArmazenamentoDaSessao {
  const soNaMemoria = new Map<string, string>();
  return {
    async getItem(chave) {
      if (soNaMemoria.has(chave)) return soNaMemoria.get(chave) ?? null;
      try {
        return (await cofre.getItem(chave)) ?? null;
      } catch {
        // Ilegível (chave do Keystore perdida, arquivo vindo de outro aparelho): é "sem sessão".
        return null;
      }
    },
    async setItem(chave, valor) {
      try {
        await cofre.setItem(chave, valor);
        soNaMemoria.delete(chave);
      } catch {
        soNaMemoria.set(chave, valor);
      }
      if (chave === chaveDaSessao) marcar(local, true);
    },
    async removeItem(chave) {
      soNaMemoria.delete(chave);
      try { await cofre.removeItem(chave); } catch { /* já não estava, ou o cofre falhou */ }
      if (chave === chaveDaSessao) marcar(local, false);
    },
  };
}

/**
 * A MIGRAÇÃO ÚNICA: a sessão que um build anterior deixou no localStorage do WebView passa para o
 * cofre — e só DEPOIS de gravada lá some do localStorage. Se o cofre recusar, ela fica onde estava:
 * nunca se perde o convidado por causa de uma mudança de lugar.
 */
export async function migrarSessaoDoWebView(
  cofre: CofreDoSistema,
  chaveDaSessao: string,
  local: LocalSimples | null,
): Promise<"migrada" | "nada" | "falhou"> {
  let antiga: string | null = null;
  try { antiga = local?.getItem(chaveDaSessao) ?? null; } catch { return "nada"; }
  if (!antiga) return "nada";
  let noCofre: string | null = null;
  try { noCofre = await cofre.getItem(chaveDaSessao); } catch { noCofre = null; }
  if (!noCofre) {
    try { await cofre.setItem(chaveDaSessao, antiga); } catch { return "falhou"; }
  }
  // O cofre manda: com sessão nos dois lugares, a do cofre é a que vale e a cópia em texto puro sai.
  try {
    local?.removeItem(chaveDaSessao);
    local?.removeItem(`${chaveDaSessao}-user`);
    local?.removeItem(`${chaveDaSessao}-code-verifier`);
  } catch { /* sem como apagar: o cofre já tem a sessão */ }
  return "migrada";
}

/** Acende ou apaga o marcador conforme o cofre tem, de fato, uma sessão. Chamado no arranque. */
export async function sincronizarMarcador(
  cofre: CofreDoSistema,
  chaveDaSessao: string,
  local: LocalSimples | null,
): Promise<void> {
  let ha = false;
  try { ha = !!(await cofre.getItem(chaveDaSessao)); } catch { ha = false; }
  marcar(local, ha);
}

/** O marcador está aceso? Leitura síncrona, sem segredo. */
export function marcadorDeSessao(local: LocalSimples | null): boolean {
  try { return local?.getItem(MARCADOR_DE_SESSAO) === "1"; } catch { return false; }
}

let limpezaRegistrada: (() => Promise<void>) | null = null;

/** O arranque nativo registra como limpar o cofre que ele preparou. Na web, nunca é chamado. */
export function registrarLimpezaDoCofre(limpar: (() => Promise<void>) | null): void {
  limpezaRegistrada = limpar;
}

/** Limpa o cofre do app, se houver um (na web, não faz nada). Nunca lança. */
export async function limparCofreRegistrado(): Promise<void> {
  try { await limpezaRegistrada?.(); } catch { /* o marcador já foi apagado pela remoção da sessão */ }
}

/**
 * APAGA A SESSÃO DO APARELHO — sair da conta e excluir a conta passam por aqui. O cofre perde
 * todas as chaves do KING, o marcador apaga, e nenhuma cópia antiga sobra no localStorage.
 */
export async function limparSessaoDoCofre(
  cofre: CofreDoSistema,
  chaveDaSessao: string,
  local: LocalSimples | null,
): Promise<void> {
  try { await cofre.clear(); } catch {
    try { await cofre.removeItem(chaveDaSessao); } catch { /* segue: o marcador apaga mesmo assim */ }
  }
  marcar(local, false);
  try {
    local?.removeItem(chaveDaSessao);
    local?.removeItem(`${chaveDaSessao}-user`);
    local?.removeItem(`${chaveDaSessao}-code-verifier`);
  } catch { /* sem localStorage */ }
}
