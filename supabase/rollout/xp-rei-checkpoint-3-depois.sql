-- CHECKPOINT 3 — DEPOIS DA PENALIDADE DO REI (Entrega C). SOMENTE LEITURA: não grava nada.
-- Colar no SQL Editor e rodar. Esperado: UMA linha com `tudo_certo = true`, e os números do progresso
-- iguais ou maiores que os do CHECKPOINT 1 (`credito_v1_md5`, `regra_v1_md5` e `schema_public_acl` iguais).
-- Logo depois do rollout, `composicoes` = 0 e `partidas_v2` = 0: a regra 2 só começa com o servidor novo.
-- Num banco sem a Entrega C, nada aqui dá erro: `tudo_certo` sai false e `detalhe` diz o que falta.
with o as (select to_regclass('public.xp_composicao')                                                                    as t,
                  to_regprocedure('king_private.xp_da_regra_v2(smallint,boolean,boolean,integer,boolean)')               as regra,
                  to_regprocedure('king_private.creditar_partida_v2(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)') as porta,
                  to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)')    as porta_v1),
     d as (
       select o.t is not null and o.regra is not null and o.porta is not null and o.porta_v1 is not null             as objetos,
              coalesce((select c.relrowsecurity and pg_get_userbyid(c.relowner) = 'king_progress_owner'
                          from pg_class as c where c.oid = o.t), false)                                    as tabela_com_rls_e_dono,
              coalesce((select count(*) = 1 from pg_policy as p where p.polrelid = o.t), false)            as uma_politica,
              coalesce((select bool_and(pg_get_userbyid(p.proowner) = 'king_progress_owner'
                                        and p.proconfig = array['search_path=""'])
                          from pg_proc as p where p.oid in (o.regra, o.porta)), false)                     as funcoes_do_dono_fechadas,
              coalesce(has_table_privilege('authenticated', o.t, 'select')
                       and not has_table_privilege('authenticated', o.t, 'insert, update, delete, truncate')
                       and not has_table_privilege('anon', o.t, 'select, insert, update, delete')
                       and not has_table_privilege('service_role', o.t, 'select, insert, update, delete')
                       and not has_table_privilege('king_server', o.t, 'select, insert, update, delete'), false) as tabela_so_leitura_do_cliente,
              coalesce(has_function_privilege('king_server', o.porta, 'execute')
                       and has_function_privilege('king_server', o.porta_v1, 'execute')
                       and not has_function_privilege('authenticated', o.porta, 'execute')
                       and not has_function_privilege('anon', o.porta, 'execute')
                       and not has_function_privilege('service_role', o.porta, 'execute'), false)     as so_o_servidor_credita,
              coalesce(not has_function_privilege('authenticated', o.regra, 'execute')
                       and not has_function_privilege('king_server', o.regra, 'execute'), false)       as regra_fechada,
              coalesce(not pg_has_role('king_server', 'king_progress_owner', 'MEMBER'), false)         as servidor_fora_do_dono
         from o),
     num as (
       select case when (select objetos from d) then query_to_xml(
                'select (select count(*) from public.xp_composicao) as composicoes,
                        (select count(*) from public.progresso) as linhas,
                        (select coalesce(sum(xp_total), 0) from public.progresso) as xp,
                        (select count(*) from public.xp_eventos) as lancamentos,
                        (select coalesce(sum(xp_delta), 0) from public.xp_eventos) as ledger,
                        (select count(*) from king_private.partidas) as partidas,
                        (select count(*) from king_private.partidas where versao_regra <> 1) as fora_da_v1', false, true, '') end as x)
select (select objetos and tabela_com_rls_e_dono and uma_politica and funcoes_do_dono_fechadas and tabela_so_leitura_do_cliente
               and so_o_servidor_credita and regra_fechada and servidor_fora_do_dono from d)              as tudo_certo,
       (select row_to_json(d)::text from d)                                                          as detalhe,
       (select (xpath('/row/composicoes/text()', x))[1]::text::bigint from num)                     as composicoes,
       (select (xpath('/row/linhas/text()', x))[1]::text::bigint from num)                          as linhas_de_progresso,
       (select (xpath('/row/xp/text()', x))[1]::text::bigint from num)                              as xp_total,
       (select (xpath('/row/lancamentos/text()', x))[1]::text::bigint from num)                     as lancamentos,
       (select (xpath('/row/ledger/text()', x))[1]::text::bigint from num)                          as xp_no_ledger,
       (select (xpath('/row/partidas/text()', x))[1]::text::bigint from num)                        as partidas,
       (select (xpath('/row/fora_da_v1/text()', x))[1]::text::bigint from num)                      as partidas_fora_da_v1,
       (select md5(p.prosrc) from pg_proc as p
         where p.oid = to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)')) as credito_v1_md5,
       (select md5(p.prosrc) from pg_proc as p
         where p.oid = to_regprocedure('king_private.xp_da_regra(smallint,boolean,boolean,integer)')) as regra_v1_md5,
       (select coalesce(n.nspacl::text, '(padrão)') from pg_namespace as n where n.nspname = 'public') as schema_public_acl;
