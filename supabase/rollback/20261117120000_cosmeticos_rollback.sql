-- ROLLBACK DOS COSMÉTICOS (20261117120000_cosmeticos.sql).
--
-- Remove exatamente o que a migração criou: uma tabela e três funções. NÃO toca em `progresso`,
-- `xp_eventos`, `players` nem no crédito — o XP e o nível de todo mundo ficam exatamente como
-- estavam. A única coisa perdida é a ESCOLHA de quem tinha equipado algo; reaplicar a migração
-- devolve os itens desbloqueados (eles são derivados do nível), só que desequipados.
--
-- ORDEM DE IMPLANTAÇÃO AO DESFAZER: primeiro o front e o servidor voltam (ou ficam, porque os dois
-- já toleram a ausência da tabela: sem ela, nenhum cosmético aparece e a partida segue), depois
-- este arquivo.

begin;

set role king_progress_owner;

drop function public.equipar_cosmetico(text, boolean);
drop function king_private.cosmeticos_da_sala(uuid[]);
drop function king_private.nivel_do_cosmetico(text);
drop table public.cosmeticos_equipados;

reset role;

commit;
