-- ROLLBACK DOS RECORDES (20261120120000_recordes.sql).
--
-- Remove exatamente o que a migração criou: a tabela dos placares online, a porta do servidor e a view
-- do XP por nível. NÃO toca em `progresso`, `xp_eventos`, `partidas`, `players`, no crédito nem nos
-- cosméticos: o XP e o nível de todo mundo ficam exatamente como estavam. Perde-se só o histórico de
-- pontuações online (os recordes solo vivem no aparelho e não são afetados).
--
-- ORDEM AO DESFAZER: primeiro a web e o servidor voltam (os dois toleram a ausência: sem a tabela, a
-- tela de recordes mostra o online como indisponível, e o servidor grava o crédito sem o placar),
-- depois este arquivo.

begin;

set role king_progress_owner;

drop function king_private.registrar_placares(uuid, jsonb);
drop view public.xp_por_nivel;
drop table public.placares_online;

reset role;

commit;
