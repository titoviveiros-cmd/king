-- CHECKPOINT 1 — ANTES DOS COSMÉTICOS (Entrega B). SOMENTE LEITURA: não grava nada.
-- Colar no SQL Editor e rodar. Esperado: UMA linha com `pronto_para_aplicar = true`.
-- Guardar a linha: o CHECKPOINT 3 (depois) mostra os mesmos números para comparar — linhas de progresso, XP, ledger e partidas iguais ou maiores (alguém pode jogar no meio), `credito_md5` e
-- `nivel_md5` iguais. Depois de um ROLLBACK dos cosméticos, este mesmo checkpoint volta a dar true.
-- Num banco sem o progresso, nada aqui dá erro: `pronto_para_aplicar` sai false e `detalhe` diz o que
-- falta (as tabelas que podem não existir só são lidas depois de conferidas).
with pre as (
       select to_regrole('king_progress_owner') is not null and to_regrole('king_server') is not null as papeis,
              to_regclass('public.players') is not null and to_regclass('public.progresso') is not null
                and to_regclass('public.xp_eventos') is not null and to_regclass('king_private.partidas') is not null
                and to_regprocedure('public.nivel_de(integer)') is not null
                and to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)') is not null
                and to_regclass('king_private.contas_excluidas') is not null
                and to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is not null        as progresso_inteiro,
              to_regclass('public.cosmeticos_equipados') is null
                and to_regprocedure('public.equipar_cosmetico(text,boolean)') is null
                and to_regprocedure('king_private.cosmeticos_da_sala(uuid[])') is null
                and to_regprocedure('king_private.nivel_do_cosmetico(text)') is null
                and to_regprocedure('public.equipar_toalha(text)') is null
                and to_regprocedure('king_private.toalhas_do_anfitriao(uuid)') is null
                and to_regprocedure('king_private.nivel_da_toalha(text)') is null
                and to_regprocedure('public.equipar_item(text,boolean)') is null
                and to_regprocedure('king_private.cosmeticos_dos_assentos(uuid[])') is null
                and to_regprocedure('king_private.nivel_do_item(text)') is null                      as cosmeticos_ausentes),
     aplic as (
       select case when to_regrole('king_progress_owner') is not null then
                pg_has_role(current_user, 'king_progress_owner', 'MEMBER')
                and pg_has_role(current_user, 'king_progress_owner', 'USAGE')
                and pg_has_role(current_user, 'king_progress_owner', 'SET') end                       as herda,
              case when to_regrole('king_progress_owner') is not null and to_regrole('king_server') is not null then
                not pg_has_role('king_server', 'king_progress_owner', 'MEMBER') end                   as servidor_fora),
     num as (
       select case when (select progresso_inteiro from pre) then query_to_xml(
                'select (select count(*) from public.progresso) as linhas,
                        (select coalesce(sum(xp_total), 0) from public.progresso) as xp,
                        (select count(*) from public.xp_eventos) as lancamentos,
                        (select coalesce(sum(xp_delta), 0) from public.xp_eventos) as ledger,
                        (select count(*) from king_private.partidas) as partidas', false, true, '') end as x)
select (select papeis and progresso_inteiro and cosmeticos_ausentes from pre)
         and coalesce((select herda and servidor_fora from aplic), false)                            as pronto_para_aplicar,
       (select row_to_json(pre)::text from pre)                                                      as detalhe,
       current_user                                                                                  as aplicador,
       (select herda from aplic)                                                                     as aplicador_herda_o_dono,
       (select servidor_fora from aplic)                                                             as servidor_fora_do_dono,
       current_setting('server_version')                                                             as versao_postgres,
       (select (xpath('/row/linhas/text()', x))[1]::text::bigint from num)                          as linhas_de_progresso,
       (select (xpath('/row/xp/text()', x))[1]::text::bigint from num)                              as xp_total,
       (select (xpath('/row/lancamentos/text()', x))[1]::text::bigint from num)                     as lancamentos,
       (select (xpath('/row/ledger/text()', x))[1]::text::bigint from num)                          as xp_no_ledger,
       (select (xpath('/row/partidas/text()', x))[1]::text::bigint from num)                        as partidas,
       (select md5(p.prosrc) from pg_proc as p
         where p.oid = to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)')) as credito_md5,
       (select md5(p.prosrc) from pg_proc as p where p.oid = to_regprocedure('public.nivel_de(integer)')) as nivel_md5,
       (select coalesce(n.nspacl::text, '(padrão)') from pg_namespace as n where n.nspname = 'public') as schema_public_acl;
