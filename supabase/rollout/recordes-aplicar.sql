-- ENTREGA D — RECORDES & XP — COLAR ESTE ARQUIVO INTEIRO NO SQL EDITOR E RODAR UMA VEZ.
--
-- ARQUIVO GERADO por scripts/montar-rollout-recordes.mjs — não editar à mão.
-- Migração dentro dele, com o texto idêntico ao do repositório:
--   supabase/migrations/20261120120000_recordes.sql
--     sha256 837ff632cf2df5edd276ba1a0ee0d2118c1e25f6c1996c20588dc93352fb493f
--
-- Independe dos cosméticos: precisa só do progresso (partidas, ledger, crédito e curva de nível).
--
-- SÓ está aplicado se a última tela mostrar a linha "RECORDES (ENTREGA D) APLICADA E CONFERIDA"; sem
-- ela, nada foi gravado. É UMA transação: recusas e retrato do "antes", a migração, 7 conferências e
-- COMMIT. Se QUALQUER passo falhar, rodar `rollback;` sozinho e mandar o erro.
--
-- O que muda: nasce a tabela dos placares online (vazia), a porta do servidor e a view do XP por nível.
-- NADA do que existe muda: progresso, XP, ledger, crédito, cosméticos e privilégios ficam como estão.
--
-- Rollback: supabase/rollback/20261120120000_recordes_rollback.sql.

begin;

-- ═══ PARTE 1/3 — ANTES DA MIGRAÇÃO (na MESMA transação) ════════════════════════════════════
--
-- 1. RECUSA rodar: sem os papéis do progresso; com um aplicador que não herda o dono dedicado; com o
--    servidor membro desse dono; sem o progresso (partidas, ledger, crédito, nível) inteiro; ou com
--    QUALQUER pedaço dos recordes já presente (reaplicação, ou um arquivo que parou no meio).
-- 2. RETRATO do que a migração NÃO pode mudar, numa tabela temporária que some no commit.
set local lock_timeout = '5s';

do $$
begin
  if to_regrole('king_progress_owner') is null or to_regrole('king_server') is null then
    raise exception 'ROLLOUT RECORDES ABORTADO (parte 1): papéis do progresso ausentes. Nada foi alterado.';
  end if;
  if not pg_has_role(current_user, 'king_progress_owner', 'MEMBER')
     or not pg_has_role(current_user, 'king_progress_owner', 'USAGE')
     or not pg_has_role(current_user, 'king_progress_owner', 'SET') then
    raise exception 'ROLLOUT RECORDES ABORTADO (parte 1): % não herda nem assume king_progress_owner. Nada foi alterado.', current_user;
  end if;
  if pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'ROLLOUT RECORDES ABORTADO (parte 1): king_server é membro do dono do progresso. Nada foi alterado.';
  end if;
  if to_regclass('public.players') is null or to_regclass('public.xp_eventos') is null
     or to_regclass('king_private.partidas') is null
     or to_regprocedure('public.xp_para_nivel(integer)') is null
     or to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)') is null then
    raise exception 'ROLLOUT RECORDES ABORTADO (parte 1): o progresso não está aplicado inteiro. Nada foi alterado.';
  end if;
  if to_regclass('public.placares_online') is not null
     or to_regclass('public.xp_por_nivel') is not null
     or to_regprocedure('king_private.registrar_placares(uuid,jsonb)') is not null then
    raise exception 'ROLLOUT RECORDES ABORTADO (parte 1): os recordes já existem, inteiros ou em parte, neste banco — esta execução não alterou nada.';
  end if;
end $$;

create temp table rollout_recordes_antes on commit drop as
select (select count(*) from public.progresso)                       as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)     as xp_total,
       (select count(*) from public.xp_eventos)                      as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos)    as xp_no_ledger,
       (select count(*) from king_private.partidas)                  as partidas,
       (select count(*) from public.progresso as g
         where g.xp_total <> (select coalesce(sum(e.xp_delta), 0) from public.xp_eventos as e where e.player_id = g.player_id)) as divergentes,
       (select md5(p.prosrc) from pg_proc as p
         where p.oid = 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure) as credito_md5,
       (select md5(p.prosrc) from pg_proc as p where p.oid = 'public.xp_para_nivel(integer)'::regprocedure) as curva_md5,
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
-- RECORDES & XP V1 (Entrega D) — o placar FINAL das partidas online, pelo servidor; e o XP de cada
-- nível, lido do banco.
--
-- ══ O QUE NASCE ══
--
--   public.placares_online          uma linha por (partida, jogador): a PONTUAÇÃO FINAL do motor, a
--                                   posição e quando a partida terminou. É dela que sai o Top 3 Online
--                                   de cada um. Gravada SÓ por `registrar_placares`; lida só pelo dono.
--   king_private.registrar_placares a única porta de escrita. EXECUTE só do `king_server`, que a chama
--                                   na MESMA transação do crédito de XP (`creditar_partida`, que NÃO
--                                   muda). Idempotente: a mesma partida reenviada não grava de novo.
--   public.xp_por_nivel             o XP em que cada nível começa (1..100), pela MESMA
--                                   `public.xp_para_nivel` — o app não tem uma segunda fórmula.
--
-- ══ O QUE É UM RECORDE ══
--
-- Só partida online COMPLETA, CREDITADA e em que o jogador PARTICIPOU de verdade: a porta exige a
-- partida em `king_private.partidas` e um lançamento do jogador em `xp_eventos` com XP > 0 (quem
-- abandonou, ou jogou duas partidas sobrepostas, recebeu 0 e não entra). A POSIÇÃO vem do ledger,
-- não do pedido. O cliente nunca escreve aqui e nunca informa pontuação: quem informa é o servidor
-- autoritativo, com a pontuação do motor.
--
-- Sem histórico confiável antes da ativação: os recordes começam a contar a partir desta migração.
-- Nada é inventado para partidas antigas (elas não têm pontuação gravada em lugar nenhum).
--
-- ══ EXCLUSÃO DE CONTA ══
--
-- `player_id` referencia `players(id)` com `on delete cascade`: excluir a conta apaga os placares.
--
-- ══ ROLLBACK ══
--
-- `supabase/rollback/20261120120000_recordes_rollback.sql`: tira a tabela, a porta e a view. XP,
-- ledger, partidas e cosméticos ficam intactos.

grant create on schema public to king_progress_owner;
set role king_progress_owner;

-- ══ A TABELA ════════════════════════════════════════════════════════════════════════════════
create table public.placares_online (
  partida_id    uuid        not null references king_private.partidas (id),
  player_id     uuid        not null references public.players (id) on delete cascade,
  pontos        integer     not null,
  posicao       smallint    not null,
  terminada_em  timestamptz not null,
  registrado_em timestamptz not null default now(),
  constraint placares_online_uma_vez primary key (partida_id, player_id),
  constraint placares_online_pontos  check (pontos between -5000 and 5000),
  constraint placares_online_posicao check (posicao between 1 and 4)
);
-- O Top 3 de cada um: maior pontuação, depois a conquista mais antiga, depois a partida.
create index placares_online_top on public.placares_online (player_id, pontos desc, terminada_em, partida_id);

-- ══ A PORTA DE ESCRITA — só o servidor do jogo ════════════════════════════════════════════════
-- `p_placares`: [{"player_id": uuid, "pontos": inteiro}, ...] — campos EXATOS, de 1 a 4 jogadores.
-- Devolve quantas linhas NOVAS gravou (0 numa reentrega).
create function king_private.registrar_placares(p_partida uuid, p_placares jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item   jsonb;
  v_fim    timestamptz;
  v_vistos uuid[] := '{}';
  v_pid    uuid;
  v_gravou integer := 0;
  v_n      integer;
begin
  if p_partida is null or p_placares is null or jsonb_typeof(p_placares) <> 'array' then
    raise exception 'placares inválidos' using errcode = '22023';
  end if;
  if jsonb_array_length(p_placares) not between 1 and 4 then
    raise exception 'de um a quatro placares por partida' using errcode = '22023';
  end if;
  -- A partida tem de EXISTIR (creditada antes, na mesma transação): é dela a data da conquista.
  select p.terminada_em into v_fim from king_private.partidas as p where p.id = p_partida;
  if v_fim is null then
    raise exception 'partida não creditada' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_placares) loop
    if jsonb_typeof(v_item) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(v_item) as k) is distinct from array['player_id', 'pontos']::text[]
       or jsonb_typeof(v_item -> 'pontos') <> 'number'
       or (v_item ->> 'pontos') !~ '^-?[0-9]+$' then
      raise exception 'placar com forma inesperada' using errcode = '22023';
    end if;
    v_pid := (v_item ->> 'player_id')::uuid;
    if v_pid = any (v_vistos) then
      raise exception 'jogador repetido' using errcode = '22023';
    end if;
    v_vistos := v_vistos || v_pid;
    -- Só quem foi CREDITADO nesta partida, com XP: a posição vem do ledger, nunca do pedido.
    insert into public.placares_online (partida_id, player_id, pontos, posicao, terminada_em)
    select p_partida, e.player_id, (v_item ->> 'pontos')::integer, e.posicao, v_fim
      from public.xp_eventos as e
     where e.partida_id = p_partida and e.player_id = v_pid and e.xp_delta > 0
    on conflict on constraint placares_online_uma_vez do nothing;
    get diagnostics v_n = row_count;
    v_gravou := v_gravou + v_n;
  end loop;
  return v_gravou;
end $$;

-- ══ O XP DE CADA NÍVEL — a mesma fórmula do banco, só para ler ═══════════════════════════════════
create view public.xp_por_nivel with (security_invoker = true) as
select n::integer as nivel, public.xp_para_nivel(n)::bigint as xp
  from generate_series(1, 100) as n;

reset role;
revoke create on schema public from king_progress_owner;

-- ══ RLS ═════════════════════════════════════════════════════════════════════════════════════
alter table public.placares_online enable row level security;
create policy placares_leio_os_meus on public.placares_online
  for select to authenticated using ((select auth.uid()) = player_id);

-- ══ GRANTS — explícitos, contra os privilégios padrão permissivos do Supabase ═══════════════
revoke all on table public.placares_online from public, anon, authenticated, service_role;
grant select on table public.placares_online to authenticated;
revoke all on table public.xp_por_nivel from public, anon, authenticated, service_role;
grant select on table public.xp_por_nivel to authenticated;
revoke all on function king_private.registrar_placares(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function king_private.registrar_placares(uuid, jsonb) to king_server;

comment on table public.placares_online is
  'Pontuação FINAL de partidas online completas e creditadas, por jogador. Escrita só por king_private.registrar_placares (king_server).';
comment on function king_private.registrar_placares(uuid, jsonb) is
  'Para o servidor do jogo, na transação do crédito: grava a pontuação final de quem foi creditado com XP. Idempotente.';
comment on view public.xp_por_nivel is
  'XP total em que cada nível começa (1..100), pela mesma public.xp_para_nivel.';

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
