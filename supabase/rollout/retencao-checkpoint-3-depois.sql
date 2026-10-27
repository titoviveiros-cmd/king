-- CHECKPOINT 3 — LOGO DEPOIS DO PASSO D2 (retenção das lápides, E-2). SOMENTE LEITURA: não grava nada.
-- O arquivo do rollout já conferiu tudo isto antes do COMMIT; esta é a releitura, depois de gravado,
-- para o registro. Esperado: UMA linha com `tudo_certo = true` e, comparando com o CHECKPOINT 1:
-- `credito_md5` igual, `lapides` igual (ou maior, se alguém excluiu a conta no meio: NENHUMA sai antes
-- do passo S), `vencidas_720h` igual (ou maior, só pelo tempo que passou), ledger igual ou maior e
-- `progresso_divergente_do_ledger` igual. `transacao_aberta = true` = o arquivo do D2 não chegou ao COMMIT
-- nesta sessão: NADA está gravado — rodar `rollback;` sozinho e colar o arquivo INTEIRO de novo.
-- Vale até o passo S: depois dele, `rodadas` e `ultima_rodada` andam (ver §22.11 para a conferência
-- de operação). Num banco sem a E-2, nada aqui dá erro: `tudo_certo` sai false.
with f as (select to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') as f),
     credito as (select to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)') as f),
     lapide  as (select to_regprocedure('king_private.registrar_conta_excluida()') as f),
     porta as (
       select pg_get_userbyid(p.proowner) = 'king_progress_owner'                           as dono_dedicado,
              p.prosecdef                                                                   as security_definer,
              p.proconfig is not distinct from array['search_path=""', 'lock_timeout=5s']   as search_path_vazio_e_trava_5s,
              pg_get_function_result(p.oid) = 'TABLE(removidas integer, retidas integer)'   as devolve_so_contagens,
              position($q$now() - interval '720 hours'$q$ in p.prosrc) > 0                  as prazo_720h,
              p.proacl::text is not distinct from '{king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' as acl_exata
         from pg_proc as p where p.oid = (select f from f)),
     papeis as (
       select bool_or(coalesce(has_function_privilege(r.papel, (select f from f), 'execute'), false))      as api_executa_expurgo,
              bool_or(coalesce(has_function_privilege(r.papel, (select f from lapide), 'execute'), false)) as api_executa_lapide
         from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r (papel)),
     tabelas as (
       select case when to_regclass('king_private.contas_excluidas') is not null
                    and to_regclass('king_private.expurgo_das_lapides') is not null then
                (select bool_or(has_table_privilege(r.papel, 'king_private.contas_excluidas', 'select, insert, update, delete, truncate, references, trigger')
                                or has_table_privilege(r.papel, 'king_private.expurgo_das_lapides', 'select, insert, update, delete, truncate, references, trigger'))
                   from unnest(array['public', 'anon', 'authenticated', 'service_role', 'king_server']) as r (papel)) end
                                                                                            as alguem_le_ou_escreve),
     est as (
       select case when to_regclass('king_private.expurgo_das_lapides') is not null then query_to_xml(
                'select count(*) as linhas,
                        coalesce(bool_and(outbox is null and rodadas = 0 and lapides_removidas = 0 and ultima_rodada is null), false) as limpo,
                        coalesce(max(rodadas), 0) as rodadas,
                        coalesce(max(lapides_removidas), 0) as removidas,
                        coalesce(bool_or(outbox is not null), false) as marcador_registrado,
                        max(ultima_rodada) as ultima_rodada
                   from king_private.expurgo_das_lapides', false, true, '') end as x),
     estado as (
       select (xpath('/row/linhas/text()', x))[1]::text::bigint                 as linhas,
              (xpath('/row/limpo/text()', x))[1]::text = 'true'                  as limpo,
              (xpath('/row/rodadas/text()', x))[1]::text::bigint                as rodadas,
              (xpath('/row/removidas/text()', x))[1]::text::bigint              as removidas,
              (xpath('/row/marcador_registrado/text()', x))[1]::text = 'true'    as marcador_registrado,
              (xpath('/row/ultima_rodada/text()', x))[1]::text::timestamptz     as ultima_rodada
         from est),
     lap as (
       select case when to_regclass('king_private.contas_excluidas') is not null then query_to_xml(
                'select count(*) as lapides,
                        count(*) filter (where excluida_em < now() - interval ''720 hours'') as vencidas,
                        min(excluida_em) as mais_antiga,
                        (select relrowsecurity from pg_class where oid = ''king_private.contas_excluidas''::regclass) as rls
                   from king_private.contas_excluidas', false, true, '') end as x),
     d as (
       select exists (select 1 from pg_trigger as t
                       where t.tgname = 'players_lapide_da_exclusao' and t.tgrelid = 'public.players'::regclass
                         and t.tgenabled = 'O' and t.tgfoid = (select f from lapide))       as gatilho_ligado,
              coalesce((select (xpath('/row/rls/text()', x))[1]::text = 'true' from lap), false) as lapide_com_rls,
              coalesce(position('greatest(x.excluida_em, excluded.excluida_em)' in pg_get_functiondef((select f from lapide))) > 0, false)
                                                                                            as lapide_guarda_a_mais_recente,
              coalesce((select pg_get_userbyid(p.proowner) = 'king_progress_owner' and p.prosecdef and p.proconfig = array['search_path=""']
                          from pg_proc as p where p.oid = (select f from lapide)), false)   as funcao_da_lapide_presa,
              coalesce(position('contas_excluidas' in pg_get_functiondef((select f from credito))) > 0, false) as credito_do_passo_d,
              coalesce(has_function_privilege('king_server', (select f from credito), 'execute'), false)      as servidor_executa_credito)
select coalesce((select dono_dedicado and security_definer and search_path_vazio_e_trava_5s and devolve_so_contagens
                        and prazo_720h and acl_exata from porta)
                and not (select api_executa_expurgo or api_executa_lapide from papeis)
                and not (select alguem_le_ou_escreve from tabelas)
                and has_function_privilege('king_server', (select f from f), 'execute')
                and not pg_has_role('king_server', 'king_progress_owner', 'MEMBER')
                and (select linhas = 1 and limpo from estado)
                and (select gatilho_ligado and lapide_com_rls and lapide_guarda_a_mais_recente and funcao_da_lapide_presa
                        and credito_do_passo_d and servidor_executa_credito from d)
                and pg_current_xact_id_if_assigned() is null, false)                         as tudo_certo,
       pg_current_xact_id_if_assigned() is not null                                         as transacao_aberta,
       (select f from f) is not null                                                        as funcao_de_expurgo_existe,
       (select row_to_json(porta)::text from porta)                                         as funcao_de_expurgo,
       coalesce(has_function_privilege('king_server', (select f from f), 'execute'), false) as servidor_executa_expurgo,
       not pg_has_role('king_server', 'king_progress_owner', 'MEMBER')                      as servidor_fora_do_dono,
       (select row_to_json(papeis)::text from papeis)                                       as api,
       (select alguem_le_ou_escreve from tabelas)                                           as alguem_le_ou_escreve_lapide_ou_estado,
       (select row_to_json(estado)::text from estado)                                       as estado_do_expurgo,
       (select row_to_json(d)::text from d)                                                 as passo_d,
       -- as lápides: as mesmas do CHECKPOINT 1 (nenhuma sai antes do passo S)
       (select (xpath('/row/lapides/text()', x))[1]::text::bigint from lap)                as lapides,
       (select (xpath('/row/vencidas/text()', x))[1]::text::bigint from lap)               as vencidas_720h,
       (select (xpath('/row/mais_antiga/text()', x))[1]::text::timestamptz from lap)       as mais_antiga,
       -- rollback da E-2 agora: sem remoção nenhuma, ele tira também o estado e o pré-E do D volta a valer
       (select removidas = 0 from estado)                                                   as rollback_e2_tira_tambem_o_estado,
       (select md5(p.prosrc) from pg_proc as p where p.oid = (select f from credito))       as credito_md5,
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
