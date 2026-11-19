-- CHECKPOINT 3 — DEPOIS DOS COSMÉTICOS (Entrega B). SOMENTE LEITURA: não grava nada.
-- Colar no SQL Editor e rodar. Esperado: UMA linha com `tudo_certo = true`, e os números do progresso
-- iguais ou maiores que os do CHECKPOINT 1 (`credito_md5`, `nivel_md5` e `schema_public_acl` iguais).
-- Num banco sem os cosméticos, nada aqui dá erro: `tudo_certo` sai false e `detalhe` diz o que falta.
with o as (select to_regclass('public.cosmeticos_equipados')                      as t,
                  to_regprocedure('public.equipar_cosmetico(text,boolean)')         as equipar,
                  to_regprocedure('king_private.cosmeticos_da_sala(uuid[])')        as sala,
                  to_regprocedure('king_private.nivel_do_cosmetico(text)')          as nivel,
                  to_regprocedure('public.equipar_toalha(text)')                    as toalha,
                  to_regprocedure('king_private.toalhas_do_anfitriao(uuid)')        as mesa,
                  to_regprocedure('king_private.nivel_da_toalha(text)')             as nivel_t,
                  to_regprocedure('public.equipar_item(text,boolean)')              as item,
                  to_regprocedure('king_private.cosmeticos_dos_assentos(uuid[])')   as assent,
                  to_regprocedure('king_private.nivel_do_item(text)')               as nivel_i),
     d as (
       select o.t is not null and o.equipar is not null and o.sala is not null and o.nivel is not null
              and o.toalha is not null and o.mesa is not null and o.nivel_t is not null
              and o.item is not null and o.assent is not null and o.nivel_i is not null
              and exists (select 1 from pg_attribute as a where a.attrelid = o.t and a.attname = 'toalha' and not a.attisdropped)
              and (select count(*) = 3 from pg_attribute as a where a.attrelid = o.t and not a.attisdropped
                    and a.attname in ('moldura', 'baralho', 'reacoes'))                                      as objetos,
              coalesce((select c.relrowsecurity and pg_get_userbyid(c.relowner) = 'king_progress_owner'
                          from pg_class as c where c.oid = o.t), false)                                    as tabela_com_rls_e_dono,
              coalesce((select count(*) = 1 from pg_policy as p where p.polrelid = o.t), false)            as uma_politica,
              coalesce((select bool_and(pg_get_userbyid(p.proowner) = 'king_progress_owner'
                                        and p.proconfig = array['search_path=""'])
                          from pg_proc as p where p.oid in (o.equipar, o.sala, o.nivel, o.toalha, o.mesa, o.nivel_t,
                                                            o.item, o.assent, o.nivel_i)), false) as funcoes_do_dono_fechadas,
              coalesce(has_table_privilege('authenticated', o.t, 'select')
                       and not has_table_privilege('authenticated', o.t, 'insert, update, delete, truncate')
                       and not has_table_privilege('anon', o.t, 'select, insert, update, delete')
                       and not has_table_privilege('service_role', o.t, 'select, insert, update, delete')
                       and not has_table_privilege('king_server', o.t, 'select, insert, update, delete'), false) as tabela_so_leitura_do_cliente,
              coalesce(has_function_privilege('authenticated', o.equipar, 'execute')
                       and not has_function_privilege('anon', o.equipar, 'execute')
                       and not has_function_privilege('king_server', o.equipar, 'execute')
                       and has_function_privilege('authenticated', o.toalha, 'execute')
                       and not has_function_privilege('anon', o.toalha, 'execute')
                       and not has_function_privilege('king_server', o.toalha, 'execute')
                       and has_function_privilege('authenticated', o.item, 'execute')
                       and not has_function_privilege('anon', o.item, 'execute')
                       and not has_function_privilege('king_server', o.item, 'execute'), false)        as cliente_equipa,
              coalesce(has_function_privilege('king_server', o.sala, 'execute')
                       and not has_function_privilege('authenticated', o.sala, 'execute')
                       and not has_function_privilege('anon', o.sala, 'execute')
                       and not has_function_privilege('service_role', o.sala, 'execute')
                       and has_function_privilege('king_server', o.mesa, 'execute')
                       and not has_function_privilege('authenticated', o.mesa, 'execute')
                       and not has_function_privilege('anon', o.mesa, 'execute')
                       and not has_function_privilege('service_role', o.mesa, 'execute')
                       and has_function_privilege('king_server', o.assent, 'execute')
                       and not has_function_privilege('authenticated', o.assent, 'execute')
                       and not has_function_privilege('anon', o.assent, 'execute')
                       and not has_function_privilege('service_role', o.assent, 'execute'), false)     as so_o_servidor_le_a_sala,
              coalesce(not has_function_privilege('authenticated', o.nivel, 'execute')
                       and not has_function_privilege('king_server', o.nivel, 'execute')
                       and not has_function_privilege('authenticated', o.nivel_t, 'execute')
                       and not has_function_privilege('king_server', o.nivel_t, 'execute')
                       and not has_function_privilege('authenticated', o.nivel_i, 'execute')
                       and not has_function_privilege('king_server', o.nivel_i, 'execute'), false)     as catalogo_fechado,
              coalesce(not pg_has_role('king_server', 'king_progress_owner', 'MEMBER'), false)         as servidor_fora_do_dono
         from o),
     num as (
       select case when (select objetos from d) then query_to_xml(
                'select (select count(*) from public.cosmeticos_equipados) as escolhas,
                        (select count(*) from public.progresso) as linhas,
                        (select coalesce(sum(xp_total), 0) from public.progresso) as xp,
                        (select count(*) from public.xp_eventos) as lancamentos,
                        (select coalesce(sum(xp_delta), 0) from public.xp_eventos) as ledger,
                        (select count(*) from king_private.partidas) as partidas', false, true, '') end as x)
select (select objetos and tabela_com_rls_e_dono and uma_politica and funcoes_do_dono_fechadas and tabela_so_leitura_do_cliente
               and cliente_equipa and so_o_servidor_le_a_sala and catalogo_fechado and servidor_fora_do_dono from d) as tudo_certo,
       (select row_to_json(d)::text from d)                                                          as detalhe,
       (select (xpath('/row/escolhas/text()', x))[1]::text::bigint from num)                        as escolhas_gravadas,
       (select (xpath('/row/linhas/text()', x))[1]::text::bigint from num)                          as linhas_de_progresso,
       (select (xpath('/row/xp/text()', x))[1]::text::bigint from num)                              as xp_total,
       (select (xpath('/row/lancamentos/text()', x))[1]::text::bigint from num)                     as lancamentos,
       (select (xpath('/row/ledger/text()', x))[1]::text::bigint from num)                          as xp_no_ledger,
       (select (xpath('/row/partidas/text()', x))[1]::text::bigint from num)                        as partidas,
       (select md5(p.prosrc) from pg_proc as p
         where p.oid = to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)')) as credito_md5,
       (select md5(p.prosrc) from pg_proc as p where p.oid = to_regprocedure('public.nivel_de(integer)')) as nivel_md5,
       (select coalesce(n.nspacl::text, '(padrão)') from pg_namespace as n where n.nspname = 'public') as schema_public_acl;
