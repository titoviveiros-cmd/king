-- ═══ PARTE 1/3 — ANTES DA MIGRAÇÃO (na MESMA transação) ════════════════════════════════════
--
-- 1. TRAVA o progresso contra crédito: `creditar_partida` grava em `progresso` antes de lançar no
--    ledger, então nenhum crédito confirma enquanto esta transação existir (leitura continua
--    livre até o ALTER da migração). O retrato abaixo fica estável até a conferência.
-- 2. RETRATO do que a migração NÃO pode mudar, numa tabela temporária que some no commit.
-- 3. RECUSA rodar se a sequência já existir ou se faltarem os papéis do progresso.
lock table public.progresso in share row exclusive mode;

create temp table rollout_sequencia_antes on commit drop as
select (select count(*) from public.progresso)                    as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)  as xp_total,
       (select count(*) from public.xp_eventos)                   as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos) as xp_no_ledger,
       (select coalesce(max(id), 0) from public.xp_eventos)       as maior_lancamento,
       (select count(*) from king_private.partidas)               as partidas,
       (select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private'))  as security_definer;

do $$
begin
  if to_regclass('king_private.sequencia_inicio') is not null
     or exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'progresso' and column_name like 'sequencia%')
     or exists (select 1 from pg_trigger where tgname = 'xp_eventos_sequencia') then
    raise exception 'ROLLOUT ABORTADO (parte 1): a sequência já existe neste banco. Nada foi alterado.';
  end if;
  if to_regrole('king_progress_owner') is null or to_regrole('king_server') is null then
    raise exception 'ROLLOUT ABORTADO (parte 1): papéis do progresso ausentes. Nada foi alterado.';
  end if;
end $$;

-- ═══ PARTE 2/3 — A MIGRAÇÃO, idêntica a supabase/migrations/20261001120000_sequencia.sql ═══
