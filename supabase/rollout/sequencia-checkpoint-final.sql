-- FASE 6 — CHECKPOINT FINAL. SOMENTE LEITURA: não grava nada.
-- É o CHECKPOINT 3 (supabase/rollout/sequencia-checkpoint-3-depois.sql) relido depois das partidas
-- reais, mais o ESPERADO derivado do próprio ledger — nenhum número fixo. Esperado:
--   tudo_certo = true · progresso_divergente_do_ledger = 0 · retrato_divergente_do_ledger = 0
--   xp_total = xp_no_ledger · lancamentos_antes_do_marco = ultimo_evento_anterior
--   lancamentos = lancamentos_antes_do_marco + lancamentos_depois_do_marco
--   jogadores_com_sequencia = jogadores_que_devem_ter_sequencia
with m as (select * from king_private.sequencia_inicio),
     novos as (
       select e.player_id, e.partida_id, e.xp_delta, e.motivo, q.humanos, q.iniciada_em, q.terminada_em
         from public.xp_eventos as e
         join king_private.partidas as q on q.id = e.partida_id
        where e.id > (select ultimo_evento_anterior from m)),
     qualificados as (
       select * from novos
        where xp_delta > 0 and motivo = 'partida_concluida' and humanos >= 2
          and iniciada_em >= (select partidas_a_partir_de from m))
select ((select count(*) from m) = 1
        and (select partidas_a_partir_de = aplicado_em + interval '5 minutes' from m)
        and exists (select 1 from pg_trigger where tgname = 'xp_eventos_sequencia' and tgenabled = 'O')
        and (select count(*) from pg_trigger
              where tgrelid = 'king_private.sequencia_inicio'::regclass and not tgisinternal and tgenabled = 'O') = 2
        and not has_table_privilege('anon', 'public.meu_progresso', 'SELECT')
        and has_table_privilege('authenticated', 'public.meu_progresso', 'SELECT')
        and not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role', 'king_server']) as r (papel),
                                      unnest(array['public.progresso', 'public.xp_eventos', 'king_private.sequencia_inicio']) as t (tabela),
                                      unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p (privilegio)
                         where to_regrole(r.papel) is not null and has_table_privilege(r.papel, t.tabela, p.privilegio))
        and has_function_privilege('king_server',
              'king_private.creditar_partida(uuid, timestamptz, timestamptz, smallint, smallint, jsonb)', 'EXECUTE')
       )                                                                 as tudo_certo,
       (select aplicado_em from m)                                       as aplicado_em,
       (select partidas_a_partir_de from m)                              as partidas_a_partir_de,
       (select ultimo_evento_anterior from m)                            as ultimo_evento_anterior,
       (select count(*) from public.progresso
         where sequencia_atual <> 0 or sequencia_recorde <> 0 or sequencia_ultimo_dia is not null) as jogadores_com_sequencia,
       (select count(*) from public.progresso)                           as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)         as xp_total,
       (select count(*) from public.xp_eventos)                          as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos)        as xp_no_ledger,
       (select count(*) from public.progresso g
         where g.xp_total <> (select coalesce(sum(e.xp_delta), 0) from public.xp_eventos e where e.player_id = g.player_id))
                                                                         as progresso_divergente_do_ledger,
       (select count(*) from public.progresso as g
          cross join lateral king_private.sequencia_de(g.player_id) as s
         where (g.sequencia_atual, g.sequencia_ultimo_dia, g.sequencia_partida)
               is distinct from (s.atual, s.ultimo_dia, s.partida)
            or g.sequencia_recorde < s.recorde)                          as retrato_divergente_do_ledger,
       (select count(*) from public.xp_eventos
         where id <= (select ultimo_evento_anterior from m))             as lancamentos_antes_do_marco,
       (select count(*) from novos)                                      as lancamentos_depois_do_marco,
       (select count(distinct partida_id) from novos)                    as partidas_depois_do_marco,
       (select count(distinct player_id) from qualificados)              as jogadores_que_devem_ter_sequencia,
       (select string_agg(distinct to_char(terminada_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'), ', ')
          from qualificados)                                             as dias_com_xp_sp,
       (select max(sequencia_atual) from public.progresso)               as maior_sequencia_gravada,
       (select max(sequencia_recorde) from public.progresso)             as maior_recorde_gravado;
