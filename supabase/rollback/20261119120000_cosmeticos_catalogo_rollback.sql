-- ROLLBACK DO CATÁLOGO (20261119120000_cosmeticos_catalogo.sql).
--
-- Volta o banco ao que as partes 1 e 2 deixaram: as portas antigas com o texto delas, as três colunas
-- booleanas de novo GRAVÁVEIS (com o valor que tinham), o catálogo de quatro toalhas, e some o que
-- nasceu aqui (a porta `equipar_item`, a leitura `cosmeticos_dos_assentos`, o catálogo `nivel_do_item`
-- e as colunas `moldura`, `baralho` e `reacoes`). NÃO toca em `progresso`, `xp_eventos`, `players` nem
-- no crédito.
--
-- O que se perde: as escolhas que não existiam antes — molduras, baralhos e reações novos (a Moldura
-- Real, o Baralho Imperial e a Coroa ficam, nas colunas antigas) e as mesas Azul Royal e Preta Premium,
-- que voltam à Noite Imperial.
--
-- ORDEM AO DESFAZER: primeiro a web e o servidor voltam, depois este arquivo. Para desfazer TUDO dos
-- cosméticos: este, depois o da parte 2 (mesa) e por último o da parte 1.

begin;

-- recriar as portas antigas em `public` exige, só durante este arquivo, o mesmo CREATE da migração
grant create on schema public to king_progress_owner;
set role king_progress_owner;

drop function public.equipar_item(text, boolean);
drop function king_private.cosmeticos_dos_assentos(uuid[]);

-- as colunas da parte 1 voltam a ser colunas comuns, com o valor que já espelhavam
alter table public.cosmeticos_equipados
  alter column moldura_real drop expression,
  alter column baralho_imperial drop expression,
  alter column reacao_coroa drop expression;
alter table public.cosmeticos_equipados
  alter column moldura_real set default false,
  alter column baralho_imperial set default false,
  alter column reacao_coroa set default false;

-- as toalhas novas voltam à padrão, e o catálogo da coluna volta às quatro
update public.cosmeticos_equipados set toalha = 'imperial' where toalha in ('azul', 'preta');
alter table public.cosmeticos_equipados
  drop constraint cosmeticos_toalha_do_catalogo;
alter table public.cosmeticos_equipados
  add constraint cosmeticos_toalha_do_catalogo check (toalha in ('imperial', 'verde', 'vinho', 'esmeralda'));

alter table public.cosmeticos_equipados
  drop column moldura,
  drop column baralho,
  drop column reacoes;

-- ══ AS PORTAS ANTIGAS, com o texto das partes 1 e 2 ══════════════════════════════════════════
create or replace function king_private.nivel_do_cosmetico(p_item text) returns integer
language sql immutable
set search_path = ''
as $$
  select case p_item
    when 'moldura-real'     then 2
    when 'baralho-imperial' then 4
    when 'reacao-coroa'     then 6
  end
$$;

create or replace function king_private.nivel_da_toalha(p_toalha text) returns integer
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

drop function king_private.nivel_do_item(text);

create or replace function public.equipar_cosmetico(p_item text, p_equipado boolean)
returns table (moldura_real boolean, baralho_imperial boolean, reacao_coroa boolean)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
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

create or replace function king_private.cosmeticos_da_sala(p_ids uuid[])
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
  select case when king_private.nivel_da_toalha(v_escolha) <= v_nivel then v_escolha else 'imperial' end,
         array(select t from unnest(array['imperial', 'verde', 'vinho', 'esmeralda']) with ordinality as x(t, ordem)
                where king_private.nivel_da_toalha(t) <= v_nivel order by ordem);
end $$;

reset role;
revoke create on schema public from king_progress_owner;

commit;
