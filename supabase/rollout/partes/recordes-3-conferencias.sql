
-- ═══ PARTE 3/3 — CONFERÊNCIAS, AINDA DENTRO DA TRANSAÇÃO ═══════════════════════════════════
--
-- Qualquer falha aqui levanta erro: o COMMIT abaixo não roda e NADA da migração é gravado.
do $$
declare
  antes   record;
  t       regclass     := to_regclass('public.placares_online');
  v       regclass     := to_regclass('public.xp_por_nivel');
  porta   regprocedure := to_regprocedure('king_private.registrar_placares(uuid,jsonb)');
  agora   text[];
  novos   text[];
  sumidos text[];
  papel   text;
begin
  select * into antes from rollout_recordes_antes;

  if current_user <> session_user then
    raise exception 'CONFERÊNCIA 0 FALHOU: a sessão não voltou ao papel original (%). Nada foi gravado.', current_user;
  end if;

  -- 1. a tabela: do dono dedicado, com RLS, VAZIA, chave (partida, jogador), cascade da conta e as checagens
  if t is null or v is null or porta is null
     or pg_get_userbyid((select c.relowner from pg_class as c where c.oid = t)) <> 'king_progress_owner'
     or not (select c.relrowsecurity from pg_class as c where c.oid = t)
     or exists (select 1 from public.placares_online)
     or not exists (select 1 from pg_constraint as k where k.conrelid = t and k.contype = 'p' and k.conname = 'placares_online_uma_vez')
     or not exists (select 1 from pg_constraint as k
                     where k.conrelid = t and k.contype = 'f' and k.confrelid = 'public.players'::regclass and k.confdeltype = 'c')
     or not exists (select 1 from pg_constraint as k where k.conrelid = t and k.conname = 'placares_online_pontos'
                     and pg_get_constraintdef(k.oid) = 'CHECK (((pontos >= ''-5000''::integer) AND (pontos <= 5000)))') then
    raise exception 'CONFERÊNCIA 1 FALHOU: a tabela dos placares não é a da Entrega D (dono, RLS, vazia, chave, cascade ou faixa). Nada foi gravado.';
  end if;

  -- 2. a política: UMA, só de leitura, só para authenticated, só a própria linha
  if (select count(*) from pg_policy as p where p.polrelid = t) <> 1
     or not exists (select 1 from pg_policies as p
                     where p.schemaname = 'public' and p.tablename = 'placares_online'
                       and p.policyname = 'placares_leio_os_meus' and p.cmd = 'SELECT'
                       and p.roles = array['authenticated']::name[]
                       and position('auth.uid()' in p.qual) > 0 and position('player_id' in p.qual) > 0) then
    raise exception 'CONFERÊNCIA 2 FALHOU: a política de RLS dos placares não é a esperada. Nada foi gravado.';
  end if;

  -- 3. a porta: dono dedicado, SECURITY DEFINER, search_path vazio; a view com security_invoker
  if (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = porta) <> 'king_progress_owner'
     or not (select p.prosecdef from pg_proc as p where p.oid = porta)
     or (select p.proconfig from pg_proc as p where p.oid = porta) is distinct from array['search_path=""']
     or not coalesce((select 'security_invoker=true' = any (c.reloptions) from pg_class as c where c.oid = v), false) then
    raise exception 'CONFERÊNCIA 3 FALHOU: a porta ou a view fora do previsto. Nada foi gravado.';
  end if;
  -- a view é a MESMA curva do banco
  if exists (select 1 from public.xp_por_nivel as x where x.xp <> public.xp_para_nivel(x.nivel))
     or (select count(*) from public.xp_por_nivel) <> 100 then
    raise exception 'CONFERÊNCIA 3 FALHOU: xp_por_nivel não é a curva de public.xp_para_nivel. Nada foi gravado.';
  end if;

  -- 4. quem pode o quê: ninguém da API escreve; o cliente só LÊ; só o servidor grava, pela porta
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role', 'king_server'] loop
    if has_table_privilege(papel, t, 'insert, update, delete, truncate, references, trigger') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % escreve na tabela dos placares. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(papel, porta, 'execute') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % executa a porta do servidor. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'service_role', 'king_server'] loop
    if has_table_privilege(papel, t, 'select') or has_table_privilege(papel, v, 'select') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % lê os placares ou a curva. Nada foi gravado.', papel;
    end if;
  end loop;
  if not has_table_privilege('authenticated', t, 'select') or not has_table_privilege('authenticated', v, 'select')
     or not has_function_privilege('king_server', porta, 'execute') or pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'CONFERÊNCIA 4 FALHOU: faltou a leitura do cliente ou a porta do servidor, ou o servidor virou dono. Nada foi gravado.';
  end if;

  -- 5. NADA mais mudou de privilégio: só entram a tabela, a view e a porta
  select array_agg(o.obj || ' ' || o.acl) into agora from (
    select c.oid::regclass::text as obj, coalesce(c.relacl::text, '(padrão)') as acl
      from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
     where n.nspname in ('king_private', 'public') and c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')
    union all
    select p.oid::regprocedure::text, coalesce(p.proacl::text, '(padrão)')
      from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
     where n.nspname in ('king_private', 'public')
    union all
    select 'schema ' || n.nspname, coalesce(n.nspacl::text, '(padrão)')
      from pg_namespace as n where n.nspname in ('king_private', 'public')) as o;
  novos   := array(select x from unnest(agora) as x except select y from unnest(antes.privilegios) as y);
  sumidos := array(select y from unnest(antes.privilegios) as y except select x from unnest(agora) as x);
  if cardinality(sumidos) <> 0 or cardinality(novos) <> 3
     or not (porta::text || ' {king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' = any (novos)) then
    raise exception 'CONFERÊNCIA 5 FALHOU: privilégio fora da Entrega D (novos: %; sumidos: %). Nada foi gravado.', novos, sumidos;
  end if;
  if (select coalesce(array_agg(c.oid::regclass::text || ' ' || p.polname
                                order by c.oid::regclass::text || ' ' || p.polname collate "C"), '{}')
        from pg_policy as p join pg_class as c on c.oid = p.polrelid join pg_namespace as n on n.oid = c.relnamespace
       where n.nspname in ('king_private', 'public'))
     is distinct from
     (select array_agg(s collate "C" order by s collate "C")
        from unnest(antes.politicas || array[t::text || ' placares_leio_os_meus']) as s) then
    raise exception 'CONFERÊNCIA 5 FALHOU: política de RLS fora da Entrega D. Nada foi gravado.';
  end if;

  -- 6. SECURITY DEFINER: só a porta nova entra na lista
  if (select array_agg(s collate "C" order by s collate "C") from (
        select n.nspname || '.' || p.proname as s
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private')) as d)
     is distinct from
     (select array_agg(s collate "C" order by s collate "C")
        from unnest(antes.security_definer || array['king_private.registrar_placares']) as s) then
    raise exception 'CONFERÊNCIA 6 FALHOU: funções SECURITY DEFINER fora da Entrega D. Nada foi gravado.';
  end if;

  -- 7. o progresso intacto: crédito e curva com o MESMO código; XP, ledger e partidas sem diminuir, e
  --    o agregado batendo com o ledger como antes
  if (select md5(p.prosrc) from pg_proc as p
        where p.oid = 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure) <> antes.credito_md5
     or (select md5(p.prosrc) from pg_proc as p where p.oid = 'public.xp_para_nivel(integer)'::regprocedure) <> antes.curva_md5
     or (select count(*) from public.progresso) < antes.linhas_de_progresso
     or (select coalesce(sum(xp_total), 0) from public.progresso) < antes.xp_total
     or (select count(*) from public.xp_eventos) < antes.lancamentos
     or (select coalesce(sum(xp_delta), 0) from public.xp_eventos) < antes.xp_no_ledger
     or (select count(*) from king_private.partidas) < antes.partidas
     or (select count(*) from public.progresso as g
          where g.xp_total <> (select coalesce(sum(x.xp_delta), 0) from public.xp_eventos as x where x.player_id = g.player_id))
        <> antes.divergentes then
    raise exception 'CONFERÊNCIA 7 FALHOU: o progresso mudou (crédito, curva, XP, ledger ou partidas). Nada foi gravado.';
  end if;
end $$;

commit;

-- ═══ RELATÓRIO — só aparece se TUDO acima passou e foi gravado ════════════════════════════
select 'RECORDES (ENTREGA D) APLICADA E CONFERIDA' as resultado,
       (select count(*) from public.placares_online)                                               as placares_gravados,
       has_table_privilege('authenticated', 'public.placares_online', 'select')                     as cliente_le_os_seus,
       has_function_privilege('king_server', 'king_private.registrar_placares(uuid,jsonb)', 'execute') as servidor_grava,
       (select count(*) from public.progresso)                                                     as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)                                   as xp_total;
