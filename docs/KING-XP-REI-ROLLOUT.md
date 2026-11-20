# KING — Penalidade do Rei no XP (Entrega C): regra, compatibilidade e roteiro de ativação

> **Estado:** preparado e testado só em Postgres local descartável. A migração **NÃO foi aplicada** em
> lugar nenhum. Aplicar, publicar o servidor e publicar a web exigem autorização própria, nesta ordem.

## A regra

Quem **capturar o Rei de Copas (K♥) na mão 5** perde **60 XP** sobre a recompensa **bruta** da partida
online. Os **−160 pontos oficiais** da mão **não mudam** (motor, placar e checksums intactos).

| Posição | XP bruto | Com a captura (antes da redução diária) | 7ª+ partida do dia, com a captura |
|---|---|---|---|
| 1º | 150 | **90** | 90 ÷ 4 = **22** |
| 2º | 130 | **70** | 70 ÷ 4 = **17** |
| 3º | 115 | **55** | 55 ÷ 4 = **13** |
| 4º | 100 | **40** | 40 ÷ 4 = **10** |

Ordem fixa: **bruto → penalidade → redução diária** (25% — divisão inteira por 4 — da 7ª partida com XP
do dia de São Paulo em diante, a mesma regra de sempre, `anteriores_no_dia >= 6`).

- **Sem XP negativo:** quem já recebe 0 (abandono/participação < 60%, partida sobreposta) não recebe
  penalidade. Com bruto ≥ 100, o líquido mínimo é 10: a partida continua contando como "partida com XP"
  (redução diária, sequência e recordes iguais a antes).
- **Sem saldo negativo e sem dedução retroativa:** o crédito só soma (soma menos). Nenhum lançamento
  antigo é recalculado; a migração não toca em XP, ledger nem partidas (conferência 7 e teste S6).
- **Bot capturou:** nenhum humano é penalizado. **Solo (e o futuro Minitorneio):** sem XP online, nada
  muda — os −160 pontos continuam no placar.
- Preservados: abandono, sobreposição, participação ≥ 60%, mínimo de 2 humanos, identidade permanente,
  idempotência, outbox, retries, disjuntor, ledger e crédito único.

## Autoridade: de onde vem o "quem capturou"

Do **histórico do motor no servidor**, nunca do navegador. `apps/server/src/progresso/capturaDoRei.ts`
lê a linha `no-king` do histórico (a mesma fonte do destaque do Placar, `matchStats(m).kingTaker`) e só
aceita um fato **inequívoco**: exatamente um assento com −160 e três com 0, mão 5 única, e a leitura
igual à do `kingTaker`. Qualquer dúvida → `null` → crédito pela **regra 1** (sem penalidade).

O motor pontua o **assento**: abandono, assistência por estouro de prazo e reconexão não mudam quem
levou a vaza do K♥. Provas:
- `capturaDoRei.test.ts`: 300 partidas sorteadas comparando, jogada a jogada, o vencedor REAL da vaza
  do K♥ com o fato (vazas variadas, os 4 assentos, dono da carta × outro capturando); K♥ na **última
  vaza** (13ª) montada à mão; partida **incompleta** = sem fato; histórico adulterado = sem fato.
- `progressoDaPartida.test.ts` (sala Colyseus real, WebSocket real, 10 mãos): o fato entregue = o
  vencedor observado na mesa — com todos conectados; com um assento **calado** (tudo no automático); e
  com um jogador que **cai no início da mão 5 e reconecta** antes da mão 6.

O banco calcula o XP: o servidor só manda o FATO `capturou_rei` (no máximo UM `true`).

## Versionamento e compatibilidade

- Porta **v1** `king_private.creditar_partida` — **intacta** (mesmo texto, md5 conferido no rollout).
- Porta **v2** `king_private.creditar_partida_v2` — contrato estrito com `capturou_rei`; grava
  `king_private.partidas.versao_regra = 2` e as parcelas em `public.xp_composicao`.
- Resultado do servidor/outbox: `regra: 2` + `capturouRei` em todos os humanos. **Ausente = regra 1.**

| Servidor | Banco | O que acontece |
|---|---|---|
| antigo | antigo | crédito de sempre (S5) |
| antigo | **novo** | v1 intacta → regra 1, sem composição (S2) |
| **novo** | antigo | v2 → **42883** → a MESMA partida pela v1, regra 1; com placar, num SAVEPOINT (S4) |
| **novo** | **novo** | regra 2 pela v2; pendência antiga do outbox (sem o fato) pela v1 (S1) |

Outro erro da v2 (22023, 40001, 08006, 28P01, 42501…) **sobe** como sempre (retry/disjuntor) — nunca vira
"credita pela regra 1" (`penalidadeDoRei.test.ts`). Reenvio cruzado v1↔v2 da mesma partida devolve o
que já existe (`novo=false`), sem recalcular nem trocar a versão (X5, X6).

**Web/app:** o protocolo multiplayer **não muda** (`PROTOCOL_VERSION` 3). O AAB 0.1.1 e a web de
Production não leem `xp_composicao` e continuam mostrando o "+N XP" de sempre (que já será o líquido).
A web nova lê `xp_composicao` com `select *`; banco sem a tabela → sem conta, mesmo bloco de antes.

**Risco documentado (igual ao dos recordes):** um servidor ANTERIOR rejeita pendências do outbox com
`regra`/`capturouRei` (ficam como "ilegíveis", não se perdem). Antes de reverter o servidor, conferir
que o outbox está vazio — ou reinstalar o servidor novo para drená-lo.

## Ordem segura: banco → servidor → web

1. **Banco (SQL Editor, com autorização):**
   1. `supabase/rollout/xp-rei-checkpoint-1-antes.sql` (só leitura) → `pronto_para_aplicar = true`; guardar a linha.
   2. `supabase/rollout/xp-rei-aplicar.sql` inteiro, uma vez → última tela
      `PENALIDADE DO REI (ENTREGA C) APLICADA E CONFERIDA`. Uma transação: recusas (papéis, aplicador que
      não herda o dono, servidor membro do dono, progresso incompleto, pedaço já presente), migração
      verbatim (sha256 no cabeçalho) e 7 conferências. `lock timeout` = rodar de novo um minuto depois.
   3. `supabase/rollout/xp-rei-checkpoint-3-depois.sql` (só leitura) → `tudo_certo = true`, md5 da v1 iguais.
   Até o passo 2 o servidor no ar continua creditando pela regra 1 (v1).
2. **Servidor:** deploy de sempre. Nenhuma variável nova. A partir dele, partidas novas pela regra 2.
3. **Web:** publicação de sempre. Mostra a conta no Placar Final online quando o banco a confirmar.

## Rollback (ordem inversa)

1. Web e servidor podem voltar (ou ficar): ambos toleram o banco sem a Entrega C.
2. Banco: `supabase/rollback/20261121120000_xp_penalidade_rei_rollback.sql` — tira a v2, a regra v2 e a
   composição. **Nada é recalculado:** o XP creditado pela regra 2 continua creditado e
   `partidas.versao_regra = 2` continua dizendo sob qual regra nasceu. Provado: logo depois do rollout o
   banco volta **exatamente** ao de antes (R6: catálogo, privilégios, constraints, gatilhos, políticas e
   XP); depois de créditos v2, a estrutura volta e o XP fica (R7), e o checkpoint 1 volta a dar `true`.

## Provas locais (`npm run test:xp-rei-sql`, Postgres 17 embutido e descartável)

- **X1–X10** regra, redução depois da penalidade, sem negativo, contrato estrito, repetição,
  **corrida** da mesma partida (v2×v2 e v1×v2) e de partidas diferentes (6ª×7ª do dia) sob a trava,
  RLS/privilégios/CHECKs, exclusão de conta (lápide e cascata), rollback/reaplicação.
- **S1–S6** o servidor **compilado** nas quatro combinações, corrida de entregas, nada retroativo.
- **R1–R7 + R2b** o arquivo exato do rollout: verbatim, aplicação com checkpoints só-leitura, recusa da
  reaplicação, 13 defeitos que abortam nas conferências sem gravar nada, pré-condições inválidas,
  rollback exato; R2b num banco **sem** os recordes (independência).
- **21 mutações** — cada guarda removida em memória reprova os seus alvos.

## Decisões do dono (pendentes)

- Aprovar a regra como está (valor 60, aplicação antes da redução, penalidade segue o ASSENTO mesmo
  quando o K♥ caiu no automático de um jogador que voltou a tempo de participar).
- Texto da conta no Placar (`150` riscado · `−60 Rei de Copas` · `−68 redução diária`): aprovação visual.
- Autorizações separadas para: aplicar no banco → publicar o servidor → publicar a web.
