-- ROLLBACK DA TOALHA DA MESA (20261118120000_cosmeticos_mesa.sql).
--
-- Remove exatamente o que a migração criou: duas funções, o catálogo das toalhas e a coluna
-- `toalha`. NÃO toca em `progresso`, `xp_eventos`, `players`, no crédito nem nas outras escolhas
-- (moldura, baralho, reação). A única coisa perdida é a toalha escolhida; reaplicar a migração volta
-- todo mundo para a Noite Imperial, com as toalhas liberadas pelo nível de sempre.
--
-- ORDEM AO DESFAZER: primeiro a web e o servidor voltam (os dois toleram a ausência: sem a coluna, a
-- vitrine não mostra toalhas e a sala fica nas mesas livres), depois este arquivo. Para desfazer TUDO
-- dos cosméticos, este arquivo vem ANTES do rollback da parte 1.

begin;

set role king_progress_owner;

drop function public.equipar_toalha(text);
drop function king_private.toalhas_do_anfitriao(uuid);
drop function king_private.nivel_da_toalha(text);
alter table public.cosmeticos_equipados drop column toalha;

reset role;

commit;
