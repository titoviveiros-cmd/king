-- ═══ PARTE 1/3 — ANTES DA MIGRAÇÃO (na MESMA transação) ════════════════════════════════════
--
-- 1. RECUSA rodar sem o passo D inteiro, com QUALQUER pedaço da E-2 já presente (reaplicação, ou um
--    arquivo que parou no meio), sem os papéis do progresso, com um aplicador que não herda o dono das
--    lápides, ou com o servidor membro desse dono.
-- 2. TRAVA a lápide contra escrita (modo share), com prazo de 5 s: nenhuma lápide entra nem sai
--    enquanto esta transação existir — uma exclusão de conta que chegar agora espera o COMMIT e segue —,
--    e o retrato abaixo fica estável até a conferência. Crédito de XP e leitura seguem livres. Se a trava
--    não vier em 5 s ("lock timeout"), NADA é gravado: rodar de novo um minuto depois.
-- 3. RETRATO do que a migração NÃO pode mudar, numa tabela temporária que some no commit.
set local lock_timeout = '5s';

do $$
declare
  credito regprocedure := to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)');
  lapide  regprocedure := to_regprocedure('king_private.registrar_conta_excluida()');
begin
  if to_regrole('king_progress_owner') is null or to_regrole('king_server') is null then
    raise exception 'ROLLOUT D2 ABORTADO (parte 1): papéis do progresso ausentes. Nada foi alterado.';
  end if;
  if not pg_has_role(current_user, 'king_progress_owner', 'MEMBER') or not pg_has_role(current_user, 'king_progress_owner', 'USAGE') then
    raise exception 'ROLLOUT D2 ABORTADO (parte 1): % não herda king_progress_owner. Nada foi alterado.', current_user;
  end if;
  if pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'ROLLOUT D2 ABORTADO (parte 1): king_server é membro do dono das lápides. Nada foi alterado.';
  end if;
  if to_regclass('king_private.contas_excluidas') is null or lapide is null or credito is null
     or not exists (select 1 from pg_trigger as t
                     where t.tgname = 'players_lapide_da_exclusao' and t.tgrelid = 'public.players'::regclass
                       and t.tgenabled = 'O' and t.tgfoid = lapide)
     or position('contas_excluidas' in pg_get_functiondef(credito)) = 0
     or not has_function_privilege('king_server', credito, 'execute') then
    raise exception 'ROLLOUT D2 ABORTADO (parte 1): o passo D não está aplicado inteiro (lápide, gatilho ou crédito novo). Nada foi alterado.';
  end if;
  if to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is not null
     or to_regclass('king_private.expurgo_das_lapides') is not null
     or position('greatest' in pg_get_functiondef(lapide)) > 0 then
    raise exception 'ROLLOUT D2 ABORTADO (parte 1): a retenção das lápides (E-2) já existe, inteira ou em parte, neste banco — esta execução não alterou nada. Se ela acabou de ser aplicada (o arquivo colado duas vezes), confira com o checkpoint 3.';
  end if;
end $$;

lock table king_private.contas_excluidas in share mode;

create temp table rollout_retencao_antes on commit drop as
select (select count(*) from king_private.contas_excluidas)                        as lapides,
       (select md5(coalesce(string_agg(x.player_id::text || '@' || x.excluida_em::text, ',' order by x.player_id), ''))
          from king_private.contas_excluidas as x)                                 as lapides_md5,
       (select count(*) from king_private.contas_excluidas
         where excluida_em < now() - interval '720 hours')                         as vencidas,
       (select md5(p.prosrc) from pg_proc as p
         where p.oid = 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure) as credito_md5,
       (select pg_get_userbyid(p.proowner) || ' ' || p.prosecdef || ' ' || coalesce(p.proconfig::text, '')
          from pg_proc as p where p.oid = 'king_private.registrar_conta_excluida()'::regprocedure) as lapide_funcao,
       (select count(*) from public.progresso)                    as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)  as xp_total,
       (select count(*) from public.xp_eventos)                   as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos) as xp_no_ledger,
       (select count(*) from king_private.partidas)               as partidas,
       (select count(*) from public.progresso as g
         where g.xp_total <> (select coalesce(sum(e.xp_delta), 0) from public.xp_eventos as e where e.player_id = g.player_id)) as divergentes,
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

-- ═══ PARTE 2/3 — A MIGRAÇÃO, idêntica a supabase/migrations/20261026120000_retencao_das_lapides.sql ═══
