-- CRÉDITO COM CONTA EXCLUÍDA (Fase 9) — excluir a conta não pode custar o XP dos outros.
--
-- ══ O DEFEITO (red team da Fase 9, provado em Postgres real) ══
--
-- A lista de humanos de uma partida é fixada quando ela começa: quem sai no meio continua no
-- resultado (como "não participou"). Com a exclusão de conta (Edge Function `excluir-conta`), um
-- jogador pode sair, excluir a conta e a partida terminar DEPOIS. O crédito tentava criar a linha de
-- progresso dele, a chave estrangeira para `players` reprovava (23503) e a transação inteira caía:
-- os OUTROS jogadores perdiam o XP da partida (e talvez o dia da sequência), e o servidor, que trata
-- 23503 como passageiro, repetia o crédito para sempre.
--
-- ══ A CORREÇÃO, SEM AFROUXAR NADA ══
--
-- "Excluiu a conta" e "nunca foi jogador" reprovam a chave do mesmo jeito, e a função continua sem
-- SELECT em `players` (que tem RLS). Por isso a exclusão deixa uma LÁPIDE: um gatilho em
-- `public.players` grava em `king_private.contas_excluidas` só o id aleatório da conta e a hora —
-- nenhum outro dado, sem acesso pela API. No crédito, só quem tem lápide é pulado; um id que nunca
-- foi jogador continua derrubando a transação inteira (T12 da suíte SQL, intocado).
--
-- Só o passo 3 e o filtro do passo 5 mudam; o resto da função é o MESMO texto de
-- 20260925120000_progresso.sql — as mutações da suíte SQL valem para os dois.
--
-- Corrida que sobra: a exclusão terminar entre o passo 3 e o lançamento de um jogador que JÁ tinha
-- linha de progresso. Aí a chave reprova o lançamento, o crédito cai inteiro UMA vez, e a próxima
-- tentativa do servidor (o outbox já repete 23503) encontra a lápide e conclui.
--
-- ══ APLICAÇÃO ══
--
-- SQL Editor do Supabase (papel `postgres`, que já é membro de `king_progress_owner` e dono de
-- `public.players`). Os privilégios da função de crédito (EXECUTE só para `king_server`) são
-- preservados pelo `create or replace`. Rollback:
-- supabase/rollback/20261025130000_credito_com_conta_excluida_rollback.sql.

set role king_progress_owner;

-- ══ A LÁPIDE ════════════════════════════════════════════════════════════════════════════════
-- Só o id (aleatório, sem nada que o ligue a alguém depois da exclusão) e a hora. Sem política de
-- RLS e sem GRANT: só o dono lê, e só por dentro do crédito.
create table king_private.contas_excluidas (
  player_id   uuid        primary key,
  excluida_em timestamptz not null default now()
);
alter table king_private.contas_excluidas enable row level security;
revoke all on table king_private.contas_excluidas from public;

-- SECURITY DEFINER, e só por isto: quem apaga a conta no Supabase é o papel do Auth
-- (`supabase_auth_admin`), e é com os privilégios DELE que a cascata e este gatilho rodam — provado
-- no teste X5 da suíte SQL. Ele não tem (nem deve ter) acesso a `king_private`; o gatilho roda como
-- o dono da lápide e faz uma coisa só: gravar o id que acabou de ser apagado.
create function king_private.registrar_conta_excluida() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into king_private.contas_excluidas (player_id) values (old.id)
  on conflict (player_id) do nothing;
  return null;
end $$;
revoke all on function king_private.registrar_conta_excluida() from public;

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
  v_id        uuid;
  v_excluidos uuid[] := '{}';
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

  -- ── 3. TODO HUMANO QUE AINDA EXISTE TEM LINHA DE PROGRESSO, criada em ordem determinística
  --       (`v_ids` vem ordenado). A chave estrangeira para `players` continua reprovando qualquer id
  --       que não seja jogador de verdade — sem SELECT em `players`, como desde a origem. A única
  --       exceção (Fase 9): quem EXCLUIU A CONTA, provado pela lápide em `contas_excluidas`, fica de
  --       fora sozinho, num bloco próprio, sem derrubar o crédito da mesa inteira. Quem passa fica
  --       com a linha de `players` presa pela chave até o fim da transação: uma exclusão que chegue
  --       depois espera este crédito terminar. ──
  foreach v_id in array v_ids loop
    begin
      insert into public.progresso (player_id) values (v_id)
      on conflict (player_id) do nothing;
    exception when foreign_key_violation then
      if not exists (select 1 from king_private.contas_excluidas as x where x.player_id = v_id) then
        raise;
      end if;
      v_excluidos := v_excluidos || v_id;
    end;
  end loop;

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
     -- quem excluiu a conta não ganha lançamento: não há mais jogador para recebê-lo
     where not ((e.value ->> 'player_id')::uuid = any (v_excluidos))
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

-- O gatilho mora em `public.players`, então nasce com o dono dela (`postgres`).
create trigger players_lapide_da_exclusao
  after delete on public.players
  for each row execute function king_private.registrar_conta_excluida();
