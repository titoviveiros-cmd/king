-- ROLLBACK de 20261025130000_credito_com_conta_excluida.sql — devolve a função de crédito ORIGINAL
-- (texto de 20260925120000_progresso.sql) e remove a lápide. Nenhum dado de jogador é tocado.
-- Atenção: sem a correção, uma conta excluída antes do crédito volta a derrubar o XP da mesa inteira.
--
-- SÓ ANTES DO PASSO E, sem nenhuma exclusão real. Depois que a função excluir-conta foi ao ar, este
-- arquivo é PROIBIDO: ele apaga as lápides, e sem elas um crédito pendente com conta excluída derruba
-- o XP da mesa inteira para sempre (o outbox repete o 23503). Ele mesmo recusa rodar se houver lápide.
-- Depois do E: 20261025130000_credito_com_conta_excluida_rollback_pos_E.sql.
--
-- "Não há lápide" deixou de provar "não houve exclusão" quando a retenção (E-2, 20261026120000)
-- passou a expurgar lápide vencida. Por isso este arquivo também recusa enquanto existir o estado do
-- expurgo: com a E-2 aplicada, desfaça-a primeiro; se o rollback dela MANTIVER o estado, é porque
-- alguma lápide já foi removida — houve exclusão real, e este arquivo não vale mais.
begin;

do $$
begin
  if to_regclass('king_private.contas_excluidas') is not null
     and exists (select 1 from king_private.contas_excluidas) then
    raise exception 'ROLLBACK RECUSADO: há lápides em king_private.contas_excluidas — use o rollback pós-E (20261025130000_credito_com_conta_excluida_rollback_pos_E.sql). Nada foi alterado.';
  end if;
  if to_regclass('king_private.expurgo_das_lapides') is not null then
    raise exception 'ROLLBACK RECUSADO: a retenção das lápides (E-2) está aplicada ou já expurgou lápide — rode antes supabase/rollback/20261026120000_retencao_das_lapides_rollback.sql; se ele mantiver o estado do expurgo, houve exclusão real: use o rollback pós-E. Nada foi alterado.';
  end if;
end $$;

drop trigger if exists players_lapide_da_exclusao on public.players;

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

drop function if exists king_private.registrar_conta_excluida();
drop table if exists king_private.contas_excluidas;

reset role;

commit;
