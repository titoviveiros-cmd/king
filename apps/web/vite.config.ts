import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

// A VERSÃO DO KING tem UMA fonte: o package.json da RAIZ. É o mesmo arquivo de onde
// `scripts/preparar-mobile.mjs` tira o `versionName` do Android (e `validar-mobile.mjs` confere),
// então a Home, o AAB e a loja não divergem. Nada de número escrito à mão em componente.
const VERSAO = (JSON.parse(
  readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string }).version;

export default defineConfig({
  plugins: [react()],
  // O AMBIENTE DO ANALYTICS. A Vercel informa no build se ele é de produção, de preview ou de
  // desenvolvimento, mas só para o processo de build — o navegador não enxerga `process.env`.
  // Esta linha copia o valor para dentro do pacote como uma constante. Fora da Vercel fica vazio,
  // e o analytics trata vazio como "development" (ver `src/analytics/contexto.ts`).
  define: {
    __KING_VERCEL_ENV__: JSON.stringify(process.env.VERCEL_ENV ?? ""),
    __KING_VERSAO__: JSON.stringify(VERSAO),
    // DIAGNÓSTICO DO ÁUDIO (src/audio/diagnostico.ts): SÓ no APK DEBUG de QA, ligado por
    // `KING_DIAG_AUDIO=1` no ambiente do build. Não é `VITE_*` de propósito: nenhum arquivo .env
    // liga isto por acidente. Desligado, o ramo some do pacote.
    __KING_DIAG_AUDIO__: JSON.stringify(process.env.KING_DIAG_AUDIO === "1"),
  },
  resolve: {
    alias: {
      // Consome o código-fonte do motor direto (Vite transpila o TS), sem build prévio.
      "@king/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
      // CONTRATO COMPARTILHADO cliente↔servidor. O módulo de protocolo é puro (só tipos, uma
      // constante de versão e dois helpers de envio) e não importa nada do Colyseus servidor —
      // por isso pode ser consumido pelo browser sem arrastar o servidor para o bundle.
      "@king/protocol": fileURLToPath(
        new URL("../server/src/protocol/index.ts", import.meta.url),
      ),
    },
  },
  // host: true => o servidor também escuta na rede local (celular no mesmo Wi-Fi).
  server: { port: 5173, open: true, host: true },
});
