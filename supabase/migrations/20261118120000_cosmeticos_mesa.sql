-- A TOALHA DA MESA COMO COSMÉTICO (Entrega B, parte 2) — quatro temas, catálogo fechado.
--
-- ══ O CATÁLOGO DAS TOALHAS ══
--
--   nível 1  → 'imperial'   Noite Imperial — o padrão da casa, livre como sempre foi
--   nível 1  → 'verde'      Verde Clássica — livre como sempre foi
--   nível 8  → 'vinho'      Vinho Clássica
--   nível 10 → 'esmeralda'  Esmeralda Real
--
-- As duas mesas que já existiam continuam LIVRES: ninguém perde o que tinha. Os ids são os MESMOS
-- etiquetas que a sala já sincroniza (`tableTheme`) e que o app antigo conhece; os dois novos caem
-- no padrão num cliente antigo, que desenha só o que conhece.
--
-- ══ O QUE É GUARDADO ══
--
-- Só a ESCOLHA: uma coluna `toalha` na mesma linha de `cosmeticos_equipados` (uma por jogador). É
-- exclusiva — uma toalha por vez —, por isso é um valor, não um "equipado sim/não". O padrão é
-- 'imperial', a mesa de sempre.
--
-- ══ QUEM VÊ ══
--
-- A mesa é da SALA: no online, quem escolhe é o anfitrião, e os quatro jogam na mesma toalha. O
-- servidor do jogo pergunta ao banco quais toalhas o anfitrião liberou e recusa a escolha de uma
-- bloqueada. Contra os bots, vale a toalha equipada na vitrine.
--
-- ══ AS PORTAS NOVAS ══
--
--   escrita           `public.equipar_toalha(toalha)` — SECURITY DEFINER. A mesma identidade do JWT
--                     e a mesma conferência de nível no banco de `equipar_cosmetico`.
--   leitura da sala   `king_private.toalhas_do_anfitriao(id)` — EXECUTE só do `king_server`. Devolve a
--                     toalha EFETIVA (equipada e com nível; senão a padrão) e a lista das liberadas.
--                     Nunca XP nem nível.
--
-- Nada da parte 1 muda: `equipar_cosmetico`, `cosmeticos_da_sala`, a política e os privilégios da
-- tabela ficam como estão. A coluna nova é lida pelo `select` que o cliente já tem na PRÓPRIA linha.
--
-- ══ ROLLBACK ══
--
-- `supabase/rollback/20261118120000_cosmeticos_mesa_rollback.sql`: tira as duas funções, o catálogo e
-- a coluna. Perde-se só a toalha escolhida; o XP e as outras escolhas ficam.

grant create on schema public to king_progress_owner;
set role king_progress_owner;

-- ══ A COLUNA ════════════════════════════════════════════════════════════════════════════════
alter table public.cosmeticos_equipados
  add column toalha text not null default 'imperial'
    constraint cosmeticos_toalha_do_catalogo check (toalha in ('imperial', 'verde', 'vinho', 'esmeralda'));

-- ══ CATÁLOGO DAS TOALHAS — a única tabela de níveis delas, dentro do banco ══════════════════════
-- `null` para o que não está no catálogo: quem chama recusa.
create function king_private.nivel_da_toalha(p_toalha text) returns integer
language sql immutable
set search_path = ''
as $$
  select case p_toalha
    when 'imperial'  then 1
    when 'verde'     then 1
    when 'vinho'     then 8
    when 'esmeralda' then 10
  end
$$;

-- ══ EQUIPAR A TOALHA — a única porta de escrita da coluna ═══════════════════════════════════════
create function public.equipar_toalha(p_toalha text)
returns table (toalha text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- QUEM É: o `sub` do JWT, do mesmo jeito de `equipar_cosmetico` (o dono não alcança `auth.uid()`).
  v_uid   uuid := nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid;
  v_exige integer := king_private.nivel_da_toalha(p_toalha);
  v_xp    integer;
begin
  if v_uid is null then
    raise exception 'sem identidade' using errcode = '42501';
  end if;
  if v_exige is null then
    raise exception 'toalha fora do catálogo' using errcode = '22023';
  end if;
  -- O NÍVEL É O DO BANCO. As livres (nível 1) não precisam de conta nenhuma.
  if v_exige > 1 then
    v_xp := coalesce((select g.xp_total from public.progresso as g where g.player_id = v_uid), 0);
    if public.nivel_de(v_xp) < v_exige then
      raise exception 'nível insuficiente' using errcode = '42501';
    end if;
  end if;

  return query
  insert into public.cosmeticos_equipados as c (player_id, toalha)
  values (v_uid, p_toalha)
  on conflict (player_id) do update set
    toalha        = p_toalha,
    atualizado_em = now()
  returning c.toalha;
end $$;

-- ══ A MESA DO ANFITRIÃO — só o servidor do jogo, só o efeito ════════════════════════════════════
-- Sempre UMA linha, mesmo para quem nunca escolheu nada (aí a toalha é a padrão). `liberadas` vem na
-- ordem do catálogo. Efetiva = escolhida E com nível hoje (defesa em profundidade: a escrita já
-- conferiu).
create function king_private.toalhas_do_anfitriao(p_id uuid)
returns table (toalha text, liberadas text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_nivel   integer;
  v_escolha text;
begin
  if p_id is null then
    raise exception 'sem jogador' using errcode = '22023';
  end if;
  v_nivel := public.nivel_de(coalesce((select g.xp_total from public.progresso as g where g.player_id = p_id), 0));
  v_escolha := coalesce((select c.toalha from public.cosmeticos_equipados as c where c.player_id = p_id), 'imperial');
  return query
  select case when king_private.nivel_da_toalha(v_escolha) <= v_nivel then v_escolha else 'imperial' end,
         array(select t from unnest(array['imperial', 'verde', 'vinho', 'esmeralda']) with ordinality as x(t, ordem)
                where king_private.nivel_da_toalha(t) <= v_nivel order by ordem);
end $$;

reset role;
revoke create on schema public from king_progress_owner;

-- ══ GRANTS — explícitos, contra os privilégios padrão permissivos do Supabase ═══════════════
revoke all on function king_private.nivel_da_toalha(text) from public, anon, authenticated, service_role, king_server;
revoke all on function public.equipar_toalha(text) from public, anon, authenticated, service_role, king_server;
grant execute on function public.equipar_toalha(text) to authenticated;
revoke all on function king_private.toalhas_do_anfitriao(uuid) from public, anon, authenticated, service_role;
grant execute on function king_private.toalhas_do_anfitriao(uuid) to king_server;

comment on column public.cosmeticos_equipados.toalha is
  'Toalha da mesa escolhida (catálogo fechado). Escrita só por public.equipar_toalha, que confere o nível.';
comment on function public.equipar_toalha(text) is
  'Escolhe a toalha da mesa. As de nível acima de 1 exigem nivel_de(xp_total) >= nível da toalha.';
comment on function king_private.toalhas_do_anfitriao(uuid) is
  'Para o servidor do jogo: a toalha EFETIVA de um jogador e as toalhas que ele já liberou.';
