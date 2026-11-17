-- ═══ PARTE 1/3 — ANTES DA MIGRAÇÃO (na MESMA transação) ════════════════════════════════════
--
-- 1. RECUSA rodar: sem os papéis do progresso; com um aplicador que não herda (ou não pode assumir)
--    o dono dedicado; com o servidor membro desse dono; sem o progresso, o crédito do passo D e a
--    retenção das lápides inteiros; ou com QUALQUER pedaço dos cosméticos já presente (reaplicação, ou
--    um arquivo que parou no meio).
-- 2. RETRATO do que a migração NÃO pode mudar, numa tabela temporária que some no commit.
set local lock_timeout = '5s';

do $$
begin
  if to_regrole('king_progress_owner') is null or to_regrole('king_server') is null then
    raise exception 'ROLLOUT COSMÉTICOS ABORTADO (parte 1): papéis do progresso ausentes. Nada foi alterado.';
  end if;
  if not pg_has_role(current_user, 'king_progress_owner', 'MEMBER')
     or not pg_has_role(current_user, 'king_progress_owner', 'USAGE')
     or not pg_has_role(current_user, 'king_progress_owner', 'SET') then
    raise exception 'ROLLOUT COSMÉTICOS ABORTADO (parte 1): % não herda nem assume king_progress_owner. Nada foi alterado.', current_user;
  end if;
  if pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'ROLLOUT COSMÉTICOS ABORTADO (parte 1): king_server é membro do dono do progresso. Nada foi alterado.';
  end if;
  if to_regclass('public.players') is null or to_regclass('public.progresso') is null
     or to_regclass('public.xp_eventos') is null or to_regclass('king_private.partidas') is null
     or to_regprocedure('public.nivel_de(integer)') is null
     or to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)') is null
     or to_regclass('king_private.contas_excluidas') is null
     or to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is null then
    raise exception 'ROLLOUT COSMÉTICOS ABORTADO (parte 1): o progresso (com o passo D e a retenção) não está aplicado inteiro. Nada foi alterado.';
  end if;
  if to_regclass('public.cosmeticos_equipados') is not null
     or to_regprocedure('public.equipar_cosmetico(text,boolean)') is not null
     or to_regprocedure('king_private.cosmeticos_da_sala(uuid[])') is not null
     or to_regprocedure('king_private.nivel_do_cosmetico(text)') is not null
     or to_regprocedure('public.equipar_toalha(text)') is not null
     or to_regprocedure('king_private.toalhas_do_anfitriao(uuid)') is not null
     or to_regprocedure('king_private.nivel_da_toalha(text)') is not null then
    raise exception 'ROLLOUT COSMÉTICOS ABORTADO (parte 1): os cosméticos já existem, inteiros ou em parte, neste banco — esta execução não alterou nada. Se acabaram de ser aplicados (o arquivo colado duas vezes), confira com o checkpoint 3.';
  end if;
end $$;

create temp table rollout_cosmeticos_antes on commit drop as
select (select count(*) from public.progresso)                       as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)     as xp_total,
       (select count(*) from public.xp_eventos)                      as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos)    as xp_no_ledger,
       (select count(*) from king_private.partidas)                  as partidas,
       (select count(*) from public.progresso as g
         where g.xp_total <> (select coalesce(sum(e.xp_delta), 0) from public.xp_eventos as e where e.player_id = g.player_id)) as divergentes,
       (select md5(p.prosrc) from pg_proc as p
         where p.oid = 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure) as credito_md5,
       (select md5(p.prosrc) from pg_proc as p where p.oid = 'public.nivel_de(integer)'::regprocedure) as nivel_md5,
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
       (select coalesce(array_agg(c.oid::regclass::text || '.' || a.attname || ' ' || a.attacl::text
                                  order by c.oid::regclass::text || '.' || a.attname collate "C"), '{}')
          from pg_attribute as a join pg_class as c on c.oid = a.attrelid join pg_namespace as n on n.oid = c.relnamespace
         where n.nspname in ('king_private', 'public') and a.attacl is not null)   as privilegios_de_coluna,
       (select coalesce(array_agg(c.oid::regclass::text || ' ' || p.polname
                                  order by c.oid::regclass::text || ' ' || p.polname collate "C"), '{}')
          from pg_policy as p join pg_class as c on c.oid = p.polrelid join pg_namespace as n on n.oid = c.relnamespace
         where n.nspname in ('king_private', 'public'))                             as politicas,
       (select coalesce(array_agg(m.roleid::regrole::text order by m.roleid::regrole::text collate "C"), '{}')
          from pg_auth_members as m where m.member = 'king_server'::regrole)       as papeis_do_servidor;

-- ═══ PARTE 2/3 — AS DUAS MIGRAÇÕES, idênticas aos arquivos de supabase/migrations ═══════════
