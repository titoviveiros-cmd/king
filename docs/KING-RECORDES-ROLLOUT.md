# KING — Roteiro de ativação dos Recordes & XP (Entrega D)

> **Dependência:** este trabalho está **empilhado sobre o PR #12** (`feat/cosmeticos-catalogo`), que está
> sobre o #11, que está sobre o #10. A ordem de merge é #10 → #11 → #12 → este. A **migração** dos
> recordes não depende dos cosméticos (só do progresso); o empilhamento é por causa da web, que usa o
> catálogo da Coroa para mostrar o próximo desbloqueio.

## Os cinco recursos

| # | Recurso | De onde vêm os dados |
|---|---|---|
| 1 | **Meus Recordes** — Top 3 das maiores pontuações finais, Solo e Online separados | Solo: este aparelho (`king:recordes:solo`, versionado, máx. 3). Online: `public.placares_online`, gravada **só** pelo servidor |
| 2 | **Minha evolução** — nível, XP total, XP do nível, quanto falta, recorde de sequência | `meu_progresso` (o mesmo de sempre) |
| 3 | **Próximo desbloqueio** — o próximo item da Coroa, o nível e o progresso real até ele | catálogo da Coroa + `public.xp_por_nivel` (a mesma `xp_para_nivel` do banco) |
| 4 | **Últimas partidas online** — data, colocação, XP concedido (últimas 5) | `xp_eventos` (RLS: só as próprias) |
| 5 | **NOVO RECORDE!** — celebração curta no Placar Final, uma vez por resultado | Solo: o Top 3 do aparelho. Online: o Top 3 relido depois do crédito confirmado |

## Regras de recorde
- Só partida **completa de 10 mãos**. Solo: a partida que a Home começou — `?seed=`/`?mao=` (depuração)
  e partidas montadas por teste **não contam**. Online: só quem foi **creditado com XP > 0** naquela
  partida (abandono e partida sobreposta ficam de fora; a posição vem do ledger).
- Ordem do Top 3 (igual no banco e no app): maior pontuação → conquista mais antiga → id.
- Uma partida = um registro (chave `(partida_id, player_id)` no banco; id da partida no aparelho).
- Online começa a contar **a partir da ativação**: partidas antigas não têm pontuação gravada, e nada é
  inventado.
- O cliente **nunca** informa pontuação: o servidor manda a pontuação do motor (`MatchState.cumulative`).

## Como o servidor grava
Na entrega do crédito (outbox, retry, idempotência e disjuntor de sempre), o repositório abre **uma
transação**: `creditar_partida` (contrato do XP **inalterado**) e, num `SAVEPOINT`,
`king_private.registrar_placares`. Se o banco recusar o placar (migração ausente, dado fora da regra),
desfaz **só o placar** e o XP é gravado; falha de conexão, concorrência ou autenticação volta tudo e o
retry cuida. O resultado do outbox ganhou `pontos` **opcional** por humano: o outbox antigo continua
válido.

**Atenção (risco documentado):** um servidor ANTERIOR a esta entrega rejeita pendências do outbox que
tenham `pontos`. Só importa se o servidor for revertido com pendências no outbox (normalmente vazio).
Antes de reverter o servidor, conferir que o outbox está vazio.

## Ordem segura: banco → servidor → web
1. **Banco (SQL Editor, com autorização):** colar `supabase/rollout/recordes-aplicar.sql` inteiro, uma
   vez. Só está aplicado se a última tela mostrar `RECORDES (ENTREGA D) APLICADA E CONFERIDA`.
2. **Servidor:** deploy transacional de sempre. Nenhuma variável nova.
3. **Web:** fast-forward da `main`.

Rollback na ordem inversa; banco: `supabase/rollback/20261120120000_recordes_rollback.sql` (apaga só os
placares online; XP, ledger, partidas e cosméticos intactos; o Top 3 Solo vive no aparelho).

Compatibilidade: sem mudança no protocolo multiplayer — o Android 0.1.1 não vê diferença nenhuma.

## Provas locais
- `npm run test:recordes-sql` (Postgres 17 real, descartável): **17/17 + 13 mutações**; R4 com 9
  defeitos que abortam sem gravar nada; S1–S3 com o **repositório compilado do servidor**.
- Unidade (web e servidor) e e2e (`tests-progresso/recordes.spec.ts`, inclusive uma partida solo inteira).
