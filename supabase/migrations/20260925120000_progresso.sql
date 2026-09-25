-- PROGRESSO DO KING — XP e nível, com uma autoridade só.
--
-- ══ A REGRA QUE GOVERNA ESTE ARQUIVO ══
--
-- O XP nasce do resultado que o SERVIDOR DA PARTIDA já decidiu. O cliente nunca informa XP, nunca
-- escreve total e nunca chama a função que credita. Quem chama é o papel `king_server`, que só
-- tem EXECUTE numa função, e essa função recebe o RESULTADO — posição e participação — e calcula o
-- XP aqui dentro. Nem quem tem a credencial do servidor escolhe quanto XP alguém ganha.
--
-- ══ POR QUE NÃO `public.players.xp` ══
--
-- A política "cada um atualiza o próprio perfil" deixa o jogador editar QUALQUER coluna da própria
-- linha em `players`, direto pela API. Uma coluna de XP ali seria editável por quem quisesse. O
-- progresso mora em tabelas próprias, que o cliente só lê.
--
-- ══ OS DOIS PAPÉIS ══
--
--   king_progress_owner — NOLOGIN, NOINHERIT. Dono das tabelas e das funções. É com os privilégios
--                         DELE que a função de crédito roda, e não com os do papel `postgres`.
--   king_server         — NOLOGIN, NOINHERIT nesta migração. EXECUTE em UMA função e nada mais:
--                         nenhum privilégio de tabela. O LOGIN e a senha são dados de operação e
--                         nunca entram no repositório.
--
-- ══ IDEMPOTÊNCIA E CONCORRÊNCIA ══
--
-- Uma partida é registrada UMA vez (chave primária de `partidas`), e cada jogador recebe UM
-- lançamento por partida (`xp_eventos_uma_vez`). Retry, reconexão e reprocessamento do outbox
-- reenviam o mesmo `id` e recebem de volta o que já foi gravado.
--
-- Duas partidas DIFERENTES do mesmo jogador chegando juntas são o caso difícil: as duas olhariam o
-- passado ao mesmo tempo, veriam "nenhuma sobreposição" e "menos de 6 hoje", e as duas levariam XP
-- cheio. Por isso, antes de olhar o passado, a função TRAVA a linha de progresso de cada jogador
-- envolvido, em ordem de `player_id` — duas transações que dividem alguém serializam, e a ordem
-- fixa impede deadlock.
--
-- ══ NÍVEL NÃO É ARMAZENADO ══
--
-- Ele é derivado de `xp_total` por `public.nivel_de`. Guardar o nível seria criar uma segunda
-- verdade que um dia discordaria da primeira.

-- ══ PAPÉIS ══════════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'king_progress_owner') then
    create role king_progress_owner nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'king_server') then
    create role king_server nologin noinherit;
  end if;
end $$;

-- Quem aplica a migração precisa poder criar objetos EM NOME do dono dedicado.
grant king_progress_owner to current_user;

-- ══ SCHEMA PRIVADO ══════════════════════════════════════════════════════════════════════════
-- Fora dos schemas expostos pela API. `king_server` precisa só de USAGE para achar a função.
create schema if not exists king_private authorization king_progress_owner;
revoke all on schema king_private from public;
grant usage on schema king_private to king_server;

-- O dono precisa: achar `public`, REFERENCIAR `players(id)` pela chave estrangeira e, só durante
-- esta migração, CRIAR objetos em `public`. Nenhum SELECT em `players`: a existência do jogador é
-- conferida pela própria chave estrangeira, que ignora RLS por definição do Postgres.
grant usage on schema public to king_progress_owner;
grant references (id) on table public.players to king_progress_owner;
grant create on schema public to king_progress_owner;

set role king_progress_owner;

-- ══ TABELAS ═════════════════════════════════════════════════════════════════════════════════

-- Uma linha por partida CREDITADA. Sem acesso pela API.
create table king_private.partidas (
  id            uuid        primary key,          -- `crypto.randomUUID()` do servidor, no início
  iniciada_em   timestamptz not null,
  terminada_em  timestamptz not null,
  humanos       smallint    not null,
  bots          smallint    not null,
  versao_regra  smallint    not null,
  registrada_em timestamptz not null default now(),
  constraint partidas_composicao check (humanos between 2 and 4 and bots between 0 and 2 and humanos + bots = 4),
  constraint partidas_duracao    check (terminada_em > iniciada_em)
);

-- O LEDGER. É ele a verdade do XP; `progresso` é um agregado conferível contra ele.
create table public.xp_eventos (
  id          bigint      generated always as identity primary key,
  player_id   uuid        not null references public.players (id) on delete cascade,
  partida_id  uuid        not null references king_private.partidas (id),
  motivo      text        not null,
  posicao     smallint    not null,
  xp_delta    integer     not null,
  criado_em   timestamptz not null default now(),
  constraint xp_eventos_uma_vez unique (partida_id, player_id, motivo),
  constraint xp_eventos_motivo  check (motivo in ('partida_concluida')),
  constraint xp_eventos_posicao check (posicao between 1 and 4),
  constraint xp_eventos_delta   check (xp_delta between 0 and 150)
);
create index xp_eventos_por_jogador on public.xp_eventos (player_id, criado_em desc);

-- O AGREGADO. Uma linha por jogador que já teve partida creditada.
create table public.progresso (
  player_id     uuid        primary key references public.players (id) on delete cascade,
  xp_total      integer     not null default 0,
  atualizado_em timestamptz not null default now(),
  constraint progresso_xp_nao_negativo check (xp_total >= 0)
);

-- ══ NÍVEL — derivado, nunca armazenado ══════════════════════════════════════════════════════
-- XP total para ESTAR no nível L: 25·(L−1)·(L+2). Subir de n para n+1 custa 50·n + 50.
create function public.xp_para_nivel(p_nivel integer) returns bigint
language sql immutable strict
set search_path = ''
as $$
  select 25::bigint * (p_nivel - 1) * (p_nivel + 2)
$$;

create function public.nivel_de(p_xp integer) returns integer
language plpgsql immutable strict
set search_path = ''
as $$
declare
  n integer;
begin
  if p_xp < 0 then
    raise exception 'xp negativo' using errcode = '22023';
  end if;
  -- inversa da fórmula; a raiz em ponto flutuante pode errar por um na borda, e os dois laços
  -- abaixo corrigem com aritmética inteira
  n := greatest(1, floor((-1 + sqrt(9 + 4 * p_xp / 25.0)) / 2)::integer);
  while public.xp_para_nivel(n + 1) <= p_xp loop
    n := n + 1;
  end loop;
  while n > 1 and public.xp_para_nivel(n) > p_xp loop
    n := n - 1;
  end loop;
  return n;
end $$;

-- ══ A REGRA DE XP (modelo M2, versão 1) ═════════════════════════════════════════════════════
-- Pura: recebe FATOS e devolve XP. Quem busca os fatos é `creditar_partida`, depois da trava.
--   concluiu (participou): 100 · bônus 1º +50, 2º +30, 3º +15, 4º +0 (empate = posição dividida)
--   abandono ou partida sobreposta a outra do mesmo jogador: 0
--   REDUÇÃO APÓS 6 PARTIDAS: da 7ª partida com XP do dia em diante, 25% (divisão inteira)
create function king_private.xp_da_regra(
  p_posicao           smallint,
  p_participou        boolean,
  p_sobreposta        boolean,
  p_anteriores_no_dia integer
) returns integer
language sql immutable strict
set search_path = ''
as $$
  select case
    when not p_participou or p_sobreposta then 0
    else (100 + case p_posicao when 1 then 50 when 2 then 30 when 3 then 15 else 0 end)
         / case when p_anteriores_no_dia >= 6 then 4 else 1 end
  end
$$;

-- ══ O CRÉDITO — a única porta de escrita ════════════════════════════════════════════════════
create function king_private.creditar_partida(
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

-- O dono não precisa mais criar nada em `public`.
revoke create on schema public from king_progress_owner;

-- ══ LEITURA DO PRÓPRIO PROGRESSO ════════════════════════════════════════════════════════════
-- `security_invoker`: quem lê é o próprio jogador, sujeito ao RLS das tabelas. Sem linha em
-- `progresso` (nunca creditado), devolve XP 0 e nível 1 — ninguém precisa de linha para existir.
create view public.meu_progresso with (security_invoker = true) as
select auth.uid()                                                               as player_id,
       x.xp_total,
       public.nivel_de(x.xp_total)                                              as nivel,
       (x.xp_total - public.xp_para_nivel(public.nivel_de(x.xp_total)))::integer as xp_no_nivel,
       (public.xp_para_nivel(public.nivel_de(x.xp_total) + 1)
          - public.xp_para_nivel(public.nivel_de(x.xp_total)))::integer          as xp_do_nivel
  from (
    select coalesce((select g.xp_total from public.progresso as g where g.player_id = auth.uid()), 0) as xp_total
  ) as x
 where auth.uid() is not null;

-- ══ RLS ═════════════════════════════════════════════════════════════════════════════════════
-- Leitura: só a própria linha. Escrita: nenhuma política — e, abaixo, nenhum GRANT de escrita.
alter table public.xp_eventos   enable row level security;
alter table public.progresso    enable row level security;
alter table king_private.partidas enable row level security;

create policy xp_eventos_leio_os_meus on public.xp_eventos
  for select to authenticated using ((select auth.uid()) = player_id);
create policy progresso_leio_o_meu on public.progresso
  for select to authenticated using ((select auth.uid()) = player_id);

-- ══ GRANTS — todos explícitos, sem depender de privilégio padrão ════════════════════════════
revoke all on table king_private.partidas from public;
revoke all on table public.xp_eventos   from public, anon, authenticated;
revoke all on table public.progresso    from public, anon, authenticated;
revoke all on table public.meu_progresso from public, anon, authenticated;
revoke all on sequence public.xp_eventos_id_seq from public, anon, authenticated;

grant select on table public.xp_eventos    to authenticated;
grant select on table public.progresso     to authenticated;
grant select on table public.meu_progresso to authenticated;

revoke all on function public.xp_para_nivel(integer) from public, anon, authenticated;
revoke all on function public.nivel_de(integer)      from public, anon, authenticated;
grant execute on function public.xp_para_nivel(integer) to authenticated;
grant execute on function public.nivel_de(integer)      to authenticated;

revoke all on function king_private.xp_da_regra(smallint, boolean, boolean, integer)
  from public, anon, authenticated, king_server;
revoke all on function king_private.creditar_partida(uuid, timestamptz, timestamptz, smallint, smallint, jsonb)
  from public, anon, authenticated;
grant execute on function king_private.creditar_partida(uuid, timestamptz, timestamptz, smallint, smallint, jsonb)
  to king_server;

comment on table public.xp_eventos is 'Ledger de XP. Escrito só por king_private.creditar_partida.';
comment on table public.progresso  is 'Agregado de XP por jogador; conferível contra a soma de xp_eventos.';
comment on function king_private.creditar_partida(uuid, timestamptz, timestamptz, smallint, smallint, jsonb) is
  'Recebe o RESULTADO autoritativo da partida (nunca XP), calcula e grava de forma idempotente.';
