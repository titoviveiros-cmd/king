-- XP COM A PENALIDADE DO REI (Entrega C) — a regra de XP versão 2, ao lado da versão 1.
--
-- ══ A REGRA ══
--
-- Quem CAPTUROU o Rei de Copas (K♥) na mão 5 perde 60 XP sobre a recompensa BRUTA da partida online.
-- Os −160 pontos oficiais da mão não mudam: isto é só XP. A ordem é fixa:
--
--   bruto     = 100 + bônus da posição (1º +50, 2º +30, 3º +15, 4º +0) — 0 se não participou ou se a
--               partida se sobrepõe a outra do mesmo jogador (como na versão 1)
--   penalidade = 60 se capturou o Rei E o bruto é positivo; senão 0 (quem já recebe 0 não fica negativo)
--   base      = bruto − penalidade                          → 1º 90 · 2º 70 · 3º 55 · 4º 40
--   líquido   = base ÷ 4 (divisão inteira) da 7ª partida com XP do dia em diante; senão base
--   redução   = base − líquido
--
-- Com bruto ≥ 100 e penalidade 60, o líquido nunca fica abaixo de 10: o XP continua POSITIVO, então a
-- partida continua contando como "partida com XP do dia" (redução diária) e qualificando a sequência e
-- os recordes exatamente como antes. Nada é deduzido do saldo: o crédito só soma, e soma menos.
--
-- ══ POR QUE UMA PORTA NOVA, E NÃO TROCAR A ANTIGA ══
--
-- `king_private.creditar_partida` (versão 1) fica INTACTA — mesmo texto, mesmo md5, mesmos privilégios.
-- O contrato dela é estrito (campos EXATOS) e o servidor que está no ar hoje depende disso:
--
--   servidor antigo + banco novo  → continua chamando a v1: regra antiga, `versao_regra = 1`.
--   servidor novo  + banco antigo → chama a v2, recebe 42883 (função inexistente) e repete na v1.
--   servidor novo  + banco novo   → v2 para partida com o FATO da captura; v1 para a pendência antiga
--                                   do outbox, gravada antes da mudança (ela não tem o fato).
--
-- A versão de cada partida fica gravada em `king_private.partidas.versao_regra` (1 ou 2): o ledger
-- sabe sob qual regra cada crédito nasceu, e nada é recalculado para trás.
--
-- ══ O FATO, E QUEM O DÁ ══
--
-- `capturou_rei` vem do SERVIDOR autoritativo, derivado do histórico do motor (a mão "no-king"), e
-- nunca do navegador. A função recebe FATOS, como sempre: quem jogou, posição, participação e, agora,
-- quem levou o K♥. O XP continua sendo calculado aqui dentro — nem quem tem a credencial do servidor
-- escolhe quanto XP alguém ganha; no máximo afirma um fato, e no máximo UM jogador o leva.
--
-- ══ A COMPOSIÇÃO DO XP ══
--
-- `public.xp_composicao` guarda, por lançamento da v2, as quatro parcelas (bruto, penalidade do Rei,
-- redução diária, líquido) — gravadas na MESMA instrução do lançamento, presas a ele por chave
-- estrangeira, e com a soma conferida por CHECK. É dela que o Placar Final online lê o detalhamento:
-- o app mostra só o que o banco confirmou, nunca uma conta própria. Partida da v1 não tem linha aqui
-- (e o app mostra o "+N XP" de sempre). Tabela separada, e não colunas novas em `xp_eventos`, para o
-- ledger e o cliente antigo (que lê `xp_delta, posicao`) não mudarem em nada — e para o rollback ser
-- um DROP limpo.
--
-- ══ O RESTO É A V1 ══
--
-- Validação inteira antes de escrever, idempotência pela chave de `partidas`, lápide de quem excluiu
-- a conta, linha de progresso em ordem determinística, a TRAVA por jogador antes de olhar o passado,
-- sobreposição e contagem do dia: o texto abaixo é o de 20261025130000_credito_com_conta_excluida.sql,
-- com só três diferenças — o campo `capturou_rei`, `versao_regra = 2` e a regra v2 com a composição.
--
-- ══ APLICAÇÃO E ROLLBACK ══
--
-- Pelo arquivo único supabase/rollout/xp-rei-aplicar.sql (transação, recusas e conferências). Rollback:
-- supabase/rollback/20261121120000_xp_penalidade_rei_rollback.sql — tira a porta, a regra e a
-- composição; XP, ledger e partidas ficam como estão (o que foi creditado pela v2 continua creditado).

grant create on schema public to king_progress_owner;
set role king_progress_owner;

-- ══ A COMPOSIÇÃO DO XP — uma linha por lançamento da regra v2 ════════════════════════════════
create table public.xp_composicao (
  partida_id     uuid     not null,
  player_id      uuid     not null,
  motivo         text     not null default 'partida_concluida',
  versao_regra   smallint not null,
  xp_bruto       integer  not null,
  penalidade_rei integer  not null,
  reducao_diaria integer  not null,
  xp_liquido     integer  not null,
  constraint xp_composicao_uma_vez primary key (partida_id, player_id),
  -- Presa ao LANÇAMENTO: não existe composição sem crédito, e excluir a conta (que leva o lançamento
  -- em cascata) leva a composição junto.
  constraint xp_composicao_do_lancamento foreign key (partida_id, player_id, motivo)
    references public.xp_eventos (partida_id, player_id, motivo) on delete cascade,
  constraint xp_composicao_so_partida check (motivo = 'partida_concluida'),
  constraint xp_composicao_versao     check (versao_regra = 2),
  constraint xp_composicao_bruto      check (xp_bruto in (0, 100, 115, 130, 150)),
  constraint xp_composicao_penalidade check (penalidade_rei in (0, 60) and penalidade_rei <= xp_bruto),
  constraint xp_composicao_reducao    check (reducao_diaria >= 0),
  constraint xp_composicao_soma       check (xp_liquido >= 0 and xp_liquido = xp_bruto - penalidade_rei - reducao_diaria)
);
create index xp_composicao_por_jogador on public.xp_composicao (player_id);

-- ══ A REGRA DE XP (modelo M2, versão 2) ═════════════════════════════════════════════════════
-- Pura: recebe FATOS e devolve as quatro parcelas. Ver o cabeçalho para a ordem.
create function king_private.xp_da_regra_v2(
  p_posicao           smallint,
  p_participou        boolean,
  p_sobreposta        boolean,
  p_anteriores_no_dia integer,
  p_capturou_rei      boolean,
  out xp_bruto        integer,
  out penalidade_rei  integer,
  out reducao_diaria  integer,
  out xp_liquido      integer
)
language sql immutable strict
set search_path = ''
as $$
  with b as (
    select case
             when not p_participou or p_sobreposta then 0
             else 100 + case p_posicao when 1 then 50 when 2 then 30 when 3 then 15 else 0 end
           end as bruto
  ),
  p as (
    -- quem já recebe 0 (abandono, sobreposição) não recebe penalidade: XP nunca fica negativo
    select b.bruto, case when p_capturou_rei and b.bruto > 0 then 60 else 0 end as pen from b
  ),
  d as (
    -- a redução diária vem DEPOIS da penalidade, sobre o que sobrou
    select p.bruto, p.pen, p.bruto - p.pen as base,
           case when p_anteriores_no_dia >= 6 then 4 else 1 end as divisor
      from p
  )
  select d.bruto, d.pen, d.base - d.base / d.divisor, d.base / d.divisor from d
$$;

-- ══ O CRÉDITO V2 — a porta de escrita com o fato da captura ══════════════════════════════════
create function king_private.creditar_partida_v2(
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
    -- Campos EXATOS. Um `xp`, um `xp_delta`, uma `penalidade` ou qualquer outro campo reprova a chamada.
    if v_chaves is distinct from array['capturou_rei', 'participou', 'player_id', 'posicao']::text[] then
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
    if jsonb_typeof(v_item -> 'capturou_rei') <> 'boolean' then
      raise exception 'captura do Rei inválida' using errcode = '22023';
    end if;
  end loop;

  -- O K♥ é UMA carta: no máximo um jogador o capturou (nenhum, quando foi um bot).
  if (select count(*) from jsonb_array_elements(p_resultado) as e (value)
       where (e.value -> 'capturou_rei') = 'true'::jsonb) > 1 then
    raise exception 'mais de um capturador do Rei de Copas' using errcode = '22023';
  end if;

  select array_agg(distinct (e.value ->> 'player_id')::uuid order by (e.value ->> 'player_id')::uuid)
    into v_ids
    from jsonb_array_elements(p_resultado) as e (value);
  if cardinality(v_ids) <> p_humanos then
    raise exception 'jogador repetido no resultado' using errcode = '22023';
  end if;

  -- ── 2. A PARTIDA É REGISTRADA UMA VEZ SÓ, agora com a regra 2. Chegando de novo (retry, outbox,
  --       outra instância — e também se a v1 já a creditou), devolve o que já foi gravado. ──
  insert into king_private.partidas (id, iniciada_em, terminada_em, humanos, bots, versao_regra)
  values (p_partida, p_iniciada, p_terminada, p_humanos, p_bots, 2)
  on conflict (id) do nothing;
  if not found then
    return query
      select e.player_id, e.posicao, e.xp_delta, false
        from public.xp_eventos as e
       where e.partida_id = p_partida
       order by e.player_id;
    return;
  end if;

  -- ── 3. TODO HUMANO QUE AINDA EXISTE TEM LINHA DE PROGRESSO (ver a v1: lápide de quem excluiu a
  --       conta fica de fora sozinha; id que nunca foi jogador derruba tudo). ──
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
  --       alguém esperam uma pela outra AQUI, antes de olhar o passado — v1 e v2 travam a MESMA
  --       linha, então também serializam entre si. ──
  perform 1 from public.progresso as g where g.player_id = any (v_ids) order by g.player_id for update;
  -- [ponto-de-corrida]

  -- ── 5. SÓ AGORA o passado é consultado: sobreposição e quantas partidas com XP no dia. ──
  v_dia := (p_terminada at time zone 'America/Sao_Paulo')::date;

  return query
  with r as (
    select (e.value ->> 'player_id')::uuid      as pid,
           (e.value ->> 'posicao')::smallint     as pos,
           (e.value ->> 'participou')::boolean   as participou,
           (e.value ->> 'capturou_rei')::boolean as capturou_rei
      from jsonb_array_elements(p_resultado) as e (value)
     -- quem excluiu a conta não ganha lançamento: não há mais jogador para recebê-lo
     where not ((e.value ->> 'player_id')::uuid = any (v_excluidos))
  ),
  fatos as (
    select r.pid, r.pos, r.participou, r.capturou_rei,
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
    select f.pid, f.pos, x.xp_bruto, x.penalidade_rei, x.reducao_diaria, x.xp_liquido
      from fatos as f
      cross join lateral king_private.xp_da_regra_v2(f.pos, f.participou, f.sobreposta, f.anteriores_no_dia, f.capturou_rei) as x
  ),
  lancados as (
    insert into public.xp_eventos (player_id, partida_id, motivo, posicao, xp_delta)
    select c.pid, p_partida, 'partida_concluida', c.pos, c.xp_liquido from calculo as c
    on conflict on constraint xp_eventos_uma_vez do nothing
    returning xp_eventos.player_id, xp_eventos.posicao, xp_eventos.xp_delta
  ),
  -- A composição nasce na MESMA instrução, só para o que foi lançado agora.
  compostos as (
    insert into public.xp_composicao (partida_id, player_id, versao_regra, xp_bruto, penalidade_rei, reducao_diaria, xp_liquido)
    select p_partida, c.pid, 2, c.xp_bruto, c.penalidade_rei, c.reducao_diaria, c.xp_liquido
      from calculo as c
      join lancados as l on l.player_id = c.pid
    returning xp_composicao.player_id
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
revoke create on schema public from king_progress_owner;

-- ══ RLS ═════════════════════════════════════════════════════════════════════════════════════
-- Leitura: só a própria composição. Escrita: nenhuma política — e nenhum GRANT de escrita.
alter table public.xp_composicao enable row level security;
create policy xp_composicao_leio_a_minha on public.xp_composicao
  for select to authenticated using ((select auth.uid()) = player_id);

-- ══ GRANTS — explícitos, contra os privilégios padrão permissivos do Supabase ═══════════════
revoke all on table public.xp_composicao from public, anon, authenticated, service_role;
grant select on table public.xp_composicao to authenticated;
revoke all on function king_private.xp_da_regra_v2(smallint, boolean, boolean, integer, boolean)
  from public, anon, authenticated, service_role, king_server;
revoke all on function king_private.creditar_partida_v2(uuid, timestamptz, timestamptz, smallint, smallint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function king_private.creditar_partida_v2(uuid, timestamptz, timestamptz, smallint, smallint, jsonb)
  to king_server;

comment on table public.xp_composicao is
  'Parcelas do XP de cada lançamento da regra v2 (bruto, penalidade do Rei, redução diária, líquido). Escrita só por king_private.creditar_partida_v2.';
comment on function king_private.creditar_partida_v2(uuid, timestamptz, timestamptz, smallint, smallint, jsonb) is
  'Regra de XP v2: recebe o RESULTADO autoritativo com o fato da captura do K♥ (nunca XP), calcula e grava de forma idempotente.';
