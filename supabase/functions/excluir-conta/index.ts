// ENTRADA DA EDGE FUNCTION `excluir-conta` (Deno). Toda a lógica mora em `nucleo.ts` e `apple.ts`,
// que são testados no Node (`npm run test:funcoes`). Aqui só o ambiente é lido e ligado.
//
// PUBLICAR (gate manual — ver docs/KING-MOBILE-RC.md, "Exclusão de conta"):
//   supabase functions deploy excluir-conta --no-verify-jwt
// `--no-verify-jwt` porque o projeto assina os JWT com chave assimétrica (JWKS): a verificação é
// feita AQUI DENTRO, com a chave pública do próprio projeto — a mesma do servidor do jogo.
//
// SEGREDOS (supabase secrets set …): KING_APPLE_TEAM_ID, KING_APPLE_KEY_ID, KING_APPLE_CLIENT_ID,
// KING_APPLE_PRIVATE_KEY (o .p8 inteiro). Opcional: KING_ORIGENS_EXTRAS. SUPABASE_URL e
// SUPABASE_SERVICE_ROLE_KEY o próprio Supabase injeta.
import * as jose from "npm:jose@6.2.10";
import { configuracaoApple, criarExclusao, criarVerificador, origensPermitidas } from "./nucleo.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const chaveDeServico = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(
  supabaseUrl && chaveDeServico
    ? criarExclusao(
        {
          supabaseUrl,
          chaveDeServico,
          origens: origensPermitidas(Deno.env.get("KING_ORIGENS_EXTRAS")),
          apple: configuracaoApple((nome) => Deno.env.get(nome)),
        },
        {
          verificarToken: criarVerificador(jose as never, supabaseUrl),
          rede: fetch,
          agora: () => Date.now(),
          registrar: (evento) => console.log(evento),
        },
      )
    : () => new Response(JSON.stringify({ erro: "nao-configurada" }), { status: 500, headers: { "content-type": "application/json" } }),
);
