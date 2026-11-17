-- COSMÉTICOS DESBLOQUEÁVEIS POR NÍVEL (Entrega B) — três itens, catálogo fechado.
--
-- ══ O CATÁLOGO ══
--
--   nível 2 → 'moldura-real'      moldura na identidade do jogador; os quatro da mesa veem
--   nível 4 → 'baralho-imperial'  acabamento das cartas; só no aparelho de quem equipou
--   nível 6 → 'reacao-coroa'      uma reação a mais no sistema social de sempre
--
-- Nada além disso: sem moeda, sem loja, sem sorteio, sem item "ganho" guardado. DESBLOQUEADO é uma
-- conta, não um registro: `nivel_de(progresso.xp_total) >= nível do item`. O XP só cresce (o ledger
-- só tem delta >= 0, e só `creditar_partida` escreve), então o nível nunca cai e o item nunca some.
-- Partida contra bots nunca chega ao banco e por isso nunca desbloqueia nada.
--
-- ══ O QUE É GUARDADO ══
--
-- Só a ESCOLHA do jogador: equipado ou não, por item. Uma linha por jogador, em tabela própria e
-- NÃO em `public.players` — lá a política "cada um atualiza o próprio perfil" deixa o dono editar
-- qualquer coluna, e um "equipado" ali seria gravável por quem quisesse, sem conferir nível.
--
-- ══ AS TRÊS PORTAS ══
--
--   leitura própria   `select` na própria linha (RLS). Sem nenhum GRANT de escrita ao cliente.
--   escrita           `public.equipar_cosmetico(item, equipado)` — SECURITY DEFINER. Confere quem é
--                     (o `sub` do JWT, a mesma fonte do `auth.uid()`), confere o catálogo e, para
--                     EQUIPAR, confere o nível no próprio banco. Desequipar é sempre permitido.
--   leitura da sala   `king_private.cosmeticos_da_sala(ids)` — EXECUTE só do `king_server`, no
--                     máximo quatro ids por chamada, e devolve só o EFEITO (equipado E com nível),
--                     nunca XP. É assim que a moldura e a reação chegam aos quatro aparelhos sem que
--                     nenhum cliente diga "estou equipado".
--
-- ══ EXCLUSÃO DE CONTA ══
--
-- `player_id` referencia `players(id)` com `on delete cascade`, e `players` cai junto com
-- `auth.users`: excluir a conta apaga a escolha. Nada aqui segura a exclusão.
--
-- ══ ROLLBACK ══
--
-- `supabase/rollback/20261117120000_cosmeticos_rollback.sql`. Esta migração só ACRESCENTA (uma
-- tabela e três funções) e não toca em `progresso`, `xp_eventos`, `players` nem no crédito.

grant create on schema public to king_progress_owner;
set role king_progress_owner;

-- ══ TABELA ══════════════════════════════════════════════════════════════════════════════════
create table public.cosmeticos_equipados (
  player_id        uuid        primary key references public.players (id) on delete cascade,
  moldura_real     boolean     not null default false,
  baralho_imperial boolean     not null default false,
  reacao_coroa     boolean     not null default false,
  atualizado_em    timestamptz not null default now()
);

-- ══ CATÁLOGO — a única tabela de níveis, dentro do banco ══════════════════════════════════════
-- `null` para o que não está no catálogo: quem chama recusa.
create function king_private.nivel_do_cosmetico(p_item text) returns integer
language sql immutable
set search_path = ''
as $$
  select case p_item
    when 'moldura-real'     then 2
    when 'baralho-imperial' then 4
    when 'reacao-coroa'     then 6
  end
$$;

-- ══ EQUIPAR / DESEQUIPAR — a única porta de escrita ═════════════════════════════════════════
create function public.equipar_cosmetico(p_item text, p_equipado boolean)
returns table (moldura_real boolean, baralho_imperial boolean, reacao_coroa boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- QUEM É: o `sub` do JWT verificado, lido do MESMO lugar que `auth.uid()` lê. Não se chama
  -- `auth.uid()` aqui porque esta função roda como `king_progress_owner`, e esse papel não tem (nem
  -- deve ter) acesso ao schema `auth` do Supabase. O valor vem do PostgREST, por requisição; o
  -- cliente não alcança `set_config` pela API.
  v_uid   uuid := nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid;
  v_exige integer := king_private.nivel_do_cosmetico(p_item);
  v_xp    integer;
begin
  if v_uid is null then
    raise exception 'sem identidade' using errcode = '42501';
  end if;
  if v_exige is null or p_equipado is null then
    raise exception 'item fora do catálogo' using errcode = '22023';
  end if;
  -- O NÍVEL É O DO BANCO. Nada que o cliente mande entra nesta conta.
  if p_equipado then
    v_xp := coalesce((select g.xp_total from public.progresso as g where g.player_id = v_uid), 0);
    if public.nivel_de(v_xp) < v_exige then
      raise exception 'nível insuficiente' using errcode = '42501';
    end if;
  end if;

  return query
  insert into public.cosmeticos_equipados as c (player_id, moldura_real, baralho_imperial, reacao_coroa)
  values (v_uid,
          p_item = 'moldura-real'     and p_equipado,
          p_item = 'baralho-imperial' and p_equipado,
          p_item = 'reacao-coroa'     and p_equipado)
  on conflict (player_id) do update set
    moldura_real     = case when p_item = 'moldura-real'     then p_equipado else c.moldura_real end,
    baralho_imperial = case when p_item = 'baralho-imperial' then p_equipado else c.baralho_imperial end,
    reacao_coroa     = case when p_item = 'reacao-coroa'     then p_equipado else c.reacao_coroa end,
    atualizado_em    = now()
  returning c.moldura_real, c.baralho_imperial, c.reacao_coroa;
end $$;

-- ══ LEITURA DA SALA — só o servidor do jogo, só o efeito ═══════════════════════════════════════
-- Efeito = equipado E com nível hoje (defesa em profundidade: a escrita já conferiu). O baralho não
-- sai daqui: ele é do aparelho de quem equipou, e a sala não tem o que fazer com ele.
create function king_private.cosmeticos_da_sala(p_ids uuid[])
returns table (player_id uuid, moldura_real boolean, reacao_coroa boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  -- Uma mesa tem quatro assentos. Mais que isso não é uma sala: é uma varredura.
  if cardinality(p_ids) > 4 then
    raise exception 'no máximo quatro jogadores por consulta' using errcode = '22023';
  end if;
  return query
  select c.player_id,
         c.moldura_real and public.nivel_de(coalesce(g.xp_total, 0)) >= king_private.nivel_do_cosmetico('moldura-real'),
         c.reacao_coroa and public.nivel_de(coalesce(g.xp_total, 0)) >= king_private.nivel_do_cosmetico('reacao-coroa')
    from public.cosmeticos_equipados as c
    left join public.progresso as g on g.player_id = c.player_id
   where c.player_id = any (p_ids)
   order by c.player_id;
end $$;

reset role;
revoke create on schema public from king_progress_owner;

-- ══ RLS ═════════════════════════════════════════════════════════════════════════════════════
alter table public.cosmeticos_equipados enable row level security;
create policy cosmeticos_leio_os_meus on public.cosmeticos_equipados
  for select to authenticated using ((select auth.uid()) = player_id);

-- ══ GRANTS — explícitos, contra os privilégios padrão permissivos do Supabase ═══════════════
revoke all on table public.cosmeticos_equipados from public, anon, authenticated, service_role;
grant select on table public.cosmeticos_equipados to authenticated;

revoke all on function king_private.nivel_do_cosmetico(text) from public, anon, authenticated, service_role, king_server;
revoke all on function public.equipar_cosmetico(text, boolean) from public, anon, authenticated, service_role, king_server;
grant execute on function public.equipar_cosmetico(text, boolean) to authenticated;
revoke all on function king_private.cosmeticos_da_sala(uuid[]) from public, anon, authenticated, service_role;
grant execute on function king_private.cosmeticos_da_sala(uuid[]) to king_server;

comment on table public.cosmeticos_equipados is
  'Escolha de cosméticos por jogador. Escrita só por public.equipar_cosmetico, que confere o nível.';
comment on function public.equipar_cosmetico(text, boolean) is
  'Equipa/desequipa um item do catálogo fechado. Equipar exige nivel_de(xp_total) >= nível do item.';
comment on function king_private.cosmeticos_da_sala(uuid[]) is
  'Para o servidor do jogo: moldura e reação EFETIVAS (equipadas e com nível) de até 4 jogadores.';
