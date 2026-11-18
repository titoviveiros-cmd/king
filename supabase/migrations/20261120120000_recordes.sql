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
