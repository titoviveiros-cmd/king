// A VERSÃO DO KING NA HOME — discreta, no canto, e de UMA fonte só.
//
// O número vem do package.json da RAIZ, copiado para o pacote no build (`__KING_VERSAO__`, em
// `vite.config.ts`). É o mesmo arquivo de onde `scripts/preparar-mobile.mjs` carimba o `versionName`
// do Android — e `scripts/validar-mobile.mjs` reprova se os dois divergirem. Assim a Home, o AAB e a
// ficha da loja dizem a mesma versão, e trocar de versão é trocar UMA linha. Mesmo padrão do Titoko
// (DEC-257) e do Verbete (rodapé de versão): nada escrito à mão em componente.

/** Formato que se mostra: semver com sufixo opcional. Qualquer outra coisa não vira rótulo. */
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** "v" + versão (ex.: "v1.2.3") — ou `null` sem versão válida (não inventa número). Pura, para o teste. */
export function rotuloDaVersao(versao: string | null | undefined): string | null {
  const v = versao?.trim();
  return v && SEMVER.test(v) ? `v${v}` : null;
}

/** A versão deste build (`undefined` fora do Vite, como nos testes de unidade). */
export const VERSAO_DO_APP: string | undefined =
  typeof __KING_VERSAO__ === "string" ? __KING_VERSAO__ : undefined;

export const ROTULO_DA_VERSAO: string | null = rotuloDaVersao(VERSAO_DO_APP);
