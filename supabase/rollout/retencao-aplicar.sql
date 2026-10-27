-- PASSO D2 — RETENÇÃO DAS LÁPIDES (Fase 9, E-2) — COLAR ESTE ARQUIVO INTEIRO NO SQL EDITOR E RODAR UMA VEZ.
--
-- ARQUIVO GERADO por scripts/montar-rollout-retencao.mjs — não editar à mão.
-- Migração dentro dele, texto idêntico: supabase/migrations/20261026120000_retencao_das_lapides.sql
--   sha256 11d8e88548112e9d5fac86fa9204ac57a02fd79ceaff1c8702326b489798ab25
--
-- ANTES: rodar supabase/rollout/retencao-checkpoint-1-antes.sql (só leitura) e ver pronto_para_aplicar = true.
--
-- Colar INTEIRO, numa aba só, e rodar UMA vez. O editor pode pedir confirmação de operação destrutiva
-- (por causa do `on commit drop` e do `delete` dentro da função): confirmar. SÓ está aplicado se a última
-- tela mostrar a linha "RETENÇÃO DAS LÁPIDES (E-2) APLICADA E CONFERIDA"; sem ela, nada foi gravado.
--
-- É UMA transação: BEGIN, recusas e retrato do "antes", a migração, conferências e COMMIT. Se QUALQUER
-- passo falhar, o erro aparece, o COMMIT não roda e NADA é gravado — nesse caso, rodar `rollback;`
-- sozinho para limpar a sessão e me mandar o erro. "lock timeout" = uma exclusão de conta estava no
-- meio: rodar de novo um minuto depois. Se tudo passar, a última tela mostra uma linha
-- "RETENÇÃO DAS LÁPIDES (E-2) APLICADA E CONFERIDA".
--
-- DEPOIS: rodar supabase/rollout/retencao-checkpoint-3-depois.sql (só leitura) e ver tudo_certo = true.
--
-- O que muda: nasce a função de expurgo (EXECUTE só para king_server) e o estado dele (uma linha, sem
-- marcador); a função da lápide passa a guardar a exclusão mais recente. NENHUMA lápide sai aqui — nem
-- as vencidas: quem expurga é o servidor novo, no passo S. O servidor que está no ar hoje não chama a
-- função nova, e o crédito de XP segue o mesmo. Durante os poucos segundos da transação, uma exclusão de
-- conta espera e segue; o crédito de XP não espera.
--
-- Rollback: supabase/rollback/20261026120000_retencao_das_lapides_rollback.sql.

begin;

-- ═══ PARTE 1/3 — ANTES DA MIGRAÇÃO (na MESMA transação) ════════════════════════════════════
--
-- 1. RECUSA rodar sem o passo D inteiro, com QUALQUER pedaço da E-2 já presente (reaplicação, ou um
--    arquivo que parou no meio), sem os papéis do progresso, com um aplicador que não herda o dono das
--    lápides, ou com o servidor membro desse dono.
-- 2. TRAVA a lápide contra escrita (modo share), com prazo de 5 s: nenhuma lápide entra nem sai
--    enquanto esta transação existir — uma exclusão de conta que chegar agora espera o COMMIT e segue —,
--    e o retrato abaixo fica estável até a conferência. Crédito de XP e leitura seguem livres. Se a trava
--    não vier em 5 s ("lock timeout"), NADA é gravado: rodar de novo um minuto depois.
-- 3. RETRATO do que a migração NÃO pode mudar, numa tabela temporária que some no commit.
set local lock_timeout = '5s';

do $$
declare
  credito regprocedure := to_regprocedure('king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)');
  lapide  regprocedure := to_regprocedure('king_private.registrar_conta_excluida()');
begin
  if to_regrole('king_progress_owner') is null or to_regrole('king_server') is null then
    raise exception 'ROLLOUT D2 ABORTADO (parte 1): papéis do progresso ausentes. Nada foi alterado.';
  end if;
  if not pg_has_role(current_user, 'king_progress_owner', 'MEMBER') or not pg_has_role(current_user, 'king_progress_owner', 'USAGE') then
    raise exception 'ROLLOUT D2 ABORTADO (parte 1): % não herda king_progress_owner. Nada foi alterado.', current_user;
  end if;
  if pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'ROLLOUT D2 ABORTADO (parte 1): king_server é membro do dono das lápides. Nada foi alterado.';
  end if;
  if to_regclass('king_private.contas_excluidas') is null or lapide is null or credito is null
     or not exists (select 1 from pg_trigger as t
                     where t.tgname = 'players_lapide_da_exclusao' and t.tgrelid = 'public.players'::regclass
                       and t.tgenabled = 'O' and t.tgfoid = lapide)
     or position('contas_excluidas' in pg_get_functiondef(credito)) = 0
     or not has_function_privilege('king_server', credito, 'execute') then
    raise exception 'ROLLOUT D2 ABORTADO (parte 1): o passo D não está aplicado inteiro (lápide, gatilho ou crédito novo). Nada foi alterado.';
  end if;
  if to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is not null
     or to_regclass('king_private.expurgo_das_lapides') is not null
     or position('greatest' in pg_get_functiondef(lapide)) > 0 then
    raise exception 'ROLLOUT D2 ABORTADO (parte 1): a retenção das lápides (E-2) já existe, inteira ou em parte, neste banco — esta execução não alterou nada. Se ela acabou de ser aplicada (o arquivo colado duas vezes), confira com o checkpoint 3.';
  end if;
end $$;

lock table king_private.contas_excluidas in share mode;

create temp table rollout_retencao_antes on commit drop as
select (select count(*) from king_private.contas_excluidas)                        as lapides,
       (select md5(coalesce(string_agg(x.player_id::text || '@' || x.excluida_em::text, ',' order by x.player_id), ''))
          from king_private.contas_excluidas as x)                                 as lapides_md5,
       (select count(*) from king_private.contas_excluidas
         where excluida_em < now() - interval '720 hours')                         as vencidas,
       (select md5(p.prosrc) from pg_proc as p
         where p.oid = 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure) as credito_md5,
       (select pg_get_userbyid(p.proowner) || ' ' || p.prosecdef || ' ' || coalesce(p.proconfig::text, '')
          from pg_proc as p where p.oid = 'king_private.registrar_conta_excluida()'::regprocedure) as lapide_funcao,
       (select count(*) from public.progresso)                    as linhas_de_progresso,
       (select coalesce(sum(xp_total), 0) from public.progresso)  as xp_total,
       (select count(*) from public.xp_eventos)                   as lancamentos,
       (select coalesce(sum(xp_delta), 0) from public.xp_eventos) as xp_no_ledger,
       (select count(*) from king_private.partidas)               as partidas,
       (select count(*) from public.progresso as g
         where g.xp_total <> (select coalesce(sum(e.xp_delta), 0) from public.xp_eventos as e where e.player_id = g.player_id)) as divergentes,
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

-- ═══ PARTE 2/3 — A MIGRAÇÃO, idêntica a supabase/migrations/20261026120000_retencao_das_lapides.sql ═══
-- RETENÇÃO DAS LÁPIDES (Fase 9, E-2) — 30 dias, e nunca enquanto um crédito ainda puder lê-las.
--
-- ══ QUANDO UMA LÁPIDE AINDA É NECESSÁRIA ══
--
-- A lápide (`king_private.contas_excluidas`, 20261025130000) guarda o id aleatório de uma conta
-- excluída e a hora da exclusão. O crédito só a lê no passo 3, quando a chave estrangeira de um
-- jogador reprova — e só em partida AINDA NÃO registrada (a já registrada volta no passo 2). Então a
-- lápide de P serve enquanto puder chegar um crédito com P para uma partida nova, e quem pode trazê-lo
-- é só o servidor do jogo:
--
--   • uma pendência no OUTBOX dele, que não tem prazo: fica até o banco confirmar;
--   • um crédito em voo;
--   • uma SALA VIVA: o token só é conferido na ENTRADA, e a reserva do lobby devolve o assento sem
--     token — uma partida pode começar (e terminar) muito depois de um dos jogadores excluir a conta.
--
-- Por isso o SERVIDOR diz o que ainda está em aberto, e o BANCO só aceita tirar o que tem mais de
-- 30 dias — o prazo normal decidido pelo titular (opção B, 26/10/2026). Expurgo cego por relógio
-- (pg_cron) é proibido: apagaria a lápide de quem ainda tem crédito pendente.
--
-- ══ O QUE ESTE ARQUIVO CRIA ══
--
--   expurgo_das_lapides       UMA linha: o MARCADOR do outbox registrado e contadores sem dado
--                             pessoal. O marcador é um id aleatório que mora num arquivo dentro do
--                             diretório do outbox; um diretório trocado, desmontado ou recriado vazio
--                             tem outro marcador, e com ele nada sai ("vazio" ali não prova nada).
--   expurgar_lapides          a ÚNICA porta. Recebe o marcador e a lista dos jogadores que o servidor
--                             ainda tem em aberto (outbox, créditos em voo, salas vivas) e tira só
--                             lápide com mais de 720 h — 30 dias exatos, pelo relógio do BANCO, sem
--                             fuso nem horário de verão no meio — que não esteja na lista. EXECUTE só
--                             para `king_server`, que continua sem nenhum privilégio de tabela.
--   registrar_conta_excluida  (redefinida) a hora da lápide passa a ser a da exclusão MAIS RECENTE do
--                             id: um id que volta a existir e é excluído de novo não pode herdar a
--                             idade da primeira lápide e sair antes do prazo.
--
-- Fora daqui (e documentado no §22.11): apagar `public.players` à mão com a conta viva deixa uma
-- conta viva com lápide — pulada no crédito e, depois do expurgo, derrubando a mesa. Exclusão é só
-- pela conta (excluir-conta ou Authentication). O gatilho não consegue distinguir os dois casos: a
-- cascata da chave estrangeira dispara este gatilho no MESMO nível do comando de fora.
--
-- ══ APLICAÇÃO E ROLLBACK ══
--
-- SQL Editor do Supabase (papel `postgres`, membro de `king_progress_owner`). As conferências do fim
-- reprovam o arquivo inteiro se a função, o dono ou os privilégios não ficarem exatamente como aqui.
-- Rollback: supabase/rollback/20261026120000_retencao_das_lapides_rollback.sql.

set role king_progress_owner;

-- ══ O ESTADO DO EXPURGO ═════════════════════════════════════════════════════════════════════
-- Sem política de RLS e sem GRANT: só o dono lê, e só a função escreve. O rollback desta migração
-- MANTÉM o estado quando já houve remoção (é a prova de exclusão real): reaplicar reaproveita a linha.
create table if not exists king_private.expurgo_das_lapides (
  unica             boolean     primary key default true constraint expurgo_das_lapides_uma_linha check (unica),
  outbox            uuid,                                  -- marcador registrado; null = registrar na próxima rodada
  rodadas           bigint      not null default 0,
  lapides_removidas bigint      not null default 0,
  ultima_rodada     timestamptz
);
alter table king_private.expurgo_das_lapides enable row level security;
revoke all on table king_private.expurgo_das_lapides from public;
insert into king_private.expurgo_das_lapides (unica) values (true) on conflict (unica) do nothing;

-- ══ A PORTA DO EXPURGO ══════════════════════════════════════════════════════════════════════
create function king_private.expurgar_lapides(p_outbox uuid, p_protegidas uuid[])
returns table (removidas integer, retidas integer)
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  -- 30 dias EXATOS (720 h) pelo relógio do banco: "30 days" mudaria com o fuso da sessão
  v_corte      timestamptz := now() - interval '720 hours';
  v_registrado uuid;
  v_removidas  integer;
  v_retidas    integer;
begin
  -- Sem marcador ou sem a lista inteira não há prova de nada: NULL nunca quer dizer "nada pendente".
  if p_outbox is null or p_protegidas is null or array_position(p_protegidas, null) is not null then
    raise exception 'expurgo sem o marcador do outbox ou sem a lista completa de protegidas' using errcode = '22023';
  end if;
  if cardinality(p_protegidas) > 40000 then
    raise exception 'lista de protegidas grande demais' using errcode = '22023';
  end if;

  -- A linha do estado, TRAVADA: duas rodadas nunca correm juntas, e o marcador não troca no meio.
  select e.outbox into v_registrado
    from king_private.expurgo_das_lapides as e
   where e.unica
     for update;
  if not found then
    raise exception 'estado do expurgo ausente' using errcode = 'KL002';
  end if;
  if v_registrado is null then
    update king_private.expurgo_das_lapides as e set outbox = p_outbox where e.unica;
  elsif v_registrado <> p_outbox then
    raise exception 'o outbox não é o registrado: nada foi expurgado' using errcode = 'KL001';
  end if;

  delete from king_private.contas_excluidas as x
   where x.excluida_em < v_corte
     and x.player_id <> all (p_protegidas);
  get diagnostics v_removidas = row_count;

  -- o que venceu e ficou: só as protegidas pela lista
  select count(*)::integer into v_retidas
    from king_private.contas_excluidas as x
   where x.excluida_em < v_corte;

  update king_private.expurgo_das_lapides as e
     set rodadas = e.rodadas + 1,
         lapides_removidas = e.lapides_removidas + v_removidas,
         ultima_rodada = now()
   where e.unica;

  return query select v_removidas, v_retidas;
end $$;

-- ══ A LÁPIDE, REDEFINIDA ════════════════════════════════════════════════════════════════════
-- Mesmo dono, mesmo SECURITY DEFINER (quem apaga a conta é o papel do Auth), mesmos privilégios: o
-- `create or replace` não mexe neles.
create or replace function king_private.registrar_conta_excluida() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into king_private.contas_excluidas as x (player_id) values (old.id)
  on conflict (player_id) do update set excluida_em = greatest(x.excluida_em, excluded.excluida_em);
  return null;
end $$;

reset role;

revoke all on function king_private.expurgar_lapides(uuid, uuid[]) from public, anon, authenticated, service_role;
grant execute on function king_private.expurgar_lapides(uuid, uuid[]) to king_server;

comment on table king_private.expurgo_das_lapides is
  'Estado do expurgo das lápides (E-2): marcador do outbox registrado e contadores. Sem dado pessoal.';
comment on function king_private.expurgar_lapides(uuid, uuid[]) is
  'Tira lápide com mais de 720 h que o servidor não cite como pendente. Só king_server executa.';

-- ══ CONFERÊNCIAS — qualquer divergência reprova o arquivo inteiro ═══════════════════════════
do $conferencias$
declare
  f regprocedure := 'king_private.expurgar_lapides(uuid,uuid[])'::regprocedure;
  g regprocedure := 'king_private.registrar_conta_excluida()'::regprocedure;
  papel text;
begin
  if (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = f) <> 'king_progress_owner'
     or not (select p.prosecdef from pg_proc as p where p.oid = f)
     or (select p.proconfig from pg_proc as p where p.oid = f) is distinct from array['search_path=""', 'lock_timeout=5s'] then
    raise exception 'E-2 ABORTADA: dono, SECURITY DEFINER ou configuração da função de expurgo errados. Nada foi aplicado.';
  end if;
  if (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = g) <> 'king_progress_owner'
     or not (select p.prosecdef from pg_proc as p where p.oid = g)
     or (select p.proconfig from pg_proc as p where p.oid = g) is distinct from array['search_path=""'] then
    raise exception 'E-2 ABORTADA: o gatilho da lápide perdeu dono, SECURITY DEFINER ou search_path. Nada foi aplicado.';
  end if;
  if not has_function_privilege('king_server', f, 'execute') then
    raise exception 'E-2 ABORTADA: king_server não executa a função de expurgo. Nada foi aplicado.';
  end if;
  if pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'E-2 ABORTADA: king_server é membro do dono das lápides (SET ROLE escaparia de tudo). Nada foi aplicado.';
  end if;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(papel, f, 'execute') or has_function_privilege(papel, g, 'execute') then
      raise exception 'E-2 ABORTADA: % executa uma função da lápide (o REVOKE não valeu). Nada foi aplicado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role', 'king_server'] loop
    if has_table_privilege(papel, 'king_private.expurgo_das_lapides', 'select, insert, update, delete, truncate, references, trigger')
       or has_table_privilege(papel, 'king_private.contas_excluidas', 'select, insert, update, delete, truncate, references, trigger') then
      raise exception 'E-2 ABORTADA: % tem privilégio de tabela na lápide ou no estado do expurgo. Nada foi aplicado.', papel;
    end if;
  end loop;
  if (select count(*) from king_private.expurgo_das_lapides) <> 1 then
    raise exception 'E-2 ABORTADA: o estado do expurgo não nasceu com uma linha só. Nada foi aplicado.';
  end if;
end
$conferencias$;

-- ═══ PARTE 3/3 — CONFERÊNCIAS, AINDA DENTRO DA TRANSAÇÃO ═══════════════════════════════════
--
-- Qualquer falha aqui levanta erro: o COMMIT abaixo não roda e NADA da migração é gravado.
-- (O SQL Editor não mostra NOTICE; quem fala é o erro, ou o relatório no fim.)
do $$
declare
  antes   record;
  e       record;
  f       regprocedure := to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])');
  credito regprocedure := 'king_private.creditar_partida(uuid,timestamptz,timestamptz,smallint,smallint,jsonb)'::regprocedure;
  lapide  regprocedure := 'king_private.registrar_conta_excluida()'::regprocedure;
  agora   text[];
  novos   text[];
  sumidos text[];
  papel   text;
begin
  select * into antes from rollout_retencao_antes;

  if current_user <> session_user then
    raise exception 'CONFERÊNCIA 0 FALHOU: a sessão não voltou ao papel original (%). Nada foi gravado.', current_user;
  end if;

  -- 1. nenhuma lápide saiu, entrou ou mudou — nem as VENCIDAS: só o servidor novo (passo S) expurga
  if (select count(*) from king_private.contas_excluidas) <> antes.lapides
     or (select md5(coalesce(string_agg(x.player_id::text || '@' || x.excluida_em::text, ',' order by x.player_id), ''))
           from king_private.contas_excluidas as x) <> antes.lapides_md5
     or (select count(*) from king_private.contas_excluidas
          where excluida_em < now() - interval '720 hours') <> antes.vencidas then
    raise exception 'CONFERÊNCIA 1 FALHOU: a instalação mexeu nas lápides. Nada foi gravado.';
  end if;

  -- 2. o estado nasce UMA linha, limpo: sem marcador e sem rodada — a instalação não expurga nada
  if (select count(*) from king_private.expurgo_das_lapides) <> 1 then
    raise exception 'CONFERÊNCIA 2 FALHOU: o estado do expurgo não tem uma linha só. Nada foi gravado.';
  end if;
  select * into e from king_private.expurgo_das_lapides;
  if e.outbox is not null or e.rodadas <> 0 or e.lapides_removidas <> 0 or e.ultima_rodada is not null then
    raise exception 'CONFERÊNCIA 2 FALHOU: o estado do expurgo não nasceu limpo (%). Nada foi gravado.', row_to_json(e);
  end if;
  if not (select c.relrowsecurity from pg_class as c where c.oid = 'king_private.expurgo_das_lapides'::regclass)
     or pg_get_userbyid((select c.relowner from pg_class as c where c.oid = 'king_private.expurgo_das_lapides'::regclass)) <> 'king_progress_owner' then
    raise exception 'CONFERÊNCIA 2 FALHOU: o estado do expurgo sem RLS ou fora do dono dedicado. Nada foi gravado.';
  end if;

  -- 3. a porta: dono dedicado, SECURITY DEFINER, search_path vazio, trava com prazo, devolve só
  --    contagens, e o prazo é 720 h pelo relógio do banco (nada de "30 days", que muda com o fuso)
  if f is null
     or (select pg_get_userbyid(p.proowner) from pg_proc as p where p.oid = f) <> 'king_progress_owner'
     or not (select p.prosecdef from pg_proc as p where p.oid = f)
     or (select p.proconfig from pg_proc as p where p.oid = f) is distinct from array['search_path=""', 'lock_timeout=5s']
     or pg_get_function_result(f) <> 'TABLE(removidas integer, retidas integer)'
     or position($q$now() - interval '720 hours'$q$ in (select p.prosrc from pg_proc as p where p.oid = f)) = 0 then
    raise exception 'CONFERÊNCIA 3 FALHOU: a função de expurgo não é a da E-2 (dono, SECURITY DEFINER, configuração ou prazo de 720 h). Nada foi gravado.';
  end if;

  -- 4. quem executa a porta: SÓ king_server (além do dono); ninguém da API; o servidor não vira dono
  if (select p.proacl::text from pg_proc as p where p.oid = f)
       is distinct from '{king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' then
    raise exception 'CONFERÊNCIA 4 FALHOU: privilégios da função de expurgo (%). Nada foi gravado.',
      (select p.proacl::text from pg_proc as p where p.oid = f);
  end if;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(papel, f, 'execute') or has_function_privilege(papel, lapide, 'execute') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % executa uma função da lápide. Nada foi gravado.', papel;
    end if;
  end loop;
  foreach papel in array array['public', 'anon', 'authenticated', 'service_role', 'king_server'] loop
    if has_table_privilege(papel, 'king_private.expurgo_das_lapides', 'select, insert, update, delete, truncate, references, trigger')
       or has_table_privilege(papel, 'king_private.contas_excluidas', 'select, insert, update, delete, truncate, references, trigger') then
      raise exception 'CONFERÊNCIA 4 FALHOU: % tem privilégio de tabela na lápide ou no estado do expurgo. Nada foi gravado.', papel;
    end if;
  end loop;
  if not has_function_privilege('king_server', f, 'execute') or pg_has_role('king_server', 'king_progress_owner', 'MEMBER') then
    raise exception 'CONFERÊNCIA 4 FALHOU: king_server sem a porta, ou membro do dono das lápides. Nada foi gravado.';
  end if;

  -- 5. NADA mais mudou de privilégio: só entram a porta (EXECUTE do dono e de king_server) e o estado
  --    (só do dono); nenhum objeto que existia ganhou ou perdeu acesso
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
  if cardinality(sumidos) <> 0 or cardinality(novos) <> 2
     or not ('king_private.expurgar_lapides(uuid,uuid[]) {king_progress_owner=X/king_progress_owner,king_server=X/king_progress_owner}' = any (novos))
     or not exists (select 1 from unnest(novos) as n
                     where n ~ '^king_private\.expurgo_das_lapides \{king_progress_owner=[a-zA-Z]+/king_progress_owner\}$') then
    raise exception 'CONFERÊNCIA 5 FALHOU: privilégio fora da E-2 (novos: %; sumidos: %). Nada foi gravado.', novos, sumidos;
  end if;
  -- ...nem privilégio de COLUNA, nem política de RLS, nem papel novo do servidor
  if (select coalesce(array_agg(c.oid::regclass::text || '.' || a.attname || ' ' || a.attacl::text
                                order by c.oid::regclass::text || '.' || a.attname collate "C"), '{}')
        from pg_attribute as a join pg_class as c on c.oid = a.attrelid join pg_namespace as n on n.oid = c.relnamespace
       where n.nspname in ('king_private', 'public') and a.attacl is not null) is distinct from antes.privilegios_de_coluna
     or (select coalesce(array_agg(c.oid::regclass::text || ' ' || p.polname
                                   order by c.oid::regclass::text || ' ' || p.polname collate "C"), '{}')
           from pg_policy as p join pg_class as c on c.oid = p.polrelid join pg_namespace as n on n.oid = c.relnamespace
          where n.nspname in ('king_private', 'public')) is distinct from antes.politicas
     or (select coalesce(array_agg(m.roleid::regrole::text order by m.roleid::regrole::text collate "C"), '{}')
           from pg_auth_members as m where m.member = 'king_server'::regrole) is distinct from antes.papeis_do_servidor then
    raise exception 'CONFERÊNCIA 5 FALHOU: privilégio de coluna, política de RLS ou papel do servidor mudou. Nada foi gravado.';
  end if;

  -- 6. o passo D intacto: lápide com RLS, gatilho ligado na mesma função, a função da lápide no mesmo
  --    dono/definer/search_path (agora guardando a exclusão MAIS RECENTE), e o crédito a MESMA função,
  --    executável pelo servidor
  if not (select c.relrowsecurity from pg_class as c where c.oid = 'king_private.contas_excluidas'::regclass)
     or not exists (select 1 from pg_trigger as t
                     where t.tgname = 'players_lapide_da_exclusao' and t.tgrelid = 'public.players'::regclass
                       and t.tgenabled = 'O' and t.tgfoid = lapide)
     or (select pg_get_userbyid(p.proowner) || ' ' || p.prosecdef || ' ' || coalesce(p.proconfig::text, '')
           from pg_proc as p where p.oid = lapide) <> antes.lapide_funcao
     or position('greatest(x.excluida_em, excluded.excluida_em)' in pg_get_functiondef(lapide)) = 0
     or (select md5(p.prosrc) from pg_proc as p where p.oid = credito) <> antes.credito_md5
     or not has_function_privilege('king_server', credito, 'execute') then
    raise exception 'CONFERÊNCIA 6 FALHOU: o passo D não ficou intacto (lápide, gatilho, função da lápide ou crédito). Nada foi gravado.';
  end if;

  -- 7. XP, ledger e partidas: nada do que existia diminuiu (um crédito pode confirmar durante a
  --    transação; o ledger só aceita delta de 0 a 150) e progresso e ledger continuam batendo
  if (select count(*) from public.progresso) < antes.linhas_de_progresso
     or (select coalesce(sum(xp_total), 0) from public.progresso) < antes.xp_total
     or (select count(*) from public.xp_eventos) < antes.lancamentos
     or (select coalesce(sum(xp_delta), 0) from public.xp_eventos) < antes.xp_no_ledger
     or (select count(*) from king_private.partidas) < antes.partidas
     or (select count(*) from public.progresso as g
          where g.xp_total <> (select coalesce(sum(x.xp_delta), 0) from public.xp_eventos as x where x.player_id = g.player_id))
        <> antes.divergentes then
    raise exception 'CONFERÊNCIA 7 FALHOU: XP, ledger ou partidas mudaram. Nada foi gravado.';
  end if;

  -- 8. SECURITY DEFINER: só a porta nova entra na lista
  if (select array_agg(s collate "C" order by s collate "C") from (
        select n.nspname || '.' || p.proname as s
          from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
         where p.prosecdef and n.nspname in ('public', 'king_private')) as d)
     is distinct from
     (select array_agg(s collate "C" order by s collate "C")
        from unnest(antes.security_definer || array['king_private.expurgar_lapides']) as s) then
    raise exception 'CONFERÊNCIA 8 FALHOU: funções SECURITY DEFINER fora da E-2. Nada foi gravado.';
  end if;
end $$;

commit;

-- ═══ RELATÓRIO — só aparece se TUDO acima passou e foi gravado ════════════════════════════
select 'RETENÇÃO DAS LÁPIDES (E-2) APLICADA E CONFERIDA' as resultado,
       to_regprocedure('king_private.expurgar_lapides(uuid,uuid[])') is not null as expurgo,
       has_function_privilege('king_server', 'king_private.expurgar_lapides(uuid,uuid[])', 'execute') as servidor_executa,
       (select count(*) from king_private.expurgo_das_lapides)  as estado,
       e.outbox is null                                          as marcador_vazio_ate_o_passo_S,
       e.rodadas,
       e.lapides_removidas,
       (select count(*) from king_private.contas_excluidas)     as lapides,
       (select count(*) from king_private.contas_excluidas
         where excluida_em < now() - interval '720 hours')      as vencidas_esperando_o_passo_S
  from king_private.expurgo_das_lapides as e;
