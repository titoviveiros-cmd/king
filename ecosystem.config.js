// Configuração do PM2 — é por este arquivo que o Colyseus Cloud descobre o que executar.
//
// Precisa ficar na RAIZ do projeto e apontar para o JavaScript COMPILADO, nunca para o
// TypeScript: em produção não existe transpilador no caminho.
//
// Fica em CommonJS de propósito. O `package.json` da raiz não declara `"type": "module"`, então
// um `.js` aqui é CommonJS — que é o formato que o PM2 espera para o arquivo de configuração.
// Isso é independente do servidor em si, que é ESM (`apps/server` declara `"type": "module"`).
//
// A porta NÃO é fixada aqui: quem hospeda injeta `PORT`, e `apps/server/src/index.ts` a respeita,
// caindo em 2567 apenas quando ninguém definiu nada.
module.exports = {
  apps: [
    {
      name: "king-server",
      script: "apps/server/dist/index.js",
      // O servidor autoritativo guarda o estado da partida EM MEMÓRIA (ver KingRoom): duas
      // instâncias não compartilham salas. Uma única instância é a configuração correta enquanto
      // não houver presença/driver distribuído.
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
