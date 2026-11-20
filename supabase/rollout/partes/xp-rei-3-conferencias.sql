-- ═══ PARTE 3/3 — CONFERÊNCIAS, AINDA DENTRO DA TRANSAÇÃO ═══════════════════════════════════
--
-- Qualquer falha aqui levanta erro: o COMMIT abaixo não roda e NADA da migração é gravado.
do $$
declare
  antes   record;
  t       regclass     := to_regclass('public.xp_composicao');
  regra   regprocedure := to_regprocedure('king_private.xp_da_regra_v2(smallint,boolean,boolean,integer,boolean)');
  porta   regprocedure := to_regprocedure('king_private.creditar_partida_v2(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)');
  agora   text[];
  novos   text[];
  sumidos text[];
  papel   text;
  errado  text;
begin
  select * into antes from rollout_xp_rei_antes;

  if current_user <> session_user then
    raise exception 'CONFERÊNCIA 0 FALHOU: a sessão não voltou ao papel original (%). Nada foi gravado.', current_user;
  end if;

  -- 1. a tabela: do dono dedicado, com RLS, VAZIA, chave (partida, jogador), presa ao LANÇAMENTO com
  --    cascade, e as checagens que garantem a soma e a faixa da penalidade
  if t is null or regra is null or porta is null
     or pg_get_userbyid((select c.relowner from pg_class as c where c.oid = t)) <> 'king_progress_owner'
     or not (select c.relrowsecurity from pg_class as c where c.oid = t)
     or exists (select 1 from public.xp_composicao)
     or not exists (select 1 from pg_constraint as k where k.conrelid = t and k.contype = 'p' and k.conname = 'xp_composicao_uma_vez')
     or not exists (select 1 from pg_constraint as k
                     where k.conrelid = t and k.contype = 'f' and k.conname = 'xp_composicao_do_lancamento'
                       and k.confrelid = 'public.xp_eventos'::regclass and k.confdeltype = 'c')
     or not exists (select 1 from pg_constraint as k where k.conrelid = t and k.conname = 'xp_composicao_soma'
                     and pg_get_constraintdef(k.oid) = 'CHECK (((xp_liquido >= 0) AND (xp_liquido = ((xp_bruto - penalidade_rei) - reducao_diaria))))')
     or not exists (select 1 from pg_constraint as k where k.conrelid = t and k.conname = 'xp_composicao_penalidade'
                     and pg_get_constraintdef(k.oid) = 'CHECK (((penalidade_rei = ANY (ARRAY[0, 60])) AND (penalidade_rei <= xp_bruto)))') then
    raise exception 'CONFERÊNCIA 1 FALHOU: a tabela da composição não é a da Entrega C (dono, RLS, vazia, chave, vínculo ao lançamento ou checagens). Nada foi gravado.';
  end if;

  -- 2. a política: UMA, só de leitura, só para authenticated, só a própria linha
  if (select count(*) from pg_policy as p where p.polrelid = t) <> 1
     or not exists (select 1 from pg_policies as p
                     where p.schemaname = 'public' and p.tablename = 'xp_composicao'
                       and p.policyname = 'xp_composicao_leio_a_minha' and p.cmd = 'SELECT'
                       and p.roles = array['authenticated']::name[]
                       and position('auth.uid()' in p.qual) > 0 and position('player_id' in p.qual) > 0) then
    raise exception 'CONFERÊNCIA 2 FALHOU: a política de RLS da composição não é a esperada. Nada foi gravado.';
  end if;

  -- 3. as funções: dono dedicado e search_path vazio; só a PORTA é SECURITY DEFINER (a regra é pura)
  if (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = porta) <> 'king_progress_owner'
     or (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = regra) <> 'king_progress_owner'
     or not (select p.prosecdef from pg_proc as p where p.oid = porta)
     or (select p.prosecdef from pg_proc as p where p.oid = regra)
     or (select p.proconfig from pg_proc as p where p.oid = porta) is distinct from array['search_path=""']
     or (select p.proconfig from pg_proc as p where p.oid = regra) is distinct from array['search_path=""'] then
    raise exception 'CONFERÊNCIA 3 FALHOU: a porta ou a regra fora do previsto (dono, SECURITY DEFINER ou search_path). Nada foi gravado.';
  end if;
  -- a regra v2 é a do documento: a tabela de exemplos, valor a valor (bruto, penalidade, redução, líquido)
  select string_agg(format('%s/%s/%s/%s/%s/%s', e.pos, e.part, e.sobre, e.ant, e.cap, x), '; ') into errado
    from (values
      (1, true, false, 0, false, '(150,0,0,150)'), (2, true, false, 0, false, '(130,0,0,130)'),
      (3, true, false, 0, false, '(115,0,0,115)'), (4, true, false, 0, false, '(100,0,0,100)'),
      (1, true, false, 0, true,  '(150,60,0,90)'), (2, true, false, 0, true,  '(130,60,0,70)'),
      (3, true, false, 0, true,  '(115,60,0,55)'), (4, true, false, 0, true,  '(100,60,0,40)'),
      (1, true, false, 5, true,  '(150,60,0,90)'), (1, true, false, 6, true,  '(150,60,68,22)'),
      (4, true, false, 6, true,  '(100,60,30,10)'), (1, true, false, 6, false, '(150,0,113,37)'),
      (1, false, false, 0, true, '(0,0,0,0)'),     (2, true, true, 0, true,   '(0,0,0,0)')
    ) as e (pos, part, sobre, ant, cap, esperado)
    cross join lateral (select king_private.xp_da_regra_v2(e.pos::smallint, e.part, e.sobre, e.ant, e.cap)::text as x) as v
   where v.x <> e.esperado;
  if errado is not null then
    raise exception 'CONFERÊNCIA 3 FALHOU: a regra v2 não é a do documento (%). Nada foi gravado.', errado;
  end if;
  -- SEM captura, a v2 dá EXATAMENTE o líquido da v1, em todo o domínio
  if exists (select 1
               from generate_series(1, 4) as pos, (values (true), (false)) as pa (part), (values (true), (false)) as so (sobre),
                    generate_series(0, 12) as ant
              where (king_private.xp_da_regra_v2(pos::smallint, pa.part, so.sobre, ant, false)).xp_liquido
                    <> king_private.xp_da_regra(pos::smallint, pa.part, so.sobre, ant)) then
    raise exception 'CONFERÊNCIA 3 FALHOU: sem captura, a v2 diverge da v1. Nada foi gravado.';
  end if;

  -- 4. quem pode o quê: ninguém da API escreve; o cliente só LÊ; só o servidor credita, pela porta
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role', 'king_server'] loop
    if has_table_privilege(papel, t, 'insert, update, delete, truncate, references, trigger') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % escreve na composição. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(papel, porta, 'execute') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % executa a porta do servidor. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role', 'king_server'] loop
    if has_function_privilege(papel, regra, 'execute') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % executa a regra direto. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'service_role', 'king_server'] loop
    if has_table_privilege(papel, t, 'select') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % lê a composição. Nada foi gravado.', papel;
    end if;
  end loop;
  if not has_table_privilege('authenticated', t, 'select')
     or not has_function_privilege('king_server', porta, 'execute') or pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'CONFERÊNCIA 4 FALHOU: faltou a leitura do cliente ou a porta do servidor, ou o servidor virou dono. Nada foi gravado.';
  end if;

  -- 5. NADA mais mudou de privilégio: só entram a tabela, a regra e a porta
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
     or not (porta::text || ' {king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' = any (novos))
     or not (regra::text || ' {king_progress_owner=X/king_progress_owner}' = any (novos)) then
    raise exception 'CONFERÊNCIA 5 FALHOU: privilégio fora da Entrega C (novos: %; sumidos: %). Nada foi gravado.', novos, sumidos;
  end if;
  if (select coalesce(array_agg(c.oid::regclass::text || ' ' || p.polname
                                order by c.oid::regclass::text || ' ' || p.polname collate "C"), '{}')
        from pg_policy as p join pg_class as c on c.oid = p.polrelid join pg_namespace as n on n.oid = c.relnamespace
       where n.nspname in ('king_private', 'public'))
     is distinct from
     (select array_agg(s collate "C" order by s collate "C")
        from unnest(antes.politicas || array[t::text || ' xp_composicao_leio_a_minha']) as s) then
    raise exception 'CONFERÊNCIA 5 FALHOU: política de RLS fora da Entrega C. Nada foi gravado.';
  end if;

  -- 6. SECURITY DEFINER: só a porta nova entra na lista
  if (select array_agg(s collate "C" order by s collate "C") from (
        select n.nspname || '.' || p.proname as s
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private')) as d)
     is distinct from
     (select array_agg(s collate "C" order by s collate "C")
        from unnest(antes.security_definer || array['king_private.creditar_partida_v2']) as s) then
    raise exception 'CONFERÊNCIA 6 FALHOU: funções SECURITY DEFINER fora da Entrega C. Nada foi gravado.';
  end if;

  -- 7. o progresso intacto e NADA RETROATIVO: a porta v1 e a regra v1 com o MESMO código; XP, ledger e
  --    partidas sem diminuir; nenhuma partida mudou de versão; o agregado batendo com o ledger como antes
  if (select md5(p.prosrc) from pg_proc as p
        where p.oid = 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure) <> antes.credito_md5
     or (select md5(p.prosrc) from pg_proc as p
        where p.oid = 'king_private.xp_da_regra(smallint,boolean,boolean,integer)'::regprocedure) <> antes.regra_md5
     or (select count(*) from public.progresso) < antes.linhas_de_progresso
     or (select coalesce(sum(xp_total), 0) from public.progresso) < antes.xp_total
     or (select count(*) from public.xp_eventos) < antes.lancamentos
     or (select coalesce(sum(xp_delta), 0) from public.xp_eventos) < antes.xp_no_ledger
     or (select count(*) from king_private.partidas) < antes.partidas
     or (select count(*) from king_private.partidas where versao_regra <> 1) <> antes.partidas_fora_da_v1
     or (select count(*) from public.progresso as g
          where g.xp_total <> (select coalesce(sum(x.xp_delta), 0) from public.xp_eventos as x where x.player_id = g.player_id))
        <> antes.divergentes then
    raise exception 'CONFERÊNCIA 7 FALHOU: o progresso mudou (crédito v1, regra v1, XP, ledger ou partidas). Nada foi gravado.';
  end if;
end $$;

commit;

-- ═══ RELATÓRIO — só aparece se TUDO acima passou e foi gravado ════════════════════════════
select 'PENALIDADE DO REI (ENTREGA C) APLICADA E CONFERIDA' as resultado,
       (select count(*) from public.xp_composicao)                                                  as composicoes_gravadas,
       has_table_privilege('authenticated', 'public.xp_composicao', 'select')                        as cliente_le_a_sua,
       has_function_privilege('king_server', 'king_private.creditar_partida_v2(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)', 'execute') as servidor_credita_v2,
       has_function_privilege('king_server', 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)', 'execute')    as servidor_credita_v1,
       (select count(*) from public.progresso)                                                      as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)                                    as xp_total;
