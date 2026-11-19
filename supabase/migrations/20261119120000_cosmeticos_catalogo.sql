-- O CATÁLOGO DE COSMÉTICOS (Entrega C) — 20 itens em quatro categorias, catálogo fechado.
--
-- ══ A CURVA ══
--
--   nível  2 → moldura  'real'        Moldura Real
--   nível  3 → mesa     'vinho'       Vinho Imperial (era nível 8)
--   nível  4 → baralho  'imperial'    Baralho Imperial
--   nível  5 → reação   'fogo'        Fogo
--   nível  6 → reação   'coroa'       Coroa
--   nível  7 → moldura  'rubi'        Moldura Rubi Real
--   nível  8 → mesa     'azul'        Azul Royal
--   nível  9 → baralho  'safira'      Baralho Safira Noturna
--   nível 10 → reação   'caveira'     Caveira / Azar          (e a mesa 'esmeralda', Esmeralda Real, que já era do nível 10)
--   nível 11 → moldura  'onix'        Moldura Ônix Imperial
--   nível 12 → mesa     'preta'       Preta Premium
--   nível 13 → baralho  'ouro-negro'  Baralho Ouro Negro
--   nível 14 → reação   'aplauso'     Aplauso
--   nível 15 → moldura  'diamante'    Moldura Diamante do Rei
--   nível 16 → moldura  'esmeralda'   Moldura Esmeralda Suprema
--   nível 17 → baralho  'rubi'        Baralho Imperial Rubi
--   nível 18 → baralho  'marfim'      Baralho Marfim Real
--   livres   → mesas 'imperial' e 'verde' (como sempre); reações Risada e Choro (sem registro: são de todos)
--
-- ══ O QUE É GUARDADO ══
--
-- Uma ESCOLHA por categoria, na mesma linha de `cosmeticos_equipados`:
--   `moldura`  uma por vez, ou nenhuma (null)
--   `baralho`  um por vez, ou nenhum (null)
--   `reacoes`  as reações de nível ligadas (várias), na ordem do catálogo
--   `toalha`   uma por vez, sempre uma (a da parte 2)
-- As três colunas booleanas da parte 1 continuam existindo, agora DERIVADAS (geradas) das novas: uma
-- verdade só, e quem ainda lê `moldura_real`/`baralho_imperial`/`reacao_coroa` continua lendo certo.
--
-- ══ AS PORTAS ══
--
--   escrita           `public.equipar_item(item, equipado)` — SECURITY DEFINER, a única porta nova. A
--                     mesma identidade do JWT e a mesma conferência de nível NO BANCO das partes 1 e 2.
--                     `equipar_cosmetico` e `equipar_toalha` continuam funcionando (a primeira passa a
--                     chamar esta), para que o banco possa ir antes do servidor e da web.
--   leitura da sala   `king_private.cosmeticos_dos_assentos(ids)` — EXECUTE só do `king_server`, no máximo
--                     quatro ids, e só o EFEITO (escolhido E com nível hoje). `cosmeticos_da_sala`
--                     continua respondendo do jeito antigo, por cima desta.
--   catálogo          `king_private.nivel_do_item(item)` — a ÚNICA tabela de níveis das molduras,
--                     baralhos e reações; `nivel_do_cosmetico` passa a perguntar a ela.
--
-- Nada aqui toca em `progresso`, `xp_eventos`, `players` ou no crédito.
--
-- ══ ROLLBACK ══
--
-- `supabase/rollback/20261119120000_cosmeticos_catalogo_rollback.sql`: volta as portas antigas ao texto
-- das partes 1 e 2 e tira o que nasceu aqui. Perdem-se só as escolhas que não existiam antes (as molduras,
-- baralhos e reações novas, e as mesas Azul e Preta, que voltam à Noite Imperial).

grant create on schema public to king_progress_owner;
set role king_progress_owner;

-- ══ AS ESCOLHAS NOVAS ═══════════════════════════════════════════════════════════════════════
alter table public.cosmeticos_equipados
  add column moldura text
    constraint cosmeticos_moldura_do_catalogo check (moldura in ('real', 'rubi', 'onix', 'diamante', 'esmeralda')),
  add column baralho text
    constraint cosmeticos_baralho_do_catalogo check (baralho in ('imperial', 'safira', 'ouro-negro', 'rubi', 'marfim')),
  add column reacoes text[] not null default '{}'
    constraint cosmeticos_reacoes_do_catalogo check (reacoes <@ array['fogo', 'coroa', 'caveira', 'aplauso']::text[]);

-- o que já estava escolhido pelas colunas da parte 1 passa para as novas
update public.cosmeticos_equipados set
  moldura = case when moldura_real then 'real' end,
  baralho = case when baralho_imperial then 'imperial' end,
  reacoes = case when reacao_coroa then array['coroa'] else '{}'::text[] end;

-- ...e as da parte 1 viram ESPELHOS das novas (geradas, não graváveis): uma verdade só.
alter table public.cosmeticos_equipados
  drop column moldura_real,
  drop column baralho_imperial,
  drop column reacao_coroa;
alter table public.cosmeticos_equipados
  add column moldura_real boolean not null generated always as (moldura is not distinct from 'real') stored,
  add column baralho_imperial boolean not null generated always as (baralho is not distinct from 'imperial') stored,
  add column reacao_coroa boolean not null generated always as ('coroa' = any (reacoes)) stored;

-- as toalhas: duas novas no catálogo da coluna
alter table public.cosmeticos_equipados
  drop constraint cosmeticos_toalha_do_catalogo;
alter table public.cosmeticos_equipados
  add constraint cosmeticos_toalha_do_catalogo
    check (toalha in ('imperial', 'verde', 'vinho', 'azul', 'esmeralda', 'preta'));

-- ══ O CATÁLOGO — a única tabela de níveis dos itens, dentro do banco ═══════════════════════════
-- `null` para o que não está no catálogo (e para as reações livres, que não se equipam): quem chama recusa.
create function king_private.nivel_do_item(p_item text) returns integer
language sql immutable
set search_path = ''
as $$
  select case
    when p_item = 'moldura-real'       then  2
    when p_item = 'moldura-rubi'       then  7
    when p_item = 'moldura-onix'       then 11
    when p_item = 'moldura-diamante'   then 15
    when p_item = 'moldura-esmeralda'  then 16
    when p_item = 'baralho-imperial'   then  4
    when p_item = 'baralho-safira'     then  9
    when p_item = 'baralho-ouro-negro' then 13
    when p_item = 'baralho-rubi'       then 17
    when p_item = 'baralho-marfim'     then 18
    when p_item = 'reacao-fogo'        then  5
    when p_item = 'reacao-coroa'       then  6
    when p_item = 'reacao-caveira'     then 10
    when p_item = 'reacao-aplauso'     then 14
    when starts_with(p_item, 'mesa-')  then king_private.nivel_da_toalha(substr(p_item, 6))
  end
$$;

-- O catálogo da parte 1 passa a perguntar ao de cima (os três itens dela têm os mesmos níveis).
create or replace function king_private.nivel_do_cosmetico(p_item text) returns integer
language sql immutable
set search_path = ''
as $$
  select case when p_item in ('moldura-real', 'baralho-imperial', 'reacao-coroa') then king_private.nivel_do_item(p_item) end
$$;

-- As toalhas: Vinho Imperial desce para o nível 3; Azul Royal (8) e Preta Premium (12) entram.
create or replace function king_private.nivel_da_toalha(p_toalha text) returns integer
language sql immutable
set search_path = ''
as $$
  select case
    when p_toalha = 'imperial'  then  1
    when p_toalha = 'verde'     then  1
    when p_toalha = 'vinho'     then  3
    when p_toalha = 'azul'      then  8
    when p_toalha = 'esmeralda' then 10
    when p_toalha = 'preta'     then 12
  end
$$;

-- ══ EQUIPAR / DESEQUIPAR QUALQUER ITEM — a porta de escrita do catálogo inteiro ════════════════
--   moldura / baralho  equipar troca o que estava; desequipar tira, se for ESTE o equipado
--   reação             liga/desliga esta, sem mexer nas outras
--   mesa               equipar escolhe a toalha; desequipar volta à Noite Imperial
create function public.equipar_item(p_item text, p_equipado boolean)
returns table (moldura text, baralho text, reacoes text[], toalha text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- QUEM É: o `sub` do JWT, do mesmo jeito das partes 1 e 2 (o dono não alcança `auth.uid()`).
  v_quem  uuid := nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid;
  v_nivel integer := king_private.nivel_do_item(p_item);
  v_tipo  text := split_part(p_item, '-', 1);
  v_valor text := substr(p_item, length(split_part(p_item, '-', 1)) + 2);
begin
  if v_quem is null then
    raise exception 'sem identidade' using errcode = '42501';
  end if;
  if v_nivel is null or p_equipado is null then
    raise exception 'item fora do catálogo' using errcode = '22023';
  end if;
  -- O NÍVEL É O DO BANCO. Desequipar e as mesas livres não precisam de conta nenhuma.
  if p_equipado and v_nivel > 1 then
    if public.nivel_de(coalesce((select g.xp_total from public.progresso as g where g.player_id = v_quem), 0)) < v_nivel then
      raise exception 'nível insuficiente' using errcode = '42501';
    end if;
  end if;

  return query
  insert into public.cosmeticos_equipados as c (player_id, moldura, baralho, reacoes, toalha)
  values (v_quem,
          case when v_tipo = 'moldura' and p_equipado then v_valor end,
          case when v_tipo = 'baralho' and p_equipado then v_valor end,
          case when v_tipo = 'reacao' and p_equipado then array[v_valor] else '{}'::text[] end,
          case when v_tipo = 'mesa' and p_equipado then v_valor else 'imperial' end)
  on conflict (player_id) do update set
    moldura = case when v_tipo <> 'moldura' then c.moldura
                   when p_equipado then v_valor
                   when c.moldura = v_valor then null
                   else c.moldura end,
    baralho = case when v_tipo <> 'baralho' then c.baralho
                   when p_equipado then v_valor
                   when c.baralho = v_valor then null
                   else c.baralho end,
    reacoes = case when v_tipo <> 'reacao' then c.reacoes
                   else array(select r from unnest(array['fogo', 'coroa', 'caveira', 'aplauso']) with ordinality as x(r, ordem)
                               where case when r = v_valor then p_equipado else r = any (c.reacoes) end
                               order by ordem) end,
    toalha  = case when v_tipo <> 'mesa' then c.toalha
                   when p_equipado then v_valor
                   when c.toalha = v_valor then 'imperial'
                   else c.toalha end,
    atualizado_em = now()
  returning c.moldura, c.baralho, c.reacoes, c.toalha;
end $$;

-- A porta da parte 1 continua aceitando os três itens dela, e só eles — agora pela porta de cima.
create or replace function public.equipar_cosmetico(p_item text, p_equipado boolean)
returns table (moldura_real boolean, baralho_imperial boolean, reacao_coroa boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_item is null or p_item not in ('moldura-real', 'baralho-imperial', 'reacao-coroa') then
    raise exception 'item fora do catálogo' using errcode = '22023';
  end if;
  return query
  select e.moldura is not distinct from 'real', e.baralho is not distinct from 'imperial', 'coroa' = any (e.reacoes)
    from public.equipar_item(p_item, p_equipado) as e;
end $$;

-- ══ LEITURA DA SALA — só o servidor do jogo, só o efeito ═══════════════════════════════════════
-- Efeito = escolhido E com nível hoje (defesa em profundidade: a escrita já conferiu). O baralho não
-- sai daqui: ele é do aparelho de quem equipou.
create function king_private.cosmeticos_dos_assentos(p_ids uuid[])
returns table (player_id uuid, moldura text, reacoes text[])
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
  -- Uma mesa tem quatro assentos. Mais que isso é varredura.
  if 4 < cardinality(p_ids) then
    raise exception 'no máximo quatro jogadores por consulta' using errcode = '22023';
  end if;
  return query
  select c.player_id,
         case when public.nivel_de(coalesce(g.xp_total, 0)) >= king_private.nivel_do_item('moldura-' || c.moldura) then c.moldura end,
         array(select r from unnest(c.reacoes) with ordinality as x(r, ordem)
                where public.nivel_de(coalesce(g.xp_total, 0)) >= king_private.nivel_do_item('reacao-' || r)
                order by ordem)
    from public.cosmeticos_equipados as c
    left join public.progresso as g on g.player_id = c.player_id
   where c.player_id = any (p_ids)
   order by c.player_id;
end $$;

-- A porta da sala da parte 1 continua respondendo do jeito dela, por cima da nova.
create or replace function king_private.cosmeticos_da_sala(p_ids uuid[])
returns table (player_id uuid, moldura_real boolean, reacao_coroa boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  select s.player_id, s.moldura is not distinct from 'real', 'coroa' = any (s.reacoes)
    from king_private.cosmeticos_dos_assentos(p_ids) as s;
end $$;

-- A mesa do anfitrião: o mesmo efeito da parte 2, com o catálogo de seis toalhas, na ordem dele.
create or replace function king_private.toalhas_do_anfitriao(p_id uuid)
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
  select case when v_nivel >= king_private.nivel_da_toalha(v_escolha) then v_escolha else 'imperial' end,
         array(select t from unnest(array['imperial', 'verde', 'vinho', 'azul', 'esmeralda', 'preta']) with ordinality as x(t, n)
                where v_nivel >= king_private.nivel_da_toalha(t) order by n);
end $$;

reset role;
revoke create on schema public from king_progress_owner;

-- ══ GRANTS — explícitos, contra os privilégios padrão permissivos do Supabase ═══════════════
-- (as funções substituídas mantêm os privilégios que já tinham)
revoke all on function king_private.nivel_do_item(text) from public, anon, authenticated, service_role, king_server;
revoke all on function public.equipar_item(text, boolean) from public, anon, authenticated, service_role, king_server;
grant execute on function public.equipar_item(text, boolean) to authenticated;
revoke all on function king_private.cosmeticos_dos_assentos(uuid[]) from public, anon, authenticated, service_role;
grant execute on function king_private.cosmeticos_dos_assentos(uuid[]) to king_server;

comment on column public.cosmeticos_equipados.moldura is
  'Moldura escolhida (catálogo fechado) ou nenhuma. Escrita só por public.equipar_item, que confere o nível.';
comment on column public.cosmeticos_equipados.baralho is
  'Baralho escolhido (catálogo fechado) ou nenhum. Escrita só por public.equipar_item, que confere o nível.';
comment on column public.cosmeticos_equipados.reacoes is
  'Reações de nível ligadas, na ordem do catálogo. Escrita só por public.equipar_item, que confere o nível.';
comment on function public.equipar_item(text, boolean) is
  'Equipa/desequipa qualquer item do catálogo fechado. Equipar exige nivel_de(xp_total) >= nível do item.';
comment on function king_private.cosmeticos_dos_assentos(uuid[]) is
  'Para o servidor do jogo: moldura e reações EFETIVAS (escolhidas e com nível) de até 4 jogadores.';
