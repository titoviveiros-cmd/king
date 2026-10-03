-- CHECKPOINT 1 — ANTES DA MIGRAÇÃO DA SEQUÊNCIA. SOMENTE LEITURA: não grava nada.
-- Colar no SQL Editor e rodar. Esperado: UMA linha com `pronto_para_aplicar = true`.
-- Guardar os números: o arquivo do rollout confere sozinho que XP e ledger não mudaram.
select (to_regclass('king_private.sequencia_inicio') is null
        and not exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'progresso' and column_name like 'sequencia%')
        and not exists (select 1 from pg_trigger where tgname = 'xp_eventos_sequencia')
        and to_regprocedure('public.dia_de_sao_paulo(timestamptz)') is null
        and to_regrole('king_progress_owner') is not null
        and to_regrole('king_server') is not null)                       as pronto_para_aplicar,
       to_regclass('king_private.sequencia_inicio') is not null          as marco_ja_existe,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'progresso' and column_name like 'sequencia%') as colunas_de_sequencia,
       (select count(*) from public.players)                             as jogadores,
       (select count(*) from public.progresso)                           as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)         as xp_total,
       (select count(*) from public.xp_eventos)                          as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos)        as xp_no_ledger,
       (select coalesce(max(id), 0) from public.xp_eventos)              as maior_lancamento,
       (select count(*) from king_private.partidas)                      as partidas,
       (select count(*) from public.progresso g
         where g.xp_total <> (select coalesce(sum(e.xp_delta), 0) from public.xp_eventos e where e.player_id = g.player_id))
                                                                         as progresso_divergente_do_ledger,
       (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
         where table_schema = 'public' and table_name = 'meu_progresso') as colunas_de_meu_progresso,
       (select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by n.nspname, p.proname), '')
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private'))  as security_definer,
       (select coalesce(string_agg(grantee || ':' || privilege_type, ', ' order by grantee, privilege_type), '')
          from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'xp_eventos')    as permissoes_no_ledger;
