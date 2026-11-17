-- ENTREGA B — COSMÉTICOS POR NÍVEL — COLAR ESTE ARQUIVO INTEIRO NO SQL EDITOR E RODAR UMA VEZ.
--
-- ARQUIVO GERADO por scripts/montar-rollout-cosmeticos.mjs — não editar à mão.
-- Migração dentro dele, texto idêntico: supabase/migrations/20261117120000_cosmeticos.sql
--   sha256 a2001a46034d5d3fa8d89413305d2e833a386200a25d1380e5e9e2f89ff8c725
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
-- O que muda: nasce a tabela das escolhas (vazia) e três funções. NADA do que existe muda: progresso,
-- XP, ledger, crédito, lápides, jogadores e privilégios ficam como estão (as conferências provam). O
-- servidor e a web que estão no ar hoje não usam nada disto; ativar é o passo seguinte (servidor, depois
-- web), cada um com autorização própria.
--
-- Rollback: supabase/rollback/20261117120000_cosmeticos_rollback.sql (apaga as escolhas gravadas, e só
-- elas). Depois dele, o checkpoint 1 volta a dizer pronto_para_aplicar = true.

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
     or to_regprocedure('king_private.nivel_do_cosmetico(text)') is not null then
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

-- ═══ PARTE 2/3 — A MIGRAÇÃO, idêntica a supabase/migrations/20261117120000_cosmeticos.sql ═══
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
  foreach f in array array[equipar, sala, nivel] loop
    if f is null
       or (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = f) <> 'king_progress_owner'
       or (select p.proconfig from pg_proc as p where p.oid = f) is distinct from array['search_path=""'] then
      raise exception 'CONFERÊNCIA 3 FALHOU: % fora do dono dedicado ou com search_path aberto. Nada foi gravado.', f;
    end if;
  end loop;
  if not (select p.prosecdef from pg_proc as p where p.oid = equipar)
     or not (select p.prosecdef from pg_proc as p where p.oid = sala)
     or (select p.prosecdef from pg_proc as p where p.oid = nivel) then
    raise exception 'CONFERÊNCIA 3 FALHOU: SECURITY DEFINER fora do previsto nas funções dos cosméticos. Nada foi gravado.';
  end if;
  -- o catálogo do banco é o mesmo do app: 2 / 4 / 6, e nada fora dele
  if king_private.nivel_do_cosmetico('moldura-real') is distinct from 2
     or king_private.nivel_do_cosmetico('baralho-imperial') is distinct from 4
     or king_private.nivel_do_cosmetico('reacao-coroa') is distinct from 6
     or king_private.nivel_do_cosmetico('outro') is not null then
    raise exception 'CONFERÊNCIA 3 FALHOU: o catálogo do banco não é 2/4/6. Nada foi gravado.';
  end if;

  -- 4. quem pode o quê: o cliente LÊ (RLS) e EQUIPA (pela porta); só o servidor lê a sala; ninguém
  --    da API escreve na tabela nem executa o catálogo ou a porta da sala
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role', 'king_server'] loop
    if has_table_privilege(papel, t, 'insert, update, delete, truncate, references, trigger') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % escreve na tabela dos cosméticos. Nada foi gravado.', papel;
    end if;
    if has_function_privilege(papel, nivel, 'execute') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % executa o catálogo direto. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(papel, sala, 'execute') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % executa a porta da sala. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'service_role', 'king_server'] loop
    if has_function_privilege(papel, equipar, 'execute') or has_table_privilege(papel, t, 'select') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % lê a tabela ou equipa. Nada foi gravado.', papel;
    end if;
  end loop;
  if not has_table_privilege('authenticated', t, 'select') or not has_function_privilege('authenticated', equipar, 'execute')
     or not has_function_privilege('king_server', sala, 'execute') or pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'CONFERÊNCIA 4 FALHOU: faltou a leitura/porta do cliente ou a do servidor, ou o servidor virou dono. Nada foi gravado.';
  end if;

  -- 5. NADA mais mudou de privilégio: só entram a tabela e as três funções, cada uma com o ACL exato;
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
  if cardinality(sumidos) <> 0 or cardinality(novos) <> 4
     -- (o texto do objeto vem dele mesmo: com `public` no search_path, o Postgres o escreve sem prefixo)
     or not (equipar::text || ' {king_progress_owner=X/king_progress_owner,authenticated=X/king_progress_owner}' = any (novos))
     or not (sala::text || ' {king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' = any (novos))
     or not (nivel::text || ' {king_progress_owner=X/king_progress_owner}' = any (novos))
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

  -- 6. SECURITY DEFINER: só as duas portas novas entram na lista
  if (select array_agg(s collate "C" order by s collate "C") from (
        select n.nspname || '.' || p.proname as s
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private')) as d)
     is distinct from
     (select array_agg(s collate "C" order by s collate "C")
        from unnest(antes.security_definer || array['public.equipar_cosmetico', 'king_private.cosmeticos_da_sala']) as s) then
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
       to_regclass('public.cosmeticos_equipados') is not null                                      as tabela,
       (select count(*) from public.cosmeticos_equipados)                                          as escolhas_gravadas,
       has_function_privilege('authenticated', 'public.equipar_cosmetico(text,boolean)', 'execute') as cliente_equipa,
       has_function_privilege('king_server', 'king_private.cosmeticos_da_sala(uuid[])', 'execute') as servidor_le_a_sala,
       (select count(*) from public.progresso)                                                     as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)                                   as xp_total;
