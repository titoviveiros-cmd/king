/// <reference types="vite/client" />

// Tipagem das variáveis de ambiente do app. VITE_KING_SERVER_URL é lida em `net/servidor.ts`.
interface ImportMetaEnv {
  /** URL pública do servidor multiplayer (Colyseus Cloud). Ausente = só modo local/bots. */
  readonly VITE_KING_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
