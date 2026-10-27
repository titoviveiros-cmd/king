-- CHECKPOINT 1 — ANTES DO PASSO D2 (retenção das lápides, E-2). SOMENTE LEITURA: não grava nada.
-- Colar no SQL Editor e rodar. Esperado: UMA linha com `pronto_para_aplicar = true`.
-- Guardar a linha: o CHECKPOINT 3 (depois) mostra os mesmos números para comparar — `credito_md5` igual,
-- `lapides` igual (ou maior, se alguém excluiu a conta no meio), `vencidas_720h` igual (ou maior, só pelo
-- tempo que passou), ledger igual ou maior. `pronto_para_aplicar` também exige que ninguém da API nem o
-- servidor leia a lápide e que não haja lápide de conta VIVA (players apagado à mão: ver §22.11).
-- Num banco sem o passo D, nada aqui dá erro: `pronto_para_aplicar` sai false e `passo_d_detalhe` diz o
-- que falta (as tabelas que podem não existir são lidas só depois de conferidas).
with credito as (select to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)') as f),
     lapide  as (select to_regprocedure('king_private.registrar_conta_excluida()') as f),
     d as (
       select to_regclass('king_private.contas_excluidas') is not null                     as tabela_da_lapide,
              (select f from lapide) is not null                                            as funcao_da_lapide,
              exists (select 1 from pg_trigger as t
                       where t.tgname = 'players_lapide_da_exclusao' and t.tgrelid = 'public.players'::regclass
                         and t.tgenabled = 'O' and t.tgfoid = (select f from lapide))       as gatilho_ligado,
              coalesce(position('contas_excluidas' in pg_get_functiondef((select f from credito))) > 0, false) as credito_do_passo_d,
              coalesce(has_function_privilege('king_server', (select f from credito), 'execute'), false)      as servidor_executa_credito),
     e2 as (
       select to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is null        as sem_funcao_de_expurgo,
              to_regclass('king_private.expurgo_das_lapides') is null                       as sem_estado_do_expurgo,
              coalesce(position('greatest' in pg_get_functiondef((select f from lapide))) = 0, false) as lapide_no_texto_do_d),
     lap as (
       select case when to_regclass('king_private.contas_excluidas') is not null then query_to_xml(
                'select count(*) as lapides,
                        count(*) filter (where excluida_em < now() - interval ''720 hours'') as vencidas,
                        min(excluida_em) as mais_antiga,
                        coalesce(bool_or(true), false) as alguma
                   from king_private.contas_excluidas', false, true, '') end as x),
     acesso as (
       select case when to_regclass('king_private.contas_excluidas') is not null then
                (select bool_or(has_table_privilege(r.papel, 'king_private.contas_excluidas',
                                'select, insert, update, delete, truncate, references, trigger'))
                   from unnest(array['public', 'anon', 'authenticated', 'service_role', 'king_server']) as r (papel)) end as alguem),
     viva as (
       select case when to_regclass('king_private.contas_excluidas') is not null
                    and has_schema_privilege('auth', 'usage') and has_table_privilege('auth.users', 'select') then
                (xpath('/row/n/text()', query_to_xml(
                  'select count(*) as n from king_private.contas_excluidas as x join auth.users as u on u.id = x.player_id',
                  false, true, '')))[1]::text::bigint end as n)
select ((select tabela_da_lapide and funcao_da_lapide and gatilho_ligado and credito_do_passo_d and servidor_executa_credito from d)
        and (select sem_funcao_de_expurgo and sem_estado_do_expurgo and lapide_no_texto_do_d from e2)
        and pg_has_role(current_user, 'king_progress_owner', 'MEMBER')
        and pg_has_role(current_user, 'king_progress_owner', 'USAGE')
        and not pg_has_role('king_server', 'king_progress_owner', 'MEMBER')
        and (select alguem from acesso) is false
        and coalesce((select n from viva), 0) = 0)                                           as pronto_para_aplicar,
       -- o passo D, inteiro
       (select tabela_da_lapide and funcao_da_lapide and gatilho_ligado and credito_do_passo_d and servidor_executa_credito from d)
                                                                                            as passo_d_inteiro,
       (select row_to_json(d)::text from d)                                                 as passo_d_detalhe,
       -- nenhum pedaço da E-2
       (select sem_funcao_de_expurgo and sem_estado_do_expurgo and lapide_no_texto_do_d from e2) as e2_ausente,
       (select row_to_json(e2)::text from e2)                                               as e2_detalhe,
       -- quem aplica e quem executa
       current_user                                                                         as aplicador,
       pg_has_role(current_user, 'king_progress_owner', 'MEMBER')
         and pg_has_role(current_user, 'king_progress_owner', 'USAGE')                      as aplicador_herda_o_dono,
       not pg_has_role('king_server', 'king_progress_owner', 'MEMBER')                      as servidor_fora_do_dono,
       current_setting('server_version')                                                    as versao_postgres,
       -- as lápides de hoje (a instalação não pode tirar nenhuma, nem as vencidas)
       (select (xpath('/row/lapides/text()', x))[1]::text::bigint from lap)                as lapides,
       (select (xpath('/row/vencidas/text()', x))[1]::text::bigint from lap)               as vencidas_720h,
       (select (xpath('/row/mais_antiga/text()', x))[1]::text::timestamptz from lap)       as mais_antiga,
       -- anomalia (§22.11): lápide de conta VIVA = alguém apagou public.players à mão; precisa dar 0
       (select n from viva)                                                                 as lapide_de_conta_viva,
       -- rollback: o pré-E do passo D só vale sem lápide nenhuma (e sem E-2)
       (select (xpath('/row/alguma/text()', x))[1]::text = 'false' from lap)               as rollback_pre_e_do_d_ainda_vale,
       -- funções e privilégios de hoje
       (select md5(p.prosrc) from pg_proc as p where p.oid = (select f from credito))       as credito_md5,
       (select p.proacl::text from pg_proc as p where p.oid = (select f from credito))      as credito_acl,
       (select pg_get_userbyid(p.proowner) || ' definer=' || p.prosecdef || ' ' || coalesce(p.proconfig::text, '')
          from pg_proc as p where p.oid = (select f from lapide))                          as funcao_da_lapide,
       (select p.proacl::text from pg_proc as p where p.oid = (select f from lapide))       as funcao_da_lapide_acl,
       (select coalesce(c.relacl::text, '(padrão)') || ' rls=' || c.relrowsecurity
          from pg_class as c where c.oid = to_regclass('king_private.contas_excluidas'))   as tabela_da_lapide_acl,
       (select coalesce(n.nspacl::text, '(padrão)') from pg_namespace as n where n.nspname = 'king_private') as schema_king_private_acl,
       (select bool_or(has_function_privilege(r.papel, (select f from credito), 'execute'))
          from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r (papel)) as api_executa_credito,
       (select alguem from acesso)                                                          as alguem_le_ou_escreve_lapide,
       -- XP e ledger (a migração não mexe neles)
       (select count(*) from public.progresso)                                              as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)                            as xp_total,
       (select count(*) from public.xp_eventos)                                             as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos)                           as xp_no_ledger,
       (select count(*) from king_private.partidas)                                         as partidas,
       (select count(*) from public.progresso as g
         where g.xp_total <> (select coalesce(sum(e.xp_delta), 0) from public.xp_eventos as e where e.player_id = g.player_id))
                                                                                            as progresso_divergente_do_ledger,
       (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), '')
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private'))                    as security_definer;
