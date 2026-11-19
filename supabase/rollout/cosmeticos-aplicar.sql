-- ENTREGAS B e C — COSMÉTICOS POR NÍVEL — COLAR ESTE ARQUIVO INTEIRO NO SQL EDITOR E RODAR UMA VEZ.
--
-- ARQUIVO GERADO por scripts/montar-rollout-cosmeticos.mjs — não editar à mão.
-- Migrações dentro dele, nesta ordem e com o texto idêntico ao do repositório:
--   supabase/migrations/20261117120000_cosmeticos.sql
--     sha256 a2001a46034d5d3fa8d89413305d2e833a386200a25d1380e5e9e2f89ff8c725
--   supabase/migrations/20261118120000_cosmeticos_mesa.sql
--     sha256 0856adc202127673d81d93b58f19eee1f355e07f8cdf24f45b596acdd1ff8723
--   supabase/migrations/20261119120000_cosmeticos_catalogo.sql
--     sha256 46f1765f45cfa19a876afc913a5104c21bc0df2c561effadef9e6142e97a8c31
--
-- ANTES: rodar supabase/rollout/cosmeticos-checkpoint-1-antes.sql (só leitura) e ver pronto_para_aplicar = true.
--
-- Colar INTEIRO, numa aba só, e rodar UMA vez. SÓ está aplicado se a última tela mostrar a linha
-- "COSMÉTICOS (ENTREGA B) APLICADA E CONFERIDA"; sem ela, nada foi gravado.
--
-- É UMA transação: BEGIN, recusas e retrato do "antes", a migração, conferências e COMMIT. Se QUALQUER
-- passo falhar, o erro aparece, o COMMIT não roda e NADA é gravado — nesse caso, rodar `rollback;`
-- sozinho para limpar a sessão e me mandar o erro. "lock timeout" = rodar de novo um minuto depois.
--
-- DEPOIS: rodar supabase/rollout/cosmeticos-checkpoint-3-depois.sql (só leitura) e ver tudo_certo = true.
--
-- O que muda: nasce a tabela das escolhas (vazia: moldura, baralho, reações e toalha) e nove funções. NADA do que existe muda: progresso,
-- XP, ledger, crédito, lápides, jogadores e privilégios ficam como estão (as conferências provam). O
-- servidor e a web que estão no ar hoje não usam nada disto; ativar é o passo seguinte (servidor, depois
-- web), cada um com autorização própria.
--
-- Rollback, NESTA ordem: supabase/rollback/20261119120000_cosmeticos_catalogo_rollback.sql,
-- supabase/rollback/20261118120000_cosmeticos_mesa_rollback.sql e por último
-- supabase/rollback/20261117120000_cosmeticos_rollback.sql (apagam as escolhas gravadas, e só elas).
-- Depois dos três, o checkpoint 1 volta a dizer pronto_para_aplicar = true.

begin;

-- ═══ PARTE 1/3 — ANTES DA MIGRAÇÃO (na MESMA transação) ════════════════════════════════════
--
-- 1. RECUSA rodar: sem os papéis do progresso; com um aplicador que não herda (ou não pode assumir)
--    o dono dedicado; com o servidor membro desse dono; sem o progresso, o crédito do passo D e a
--    retenção das lápides inteiros; ou com QUALQUER pedaço dos cosméticos já presente (reaplicação, ou
--    um arquivo que parou no meio).
-- 2. RETRATO do que a migração NÃO pode mudar, numa tabela temporária que some no commit.
set local lock_timeout = '5s';

do $$
begin
  if to_regrole('king_progress_owner') is null or to_regrole('king_server') is null then
    raise exception 'ROLLOUT COSMÉTICOS ABORTADO (parte 1): papéis do progresso ausentes. Nada foi alterado.';
  end if;
  if not pg_has_role(current_user, 'king_progress_owner', 'MEMBER')
     or not pg_has_role(current_user, 'king_progress_owner', 'USAGE')
     or not pg_has_role(current_user, 'king_progress_owner', 'SET') then
    raise exception 'ROLLOUT COSMÉTICOS ABORTADO (parte 1): % não herda nem assume king_progress_owner. Nada foi alterado.', current_user;
  end if;
  if pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'ROLLOUT COSMÉTICOS ABORTADO (parte 1): king_server é membro do dono do progresso. Nada foi alterado.';
  end if;
  if to_regclass('public.players') is null or to_regclass('public.progresso') is null
     or to_regclass('public.xp_eventos') is null or to_regclass('king_private.partidas') is null
     or to_regprocedure('public.nivel_de(integer)') is null
     or to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)') is null
     or to_regclass('king_private.contas_excluidas') is null
     or to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is null then
    raise exception 'ROLLOUT COSMÉTICOS ABORTADO (parte 1): o progresso (com o passo D e a retenção) não está aplicado inteiro. Nada foi alterado.';
  end if;
  if to_regclass('public.cosmeticos_equipados') is not null
     or to_regprocedure('public.equipar_cosmetico(text,boolean)') is not null
     or to_regprocedure('king_private.cosmeticos_da_sala(uuid[])') is not null
     or to_regprocedure('king_private.nivel_do_cosmetico(text)') is not null
     or to_regprocedure('public.equipar_toalha(text)') is not null
     or to_regprocedure('king_private.toalhas_do_anfitriao(uuid)') is not null
     or to_regprocedure('king_private.nivel_da_toalha(text)') is not null
     or to_regprocedure('public.equipar_item(text,boolean)') is not null
     or to_regprocedure('king_private.cosmeticos_dos_assentos(uuid[])') is not null
     or to_regprocedure('king_private.nivel_do_item(text)') is not null then
    raise exception 'ROLLOUT COSMÉTICOS ABORTADO (parte 1): os cosméticos já existem, inteiros ou em parte, neste banco — esta execução não alterou nada. Se acabaram de ser aplicados (o arquivo colado duas vezes), confira com o checkpoint 3.';
  end if;
end $$;

create temp table rollout_cosmeticos_antes on commit drop as
select (select count(*) from public.progresso)                       as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)     as xp_total,
       (select count(*) from public.xp_eventos)                      as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos)    as xp_no_ledger,
       (select count(*) from king_private.partidas)                  as partidas,
       (select count(*) from public.progresso as g
         where g.xp_total <> (select coalesce(sum(e.xp_delta), 0) from public.xp_eventos as e where e.player_id = g.player_id)) as divergentes,
       (select md5(p.prosrc) from pg_proc as p
         where p.oid = 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure) as credito_md5,
       (select md5(p.prosrc) from pg_proc as p where p.oid = 'public.nivel_de(integer)'::regprocedure) as nivel_md5,
       (select coalesce(array_agg(n.nspname || '.' || p.proname), '{}')
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private'))           as security_definer,
       (select array_agg(o.obj || ' ' || o.acl) from (
          select c.oid::regclass::text as obj, coalesce(c.relacl::text, '(padrão)') as acl
            from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
           where n.nspname in ('king_private', 'public') and c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')
          union all
          select p.oid::regprocedure::text, coalesce(p.proacl::text, '(padrão)')
            from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
           where n.nspname in ('king_private', 'public')
          union all
          select 'schema ' || n.nspname, coalesce(n.nspacl::text, '(padrão)')
            from pg_namespace as n where n.nspname in ('king_private', 'public')) as o) as privilegios,
       (select coalesce(array_agg(c.oid::regclass::text || '.' || a.attname || ' ' || a.attacl::text
                                  order by c.oid::regclass::text || '.' || a.attname collate "C"), '{}')
          from pg_attribute as a join pg_class as c on c.oid = a.attrelid join pg_namespace as n on n.oid = c.relnamespace
         where n.nspname in ('king_private', 'public') and a.attacl is not null)   as privilegios_de_coluna,
       (select coalesce(array_agg(c.oid::regclass::text || ' ' || p.polname
                                  order by c.oid::regclass::text || ' ' || p.polname collate "C"), '{}')
          from pg_policy as p join pg_class as c on c.oid = p.polrelid join pg_namespace as n on n.oid = c.relnamespace
         where n.nspname in ('king_private', 'public'))                             as politicas,
       (select coalesce(array_agg(m.roleid::regrole::text order by m.roleid::regrole::text collate "C"), '{}')
          from pg_auth_members as m where m.member = 'king_server'::regrole)       as papeis_do_servidor;

-- ═══ PARTE 2/3 — AS TRÊS MIGRAÇÕES, idênticas aos arquivos de supabase/migrations ═══════════
-- ─── supabase/migrations/20261117120000_cosmeticos.sql ───
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

-- ─── supabase/migrations/20261118120000_cosmeticos_mesa.sql ───
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

-- ─── supabase/migrations/20261119120000_cosmeticos_catalogo.sql ───
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

-- ═══ PARTE 3/3 — CONFERÊNCIAS, AINDA DENTRO DA TRANSAÇÃO ═══════════════════════════════════
--
-- Qualquer falha aqui levanta erro: o COMMIT abaixo não roda e NADA da migração é gravado.
-- (O SQL Editor não mostra NOTICE; quem fala é o erro, ou o relatório no fim.)
do $$
declare
  antes   record;
  t       regclass     := to_regclass('public.cosmeticos_equipados');
  equipar regprocedure := to_regprocedure('public.equipar_cosmetico(text,boolean)');
  sala    regprocedure := to_regprocedure('king_private.cosmeticos_da_sala(uuid[])');
  nivel   regprocedure := to_regprocedure('king_private.nivel_do_cosmetico(text)');
  toalha  regprocedure := to_regprocedure('public.equipar_toalha(text)');
  mesa    regprocedure := to_regprocedure('king_private.toalhas_do_anfitriao(uuid)');
  nivel_t regprocedure := to_regprocedure('king_private.nivel_da_toalha(text)');
  item    regprocedure := to_regprocedure('public.equipar_item(text,boolean)');
  assent  regprocedure := to_regprocedure('king_private.cosmeticos_dos_assentos(uuid[])');
  nivel_i regprocedure := to_regprocedure('king_private.nivel_do_item(text)');
  credito regprocedure := 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure;
  agora   text[];
  novos   text[];
  sumidos text[];
  papel   text;
  f       regprocedure;
begin
  select * into antes from rollout_cosmeticos_antes;

  if current_user <> session_user then
    raise exception 'CONFERÊNCIA 0 FALHOU: a sessão não voltou ao papel original (%). Nada foi gravado.', current_user;
  end if;

  -- 1. a tabela: do dono dedicado, com RLS, VAZIA, uma linha por jogador, e cai com a conta (cascade)
  if t is null
     or pg_get_userbyid((select c.relowner from pg_class as c where c.oid = t)) <> 'king_progress_owner'
     or not (select c.relrowsecurity from pg_class as c where c.oid = t)
     or exists (select 1 from public.cosmeticos_equipados)
     or not exists (select 1 from pg_constraint as k
                     where k.conrelid = t and k.contype = 'p'
                       and k.conkey = array[(select a.attnum from pg_attribute as a where a.attrelid = t and a.attname = 'player_id')])
     or not exists (select 1 from pg_constraint as k
                     where k.conrelid = t and k.contype = 'f' and k.confrelid = 'public.players'::regclass and k.confdeltype = 'c') then
    raise exception 'CONFERÊNCIA 1 FALHOU: a tabela dos cosméticos não é a da Entrega B (dono, RLS, vazia, chave ou cascade). Nada foi gravado.';
  end if;
  -- ...e a toalha: texto, obrigatória, padrão 'imperial' e presa ao catálogo das seis
  if not exists (select 1 from pg_attribute as a join pg_attrdef as d on d.adrelid = a.attrelid and d.adnum = a.attnum
                  where a.attrelid = t and a.attname = 'toalha' and not a.attisdropped and a.attnotnull
                    and a.atttypid = 'text'::regtype and pg_get_expr(d.adbin, d.adrelid) = '''imperial''::text')
     or not exists (select 1 from pg_constraint as k
                     where k.conrelid = t and k.contype = 'c' and k.conname = 'cosmeticos_toalha_do_catalogo'
                       and pg_get_constraintdef(k.oid) = 'CHECK ((toalha = ANY (ARRAY[''imperial''::text, ''verde''::text, ''vinho''::text, ''azul''::text, ''esmeralda''::text, ''preta''::text])))') then
    raise exception 'CONFERÊNCIA 1 FALHOU: a coluna da toalha não é a esperada (tipo, padrão ou catálogo). Nada foi gravado.';
  end if;
  -- ...e as escolhas do catálogo (Entrega C): moldura e baralho opcionais e presos ao catálogo; reações
  -- obrigatórias (vazia por padrão) e presas às quatro de nível; as três da parte 1 GERADAS a partir delas
  if (select array_agg(pg_get_constraintdef(k.oid) order by k.conname collate "C") from pg_constraint as k
       where k.conrelid = t and k.contype = 'c' and k.conname in ('cosmeticos_moldura_do_catalogo', 'cosmeticos_baralho_do_catalogo', 'cosmeticos_reacoes_do_catalogo'))
     is distinct from array[
       'CHECK ((baralho = ANY (ARRAY[''imperial''::text, ''safira''::text, ''ouro-negro''::text, ''rubi''::text, ''marfim''::text])))',
       'CHECK ((moldura = ANY (ARRAY[''real''::text, ''rubi''::text, ''onix''::text, ''diamante''::text, ''esmeralda''::text])))',
       'CHECK ((reacoes <@ ARRAY[''fogo''::text, ''coroa''::text, ''caveira''::text, ''aplauso''::text]))']
     or (select count(*) from pg_attribute as a
          where a.attrelid = t and not a.attisdropped and a.attgenerated = 's' and a.atttypid = 'boolean'::regtype and a.attnotnull
            and a.attname in ('moldura_real', 'baralho_imperial', 'reacao_coroa')) <> 3
     or not exists (select 1 from pg_attribute as a where a.attrelid = t and a.attname = 'reacoes' and not a.attisdropped
                     and a.attnotnull and a.atttypid = 'text[]'::regtype) then
    raise exception 'CONFERÊNCIA 1 FALHOU: as colunas do catálogo não são as esperadas (moldura, baralho, reações ou os espelhos da parte 1). Nada foi gravado.';
  end if;

  -- 2. a política: UMA, só de leitura, só para authenticated, só a própria linha
  if (select count(*) from pg_policy as p where p.polrelid = t) <> 1
     or not exists (select 1 from pg_policies as p
                     where p.schemaname = 'public' and p.tablename = 'cosmeticos_equipados'
                       and p.policyname = 'cosmeticos_leio_os_meus' and p.cmd = 'SELECT'
                       and p.roles = array['authenticated']::name[]
                       and position('auth.uid()' in p.qual) > 0 and position('player_id' in p.qual) > 0
                       and p.with_check is null) then
    raise exception 'CONFERÊNCIA 2 FALHOU: a política de RLS dos cosméticos não é a esperada. Nada foi gravado.';
  end if;

  -- 3. as funções: dono dedicado, search_path vazio; as duas portas SECURITY DEFINER, o catálogo não
  foreach f in array array[equipar, sala, nivel, toalha, mesa, nivel_t, item, assent, nivel_i] loop
    if f is null
       or (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = f) <> 'king_progress_owner'
       or (select p.proconfig from pg_proc as p where p.oid = f) is distinct from array['search_path=""'] then
      raise exception 'CONFERÊNCIA 3 FALHOU: % fora do dono dedicado ou com search_path aberto. Nada foi gravado.', f;
    end if;
  end loop;
  if not (select p.prosecdef from pg_proc as p where p.oid = equipar)
     or not (select p.prosecdef from pg_proc as p where p.oid = sala)
     or not (select p.prosecdef from pg_proc as p where p.oid = toalha)
     or not (select p.prosecdef from pg_proc as p where p.oid = mesa)
     or not (select p.prosecdef from pg_proc as p where p.oid = item)
     or not (select p.prosecdef from pg_proc as p where p.oid = assent)
     or (select p.prosecdef from pg_proc as p where p.oid = nivel)
     or (select p.prosecdef from pg_proc as p where p.oid = nivel_t)
     or (select p.prosecdef from pg_proc as p where p.oid = nivel_i) then
    raise exception 'CONFERÊNCIA 3 FALHOU: SECURITY DEFINER fora do previsto nas funções dos cosméticos. Nada foi gravado.';
  end if;
  -- o catálogo do banco é o mesmo do app: 2 / 4 / 6, e nada fora dele
  if king_private.nivel_do_cosmetico('moldura-real') is distinct from 2
     or king_private.nivel_do_cosmetico('baralho-imperial') is distinct from 4
     or king_private.nivel_do_cosmetico('reacao-coroa') is distinct from 6
     or king_private.nivel_do_cosmetico('outro') is not null then
    raise exception 'CONFERÊNCIA 3 FALHOU: o catálogo do banco não é 2/4/6. Nada foi gravado.';
  end if;
  -- e o das toalhas: as duas mesas de sempre livres (1), vinho 3, azul 8, esmeralda 10, preta 12, e nada fora dele
  if king_private.nivel_da_toalha('imperial') is distinct from 1
     or king_private.nivel_da_toalha('verde') is distinct from 1
     or king_private.nivel_da_toalha('vinho') is distinct from 3
     or king_private.nivel_da_toalha('azul') is distinct from 8
     or king_private.nivel_da_toalha('esmeralda') is distinct from 10
     or king_private.nivel_da_toalha('preta') is distinct from 12
     or king_private.nivel_da_toalha('outra') is not null then
    raise exception 'CONFERÊNCIA 3 FALHOU: o catálogo das toalhas não é 1/1/3/8/10/12. Nada foi gravado.';
  end if;
  -- e o catálogo inteiro da Entrega C, item a item (a curva combinada), e nada fora dele
  if (select array_agg(i || '=' || coalesce(king_private.nivel_do_item(i)::text, 'null') order by i collate "C")
        from unnest(array['moldura-real', 'moldura-rubi', 'moldura-onix', 'moldura-diamante', 'moldura-esmeralda',
                          'baralho-imperial', 'baralho-safira', 'baralho-ouro-negro', 'baralho-rubi', 'baralho-marfim',
                          'reacao-fogo', 'reacao-coroa', 'reacao-caveira', 'reacao-aplauso', 'reacao-risada', 'reacao-choro',
                          'mesa-vinho', 'mesa-preta', 'mesa-roxa', 'outro']) as i)
     is distinct from array['baralho-imperial=4', 'baralho-marfim=18', 'baralho-ouro-negro=13', 'baralho-rubi=17', 'baralho-safira=9',
                            'mesa-preta=12', 'mesa-roxa=null', 'mesa-vinho=3',
                            'moldura-diamante=15', 'moldura-esmeralda=16', 'moldura-onix=11', 'moldura-real=2', 'moldura-rubi=7',
                            'outro=null', 'reacao-aplauso=14', 'reacao-caveira=10', 'reacao-choro=null', 'reacao-coroa=6',
                            'reacao-fogo=5', 'reacao-risada=null'] then
    raise exception 'CONFERÊNCIA 3 FALHOU: o catálogo da Entrega C não é a curva combinada. Nada foi gravado.';
  end if;

  -- 4. quem pode o quê: o cliente LÊ (RLS) e EQUIPA (pela porta); só o servidor lê a sala; ninguém
  --    da API escreve na tabela nem executa o catálogo ou a porta da sala
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role', 'king_server'] loop
    if has_table_privilege(papel, t, 'insert, update, delete, truncate, references, trigger') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % escreve na tabela dos cosméticos. Nada foi gravado.', papel;
    end if;
    if has_function_privilege(papel, nivel, 'execute') or has_function_privilege(papel, nivel_t, 'execute')
       or has_function_privilege(papel, nivel_i, 'execute') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % executa o catálogo direto. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(papel, sala, 'execute') or has_function_privilege(papel, mesa, 'execute')
       or has_function_privilege(papel, assent, 'execute') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % executa a porta da sala. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'service_role', 'king_server'] loop
    if has_function_privilege(papel, equipar, 'execute') or has_function_privilege(papel, toalha, 'execute')
       or has_function_privilege(papel, item, 'execute') or has_table_privilege(papel, t, 'select') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % lê a tabela ou equipa. Nada foi gravado.', papel;
    end if;
  end loop;
  if not has_table_privilege('authenticated', t, 'select') or not has_function_privilege('authenticated', equipar, 'execute')
     or not has_function_privilege('authenticated', toalha, 'execute') or not has_function_privilege('king_server', mesa, 'execute')
     or not has_function_privilege('king_server', sala, 'execute') or not has_function_privilege('authenticated', item, 'execute')
     or not has_function_privilege('king_server', assent, 'execute') or pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'CONFERÊNCIA 4 FALHOU: faltou a leitura/porta do cliente ou a do servidor, ou o servidor virou dono. Nada foi gravado.';
  end if;

  -- 5. NADA mais mudou de privilégio: só entram a tabela e as nove funções, cada uma com o ACL exato;
  --    nenhum objeto que existia ganhou ou perdeu acesso (nem o schema public, que a migração abre e
  --    fecha para o dono dedicado)
  select array_agg(o.obj || ' ' || o.acl) into agora from (
    select c.oid::regclass::text as obj, coalesce(c.relacl::text, '(padrão)') as acl
      from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
     where n.nspname in ('king_private', 'public') and c.relkind in ('r', 'v', 'm', 'S', 'p', 'f')
    union all
    select p.oid::regprocedure::text, coalesce(p.proacl::text, '(padrão)')
      from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
     where n.nspname in ('king_private', 'public')
    union all
    select 'schema ' || n.nspname, coalesce(n.nspacl::text, '(padrão)')
      from pg_namespace as n where n.nspname in ('king_private', 'public')) as o;
  novos   := array(select x from unnest(agora) as x except select y from unnest(antes.privilegios) as y);
  sumidos := array(select y from unnest(antes.privilegios) as y except select x from unnest(agora) as x);
  if cardinality(sumidos) <> 0 or cardinality(novos) <> 10
     -- (o texto do objeto vem dele mesmo: com `public` no search_path, o Postgres o escreve sem prefixo)
     or not (equipar::text || ' {king_progress_owner=X/king_progress_owner,authenticated=X/king_progress_owner}' = any (novos))
     or not (sala::text || ' {king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' = any (novos))
     or not (nivel::text || ' {king_progress_owner=X/king_progress_owner}' = any (novos))
     or not (toalha::text || ' {king_progress_owner=X/king_progress_owner,authenticated=X/king_progress_owner}' = any (novos))
     or not (mesa::text || ' {king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' = any (novos))
     or not (nivel_t::text || ' {king_progress_owner=X/king_progress_owner}' = any (novos))
     or not (item::text || ' {king_progress_owner=X/king_progress_owner,authenticated=X/king_progress_owner}' = any (novos))
     or not (assent::text || ' {king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' = any (novos))
     or not (nivel_i::text || ' {king_progress_owner=X/king_progress_owner}' = any (novos))
     or not exists (select 1 from unnest(novos) as n
                     where starts_with(n, t::text || ' {')
                       and n ~ ' \{king_progress_owner=[a-zA-Z]+/king_progress_owner,authenticated=r/king_progress_owner\}$') then
    raise exception 'CONFERÊNCIA 5 FALHOU: privilégio fora da Entrega B (novos: %; sumidos: %). Nada foi gravado.', novos, sumidos;
  end if;
  -- ...nem privilégio de COLUNA, nem papel novo do servidor; e a única política nova é a da tabela
  if (select coalesce(array_agg(c.oid::regclass::text || '.' || a.attname || ' ' || a.attacl::text
                                order by c.oid::regclass::text || '.' || a.attname collate "C"), '{}')
        from pg_attribute as a join pg_class as c on c.oid = a.attrelid join pg_namespace as n on n.oid = c.relnamespace
       where n.nspname in ('king_private', 'public') and a.attacl is not null) is distinct from antes.privilegios_de_coluna
     or (select coalesce(array_agg(m.roleid::regrole::text order by m.roleid::regrole::text collate "C"), '{}')
           from pg_auth_members as m where m.member = 'king_server'::regrole) is distinct from antes.papeis_do_servidor
     or (select coalesce(array_agg(c.oid::regclass::text || ' ' || p.polname
                                   order by c.oid::regclass::text || ' ' || p.polname collate "C"), '{}')
           from pg_policy as p join pg_class as c on c.oid = p.polrelid join pg_namespace as n on n.oid = c.relnamespace
          where n.nspname in ('king_private', 'public'))
        is distinct from
        (select array_agg(s collate "C" order by s collate "C")
           from unnest(antes.politicas || array[t::text || ' cosmeticos_leio_os_meus']) as s) then
    raise exception 'CONFERÊNCIA 5 FALHOU: privilégio de coluna, papel do servidor ou política de RLS fora da Entrega B. Nada foi gravado.';
  end if;

  -- 6. SECURITY DEFINER: só as seis portas novas entram na lista
  if (select array_agg(s collate "C" order by s collate "C") from (
        select n.nspname || '.' || p.proname as s
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private')) as d)
     is distinct from
     (select array_agg(s collate "C" order by s collate "C")
        from unnest(antes.security_definer || array['public.equipar_cosmetico', 'king_private.cosmeticos_da_sala',
                                                  'public.equipar_toalha', 'king_private.toalhas_do_anfitriao',
                                                  'public.equipar_item', 'king_private.cosmeticos_dos_assentos']) as s) then
    raise exception 'CONFERÊNCIA 6 FALHOU: funções SECURITY DEFINER fora da Entrega B. Nada foi gravado.';
  end if;

  -- 7. o progresso intacto: crédito e curva de nível com o MESMO código; XP, ledger, partidas e
  --    partidas sem diminuir (um crédito pode confirmar durante a transação), e
  --    progresso e ledger batendo como antes
  if (select md5(p.prosrc) from pg_proc as p where p.oid = credito) <> antes.credito_md5
     or (select md5(p.prosrc) from pg_proc as p where p.oid = 'public.nivel_de(integer)'::regprocedure) <> antes.nivel_md5
     or not has_function_privilege('king_server', credito, 'execute')
     or (select count(*) from public.progresso) < antes.linhas_de_progresso
     or (select coalesce(sum(xp_total), 0) from public.progresso) < antes.xp_total
     or (select count(*) from public.xp_eventos) < antes.lancamentos
     or (select coalesce(sum(xp_delta), 0) from public.xp_eventos) < antes.xp_no_ledger
     or (select count(*) from king_private.partidas) < antes.partidas
     or (select count(*) from public.progresso as g
          where g.xp_total <> (select coalesce(sum(x.xp_delta), 0) from public.xp_eventos as x where x.player_id = g.player_id))
        <> antes.divergentes then
    raise exception 'CONFERÊNCIA 7 FALHOU: o progresso mudou (crédito, curva, XP, ledger ou partidas). Nada foi gravado.';
  end if;
end $$;

commit;

-- ═══ RELATÓRIO — só aparece se TUDO acima passou e foi gravado ════════════════════════════
select 'COSMÉTICOS (ENTREGA B) APLICADA E CONFERIDA' as resultado,
       has_function_privilege('authenticated', 'public.equipar_item(text,boolean)', 'execute')      as cliente_equipa_o_catalogo,
       has_function_privilege('king_server', 'king_private.cosmeticos_dos_assentos(uuid[])', 'execute') as servidor_le_os_assentos,
       to_regclass('public.cosmeticos_equipados') is not null                                      as tabela,
       (select count(*) from public.cosmeticos_equipados)                                          as escolhas_gravadas,
       has_function_privilege('authenticated', 'public.equipar_cosmetico(text,boolean)', 'execute') as cliente_equipa,
       has_function_privilege('king_server', 'king_private.cosmeticos_da_sala(uuid[])', 'execute') as servidor_le_a_sala,
       has_function_privilege('authenticated', 'public.equipar_toalha(text)', 'execute')          as cliente_escolhe_toalha,
       has_function_privilege('king_server', 'king_private.toalhas_do_anfitriao(uuid)', 'execute') as servidor_le_a_mesa,
       (select count(*) from public.progresso)                                                     as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)                                   as xp_total;
