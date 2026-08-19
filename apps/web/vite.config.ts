import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Consome o código-fonte do motor direto (Vite transpila o TS), sem build prévio.
      "@king/engine": fileURLToPath(
        new URL("../../packages/engine/src/index.ts", import.meta.url),
      ),
    },
  },
  // host: true => o servidor também escuta na rede local (celular no mesmo Wi-Fi).
  server: { port: 5173, open: true, host: true },
});
