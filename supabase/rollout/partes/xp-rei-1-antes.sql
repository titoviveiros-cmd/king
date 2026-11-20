-- ═══ PARTE 1/3 — ANTES DA MIGRAÇÃO (na MESMA transação) ════════════════════════════════════
--
-- 1. RECUSA rodar: sem os papéis do progresso; com um aplicador que não herda o dono dedicado; com o
--    servidor membro desse dono; sem o progresso inteiro (partidas, ledger com a chave única, crédito
--    v1, lápides — a v2 repete a regra da lápide); ou com QUALQUER pedaço da penalidade do Rei já
--    presente (reaplicação, ou um arquivo que parou no meio).
-- 2. RETRATO do que a migração NÃO pode mudar, numa tabela temporária que some no commit.
set local lock_timeout = '5s';

do $$
begin
  if to_regrole('king_progress_owner') is null or to_regrole('king_server') is null then
    raise exception 'ROLLOUT XP-REI ABORTADO (parte 1): papéis do progresso ausentes. Nada foi alterado.';
  end if;
  if not pg_has_role(current_user, 'king_progress_owner', 'MEMBER')
     or not pg_has_role(current_user, 'king_progress_owner', 'USAGE')
     or not pg_has_role(current_user, 'king_progress_owner', 'SET') then
    raise exception 'ROLLOUT XP-REI ABORTADO (parte 1): % não herda nem assume king_progress_owner. Nada foi alterado.', current_user;
  end if;
  if pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'ROLLOUT XP-REI ABORTADO (parte 1): king_server é membro do dono do progresso. Nada foi alterado.';
  end if;
  if to_regclass('public.players') is null or to_regclass('public.progresso') is null
     or to_regclass('public.xp_eventos') is null or to_regclass('king_private.partidas') is null
     or to_regclass('king_private.contas_excluidas') is null
     or to_regprocedure('king_private.xp_da_regra(smallint,boolean,boolean,integer)') is null
     or to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)') is null
     or not exists (select 1 from pg_constraint as k
                     where k.conrelid = 'public.xp_eventos'::regclass and k.conname = 'xp_eventos_uma_vez' and k.contype = 'u') then
    raise exception 'ROLLOUT XP-REI ABORTADO (parte 1): o progresso não está aplicado inteiro. Nada foi alterado.';
  end if;
  if to_regclass('public.xp_composicao') is not null
     or to_regprocedure('king_private.xp_da_regra_v2(smallint,boolean,boolean,integer,boolean)') is not null
     or to_regprocedure('king_private.creditar_partida_v2(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)') is not null then
    raise exception 'ROLLOUT XP-REI ABORTADO (parte 1): a penalidade do Rei já existe, inteira ou em parte, neste banco — esta execução não alterou nada.';
  end if;
end $$;

create temp table rollout_xp_rei_antes on commit drop as
select (select count(*) from public.progresso)                       as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)     as xp_total,
       (select count(*) from public.xp_eventos)                      as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos)    as xp_no_ledger,
       (select count(*) from king_private.partidas)                  as partidas,
       (select count(*) from king_private.partidas where versao_regra <> 1) as partidas_fora_da_v1,
       (select count(*) from public.progresso as g
         where g.xp_total <> (select coalesce(sum(e.xp_delta), 0) from public.xp_eventos as e where e.player_id = g.player_id)) as divergentes,
       (select md5(p.prosrc) from pg_proc as p
         where p.oid = 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure) as credito_md5,
       (select md5(p.prosrc) from pg_proc as p
         where p.oid = 'king_private.xp_da_regra(smallint,boolean,boolean,integer)'::regprocedure) as regra_md5,
       (select coalesce(array_agg(n.nspname || '.' || p.proname), '{}')
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private'))           as security_definer,
       (select array_agg(o.obj || ' ' || o.acl) from (
          select c.oid::regclass::text as obj, coalesce(c.relacl::text, '(padrão)') as acl
            from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
           where n.nspname in ('king_private', 'public') and c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')
          union all
          select p.oid::regprocedure::text, coalesce(p.proacl::text, '(padrão)')
            from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
           where n.nspname in ('king_private', 'public')
          union all
          select 'schema ' || n.nspname, coalesce(n.nspacl::text, '(padrão)')
            from pg_namespace as n where n.nspname in ('king_private', 'public')) as o) as privilegios,
       (select coalesce(array_agg(c.oid::regclass::text || ' ' || p.polname
                                  order by c.oid::regclass::text || ' ' || p.polname collate "C"), '{}')
          from pg_policy as p join pg_class as c on c.oid = p.polrelid join pg_namespace as n on n.oid = c.relnamespace
         where n.nspname in ('king_private', 'public'))                             as politicas;

-- ═══ PARTE 2/3 — A MIGRAÇÃO, idêntica ao arquivo de supabase/migrations ═════════════════════
