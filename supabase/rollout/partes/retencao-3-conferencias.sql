
-- ═══ PARTE 3/3 — CONFERÊNCIAS, AINDA DENTRO DA TRANSAÇÃO ═══════════════════════════════════
--
-- Qualquer falha aqui levanta erro: o COMMIT abaixo não roda e NADA da migração é gravado.
-- (O SQL Editor não mostra NOTICE; quem fala é o erro, ou o relatório no fim.)
do $$
declare
  antes   record;
  e       record;
  f       regprocedure := to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])');
  credito regprocedure := 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure;
  lapide  regprocedure := 'king_private.registrar_conta_excluida()'::regprocedure;
  agora   text[];
  novos   text[];
  sumidos text[];
  papel   text;
begin
  select * into antes from rollout_retencao_antes;

  if current_user <> session_user then
    raise exception 'CONFERÊNCIA 0 FALHOU: a sessão não voltou ao papel original (%). Nada foi gravado.', current_user;
  end if;

  -- 1. nenhuma lápide saiu, entrou ou mudou — nem as VENCIDAS: só o servidor novo (passo S) expurga
  if (select count(*) from king_private.contas_excluidas) <> antes.lapides
     or (select md5(coalesce(string_agg(x.player_id::text || '@' || x.excluida_em::text, ',' order by x.player_id), ''))
           from king_private.contas_excluidas as x) <> antes.lapides_md5
     or (select count(*) from king_private.contas_excluidas
          where excluida_em < now() - interval '720 hours') <> antes.vencidas then
    raise exception 'CONFERÊNCIA 1 FALHOU: a instalação mexeu nas lápides. Nada foi gravado.';
  end if;

  -- 2. o estado nasce UMA linha, limpo: sem marcador e sem rodada — a instalação não expurga nada
  if (select count(*) from king_private.expurgo_das_lapides) <> 1 then
    raise exception 'CONFERÊNCIA 2 FALHOU: o estado do expurgo não tem uma linha só. Nada foi gravado.';
  end if;
  select * into e from king_private.expurgo_das_lapides;
  if e.outbox is not null or e.rodadas <> 0 or e.lapides_removidas <> 0 or e.ultima_rodada is not null then
    raise exception 'CONFERÊNCIA 2 FALHOU: o estado do expurgo não nasceu limpo (%). Nada foi gravado.', row_to_json(e);
  end if;
  if not (select c.relrowsecurity from pg_class as c where c.oid = 'king_private.expurgo_das_lapides'::regclass)
     or pg_get_userbyid((select c.relowner from pg_class as c where c.oid = 'king_private.expurgo_das_lapides'::regclass)) <> 'king_progress_owner' then
    raise exception 'CONFERÊNCIA 2 FALHOU: o estado do expurgo sem RLS ou fora do dono dedicado. Nada foi gravado.';
  end if;

  -- 3. a porta: dono dedicado, SECURITY DEFINER, search_path vazio, trava com prazo, devolve só
  --    contagens, e o prazo é 720 h pelo relógio do banco (nada de "30 days", que muda com o fuso)
  if f is null
     or (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = f) <> 'king_progress_owner'
     or not (select p.prosecdef from pg_proc as p where p.oid = f)
     or (select p.proconfig from pg_proc as p where p.oid = f) is distinct from array['search_path=""', 'lock_timeout=5s']
     or pg_get_function_result(f) <> 'TABLE(removidas integer, retidas integer)'
     or position($q$now() - interval '720 hours'$q$ in (select p.prosrc from pg_proc as p where p.oid = f)) = 0 then
    raise exception 'CONFERÊNCIA 3 FALHOU: a função de expurgo não é a da E-2 (dono, SECURITY DEFINER, configuração ou prazo de 720 h). Nada foi gravado.';
  end if;

  -- 4. quem executa a porta: SÓ king_server (além do dono); ninguém da API; o servidor não vira dono
  if (select p.proacl::text from pg_proc as p where p.oid = f)
       is distinct from '{king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' then
    raise exception 'CONFERÊNCIA 4 FALHOU: privilégios da função de expurgo (%). Nada foi gravado.',
      (select p.proacl::text from pg_proc as p where p.oid = f);
  end if;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(papel, f, 'execute') or has_function_privilege(papel, lapide, 'execute') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % executa uma função da lápide. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role', 'king_server'] loop
    if has_table_privilege(papel, 'king_private.expurgo_das_lapides', 'select, insert, update, delete, truncate, references, trigger')
       or has_table_privilege(papel, 'king_private.contas_excluidas', 'select, insert, update, delete, truncate, references, trigger') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % tem privilégio de tabela na lápide ou no estado do expurgo. Nada foi gravado.', papel;
    end if;
  end loop;
  if not has_function_privilege('king_server', f, 'execute') or pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'CONFERÊNCIA 4 FALHOU: king_server sem a porta, ou membro do dono das lápides. Nada foi gravado.';
  end if;

  -- 5. NADA mais mudou de privilégio: só entram a porta (EXECUTE do dono e de king_server) e o estado
  --    (só do dono); nenhum objeto que existia ganhou ou perdeu acesso
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
  if cardinality(sumidos) <> 0 or cardinality(novos) <> 2
     or not ('king_private.expurgar_lapides(uuid,uuid[]) {king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' = any (novos))
     or not exists (select 1 from unnest(novos) as n
                     where n ~ '^king_private\.expurgo_das_lapides \{king_progress_owner=[a-zA-Z]+/king_progress_owner\}$') then
    raise exception 'CONFERÊNCIA 5 FALHOU: privilégio fora da E-2 (novos: %; sumidos: %). Nada foi gravado.', novos, sumidos;
  end if;
  -- ...nem privilégio de COLUNA, nem política de RLS, nem papel novo do servidor
  if (select coalesce(array_agg(c.oid::regclass::text || '.' || a.attname || ' ' || a.attacl::text
                                order by c.oid::regclass::text || '.' || a.attname collate "C"), '{}')
        from pg_attribute as a join pg_class as c on c.oid = a.attrelid join pg_namespace as n on n.oid = c.relnamespace
       where n.nspname in ('king_private', 'public') and a.attacl is not null) is distinct from antes.privilegios_de_coluna
     or (select coalesce(array_agg(c.oid::regclass::text || ' ' || p.polname
                                   order by c.oid::regclass::text || ' ' || p.polname collate "C"), '{}')
           from pg_policy as p join pg_class as c on c.oid = p.polrelid join pg_namespace as n on n.oid = c.relnamespace
          where n.nspname in ('king_private', 'public')) is distinct from antes.politicas
     or (select coalesce(array_agg(m.roleid::regrole::text order by m.roleid::regrole::text collate "C"), '{}')
           from pg_auth_members as m where m.member = 'king_server'::regrole) is distinct from antes.papeis_do_servidor then
    raise exception 'CONFERÊNCIA 5 FALHOU: privilégio de coluna, política de RLS ou papel do servidor mudou. Nada foi gravado.';
  end if;

  -- 6. o passo D intacto: lápide com RLS, gatilho ligado na mesma função, a função da lápide no mesmo
  --    dono/definer/search_path (agora guardando a exclusão MAIS RECENTE), e o crédito a MESMA função,
  --    executável pelo servidor
  if not (select c.relrowsecurity from pg_class as c where c.oid = 'king_private.contas_excluidas'::regclass)
     or not exists (select 1 from pg_trigger as t
                     where t.tgname = 'players_lapide_da_exclusao' and t.tgrelid = 'public.players'::regclass
                       and t.tgenabled = 'O' and t.tgfoid = lapide)
     or (select pg_get_userbyid(p.proowner) || ' ' || p.prosecdef || ' ' || coalesce(p.proconfig::text, '')
           from pg_proc as p where p.oid = lapide) <> antes.lapide_funcao
     or position('greatest(x.excluida_em, excluded.excluida_em)' in pg_get_functiondef(lapide)) = 0
     or (select md5(p.prosrc) from pg_proc as p where p.oid = credito) <> antes.credito_md5
     or not has_function_privilege('king_server', credito, 'execute') then
    raise exception 'CONFERÊNCIA 6 FALHOU: o passo D não ficou intacto (lápide, gatilho, função da lápide ou crédito). Nada foi gravado.';
  end if;

  -- 7. XP, ledger e partidas: nada do que existia diminuiu (um crédito pode confirmar durante a
  --    transação; o ledger só aceita delta de 0 a 150) e progresso e ledger continuam batendo
  if (select count(*) from public.progresso) < antes.linhas_de_progresso
     or (select coalesce(sum(xp_total), 0) from public.progresso) < antes.xp_total
     or (select count(*) from public.xp_eventos) < antes.lancamentos
     or (select coalesce(sum(xp_delta), 0) from public.xp_eventos) < antes.xp_no_ledger
     or (select count(*) from king_private.partidas) < antes.partidas
     or (select count(*) from public.progresso as g
          where g.xp_total <> (select coalesce(sum(x.xp_delta), 0) from public.xp_eventos as x where x.player_id = g.player_id))
        <> antes.divergentes then
    raise exception 'CONFERÊNCIA 7 FALHOU: XP, ledger ou partidas mudaram. Nada foi gravado.';
  end if;

  -- 8. SECURITY DEFINER: só a porta nova entra na lista
  if (select array_agg(s collate "C" order by s collate "C") from (
        select n.nspname || '.' || p.proname as s
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private')) as d)
     is distinct from
     (select array_agg(s collate "C" order by s collate "C")
        from unnest(antes.security_definer || array['king_private.expurgar_lapides']) as s) then
    raise exception 'CONFERÊNCIA 8 FALHOU: funções SECURITY DEFINER fora da E-2. Nada foi gravado.';
  end if;
end $$;

commit;

-- ═══ RELATÓRIO — só aparece se TUDO acima passou e foi gravado ════════════════════════════
select 'RETENÇÃO DAS LÁPIDES (E-2) APLICADA E CONFERIDA' as resultado,
       to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is not null as expurgo,
       has_function_privilege('king_server', 'king_private.expurgar_lapides(uuid,uuid[])', 'execute') as servidor_executa,
       (select count(*) from king_private.expurgo_das_lapides)  as estado,
       e.outbox is null                                          as marcador_vazio_ate_o_passo_S,
       e.rodadas,
       e.lapides_removidas,
       (select count(*) from king_private.contas_excluidas)     as lapides,
       (select count(*) from king_private.contas_excluidas
         where excluida_em < now() - interval '720 hours')      as vencidas_esperando_o_passo_S
  from king_private.expurgo_das_lapides as e;
