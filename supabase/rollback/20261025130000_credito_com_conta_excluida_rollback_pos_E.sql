-- ROLLBACK PÓS-E de 20261025130000_credito_com_conta_excluida.sql.
--
-- Devolve a função de crédito ORIGINAL (o texto de 20260925120000_progresso.sql) e PRESERVA a lápide
-- (`king_private.contas_excluidas`) e o gatilho `players_lapide_da_exclusao`. É o rollback do passo D
-- depois que a função excluir-conta (passo E) foi ao ar. O _rollback.sql comum apaga as lápides e
-- recusa rodar quando existe alguma.
--
-- ══ POR QUE A LÁPIDE FICA ══
--
-- A função original nem lê a lápide, então ela não muda nada enquanto este rollback valer. Mas é o
-- único registro de quem excluiu a conta: sem ela, um crédito com conta excluída volta a ser "jogador
-- que nunca existiu", derruba a transação (23503) e o outbox o repete para sempre — o XP da mesa inteira
-- se perde. Com ela, basta reaplicar a função nova para todo crédito pendente fechar.
--
-- ══ ORDEM OPERACIONAL — OBRIGATÓRIA ══
--
--   1. Despublicar a função excluir-conta (nenhuma exclusão nova pode acontecer com a função antiga).
--   2. Na VPS, o outbox do progresso precisa estar VAZIO: `ls -la /var/lib/king/progresso-outbox`
--      sem nenhum .json. Um crédito pendente com conta excluída só fecha com a função nova.
--   3. Colar ESTE arquivo inteiro no SQL Editor e rodar UMA vez. É uma transação: qualquer
--      divergência levanta "ROLLBACK PÓS-E ABORTADO"/"CONFERÊNCIA N FALHOU" e NADA é aplicado — nesse
--      caso, parar e não rodar outro SQL. Esperado na última tela: "ROLLBACK PÓS-E APLICADO".
--   4. Para desfazer este rollback (voltar à correção), reaplicar SÓ a função de
--      20261025130000_credito_com_conta_excluida.sql: a lápide e o gatilho já estão lá.
--
-- Rodar de novo é recusado ("já está na função original"), sem mudar nada.
-- Função original: sha256 56eb24d1556f9e26f0e4014d8e24cd3cefdbd1baffacbd6e3086f3da8f3af68c (texto de 20260925120000_progresso.sql).
begin;

set local lock_timeout = '5s';
lock table public.progresso in share row exclusive mode;
-- O expurgo das lápides (E-2) espera o fim daqui: sem isto, um expurgo no meio mudaria a contagem da
-- CONFERÊNCIA 4 e abortaria o rollback à toa.
lock table king_private.contas_excluidas in share mode;

create temp table rollback_pos_e_antes on commit drop as
select (select count(*) from public.players)                     as jogadores,
       (select count(*) from public.progresso)                   as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso) as xp_total,
       (select count(*) from public.xp_eventos)                  as lancamentos,
       (select count(*) from king_private.partidas)              as partidas,
       (select count(*) from king_private.contas_excluidas)      as lapides,
       has_function_privilege('king_server',   'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)', 'execute') as exec_king_server,
       has_function_privilege('anon',          'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)', 'execute') as exec_anon,
       has_function_privilege('authenticated', 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)', 'execute') as exec_authenticated,
       has_function_privilege('service_role',  'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)', 'execute') as exec_service_role,
       has_function_privilege('public',        'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)', 'execute') as exec_public;

do $preflight$
declare
  f regprocedure := to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)');
  src text;
begin
  if not pg_has_role(current_user, 'king_progress_owner', 'MEMBER') or not pg_has_role(current_user, 'king_progress_owner', 'USAGE')
     or not pg_has_role(current_user, 'king_progress_owner', 'SET') then
    raise exception 'ROLLBACK PÓS-E ABORTADO: % não herda king_progress_owner. Nada foi alterado.', current_user;
  end if;
  if to_regclass('king_private.contas_excluidas') is null
     or to_regprocedure('king_private.registrar_conta_excluida()') is null
     or not exists (select 1 from pg_trigger where tgname = 'players_lapide_da_exclusao') then
    raise exception 'ROLLBACK PÓS-E ABORTADO: o passo D não está aplicado (lápide, função ou gatilho ausentes). Nada foi alterado.';
  end if;
  if f is null then
    raise exception 'ROLLBACK PÓS-E ABORTADO: a função de crédito não existe. Nada foi alterado.';
  end if;
  select p.prosrc into src from pg_proc as p where p.oid = f;
  if position('contas_excluidas' in src) = 0 then
    raise exception 'ROLLBACK PÓS-E ABORTADO: a função de crédito já está na original — nada a fazer. Nada foi alterado.';
  end if;
  if not (select a.exec_king_server from rollback_pos_e_antes as a) then
    raise exception 'ROLLBACK PÓS-E ABORTADO: king_server não executa a função de crédito hoje. Nada foi alterado.';
  end if;
end
$preflight$;

set role king_progress_owner;

create or replace function king_private.creditar_partida(
  p_partida   uuid,
  p_iniciada  timestamptz,
  p_terminada timestamptz,
  p_humanos   smallint,
  p_bots      smallint,
  p_resultado jsonb
) returns table (player_id uuid, posicao smallint, xp_delta integer, novo boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_item   jsonb;
  v_chaves text[];
  v_ids    uuid[];
  v_dia    date;
begin
  -- ── 1. O RESULTADO É VALIDADO INTEIRO ANTES DE QUALQUER ESCRITA. Nada é ignorado: o que não
  --       bate com o contrato reprova a chamada. ──
  if p_partida is null or p_iniciada is null or p_terminada is null
     or p_humanos is null or p_bots is null or p_resultado is null then
    raise exception 'resultado incompleto' using errcode = '22023';
  end if;
  if p_iniciada >= p_terminada then
    raise exception 'o início da partida não é anterior ao fim' using errcode = '22023';
  end if;
  if p_terminada > now() + interval '5 minutes' then
    raise exception 'fim da partida no futuro' using errcode = '22023';
  end if;
  if p_humanos < 2 or p_humanos > 4 or p_bots < 0 or p_humanos + p_bots <> 4 then
    raise exception 'composição inválida' using errcode = '22023';
  end if;
  if jsonb_typeof(p_resultado) <> 'array' or jsonb_array_length(p_resultado) <> p_humanos then
    raise exception 'o resultado não traz exatamente os humanos declarados' using errcode = '22023';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_resultado) as e (value) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'entrada de resultado não é objeto' using errcode = '22023';
    end if;
    select array_agg(k.chave order by k.chave) into v_chaves
      from jsonb_object_keys(v_item) as k (chave);
    -- Campos EXATOS. Um `xp`, um `xp_delta` ou qualquer outro campo reprova a chamada.
    if v_chaves is distinct from array['participou', 'player_id', 'posicao']::text[] then
      raise exception 'entrada de resultado com campos inesperados' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item -> 'player_id') <> 'string'
       or (v_item ->> 'player_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'player_id inválido (bot e id sorteado não entram no crédito)' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item -> 'posicao') <> 'number' or (v_item ->> 'posicao') !~ '^[1-4]$' then
      raise exception 'posição inválida' using errcode = '22023';
    end if;
    if jsonb_typeof(v_item -> 'participou') <> 'boolean' then
      raise exception 'participação inválida' using errcode = '22023';
    end if;
  end loop;

  select array_agg(distinct (e.value ->> 'player_id')::uuid order by (e.value ->> 'player_id')::uuid)
    into v_ids
    from jsonb_array_elements(p_resultado) as e (value);
  if cardinality(v_ids) <> p_humanos then
    raise exception 'jogador repetido no resultado' using errcode = '22023';
  end if;

  -- ── 2. A PARTIDA É REGISTRADA UMA VEZ SÓ. Chegando de novo (retry, outbox, outra instância),
  --       devolve o que já foi gravado e não toca em nada. ──
  insert into king_private.partidas (id, iniciada_em, terminada_em, humanos, bots, versao_regra)
  values (p_partida, p_iniciada, p_terminada, p_humanos, p_bots, 1)
  on conflict (id) do nothing;
  if not found then
    return query
      select e.player_id, e.posicao, e.xp_delta, false
        from public.xp_eventos as e
       where e.partida_id = p_partida
       order by e.player_id;
    return;
  end if;

  -- ── 3. TODO HUMANO TEM LINHA DE PROGRESSO, criada em ordem determinística. A chave
  --       estrangeira para `players` reprova aqui qualquer id que não seja jogador de verdade. ──
  insert into public.progresso (player_id)
  select u.id from unnest(v_ids) as u (id) order by u.id
  on conflict (player_id) do nothing;

  -- ── 4. A TRAVA. Uma linha por jogador, sempre na mesma ordem. Duas partidas que dividem
  --       alguém esperam uma pela outra AQUI, antes de olhar o passado. ──
  perform 1 from public.progresso as g where g.player_id = any (v_ids) order by g.player_id for update;
  -- [ponto-de-corrida]

  -- ── 5. SÓ AGORA o passado é consultado: sobreposição e quantas partidas com XP no dia. ──
  v_dia := (p_terminada at time zone 'America/Sao_Paulo')::date;

  return query
  with r as (
    select (e.value ->> 'player_id')::uuid      as pid,
           (e.value ->> 'posicao')::smallint     as pos,
           (e.value ->> 'participou')::boolean   as participou
      from jsonb_array_elements(p_resultado) as e (value)
  ),
  fatos as (
    select r.pid, r.pos, r.participou,
           exists (
             select 1
               from public.xp_eventos as e
               join king_private.partidas as q on q.id = e.partida_id
              where e.player_id = r.pid
                and q.id <> p_partida
                and q.iniciada_em < p_terminada
                and q.terminada_em > p_iniciada
           ) as sobreposta,
           (
             select count(*)::integer
               from public.xp_eventos as e
               join king_private.partidas as q on q.id = e.partida_id
              where e.player_id = r.pid
                and e.xp_delta > 0
                and (q.terminada_em at time zone 'America/Sao_Paulo')::date = v_dia
           ) as anteriores_no_dia
      from r
  ),
  calculo as (
    select f.pid, f.pos,
           king_private.xp_da_regra(f.pos, f.participou, f.sobreposta, f.anteriores_no_dia) as xp
      from fatos as f
  ),
  lancados as (
    insert into public.xp_eventos (player_id, partida_id, motivo, posicao, xp_delta)
    select c.pid, p_partida, 'partida_concluida', c.pos, c.xp from calculo as c
    on conflict on constraint xp_eventos_uma_vez do nothing
    returning xp_eventos.player_id, xp_eventos.posicao, xp_eventos.xp_delta
  ),
  somados as (
    update public.progresso as g
       set xp_total = g.xp_total + l.xp_delta,
           atualizado_em = now()
      from lancados as l
     where g.player_id = l.player_id
    returning g.player_id
  )
  select l.player_id, l.posicao, l.xp_delta, true from lancados as l order by l.player_id;
end $$;

reset role;

do $conferencias$
declare
  f regprocedure := to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)');
  a record;
begin
  select * into a from rollback_pos_e_antes;
  if current_user <> session_user then
    raise exception 'CONFERÊNCIA 0 FALHOU: a sessão não voltou ao papel original (%). Nada foi gravado.', current_user;
  end if;
  if position('contas_excluidas' in pg_get_functiondef(f)) > 0
     or position('select u.id from unnest(v_ids) as u (id) order by u.id' in pg_get_functiondef(f)) = 0 then
    raise exception 'CONFERÊNCIA 1 FALHOU: a função de crédito não voltou à original. Nada foi gravado.';
  end if;
  if not has_function_privilege('king_server', f, 'execute')
     or has_function_privilege('anon', f, 'execute')          is distinct from a.exec_anon
     or has_function_privilege('authenticated', f, 'execute') is distinct from a.exec_authenticated
     or has_function_privilege('service_role', f, 'execute')  is distinct from a.exec_service_role
     or has_function_privilege('public', f, 'execute')        is distinct from a.exec_public then
    raise exception 'CONFERÊNCIA 2 FALHOU: os privilégios da função de crédito mudaram. Nada foi gravado.';
  end if;
  if (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = f) <> 'king_progress_owner'
     or not (select p.prosecdef from pg_proc as p where p.oid = f)
     or (select p.proconfig from pg_proc as p where p.oid = f) is distinct from array['search_path=""']
     or pg_get_function_result(f) <> 'TABLE(player_id uuid, posicao smallint, xp_delta integer, novo boolean)' then
    raise exception 'CONFERÊNCIA 3 FALHOU: dono, SECURITY DEFINER, search_path ou retorno da função de crédito mudaram. Nada foi gravado.';
  end if;
  if (select count(*) from king_private.contas_excluidas) <> a.lapides
     or not exists (select 1 from pg_trigger as tg where tg.tgname = 'players_lapide_da_exclusao'
                     and tg.tgrelid = 'public.players'::regclass and tg.tgenabled = 'O')
     or to_regprocedure('king_private.registrar_conta_excluida()') is null then
    raise exception 'CONFERÊNCIA 4 FALHOU: a lápide, o gatilho ou a função da lápide não ficaram intactos. Nada foi gravado.';
  end if;
  if (select count(*) from public.players) <> a.jogadores
     or (select count(*) from public.progresso) <> a.linhas_de_progresso
     or (select coalesce(sum(xp_total), 0) from public.progresso) <> a.xp_total
     or (select count(*) from public.xp_eventos) <> a.lancamentos
     or (select count(*) from king_private.partidas) <> a.partidas then
    raise exception 'CONFERÊNCIA 5 FALHOU: jogadores, XP, ledger ou partidas mudaram. Nada foi gravado.';
  end if;
end
$conferencias$;

commit;

select 'ROLLBACK PÓS-E APLICADO' as resultado,
       position('contas_excluidas' in pg_get_functiondef('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure)) = 0 as credito_original,
       has_function_privilege('king_server', 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)', 'execute') as servidor,
       exists (select 1 from pg_trigger where tgname = 'players_lapide_da_exclusao') as gatilho_preservado,
       (select count(*) from king_private.contas_excluidas) as lapides_preservadas;
