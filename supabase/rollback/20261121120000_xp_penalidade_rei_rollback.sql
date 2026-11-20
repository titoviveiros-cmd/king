-- ROLLBACK DA PENALIDADE DO REI (20261121120000_xp_penalidade_rei.sql).
--
-- Remove exatamente o que a migração criou: a porta `creditar_partida_v2`, a regra `xp_da_regra_v2` e a
-- tabela `xp_composicao`. NÃO toca em `progresso`, `xp_eventos`, `partidas`, `players`, na porta v1
-- (`creditar_partida`), na sequência, nos recordes nem nos cosméticos.
--
-- NADA É RECALCULADO: o XP creditado sob a regra 2 continua creditado (o ledger e o agregado ficam como
-- estão, e `partidas.versao_regra = 2` continua dizendo sob qual regra cada uma nasceu). Perde-se só o
-- DETALHAMENTO (bruto, penalidade, redução) — o Placar Final volta ao "+N XP" de sempre.
--
-- ORDEM AO DESFAZER: primeiro a web e o servidor voltam (ou não — os dois toleram a ausência: sem a v2, o
-- servidor novo recebe 42883 e credita pela v1; sem a tabela, a web nova mostra só o "+N XP"), depois
-- este arquivo. Com o servidor novo ainda no ar, as partidas seguintes são creditadas pela regra 1.

begin;

set local lock_timeout = '5s';
set role king_progress_owner;

drop function king_private.creditar_partida_v2(uuid, timestamptz, timestamptz, smallint, smallint, jsonb);
drop function king_private.xp_da_regra_v2(smallint, boolean, boolean, integer, boolean);
drop table public.xp_composicao;

reset role;

commit;
