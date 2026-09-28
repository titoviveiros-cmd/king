/// <reference types="vite/client" />

// Tipagem das variáveis de ambiente do app. VITE_KING_SERVER_URL é lida em `net/servidor.ts`.
interface ImportMetaEnv {
  /** URL pública do servidor multiplayer (Colyseus Cloud). Ausente = só modo local/bots. */
  readonly VITE_KING_SERVER_URL?: string;
  /** Token PÚBLICO de projeto do PostHog (`phc_…`). Ausente = analytics em silêncio. */
  readonly VITE_POSTHOG_KEY?: string;
  /** Host de ingestão do PostHog (https). Ausente = analytics em silêncio. */
  readonly VITE_POSTHOG_HOST?: string;
  /** production | preview | development — obrigatório no build de loja, que não passa pela Vercel. */
  readonly VITE_KING_AMBIENTE?: string;
  /** `test` marca todo evento deste build como tráfego de teste (builds de e2e). */
  readonly VITE_KING_TRAFEGO?: string;
}

/** O `VERCEL_ENV` do momento do build (ver `vite.config.ts`). Vazio fora da Vercel. */
declare const __KING_VERCEL_ENV__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
