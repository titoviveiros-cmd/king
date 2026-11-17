
-- ═══ PARTE 3/3 — CONFERÊNCIAS, AINDA DENTRO DA TRANSAÇÃO ═══════════════════════════════════
--
-- Qualquer falha aqui levanta erro: o COMMIT abaixo não roda e NADA da migração é gravado.
-- (O SQL Editor não mostra NOTICE; quem fala é o erro, ou o relatório no fim.)
do $$
declare
  antes   record;
  t       regclass     := to_regclass('public.cosmeticos_equipados');
  equipar regprocedure := to_regprocedure('public.equipar_cosmetico(text,boolean)');
  sala    regprocedure := to_regprocedure('king_private.cosmeticos_da_sala(uuid[])');
  nivel   regprocedure := to_regprocedure('king_private.nivel_do_cosmetico(text)');
  credito regprocedure := 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure;
  agora   text[];
  novos   text[];
  sumidos text[];
  papel   text;
  f       regprocedure;
begin
  select * into antes from rollout_cosmeticos_antes;

  if current_user <> session_user then
    raise exception 'CONFERÊNCIA 0 FALHOU: a sessão não voltou ao papel original (%). Nada foi gravado.', current_user;
  end if;

  -- 1. a tabela: do dono dedicado, com RLS, VAZIA, uma linha por jogador, e cai com a conta (cascade)
  if t is null
     or pg_get_userbyid((select c.relowner from pg_class as c where c.oid = t)) <> 'king_progress_owner'
     or not (select c.relrowsecurity from pg_class as c where c.oid = t)
     or exists (select 1 from public.cosmeticos_equipados)
     or not exists (select 1 from pg_constraint as k
                     where k.conrelid = t and k.contype = 'p'
                       and k.conkey = array[(select a.attnum from pg_attribute as a where a.attrelid = t and a.attname = 'player_id')])
     or not exists (select 1 from pg_constraint as k
                     where k.conrelid = t and k.contype = 'f' and k.confrelid = 'public.players'::regclass and k.confdeltype = 'c') then
    raise exception 'CONFERÊNCIA 1 FALHOU: a tabela dos cosméticos não é a da Entrega B (dono, RLS, vazia, chave ou cascade). Nada foi gravado.';
  end if;

  -- 2. a política: UMA, só de leitura, só para authenticated, só a própria linha
  if (select count(*) from pg_policy as p where p.polrelid = t) <> 1
     or not exists (select 1 from pg_policies as p
                     where p.schemaname = 'public' and p.tablename = 'cosmeticos_equipados'
                       and p.policyname = 'cosmeticos_leio_os_meus' and p.cmd = 'SELECT'
                       and p.roles = array['authenticated']::name[]
                       and position('auth.uid()' in p.qual) > 0 and position('player_id' in p.qual) > 0
                       and p.with_check is null) then
    raise exception 'CONFERÊNCIA 2 FALHOU: a política de RLS dos cosméticos não é a esperada. Nada foi gravado.';
  end if;

  -- 3. as funções: dono dedicado, search_path vazio; as duas portas SECURITY DEFINER, o catálogo não
  foreach f in array array[equipar, sala, nivel] loop
    if f is null
       or (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = f) <> 'king_progress_owner'
       or (select p.proconfig from pg_proc as p where p.oid = f) is distinct from array['search_path=""'] then
      raise exception 'CONFERÊNCIA 3 FALHOU: % fora do dono dedicado ou com search_path aberto. Nada foi gravado.', f;
    end if;
  end loop;
  if not (select p.prosecdef from pg_proc as p where p.oid = equipar)
     or not (select p.prosecdef from pg_proc as p where p.oid = sala)
     or (select p.prosecdef from pg_proc as p where p.oid = nivel) then
    raise exception 'CONFERÊNCIA 3 FALHOU: SECURITY DEFINER fora do previsto nas funções dos cosméticos. Nada foi gravado.';
  end if;
  -- o catálogo do banco é o mesmo do app: 2 / 4 / 6, e nada fora dele
  if king_private.nivel_do_cosmetico('moldura-real') is distinct from 2
     or king_private.nivel_do_cosmetico('baralho-imperial') is distinct from 4
     or king_private.nivel_do_cosmetico('reacao-coroa') is distinct from 6
     or king_private.nivel_do_cosmetico('outro') is not null then
    raise exception 'CONFERÊNCIA 3 FALHOU: o catálogo do banco não é 2/4/6. Nada foi gravado.';
  end if;

  -- 4. quem pode o quê: o cliente LÊ (RLS) e EQUIPA (pela porta); só o servidor lê a sala; ninguém
  --    da API escreve na tabela nem executa o catálogo ou a porta da sala
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role', 'king_server'] loop
    if has_table_privilege(papel, t, 'insert, update, delete, truncate, references, trigger') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % escreve na tabela dos cosméticos. Nada foi gravado.', papel;
    end if;
    if has_function_privilege(papel, nivel, 'execute') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % executa o catálogo direto. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(papel, sala, 'execute') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % executa a porta da sala. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'service_role', 'king_server'] loop
    if has_function_privilege(papel, equipar, 'execute') or has_table_privilege(papel, t, 'select') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % lê a tabela ou equipa. Nada foi gravado.', papel;
    end if;
  end loop;
  if not has_table_privilege('authenticated', t, 'select') or not has_function_privilege('authenticated', equipar, 'execute')
     or not has_function_privilege('king_server', sala, 'execute') or pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'CONFERÊNCIA 4 FALHOU: faltou a leitura/porta do cliente ou a do servidor, ou o servidor virou dono. Nada foi gravado.';
  end if;

  -- 5. NADA mais mudou de privilégio: só entram a tabela e as três funções, cada uma com o ACL exato;
  --    nenhum objeto que existia ganhou ou perdeu acesso (nem o schema public, que a migração abre e
  --    fecha para o dono dedicado)
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
  if cardinality(sumidos) <> 0 or cardinality(novos) <> 4
     -- (o texto do objeto vem dele mesmo: com `public` no search_path, o Postgres o escreve sem prefixo)
     or not (equipar::text || ' {king_progress_owner=X/king_progress_owner,authenticated=X/king_progress_owner}' = any (novos))
     or not (sala::text || ' {king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' = any (novos))
     or not (nivel::text || ' {king_progress_owner=X/king_progress_owner}' = any (novos))
     or not exists (select 1 from unnest(novos) as n
                     where starts_with(n, t::text || ' {')
                       and n ~ ' \{king_progress_owner=[a-zA-Z]+/king_progress_owner,authenticated=r/king_progress_owner\}$') then
    raise exception 'CONFERÊNCIA 5 FALHOU: privilégio fora da Entrega B (novos: %; sumidos: %). Nada foi gravado.', novos, sumidos;
  end if;
  -- ...nem privilégio de COLUNA, nem papel novo do servidor; e a única política nova é a da tabela
  if (select coalesce(array_agg(c.oid::regclass::text || '.' || a.attname || ' ' || a.attacl::text
                                order by c.oid::regclass::text || '.' || a.attname collate "C"), '{}')
        from pg_attribute as a join pg_class as c on c.oid = a.attrelid join pg_namespace as n on n.oid = c.relnamespace
       where n.nspname in ('king_private', 'public') and a.attacl is not null) is distinct from antes.privilegios_de_coluna
     or (select coalesce(array_agg(m.roleid::regrole::text order by m.roleid::regrole::text collate "C"), '{}')
           from pg_auth_members as m where m.member = 'king_server'::regrole) is distinct from antes.papeis_do_servidor
     or (select coalesce(array_agg(c.oid::regclass::text || ' ' || p.polname
                                   order by c.oid::regclass::text || ' ' || p.polname collate "C"), '{}')
           from pg_policy as p join pg_class as c on c.oid = p.polrelid join pg_namespace as n on n.oid = c.relnamespace
          where n.nspname in ('king_private', 'public'))
        is distinct from
        (select array_agg(s collate "C" order by s collate "C")
           from unnest(antes.politicas || array[t::text || ' cosmeticos_leio_os_meus']) as s) then
    raise exception 'CONFERÊNCIA 5 FALHOU: privilégio de coluna, papel do servidor ou política de RLS fora da Entrega B. Nada foi gravado.';
  end if;

  -- 6. SECURITY DEFINER: só as duas portas novas entram na lista
  if (select array_agg(s collate "C" order by s collate "C") from (
        select n.nspname || '.' || p.proname as s
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private')) as d)
     is distinct from
     (select array_agg(s collate "C" order by s collate "C")
        from unnest(antes.security_definer || array['public.equipar_cosmetico', 'king_private.cosmeticos_da_sala']) as s) then
    raise exception 'CONFERÊNCIA 6 FALHOU: funções SECURITY DEFINER fora da Entrega B. Nada foi gravado.';
  end if;

  -- 7. o progresso intacto: crédito e curva de nível com o MESMO código; XP, ledger, partidas e
  --    partidas sem diminuir (um crédito pode confirmar durante a transação), e
  --    progresso e ledger batendo como antes
  if (select md5(p.prosrc) from pg_proc as p where p.oid = credito) <> antes.credito_md5
     or (select md5(p.prosrc) from pg_proc as p where p.oid = 'public.nivel_de(integer)'::regprocedure) <> antes.nivel_md5
     or not has_function_privilege('king_server', credito, 'execute')
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
select 'COSMÉTICOS (ENTREGA B) APLICADA E CONFERIDA' as resultado,
       to_regclass('public.cosmeticos_equipados') is not null                                      as tabela,
       (select count(*) from public.cosmeticos_equipados)                                          as escolhas_gravadas,
       has_function_privilege('authenticated', 'public.equipar_cosmetico(text,boolean)', 'execute') as cliente_equipa,
       has_function_privilege('king_server', 'king_private.cosmeticos_da_sala(uuid[])', 'execute') as servidor_le_a_sala,
       (select count(*) from public.progresso)                                                     as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)                                   as xp_total;
